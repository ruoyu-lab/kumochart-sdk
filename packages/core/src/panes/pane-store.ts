import { checkMargins } from '../options/margins';
import type { PriceScaleMode, ScaleMargins } from '../options/types';
import { PriceScale } from '../scales/price-scale';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import {
  checkBoolean,
  checkFields,
  checkNumber,
  checkOneOf,
  checkString,
  fieldsOf
} from '../utils/validate';

export const MAIN_PANE_ID = 'main';
/** The pane's main scale, on the right; drawings, orders and alerts use it. */
export const RIGHT_SCALE = 'right';
/** The scale with its axis on the left of the plot. */
export const LEFT_SCALE = 'left';

const SCALE_MODES = ['normal', 'log', 'percent', 'indexed'] as const;
const PANE_FIELDS = fieldsOf<PaneInput>({ id: true, title: true, height: true });
const PATCH_FIELDS = fieldsOf<Omit<PaneInput, 'id'>>({ title: true, height: true });

export interface PaneInput {
  /** The chart numbers one, `pane-1` on, when it is left out. */
  id?: string;
  /** Shown in the legend. */
  title?: string;
  /** Height in CSS pixels. Ignored for the main pane, which takes the remaining space. */
  height?: number;
}

/** A pane as reported by the API. */
export interface Pane {
  readonly id: string;
  readonly title: string;
  readonly height: number;
  /** Created for an indicator or series and removed with its last occupant. */
  readonly auto: boolean;
}

/** One price scale of a pane: `right`, `left`, or an overlay without an axis. */
export interface ScaleEntry {
  readonly id: string;
  readonly scale: PriceScale;
  mode: PriceScaleMode;
  invert: boolean;
  /** Space around the auto-scaled data; `null` follows the chart's `priceScale.margins`. */
  margins: ScaleMargins | null;
}

export interface PaneEntry {
  readonly id: string;
  title: string;
  height: number;
  readonly auto: boolean;
  /** The right scale. */
  readonly right: ScaleEntry;
  /** The right scale's price scale. */
  readonly scale: PriceScale;
  /**
   * Every scale of the pane by id, the right one included; the others appear when something is
   * placed on them or they are set up, not when they are only read.
   */
  readonly scales: Map<string, ScaleEntry>;
}

/** Checks the title and the height a pane is given. */
function checkLooks(label: string, looks: Omit<PaneInput, 'id'>): void {
  if (looks.title !== undefined && typeof looks.title !== 'string') {
    fail(`${label}.title must be a string.`);
  }

  if (looks.height !== undefined) {
    checkNumber(`${label}.height`, looks.height, { min: 1 });
  }
}

/** Ordered panes, each owning its price scale. The main pane is always first. */
export class PaneStore {
  private readonly entries: PaneEntry[] = [];
  private readonly ids = new IdSequence((id) => this.get(id) !== undefined);
  private margins: ScaleMargins;

  constructor(
    private defaultHeight: number,
    margins: ScaleMargins
  ) {
    this.margins = margins;
    this.entries.push(this.createEntry(MAIN_PANE_ID, { title: '' }, false));
  }

  list(): readonly PaneEntry[] {
    return this.entries;
  }

  get(id: string): PaneEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  require(id: string): PaneEntry {
    return this.get(id) ?? fail(`Unknown pane "${id}".`);
  }

  info(entry: PaneEntry): Pane {
    return { id: entry.id, title: entry.title, height: entry.height, auto: entry.auto };
  }

  configure(defaultHeight: number, margins: ScaleMargins): void {
    this.defaultHeight = defaultHeight;
    this.margins = margins;
    this.entries.forEach((entry) => {
      entry.scales.forEach((scale) => {
        this.syncScale(scale);
      });
    });
  }

  add(input: PaneInput, auto: boolean): PaneEntry {
    checkFields('pane', input, PANE_FIELDS);
    checkLooks('pane', input);
    const id = input.id === undefined ? this.ids.next('pane') : checkString('pane.id', input.id);

    if (this.get(id)) {
      fail(`A pane with id "${id}" already exists.`);
    }

    const entry = this.createEntry(id, input, auto);
    this.entries.push(entry);
    this.ids.note(id);
    return entry;
  }

  update(id: string, patch: Omit<PaneInput, 'id'>): void {
    checkFields('pane patch', patch, PATCH_FIELDS);
    const entry = this.require(id);
    checkLooks('pane', patch);

    if (patch.title !== undefined) {
      entry.title = patch.title;
    }

    if (patch.height !== undefined) {
      entry.height = patch.height;
    }
  }

  remove(id: string): void {
    if (id === MAIN_PANE_ID) {
      fail('The main pane cannot be removed.');
    }

    const index = this.entries.findIndex((entry) => entry.id === id);

    if (index < 0) {
      fail(`Unknown pane "${id}".`);
    }

    this.entries.splice(index, 1);
  }

  /** Moves a pane to `index` (1 or more; the main pane stays first). */
  move(id: string, index: number): void {
    if (id === MAIN_PANE_ID) {
      fail('The main pane always stays first.');
    }

    checkNumber('index', index, { min: 1, max: this.entries.length - 1, integer: true });
    const from = this.entries.findIndex((entry) => entry.id === id);

    if (from < 0) {
      fail(`Unknown pane "${id}".`);
    }

    const [entry] = this.entries.splice(from, 1);

    if (entry) {
      this.entries.splice(index, 0, entry);
    }
  }

  /** Takes over the panes of a fully validated staging store. */
  adopt(staging: PaneStore): void {
    this.entries.splice(0, this.entries.length, ...staging.entries);
    this.entries.forEach((entry) => {
      this.ids.note(entry.id);
      entry.scales.forEach((scale) => {
        this.syncScale(scale);
      });
    });
  }

  /** A scale of a pane, or `null` while nothing uses it. */
  findScale(paneId: string, scaleId: string): ScaleEntry | null {
    return this.require(paneId).scales.get(scaleId) ?? null;
  }

  /** A scale of a pane, created with default settings when something first uses it. */
  ensureScale(paneId: string, scaleId: string): ScaleEntry {
    const pane = this.require(paneId);
    let entry = pane.scales.get(scaleId);

    if (!entry) {
      checkString('scale id', scaleId);
      entry = this.createScale(scaleId);
      pane.scales.set(scaleId, entry);
    }

    return entry;
  }

  /**
   * The scales of a pane scaled by hand, each once: a scale showing another one counts as that
   * one.
   */
  manualScales(paneId: string): PriceScale[] {
    const manual = new Set<PriceScale>();

    for (const { scale } of this.require(paneId).scales.values()) {
      if (!scale.lead.autoScale) {
        manual.add(scale.lead);
      }
    }

    return [...manual];
  }

  setScaleMode(paneId: string, scaleId: string, mode: PriceScaleMode): void {
    const entry = this.ensureScale(paneId, scaleId);
    entry.mode = checkOneOf('mode', mode, SCALE_MODES);
    this.syncScale(entry);
  }

  setScaleInverted(paneId: string, scaleId: string, invert: boolean): void {
    const entry = this.ensureScale(paneId, scaleId);
    entry.invert = checkBoolean('inverted', invert);
    this.syncScale(entry);
  }

  setScaleMargins(paneId: string, scaleId: string, margins: ScaleMargins | null): void {
    const checked = margins === null ? null : checkMargins('margins', margins);
    const entry = this.ensureScale(paneId, scaleId);
    entry.margins = checked;
    this.syncScale(entry);
  }

  private createScale(id: string): ScaleEntry {
    return {
      id,
      mode: 'normal',
      invert: false,
      margins: null,
      scale: new PriceScale({ mode: 'normal', invert: false, margins: this.margins })
    };
  }

  private createEntry(id: string, input: PaneInput, auto: boolean): PaneEntry {
    const right = this.createScale(RIGHT_SCALE);
    return {
      id,
      title: input.title ?? '',
      height: input.height ?? this.defaultHeight,
      auto,
      right,
      scale: right.scale,
      scales: new Map([[RIGHT_SCALE, right]])
    };
  }

  private syncScale(entry: ScaleEntry): void {
    entry.scale.configure({
      mode: entry.mode,
      invert: entry.invert,
      margins: entry.margins ?? this.margins
    });
  }
}

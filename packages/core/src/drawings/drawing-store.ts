import { toTime } from '../data/time';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import type { Registry } from '../utils/registry';
import {
  checkArray,
  checkBoolean,
  checkFields,
  checkNumber,
  checkString,
  fieldsOf
} from '../utils/validate';
import { checkStyle } from './style';
import { checkTimeframes } from './timeframes';
import type {
  Drawing,
  DrawingInput,
  DrawingPoint,
  DrawingPointInput,
  DrawingStyle,
  DrawingTimeframes,
  DrawingTypeDefinition
} from './types';

const HISTORY_LIMIT = 100;

/** A drawing as the store keeps it. Its points and style are replaced, never changed in place. */
export interface DrawingEntry {
  readonly id: string;
  readonly type: string;
  readonly definition: DrawingTypeDefinition;
  pane: string;
  points: readonly DrawingPoint[];
  style: Readonly<Partial<DrawingStyle>>;
  text: string;
  locked: boolean;
  visible: boolean;
  timeframes: DrawingTimeframes | null;
}

/** The drawings at a step of the history; a drawing that did not change is shared by the steps. */
export type DrawingSnapshot = readonly Readonly<DrawingEntry>[];

const DRAWING_FIELDS = fieldsOf<DrawingInput>({
  id: true,
  type: true,
  pane: true,
  points: true,
  style: true,
  text: true,
  locked: true,
  visible: true,
  timeframes: true
});
const PATCH_FIELDS = DRAWING_FIELDS.filter((field) => field !== 'id' && field !== 'type');
const POINT_FIELDS = fieldsOf<DrawingPointInput>({ time: true, price: true });

export function parsePoints(points: readonly DrawingPointInput[], label: string): DrawingPoint[] {
  checkArray(label, points);
  points.forEach((point, index) => {
    checkFields(`${label}[${index}]`, point, POINT_FIELDS);
  });

  return points.map((point, index) => ({
    time: toTime(point.time, `${label}[${index}].time`),
    price: checkNumber(`${label}[${index}].price`, point.price)
  }));
}

function timeframesOf(timeframes: DrawingTimeframes | null): DrawingTimeframes | null {
  return timeframes === null ? null : checkTimeframes(timeframes);
}

/** Throws unless a drawing of a type can be in a pane that exists. */
function checkPane(
  definition: DrawingTypeDefinition,
  pane: string,
  type: string,
  paneExists: (id: string) => boolean
): void {
  if (!paneExists(pane)) {
    fail(`Unknown pane "${pane}".`);
  }

  if (definition.mainPane && pane !== MAIN_PANE_ID) {
    fail(
      `A "${type}" drawing is computed from the bars of the main pane; it goes on the main pane, not "${pane}".`
    );
  }
}

/** Throws unless a drawing has the points its type needs. */
export function checkPointCount(
  definition: DrawingTypeDefinition,
  points: readonly DrawingPoint[],
  type: string
): void {
  const valid = definition.points === 0 ? points.length >= 2 : points.length === definition.points;

  if (!valid) {
    const expected = definition.points === 0 ? 'at least 2' : String(definition.points);
    fail(`A "${type}" drawing needs ${expected} points, received ${points.length}.`);
  }
}

/** The drawings of a chart in z-order, with snapshots for undo and redo. */
export class DrawingStore {
  private entries: DrawingEntry[] = [];
  private readonly ids: IdSequence;
  /** The copy of each drawing in the snapshots until it changes, which the steps then share. */
  private readonly copies = new WeakMap<DrawingEntry, Readonly<DrawingEntry>>();

  /** `after` numbers on from the ids of the store this one stages drawings for. */
  constructor(
    readonly registry: Registry<DrawingTypeDefinition>,
    after?: IdSequence
  ) {
    this.ids = new IdSequence((id) => this.get(id) !== undefined, after);
  }

  /**
   * An empty store to check the drawings `inputs` that are to replace these: it numbers those
   * without an id after the ids this one gave and those the inputs give.
   */
  staging(inputs: readonly DrawingInput[]): DrawingStore {
    const staging = new DrawingStore(this.registry, this.ids);
    staging.ids.reserve(inputs);
    return staging;
  }

  list(): readonly DrawingEntry[] {
    return this.entries;
  }

  get(id: string): DrawingEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  require(id: string): DrawingEntry {
    return this.get(id) ?? fail(`Unknown drawing "${id}".`);
  }

  info(entry: DrawingEntry): Drawing {
    return {
      id: entry.id,
      type: entry.type,
      pane: entry.pane,
      points: entry.points.map((point) => ({ ...point })),
      style: structuredClone(entry.style),
      text: entry.text,
      locked: entry.locked,
      visible: entry.visible,
      timeframes: structuredClone(entry.timeframes)
    };
  }

  /** Validates an input into an entry without adding it. */
  create(input: DrawingInput, paneExists: (id: string) => boolean): DrawingEntry {
    checkFields('drawing', input, DRAWING_FIELDS);
    checkString('drawing.type', input.type);
    const definition = this.registry.require(input.type);
    const id = input.id ?? this.ids.next(input.type);
    checkString('drawing.id', id);

    if (this.get(id)) {
      fail(`A drawing with id "${id}" already exists.`);
    }

    const pane = input.pane ?? MAIN_PANE_ID;
    checkPane(definition, pane, input.type, paneExists);
    const points = parsePoints(input.points, 'drawing.points');
    checkPointCount(definition, points, input.type);

    return {
      id,
      type: input.type,
      definition,
      pane,
      points,
      style: checkStyle(input.style ?? {}),
      text: input.text === undefined ? '' : checkTextValue(input.text),
      locked: input.locked === undefined ? false : checkBoolean('drawing.locked', input.locked),
      visible: input.visible === undefined ? true : checkBoolean('drawing.visible', input.visible),
      timeframes: timeframesOf(input.timeframes ?? null)
    };
  }

  add(entry: DrawingEntry): void {
    this.entries.push(entry);
    this.ids.note(entry.id);
  }

  update(
    id: string,
    patch: Omit<Partial<DrawingInput>, 'id' | 'type'>,
    paneExists: (id: string) => boolean
  ): void {
    checkFields('drawing patch', patch, PATCH_FIELDS);
    const entry = this.require(id);
    const points =
      patch.points === undefined ? entry.points : parsePoints(patch.points, 'drawing.points');
    checkPointCount(entry.definition, points, entry.type);

    if (patch.pane !== undefined) {
      checkPane(entry.definition, patch.pane, entry.type, paneExists);
    }

    const style =
      patch.style === undefined ? entry.style : { ...entry.style, ...checkStyle(patch.style) };
    const text = patch.text === undefined ? entry.text : checkTextValue(patch.text);
    const locked =
      patch.locked === undefined ? entry.locked : checkBoolean('drawing.locked', patch.locked);
    const visible =
      patch.visible === undefined ? entry.visible : checkBoolean('drawing.visible', patch.visible);
    const timeframes =
      patch.timeframes === undefined ? entry.timeframes : timeframesOf(patch.timeframes);

    this.copies.delete(entry);
    entry.points = points;
    entry.pane = patch.pane ?? entry.pane;
    entry.style = style;
    entry.text = text;
    entry.locked = locked;
    entry.visible = visible;
    entry.timeframes = timeframes;
  }

  setPoints(id: string, points: readonly DrawingPoint[]): void {
    const entry = this.require(id);
    this.copies.delete(entry);
    entry.points = points;
  }

  remove(id: string): DrawingEntry {
    const entry = this.require(id);
    this.entries = this.entries.filter((item) => item !== entry);
    return entry;
  }

  /** Removes the drawings of a pane that no longer exists. */
  removePane(paneId: string): void {
    this.entries = this.entries.filter((entry) => entry.pane !== paneId);
  }

  /** Whether a drawing of a type is there. */
  hasType(type: string): boolean {
    return this.entries.some((entry) => entry.type === type);
  }

  snapshot(): DrawingSnapshot {
    return this.entries.map((entry) => {
      let copy = this.copies.get(entry);

      if (!copy) {
        copy = { ...entry };
        this.copies.set(entry, copy);
      }

      return copy;
    });
  }

  restore(snapshot: DrawingSnapshot): void {
    this.entries = snapshot.map((copy) => {
      const entry = { ...copy };
      this.copies.set(entry, copy);
      this.ids.note(entry.id);
      return entry;
    });
  }
}

export function checkTextValue(text: unknown): string {
  if (typeof text !== 'string') {
    return fail('drawing.text must be a string.');
  }

  return text;
}

/** Undo and redo stacks of drawing snapshots, kept while `keeps()` says so. */
export class DrawingHistory {
  private undoStack: DrawingSnapshot[] = [];
  private redoStack: DrawingSnapshot[] = [];
  /** The merge key of the change the last step holds, which a change with the same key joins. */
  private merging: string | null = null;

  constructor(private readonly keeps: () => boolean) {}

  get canUndo(): boolean {
    return this.keeps() && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.keeps() && this.redoStack.length > 0;
  }

  /**
   * Remembers the state before a change; a new change discards the redo stack. A change with the
   * merge key of the one before joins its step, which holds the state before both already.
   */
  record(before: DrawingSnapshot, merge: string | null = null): void {
    // Steps from before the history was turned off would undo what came since.
    if (!this.keeps()) {
      this.clear();
      return;
    }

    if (merge !== null && merge === this.merging) {
      return;
    }

    this.merging = merge;
    this.undoStack.push(before);

    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }

    this.redoStack = [];
  }

  undo(current: DrawingSnapshot): DrawingSnapshot | null {
    if (!this.keeps()) {
      return null;
    }

    this.merging = null;
    const previous = this.undoStack.pop();

    if (!previous) {
      return null;
    }

    this.redoStack.push(current);
    return previous;
  }

  redo(current: DrawingSnapshot): DrawingSnapshot | null {
    if (!this.keeps()) {
      return null;
    }

    this.merging = null;
    const next = this.redoStack.pop();

    if (!next) {
      return null;
    }

    this.undoStack.push(current);
    return next;
  }

  clear(): void {
    this.merging = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Drops the drawings of a removed pane from every snapshot, so undo cannot bring them back. */
  forgetPane(paneId: string): void {
    this.forget((entry) => entry.pane === paneId);
  }

  /** Drops the drawings of an unregistered type from every snapshot. */
  forgetType(type: string): void {
    this.forget((entry) => entry.type === type);
  }

  private forget(gone: (entry: DrawingEntry) => boolean): void {
    const keep = (snapshot: DrawingSnapshot) => snapshot.filter((entry) => !gone(entry));
    this.undoStack = this.undoStack.map(keep);
    this.redoStack = this.redoStack.map(keep);
  }
}

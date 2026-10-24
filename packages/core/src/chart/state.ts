import type { PriceSource, ValueSource } from '../data/types';
import type { BarTransformInput, BarTransformState } from '../feed/transform';
import type { PriceScaleMode } from '../options/types';
import type { ScaleMargins } from '../options/types';
import { MAIN_PANE_ID, PaneStore, RIGHT_SCALE } from '../panes/pane-store';
import type { PriceRange } from '../scales/price-scale';
import type { SeriesType } from '../series/styles';
import { describeValue, fail } from '../utils/errors';
import { checkArray, checkNumber, checkObject, checkString } from '../utils/validate';
import type { ChartCore } from './chart-core';
import type { ValueKind } from './values';

export interface SavedScale {
  readonly id: string;
  readonly mode: PriceScaleMode;
  readonly inverted: boolean;
  readonly margins: ScaleMargins | null;
  readonly range: PriceRange | null;
}

/**
 * The user-editable layout of a chart: main series type, view and panes, and what the modules
 * keep of theirs under their keys, such as `indicators` and `drawings`. Market data, series,
 * orders, markers and alerts belong to the application and are not included.
 */
export interface ChartState {
  readonly version: 1;
  readonly mainSeries: { readonly type: SeriesType; readonly source: PriceSource };
  /**
   * The transform building the displayed bars, such as Renko, or `null` for the bars of the
   * timeframe. `saveState()` always writes it; a state without it leaves the transform as it is.
   */
  readonly transform?: BarTransformInput | null;
  readonly view: { readonly barSpacing: number; readonly offset: number };
  readonly panes: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly height: number;
    readonly auto: boolean;
    readonly mode: PriceScaleMode;
    readonly inverted: boolean;
    /** Manual range in scale space, or `null` while auto-scaling. */
    readonly range: PriceRange | null;
    /** The right scale's margins, or `null` to follow `priceScale.margins`. */
    readonly margins?: ScaleMargins | null;
    /** The left and overlay scales. */
    readonly scales?: ReadonlyArray<SavedScale>;
  }>;
  /** What the modules keep, by their keys. */
  readonly [part: string]: unknown;
}

/** The keys of a chart state the core keeps; those of the modules' parts are others. */
export const CORE_STATE_KEYS: readonly string[] = [
  'version',
  'mainSeries',
  'transform',
  'view',
  'panes'
];

/** What a chart state brings for a module's part, checked and ready to apply. */
export interface PreparedPart {
  /** Checks sources of the kind of values this part brings, for what reads them. */
  readonly values?: {
    readonly kind: ValueKind;
    check(source: ValueSource, label: string): void;
  };
  apply(): void;
}

/** What a module keeps of a chart's layout, under its key of the chart state. */
export interface StatePart {
  readonly key: string;
  save(): unknown;
  /**
   * Checks the part of a state, `undefined` when the state has none, against the panes the state
   * brings, without changing anything.
   */
  prepare(saved: unknown, panes: PaneStore): PreparedPart;
}

export function saveState(core: ChartCore): ChartState {
  const parts = Object.fromEntries(core.stateParts.map((part) => [part.key, part.save()]));
  return structuredClone({
    version: 1,
    mainSeries: { type: core.options.mainSeries.type, source: core.options.mainSeries.source },
    transform: savedTransform(core.market.transform()),
    view: core.timeScale.state(),
    panes: core.panes.list().map((entry) => {
      const { right } = entry;
      return {
        id: entry.id,
        title: entry.title,
        height: entry.height,
        auto: entry.auto,
        mode: right.mode,
        inverted: right.invert,
        range: right.scale.manualRange(),
        margins: right.margins,
        scales: [...entry.scales.values()]
          .filter((scale) => scale.id !== RIGHT_SCALE)
          .map((scale) => ({
            id: scale.id,
            mode: scale.mode,
            inverted: scale.invert,
            margins: scale.margins,
            range: scale.scale.manualRange()
          }))
      };
    }),
    ...parts
  } satisfies ChartState);
}

/** Validates the whole state first, then applies it in one step; on error nothing changes. */
export function loadState(core: ChartCore, state: ChartState): void {
  checkObject('state', state);

  if ((state.version as unknown) !== 1) {
    fail(`Unsupported chart state: expected version 1, received ${describeValue(state.version)}.`);
  }

  for (const key of Object.keys(state)) {
    if (!CORE_STATE_KEYS.includes(key) && !core.stateParts.some((part) => part.key === key)) {
      fail(`The state has "${key}", which no module of the chart keeps.`);
    }
  }

  checkObject('state.mainSeries', state.mainSeries);
  checkArray('state.panes', state.panes);
  checkObject('state.view', state.view);
  core.seriesTypes.require(state.mainSeries.type);

  if (state.transform !== undefined && state.transform !== null) {
    core.market.checkTransform(state.transform);
  }

  const options = core.options;
  const panes = new PaneStore(options.panes.defaultHeight, options.priceScale.margins);

  if (state.panes[0]?.id !== MAIN_PANE_ID) {
    fail('The first pane of a chart state must be the main pane.');
  }

  state.panes.forEach((pane, index) => {
    checkObject(`state.panes[${index}]`, pane);
    const entry =
      index === 0
        ? panes.require(MAIN_PANE_ID)
        : panes.add(
            {
              id: checkString(`panes[${index}].id`, pane.id),
              title: pane.title,
              height: pane.height
            },
            pane.auto
          );
    panes.update(entry.id, {
      title: pane.title,
      height: checkNumber(`panes[${index}].height`, pane.height, { min: 1 })
    });
    if (pane.scales !== undefined) {
      checkArray(`panes[${index}].scales`, pane.scales);
    }

    const scales: SavedScale[] = [
      {
        id: RIGHT_SCALE,
        mode: pane.mode,
        inverted: pane.inverted,
        margins: pane.margins ?? null,
        range: pane.range
      },
      ...(pane.scales ?? [])
    ];
    scales.forEach((scale, position) => {
      const label = `panes[${index}].scales[${position}]`;
      panes.setScaleMode(entry.id, scale.id, scale.mode);
      panes.setScaleInverted(entry.id, scale.id, scale.inverted);
      panes.setScaleMargins(entry.id, scale.id, scale.margins);

      if (scale.range !== null) {
        checkObject(`${label}.range`, scale.range);
        checkNumber(`${label}.range.min`, scale.range.min);
        checkNumber(`${label}.range.max`, scale.range.max);
      }
    });
  });

  const prepared = core.stateParts.map((part) => part.prepare(state[part.key], panes));

  for (const series of core.series.list()) {
    if (!panes.get(series.pane)) {
      fail(`The state has no pane "${series.pane}", which series "${series.id}" is drawn in.`);
    }
  }

  // What reads values must still find those of the kinds the state brings anew.
  core.values.verify((source, label) => {
    prepared.find((part) => part.values?.kind === source.kind)?.values?.check(source, label);
  });

  checkNumber('view.barSpacing', state.view.barSpacing, { min: 0, exclusiveMin: true });
  checkNumber('view.offset', state.view.offset);

  // Everything is valid: apply.
  core.applyOptions({
    mainSeries: { type: state.mainSeries.type, source: state.mainSeries.source }
  });

  if (state.transform !== undefined) {
    core.setTransform(state.transform);
  }

  core.panes.adopt(panes);
  state.panes.forEach((pane) => {
    core.panes.require(pane.id).scale.restoreManualRange(pane.range);
    pane.scales?.forEach((scale) => {
      core.panes.ensureScale(pane.id, scale.id).scale.restoreManualRange(scale.range);
    });
  });
  prepared.forEach((part) => {
    part.apply();
  });
  core.timeScale.restore(state.view);
  core.values.reset();
  core.objects.prune();
  core.invalidate();
}

/** A transform as a state keeps it: without what it reports it builds with. */
function savedTransform(state: BarTransformState | null): BarTransformInput | null {
  return state && { type: state.type, params: state.params, input: state.input };
}

import type { ChartCore } from '../chart/chart-core';
import type { PreparedPart, StatePart } from '../chart/state';
import type { ValueReader } from '../chart/values';
import type { PriceSource, ValueSource } from '../data/types';
import { MAIN_PANE_ID, RIGHT_SCALE, type PaneStore } from '../panes/pane-store';
import { fail } from '../utils/errors';
import { checkArray, checkObject, checkString } from '../utils/validate';
import type { IndicatorEntry, IndicatorStore } from './indicator-store';
import { checkInputFields, checkPatchFields } from './input';
import type {
  IndicatorInput,
  IndicatorOutputStyle,
  IndicatorPatch,
  IndicatorReference,
  ParamValues
} from './types';

type IndicatorSource = Extract<ValueSource, { kind: 'indicator' }>;

/** An indicator as a chart state keeps it. */
export interface SavedIndicator {
  readonly id: string;
  readonly type: string;
  readonly params: ParamValues;
  readonly pane: string;
  /** Price scale in the pane; `right` when absent. */
  readonly scale?: string;
  readonly source: PriceSource | Readonly<IndicatorReference>;
  /** The timeframe it is computed in, such as `1h`; absent for the chart's bars. */
  readonly timeframe?: string;
  readonly visible: boolean;
  readonly colors: Readonly<Record<string, string>>;
  readonly styles?: Readonly<Record<string, IndicatorOutputStyle>>;
  /** Reference lines in place of the type's; absent for the type's. */
  readonly levels?: readonly number[];
}

/** Indicators ordered so each comes after the one it reads, as loading adds them in order. */
function upstreamFirst(entries: readonly IndicatorEntry[]): IndicatorEntry[] {
  const ordered: IndicatorEntry[] = [];
  const visit = (entry: IndicatorEntry) => {
    if (!ordered.includes(entry)) {
      if (entry.upstream) {
        visit(entry.upstream);
      }

      ordered.push(entry);
    }
  };
  entries.forEach(visit);
  return ordered;
}

/** The column of output `key` of an indicator, or its first output without a key; `-1` for none. */
function columnOf(entry: IndicatorEntry, key: string | undefined): number {
  return key === undefined ? 0 : entry.outputs.findIndex((output) => output.key === key);
}

/** Checks that `store` has the indicator and output a source reads. */
function checkSource(store: IndicatorStore, source: IndicatorSource, label: string): void {
  const entry = store.get(source.id) ?? fail(`${label}: unknown indicator "${source.id}".`);

  if (columnOf(entry, source.key) < 0) {
    fail(`${label}: indicator "${source.id}" has no output "${String(source.key)}".`);
  }
}

/** The indicators of one chart: placing them in panes, the values they give, their state. */
export class ChartIndicators {
  constructor(
    private readonly core: ChartCore,
    readonly store: IndicatorStore
  ) {}

  add(input: IndicatorInput): string {
    const { core, store } = this;
    const { entry, own } = this.place(store, input);

    if (own) {
      store.move(entry.id, core.createAutoPane(entry.id));
    }

    core.invalidate();
    return entry.id;
  }

  /**
   * Replaces every indicator with those `inputs` bring, in their order, once all are valid and
   * what reads indicators, such as an alert, finds those it reads among them.
   */
  set(inputs: readonly IndicatorInput[]): void {
    const { core, store } = this;
    checkArray('indicators', inputs);
    const staging = store.staging(inputs);
    const own = inputs.flatMap((input) => {
      const placed = this.place(staging, input);
      return placed.own ? [placed.entry.id] : [];
    });
    core.values.verify((source, label) => {
      if (source.kind === 'indicator') {
        checkSource(staging, source, label);
      }
    });
    const panes = store.list().map((entry) => entry.pane);
    store.adopt(staging);
    // The panes left empty go first, so that an indicator getting a pane of its own may take the
    // id of one gone.
    panes.forEach((pane) => {
      core.releasePane(pane);
    });
    own.forEach((id) => {
      store.move(id, core.createAutoPane(id));
    });
    core.values.reset();
    core.invalidate();
  }

  /**
   * Puts an indicator into `store`: into the pane it names, or into the main pane when it is to
   * get a pane of its own, which the chart creates once it holds the indicator.
   */
  private place(
    store: IndicatorStore,
    input: IndicatorInput
  ): { readonly entry: IndicatorEntry; readonly own: boolean } {
    checkInputFields(input);
    const requested = input.pane ?? store.defaultPane(input.type, input.source);

    if (requested !== 'new') {
      this.core.panes.require(requested);
    }

    // An indicator getting a pane of its own is added to the main pane and moved, on the right
    // scale unless it names one: the scale of the indicator it reads is in another pane.
    const own = requested === 'new';
    const entry = own
      ? store.add(
          input.scale === undefined ? { ...input, scale: RIGHT_SCALE } : input,
          MAIN_PANE_ID
        )
      : store.add(input, requested);
    return { entry, own };
  }

  remove(id: string): void {
    this.core.values.assertUnused('indicator', id);
    const entry = this.store.remove(id);
    this.core.releasePane(entry.pane);
    this.core.invalidate();
  }

  /** Updates an indicator unless that would remove an output something reads. */
  update(id: string, patch: IndicatorPatch): void {
    const { core, store } = this;
    checkPatchFields(patch);
    const from = store.require(id).pane;
    const to = patch.pane === undefined ? from : checkString('patch.pane', patch.pane);

    if (to !== 'new') {
      core.panes.require(to);
    }

    // A pane of its own shows the indicator on the right scale, as `add()` does.
    const changes =
      to === 'new' && patch.scale === undefined ? { ...patch, scale: RIGHT_SCALE } : patch;
    store.update(id, changes, (keys) => {
      const missing = core.values
        .uses('indicator', id)
        .flatMap(({ user, noun, source }) =>
          source.kind === 'indicator' && source.key !== undefined && !keys.includes(source.key)
            ? [`"${source.key}" (read by ${noun} "${user}")`]
            : []
        );

      if (missing.length > 0) {
        fail(`Indicator "${id}" would no longer produce ${missing.join(', ')}.`);
      }
    });

    if (to !== from) {
      store.move(id, to === 'new' ? core.createAutoPane(id) : to);
      core.releasePane(from);
    }

    if (patch.params !== undefined || patch.source !== undefined || patch.timeframe !== undefined) {
      core.values.reset();
    }

    core.invalidate();
  }

  /** The values of the outputs, for alerts and `mainSeries.barColor`. */
  values(): ValueReader<IndicatorSource> {
    const { store } = this;
    return {
      check: (source, label) => {
        checkSource(store, source, label);
      },
      read: (source, index) => {
        const entry = store.require(source.id);
        entry.series.sync();
        return entry.series.drawn(columnOf(entry, source.key), index);
      },
      paneOf: (source) => store.require(source.id).pane,
      scaleOf: (source) => store.require(source.id).scale
    };
  }

  /** What a chart state keeps of the indicators, under `indicators`. */
  state(): StatePart {
    const { store } = this;
    return {
      key: 'indicators',
      save: () =>
        upstreamFirst(store.list()).map((entry): SavedIndicator => {
          const info = store.info(entry);
          return {
            id: info.id,
            type: info.type,
            params: info.params,
            pane: info.pane,
            scale: info.scale,
            source: info.source,
            ...(info.timeframe === null ? {} : { timeframe: info.timeframe }),
            visible: info.visible,
            colors: info.colors,
            styles: info.styles,
            ...(info.levels === null ? {} : { levels: info.levels })
          };
        }),
      prepare: (saved, panes) => this.prepare(saved, panes)
    };
  }

  private prepare(saved: unknown, panes: PaneStore): PreparedPart {
    const indicators = (saved ?? []) as readonly SavedIndicator[];
    checkArray('state.indicators', indicators);
    const staging = this.store.staging(indicators);

    indicators.forEach((indicator, index) => {
      checkObject(`state.indicators[${index}]`, indicator);
      panes.require(indicator.pane);
      staging.add(
        {
          id: indicator.id,
          type: indicator.type,
          params: indicator.params,
          source: indicator.source,
          ...(indicator.timeframe !== undefined ? { timeframe: indicator.timeframe } : {}),
          ...(indicator.scale !== undefined ? { scale: indicator.scale } : {}),
          visible: indicator.visible,
          colors: { ...indicator.colors },
          ...(indicator.styles !== undefined ? { styles: structuredClone(indicator.styles) } : {}),
          ...(indicator.levels !== undefined ? { levels: [...indicator.levels] } : {})
        },
        indicator.pane
      );
    });

    return {
      values: {
        kind: 'indicator',
        check: (source, label) => {
          checkSource(staging, source as IndicatorSource, label);
        }
      },
      apply: () => {
        this.store.adopt(staging);
      }
    };
  }
}

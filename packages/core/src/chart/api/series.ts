import type { TradeInput } from '../../data/types';
import { MAIN_PANE_ID } from '../../panes/pane-store';
import {
  checkSeriesFields,
  type Series,
  type SeriesEntry,
  type SeriesInput,
  type SeriesPatch,
  type SeriesPointInput,
  type SeriesStore
} from '../../series/series-store';
import type { SeriesTypeDefinition } from '../../series/types';
import { fail } from '../../utils/errors';
import { checkArray, checkObject, checkOneOf, checkString } from '../../utils/validate';
import type { ChartCore } from '../chart-core';

/** Additional series aligned to the main bars by time, such as comparison symbols. */
export interface SeriesApi {
  /**
   * Replaces every series, with the points each brings. What reads a series, such as an alert,
   * must find it among them. An invalid input throws and changes nothing.
   */
  set(series: readonly SeriesInput[]): void;
  /** Adds a series and returns its id: the one it has, or one the chart numbers for it. */
  add(series: SeriesInput): string;
  /** Throws for an unknown id. */
  update(id: string, patch: SeriesPatch): void;
  /** Throws for an unknown id, and while something, such as an alert, reads the series. */
  remove(id: string): void;
  /** Removes every series; throws while something, such as an alert, reads one. */
  clear(): void;
  /** The series of an id, or `null`. */
  get(id: string): Series | null;
  list(): Series[];
  setData(id: string, points: readonly SeriesPointInput[]): void;
  /** Replaces the last point or appends newer points. */
  updateData(id: string, point: SeriesPointInput | readonly SeriesPointInput[]): void;
  prependData(id: string, points: readonly SeriesPointInput[]): void;
  /**
   * Folds trades into a series, such as a symbol compared, as `data.addTrades()` folds them into
   * the main bars: its bars of the source interval take them, or, for a series of values, a value
   * per source interval takes the price of its last trade; shown in the chart's timeframe.
   * Returns how many it kept: not those outside the sessions, nor late ones.
   */
  addTrades(id: string, trades: TradeInput | readonly TradeInput[]): number;
  /** Adds a series type to this chart, named by its `type`, for series and the main series. */
  register<Style extends object>(definition: SeriesTypeDefinition<Style>): void;
  /**
   * Removes a series type. Fails for the types of every chart, while the main series is of it and
   * while series of it are on the chart.
   */
  unregister(type: string): void;
  /** Every series type the chart has. */
  types(): string[];
  /** The definition of a type, or `null` for an unknown type. */
  definition(type: string): Readonly<SeriesTypeDefinition<object>> | null;
}

/** Checks a series type definition before it joins a chart. */
export function validateSeriesDefinition(definition: SeriesTypeDefinition<object>): void {
  checkObject('series type definition', definition);
  checkString('series type definition type', definition.type);
  checkOneOf('definition.input', definition.input, ['ohlc', 'value']);

  if (typeof definition.defaultStyle !== 'function' || typeof definition.paint !== 'function') {
    fail('A series type definition needs defaultStyle() and paint() functions.');
  }
}

/**
 * Puts a series into `store`: into the pane it names, or into the main pane when it is to get a
 * pane of its own, which the chart creates once it holds the series.
 */
function place(
  core: ChartCore,
  store: SeriesStore,
  input: SeriesInput
): { readonly entry: SeriesEntry; readonly own: boolean } {
  checkSeriesFields(input);
  const requested = input.pane ?? MAIN_PANE_ID;

  if (requested !== 'new') {
    core.panes.require(requested);
  }

  const own = requested === 'new';
  return { entry: store.add(input, own ? MAIN_PANE_ID : requested), own };
}

export function createSeriesApi(core: ChartCore): SeriesApi {
  const set = (inputs: readonly SeriesInput[]) => {
    core.run(() => {
      checkArray('series', inputs);
      const staging = core.series.staging(inputs);
      const own = inputs.flatMap((input) => {
        const placed = place(core, staging, input);
        return placed.own ? [placed.entry.id] : [];
      });
      core.values.verify((source, label) => {
        if (source.kind === 'series' && !staging.get(source.id)) {
          fail(`${label}: unknown series "${source.id}".`);
        }
      });
      const panes = core.series.list().map((entry) => entry.pane);
      core.series.adopt(staging);
      // The panes left empty go first, so that a series getting a pane of its own may take the id
      // of one gone.
      panes.forEach((pane) => {
        core.releasePane(pane);
      });
      own.forEach((id) => {
        core.series.move(id, core.createAutoPane(id));
      });
      core.values.reset();
      core.invalidate();
    });
  };
  const write = (
    id: string,
    mode: 'set' | 'update' | 'prepend',
    points: readonly SeriesPointInput[]
  ) => {
    core.run(() => {
      core.series.write(core.series.require(id), mode, points);

      // Replacing or extending a series' history is not a live move of its value.
      if (mode !== 'update') {
        core.values.reset();
      }

      core.invalidate();
    });
  };

  return {
    set,
    add: (series) =>
      core.run(() => {
        const { entry, own } = place(core, core.series, series);

        if (own) {
          core.series.move(entry.id, core.createAutoPane(entry.id));
        }

        core.invalidate();
        return entry.id;
      }),
    update: (id, patch) => {
      core.run(() => {
        core.series.update(id, patch);
        core.invalidate();
      });
    },
    remove: (id) => {
      core.run(() => {
        core.values.assertUnused('series', id);
        const entry = core.series.remove(id);
        core.releasePane(entry.pane);
        core.invalidate();
      });
    },
    clear: () => {
      set([]);
    },
    get: (id) => {
      const entry = core.series.get(id);
      return entry ? core.series.info(entry) : null;
    },
    list: () => core.series.list().map((entry) => core.series.info(entry)),
    setData: (id, points) => {
      write(id, 'set', points);
    },
    updateData: (id, point) => {
      write(id, 'update', Array.isArray(point) ? point : [point as SeriesPointInput]);
    },
    prependData: (id, points) => {
      write(id, 'prepend', points);
    },
    addTrades: (id, trades) =>
      core.run(() => {
        const kept = core.market.addSeriesTrades(
          core.series.require(id),
          Array.isArray(trades) ? trades : [trades as TradeInput]
        );
        core.invalidate();
        return kept;
      }),
    register: (definition) => {
      core.run(() => {
        validateSeriesDefinition(definition);
        core.seriesTypes.register(definition);
        core.bus.emit('typesChange', { kind: 'series', type: definition.type, registered: true });
      });
    },
    unregister: (type) => {
      core.run(() => {
        core.seriesTypes.require(type);

        if (core.options.mainSeries.type === type) {
          fail(`The main series is of type "${type}"; change it first.`);
        }

        const used = core.series.list().filter((entry) => entry.type === type);

        if (used.length > 0) {
          fail(
            `The series ${used.map((entry) => `"${entry.id}"`).join(', ')} are of type "${type}"; remove them first.`
          );
        }

        core.seriesTypes.unregister(type);
        core.bus.emit('typesChange', { kind: 'series', type, registered: false });
      });
    },
    types: () => core.seriesTypes.types(),
    definition: (type) => core.seriesTypes.get(type) ?? null
  };
}

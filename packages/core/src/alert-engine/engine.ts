import type { DataApi, DataSetOptions } from '../chart/api/data';
import { MarketData } from '../chart/market-data';
import { Values } from '../chart/values';
import { BarStore } from '../data/bar-store';
import { toTime } from '../data/time';
import type { BarChange, BarInput, TradeInput } from '../data/types';
import { DrawingStore } from '../drawings/drawing-store';
import type { DrawingsApi } from '../drawings/api';
import { levelContext, LINEAR_SCALE } from '../drawings/levels';
import { DRAWING_OPTIONS } from '../drawings/options';
import { resolveStyle } from '../drawings/style';
import type { DrawingTypeDefinition } from '../drawings/types';
import { drawingValues } from '../drawings/values';
import type { CalendarInput } from '../feed/calendar';
import { IndicatorBases } from '../indicators/basis';
import { validateDefinition } from '../indicators/definition';
import { IndicatorStore } from '../indicators/indicator-store';
import { checkInputFields } from '../indicators/input';
import type { IndicatorsApi } from '../indicators/api';
import type { IndicatorDefinition, IndicatorInput } from '../indicators/types';
import { indicatorValues } from '../indicators/values';
import { createDefaultOptions } from '../options/defaults';
import { resolveOptions } from '../options/resolve';
import type { ChartOptions } from '../options/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { SeriesStore } from '../series/series-store';
import { fail } from '../utils/errors';
import { Registry } from '../utils/registry';
import { checkArray, checkFields, checkObject, checkOneOf, fieldsOf } from '../utils/validate';
import { AlertBook } from '../alerts/alert-book';
import type { AlertsApi } from '../alerts/module';
import type { AlertTriggerEvent } from '../alerts/types';

/** Options of {@link createAlertEngine}. */
export interface AlertEngineOptions {
  /**
   * The indicator types its alerts may read, as the indicators module takes them, such as
   * `allIndicators`; `indicators.register()` adds others. Default: none.
   */
  readonly indicators?: readonly IndicatorDefinition[];
  /**
   * The drawing types whose lines its alerts may watch, as the drawings module takes them, such
   * as `allDrawings`. Default: none.
   */
  readonly drawings?: readonly DrawingTypeDefinition[];
  /**
   * The trading calendar timeframes are built and trades folded with, as the chart's `calendar`
   * option. Default: around the clock, in UTC.
   */
  readonly calendar?: CalendarInput;
}

/** The value of an output of an indicator at a bar, `null` where it has none. */
export interface IndicatorOutputValue {
  readonly key: string;
  readonly value: number | null;
}

/** What an engine computes alerts on: indicators as a chart has them, without drawing them. */
export interface AlertEngineIndicators extends Pick<
  IndicatorsApi,
  'add' | 'remove' | 'get' | 'list' | 'register' | 'definition'
> {
  /** The values of an indicator's outputs at displayed bar `index`; default, the latest bar. */
  valuesAt(id: string, index?: number): IndicatorOutputValue[];
}

export interface AlertEngineEventMap {
  alertTrigger: AlertTriggerEvent;
}

/**
 * Alerts evaluated without a chart, as a chart with the same bars, timeframe, indicators and
 * drawings evaluates them: on a server, in a worker, or in a page for symbols no chart shows. Its
 * `data`, `indicators`, `drawings` and `alerts` work as a chart's, but for what only drawing
 * needs; an alert's event is never of a replay.
 */
export interface AlertEngine {
  readonly data: Omit<DataApi, 'clear'>;
  readonly indicators: AlertEngineIndicators;
  readonly drawings: Pick<
    DrawingsApi,
    'set' | 'add' | 'remove' | 'get' | 'list' | 'validate' | 'levels'
  >;
  readonly alerts: Omit<AlertsApi, 'clear'>;
  /** Changes the trading calendar, as `chart.applyOptions({ calendar })` does. */
  setCalendar(calendar: CalendarInput): void;
  /** Listens to an event; returns the function that stops listening. */
  on<K extends keyof AlertEngineEventMap>(
    event: K,
    listener: (event: AlertEngineEventMap[K]) => void
  ): () => void;
  /** Stops reporting and lets the engine go. */
  destroy(): void;
}

const EVENTS = ['alertTrigger'] as const satisfies ReadonlyArray<keyof AlertEngineEventMap>;

const OPTION_FIELDS = fieldsOf<AlertEngineOptions>({
  indicators: true,
  drawings: true,
  calendar: true
});

/**
 * Evaluates alerts without a chart: give it the bars of a symbol at their source interval, the
 * timeframe they are to be built to, the indicators and drawings its alerts read, and the alerts,
 * and it reports each that fires, as a chart with the same would. Runs anywhere, Node included.
 *
 * ```ts
 * const engine = createAlertEngine({ indicators: [RSI] });
 * engine.data.set(bars, { interval: '1m' });
 * engine.data.setTimeframe('15m');
 * engine.indicators.add({ id: 'rsi', type: 'RSI' });
 * engine.alerts.add({ source: { kind: 'indicator', id: 'rsi' }, trigger: 'cross-up', value: 70 });
 * engine.on('alertTrigger', (event) => notify(event));
 * stream.onTrade((trade) => engine.data.addTrades(trade));
 * ```
 */
export function createAlertEngine(options: AlertEngineOptions = {}): AlertEngine {
  checkObject('createAlertEngine() options', options);
  checkFields('createAlertEngine() options', options, OPTION_FIELDS);
  const indicatorTypes = new Registry<IndicatorDefinition>(
    'indicator type',
    [],
    'Give it to createAlertEngine({ indicators }), or register it with indicators.register().'
  );
  (options.indicators ?? []).forEach((definition) => {
    indicatorTypes.register(definition);
  });
  const drawingTypes = new Registry<DrawingTypeDefinition>(
    'drawing type',
    [],
    'Give it to createAlertEngine({ drawings }).'
  );
  (options.drawings ?? []).forEach((definition) => {
    drawingTypes.register(definition);
  });

  const sections = [DRAWING_OPTIONS];
  const optionsOf = (calendar: CalendarInput | undefined): ChartOptions =>
    resolveOptions(
      createDefaultOptions(sections),
      calendar === undefined ? undefined : { calendar },
      sections
    );
  let chartOptions = optionsOf(options.calendar);
  const bars = new BarStore();
  // Series compared with the bars are a chart's: an engine has none.
  const series = new SeriesStore(new Registry('series type', []), () => chartOptions.theme);
  const values = new Values(bars, series);
  const market = new MarketData(bars, series, chartOptions);
  const indicators = new IndicatorStore(new IndicatorBases(market, bars), indicatorTypes);
  const drawings = new DrawingStore(drawingTypes);
  const listeners = new Set<(event: AlertTriggerEvent) => void>();
  let destroyed = false;
  const book = new AlertBook({
    bars,
    reader: values,
    settled: () => market.settled(),
    triggered: (event) => {
      if (destroyed) {
        return;
      }

      for (const listener of [...listeners]) {
        listener({ ...event, replay: false });
      }
    }
  });
  values.provide('indicator', indicatorValues(indicators));
  values.provide(
    'drawing',
    drawingValues({ bars, options: () => chartOptions, scaleOf: () => LINEAR_SCALE }, drawings)
  );
  values.use({
    noun: 'alert',
    uses: (kind, id) => book.uses(kind, id),
    reset: () => {
      book.rebaseline();
    },
    verify: (check) => {
      book.verify(check);
    }
  });
  const paneExists = (id: string) => id === MAIN_PANE_ID;

  /** Runs a data operation and evaluates the alerts on the bars it changed, as a chart does. */
  const changeData = <T>(prepend: boolean, operation: () => T): T => {
    const revision = bars.revision;
    const result = operation();
    const change: BarChange | null = bars.changesSince(revision);

    if (change) {
      book.evaluate(prepend ? { kind: 'reset' } : change);
    }

    return result;
  };

  return {
    data: {
      set: (input, setOptions: DataSetOptions = {}) => {
        checkFields('data.set() options', setOptions, ['interval']);
        changeData(false, () => {
          market.set(input, setOptions.interval);
        });
      },
      update: (bar) => {
        changeData(false, () => {
          market.update(Array.isArray(bar) ? bar : [bar as BarInput]);
        });
      },
      addTrades: (trade) =>
        changeData(false, () =>
          market.addTrades(Array.isArray(trade) ? trade : [trade as TradeInput])
        ),
      prepend: (input) => changeData(true, () => market.prepend(input)),
      sourceInterval: () => market.sourceInterval(),
      calendar: () => market.tradingCalendar(),
      timeframe: () => market.timeframe(),
      setTimeframe: (timeframe) => {
        changeData(false, () => {
          market.setTimeframe(timeframe);
        });
      },
      get length() {
        return bars.length;
      },
      bars: market.displayed,
      source: market.revealed,
      at: (index) => bars.bar(index),
      last: () => bars.bar(bars.length - 1),
      indexOf: (time) => bars.indexOf(toTime(time)),
      toArray: () => bars.toArray()
    },

    indicators: {
      add: (input: IndicatorInput) => {
        checkInputFields(input);
        return indicators.add(input, MAIN_PANE_ID).id;
      },
      remove: (id) => {
        values.assertUnused('indicator', id);
        indicators.remove(id);
      },
      get: (id) => {
        const entry = indicators.get(id);
        return entry ? indicators.info(entry) : null;
      },
      list: () => indicators.list().map((entry) => indicators.info(entry)),
      register: (definition) => {
        validateDefinition(definition);
        indicatorTypes.register(definition);
      },
      definition: (type) => indicatorTypes.get(type) ?? null,
      valuesAt: (id, index = bars.length - 1) => {
        const entry = indicators.require(id);
        entry.series.sync();
        return entry.outputs.map((output, column) => {
          const value = entry.series.drawn(column, index);
          return { key: output.key, value: Number.isNaN(value) ? null : value };
        });
      }
    },

    drawings: {
      set: (inputs) => {
        checkArray('drawings', inputs);
        const staging = drawings.staging(inputs);
        inputs.forEach((input) => {
          staging.add(staging.create(input, paneExists));
        });
        drawings.restore(staging.snapshot());
      },
      add: (input) => {
        const entry = drawings.create(input, paneExists);
        drawings.add(entry);
        return entry.id;
      },
      remove: (id) => {
        drawings.remove(id);
      },
      get: (id) => {
        const entry = drawings.get(id);
        return entry ? drawings.info(entry) : null;
      },
      list: () => drawings.list().map((entry) => drawings.info(entry)),
      validate: (input) => {
        new DrawingStore(drawingTypes).create(input, paneExists);
      },
      levels: (id) => {
        const entry = drawings.get(id) ?? fail(`Unknown drawing "${id}".`);
        const style = resolveStyle(chartOptions, entry.definition, entry.style);
        return (
          entry.definition.levels?.(entry.points, LINEAR_SCALE, style, levelContext(bars, bars)) ??
          []
        ).map((level) => level.key);
      }
    },

    alerts: {
      set: (inputs) => {
        book.set(inputs);
      },
      add: (input) => book.add(input),
      update: (id, patch) => {
        book.update(id, patch);
      },
      remove: (id) => {
        book.remove(id);
      },
      get: (id) => book.get(id),
      list: () => book.list(),
      rearm: (id) => {
        book.rearm(id);
      }
    },

    setCalendar: (calendar) => {
      const next = optionsOf(calendar);
      const before = market.tradingCalendar();
      const rebucketed = changeData(true, () => market.configure(next));
      chartOptions = next;

      // The same bars, but indicators that follow the calendar, such as VWAP, change.
      if (!rebucketed && market.tradingCalendar() !== before) {
        values.reset();
      }
    },

    on: (event, listener) => {
      checkOneOf('event', event, EVENTS);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy: () => {
      destroyed = true;
      listeners.clear();
    }
  };
}

import { toTime, type TimeInput } from '../../data/time';
import type { Bar, BarInput, BarsView, TradeInput } from '../../data/types';
import type { Calendar } from '../../feed/calendar';
import type { Interval, IntervalInput } from '../../feed/interval';
import { checkFields, fieldsOf } from '../../utils/validate';
import type { ChartCore } from '../chart-core';

export interface DataSetOptions {
  /**
   * Resolution of the bars, such as `'1m'`. Declaring it lets the chart build coarser
   * timeframes and fold trades into bars through the trading calendar. Bars of minutes and hours
   * must start where the calendar starts one, or they throw; bars of days, weeks and months go by
   * their trading date. Without it the bars are displayed as given.
   */
  interval?: IntervalInput;
}

/**
 * The main OHLCV series. Writes go to the **source** data; reads return the **displayed** bars,
 * aggregated to the timeframe and clipped by a running replay. Inputs are validated and copied;
 * the chart never mutates them.
 */
export interface DataApi {
  /** Replaces the source bars. Bars must be sorted by strictly ascending time. */
  set(bars: readonly BarInput[], options?: DataSetOptions): void;
  /**
   * Streams source bars: a bar with the time of the last bar replaces it, newer bars are
   * appended. Older bars are rejected; use `set()` or `prepend()` for history.
   */
  update(bar: BarInput | readonly BarInput[]): void;
  /**
   * Streams trades, folded into the source bars: a trade in the last bar's period updates it,
   * a later one opens a new bar. Needs a source interval. Trades the calendar drops (outside the
   * sessions) are skipped, and so are late ones, before the last bar or the latest trade, as a
   * stream may deliver after it reconnects; returns how many were applied.
   */
  addTrades(trade: TradeInput | readonly TradeInput[]): number;
  /**
   * Adds older source bars before the first one, typically in response to `loadMore`. Bars at or
   * after the current first bar are ignored. Returns how many bars were inserted.
   */
  prepend(bars: readonly BarInput[]): number;
  /** Removes the bars and ends a running replay; the source interval and timeframe stay. */
  clear(): void;
  /** Resolution of the source bars, or `null` when they are displayed as given. */
  sourceInterval(): Interval | null;
  /**
   * The trading calendar the chart builds timeframes with: the `calendar` option, in the chart's
   * `timeZone` unless it names one. A new one once the options change; read it when needed.
   */
  calendar(): Calendar;
  /** The displayed timeframe, or `null` for the source resolution. */
  timeframe(): Interval | null;
  /**
   * Displays the source bars aggregated to a coarser timeframe, or at the source resolution with
   * `null`. Needs a source interval; the timeframe must be built from whole source bars.
   */
  setTimeframe(timeframe: IntervalInput | null): void;
  /** Number of displayed bars. */
  readonly length: number;
  /** The displayed bars as a read-only, columnar view, without copying. */
  readonly bars: BarsView;
  /** The source bars as a view: up to the cursor while replaying, at the source interval. */
  readonly source: BarsView;
  at(index: number): Bar | null;
  last(): Bar | null;
  /** Index of the displayed bar with exactly this time, or `-1`. */
  indexOf(time: TimeInput): number;
  toArray(): Bar[];
}

const SET_FIELDS = fieldsOf<DataSetOptions>({ interval: true });

export function createDataApi(core: ChartCore): DataApi {
  return {
    set: (bars, options = {}) => {
      checkFields('data.set() options', options, SET_FIELDS);
      core.run(() => {
        core.setData(bars, options.interval);
      });
    },
    update: (bar) => {
      core.run(() => {
        core.updateData(Array.isArray(bar) ? bar : [bar as BarInput]);
      });
    },
    addTrades: (trade) =>
      core.run(() => core.addTrades(Array.isArray(trade) ? trade : [trade as TradeInput])),
    prepend: (bars) => core.run(() => core.prependData(bars)),
    clear: () => {
      core.run(() => {
        core.clearData();
      });
    },
    sourceInterval: () => core.market.sourceInterval(),
    calendar: () => core.market.tradingCalendar(),
    timeframe: () => core.market.timeframe(),
    setTimeframe: (timeframe) => {
      core.run(() => {
        core.setTimeframe(timeframe);
      });
    },
    get length() {
      return core.bars.length;
    },
    bars: core.market.displayed,
    source: core.market.revealed,
    at: (index) => core.bars.bar(index),
    last: () => core.bars.bar(core.bars.length - 1),
    indexOf: (time) => core.bars.indexOf(toTime(time)),
    toArray: () => core.bars.toArray()
  };
}

import type { TimeInput } from './time';

/** A candlestick as accepted by the data APIs. */
export interface BarInput {
  time: TimeInput;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Defaults to `0`. */
  volume?: number;
}

/** A normalized candlestick. `time` is epoch milliseconds. */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Read-only, columnar access to bars, for plugins and custom drawings. Accessors take an index
 * from `0` to `length - 1`.
 */
export interface BarsView {
  readonly length: number;
  /** Changes whenever the bars change; key caches by it. */
  readonly revision: number;
  time(index: number): number;
  open(index: number): number;
  high(index: number): number;
  low(index: number): number;
  close(index: number): number;
  volume(index: number): number;
  /** The bar at `index`, or `null` outside the bars. */
  bar(index: number): Bar | null;
  /** First index whose time is at or after `time`, or `length` when every bar is earlier. */
  lowerBound(time: number): number;
}

/** A point of a value series. */
export interface ValuePointInput {
  time: TimeInput;
  /** `null` leaves a gap. */
  value: number | null;
}

/** A normalized value point. `time` is epoch milliseconds; `NaN` marks a gap. */
export interface ValuePoint {
  readonly time: number;
  readonly value: number;
}

/** A single trade (tick) folded into the source bars by `data.addTrades()`. */
export interface TradeInput {
  time: TimeInput;
  price: number;
  /** Traded quantity added to the bar's volume. Defaults to `0`. */
  size?: number;
  /**
   * The side of the taker: `buy` for a trade that took an offer, `sell` for one that took a bid;
   * unknown when left out. Transforms built from the trades receive it.
   */
  side?: TradeSide;
}

/** The side of the taker of a trade. */
export type TradeSide = 'buy' | 'sell';

/** The prices a bar gives, in the order forms list them. */
export const PRICE_SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'] as const;

/** Price fields a line-like series or an indicator can read from a bar. */
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** A value at each bar, which alerts watch and `mainSeries.barColor` reads. */
export type ValueSource =
  | { readonly kind: 'price'; readonly field?: PriceSource }
  /** An output of an indicator; `key` defaults to its first output. */
  | { readonly kind: 'indicator'; readonly id: string; readonly key?: string }
  | { readonly kind: 'series'; readonly id: string }
  /** A line of a drawing at each bar, e.g. a trend line; `level` defaults to its first line. */
  | { readonly kind: 'drawing'; readonly id: string; readonly level?: string };

/** Reads value sources at the displayed bars. */
export interface ValueAccess {
  /** Throws for a source that names nothing, such as an unknown indicator or output. */
  check(source: ValueSource, label: string): void;
  /** The value at bar `index`; `NaN` where it has none. */
  read(source: ValueSource, index: number): number;
}

/** How the bars changed since a revision a consumer has seen. */
export type BarChange =
  /** Every index may have changed (set, prepend or clear). */
  | { readonly kind: 'reset' }
  /** Only bars from `from` (inclusive) to the end changed or were appended. */
  | { readonly kind: 'tail'; readonly from: number };

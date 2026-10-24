import { describeValue, fail } from '../utils/errors';
import { checkObject, checkOneOf } from '../utils/validate';
import { ChangeLog } from './change-log';
import { toTime } from './time';
import type { Bar, BarChange, BarsView, TradeInput, TradeSide } from './types';

/** A normalized trade. `time` is epoch milliseconds. */
export interface Trade {
  readonly time: number;
  readonly price: number;
  readonly size: number;
  /** The side of the taker, `null` when unknown. */
  readonly side: TradeSide | null;
}

/** Sides as the log keeps them. */
const SIDE_CODES = { buy: 1, sell: -1 } as const;

/** Validates and normalizes trades. */
export function parseTrades(inputs: readonly TradeInput[], label = 'trades'): Trade[] {
  return inputs.map((input, index) => {
    const path = `${label}[${index}]`;
    checkObject(path, input);
    const time = toTime(input.time, `${path}.time`);
    const size = input.size ?? 0;

    if (typeof input.price !== 'number' || !Number.isFinite(input.price)) {
      fail(`${path}.price must be a finite number, received ${describeValue(input.price)}.`);
    }

    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
      fail(`${path}.size must be a finite number of at least 0, received ${describeValue(size)}.`);
    }

    const side =
      input.side === undefined ? null : checkOneOf(`${path}.side`, input.side, ['buy', 'sell']);

    return { time, price: input.price, size, side };
  });
}

/** Adds a trade to the bar of its bucket. */
export function foldTrade(bar: Bar, trade: Trade): Bar {
  return {
    time: bar.time,
    open: bar.open,
    high: Math.max(bar.high, trade.price),
    low: Math.min(bar.low, trade.price),
    close: trade.price,
    volume: bar.volume + trade.size
  };
}

/** Trades folded into bars, as {@link foldTrades} gives them. */
export interface FoldedTrades {
  /** The bars written: the last bar with the trades in it, and those the trades opened after. */
  readonly bars: readonly Bar[];
  /** The trades kept. */
  readonly kept: readonly Trade[];
  /** The time of the bar each kept trade went into. */
  readonly barTimes: readonly number[];
  /** The time of the latest trade kept, or `latest` without one. */
  readonly latest: number;
}

/**
 * Folds trades into the bars of `bucketOf` after `last`, the latest bar, whose bar of the calendar
 * `barOf` gives, as a day may be dated at another time than its start. Trades outside the buckets
 * are not kept, nor late ones, older than the `latest` trade or than the last bar, as a stream may
 * deliver them after it reconnects.
 */
export function foldTrades(
  trades: readonly Trade[],
  last: Bar | null,
  latest: number,
  bucketOf: (time: number) => number | null,
  barOf: (time: number) => number | null
): FoldedTrades {
  let bar = last;
  let lastBucket = (bar && barOf(bar.time)) ?? Number.NEGATIVE_INFINITY;
  let newest = latest;
  const bars: Bar[] = [];
  const kept: Trade[] = [];
  const barTimes: number[] = [];

  trades.forEach((trade) => {
    const bucket = bucketOf(trade.time);

    if (bucket === null || trade.time < newest || bucket < lastBucket) {
      return;
    }

    const next = bar && bucket === lastBucket ? foldTrade(bar, trade) : openBar(bucket, trade);

    if (bars.length > 0 && bars[bars.length - 1]?.time === next.time) {
      bars[bars.length - 1] = next;
    } else {
      bars.push(next);
    }

    bar = next;
    lastBucket = bucket;
    newest = trade.time;
    kept.push(trade);
    barTimes.push(bucket);
  });

  return { bars, kept, barTimes, latest: newest };
}

/** The bar a trade opens in the bucket starting at `time`. */
export function openBar(time: number, trade: Trade): Bar {
  return {
    time,
    open: trade.price,
    high: trade.price,
    low: trade.price,
    close: trade.price,
    volume: trade.size
  };
}

/**
 * The latest trades folded into the source bars, for bar types built from trades such as tick
 * bars. It keeps up to `capacity` of them, the oldest going first; positions count every trade
 * since the log was last cleared, so a reader that has read up to a position reads on from there
 * while older trades go. A trade is revealed while the time of the source bar it was folded into
 * is at or before the cutoff (replay).
 */
export class TradeLog {
  private times = new Float64Array(0);
  private prices = new Float64Array(0);
  private sizes = new Float64Array(0);
  /** The side of each trade's taker: 1 buy, -1 sell, 0 unknown. */
  private sides = new Int8Array(0);
  /** The time of the source bar each trade was folded into. */
  private barTimes = new Float64Array(0);
  /** Position of the oldest trade kept. */
  private oldest = 0;
  /** Position after the newest trade. */
  private total = 0;
  /** Position after the last revealed trade. */
  private revealed = 0;
  private cutoff = Number.POSITIVE_INFINITY;
  private readonly changes = new ChangeLog();

  constructor(private capacity: number) {}

  get revision(): number {
    return this.changes.revision;
  }

  /** Position of the oldest trade kept. */
  get first(): number {
    return this.oldest;
  }

  /** Position after the last revealed trade. */
  get end(): number {
    return this.revealed;
  }

  /** Time of the trade at a kept position. Callers guarantee `first <= position < end`. */
  time(position: number): number {
    return this.times[position % this.capacity] ?? Number.NaN;
  }

  price(position: number): number {
    return this.prices[position % this.capacity] ?? Number.NaN;
  }

  size(position: number): number {
    return this.sizes[position % this.capacity] ?? Number.NaN;
  }

  /** The side of the taker of the trade at a kept position, `null` when unknown. */
  side(position: number): TradeSide | null {
    const code = this.sides[position % this.capacity];
    return code === 1 ? 'buy' : code === -1 ? 'sell' : null;
  }

  /** The trade at a kept position as a bar: open, high, low and close at its price. */
  bar(position: number): Bar {
    const price = this.price(position);
    return {
      time: this.time(position),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: this.size(position)
    };
  }

  /** Adds trades folded into the source bars of `barTimes`, which never decrease. */
  append(trades: readonly Trade[], barTimes: readonly number[]): void {
    if (this.capacity === 0) {
      return;
    }

    this.reserve(this.total + trades.length);

    trades.forEach((trade, index) => {
      const slot = this.total % this.capacity;
      this.times[slot] = trade.time;
      this.prices[slot] = trade.price;
      this.sizes[slot] = trade.size;
      this.sides[slot] = trade.side === null ? 0 : SIDE_CODES[trade.side];
      this.barTimes[slot] = barTimes[index] ?? Number.NaN;
      this.total += 1;
    });

    this.oldest = Math.max(this.oldest, this.total - this.capacity);
    this.reveal();
  }

  /** Reveals the trades of the source bars up to `time` (`Infinity` reveals all). */
  setCutoff(time: number): void {
    this.cutoff = time;
    this.reveal();
  }

  /** Keeps up to `capacity` trades from now on, dropping the oldest beyond it. */
  setCapacity(capacity: number): void {
    if (capacity === this.capacity) {
      return;
    }

    const first = Math.max(this.oldest, this.total - capacity);
    const kept = Array.from({ length: this.total - first }, (_, offset) => first + offset).map(
      (position) => {
        const slot = position % this.capacity;
        return [
          this.times[slot] ?? Number.NaN,
          this.prices[slot] ?? Number.NaN,
          this.sizes[slot] ?? Number.NaN,
          this.sides[slot] ?? 0,
          this.barTimes[slot] ?? Number.NaN
        ] as const;
      }
    );
    this.capacity = capacity;
    this.oldest = first;
    this.times = new Float64Array(0);
    this.prices = new Float64Array(0);
    this.sizes = new Float64Array(0);
    this.sides = new Int8Array(0);
    this.barTimes = new Float64Array(0);
    this.reserve(this.total);
    kept.forEach(([time, price, size, side, barTime], offset) => {
      const slot = (first + offset) % capacity;
      this.times[slot] = time;
      this.prices[slot] = price;
      this.sizes[slot] = size;
      this.sides[slot] = side;
      this.barTimes[slot] = barTime;
    });
    this.revealed = Math.max(this.revealed, first);
  }

  clear(): void {
    this.oldest = 0;
    this.total = 0;
    this.revealed = 0;
    this.changes.reset();
  }

  /** How the revealed trades changed after `revision`, as {@link BarStore.changesSince} tells. */
  changesSince(revision: number): BarChange | null {
    return this.changes.since(revision);
  }

  /** The revealed trades kept, as bars, oldest first. */
  view(): BarsView {
    return new TradesView(this);
  }

  /** Moves the revealed end to the last trade of a source bar at or before the cutoff. */
  private reveal(): void {
    let low = this.oldest;
    let high = this.total;

    while (low < high) {
      const middle = (low + high) >>> 1;

      if ((this.barTimes[middle % this.capacity] ?? Number.NaN) <= this.cutoff) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const previous = this.revealed;
    this.revealed = low;

    if (low > previous) {
      this.changes.tail(previous);
    } else if (low < previous) {
      this.changes.reset();
    }
  }

  /** Grows the columns to hold `count` positions, up to the capacity. */
  private reserve(count: number): void {
    const size = Math.min(this.capacity, count);

    if (size <= this.times.length) {
      return;
    }

    const length = Math.min(this.capacity, Math.max(16, this.times.length * 2, size));
    const grow = (column: Float64Array): Float64Array<ArrayBuffer> => {
      const next = new Float64Array(length);
      next.set(column);
      return next;
    };
    this.times = grow(this.times);
    this.prices = grow(this.prices);
    this.sizes = grow(this.sizes);
    const sides = new Int8Array(length);
    sides.set(this.sides);
    this.sides = sides;
    this.barTimes = grow(this.barTimes);
  }
}

/** The revealed trades of a log as bars, from its oldest kept trade. */
class TradesView implements BarsView {
  constructor(private readonly log: TradeLog) {}

  get length(): number {
    return this.log.end - this.log.first;
  }

  get revision(): number {
    return this.log.revision;
  }

  time(index: number): number {
    return this.log.time(this.log.first + index);
  }

  open(index: number): number {
    return this.log.price(this.log.first + index);
  }

  high(index: number): number {
    return this.log.price(this.log.first + index);
  }

  low(index: number): number {
    return this.log.price(this.log.first + index);
  }

  close(index: number): number {
    return this.log.price(this.log.first + index);
  }

  volume(index: number): number {
    return this.log.size(this.log.first + index);
  }

  bar(index: number): Bar | null {
    return index >= 0 && index < this.length ? this.log.bar(this.log.first + index) : null;
  }

  lowerBound(time: number): number {
    let low = 0;
    let high = this.length;

    while (low < high) {
      const middle = (low + high) >>> 1;

      if (this.time(middle) < time) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }
}

import { checkObject } from '../utils/validate';
import { describeValue, fail } from '../utils/errors';
import { ChangeLog } from './change-log';
import { checkAscending } from './points';
import { logicalIndex, logicalTime, typicalInterval } from './positions';
import { toTime } from './time';
import type { Bar, BarChange, BarInput, BarsView, PriceSource } from './types';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The name of a bar in error messages, only built for an error as bars come by the million. */
function barLabel(label: string, index: number | undefined): string {
  return index === undefined ? label : `${label}[${index}]`;
}

/**
 * Checks a bar as the chart does and returns it normalized: the time in epoch milliseconds and
 * the volume `0` when absent. Errors name the bar `label`, or `label[index]` with an index, such
 * as `bars[3].high must be a finite number, received null.`
 */
export function parseBar(input: BarInput, label = 'bar', index?: number): Bar {
  const value: unknown = input;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    checkObject(barLabel(label, index), value);
  }

  const time = finite(input.time)
    ? input.time
    : toTime(input.time, `${barLabel(label, index)}.time`);
  const { open, high, low, close } = input;
  const volume = input.volume ?? 0;

  if (!finite(open) || !finite(high) || !finite(low) || !finite(close) || !finite(volume)) {
    const [field, wrong] = Object.entries({ open, high, low, close, volume }).find(
      ([, item]) => !finite(item)
    ) as [string, unknown];
    fail(
      `${barLabel(label, index)}.${field} must be a finite number, received ${describeValue(wrong)}.`
    );
  }

  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    fail(
      `${barLabel(label, index)} is inconsistent: high (${high}) and low (${low}) must enclose open (${open}) and close (${close}).`
    );
  }

  if (volume < 0) {
    fail(`${barLabel(label, index)}.volume must not be negative, received ${volume}.`);
  }

  return { time, open, high, low, close, volume };
}

/** Validates and normalizes bars; the order is checked by the caller. */
export function parseBars(inputs: readonly BarInput[], label = 'bars'): Bar[] {
  return inputs.map((input, index) => parseBar(input, label, index));
}

/** The price `source` of a bar, as {@link BarStore.price} reads it from the columns. */
export function priceOf(bar: Bar, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
  }
}

/**
 * Columnar storage for the main OHLCV series. Bars are kept in typed arrays sorted by time.
 * Every mutation bumps {@link revision}; consumers ask {@link changesSince} to update their own
 * derived data incrementally.
 */
export class BarStore implements BarsView {
  private times = new Float64Array(0);
  private opens = new Float64Array(0);
  private highs = new Float64Array(0);
  private lows = new Float64Array(0);
  private closes = new Float64Array(0);
  private volumes = new Float64Array(0);
  private count = 0;
  private readonly changes = new ChangeLog();
  private cachedInterval: number | null = null;

  get length(): number {
    return this.count;
  }

  get revision(): number {
    return this.changes.revision;
  }

  /** Unchecked accessors for hot paths. Callers guarantee `0 <= index < length`. */
  time(index: number): number {
    return this.times[index] ?? Number.NaN;
  }

  open(index: number): number {
    return this.opens[index] ?? Number.NaN;
  }

  high(index: number): number {
    return this.highs[index] ?? Number.NaN;
  }

  low(index: number): number {
    return this.lows[index] ?? Number.NaN;
  }

  close(index: number): number {
    return this.closes[index] ?? Number.NaN;
  }

  volume(index: number): number {
    return this.volumes[index] ?? Number.NaN;
  }

  price(index: number, source: PriceSource): number {
    switch (source) {
      case 'open':
        return this.open(index);
      case 'high':
        return this.high(index);
      case 'low':
        return this.low(index);
      case 'close':
        return this.close(index);
      case 'hl2':
        return (this.high(index) + this.low(index)) / 2;
      case 'hlc3':
        return (this.high(index) + this.low(index) + this.close(index)) / 3;
      case 'ohlc4':
        return (this.open(index) + this.high(index) + this.low(index) + this.close(index)) / 4;
    }
  }

  bar(index: number): Bar | null {
    return Number.isInteger(index) && index >= 0 && index < this.count ? this.read(index) : null;
  }

  /** The bar at an index; callers guarantee `0 <= index < length`. */
  read(index: number): Bar {
    return {
      time: this.time(index),
      open: this.open(index),
      high: this.high(index),
      low: this.low(index),
      close: this.close(index),
      volume: this.volume(index)
    };
  }

  toArray(): Bar[] {
    return Array.from({ length: this.count }, (_, index) => this.read(index));
  }

  /** First index whose time is `>= time`, or `length` when every bar is earlier. */
  lowerBound(time: number): number {
    let low = 0;
    let high = this.count;

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

  /** Index of the bar with exactly this time, or `-1`. */
  indexOf(time: number): number {
    const index = this.lowerBound(time);
    return index < this.count && this.time(index) === time ? index : -1;
  }

  /** Index of the bar whose period contains `time` (the last bar starting at or before it), or `-1`. */
  indexAt(time: number): number {
    const index = this.lowerBound(time);

    if (index < this.count && this.time(index) === time) {
      return index;
    }

    return index - 1;
  }

  /**
   * Continuous logical index of `time`: interpolated between the bars around it and extrapolated
   * with the typical interval outside the data. `NaN` when the position cannot be known (no bars,
   * or a single bar and a different time).
   */
  logicalIndexOf(time: number): number {
    return logicalIndex(this, this.interval(), time);
  }

  /** Time at a continuous logical index, the inverse of {@link logicalIndexOf}. */
  timeOfLogicalIndex(logical: number): number {
    return logicalTime(this, this.interval(), logical);
  }

  /** Typical spacing between consecutive bars in milliseconds, or `null` with fewer than two bars. */
  interval(): number | null {
    if (this.cachedInterval !== null || this.count < 2) {
      return this.cachedInterval;
    }

    this.cachedInterval = typicalInterval(this);
    return this.cachedInterval;
  }

  /** Describes what changed after `revision`, or `null` when nothing did. */
  changesSince(revision: number): BarChange | null {
    return this.changes.since(revision);
  }

  set(inputs: readonly BarInput[]): void {
    const bars = parseBars(inputs);
    checkAscending(bars, 'bars');
    this.assign(bars);
  }

  clear(): void {
    this.count = 0;
    this.markReset();
  }

  // ─── Trusted writes: callers pass validated bars in time order ─────────────

  /** Replaces every bar. */
  assign(bars: readonly Bar[]): void {
    this.allocate(bars.length);
    bars.forEach((bar, index) => {
      this.write(index, bar);
    });
    this.count = bars.length;
    this.markReset();
  }

  /** Keeps the bars before `from` and writes `bars` after them, as a tail change. */
  replaceFrom(from: number, bars: readonly Bar[]): void {
    const count = from + bars.length;
    let timesChanged = count !== this.count;
    this.ensureCapacity(count);

    bars.forEach((bar, offset) => {
      timesChanged ||= this.time(from + offset) !== bar.time;
      this.write(from + offset, bar);
    });

    this.count = count;

    if (timesChanged) {
      this.cachedInterval = null;
    }

    this.changes.tail(from);
  }

  /** Inserts bars that are all older than the first bar; nothing happens for an empty list. */
  insertBefore(bars: readonly Bar[]): void {
    if (!bars.length) {
      return;
    }

    const count = this.count;
    const shift = (column: Float64Array): Float64Array<ArrayBuffer> => {
      const next = new Float64Array(Math.max(16, count + bars.length));
      next.set(column.subarray(0, count), bars.length);
      return next;
    };

    this.times = shift(this.times);
    this.opens = shift(this.opens);
    this.highs = shift(this.highs);
    this.lows = shift(this.lows);
    this.closes = shift(this.closes);
    this.volumes = shift(this.volumes);
    bars.forEach((bar, index) => {
      this.write(index, bar);
    });
    this.count = count + bars.length;
    this.markReset();
  }

  private write(index: number, bar: Bar): void {
    this.times[index] = bar.time;
    this.opens[index] = bar.open;
    this.highs[index] = bar.high;
    this.lows[index] = bar.low;
    this.closes[index] = bar.close;
    this.volumes[index] = bar.volume;
  }

  private allocate(size: number): void {
    const capacity = Math.max(16, size);
    this.times = new Float64Array(capacity);
    this.opens = new Float64Array(capacity);
    this.highs = new Float64Array(capacity);
    this.lows = new Float64Array(capacity);
    this.closes = new Float64Array(capacity);
    this.volumes = new Float64Array(capacity);
  }

  private ensureCapacity(size: number): void {
    if (size <= this.times.length) {
      return;
    }

    const capacity = Math.max(16, this.times.length * 2, size);
    const grow = (source: Float64Array): Float64Array<ArrayBuffer> => {
      const next = new Float64Array(capacity);
      next.set(source.subarray(0, this.count));
      return next;
    };

    this.times = grow(this.times);
    this.opens = grow(this.opens);
    this.highs = grow(this.highs);
    this.lows = grow(this.lows);
    this.closes = grow(this.closes);
    this.volumes = grow(this.volumes);
  }

  private markReset(): void {
    this.changes.reset();
    this.cachedInterval = null;
  }
}

/**
 * A read-only view of a store, for code outside the chart: optionally limited to the first
 * `count()` bars, with `moves()` added to the revision when that limit changes. The limit is
 * counted once a revision, as readers ask for the length on every bar they read.
 */
export class BarsReader implements BarsView {
  private countedAt = -1;
  private counted = 0;

  constructor(
    private readonly store: BarStore,
    private readonly count: () => number = () => store.length,
    private readonly moves: () => number = () => 0
  ) {}

  get length(): number {
    const revision = this.revision;

    if (revision !== this.countedAt) {
      this.countedAt = revision;
      this.counted = this.count();
    }

    return this.counted;
  }

  get revision(): number {
    return this.store.revision + this.moves();
  }

  time(index: number): number {
    return this.store.time(index);
  }

  open(index: number): number {
    return this.store.open(index);
  }

  high(index: number): number {
    return this.store.high(index);
  }

  low(index: number): number {
    return this.store.low(index);
  }

  close(index: number): number {
    return this.store.close(index);
  }

  volume(index: number): number {
    return this.store.volume(index);
  }

  bar(index: number): Bar | null {
    return index < this.length ? this.store.bar(index) : null;
  }

  lowerBound(time: number): number {
    return Math.min(this.store.lowerBound(time), this.length);
  }
}

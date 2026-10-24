/**
 * Incremental building blocks for indicator calculators. Each one consumes one value per bar,
 * returns `NaN` while warming up, and can be cloned to checkpoint its state.
 */
import { checkNumber } from '../utils/validate';

/** The latest `capacity` values, oldest first, as a calculator keeps a window of them. */
export class RingBuffer {
  private readonly values: Float64Array;
  private start = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.values = new Float64Array(checkNumber('capacity', capacity, { min: 1, integer: true }));
  }

  /** How many values it holds, up to `capacity`. */
  get length(): number {
    return this.size;
  }

  /** Whether it holds `capacity` values. */
  get full(): boolean {
    return this.size === this.capacity;
  }

  /** Appends a value and returns the one it evicted, or `NaN`. */
  push(value: number): number {
    if (this.size < this.capacity) {
      this.values[(this.start + this.size) % this.capacity] = value;
      this.size += 1;
      return Number.NaN;
    }

    const evicted = this.values[this.start] ?? Number.NaN;
    this.values[this.start] = value;
    this.start = (this.start + 1) % this.capacity;
    return evicted;
  }

  /** Value `index` places from the oldest (0 = oldest). */
  at(index: number): number {
    return this.values[(this.start + index) % this.capacity] ?? Number.NaN;
  }

  /** Value `back` places from the newest (0 = newest). */
  fromEnd(back: number): number {
    return back < this.size ? this.at(this.size - 1 - back) : Number.NaN;
  }

  /** The highest value held; `-Infinity` without any. */
  max(): number {
    let result = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < this.size; index += 1) {
      result = Math.max(result, this.at(index));
    }

    return result;
  }

  /** The lowest value held; `Infinity` without any. */
  min(): number {
    let result = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.size; index += 1) {
      result = Math.min(result, this.at(index));
    }

    return result;
  }

  /** The sum of the values held. */
  sum(): number {
    let result = 0;

    for (let index = 0; index < this.size; index += 1) {
      result += this.at(index);
    }

    return result;
  }

  clone(): RingBuffer {
    const copy = new RingBuffer(this.capacity);
    copy.values.set(this.values);
    copy.start = this.start;
    copy.size = this.size;
    return copy;
  }
}

/**
 * Simple moving average over `period` values, `NaN` while the window holds a `NaN`, as `MA(X, N)`
 * of Chinese charting software.
 */
export class MovingAverage {
  private readonly sum: MovingSum;

  constructor(
    private readonly period: number,
    sum = new MovingSum(period)
  ) {
    this.sum = sum;
  }

  next(value: number): number {
    return this.sum.next(value) / this.period;
  }

  clone(): MovingAverage {
    return new MovingAverage(this.period, this.sum.clone());
  }
}

/**
 * Simple moving average of the latest `period` values that are numbers: a `NaN` is skipped and
 * leaves the average as it was, `NaN` until `period` values came.
 */
export class SimpleAverage {
  constructor(
    private readonly period: number,
    private readonly window = new RingBuffer(period),
    private sum = 0,
    private value = Number.NaN
  ) {}

  next(input: number): number {
    if (Number.isNaN(input)) {
      return this.value;
    }

    const evicted = this.window.push(input);
    this.sum += input - (Number.isNaN(evicted) ? 0 : evicted);
    this.value = this.window.full ? this.sum / this.period : Number.NaN;
    return this.value;
  }

  clone(): SimpleAverage {
    return new SimpleAverage(this.period, this.window.clone(), this.sum, this.value);
  }
}

/**
 * Population standard deviation of the latest `period` values that are numbers, `NaN` until
 * `period` values came: a `NaN` is skipped and leaves the deviation as it was.
 */
export class StandardDeviation {
  private window: RingBuffer;
  private value = Number.NaN;

  constructor(private readonly period: number) {
    this.window = new RingBuffer(checkNumber('period', period, { min: 1, integer: true }));
  }

  next(input: number): number {
    if (Number.isNaN(input)) {
      return this.value;
    }

    this.window.push(input);

    if (!this.window.full) {
      return Number.NaN;
    }

    const mean = this.window.sum() / this.period;
    let variance = 0;

    for (let index = 0; index < this.period; index += 1) {
      variance += (this.window.at(index) - mean) ** 2;
    }

    this.value = Math.sqrt(variance / this.period);
    return this.value;
  }

  clone(): StandardDeviation {
    const copy = new StandardDeviation(this.period);
    copy.window = this.window.clone();
    copy.value = this.value;
    return copy;
  }
}

/**
 * Exponentially weighted average `y = (weight * x + (period - weight) * y') / period`, seeded with
 * the first value, as `SMA(X, N, M)` and `EMA(X, N)` of Chinese charting software compute it:
 * `weight = 1` is the `SMA(X, N, 1)` of their RSI and KDJ. `NaN` inputs are skipped.
 */
export class WeightedAverage {
  constructor(
    private readonly period: number,
    private readonly weight: number,
    private value = Number.NaN
  ) {}

  next(input: number): number {
    if (Number.isNaN(input)) {
      return this.value;
    }

    this.value = Number.isNaN(this.value)
      ? input
      : (this.weight * input + (this.period - this.weight) * this.value) / this.period;
    return this.value;
  }

  clone(): WeightedAverage {
    return new WeightedAverage(this.period, this.weight, this.value);
  }
}

/**
 * `y = alpha * x + (1 - alpha) * y'` seeded with the simple average of the first `period` values:
 * the exponential moving average with `alpha = 2 / (period + 1)`, Wilder's smoothing (RMA) with
 * `1 / period`. A `NaN` is skipped and leaves the average as it was.
 */
export class SeededAverage {
  constructor(
    private readonly period: number,
    private readonly alpha: number,
    private count = 0,
    /** The sum of the values until `period` of them were added. */
    private value = 0
  ) {}

  /** The exponential moving average of `period` values. */
  static ema(period: number): SeededAverage {
    return new SeededAverage(period, 2 / (period + 1));
  }

  /** Wilder's smoothing over `period` values. */
  static rma(period: number): SeededAverage {
    return new SeededAverage(period, 1 / period);
  }

  next(input: number): number {
    if (Number.isNaN(input)) {
      return this.count === this.period ? this.value : Number.NaN;
    }

    if (this.count === this.period) {
      this.value = this.alpha * input + (1 - this.alpha) * this.value;
      return this.value;
    }

    this.count += 1;
    this.value += input;

    if (this.count < this.period) {
      return Number.NaN;
    }

    this.value /= this.period;
    return this.value;
  }

  clone(): SeededAverage {
    return new SeededAverage(this.period, this.alpha, this.count, this.value);
  }
}

/**
 * Linearly weighted average over `period` values, the newest weighing `period` and the oldest 1.
 * Keeps the plain and the weighted sum: each new value makes every value in the window weigh one
 * less, which takes the plain sum off the weighted one. A `NaN` is skipped and leaves the average
 * as it was.
 */
export class LinearlyWeightedAverage {
  constructor(
    private readonly period: number,
    private readonly window = new RingBuffer(period),
    private sum = 0,
    private weighted = 0
  ) {}

  next(value: number): number {
    if (Number.isNaN(value)) {
      return this.window.full ? this.average() : Number.NaN;
    }

    const size = this.window.length;
    const evicted = this.window.push(value);

    if (size < this.period) {
      this.weighted += (size + 1) * value;
      this.sum += value;
    } else {
      this.weighted += this.period * value - this.sum;
      this.sum += value - evicted;
    }

    return this.window.full ? this.average() : Number.NaN;
  }

  private average(): number {
    return this.weighted / ((this.period * (this.period + 1)) / 2);
  }

  clone(): LinearlyWeightedAverage {
    return new LinearlyWeightedAverage(this.period, this.window.clone(), this.sum, this.weighted);
  }
}

/** Running sum over `period` values; `NaN` while the window holds a `NaN`. */
export class MovingSum {
  constructor(
    period: number,
    private readonly window = new RingBuffer(period),
    private sum = 0
  ) {}

  next(value: number): number {
    const evicted = this.window.push(value);
    // A NaN poisons the running total, so it is summed afresh until the NaN has left the window.
    this.sum = Number.isNaN(this.sum)
      ? this.window.sum()
      : this.sum + (value - (Number.isNaN(evicted) ? 0 : evicted));
    return this.window.full ? this.sum : Number.NaN;
  }

  clone(): MovingSum {
    return new MovingSum(this.window.capacity, this.window.clone(), this.sum);
  }
}

/**
 * Highest high and lowest low of the latest `period` bars, as of channels and stochastics; `NaN`
 * until `period` bars were added.
 */
export class RollingExtremes {
  private highs: RingBuffer;
  private lows: RingBuffer;

  constructor(period: number) {
    this.highs = new RingBuffer(checkNumber('period', period, { min: 1, integer: true }));
    this.lows = new RingBuffer(period);
  }

  /** Adds the high and the low of the next bar. */
  push(high: number, low: number): void {
    this.highs.push(high);
    this.lows.push(low);
  }

  highest(): number {
    return this.highs.full ? this.highs.max() : Number.NaN;
  }

  lowest(): number {
    return this.lows.full ? this.lows.min() : Number.NaN;
  }

  clone(): RollingExtremes {
    const copy = new RollingExtremes(this.highs.capacity);
    copy.highs = this.highs.clone();
    copy.lows = this.lows.clone();
    return copy;
  }
}

/** Remembers the previous value of a series. */
export class Previous {
  private last = Number.NaN;

  /** Returns the value from the previous call, then stores `value`. */
  next(value: number): number {
    const previous = this.last;
    this.last = value;
    return previous;
  }

  clone(): Previous {
    const copy = new Previous();
    copy.last = this.last;
    return copy;
  }
}

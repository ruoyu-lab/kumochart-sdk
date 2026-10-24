import { describeValue, fail } from '../utils/errors';
import { checkObject } from '../utils/validate';
import { toTime } from './time';
import type { ValuePoint, ValuePointInput } from './types';

/** Validates and normalizes value points; the order is checked by the caller. */
export function parseValuePoints(
  inputs: readonly ValuePointInput[],
  label = 'points'
): ValuePoint[] {
  return inputs.map((input, index) => {
    checkObject(`${label}[${index}]`, input);
    const time = toTime(input.time, `${label}[${index}].time`);

    if (
      input.value !== null &&
      (typeof input.value !== 'number' || !Number.isFinite(input.value))
    ) {
      fail(
        `${label}[${index}].value must be a finite number or null, received ${describeValue(input.value)}.`
      );
    }

    return { time, value: input.value ?? Number.NaN };
  });
}

/** Time-sorted values of a value series; `NaN` marks gaps. Writes are trusted. */
export class ValueStore {
  private times = new Float64Array(0);
  private values = new Float64Array(0);
  private count = 0;

  get length(): number {
    return this.count;
  }

  time(index: number): number {
    return this.times[index] ?? Number.NaN;
  }

  value(index: number): number {
    return this.values[index] ?? Number.NaN;
  }

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

  clear(): void {
    this.count = 0;
  }

  /** Replaces every point. */
  assign(points: readonly ValuePoint[]): void {
    this.times = Float64Array.from(points, (point) => point.time);
    this.values = Float64Array.from(points, (point) => point.value);
    this.count = points.length;
  }

  /** Keeps the points before `from` and writes `points` after them. */
  replaceFrom(from: number, points: readonly ValuePoint[]): void {
    const count = from + points.length;
    this.grow(count);
    points.forEach((point, offset) => {
      this.times[from + offset] = point.time;
      this.values[from + offset] = point.value;
    });
    this.count = count;
  }

  /** Inserts points that are all older than the first point. */
  insertBefore(points: readonly ValuePoint[]): void {
    const times = new Float64Array(points.length + this.count);
    const values = new Float64Array(points.length + this.count);
    points.forEach((point, index) => {
      times[index] = point.time;
      values[index] = point.value;
    });
    times.set(this.times.subarray(0, this.count), points.length);
    values.set(this.values.subarray(0, this.count), points.length);
    this.times = times;
    this.values = values;
    this.count = times.length;
  }

  private grow(size: number): void {
    if (size <= this.times.length) {
      return;
    }

    const capacity = Math.max(16, size, this.times.length * 2);
    const times = new Float64Array(capacity);
    const values = new Float64Array(capacity);
    times.set(this.times.subarray(0, this.count));
    values.set(this.values.subarray(0, this.count));
    this.times = times;
    this.values = values;
  }
}

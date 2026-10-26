import { describeValue, fail } from '../utils/errors';
import { checkObject } from '../utils/validate';
import { shiftStart, withRoom, type Column } from './columns';
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
  private times: Column = new Float64Array(0);
  private values: Column = new Float64Array(0);
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
    this.replaceFirst(0, points);
  }

  /**
   * Replaces the first `count` points with `points`, older than the points after them. The
   * columns keep room in front of the first point, as the bars do.
   */
  replaceFirst(count: number, points: readonly ValuePoint[]): void {
    const shift = points.length - count;
    this.times = shiftStart(this.times, this.count, shift);
    this.values = shiftStart(this.values, this.count, shift);
    points.forEach((point, index) => {
      this.times[index] = point.time;
      this.values[index] = point.value;
    });
    this.count += shift;
  }

  private grow(size: number): void {
    this.times = withRoom(this.times, this.count, size);
    this.values = withRoom(this.values, this.count, size);
  }
}

import type { BarStore } from '../data/bar-store';
import type { CalendarFields, Clock } from '../format/clock';
import type { TimeUnit } from '../options/types';
import type { TimeScale } from './time-scale';

export interface TimeTick {
  index: number;
  x: number;
  time: number;
  unit: TimeUnit;
}

const WEIGHT_YEAR = 90;
const WEIGHT_MONTH = 80;
const WEIGHT_DAY = 70;
const WEIGHT_HOUR = 60;
const WEIGHT_MINUTE = 40;
const WEIGHT_SECOND = 30;
/** Bars within one second, e.g. Renko bricks spaced by a millisecond: never a tick. */
const WEIGHT_NONE = 1;

function weightBetween(previous: CalendarFields | null, current: CalendarFields): number {
  if (!previous || current.year !== previous.year) {
    return WEIGHT_YEAR;
  }

  if (current.month !== previous.month) {
    return WEIGHT_MONTH;
  }

  if (current.day !== previous.day) {
    return WEIGHT_DAY;
  }

  if (current.hour !== previous.hour) {
    return current.hour % 6 === 0 ? WEIGHT_HOUR + 2 : WEIGHT_HOUR;
  }

  if (current.minute !== previous.minute) {
    if (current.minute % 30 === 0) {
      return WEIGHT_MINUTE + 12;
    }

    if (current.minute % 15 === 0) {
      return WEIGHT_MINUTE + 11;
    }

    return current.minute % 5 === 0 ? WEIGHT_MINUTE + 10 : WEIGHT_MINUTE;
  }

  return current.second === previous.second ? WEIGHT_NONE : WEIGHT_SECOND;
}

function unitOfWeight(weight: number): TimeUnit {
  if (weight >= WEIGHT_YEAR) {
    return 'year';
  }

  if (weight >= WEIGHT_MONTH) {
    return 'month';
  }

  if (weight >= WEIGHT_DAY) {
    return 'day';
  }

  if (weight >= WEIGHT_HOUR) {
    return 'hour';
  }

  return weight >= WEIGHT_MINUTE ? 'minute' : 'second';
}

/**
 * Calendar weight of every bar: how significant the boundary between a bar and its predecessor is
 * (new year, month, day, hour…). Weights are computed lazily and kept until the bars change.
 */
export class TimeMarks {
  private weights = new Uint8Array(0);
  private revision = -1;

  constructor(
    private readonly store: BarStore,
    private readonly clock: Clock
  ) {}

  weight(index: number): number {
    this.sync();
    const cached = this.weights[index] ?? 0;

    if (cached !== 0) {
      return cached;
    }

    const current = this.clock.fields(this.store.time(index));
    const previous = index > 0 ? this.clock.fields(this.store.time(index - 1)) : null;
    const weight = weightBetween(previous, current);
    this.weights[index] = weight;
    return weight;
  }

  private sync(): void {
    const change = this.store.changesSince(this.revision);

    if (!change) {
      return;
    }

    if (change.kind === 'reset' || this.weights.length < this.store.length) {
      const next = new Uint8Array(Math.max(16, this.store.length * 2));

      if (change.kind === 'tail') {
        next.set(this.weights.subarray(0, change.from));
      }

      this.weights = next;
    } else {
      this.weights.fill(0, change.from);
    }

    this.revision = this.store.revision;
  }
}

/**
 * Picks tick marks on calendar boundaries: the most significant boundaries first (years, then
 * months, days…), each kept only when it leaves `minSpacing` pixels to its neighbours.
 */
export function buildTimeTicks(
  timeScale: TimeScale,
  store: BarStore,
  marks: TimeMarks,
  minSpacing: number
): TimeTick[] {
  const visible = timeScale.visibleBars();

  if (!visible) {
    return [];
  }

  const byWeight = new Map<number, number[]>();

  for (let index = visible.from; index <= visible.to; index += 1) {
    const weight = marks.weight(index);
    let bucket = byWeight.get(weight);

    if (!bucket) {
      bucket = [];
      byWeight.set(weight, bucket);
    }

    bucket.push(index);
  }

  const acceptedX: number[] = [];
  const accepted: Array<{ index: number; weight: number }> = [];
  const weights = [...byWeight.keys()]
    .filter((weight) => weight > WEIGHT_NONE)
    .sort((left, right) => right - left);

  for (const weight of weights) {
    for (const index of byWeight.get(weight) ?? []) {
      const x = timeScale.indexToX(index);
      let low = 0;
      let high = acceptedX.length;

      while (low < high) {
        const middle = (low + high) >>> 1;

        if ((acceptedX[middle] ?? 0) < x) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      const before = acceptedX[low - 1];
      const after = acceptedX[low];

      if (
        (before === undefined || x - before >= minSpacing) &&
        (after === undefined || after - x >= minSpacing)
      ) {
        acceptedX.splice(low, 0, x);
        accepted.push({ index, weight });
      }
    }
  }

  return accepted
    .sort((left, right) => left.index - right.index)
    .map(({ index, weight }) => ({
      index,
      x: timeScale.indexToX(index),
      time: store.time(index),
      unit: unitOfWeight(weight)
    }));
}

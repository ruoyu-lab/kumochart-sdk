import { fail } from '../utils/errors';

interface Timed {
  readonly time: number;
}

/** Throws unless `points` are sorted by strictly ascending time. */
export function checkAscending(points: readonly Timed[], label: string): void {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (previous && current && current.time <= previous.time) {
      fail(
        `${label} must be sorted by strictly ascending time: ${label}[${index}] (${current.time}) is not after ${label}[${index - 1}] (${previous.time}).`
      );
    }
  }
}

/**
 * Plans a streaming update of a time-sorted store: a point with the time of the last point
 * replaces it, newer points are appended, older ones throw. Returns the first index that changes
 * and the points written from there on.
 */
export function planTail<P extends Timed>(
  points: readonly P[],
  count: number,
  lastTime: number,
  label: string,
  noun: string
): { from: number; tail: P[] } {
  let latest = count > 0 ? lastTime : Number.NEGATIVE_INFINITY;

  points.forEach((point, index) => {
    if (point.time < latest) {
      fail(
        `${label}[${index}] (time ${point.time}) is older than the last ${noun} (time ${latest}). update() only replaces the last ${noun} or appends newer ones; use set() or prepend() to change history.`
      );
    }

    latest = point.time;
  });

  const first = points[0];
  const from = count > 0 && first?.time === lastTime ? count - 1 : count;
  const tail: P[] = [];

  for (const point of points) {
    if (tail.length > 0 && tail[tail.length - 1]?.time === point.time) {
      tail[tail.length - 1] = point;
    } else {
      tail.push(point);
    }
  }

  return { from, tail };
}

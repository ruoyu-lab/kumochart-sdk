import type { Point } from '../interaction/types';
import type { DrawingBounds } from './types';

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * How far to extend a line from `point` so that it crosses the whole `width` × `height` box
 * wherever the point is, on or off it: past its farthest corner, with room for lines drawn
 * parallel to it, as the far side of a channel.
 */
function reachFrom(point: Point, width: number, height: number): number {
  const dx = Math.max(Math.abs(point.x), Math.abs(point.x - width));
  const dy = Math.max(Math.abs(point.y), Math.abs(point.y - height));
  return Math.hypot(dx, dy) + width + height;
}

/**
 * Extends the segment from `start` through `end` across a `width` × `height` box:
 * `ray` extends past `end` only, `line` extends both ways, `segment` keeps it as is.
 */
export function extendSegment(
  start: Point,
  end: Point,
  width: number,
  height: number,
  mode: 'segment' | 'ray' | 'line'
): [Point, Point] {
  if (mode === 'segment' || (start.x === end.x && start.y === end.y)) {
    return [start, end];
  }

  const reach = reachFrom(start, width, height);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const far = { x: start.x + ux * reach, y: start.y + uy * reach };
  const back = mode === 'line' ? { x: start.x - ux * reach, y: start.y - uy * reach } : start;
  return [back, far];
}

/** Whether `start` is the left end of the segment to `end`; of a vertical one, the lower end. */
export function leftEnd(start: Point, end: Point): boolean {
  return start.x < end.x || (start.x === end.x && start.y > end.y);
}

/**
 * Extends the segment from `start` to `end` past its left end, its right end or both, across a
 * `width` × `height` box; the ends stay in their order.
 */
export function extendSides(
  start: Point,
  end: Point,
  width: number,
  height: number,
  left: boolean,
  right: boolean
): [Point, Point] {
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  if (length === 0 || (!left && !right)) {
    return [start, end];
  }

  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const fromLeft = leftEnd(start, end);
  const pastStart = fromLeft ? left : right;
  const pastEnd = fromLeft ? right : left;
  const before = reachFrom(start, width, height);
  const after = reachFrom(end, width, height);
  return [
    pastStart ? { x: start.x - ux * before, y: start.y - uy * before } : start,
    pastEnd ? { x: end.x + ux * after, y: end.y + uy * after } : end
  ];
}

export function insideRect(point: Point, first: Point, second: Point, padding = 0): boolean {
  return (
    point.x >= Math.min(first.x, second.x) - padding &&
    point.x <= Math.max(first.x, second.x) + padding &&
    point.y >= Math.min(first.y, second.y) - padding &&
    point.y <= Math.max(first.y, second.y) + padding
  );
}

export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const a = polygon[index];
    const b = polygon[previous];

    if (
      a &&
      b &&
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }

  return inside;
}

export type Segment = readonly [Point, Point];

/** Segments joining consecutive points, plus the last point to the first when `closed`. */
export function segmentsOf(points: readonly Point[], closed: boolean): Segment[] {
  const segments: Segment[] = [];
  let previous = closed ? points.at(-1) : undefined;

  for (const point of points) {
    if (previous) {
      segments.push([previous, point]);
    }

    previous = point;
  }

  return segments;
}

/** Line height of drawing text at `size`. */
export function textLineHeight(size: number): number {
  return Math.round(size * 1.4);
}

/** The box around `points`, `margin` wider on every side; `null` without points. */
export function boundsOf(points: readonly Point[], margin = 0): DrawingBounds | null {
  if (points.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  return {
    x: left - margin,
    y: top - margin,
    width: right - left + margin * 2,
    height: bottom - top + margin * 2
  };
}

/** The corners of a box, to take it into {@link boundsOf} with other points. */
export function cornersOf(box: DrawingBounds): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }
  ];
}

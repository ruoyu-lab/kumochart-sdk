import { insideRect, type Segment } from '../geometry';
import type { Anchors, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { segmentsHit, strokeDrawing, tracePath } from './shared';

/** Lines closer than this, in pixels, would be a wall: one line stands for them. */
const MIN_SPAN = 2;

/** The vertical lines, at the earlier anchor and every span between the anchors after it. */
function cyclesOf(geometry: DrawingGeometry<Anchors<2>>): Segment[] {
  const [first, second] = geometry.points;
  const start = Math.min(first.x, second.x);
  const span = Math.abs(second.x - first.x);
  const at = (x: number): Segment => [
    { x, y: 0 },
    { x, y: geometry.height }
  ];

  if (span < MIN_SPAN) {
    return [at(start)];
  }

  // Those left of the plot are skipped, however far back the cycles start.
  const lines: Segment[] = [];

  for (
    let x = start + Math.max(0, Math.ceil(-start / span)) * span;
    x <= geometry.width;
    x += span
  ) {
    lines.push(at(x));
  }

  return lines;
}

/**
 * Cyclic lines: vertical lines at the first anchor and at every span between the two anchors
 * after it, on to the right edge of the plot, to time the cycles of a market.
 */
export const cyclicLines: DrawingTypeDefinition<Anchors<2>> = {
  type: 'cyclic-lines',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle'],
  paint: (context) => {
    strokeDrawing(context, (ctx) => {
      for (const line of cyclesOf(context.geometry)) {
        tracePath(ctx, line, false);
      }
    });
  },
  hitTest: (geometry, point, tolerance) => {
    const [first, second] = geometry.points;
    return (
      segmentsHit(point, cyclesOf(geometry), tolerance) ??
      // The anchors too, where the lines start.
      ([first, second].some((anchor) => insideRect(point, anchor, anchor, tolerance))
        ? { part: 'line', distance: 0 }
        : null)
    );
  },
  bounds: (geometry) => {
    const [first, second] = geometry.points;
    const start = Math.min(first.x, second.x);
    return { x: start, y: 0, width: Math.max(0, geometry.width - start), height: geometry.height };
  },
  axisMarks: ([first, second]) => ({ prices: [], times: [first.time, second.time] })
};

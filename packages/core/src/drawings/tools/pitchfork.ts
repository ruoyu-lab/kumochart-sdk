import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, extendSegment, insidePolygon, type Segment } from '../geometry';
import type { Anchors, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { bodyHit, fillArea, segmentsHit, strokeDrawing, tracePath } from './shared';

interface Fork {
  readonly median: Segment;
  readonly upper: Segment;
  readonly lower: Segment;
  /** Between the outer anchors, the handle of the fork. */
  readonly base: Segment;
  readonly area: readonly Point[];
}

/**
 * The median line runs from the first anchor through the middle of the other two, and the outer
 * lines run parallel to it from those two anchors, on to the edge of the plot.
 */
function forkOf(geometry: DrawingGeometry<Anchors<3>>): Fork | null {
  const [pivot, first, second] = geometry.points;
  const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const direction = { x: middle.x - pivot.x, y: middle.y - pivot.y };

  // With the pivot between the others, the fork points nowhere.
  if (Math.hypot(direction.x, direction.y) < 1) {
    return null;
  }

  const { width, height } = geometry;
  const ray = (from: Point): Segment =>
    extendSegment(from, { x: from.x + direction.x, y: from.y + direction.y }, width, height, 'ray');
  const median = ray(pivot);
  const upper = ray(first);
  const lower = ray(second);
  return {
    median,
    upper,
    lower,
    base: [first, second],
    area: [first, upper[1], lower[1], second]
  };
}

/** Andrews' pitchfork: a median line and two parallels through the swing points. */
export const pitchfork: DrawingTypeDefinition<Anchors<3>> = {
  type: 'pitchfork',
  points: 3,
  fields: ['color', 'lineWidth', 'lineStyle', 'fill', 'fillColor'],
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.08) }),
  paint: (context) => {
    const fork = forkOf(context.geometry);

    if (!fork) {
      return;
    }

    if (context.geometry.style.fill) {
      fillArea(context.ctx, fork.area, context.geometry.style.fillColor);
    }

    strokeDrawing(context, (ctx) => {
      for (const line of [fork.median, fork.upper, fork.lower, fork.base]) {
        tracePath(ctx, line, false);
      }
    });
  },
  hitTest: (geometry, point, tolerance) => {
    const fork = forkOf(geometry);

    if (!fork) {
      return null;
    }

    return (
      segmentsHit(point, [fork.median, fork.upper, fork.lower, fork.base], tolerance) ??
      (geometry.style.fill && insidePolygon(point, fork.area) ? bodyHit : null)
    );
  },
  bounds: (geometry) => {
    const fork = forkOf(geometry);
    return fork && boundsOf([...fork.median, ...fork.upper, ...fork.lower]);
  }
};

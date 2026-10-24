import type { Point } from '../../interaction/types';
import { boundsOf, insidePolygon, segmentsOf } from '../geometry';
import type { Anchors, DrawingTypeDefinition } from '../types';
import { arrowLength, paintArrowHead } from './labels';
import { bodyHit, last, segmentsHit, strokeDrawing } from './shared';

/** The points of a stroke, two or more. */
type Stroke = readonly [Point, Point, ...Point[]];

/**
 * Adds a smooth curve through `points` to the current path: from the first point, through the
 * middles between neighbours, bent at each point, to the last.
 */
function traceSmooth(ctx: CanvasRenderingContext2D, points: Stroke): void {
  const [first] = points;
  const end = last(points);
  ctx.moveTo(first.x, first.y);

  for (const [point, next] of segmentsOf(points.slice(1), false)) {
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }

  ctx.lineTo(end.x, end.y);
}

/** The direction a stroke leaves its end, from a point some way back along it. */
function endAngle(points: Stroke, fromEnd: boolean, reach: number): number {
  const tip = fromEnd ? last(points) : points[0];
  const far = (point: Point) => Math.hypot(point.x - tip.x, point.y - tip.y) >= reach;
  const back =
    (fromEnd ? points.findLast(far) : points.find(far)) ?? (fromEnd ? points[0] : last(points));
  return Math.atan2(tip.y - back.y, tip.x - back.x);
}

/**
 * A stroke drawn by hand: press, draw and let go. It is smoothed, can end in arrowheads, and with
 * `fill` it closes into an area. It has no handles: it moves as a whole.
 */
export const brush: DrawingTypeDefinition<Anchors<0>> = {
  type: 'brush',
  points: 0,
  freehand: true,
  fields: ['color', 'lineWidth', 'fill', 'fillColor', 'startArrow', 'endArrow'],
  defaultStyle: () => ({ fill: false, lineWidth: 2 }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const { points, style } = geometry;
    if (style.fill) {
      ctx.beginPath();
      traceSmooth(ctx, points);
      ctx.closePath();
      ctx.fillStyle = style.fillColor;
      ctx.fill();
    }

    strokeDrawing(
      context,
      (path) => {
        traceSmooth(path, points);
      },
      { lineStyle: 'solid' }
    );
    const reach = arrowLength(style);

    if (style.startArrow) {
      paintArrowHead(ctx, points[0], endAngle(points, false, reach), style);
    }

    if (style.endArrow) {
      paintArrowHead(ctx, last(points), endAngle(points, true, reach), style);
    }
  },
  hitTest: (geometry, point, tolerance) =>
    segmentsHit(point, segmentsOf(geometry.points, false), tolerance) ??
    (geometry.style.fill && insidePolygon(point, geometry.points) ? bodyHit : null),
  handles: () => [],
  bounds: (geometry) => boundsOf(geometry.points),
  axisMarks: (anchors) => {
    const prices = anchors.map((anchor) => anchor.price);
    const times = anchors.map((anchor) => anchor.time);
    return {
      prices: [Math.max(...prices), Math.min(...prices)],
      times: [Math.min(...times), Math.max(...times)]
    };
  }
};

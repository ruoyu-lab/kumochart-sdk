import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, extendSegment, insidePolygon, type Segment } from '../geometry';
import type { Anchors, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { bodyHit, fillArea, segmentsHit, strokeDrawing, tracePath } from './shared';

/**
 * Where the median line starts: at the first anchor (Andrews), or moved halfway to the second, in
 * value alone (Schiff) or in time and value (modified Schiff), for a trend too steep for the fork.
 */
type ForkStart = 'pivot' | 'schiff' | 'modified-schiff';

interface Fork {
  /** From the first anchor to where the median line starts, when that is elsewhere. */
  readonly handle: Segment | null;
  readonly median: Segment;
  readonly upper: Segment;
  readonly lower: Segment;
  /** Between the outer anchors, the handle of the fork. */
  readonly base: Segment;
  readonly area: readonly Point[];
}

/**
 * The median line runs from its start through the middle of the other two anchors, and the outer
 * lines run parallel to it from those two anchors, on to the edge of the plot.
 */
function forkOf(geometry: DrawingGeometry<Anchors<3>>, from: ForkStart): Fork | null {
  const [pivot, first, second] = geometry.points;
  const start =
    from === 'pivot'
      ? pivot
      : {
          x: from === 'schiff' ? pivot.x : (pivot.x + first.x) / 2,
          y: (pivot.y + first.y) / 2
        };
  const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const direction = { x: middle.x - start.x, y: middle.y - start.y };

  // With the pivot between the others, the fork points nowhere.
  if (Math.hypot(direction.x, direction.y) < 1) {
    return null;
  }

  const { width, height } = geometry;
  const ray = (from: Point): Segment =>
    extendSegment(from, { x: from.x + direction.x, y: from.y + direction.y }, width, height, 'ray');
  const median = ray(start);
  const upper = ray(first);
  const lower = ray(second);
  return {
    handle: start === pivot ? null : [pivot, start],
    median,
    upper,
    lower,
    base: [first, second],
    area: [first, upper[1], lower[1], second]
  };
}

/** A pitchfork whose median line starts as `from` says. */
function pitchforkType(type: string, from: ForkStart): DrawingTypeDefinition<Anchors<3>> {
  const linesOf = (fork: Fork): Segment[] => [
    fork.median,
    fork.upper,
    fork.lower,
    fork.base,
    ...(fork.handle ? [fork.handle] : [])
  ];
  return {
    type,
    points: 3,
    fields: ['color', 'lineWidth', 'lineStyle', 'fill', 'fillColor'],
    defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.08) }),
    paint: (context) => {
      const fork = forkOf(context.geometry, from);

      if (!fork) {
        return;
      }

      if (context.geometry.style.fill) {
        fillArea(context.ctx, fork.area, context.geometry.style.fillColor);
      }

      strokeDrawing(context, (ctx) => {
        for (const line of linesOf(fork)) {
          tracePath(ctx, line, false);
        }
      });
    },
    hitTest: (geometry, point, tolerance) => {
      const fork = forkOf(geometry, from);

      if (!fork) {
        return null;
      }

      return (
        segmentsHit(point, linesOf(fork), tolerance) ??
        (geometry.style.fill && insidePolygon(point, fork.area) ? bodyHit : null)
      );
    },
    bounds: (geometry) => {
      const fork = forkOf(geometry, from);
      return fork && boundsOf(linesOf(fork).flat());
    }
  };
}

/** Andrews' pitchfork: a median line and two parallels through the swing points. */
export const pitchfork = /* @__PURE__ */ pitchforkType('pitchfork', 'pivot');
/** A Schiff pitchfork: its median line starts halfway from the first anchor to the second in value. */
export const schiffPitchfork = /* @__PURE__ */ pitchforkType('schiff-pitchfork', 'schiff');
/**
 * A modified Schiff pitchfork: its median line starts halfway from the first anchor to the second,
 * in time and in value.
 */
export const modifiedSchiffPitchfork = /* @__PURE__ */ pitchforkType(
  'modified-schiff-pitchfork',
  'modified-schiff'
);

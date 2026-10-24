import type { Point } from '../../interaction/types';
import { applyStroke } from '../../canvas/canvas';
import type { BarsView, PriceSource } from '../../data/types';
import type { Theme } from '../../options/types';
import { paletteColor } from '../../render/contributors';
import { LruCache } from '../../utils/lru-cache';
import { distanceToSegment, insidePolygon, type Segment } from '../geometry';
import type { DrawingHit, DrawingLevelStyle, DrawingPaintContext, DrawingStyle } from '../types';

export const bodyHit: DrawingHit = { part: 'body', distance: 0 };

/** Space between a line, a point or a box and the text written by it. */
export const LABEL_GAP = 4;
/** Space between a point or a box and a label in a box of its own beside it. */
export const BOXED_LABEL_GAP = 6;

/**
 * Strokes the path built by `trace` with the drawing's line style, the one way drawings stroke
 * their lines. `stroke` overrides the color, the width or the dash pattern.
 */
export function strokeDrawing(
  context: DrawingPaintContext,
  trace: (ctx: CanvasRenderingContext2D) => void,
  stroke: Partial<Pick<DrawingStyle, 'color' | 'lineWidth' | 'lineStyle'>> = {}
): void {
  const { ctx, geometry } = context;
  ctx.beginPath();
  trace(ctx);
  applyStroke(
    ctx,
    stroke.color ?? geometry.style.color,
    stroke.lineWidth ?? geometry.style.lineWidth,
    stroke.lineStyle ?? geometry.style.lineStyle
  );
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** The last of items there is at least one of. */
export function last<T>(items: readonly [T, ...T[]]): T {
  return items.reduce((_, item) => item);
}

/** Adds a polyline through `points` to the current path, closed into a polygon when `closed`. */
export function tracePath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  closed: boolean
): void {
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  if (closed) {
    ctx.closePath();
  }
}

export function fillArea(
  ctx: CanvasRenderingContext2D,
  polygon: readonly Point[],
  color: string
): void {
  ctx.beginPath();
  tracePath(ctx, polygon, true);
  ctx.fillStyle = color;
  ctx.fill();
}

export function segmentHit(
  point: Point,
  start: Point,
  end: Point,
  tolerance: number
): DrawingHit | null {
  const distance = distanceToSegment(point, start, end);
  return distance <= tolerance ? { part: 'line', distance } : null;
}

/** A `line` hit on the nearest of `segments` within `tolerance`. */
export function segmentsHit(
  point: Point,
  segments: readonly Segment[],
  tolerance: number
): DrawingHit | null {
  const distance = segments.reduce(
    (nearest, [start, end]) => Math.min(nearest, distanceToSegment(point, start, end)),
    Number.POSITIVE_INFINITY
  );
  return distance <= tolerance ? { part: 'line', distance } : null;
}

/**
 * A `line` hit on one of `lines`, else a `body` hit inside the `area` polygon where it is
 * `filled`: an area painted with nothing is not there to hit.
 */
export function shapeHit(
  point: Point,
  lines: readonly Segment[],
  area: readonly Point[],
  tolerance: number,
  filled: boolean
): DrawingHit | null {
  return (
    segmentsHit(point, lines, tolerance) ?? (filled && insidePolygon(point, area) ? bodyHit : null)
  );
}

/** A level that shows, and the color it is drawn in. */
export interface ShownLevel {
  readonly value: number;
  readonly color: string;
}

/**
 * The levels that show, in their order, each in its own color, else the drawing's; with a
 * `palette`, as Fibonacci ratios and Gann boxes color them: the drawing's color for 0 and 1 and
 * the palette's in turn for the others, hidden ones counted.
 */
export function shownLevels(
  levels: readonly DrawingLevelStyle[],
  style: DrawingStyle,
  palette: Theme['palette'] | null = null
): ShownLevel[] {
  let inner = 0;
  return levels.flatMap(({ value, color, visible }) => {
    const outer = value === 0 || value === 1;
    const auto = outer || !palette ? style.color : paletteColor(palette, inner);
    inner += outer ? 0 : 1;
    return visible === false ? [] : [{ value, color: color ?? auto }];
  });
}

/**
 * A ratio, or a level such as a ratio or a count of deviations, as labels and the keys of the
 * lines at levels write it: up to three decimals, e.g. `0.618`, `1.39` or `-2`.
 */
export function ratioText(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Values computed from bars, kept by key while the bars stay as they are: painting, hit testing
 * and alerts ask for the same ones again and again. The latest `size` are kept, as a tool
 * previewing a drawing asks for one after another.
 */
export function barsCache<V>(size: number): (bars: BarsView, key: string, compute: () => V) => V {
  const caches = new WeakMap<BarsView, { revision: number; values: LruCache<string, V> }>();
  return (bars, key, compute) => {
    let entry = caches.get(bars);

    if (entry?.revision !== bars.revision) {
      entry = { revision: bars.revision, values: new LruCache(size) };
      caches.set(bars, entry);
    }

    return entry.values.getOrCreate(key, compute);
  };
}

/** The `source` price of the bar at `index`. */
export function barPrice(bars: BarsView, index: number, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bars.open(index);
    case 'high':
      return bars.high(index);
    case 'low':
      return bars.low(index);
    case 'close':
      return bars.close(index);
    case 'hl2':
      return (bars.high(index) + bars.low(index)) / 2;
    case 'hlc3':
      return (bars.high(index) + bars.low(index) + bars.close(index)) / 3;
    case 'ohlc4':
      return (bars.open(index) + bars.high(index) + bars.low(index) + bars.close(index)) / 4;
  }
}

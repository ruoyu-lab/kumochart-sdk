import { drawLabel } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import type { Theme } from '../../options/types';
import { boundsOf, cornersOf, insideRect, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingBounds,
  DrawingField,
  DrawingGeometry,
  DrawingPaintContext,
  DrawingPoint,
  DrawingStyle,
  DrawingTypeDefinition
} from '../types';
import { paintArrow } from './labels';
import { bodyHit, BOXED_LABEL_GAP, fillArea, segmentsHit } from './shared';
import { boxLevels, corners } from './shapes';

const LABEL_PADDING = 8;

/** The change from `from` to `to` and its percentage, as `+12.50 (+1.25%)`. */
export function priceChangeText(
  geometry: DrawingGeometry,
  from: DrawingPoint,
  to: DrawingPoint
): string {
  const change = to.price - from.price;
  const sign = change > 0 ? '+' : '';
  const value = `${sign}${geometry.formatValue(change)}`;
  const percent =
    from.price === 0 ? '' : ` (${sign}${((change / Math.abs(from.price)) * 100).toFixed(2)}%)`;
  return `${value}${percent}`;
}

/** The change from `from` to `to`, its percentage and the bars between the anchors. */
function changeText(geometry: DrawingGeometry, from: DrawingPoint, to: DrawingPoint): string {
  return `${priceChangeText(geometry, from, to)} · ${geometry.texts.bars(barsBetween(geometry, from, to))}`;
}

/** The time between the anchors, e.g. `6h`. */
function durationText(geometry: DrawingGeometry, from: DrawingPoint, to: DrawingPoint): string {
  return geometry.texts.duration(to.time - from.time);
}

export function barsBetween(
  geometry: DrawingGeometry,
  from: DrawingPoint,
  to: DrawingPoint
): number {
  return Math.round(Math.abs(geometry.barIndex(to.time) - geometry.barIndex(from.time)));
}

/** A label of a range, centered at `x`, `y`. */
interface RangeLabel extends DrawingBounds {
  readonly text: string;
}

/**
 * The label of a range: above or below the box from `first` to `second` as `above` prefers, on
 * the other side where the plot has no room for it there, and inside the plot.
 */
function rangeLabelOf(
  geometry: DrawingGeometry,
  text: string,
  first: { readonly y: number },
  second: { readonly y: number },
  center: number,
  above: boolean
): RangeLabel {
  const height = geometry.style.fontSize + 10;
  const width = geometry.measureText(text) + LABEL_PADDING * 2;
  const over = Math.min(first.y, second.y) - BOXED_LABEL_GAP - height / 2;
  const under = Math.max(first.y, second.y) + BOXED_LABEL_GAP + height / 2;
  const fits = above ? over - height / 2 >= 0 : under + height / 2 <= geometry.height;
  const y = (fits ? above : !above) ? over : under;
  return {
    text,
    x: center - width / 2,
    y: Math.min(Math.max(y, height / 2), geometry.height - height / 2) - height / 2,
    width,
    height
  };
}

function paintRangeLabel(context: DrawingPaintContext, label: RangeLabel, color: string): void {
  const { ctx, geometry } = context;
  ctx.font = geometry.textFont;
  drawLabel(ctx, label.text, label.x + label.width / 2, label.y + label.height / 2, {
    background: color,
    color: '#ffffff',
    paddingX: LABEL_PADDING,
    height: label.height,
    align: 'center',
    radius: 4
  });
}

/** The color of the change from `from` to `to`: up for a rise, down for a fall. */
function changeColor(geometry: DrawingGeometry, from: DrawingPoint, to: DrawingPoint): string {
  return to.price >= from.price ? geometry.theme.up : geometry.theme.down;
}

/** What makes a kind of range: its colors, arrows and label. */
interface RangeKind {
  readonly type: string;
  readonly fields: readonly DrawingField[];
  readonly defaultStyle?: (theme: Theme) => Partial<DrawingStyle>;
  /** The color of its arrows and its label, and the fill of its box. */
  color(geometry: DrawingGeometry, from: DrawingPoint, to: DrawingPoint): string;
  fill(geometry: DrawingGeometry, color: string): string;
  /** Between the sides of the box from `start` to `end`, each with its head at its end. */
  arrows(start: Point, end: Point): Segment[];
  label(geometry: DrawingGeometry, from: DrawingPoint, to: DrawingPoint): string;
  /** The label goes above the box rather than below. */
  above(start: Point, end: Point): boolean;
  /** Its box has edges that alerts can watch. */
  readonly levels: boolean;
}

interface Range {
  readonly start: Point;
  readonly end: Point;
  readonly color: string;
  readonly arrows: readonly Segment[];
  readonly label: RangeLabel;
}

function rangeOf(geometry: DrawingGeometry<Anchors<2>>, kind: RangeKind): Range {
  const [start, end] = geometry.points;
  const [from, to] = geometry.anchors;
  return {
    start,
    end,
    color: kind.color(geometry, from, to),
    arrows: kind.arrows(start, end),
    label: rangeLabelOf(
      geometry,
      kind.label(geometry, from, to),
      start,
      end,
      (start.x + end.x) / 2,
      kind.above(start, end)
    )
  };
}

/**
 * A range measuring between two anchors: its box, filled as the style says, arrows across it
 * and a label. Its arrows are hit as lines, its label as its body, and its box when filled.
 */
function rangeType(kind: RangeKind): DrawingTypeDefinition<Anchors<2>> {
  return {
    type: kind.type,
    points: 2,
    fields: kind.fields,
    ...(kind.defaultStyle ? { defaultStyle: kind.defaultStyle } : {}),
    paint: (context) => {
      const { ctx, geometry } = context;
      const range = rangeOf(geometry, kind);

      if (geometry.style.fill) {
        fillArea(ctx, corners(range.start, range.end), kind.fill(geometry, range.color));
      }

      for (const [from, to] of range.arrows) {
        paintArrow(context, from, to, range.color);
      }

      paintRangeLabel(context, range.label, range.color);
    },
    hitTest: (geometry, point, tolerance) => {
      const range = rangeOf(geometry, kind);
      const { label } = range;
      const inside =
        insideRect(point, label, { x: label.x + label.width, y: label.y + label.height }) ||
        (geometry.style.fill && insideRect(point, range.start, range.end));
      return segmentsHit(point, range.arrows, tolerance) ?? (inside ? bodyHit : null);
    },
    bounds: (geometry) => {
      const { start, end, label } = rangeOf(geometry, kind);
      return boundsOf([start, end, ...cornersOf(label)]);
    },
    // The edges of its box, which no style extends.
    ...(kind.levels ? { levels: (anchors) => boxLevels(anchors, null) } : {})
  };
}

/** The line down the middle of the box, from the first anchor's value to the second's. */
const down = (start: Point, end: Point): Segment[] => {
  const center = (start.x + end.x) / 2;
  return [
    [
      { x: center, y: start.y },
      { x: center, y: end.y }
    ]
  ];
};

/** The line across the middle of the box, from the first anchor's time to the second's. */
const across = (start: Point, end: Point): Segment[] => {
  const middle = (start.y + end.y) / 2;
  return [
    [
      { x: start.x, y: middle },
      { x: end.x, y: middle }
    ]
  ];
};

/** Measures the change between two anchors: an arrow towards the second, labelled beyond it. */
export const priceRange = /* @__PURE__ */ rangeType({
  type: 'price-range',
  fields: ['lineWidth', 'fill', 'fontSize'],
  color: changeColor,
  fill: (_geometry, color) => withAlpha(color, 0.14),
  arrows: down,
  label: changeText,
  above: (start, end) => end.y <= start.y,
  levels: true
});

/** Measures the time between two anchors: an arrow towards the second, labelled below. */
export const dateRange = /* @__PURE__ */ rangeType({
  type: 'date-range',
  fields: ['color', 'lineWidth', 'fill', 'fillColor', 'fontSize'],
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  color: (geometry) => geometry.style.color,
  fill: (geometry) => geometry.style.fillColor,
  arrows: across,
  label: (geometry, from, to) =>
    `${geometry.texts.bars(barsBetween(geometry, from, to))} · ${durationText(geometry, from, to)}`,
  above: () => false,
  levels: false
});

/** Measures both the change and the time between two anchors. */
export const datePriceRange = /* @__PURE__ */ rangeType({
  type: 'date-price-range',
  fields: ['lineWidth', 'fill', 'fontSize'],
  color: changeColor,
  fill: (_geometry, color) => withAlpha(color, 0.14),
  arrows: (start, end) => [...down(start, end), ...across(start, end)],
  label: (geometry, from, to) =>
    `${changeText(geometry, from, to)} · ${durationText(geometry, from, to)}`,
  above: () => false,
  levels: true
});

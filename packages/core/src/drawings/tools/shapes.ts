import type { Point } from '../../interaction/types';
import { applyStroke } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import {
  boundsOf,
  extendSides,
  insideRect,
  segmentsOf,
  textLineHeight,
  type Segment
} from '../geometry';
import type {
  Anchors,
  DrawingBounds,
  DrawingField,
  DrawingGeometry,
  DrawingHandle,
  DrawingLevel,
  DrawingPoint,
  DrawingSpace,
  DrawingStyle,
  DrawingTypeDefinition
} from '../types';
import { arrowInset, paintArrowHead, paintBoxText, paintTextBlock } from './labels';
import { sideLevel } from './lines';
import { bodyHit, fillArea, segmentsHit, shapeHit, strokeDrawing, tracePath } from './shared';

export const TEXT_PADDING = 4;

/**
 * The top and the bottom edge of the box between two anchors, between their times; a style that
 * extends the box extends them too.
 */
export function boxLevels([first, second]: Anchors<2>, style: DrawingStyle | null): DrawingLevel[] {
  const start = Math.min(first.time, second.time);
  const end = Math.max(first.time, second.time);
  const edge = (key: string, price: number): DrawingLevel => {
    const from = { time: start, price };
    const to = { time: end, price };
    return style ? sideLevel(key, from, to, style) : { key, from, to };
  };
  return [
    edge('top', Math.max(first.price, second.price)),
    edge('bottom', Math.min(first.price, second.price))
  ];
}

/** Fields of the shapes the style fills and extends. */
const SHAPE_FIELDS: readonly DrawingField[] = [
  'color',
  'lineWidth',
  'lineStyle',
  'fill',
  'fillColor',
  'extendLeft',
  'extendRight'
];

/** Corners of the axis-aligned box spanned by two opposite corners, in drawing order. */
export function corners(first: Point, second: Point): Point[] {
  return [first, { x: second.x, y: first.y }, second, { x: first.x, y: second.y }];
}

/**
 * The box spanned by two anchors, reaching the left or the right edge of the plot as the style
 * extends it: its area, its corners in drawing order, and its border, without the sides it
 * reaches past.
 */
function extendedBox(geometry: DrawingGeometry<Anchors<2>>): {
  area: Point[];
  border: Segment[];
} {
  const [first, second] = geometry.points;
  const { extendLeft, extendRight } = geometry.style;
  const firstLeft = first.x <= second.x;
  const stretch = (point: Point, left: boolean): Point => ({
    x: left
      ? extendLeft
        ? Math.min(0, point.x)
        : point.x
      : extendRight
        ? Math.max(geometry.width, point.x)
        : point.x,
    y: point.y
  });
  const area = corners(stretch(first, firstLeft), stretch(second, !firstLeft));
  // The sides of the closed box: at the first anchor's time, along its value, at the second
  // anchor's time and along its value.
  const open = [
    firstLeft ? extendLeft : extendRight,
    false,
    firstLeft ? extendRight : extendLeft,
    false
  ];
  return { area, border: segmentsOf(area, true).filter((_, index) => !open[index]) };
}

/** The diagonal resize cursor of a corner, seen from the opposite corner. */
function cornerCursor(corner: Point, opposite: Point): string {
  return (corner.x - opposite.x) * (corner.y - opposite.y) > 0 ? 'nwse-resize' : 'nesw-resize';
}

/**
 * Handles of a box: its four corners and the middle of its four edges. Corners are named after
 * the anchors their time and value come from (`ab`: the time of the first, the value of the
 * second); edges after the anchor field they move.
 */
export function boxHandles(geometry: DrawingGeometry<Anchors<2>>): DrawingHandle[] {
  const [a, b] = geometry.points;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ab = { x: a.x, y: b.y };
  const ba = { x: b.x, y: a.y };
  return [
    { id: '0', ...a, cursor: cornerCursor(a, b) },
    { id: '1', ...b, cursor: cornerCursor(b, a) },
    { id: 'ab', ...ab, cursor: cornerCursor(ab, ba) },
    { id: 'ba', ...ba, cursor: cornerCursor(ba, ab) },
    { id: 'price-0', x: middle.x, y: a.y, cursor: 'ns-resize' },
    { id: 'price-1', x: middle.x, y: b.y, cursor: 'ns-resize' },
    { id: 'time-0', x: a.x, y: middle.y, cursor: 'ew-resize' },
    { id: 'time-1', x: b.x, y: middle.y, cursor: 'ew-resize' }
  ];
}

export function moveBoxHandle([a, b]: Anchors<2>, handle: string, to: DrawingPoint): Anchors<2> {
  switch (handle) {
    case '0':
      return [to, b];
    case '1':
      return [a, to];
    case 'ab':
      return [
        { time: to.time, price: a.price },
        { time: b.time, price: to.price }
      ];
    case 'ba':
      return [
        { time: a.time, price: to.price },
        { time: to.time, price: b.price }
      ];
    case 'price-0':
      return [{ ...a, price: to.price }, b];
    case 'price-1':
      return [a, { ...b, price: to.price }];
    case 'time-0':
      return [{ ...a, time: to.time }, b];
    default:
      return [a, { ...b, time: to.time }];
  }
}

export const rectangle: DrawingTypeDefinition<Anchors<2>> = {
  type: 'rectangle',
  points: 2,
  // Written out: spreading arrays here would keep it in charts that do not register it.
  fields: [
    'color',
    'lineWidth',
    'lineStyle',
    'fill',
    'fillColor',
    'extendLeft',
    'extendRight',
    'text',
    'textColor',
    'fontSize',
    'bold',
    'italic',
    'textAlign',
    'textPosition'
  ],
  defaultStyle: (theme) => ({
    fillColor: withAlpha(theme.accent, 0.12),
    textAlign: 'center',
    textPosition: 'middle'
  }),
  paint: (context) => {
    const [first, second] = context.geometry.points;
    const box = extendedBox(context.geometry);

    if (context.geometry.style.fill) {
      fillArea(context.ctx, box.area, context.geometry.style.fillColor);
    }

    strokeDrawing(context, (ctx) => {
      if (box.border.length === 4) {
        tracePath(ctx, box.area, true);
      } else {
        box.border.forEach((side) => {
          tracePath(ctx, side, false);
        });
      }
    });
    paintBoxText(context, first, second);
  },
  hitTest: (geometry, point, tolerance) => {
    const box = extendedBox(geometry);
    return shapeHit(point, box.border, box.area, tolerance, geometry.style.fill);
  },
  bounds: (geometry) => boundsOf(extendedBox(geometry).area),
  handles: boxHandles,
  moveHandle: moveBoxHandle,
  levels: (anchors, _scale, style) => boxLevels(anchors, style)
};

interface Channel {
  readonly base: Segment;
  readonly parallel: Segment;
  /** The base line and its parallel. */
  readonly lines: readonly Segment[];
  readonly middle: Segment;
  readonly area: readonly Point[];
}

/** The shift moving the base line through `through`: vertical, or horizontal for a vertical base. */
function channelOffset(start: Point, end: Point, through: Point): Point {
  if (start.x === end.x) {
    return { x: through.x - start.x, y: 0 };
  }

  const baseY = start.y + ((through.x - start.x) / (end.x - start.x)) * (end.y - start.y);
  return { x: 0, y: through.y - baseY };
}

/** The anchors' lines, which `extended` reaches as far as the style extends them. */
function channelOf(geometry: DrawingGeometry<Anchors<3>>, extended: boolean): Channel {
  const [start, end, through] = geometry.points;
  const { width, height, style } = geometry;
  const offset = channelOffset(start, end, through);
  const shift = (point: Point, factor: number): Point => ({
    x: point.x + offset.x * factor,
    y: point.y + offset.y * factor
  });
  const [from, to] = extended
    ? extendSides(start, end, width, height, style.extendLeft, style.extendRight)
    : [start, end];
  const base: Segment = [from, to];
  const parallel: Segment = [shift(from, 1), shift(to, 1)];
  return {
    base,
    parallel,
    lines: [base, parallel],
    middle: [shift(from, 0.5), shift(to, 0.5)],
    area: [from, to, parallel[1], parallel[0]]
  };
}

/**
 * Six handles: the ends of both lines (`0`, `1`, `p0`, `p1`), which move and resize the channel at
 * its height, and the middle of both lines (`m0`, `m1`), which change the height.
 */
function channelHandles(geometry: DrawingGeometry<Anchors<3>>): DrawingHandle[] {
  const { base, parallel } = channelOf(geometry, false);
  const middle = ([from, to]: Segment): Point => ({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  });
  return [
    { id: '0', ...base[0] },
    { id: '1', ...base[1] },
    { id: 'p0', ...parallel[0] },
    { id: 'p1', ...parallel[1] },
    { id: 'm0', ...middle(base), cursor: 'ns-resize' },
    { id: 'm1', ...middle(parallel), cursor: 'ns-resize' }
  ];
}

/**
 * Applies a channel handle in the space the channel is drawn in, so that the handle ends under
 * the pointer on a logarithmic scale and across gaps between bars too. The third anchor is kept at
 * the time of the first, so the height is exactly its distance from the base line there.
 */
function moveChannelHandle(
  [start, end, through]: Anchors<3>,
  handle: string,
  to: DrawingPoint,
  space: DrawingSpace
): Anchors<3> {
  const x = (point: DrawingPoint) => space.barIndex(point.time);
  const y = (point: DrawingPoint) => space.toScale(point.price);
  /** The base line's height at bar position `at`. */
  const base = (at: number) =>
    x(start) === x(end)
      ? y(start)
      : y(start) + ((at - x(start)) / (x(end) - x(start))) * (y(end) - y(start));
  const raised = (point: DrawingPoint, offset: number): DrawingPoint => ({
    time: point.time,
    price: space.fromScale(y(point) + offset)
  });
  const height = y(through) - base(x(through));
  const channel = (from: DrawingPoint, until: DrawingPoint, offset: number): Anchors<3> => [
    from,
    until,
    raised(from, offset)
  ];
  const lowered = raised(to, -height);

  switch (handle) {
    case '0':
      return channel(to, end, height);
    case '1':
      return channel(start, to, height);
    case 'p0':
      return channel(lowered, end, height);
    case 'p1':
      return channel(start, lowered, height);
    case 'm0': {
      // The base line moves to the pointer; the parallel stays.
      const shift = y(to) - base(x(to));
      return channel(raised(start, shift), raised(end, shift), height - shift);
    }
    default:
      return channel(start, end, y(to) - base(x(to)));
  }
}

export const parallelChannel: DrawingTypeDefinition<Anchors<3>> = {
  type: 'parallel-channel',
  points: 3,
  fields: SHAPE_FIELDS,
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const channel = channelOf(context.geometry, true);

    if (context.geometry.style.fill) {
      fillArea(context.ctx, channel.area, context.geometry.style.fillColor);
    }

    strokeDrawing(context, (ctx) => {
      channel.lines.forEach((line) => {
        tracePath(ctx, line, false);
      });
    });
    strokeDrawing(
      context,
      (ctx) => {
        tracePath(ctx, channel.middle, false);
      },
      { lineStyle: 'dashed' }
    );
  },
  hitTest: (geometry, point, tolerance) => {
    const channel = channelOf(geometry, true);
    return shapeHit(point, channel.lines, channel.area, tolerance, geometry.style.fill);
  },
  bounds: (geometry) => boundsOf(channelOf(geometry, true).area),
  handles: channelHandles,
  moveHandle: moveChannelHandle,
  // The parallel is offset as drawn: through the third anchor, by a constant distance in the
  // pane's scale from the base line where it is.
  levels: ([start, end, through], scale, style, { barIndex }) => {
    const share =
      through.time === start.time
        ? 0
        : (barIndex(through.time) - barIndex(start.time)) /
          (barIndex(end.time) - barIndex(start.time));
    const from = scale.toScale(start.price);
    const base = from + share * (scale.toScale(end.price) - from);
    const offset = scale.toScale(through.price) - base;
    const shifted = (point: DrawingPoint, share: number): DrawingPoint => ({
      time: point.time,
      price: scale.fromScale(scale.toScale(point.price) + offset * share)
    });
    return [
      sideLevel('base', start, end, style),
      sideLevel('parallel', shifted(start, 1), shifted(end, 1), style),
      sideLevel('middle', shifted(start, 0.5), shifted(end, 0.5), style)
    ];
  },
  axisMarks: ([start, end]) => ({
    prices: [start.price, end.price],
    times: [start.time, end.time]
  })
};

export function linesOf(geometry: DrawingGeometry): string[] {
  return (geometry.text === '' ? geometry.texts.text : geometry.text).split('\n');
}

/** The padded box around the text: the anchor is its left edge, at the middle of the first line. */
function textBox(geometry: DrawingGeometry<Anchors<1>>): DrawingBounds {
  const [anchor] = geometry.points;
  const lines = linesOf(geometry);
  const lineHeight = textLineHeight(geometry.style.fontSize);
  const width = Math.max(...lines.map((line) => geometry.measureText(line)));
  return {
    x: anchor.x - TEXT_PADDING,
    y: anchor.y - lineHeight / 2 - TEXT_PADDING,
    width: width + TEXT_PADDING * 2,
    height: lines.length * lineHeight + TEXT_PADDING * 2
  };
}

/**
 * Text in one or more lines, edited in place; moved by dragging it. Its style can set a
 * background.
 */
export const text: DrawingTypeDefinition<Anchors<1>> = {
  type: 'text',
  points: 1,
  editableText: true,
  fields: ['text', 'textColor', 'fontSize', 'bold', 'italic', 'textAlign', 'fill', 'fillColor'],
  defaultStyle: (theme) => ({ fill: false, fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const { ctx, geometry, hovered, selected, editing } = context;
    const [anchor] = geometry.points;
    const box = textBox(geometry);

    if (editing) {
      return;
    }

    if (geometry.style.fill) {
      ctx.fillStyle = geometry.style.fillColor;
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }

    if (hovered || selected) {
      ctx.fillStyle = withAlpha(geometry.style.color, 0.08);
      ctx.fillRect(box.x, box.y, box.width, box.height);
      applyStroke(ctx, withAlpha(geometry.style.color, selected ? 0.9 : 0.5), 1);
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
    }

    const { textColor } = geometry.style;
    paintTextBlock(
      context,
      linesOf(geometry),
      anchor.x,
      anchor.y,
      box.width - TEXT_PADDING * 2,
      geometry.text === '' ? withAlpha(textColor, 0.5) : textColor
    );
  },
  hitTest: (geometry, point, tolerance) => {
    const box = textBox(geometry);
    return insideRect(
      point,
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      tolerance
    )
      ? bodyHit
      : null;
  },
  handles: () => [],
  axisMarks: () => ({ prices: [], times: [] }),
  bounds: textBox
};

/** An open-ended polyline through every anchor, with arrowheads at its ends as the style says. */
export const path: DrawingTypeDefinition<Anchors<0>> = {
  type: 'path',
  points: 0,
  fields: ['color', 'lineWidth', 'lineStyle', 'startArrow', 'endArrow'],
  paint: (context) => {
    const { ctx, geometry } = context;
    const { points, style } = geometry;
    const [first, second] = points;
    // The last two, walking on from the first two.
    const [beforeLast, end] = points
      .slice(2)
      .reduce<[Point, Point]>(([, previous], point) => [previous, point], [first, second]);

    // The ends stop inside their arrowheads, as a trend line's do.
    const inset = (tip: Point, from: Point): Point => {
      const length = Math.hypot(tip.x - from.x, tip.y - from.y);
      const share = length === 0 ? 0 : arrowInset(style, length) / length;
      return { x: tip.x + (from.x - tip.x) * share, y: tip.y + (from.y - tip.y) * share };
    };
    const traced = [...points];

    if (style.startArrow) {
      traced[0] = inset(first, second);
    }

    if (style.endArrow) {
      traced[traced.length - 1] = inset(end, beforeLast);
    }

    strokeDrawing(context, (path) => {
      tracePath(path, traced, false);
    });

    if (style.startArrow) {
      paintArrowHead(ctx, first, Math.atan2(first.y - second.y, first.x - second.x), style);
    }

    if (style.endArrow) {
      paintArrowHead(ctx, end, Math.atan2(end.y - beforeLast.y, end.x - beforeLast.x), style);
    }
  },
  hitTest: (geometry, point, tolerance) =>
    segmentsHit(point, segmentsOf(geometry.points, false), tolerance),
  bounds: (geometry) => boundsOf(geometry.points)
};

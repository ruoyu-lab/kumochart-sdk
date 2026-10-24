import { font } from '../../canvas/canvas';
import type { Point } from '../../interaction/types';
import { boundsOf, extendSegment, extendSides, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingField,
  DrawingGeometry,
  DrawingLevel,
  DrawingPoint,
  DrawingStyle,
  DrawingTypeDefinition
} from '../types';
import { arrowInset, paintArrowHead, paintSegmentText, segmentTextReach } from './labels';
import { segmentHit, segmentsHit, strokeDrawing, tracePath } from './shared';

/** The fields of a drawing's text, for the types that paint it. */
const TEXT_FIELDS: readonly DrawingField[] = [
  'text',
  'textColor',
  'fontSize',
  'bold',
  'italic',
  'textAlign',
  'textPosition'
];
const LINE_FIELDS: readonly DrawingField[] = ['color', 'lineWidth', 'lineStyle'];
const ARROW_FIELDS: readonly DrawingField[] = ['startArrow', 'endArrow'];
const EXTEND_FIELDS: readonly DrawingField[] = ['extendLeft', 'extendRight'];

/** The line through two anchors, reaching on past the earlier or the later one as the style says. */
export function sideLevel(
  key: string,
  from: DrawingPoint,
  to: DrawingPoint,
  style: DrawingStyle
): DrawingLevel {
  const [earlier, later] = from.time <= to.time ? [from, to] : [to, from];

  if (style.extendLeft && style.extendRight) {
    return { key, from: earlier, to: later, extend: 'both' };
  }

  if (style.extendRight) {
    return { key, from: earlier, to: later, extend: 'end' };
  }

  return style.extendLeft
    ? { key, from: later, to: earlier, extend: 'end' }
    : { key, from, to, extend: 'none' };
}

/**
 * A straight line through two anchors: a segment the style extends, a ray, or a whole line;
 * `arrow` gives the segment an arrowhead at its second anchor.
 */
function lineType(
  type: string,
  mode: 'segment' | 'ray' | 'line',
  arrow = false
): DrawingTypeDefinition<Anchors<2>> {
  const ends = ({
    points: [start, end],
    width,
    height,
    style
  }: DrawingGeometry<Anchors<2>>): Segment =>
    mode === 'segment'
      ? extendSides(start, end, width, height, style.extendLeft, style.extendRight)
      : extendSegment(start, end, width, height, mode);

  return {
    type,
    points: 2,
    fields:
      mode === 'segment'
        ? [...LINE_FIELDS, ...EXTEND_FIELDS, ...ARROW_FIELDS, ...TEXT_FIELDS]
        : [...LINE_FIELDS, ...TEXT_FIELDS],
    defaultStyle: () => ({ textAlign: 'center', ...(arrow ? { endArrow: true } : {}) }),
    paint: (context) => {
      const { ctx, geometry } = context;
      const [start, end] = geometry.points;
      const line = ends(geometry);
      const { style } = geometry;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      // An arrowhead goes on an end the line stops at; the line stops inside it, so its cap
      // does not poke through the tip.
      const startArrow = style.startArrow && line[0] === start && length > 0;
      const endArrow = style.endArrow && line[1] === end && length > 0;
      const inset = arrowInset(style, length);
      const from = startArrow
        ? { x: start.x + inset * Math.cos(angle), y: start.y + inset * Math.sin(angle) }
        : line[0];
      const to = endArrow
        ? { x: end.x - inset * Math.cos(angle), y: end.y - inset * Math.sin(angle) }
        : line[1];
      strokeDrawing(context, (path) => {
        path.moveTo(from.x, from.y);
        path.lineTo(to.x, to.y);
      });

      if (startArrow) {
        paintArrowHead(ctx, start, angle + Math.PI, style);
      }

      if (endArrow) {
        paintArrowHead(ctx, end, angle, style);
      }

      paintSegmentText(context, start, end);
    },
    hitTest: (geometry, point, tolerance) => {
      const [from, to] = ends(geometry);
      return segmentHit(point, from, to, tolerance);
    },
    bounds: (geometry) => boundsOf(ends(geometry), segmentTextReach(geometry)),
    levels: ([from, to], _scale, style) =>
      mode === 'segment'
        ? [sideLevel('line', from, to, style)]
        : [{ key: 'line', from, to, extend: mode === 'ray' ? 'end' : 'both' }]
  };
}

export const trendLine = /* @__PURE__ */ lineType('trend-line', 'segment');
export const ray = /* @__PURE__ */ lineType('ray', 'ray');
export const extendedLine = /* @__PURE__ */ lineType('extended-line', 'line');
/** A trend line ending in an arrowhead at the second anchor. */
export const arrow = /* @__PURE__ */ lineType('arrow', 'segment', true);

/** A horizontal line through the anchor's value; its value stays labelled on the price axis. */
function horizontalType(type: string, fromAnchor: boolean): DrawingTypeDefinition<Anchors<1>> {
  const ends = ({ points: [anchor], width }: DrawingGeometry<Anchors<1>>): Segment => [
    { x: fromAnchor ? anchor.x : 0, y: anchor.y },
    { x: width, y: anchor.y }
  ];

  return {
    type,
    points: 1,
    fields: [...LINE_FIELDS, ...TEXT_FIELDS],
    defaultStyle: () => ({ textAlign: fromAnchor ? 'left' : 'right' }),
    paint: (context) => {
      const [from, to] = ends(context.geometry);
      strokeDrawing(context, (ctx) => {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      });
      paintSegmentText(context, from, to);
    },
    hitTest: (geometry, point, tolerance) => {
      const [from, to] = ends(geometry);
      return segmentHit(point, from, to, tolerance);
    },
    bounds: (geometry) => boundsOf(ends(geometry), segmentTextReach(geometry)),
    axisMarks: ([anchor]) => ({ prices: [anchor.price], times: [], always: true }),
    levels: ([anchor]) => [
      { key: 'line', from: anchor, to: anchor, extend: fromAnchor ? 'end' : 'both' }
    ]
  };
}

export const horizontalLine = /* @__PURE__ */ horizontalType('horizontal-line', false);
export const horizontalRay = /* @__PURE__ */ horizontalType('horizontal-ray', true);

/** The vertical line at an anchor, from the top of the plot to its bottom. */
function verticalOf({ points: [anchor], height }: DrawingGeometry<Anchors<1>>): Segment {
  return [
    { x: anchor.x, y: 0 },
    { x: anchor.x, y: height }
  ];
}

/** A vertical line at the anchor's time; its time stays labelled on the time axis. */
export const verticalLine: DrawingTypeDefinition<Anchors<1>> = {
  type: 'vertical-line',
  points: 1,
  // Written out: spreading arrays here would keep it in charts that do not register it.
  fields: [
    'color',
    'lineWidth',
    'lineStyle',
    'text',
    'textColor',
    'fontSize',
    'bold',
    'italic',
    'textAlign',
    'textPosition'
  ],
  defaultStyle: () => ({ textAlign: 'center' }),
  paint: (context) => {
    const [top, bottom] = verticalOf(context.geometry);
    strokeDrawing(context, (ctx) => {
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
    });
    paintSegmentText(context, bottom, top);
  },
  hitTest: (geometry, point, tolerance) => {
    const [top, bottom] = verticalOf(geometry);
    return segmentHit(point, top, bottom, tolerance);
  },
  bounds: (geometry) => boundsOf(verticalOf(geometry), segmentTextReach(geometry)),
  axisMarks: ([anchor]) => ({ prices: [], times: [anchor.time], always: true })
};

/** The horizontal and the vertical line through the anchor, across the plot. */
function crossOf(geometry: DrawingGeometry<Anchors<1>>): Segment[] {
  const [anchor] = geometry.points;
  return [
    [
      { x: 0, y: anchor.y },
      { x: geometry.width, y: anchor.y }
    ],
    verticalOf(geometry)
  ];
}

/**
 * A horizontal and a vertical line crossing at the anchor; its value and time stay labelled on
 * the axes. Alerts watch its horizontal line.
 */
export const crossLine: DrawingTypeDefinition<Anchors<1>> = {
  type: 'cross-line',
  points: 1,
  fields: LINE_FIELDS,
  paint: (context) => {
    strokeDrawing(context, (ctx) => {
      for (const line of crossOf(context.geometry)) {
        tracePath(ctx, line, false);
      }
    });
  },
  hitTest: (geometry, point, tolerance) => segmentsHit(point, crossOf(geometry), tolerance),
  bounds: (geometry) => boundsOf(crossOf(geometry).flat()),
  axisMarks: ([anchor]) => ({ prices: [anchor.price], times: [anchor.time], always: true }),
  levels: ([anchor]) => [{ key: 'line', from: anchor, to: anchor, extend: 'both' }]
};

/** Radius of the arc of a trend angle, unless its line is shorter. */
const ANGLE_RADIUS = 50;
const ANGLE_GAP = 6;

/** The angle of the line from `start` to `end` on screen, in degrees up from the horizontal. */
export function screenAngle(start: Point, end: Point): number {
  return (Math.atan2(start.y - end.y, end.x - start.x) * 180) / Math.PI;
}

interface TrendAngle {
  readonly start: Point;
  /** The line as far as the style extends it. */
  readonly line: Segment;
  /** In degrees up from the horizontal, and the radius of the arc showing it. */
  readonly angle: number;
  readonly radius: number;
  /** The degrees, past the level on the side away from the line. */
  readonly label: { readonly text: string; readonly x: number; readonly y: number };
}

function trendAngleOf(geometry: DrawingGeometry<Anchors<2>>): TrendAngle {
  const [start, end] = geometry.points;
  const { style, width, height } = geometry;
  const angle = screenAngle(start, end);
  const radius = Math.min(ANGLE_RADIUS, Math.hypot(end.x - start.x, end.y - start.y));
  return {
    start,
    line: extendSides(start, end, width, height, style.extendLeft, style.extendRight),
    angle,
    radius,
    label: {
      text: `${angle.toFixed(2)}°`,
      x: start.x + radius + ANGLE_GAP,
      y: start.y + (angle >= 0 ? 2 : -2)
    }
  };
}

/**
 * A trend line labelled with its angle on screen, in degrees up from the horizontal: a dotted
 * level from the first anchor and an arc up to the line show it. As the angle is the one drawn,
 * it changes as the chart is zoomed.
 */
export const trendAngle: DrawingTypeDefinition<Anchors<2>> = {
  type: 'trend-angle',
  points: 2,
  // Written out: spreading arrays here would keep it in charts that do not register it.
  fields: ['color', 'lineWidth', 'lineStyle', 'extendLeft', 'extendRight', 'fontSize'],
  paint: (context) => {
    const { ctx, geometry } = context;
    const { start, line, angle, radius, label } = trendAngleOf(geometry);
    const { style } = geometry;
    strokeDrawing(context, (path) => {
      tracePath(path, line, false);
    });

    const sweep = (-angle * Math.PI) / 180;
    strokeDrawing(
      context,
      (path) => {
        path.moveTo(start.x, start.y);
        path.lineTo(start.x + radius, start.y);
        path.arc(start.x, start.y, radius, 0, sweep, sweep < 0);
      },
      { lineWidth: 1, lineStyle: 'dotted' }
    );

    ctx.font = font(style.fontSize, geometry.fontFamily);
    ctx.fillStyle = style.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = angle >= 0 ? 'top' : 'bottom';
    ctx.fillText(label.text, label.x, label.y);
  },
  hitTest: (geometry, point, tolerance) => {
    const [from, to] = trendAngleOf(geometry).line;
    return segmentHit(point, from, to, tolerance);
  },
  // The line, the arc's circle and the degrees.
  bounds: (geometry) => {
    const { start, radius, label, angle, line } = trendAngleOf(geometry);
    const { fontSize } = geometry.style;
    return boundsOf([
      ...line,
      { x: start.x - radius, y: start.y - radius },
      { x: start.x + radius, y: start.y + radius },
      {
        x: label.x + geometry.measureText(label.text),
        y: label.y + (angle >= 0 ? fontSize : -fontSize)
      }
    ]);
  },
  levels: ([from, to], _scale, style) => [sideLevel('line', from, to, style)]
};

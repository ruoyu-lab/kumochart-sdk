import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, segmentsOf, textLineHeight } from '../geometry';
import type {
  Anchors,
  DrawingField,
  DrawingGeometry,
  DrawingHandle,
  DrawingHit,
  DrawingPaintContext,
  DrawingPoint,
  DrawingTypeDefinition
} from '../types';
import { paintTextBlock } from './labels';
import { bodyHit, fillArea, shapeHit, strokeDrawing, tracePath } from './shared';

/** Fields of the round shapes, which write their text in the middle. */
const ROUND_FIELDS: readonly DrawingField[] = [
  'color',
  'lineWidth',
  'lineStyle',
  'fill',
  'fillColor',
  'text',
  'textColor',
  'fontSize',
  'bold',
  'italic'
];

/** An ellipse on screen: its center, half axes and the angle of its first axis. */
interface Oval {
  readonly center: Point;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotation: number;
}

/** Paints an oval with the drawing's fill and line, and its text centered in it. */
function paintOval(context: DrawingPaintContext, oval: Oval): void {
  const { ctx, geometry, editing } = context;
  const { center, radiusX, radiusY, rotation } = oval;
  const trace = (path: CanvasRenderingContext2D) => {
    path.ellipse(center.x, center.y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  };

  if (geometry.style.fill) {
    ctx.beginPath();
    trace(ctx);
    ctx.fillStyle = geometry.style.fillColor;
    ctx.fill();
  }

  strokeDrawing(context, trace);

  if (!editing && geometry.text !== '') {
    const lines = geometry.text.split('\n');
    const lineHeight = textLineHeight(geometry.style.fontSize);
    paintTextBlock(
      { ...context, geometry: { ...geometry, style: { ...geometry.style, textAlign: 'center' } } },
      lines,
      center.x,
      center.y - ((lines.length - 1) * lineHeight) / 2,
      0,
      geometry.style.textColor
    );
  }
}

/** A `line` hit on the oval's outline, else a `body` hit inside it when it is `filled`. */
function ovalHit(oval: Oval, point: Point, tolerance: number, filled: boolean): DrawingHit | null {
  const { center, radiusX, radiusY, rotation } = oval;

  if (radiusX <= 0 || radiusY <= 0) {
    return null;
  }

  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const along = (dx * Math.cos(rotation) + dy * Math.sin(rotation)) / radiusX;
  const across = (-dx * Math.sin(rotation) + dy * Math.cos(rotation)) / radiusY;
  const reach = Math.hypot(along, across);
  // Distance from the outline, close enough near it for an oval that is not too flat.
  const distance = Math.abs(reach - 1) * Math.min(radiusX, radiusY);

  if (distance <= tolerance) {
    return { part: 'line', distance };
  }

  return filled && reach < 1 ? bodyHit : null;
}

function ovalBounds({ center, radiusX, radiusY, rotation }: Oval) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfWidth = Math.hypot(radiusX * cos, radiusY * sin);
  const halfHeight = Math.hypot(radiusX * sin, radiusY * cos);
  return {
    x: center.x - halfWidth,
    y: center.y - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2
  };
}

function circleOf(geometry: DrawingGeometry<Anchors<2>>): Oval {
  const [center, edge] = geometry.points;
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  return { center, radiusX: radius, radiusY: radius, rotation: 0 };
}

/**
 * A circle around the first anchor through the second, round on screen as zooming stretches the
 * chart, with its text in the middle.
 */
export const circle: DrawingTypeDefinition<Anchors<2>> = {
  type: 'circle',
  points: 2,
  fields: ROUND_FIELDS,
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    paintOval(context, circleOf(context.geometry));
  },
  hitTest: (geometry, point, tolerance) =>
    ovalHit(circleOf(geometry), point, tolerance, geometry.style.fill),
  bounds: (geometry) => ovalBounds(circleOf(geometry)),
  axisMarks: ([center]) => ({ prices: [center.price], times: [center.time] })
};

/**
 * The ellipse whose first axis runs from the first anchor to the second; the third anchor's
 * distance from that axis is half the other axis. `null` while the axis has no length.
 */
function ellipseOf(geometry: DrawingGeometry<Anchors<3>>): (Oval & { normal: Point }) | null {
  const [start, end, side] = geometry.points;
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  if (length === 0) {
    return null;
  }

  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const offset = (side.x - center.x) * normal.x + (side.y - center.y) * normal.y;
  return {
    center,
    radiusX: length / 2,
    radiusY: Math.abs(offset),
    rotation: Math.atan2(end.y - start.y, end.x - start.x),
    normal: offset < 0 ? { x: -normal.x, y: -normal.y } : normal
  };
}

/**
 * An ellipse at any angle: the first two anchors are the ends of one axis and the third sets the
 * width across it. Its handles are the ends of the axis and the end of the other half axis.
 */
export const ellipse: DrawingTypeDefinition<Anchors<3>> = {
  type: 'ellipse',
  points: 3,
  fields: ROUND_FIELDS,
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const oval = ellipseOf(context.geometry);

    if (oval) {
      paintOval(context, oval);
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const oval = ellipseOf(geometry);
    return oval ? ovalHit(oval, point, tolerance, geometry.style.fill) : null;
  },
  handles: (geometry): DrawingHandle[] => {
    const [start, end] = geometry.points;
    const oval = ellipseOf(geometry);

    if (!oval) {
      return geometry.points.map((point, index) => ({ id: String(index), ...point }));
    }

    return [
      { id: '0', ...start },
      { id: '1', ...end },
      {
        id: '2',
        x: oval.center.x + oval.normal.x * oval.radiusY,
        y: oval.center.y + oval.normal.y * oval.radiusY
      }
    ];
  },
  bounds: (geometry) => {
    const oval = ellipseOf(geometry);
    return oval && ovalBounds(oval);
  },
  // The ends of the axis; the third anchor only sets the width.
  axisMarks: ([start, end]) => ({
    prices: [start.price, end.price],
    times: [start.time, end.time]
  })
};

/** A triangle through three anchors, filled. */
export const triangle: DrawingTypeDefinition<Anchors<3>> = {
  type: 'triangle',
  points: 3,
  fields: ['color', 'lineWidth', 'lineStyle', 'fill', 'fillColor'],
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const { points } = context.geometry;

    if (context.geometry.style.fill) {
      fillArea(context.ctx, points, context.geometry.style.fillColor);
    }

    strokeDrawing(context, (ctx) => {
      tracePath(ctx, points, true);
    });
  },
  hitTest: (geometry, point, tolerance) =>
    shapeHit(
      point,
      segmentsOf(geometry.points, true),
      geometry.points,
      tolerance,
      geometry.style.fill
    ),
  bounds: (geometry) => boundsOf(geometry.points)
};

/** Half the width of a rotated rectangle: how far `c` is from its middle line through `a` and `b`. */
function halfWidth(a: Point, b: Point, c: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0
    ? Math.hypot(c.x - a.x, c.y - a.y)
    : Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / length;
}

/** Where `half` from `from` square to the line from `from` to `to` is, on its left. */
function aside(from: Point, to: Point, half: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0
    ? from
    : {
        x: from.x - ((to.y - from.y) / length) * half,
        y: from.y + ((to.x - from.x) / length) * half
      };
}

/**
 * The corners of a rectangle along its middle line from `a` to `b`, as wide on each side as `c`
 * is from that line: around from the corner beside `a`.
 */
function rotatedCorners([a, b, c]: readonly [Point, Point, Point]): Point[] {
  const half = halfWidth(a, b, c);
  return [aside(a, b, half), aside(b, a, -half), aside(b, a, half), aside(a, b, -half)];
}

/**
 * A rectangle at any angle, as along a sloping channel or a flag: its middle line from the first
 * anchor to the second, the middles of its ends, and as wide on each side as the third anchor is
 * from it, filled. Its handles are those ends and its four corners: an end turns or stretches it
 * at its width, as the screen shows it; a corner widens or narrows it on both sides.
 */
export const rotatedRectangle: DrawingTypeDefinition<Anchors<3>> = {
  type: 'rotated-rectangle',
  points: 3,
  fields: ['color', 'lineWidth', 'lineStyle', 'fill', 'fillColor'],
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const corners = rotatedCorners(context.geometry.points);

    if (context.geometry.style.fill) {
      fillArea(context.ctx, corners, context.geometry.style.fillColor);
    }

    strokeDrawing(context, (ctx) => {
      tracePath(ctx, corners, true);
    });
  },
  hitTest: (geometry, point, tolerance) => {
    const corners = rotatedCorners(geometry.points);
    return shapeHit(point, segmentsOf(corners, true), corners, tolerance, geometry.style.fill);
  },
  bounds: (geometry) => boundsOf(rotatedCorners(geometry.points)),
  handles: (geometry) => {
    const [a, b] = geometry.points;
    return [
      { id: '0', ...a },
      { id: '1', ...b },
      ...rotatedCorners(geometry.points).map((corner, index) => ({
        id: `corner-${String(index)}`,
        ...corner
      }))
    ];
  },
  moveHandle: ([a, b, c], handle, to, space) => {
    // A corner sets the width: as far from the middle line as it is dragged.
    if (handle.startsWith('corner-')) {
      return [a, b, to];
    }

    // An end keeps the width, measured as the screen shows it, as the line turns.
    const flat = (point: DrawingPoint): Point => ({
      x: space.barIndex(point.time),
      y: space.toScale(point.price) * space.unitHeight
    });
    const [from, until] = handle === '0' ? [to, b] : [a, to];
    const side = aside(flat(from), flat(until), halfWidth(flat(a), flat(b), flat(c)));
    const width = { time: space.timeAt(side.x), price: space.fromScale(side.y / space.unitHeight) };
    return Number.isFinite(width.time) && Number.isFinite(width.price)
      ? [from, until, width]
      : [from, until, c];
  },
  axisMarks: ([a, b]) => ({ prices: [a.price, b.price], times: [a.time, b.time] })
};

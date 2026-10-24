import { drawLabel, font } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, insidePolygon, segmentsOf, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingField,
  DrawingGeometry,
  DrawingPaintContext,
  DrawingPoint,
  DrawingTypeDefinition,
  Positions,
  WaveDegree
} from '../types';
import { WAVE_DEGREES } from '../style';
import {
  bodyHit,
  BOXED_LABEL_GAP,
  fillArea,
  ratioText,
  segmentsHit,
  strokeDrawing,
  tracePath
} from './shared';

/** Fields of the patterns, whose labels are boxes in the drawing's color. */
const PATTERN_FIELDS: readonly DrawingField[] = [
  'color',
  'lineWidth',
  'fill',
  'fillColor',
  'textColor',
  'fontSize',
  'bold',
  'italic'
];

/** Whether a point is a top: higher on screen than the points next to it, one or two. */
function isTop(point: Point, before: Point | undefined, after: Point | undefined): boolean {
  return [before, after].every((each) => !each || point.y <= each.y);
}

/** A label in a box of the drawing's color, above a top and below a bottom. */
function paintPointLabel(
  context: DrawingPaintContext,
  text: string,
  point: Point,
  above: boolean
): void {
  const { ctx, geometry } = context;
  const height = geometry.style.fontSize + 8;
  ctx.font = geometry.textFont;
  drawLabel(ctx, text, point.x, point.y + (above ? -1 : 1) * (BOXED_LABEL_GAP + height / 2), {
    background: geometry.style.color,
    color: geometry.style.textColor,
    paddingX: 6,
    height,
    align: 'center',
    radius: 3
  });
}

/** The points, with room for their labels above tops and below bottoms. */
function labelledPoints(
  geometry: DrawingGeometry,
  points: readonly Point[],
  labels: readonly string[]
) {
  const { fontSize } = geometry.style;
  const height = Math.max(fontSize + 8, fontSize * 1.5);
  const width = Math.max(0, ...labels.map((label) => geometry.measureText(label) + 12));
  return boundsOf(points, Math.max(BOXED_LABEL_GAP + height, width / 2));
}

/** A ratio in a box at the middle of the dotted line it measures. */
function paintRatio(context: DrawingPaintContext, value: number, from: Point, to: Point): void {
  const { ctx, geometry } = context;
  const height = geometry.style.fontSize + 6;
  ctx.font = font(geometry.style.fontSize - 1, geometry.fontFamily);
  drawLabel(ctx, ratioText(value), (from.x + to.x) / 2, (from.y + to.y) / 2, {
    background: geometry.style.color,
    color: geometry.style.textColor,
    paddingX: 5,
    height,
    align: 'center',
    radius: 3
  });
}

function dotted(context: DrawingPaintContext, line: Segment): void {
  strokeDrawing(
    context,
    (path) => {
      tracePath(path, line, false);
    },
    { lineWidth: 1, lineStyle: 'dotted' }
  );
}

/** The size of a move between two anchors. */
function move(from: DrawingPoint, to: DrawingPoint): number {
  return Math.abs(to.price - from.price);
}

const XABCD = ['X', 'A', 'B', 'C', 'D'];

/**
 * The retracements of an XABCD pattern, as they are labelled: AB of XA on the line XB, BC
 * of AB on AC, CD of BC on BD, and AD of XA on XD.
 */
export function xabcdRatios([x, a, b, c, d]: Anchors<5>): {
  readonly xb: number;
  readonly ac: number;
  readonly bd: number;
  readonly xd: number;
} {
  return {
    xb: move(a, b) / move(x, a),
    ac: move(b, c) / move(a, b),
    bd: move(c, d) / move(b, c),
    xd: move(a, d) / move(x, a)
  };
}

/**
 * A harmonic XABCD pattern (Gartley, butterfly, bat, crab): legs through the five points, the
 * triangles XAB and BCD filled, and dotted lines labelled with the retracement each measures.
 */
export const xabcdPattern: DrawingTypeDefinition<Anchors<5>> = {
  type: 'xabcd-pattern',
  points: 5,
  fields: PATTERN_FIELDS,
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12), textColor: '#ffffff' }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const { points } = geometry;
    const [x, a, b, c, d] = points;

    if (geometry.style.fill) {
      fillArea(ctx, [x, a, b], geometry.style.fillColor);
      fillArea(ctx, [b, c, d], geometry.style.fillColor);
    }

    const ratios = xabcdRatios(geometry.anchors);
    const measured: ReadonlyArray<[number, Point, Point]> = [
      [ratios.xb, x, b],
      [ratios.ac, a, c],
      [ratios.bd, b, d],
      [ratios.xd, x, d]
    ];

    for (const [, from, to] of measured) {
      dotted(context, [from, to]);
    }

    strokeDrawing(
      context,
      (path) => {
        tracePath(path, points, false);
      },
      { lineStyle: 'solid' }
    );

    for (const [value, from, to] of measured) {
      if (Number.isFinite(value)) {
        paintRatio(context, value, from, to);
      }
    }

    const labelled: ReadonlyArray<readonly [string, Point, Point | undefined, Point | undefined]> =
      [
        ['X', x, undefined, a],
        ['A', a, x, b],
        ['B', b, a, c],
        ['C', c, b, d],
        ['D', d, c, undefined]
      ];

    for (const [label, at, before, after] of labelled) {
      paintPointLabel(context, label, at, isTop(at, before, after));
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const [x, a, b, c, d] = geometry.points;
    return (
      segmentsHit(point, segmentsOf(geometry.points, false), tolerance) ??
      (geometry.style.fill && (insidePolygon(point, [x, a, b]) || insidePolygon(point, [b, c, d]))
        ? bodyHit
        : null)
    );
  },
  bounds: (geometry) => labelledPoints(geometry, geometry.points, XABCD)
};

/** Where the line through `a` and `b` crosses the segment from `from` to `to`, if it does. */
function crossing(a: Point, b: Point, from: Point, to: Point): Point | null {
  const direction = { x: b.x - a.x, y: b.y - a.y };
  const segment = { x: to.x - from.x, y: to.y - from.y };
  const denominator = direction.x * segment.y - direction.y * segment.x;

  if (denominator === 0) {
    return null;
  }

  const share = (direction.y * (from.x - a.x) - direction.x * (from.y - a.y)) / denominator;
  return share >= 0 && share <= 1
    ? { x: from.x + segment.x * share, y: from.y + segment.y * share }
    : null;
}

interface HeadAndShoulders {
  readonly points: Positions<Anchors<7>>;
  /** The neckline from where the first leg crosses it to where the last does. */
  readonly neckline: Segment;
  readonly areas: ReadonlyArray<readonly Point[]>;
}

/** The point on the line through `a` and `b` at the x of `at`. */
function atX(a: Point, b: Point, at: Point): Point {
  return { x: at.x, y: a.x === b.x ? a.y : a.y + ((b.y - a.y) * (at.x - a.x)) / (b.x - a.x) };
}

function headAndShouldersOf(geometry: DrawingGeometry<Anchors<7>>): HeadAndShoulders {
  const { points } = geometry;
  const [start, left, firstNeck, head, secondNeck, right, end] = points;
  const from = crossing(firstNeck, secondNeck, start, left) ?? atX(firstNeck, secondNeck, start);
  const to = crossing(firstNeck, secondNeck, right, end) ?? atX(firstNeck, secondNeck, end);
  return {
    points,
    neckline: [from, to],
    areas: [
      [from, left, firstNeck],
      [firstNeck, head, secondNeck],
      [secondNeck, right, to]
    ]
  };
}

/**
 * A head and shoulders pattern from seven points: the start, the left shoulder, the first low of
 * the neckline, the head, the second low, the right shoulder and the end. The neckline runs
 * through the two lows, between the legs that cross it; alerts watch it (`neckline`), on past the
 * second low. Upside down it is an inverse head and shoulders.
 */
export const headAndShoulders: DrawingTypeDefinition<Anchors<7>> = {
  type: 'head-and-shoulders',
  points: 7,
  fields: PATTERN_FIELDS,
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12), textColor: '#ffffff' }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const pattern = headAndShouldersOf(geometry);

    if (geometry.style.fill) {
      for (const area of pattern.areas) {
        fillArea(ctx, area, geometry.style.fillColor);
      }
    }

    dotted(context, pattern.neckline);
    strokeDrawing(
      context,
      (path) => {
        tracePath(path, pattern.points, false);
      },
      { lineStyle: 'solid' }
    );
    const { texts } = geometry;
    const [, left, firstNeck, head, secondNeck, right, end] = pattern.points;
    const labels: ReadonlyArray<readonly [string, Point, Point, Point]> = [
      [texts.leftShoulder, left, pattern.points[0], firstNeck],
      [texts.head, head, firstNeck, secondNeck],
      [texts.rightShoulder, right, secondNeck, end]
    ];

    for (const [text, at, before, after] of labels) {
      paintPointLabel(context, text, at, isTop(at, before, after));
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const pattern = headAndShouldersOf(geometry);
    return (
      segmentsHit(point, [...segmentsOf(pattern.points, false), pattern.neckline], tolerance) ??
      (geometry.style.fill && pattern.areas.some((area) => insidePolygon(point, area))
        ? bodyHit
        : null)
    );
  },
  bounds: (geometry) => {
    const pattern = headAndShouldersOf(geometry);
    const { texts } = geometry;
    return labelledPoints(
      geometry,
      [...pattern.points, ...pattern.neckline],
      [texts.leftShoulder, texts.head, texts.rightShoulder]
    );
  },
  levels: ([, , firstNeck, , secondNeck]) => [
    { key: 'neckline', from: firstNeck, to: secondNeck, extend: 'end' }
  ]
};

// ─── Elliott waves ─────────────────────────────────────────────────────────

/** How a degree writes its waves: in circles, in parentheses or plain. */
type Frame = 'circle' | 'parentheses' | 'plain';
/** Numbers of waves 1 to 5: Arabic, Roman or small Roman. */
type Numerals = 'arabic' | 'roman' | 'small';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** The numerals of each three degrees, from the largest: they go in circles, in parentheses, plain. */
const NUMERALS: readonly Numerals[] = ['arabic', 'roman', 'arabic', 'small', 'arabic'];
const FRAMES: readonly Frame[] = ['circle', 'parentheses', 'plain'];

/**
 * The label of wave `index` (from 1) at a degree, as Elliott wave notation writes it: e.g. Primary ①, Intermediate (1), Minor 1, Cycle I, Minute ⓘ, Minuette
 * (i); corrections take letters, capital where the impulses are Arabic (Intermediate (A)) and
 * small where they are Roman (Cycle a).
 */
export function waveLabel(
  degree: WaveDegree,
  index: number,
  corrective: boolean
): { readonly text: string; readonly circled: boolean } {
  const position = WAVE_DEGREES.indexOf(degree);
  const numerals = NUMERALS[Math.floor(position / 3)] ?? 'arabic';
  const frame = FRAMES[position % 3] ?? 'plain';
  const letter = String.fromCharCode(65 + index - 1);
  const bare = corrective
    ? numerals === 'arabic'
      ? letter
      : letter.toLowerCase()
    : numerals === 'arabic'
      ? String(index)
      : numerals === 'roman'
        ? (ROMAN[index - 1] ?? '')
        : (ROMAN[index - 1] ?? '').toLowerCase();
  return {
    text: frame === 'parentheses' ? `(${bare})` : bare,
    circled: frame === 'circle'
  };
}

function paintWaveLabel(
  context: DrawingPaintContext,
  label: { readonly text: string; readonly circled: boolean },
  point: Point,
  above: boolean
): void {
  const { ctx, geometry } = context;
  const { style } = geometry;
  ctx.font = geometry.textFont;
  const half = Math.max(style.fontSize * 0.75, (geometry.measureText(label.text) + 6) / 2);
  const y = point.y + (above ? -1 : 1) * (BOXED_LABEL_GAP + half);

  if (label.circled) {
    strokeDrawing(
      context,
      (path) => {
        path.arc(point.x, y, half, 0, Math.PI * 2);
      },
      { lineWidth: 1, lineStyle: 'solid' }
    );
  }

  ctx.fillStyle = style.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.text, point.x, y + 0.5);
}

/**
 * An Elliott wave: the waves through the points from where it starts, each labelled in the
 * notation of the wave `degree` (Intermediate by default), above tops and below bottoms.
 */
function elliottWave(type: string, waves: number, corrective: boolean): DrawingTypeDefinition {
  return {
    type,
    points: waves + 1,
    fields: ['color', 'lineWidth', 'degree', 'fontSize'],
    paint: (context) => {
      const { points, style } = context.geometry;
      strokeDrawing(
        context,
        (path) => {
          tracePath(path, points, false);
        },
        { lineStyle: 'solid' }
      );
      // Each wave labelled at its end, after the point it starts from.
      segmentsOf(points, false).forEach(([before, point], index) => {
        paintWaveLabel(
          context,
          waveLabel(style.degree, index + 1, corrective),
          point,
          isTop(point, before, points[index + 2])
        );
      });
    },
    hitTest: (geometry, point, tolerance) =>
      segmentsHit(point, segmentsOf(geometry.points, false), tolerance),
    bounds: (geometry) =>
      labelledPoints(
        geometry,
        geometry.points,
        Array.from(
          { length: waves },
          (_, index) => waveLabel(geometry.style.degree, index + 1, corrective).text
        )
      )
  };
}

/** The five waves of an impulse, 1 to 5, from six points. */
export const elliottImpulse = /* @__PURE__ */ elliottWave('elliott-impulse', 5, false);
/** The three waves of a correction, A to C, from four points. */
export const elliottCorrection = /* @__PURE__ */ elliottWave('elliott-correction', 3, true);

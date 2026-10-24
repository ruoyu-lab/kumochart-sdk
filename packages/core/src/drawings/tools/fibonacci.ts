import { font } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, extendSides, insidePolygon, insideRect, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingGeometry,
  DrawingLevel,
  DrawingLevelStyle,
  DrawingPoint,
  DrawingTypeDefinition
} from '../types';
import { sideLevel } from './lines';
import {
  bodyHit,
  LABEL_GAP,
  ratioText,
  segmentsHit,
  shownLevels,
  strokeDrawing,
  tracePath
} from './shared';

/**
 * The levels of a Fibonacci retracement: those to 4.236 show by default,
 * the others are there to turn on.
 */
const RETRACEMENT_LEVELS: readonly DrawingLevelStyle[] = [
  { value: 0 },
  { value: 0.236 },
  { value: 0.382 },
  { value: 0.5 },
  { value: 0.618 },
  { value: 0.786 },
  { value: 1 },
  { value: 1.618 },
  { value: 2.618 },
  { value: 3.618 },
  { value: 4.236 },
  { value: 1.272, visible: false },
  { value: 1.414, visible: false },
  { value: 2.272, visible: false },
  { value: 2.414, visible: false },
  { value: 2, visible: false },
  { value: 3, visible: false },
  { value: 3.272, visible: false },
  { value: 3.414, visible: false },
  { value: 4, visible: false },
  { value: 4.272, visible: false },
  { value: 4.414, visible: false },
  { value: 4.618, visible: false },
  { value: 4.764, visible: false }
];
const EXTENSION_LEVELS: readonly DrawingLevelStyle[] = [
  { value: 0 },
  { value: 0.382 },
  { value: 0.618 },
  { value: 1 },
  { value: 1.272 },
  { value: 1.618 },
  { value: 2 },
  { value: 2.618 }
];
/** The levels of a Fibonacci channel that show by default. */
const CHANNEL_RATIOS: readonly number[] = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236
];
/** Fibonacci numbers of bars, from the first anchor in units of the bars to the second. */
const TIME_ZONE_COUNTS: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

interface FibLevel {
  readonly level: number;
  readonly price: number;
  readonly y: number;
  readonly color: string;
}

interface Ladder {
  /** The anchors joined by a dashed guide. */
  readonly guide: readonly Point[];
  /** Where the levels start and end, as far as the style extends them. */
  readonly left: number;
  readonly right: number;
  /** Where the labels start: at the earliest anchor, or the plot's left edge as levels go there. */
  readonly labels: number;
  /** The levels shown, lowest ratio first. */
  readonly levels: readonly FibLevel[];
}

/** A kind of Fibonacci tool of anchors `A`: its default levels and the price of each. */
interface FibKind<A extends readonly DrawingPoint[]> {
  readonly points: A['length'];
  readonly levels: readonly DrawingLevelStyle[];
  price(anchors: A, ratio: number): number;
}

/** Horizontal levels across the anchors' times, or the plot as far as the style extends them. */
function ladderOf<A extends readonly DrawingPoint[]>(
  geometry: DrawingGeometry<A>,
  kind: FibKind<A>
): Ladder {
  const { points, anchors, style } = geometry;
  const xs = points.map((point) => point.x);
  const levels = shownLevels(style.levels, style, geometry.theme.palette).map(
    ({ value, color }): FibLevel => {
      const price = kind.price(anchors, value);
      return { level: value, price, y: geometry.valueToY(price), color };
    }
  );
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return {
    guide: points,
    left: style.extendLeft ? Math.min(0, left) : left,
    right: style.extendRight ? Math.max(geometry.width, right) : right,
    labels: style.extendLeft ? 0 : left,
    levels: levels.sort((a, b) => a.level - b.level)
  };
}

/** A level's label: its ratio and its price, e.g. `0.618  98,250`. */
function levelLabel(geometry: DrawingGeometry, level: number, price: number): string {
  return `${ratioText(level)}  ${geometry.formatValue(price)}`;
}

/** The levels, the guide between the anchors and the labels over the levels. */
function ladderBounds(geometry: DrawingGeometry, ladder: Ladder) {
  const top = geometry.style.fontSize + LABEL_GAP;
  return boundsOf([
    ...ladder.guide,
    ...levelLines(ladder).flat(),
    ...ladder.levels.map(({ level, price, y }) => ({
      x: ladder.labels + LABEL_GAP + geometry.measureText(levelLabel(geometry, level, price)),
      y: y - top
    }))
  ]);
}

function levelLines({ left, right, levels }: Ladder): Segment[] {
  return levels.map(({ y }): Segment => [
    { x: left, y },
    { x: right, y }
  ]);
}

function fibType<A extends readonly DrawingPoint[]>(
  type: string,
  kind: FibKind<A>
): DrawingTypeDefinition<A> {
  return {
    type,
    points: kind.points,
    fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', 'extendLeft', 'extendRight'],
    defaultStyle: () => ({ levels: kind.levels }),
    // Each level shown by its ratio, e.g. `0.618`, between the anchors' times.
    levels: (anchors, _scale, style) => {
      const times = anchors.map((anchor) => anchor.time);
      return shownLevels(style.levels, style).map(({ value: level }): DrawingLevel => {
        const price = kind.price(anchors, level);
        return sideLevel(
          ratioText(level),
          { time: Math.min(...times), price },
          { time: Math.max(...times), price },
          style
        );
      });
    },
    paint: (context) => {
      const { ctx, geometry } = context;
      const ladder = ladderOf(geometry, kind);
      const { left, right, levels } = ladder;

      // Each band between two levels is tinted with the color of the level it starts from.
      if (geometry.style.fill) {
        levels.forEach(({ y, color }, index) => {
          const next = levels[index + 1];

          if (next) {
            ctx.fillStyle = withAlpha(color, 0.1);
            ctx.fillRect(left, y, right - left, next.y - y);
          }
        });
      }

      levels.forEach(({ y, color }) => {
        strokeDrawing(
          context,
          (path) => {
            path.moveTo(left, y);
            path.lineTo(right, y);
          },
          { color }
        );
      });
      strokeDrawing(
        context,
        (path) => {
          tracePath(path, ladder.guide, false);
        },
        { lineStyle: 'dashed' }
      );

      ctx.font = font(geometry.style.fontSize - 1, geometry.fontFamily);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      levels.forEach(({ level, price, y, color }) => {
        ctx.fillStyle = color;
        ctx.fillText(levelLabel(geometry, level, price), ladder.labels + LABEL_GAP, y - 3);
      });
    },
    // The levels, and the bands between them where they are filled.
    hitTest: (geometry, point, tolerance) => {
      const ladder = ladderOf(geometry, kind);
      const first = ladder.levels[0];
      const last = ladder.levels.at(-1);
      return (
        segmentsHit(point, levelLines(ladder), tolerance) ??
        (geometry.style.fill &&
        first &&
        last &&
        insideRect(point, { x: ladder.left, y: first.y }, { x: ladder.right, y: last.y })
          ? bodyHit
          : null)
      );
    },
    bounds: (geometry) => ladderBounds(geometry, ladderOf(geometry, kind))
  };
}

/**
 * Levels of how far a move retraces: from where it ended, the second anchor (level 0), back to
 * where it began, the first (level 1).
 */
export const fibRetracement = /* @__PURE__ */ fibType<Anchors<2>>('fib-retracement', {
  points: 2,
  levels: RETRACEMENT_LEVELS,
  price: ([from, to], ratio) => to.price + (from.price - to.price) * ratio
});

/**
 * A trend-based extension: the move from the first anchor to the second, projected from the third
 * by each ratio (1 repeats the move, 1.618 extends it).
 */
export const fibExtension = /* @__PURE__ */ fibType<Anchors<3>>('fib-extension', {
  points: 3,
  levels: EXTENSION_LEVELS,
  price: ([start, end, from], ratio) => from.price + (end.price - start.price) * ratio
});

interface ChannelLevel {
  readonly level: number;
  readonly color: string;
  /** The line as far as the style extends it. */
  readonly line: Segment;
}

/**
 * The lines of a Fibonacci channel, lowest ratio first: the base line from the first anchor to the
 * second moved by each ratio of the way to the third, so 0 is the base line and 1 its parallel
 * through the third anchor.
 */
function channelLevels(geometry: DrawingGeometry<Anchors<3>>): ChannelLevel[] {
  const [first, second, third] = geometry.points;
  const { style, width, height } = geometry;
  const shift = (point: Point, ratio: number): Point => ({
    x: point.x + (third.x - first.x) * ratio,
    y: point.y + (third.y - first.y) * ratio
  });
  return shownLevels(style.levels, style, geometry.theme.palette)
    .map(({ value, color }): ChannelLevel => ({
      level: value,
      color,
      line: extendSides(
        shift(first, value),
        shift(second, value),
        width,
        height,
        style.extendLeft,
        style.extendRight
      )
    }))
    .sort((a, b) => a.level - b.level);
}

/** The left end of a line in view: its own, or where it crosses the plot's left edge. */
function leftInView([start, end]: Segment): Point {
  const [left, right] = start.x <= end.x ? [start, end] : [end, start];

  if (left.x >= 0 || right.x === left.x) {
    return left;
  }

  return { x: 0, y: left.y + ((right.y - left.y) * -left.x) / (right.x - left.x) };
}

/**
 * A Fibonacci channel, lines parallel to a trend line at Fibonacci ratios of the channel's
 * width: the first two anchors make the base line (0), the third its parallel (1), and the other
 * ratios lie beyond or between them, each labelled with its value where it starts.
 */
export const fibChannel: DrawingTypeDefinition<Anchors<3>> = {
  type: 'fib-channel',
  points: 3,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', 'extendLeft', 'extendRight'],
  defaultStyle: () => ({ levels: CHANNEL_RATIOS.map((value) => ({ value })) }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const levels = channelLevels(geometry);

    // Each band between two levels is tinted with the color of the level it starts from.
    if (geometry.style.fill) {
      levels.forEach(({ line, color }, index) => {
        const next = levels[index + 1];

        if (next) {
          ctx.beginPath();
          tracePath(ctx, [line[0], line[1], next.line[1], next.line[0]], true);
          ctx.fillStyle = withAlpha(color, 0.1);
          ctx.fill();
        }
      });
    }

    for (const { line, color } of levels) {
      strokeDrawing(
        context,
        (path) => {
          tracePath(path, line, false);
        },
        { color }
      );
    }

    ctx.font = font(geometry.style.fontSize - 1, geometry.fontFamily);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    for (const { level, line, color } of levels) {
      const start = leftInView(line);
      ctx.fillStyle = color;
      ctx.fillText(
        levelLabel(geometry, level, geometry.yToValue(start.y)),
        start.x + LABEL_GAP,
        start.y - 3
      );
    }
  },
  bounds: (geometry) => {
    const top = geometry.style.fontSize + LABEL_GAP;
    return boundsOf(
      channelLevels(geometry).flatMap(({ level, line }) => {
        const start = leftInView(line);
        const label = levelLabel(geometry, level, geometry.yToValue(start.y));
        return [
          ...line,
          { x: start.x + LABEL_GAP + geometry.measureText(label), y: start.y - top }
        ];
      })
    );
  },
  // The levels, and the bands between them where they are filled.
  hitTest: (geometry, point, tolerance) => {
    const levels = channelLevels(geometry);
    const first = levels[0]?.line;
    const last = levels.at(-1)?.line;
    return (
      segmentsHit(
        point,
        levels.map(({ line }) => line),
        tolerance
      ) ??
      (geometry.style.fill && first && last && insidePolygon(point, [...first, last[1], last[0]])
        ? bodyHit
        : null)
    );
  },
  // Each level shown by its ratio, moved as drawn: by bars in time, along the pane's scale.
  levels: ([first, second, third], scale, style, { barIndex, timeAt }) => {
    const bars = barIndex(third.time) - barIndex(first.time);
    const rise = scale.toScale(third.price) - scale.toScale(first.price);
    const shift = (point: DrawingPoint, ratio: number): DrawingPoint => ({
      time: timeAt(barIndex(point.time) + bars * ratio),
      price: scale.fromScale(scale.toScale(point.price) + rise * ratio)
    });
    return shownLevels(style.levels, style).map(({ value }) =>
      sideLevel(ratioText(value), shift(first, value), shift(second, value), style)
    );
  }
};

interface Zone {
  readonly count: number;
  readonly x: number;
  readonly color: string;
}

/** The zones shown, at their counts of the bars from the first anchor to the second. */
function zonesOf(geometry: DrawingGeometry<Anchors<2>>): Zone[] {
  const [first, second] = geometry.points;
  const { style } = geometry;
  return shownLevels(style.levels, style)
    .map(({ value, color }) => ({ count: value, x: first.x + (second.x - first.x) * value, color }))
    .sort((a, b) => a.count - b.count);
}

/**
 * Fibonacci time zones: the bars from the first anchor to the
 * second make one unit, and vertical lines mark 0, 1, 2, 3, 5, 8, 13, … units from the first
 * anchor, where turns are expected. Each is labelled with its count at the bottom.
 */
export const fibTimeZone: DrawingTypeDefinition<Anchors<2>> = {
  type: 'fib-time-zone',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill'],
  defaultStyle: () => ({ fill: false, levels: TIME_ZONE_COUNTS.map((value) => ({ value })) }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const zones = zonesOf(geometry);

    const { height, style } = geometry;

    if (style.fill) {
      zones.forEach(({ x, color }, index) => {
        const next = zones[index + 1];

        if (next) {
          ctx.fillStyle = withAlpha(color, 0.1);
          ctx.fillRect(x, 0, next.x - x, height);
        }
      });
    }

    for (const { x, color } of zones) {
      strokeDrawing(
        context,
        (path) => {
          path.moveTo(x, 0);
          path.lineTo(x, height);
        },
        { color }
      );
    }

    strokeDrawing(
      context,
      (path) => {
        tracePath(path, geometry.points, false);
      },
      { lineStyle: 'dashed' }
    );

    ctx.font = font(style.fontSize - 1, geometry.fontFamily);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    for (const { count, x, color } of zones) {
      ctx.fillStyle = color;
      ctx.fillText(ratioText(count), x + LABEL_GAP, height - LABEL_GAP);
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const zones = zonesOf(geometry);
    const [first, second] = geometry.points;

    const xs = zones.map(({ x }) => x);
    return (
      segmentsHit(
        point,
        [
          [first, second],
          ...zones.map(({ x }): Segment => [
            { x, y: 0 },
            { x, y: geometry.height }
          ])
        ],
        tolerance
      ) ??
      (geometry.style.fill &&
      zones.length > 1 &&
      point.x >= Math.min(...xs) &&
      point.x <= Math.max(...xs)
        ? bodyHit
        : null)
    );
  },
  // The lines from the top to the bottom of the plot, with their counts right of them.
  bounds: (geometry) =>
    boundsOf([
      ...geometry.points,
      ...zonesOf(geometry).flatMap(({ count, x }) => [
        { x, y: 0 },
        { x: x + LABEL_GAP + geometry.measureText(ratioText(count)), y: geometry.height }
      ])
    ]),
  axisMarks: ([first, second]) => ({ prices: [], times: [first.time, second.time] })
};

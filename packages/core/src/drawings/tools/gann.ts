import { font } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { boundsOf, cornersOf, extendSegment, insidePolygon, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingBounds,
  DrawingGeometry,
  DrawingLevel,
  DrawingLevelStyle,
  DrawingPaintContext,
  DrawingPoint,
  DrawingTypeDefinition
} from '../types';
import { boxHandles, corners, moveBoxHandle } from './shapes';
import {
  bodyHit,
  fillArea,
  LABEL_GAP,
  ratioText,
  segmentsHit,
  shapeHit,
  shownLevels,
  strokeDrawing,
  tracePath
} from './shared';

/** The levels of a Gann box and a speed resistance fan, in price and in time. */
const BOX_RATIOS: readonly number[] = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
/** Bands between levels are this faint, in each direction of a box. */
const BAND_ALPHA = 0.08;

const BOX_STYLE = () => ({
  levels: BOX_RATIOS.map((value) => ({ value })),
  timeLevels: BOX_RATIOS.map((value) => ({ value }))
});

/** A level of a box: its ratio, where it is across the box and its color. */
interface BoxLevel {
  readonly ratio: number;
  /** Y of a price level, x of a time level. */
  readonly at: number;
  readonly color: string;
}

/**
 * The levels shown, lowest ratio first, placed from `from` (ratio 0) to `to` (ratio 1): the
 * box is divided on screen, as it is drawn, also on a logarithmic scale.
 */
function boxLevels(
  levels: readonly DrawingLevelStyle[],
  geometry: DrawingGeometry,
  from: number,
  to: number
): BoxLevel[] {
  return shownLevels(levels, geometry.style, geometry.theme.palette)
    .map(({ value, color }) => ({ ratio: value, at: from + (to - from) * value, color }))
    .sort((a, b) => a.ratio - b.ratio);
}

/** Strokes a line of a box or a fan in `color`, and `lineWidth` when not the drawing's. */
function strokeLine(
  context: DrawingPaintContext,
  line: Segment,
  stroke: { readonly color: string; readonly lineWidth?: number }
): void {
  strokeDrawing(
    context,
    (path) => {
      tracePath(path, line, false);
    },
    stroke
  );
}

function setLabelFont(ctx: CanvasRenderingContext2D, geometry: DrawingGeometry): void {
  ctx.font = font(geometry.style.fontSize - 1, geometry.fontFamily);
}

/** The sides of a box, from the left and the top. */
interface Sides {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function sidesOf(first: Point, second: Point): Sides {
  return {
    left: Math.min(first.x, second.x),
    right: Math.max(first.x, second.x),
    top: Math.min(first.y, second.y),
    bottom: Math.max(first.y, second.y)
  };
}

/** A box with the labels {@link paintBoxLabels} paints around it. */
function labelledBounds(
  geometry: DrawingGeometry,
  box: Sides,
  levels: readonly BoxLevel[]
): DrawingBounds {
  const width = Math.max(0, ...levels.map(({ ratio }) => geometry.measureText(ratioText(ratio))));
  const across = LABEL_GAP + width;
  const along = LABEL_GAP + geometry.style.fontSize;
  return {
    x: box.left - across,
    y: box.top - along,
    width: box.right - box.left + across * 2,
    height: box.bottom - box.top + along * 2
  };
}

/** Labels of price levels on both sides of a box, and of time levels above and below it. */
function paintBoxLabels(
  ctx: CanvasRenderingContext2D,
  geometry: DrawingGeometry,
  box: Sides,
  prices: readonly BoxLevel[],
  times: readonly BoxLevel[]
): void {
  setLabelFont(ctx, geometry);
  ctx.textBaseline = 'middle';

  for (const { ratio, at, color } of prices) {
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(ratioText(ratio), box.left - LABEL_GAP, at);
    ctx.textAlign = 'left';
    ctx.fillText(ratioText(ratio), box.right + LABEL_GAP, at);
  }

  ctx.textAlign = 'center';

  for (const { ratio, at, color } of times) {
    ctx.fillStyle = color;
    ctx.textBaseline = 'bottom';
    ctx.fillText(ratioText(ratio), at, box.top - LABEL_GAP);
    ctx.textBaseline = 'top';
    ctx.fillText(ratioText(ratio), at, box.bottom + LABEL_GAP);
  }
}

// ─── Gann box ──────────────────────────────────────────────────────────────

interface GannBox {
  readonly first: Point;
  readonly second: Point;
  /** Horizontal lines at the price levels, vertical lines at the time levels. */
  readonly prices: readonly BoxLevel[];
  readonly times: readonly BoxLevel[];
}

function gannBoxOf(geometry: DrawingGeometry<Anchors<2>>): GannBox {
  const [first, second] = geometry.points;
  return {
    first,
    second,
    prices: boxLevels(geometry.style.levels, geometry, first.y, second.y),
    times: boxLevels(geometry.style.timeLevels, geometry, first.x, second.x)
  };
}

/** The lines of a box in the colors of their levels: across it at prices, down it at times. */
function gannLines({ first, second, prices, times }: GannBox): Array<{
  readonly line: Segment;
  readonly color: string;
}> {
  return [
    ...prices.map(({ at, color }) => ({
      line: [
        { x: first.x, y: at },
        { x: second.x, y: at }
      ] as const,
      color
    })),
    ...times.map(({ at, color }) => ({
      line: [
        { x: at, y: first.y },
        { x: at, y: second.y }
      ] as const,
      color
    }))
  ];
}

/**
 * A Gann box: the box from the first anchor to the second divided in price and
 * in time at `levels` and `timeLevels`, ratios from the first anchor (0) to the second (1), each
 * labelled on both sides. Alerts watch the price levels shown, by their ratio.
 */
export const gannBox: DrawingTypeDefinition<Anchors<2>> = {
  type: 'gann-box',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'timeLevels', 'fill'],
  defaultStyle: BOX_STYLE,
  paint: (context) => {
    const { ctx, geometry } = context;
    const box = gannBoxOf(geometry);
    const { first, second, prices, times } = box;

    // Bands between levels, each tinted with the color of the level it starts from, both ways.
    if (geometry.style.fill) {
      prices.forEach(({ at, color }, index) => {
        const next = prices[index + 1];

        if (next) {
          fillArea(
            ctx,
            corners({ x: first.x, y: at }, { x: second.x, y: next.at }),
            withAlpha(color, BAND_ALPHA)
          );
        }
      });
      times.forEach(({ at, color }, index) => {
        const next = times[index + 1];

        if (next) {
          fillArea(
            ctx,
            corners({ x: at, y: first.y }, { x: next.at, y: second.y }),
            withAlpha(color, BAND_ALPHA)
          );
        }
      });
    }

    for (const { line, color } of gannLines(box)) {
      strokeLine(context, line, { color });
    }

    paintBoxLabels(ctx, geometry, sidesOf(first, second), prices, times);
  },
  hitTest: (geometry, point, tolerance) => {
    const box = gannBoxOf(geometry);
    return shapeHit(
      point,
      gannLines(box).map(({ line }) => line),
      corners(box.first, box.second),
      tolerance,
      geometry.style.fill
    );
  },
  bounds: (geometry) => {
    const box = gannBoxOf(geometry);
    return labelledBounds(geometry, sidesOf(box.first, box.second), [...box.prices, ...box.times]);
  },
  handles: boxHandles,
  moveHandle: moveBoxHandle,
  levels: ([first, second], scale, style) => {
    const from = scale.toScale(first.price);
    const to = scale.toScale(second.price);
    const start = Math.min(first.time, second.time);
    const end = Math.max(first.time, second.time);
    return shownLevels(style.levels, style).map(({ value }): DrawingLevel => {
      const price = scale.fromScale(from + (to - from) * value);
      return { key: ratioText(value), from: { time: start, price }, to: { time: end, price } };
    });
  }
};

// ─── Fibonacci speed resistance fan ────────────────────────────────────────

/** A level of a fan, with its ray from the first anchor through it to the edge of the plot. */
interface FanLevel extends BoxLevel {
  readonly ray: Segment;
}

interface Fan {
  readonly origin: Point;
  readonly corner: Point;
  /** Price levels: y on the side of the second anchor; time levels: x on its side. */
  readonly prices: readonly FanLevel[];
  readonly times: readonly FanLevel[];
}

function fanOf(geometry: DrawingGeometry<Anchors<2>>): Fan {
  const [origin, corner] = geometry.points;
  // Ratios run from the second anchor (0) back to the first (1).
  const prices = boxLevels(geometry.style.levels, geometry, corner.y, origin.y);
  const times = boxLevels(geometry.style.timeLevels, geometry, corner.x, origin.x);
  const ray = (through: Point): Segment =>
    extendSegment(origin, through, geometry.width, geometry.height, 'ray');
  return {
    origin,
    corner,
    prices: prices.map((level) => ({ ...level, ray: ray({ x: corner.x, y: level.at }) })),
    times: times.map((level) => ({ ...level, ray: ray({ x: level.at, y: corner.y }) }))
  };
}

/** The rays of a fan, those of its price levels and of its time levels. */
function raysOf({ prices, times }: Fan): Segment[] {
  return [...prices, ...times].map(({ ray }) => ray);
}

/** The lines inside the box: at each price level across it and each time level down it. */
function gridOf({ origin, corner, prices, times }: Fan): Segment[] {
  return [
    ...prices.map(({ at }): Segment => [
      { x: origin.x, y: at },
      { x: corner.x, y: at }
    ]),
    ...times.map(({ at }): Segment => [
      { x: at, y: origin.y },
      { x: at, y: corner.y }
    ])
  ];
}

/**
 * The wedges between the rays of neighbouring levels from `origin`, each in the color of the
 * level it starts from.
 */
function wedgesOf(
  origin: Point,
  levels: readonly FanLevel[]
): Array<{ readonly area: Point[]; readonly color: string }> {
  return levels.flatMap(({ ray, color }, index) => {
    const next = levels[index + 1];
    return next ? [{ area: [origin, ray[1], next.ray[1]], color }] : [];
  });
}

/**
 * A Fibonacci speed resistance fan: rays from the first anchor through the
 * levels of the box it spans with the second, the price levels on the second anchor's side and
 * the time levels on its other side, ratios from the second anchor (0) back to the first (1), so
 * 0 is the trend line itself. A grid marks the levels in the box, labelled on every side. Alerts
 * watch the rays of the price levels shown, by their ratio, and those of the time levels as
 * `time-0.382`.
 */
export const fibSpeedFan: DrawingTypeDefinition<Anchors<2>> = {
  type: 'fib-speed-fan',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'timeLevels', 'fill'],
  defaultStyle: BOX_STYLE,
  paint: (context) => {
    const { ctx, geometry } = context;
    const fan = fanOf(geometry);
    const { origin, corner, prices, times } = fan;

    if (geometry.style.fill) {
      for (const { area, color } of [...wedgesOf(origin, prices), ...wedgesOf(origin, times)]) {
        fillArea(ctx, area, withAlpha(color, BAND_ALPHA));
      }
    }

    for (const line of gridOf(fan)) {
      strokeLine(context, line, { color: withAlpha(geometry.style.color, 0.5), lineWidth: 1 });
    }

    for (const { ray, color } of [...prices, ...times]) {
      strokeLine(context, ray, { color });
    }

    paintBoxLabels(ctx, geometry, sidesOf(origin, corner), prices, times);
  },
  // The rays and the grid, and the wedges between the rays where they are filled.
  hitTest: (geometry, point, tolerance) => {
    const fan = fanOf(geometry);
    const wedges = [...wedgesOf(fan.origin, fan.prices), ...wedgesOf(fan.origin, fan.times)];
    return (
      segmentsHit(point, [...raysOf(fan), ...gridOf(fan)], tolerance) ??
      (geometry.style.fill && wedges.some(({ area }) => insidePolygon(point, area))
        ? bodyHit
        : null)
    );
  },
  // The rays to the edge of the plot, and the box with its labels.
  bounds: (geometry) => {
    const fan = fanOf(geometry);
    const box = labelledBounds(geometry, sidesOf(fan.origin, fan.corner), [
      ...fan.prices,
      ...fan.times
    ]);
    return boundsOf([...raysOf(fan).flat(), ...cornersOf(box)]);
  },
  levels: ([origin, corner], scale, style, { barIndex, timeAt }) => {
    const from = scale.toScale(corner.price);
    const to = scale.toScale(origin.price);
    const shown = (levels: readonly DrawingLevelStyle[]) =>
      shownLevels(levels, style).map((level) => level.value);
    const ray = (key: string, through: DrawingPoint): DrawingLevel => ({
      key,
      from: origin,
      to: through,
      extend: 'end'
    });
    const start = barIndex(corner.time);
    const span = barIndex(origin.time) - start;
    return [
      ...shown(style.levels).map((ratio) =>
        ray(ratioText(ratio), {
          time: corner.time,
          price: scale.fromScale(from + (to - from) * ratio)
        })
      ),
      // A time level at the first anchor's time is a vertical line, which no price crosses.
      ...shown(style.timeLevels)
        .filter((ratio) => ratio !== 1 && origin.time !== corner.time)
        .map((ratio) =>
          ray(`time-${ratioText(ratio)}`, {
            time: timeAt(start + span * ratio),
            price: corner.price
          })
        )
    ];
  }
};

// ─── Gann fan ──────────────────────────────────────────────────────────────

/**
 * The angles of a Gann fan, as levels: units of value per unit of time against the 1×1, the line
 * from the first anchor to the second; 2 is the 2×1, twice as steep, ½ the 1×2.
 */
const GANN_ANGLES: readonly number[] = [8, 4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 8];

/**
 * An angle as Gann wrote it: `2×1`, `1×1`, `1×2`; a third written as `0.333` is still `1×3`.
 */
export function gannAngleText(ratio: number): string {
  return ratio >= 1 ? `${ratioText(ratio)}×1` : `1×${ratioText(Math.round(100 / ratio) / 100)}`;
}

/** An angle of a fan: its ray from the first anchor, and where it leaves the box of the anchors. */
interface GannAngle {
  readonly ratio: number;
  readonly color: string;
  readonly ray: Segment;
  readonly edge: Point;
}

function gannFanOf(geometry: DrawingGeometry<Anchors<2>>): GannAngle[] {
  const [origin, corner] = geometry.points;
  const across = corner.x - origin.x;
  const along = corner.y - origin.y;

  if (across === 0 && along === 0) {
    return [];
  }

  return shownLevels(geometry.style.levels, geometry.style, geometry.theme.palette)
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)
    .map(({ value, color }) => {
      // Flatter than the 1×1, the angle leaves the box by its far side; steeper, by its top or bottom.
      const edge =
        value <= 1
          ? { x: corner.x, y: origin.y + along * value }
          : { x: origin.x + across / value, y: corner.y };
      return {
        ratio: value,
        color,
        ray: extendSegment(origin, edge, geometry.width, geometry.height, 'ray'),
        edge
      };
    });
}

/**
 * A Gann fan: rays from the first anchor at Gann's angles, 8×1 to 1×8, the 1×1 through the
 * second anchor, each labelled where it leaves the box of the anchors, and the wedges between
 * them filled. Alerts watch each ray, by its angle, as `2×1`.
 */
export const gannFan: DrawingTypeDefinition<Anchors<2>> = {
  type: 'gann-fan',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill'],
  defaultStyle: () => ({ levels: GANN_ANGLES.map((value) => ({ value })) }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const angles = gannFanOf(geometry);
    const [origin] = geometry.points;

    if (geometry.style.fill) {
      angles.forEach(({ ray, color }, index) => {
        const next = angles[index + 1];

        if (next) {
          fillArea(ctx, [origin, ray[1], next.ray[1]], withAlpha(color, BAND_ALPHA));
        }
      });
    }

    for (const { ray, color } of angles) {
      strokeLine(context, ray, { color });
    }

    // The flatter angles labelled beyond the far side of the box, the steeper above or below it.
    const [, corner] = geometry.points;
    const right = corner.x >= origin.x;
    const up = corner.y <= origin.y;
    setLabelFont(ctx, geometry);

    for (const { ratio, color, edge } of angles) {
      ctx.fillStyle = color;

      if (ratio <= 1) {
        ctx.textAlign = right ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(gannAngleText(ratio), edge.x + (right ? LABEL_GAP : -LABEL_GAP), edge.y);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = up ? 'bottom' : 'top';
        ctx.fillText(gannAngleText(ratio), edge.x, edge.y + (up ? -LABEL_GAP : LABEL_GAP));
      }
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const angles = gannFanOf(geometry);
    const [origin] = geometry.points;
    const wedges = angles.flatMap(({ ray }, index) => {
      const next = angles[index + 1];
      return next ? [[origin, ray[1], next.ray[1]]] : [];
    });
    return (
      segmentsHit(
        point,
        angles.map(({ ray }) => ray),
        tolerance
      ) ??
      (geometry.style.fill && wedges.some((area) => insidePolygon(point, area)) ? bodyHit : null)
    );
  },
  bounds: (geometry) => {
    const angles = gannFanOf(geometry);
    const reach = Math.max(
      0,
      ...angles.map(({ ratio }) => geometry.measureText(gannAngleText(ratio)) + LABEL_GAP)
    );
    return boundsOf(
      [...geometry.points, ...angles.flatMap(({ ray }) => ray)],
      Math.max(reach, geometry.style.fontSize)
    );
  },
  levels: ([origin, corner], scale, style, { barIndex, timeAt }) => {
    const from = scale.toScale(origin.price);
    const to = scale.toScale(corner.price);
    const start = barIndex(origin.time);
    const span = barIndex(corner.time) - start;

    // Anchors at one time make every angle a vertical line, which no price crosses.
    if (origin.time === corner.time) {
      return [];
    }

    return shownLevels(style.levels, style)
      .filter(({ value }) => value > 0)
      .map(({ value }): DrawingLevel => ({
        key: gannAngleText(value),
        from: origin,
        to:
          value <= 1
            ? { time: corner.time, price: scale.fromScale(from + (to - from) * value) }
            : { time: timeAt(start + span / value), price: corner.price },
        extend: 'end'
      }));
  }
};

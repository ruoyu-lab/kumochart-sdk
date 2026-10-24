import { font } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { BarsView, PriceSource } from '../../data/types';
import type { Point } from '../../interaction/types';
import { boundsOf, extendSegment, type Segment } from '../geometry';
import type {
  Anchors,
  DrawingGeometry,
  DrawingHandle,
  DrawingLevel,
  DrawingPoint,
  DrawingStyle,
  DrawingTypeDefinition
} from '../types';
import {
  barPrice,
  barsCache,
  fillArea,
  LABEL_GAP,
  ratioText,
  shapeHit,
  type ShownLevel,
  shownLevels,
  strokeDrawing,
  tracePath
} from './shared';

/** A linear regression of the bars between two times. */
export interface Regression {
  /** Index of the first and the last bar it fits. */
  readonly first: number;
  readonly last: number;
  /** The fitted value at the first bar and its change per bar. */
  readonly start: number;
  readonly slope: number;
  /** Standard deviation of the prices around the line, with `n - 1` degrees of freedom. */
  readonly deviation: number;
  /** Pearson's correlation of the prices and the line, from 0 to 1. */
  readonly pearson: number;
}

/**
 * The least-squares line through the `source` prices of the bars from `from` to `to` (in either
 * order, both included), as a regression trend and a linear regression channel fit it: the
 * deviation of the prices from it with `n - 1` degrees of freedom, and Pearson's R between
 * the prices and the fitted values, which is the absolute correlation with time. `null` for
 * fewer than two bars.
 */
export function regression(
  bars: BarsView,
  from: number,
  to: number,
  source: PriceSource
): Regression | null {
  const first = bars.lowerBound(Math.min(from, to));
  const last = bars.lowerBound(Math.max(from, to) + 1) - 1;
  const count = last - first + 1;

  if (count < 2) {
    return null;
  }

  const price = (index: number) => barPrice(bars, index, source);
  let mean = 0;

  for (let index = first; index <= last; index += 1) {
    mean += price(index);
  }

  mean /= count;
  const middle = (count - 1) / 2;
  let covariance = 0;
  let spread = 0;

  for (let index = first; index <= last; index += 1) {
    const x = index - first - middle;
    covariance += x * (price(index) - mean);
    spread += x * x;
  }

  const slope = covariance / spread;
  const start = mean - slope * middle;
  let residuals = 0;
  let variance = 0;

  for (let index = first; index <= last; index += 1) {
    const value = price(index);
    residuals += (value - start - slope * (index - first)) ** 2;
    variance += (value - mean) ** 2;
  }

  // The fitted values vary by `slope * x`, so their correlation with the prices is that of time.
  const fitted = slope * slope * spread;
  const pearson =
    variance === 0 || fitted === 0
      ? 0
      : Math.abs(covariance * slope) / Math.sqrt(variance * fitted);
  return {
    first,
    last,
    start,
    slope,
    deviation: Math.sqrt(residuals / (count - 1)),
    pearson
  };
}

const fitCache = /* @__PURE__ */ barsCache<Regression | null>(64);

function fitOf(bars: BarsView, from: number, to: number, source: PriceSource): Regression | null {
  return fitCache(bars, `${from}:${to}:${source}`, () => regression(bars, from, to, source));
}

/** The deviations shown, highest first: the base line is 0. */
function shownDeviations(style: DrawingStyle): ShownLevel[] {
  return shownLevels(style.levels, style).sort((a, b) => b.value - a.value);
}

interface Channel {
  readonly fit: Regression;
  /** The lines shown, highest first, as far as the style extends them. */
  readonly lines: ReadonlyArray<{ readonly level: ShownLevel; readonly line: Segment }>;
  /** Ends of the base line at the anchors' bars, in the anchors' order. */
  readonly ends: readonly Point[];
}

/** The channel of the bars between the anchors, `null` until two bars lie between them. */
function channelOf(geometry: DrawingGeometry<Anchors<2>>): Channel | null {
  const [from, to] = geometry.anchors;
  const { bars, style } = geometry;
  const fit = fitOf(bars, from.time, to.time, style.source);

  if (!fit) {
    return null;
  }

  const startX = geometry.timeToX(bars.time(fit.first));
  const endX = geometry.timeToX(bars.time(fit.last));
  const at = (offset: number, index: number): Point => ({
    x: index === fit.first ? startX : endX,
    y: geometry.valueToY(fit.start + fit.slope * (index - fit.first) + offset * fit.deviation)
  });
  const lines = shownDeviations(style).map((level) => {
    const start = at(level.value, fit.first);
    const end = at(level.value, fit.last);
    const line: Segment = style.extendRight
      ? extendSegment(start, end, geometry.width, geometry.height, 'ray')
      : [start, end];
    return { level, line };
  });
  const ends =
    from.time <= to.time
      ? [at(0, fit.first), at(0, fit.last)]
      : [at(0, fit.last), at(0, fit.first)];
  return { fit, lines, ends };
}

/** The area between the highest and the lowest line. */
function areaOf(channel: Channel): Point[] {
  const top = channel.lines[0]?.line;
  const bottom = channel.lines.at(-1)?.line;
  return top && bottom ? [top[0], top[1], bottom[1], bottom[0]] : [];
}

/**
 * A linear regression channel of the bars between two times: the base line fits the
 * closes (or another `source`) by least squares, and the lines `levels` standard deviations away,
 * +2 and -2 by default, bound the channel. Pearson's R shows how well the line fits. Only the
 * anchors' times count: their handles sit on the base line. Hiding a line hides it. Alerts watch
 * the lines shown by their deviations: `2`, `-2`, and `0` for the base line.
 */
export const regressionTrend: DrawingTypeDefinition<Anchors<2>> = {
  type: 'regression-trend',
  points: 2,
  mainPane: true,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', 'extendRight', 'source'],
  defaultStyle: () => ({ levels: [{ value: 2 }, { value: 0 }, { value: -2 }] }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const channel = channelOf(geometry);

    if (!channel) {
      return;
    }

    const { style } = geometry;

    // Each band is tinted with the color of the line above it.
    if (style.fill) {
      channel.lines.forEach(({ level, line }, index) => {
        const below = channel.lines[index + 1];

        if (below) {
          fillArea(
            ctx,
            [line[0], line[1], below.line[1], below.line[0]],
            withAlpha(level.color, 0.1)
          );
        }
      });
    }

    for (const { level, line } of channel.lines) {
      strokeDrawing(
        context,
        (path) => {
          tracePath(path, line, false);
        },
        { color: level.color, ...(level.value === 0 ? { lineStyle: 'dashed' as const } : {}) }
      );
    }

    // Pearson's R under the lowest line, where the channel starts.
    const lowest = channel.lines.at(-1)?.line;

    if (lowest) {
      ctx.font = font(style.fontSize - 1, geometry.fontFamily);
      ctx.fillStyle = style.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(ratioText(channel.fit.pearson), lowest[0].x, lowest[0].y + LABEL_GAP);
    }
  },
  hitTest: (geometry, point, tolerance) => {
    const channel = channelOf(geometry);
    return channel
      ? shapeHit(
          point,
          channel.lines.map(({ line }) => line),
          areaOf(channel),
          tolerance,
          geometry.style.fill
        )
      : null;
  },
  handles: (geometry): DrawingHandle[] =>
    (channelOf(geometry)?.ends ?? []).map((end, index) => ({
      id: String(index),
      x: end.x,
      y: end.y,
      cursor: 'ew-resize'
    })),
  // Dragging an end moves it in time; the value follows from the bars.
  moveHandle: (anchors, handle, to) =>
    anchors.map((anchor, index) =>
      String(index) === handle ? { ...anchor, time: to.time } : anchor
    ),
  axisMarks: ([from, to]) => ({ prices: [], times: [from.time, to.time] }),
  // The lines shown, and Pearson's R under the lowest.
  bounds: (geometry) => {
    const channel = channelOf(geometry);
    const lowest = channel?.lines.at(-1)?.line;
    return channel && lowest
      ? boundsOf([
          ...channel.lines.flatMap(({ line }) => line),
          {
            x: lowest[0].x + geometry.measureText(ratioText(channel.fit.pearson)),
            y: lowest[0].y + LABEL_GAP + geometry.style.fontSize
          }
        ])
      : null;
  },
  // Each line shown, from its value at the first bar to that at the last; extended as drawn. The
  // outer lines come first, so that a channel between the first two is the whole channel. Until
  // two bars lie between the anchors, the lines reach no bar.
  levels: ([from, to], _scale, style, { bars }) => {
    const fit = fitOf(bars, from.time, to.time, style.source);
    const [highest, ...inner] = shownDeviations(style);
    const lowest = inner.pop();
    const ordered = [highest, lowest, ...inner].filter(
      (level): level is ShownLevel => level !== undefined
    );
    return ordered.map((level): DrawingLevel => {
      const key = ratioText(level.value);

      if (!fit) {
        return { key, from, to, valueAt: () => Number.NaN };
      }

      const point = (index: number): DrawingPoint => ({
        time: bars.time(index),
        price: fit.start + fit.slope * (index - fit.first) + level.value * fit.deviation
      });
      return {
        key,
        from: point(fit.first),
        to: point(fit.last),
        extend: style.extendRight ? 'end' : 'none'
      };
    });
  }
};

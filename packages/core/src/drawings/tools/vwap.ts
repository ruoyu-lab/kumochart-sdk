import { withAlpha } from '../../canvas/color';
import type { BarsView, PriceSource } from '../../data/types';
import type { Point } from '../../interaction/types';
import { boundsOf, insidePolygon, segmentsOf } from '../geometry';
import type {
  Anchors,
  DrawingGeometry,
  DrawingLevel,
  DrawingStyle,
  DrawingTypeDefinition
} from '../types';
import {
  barPrice,
  barsCache,
  bodyHit,
  fillArea,
  ratioText,
  segmentsHit,
  type ShownLevel,
  shownLevels,
  strokeDrawing,
  tracePath
} from './shared';

/** A volume-weighted average price from an anchor bar on, bar by bar. */
export interface VwapSeries {
  /** Index of the anchor bar, where it starts. */
  readonly first: number;
  /** The average and the volume-weighted standard deviation at each bar from `first` on. */
  readonly vwap: Float64Array;
  readonly deviation: Float64Array;
}

/**
 * The VWAP of the `source` prices from the bar at or after `time` to the last bar, as the VWAP
 * indicator computes it within its period, without restarting: the
 * sum of price times volume over the sum of volume, and the volume-weighted standard deviation
 * `sqrt(Σ p²v / Σ v − vwap²)` the bands are multiples of. `NaN` until some volume has traded.
 */
export function vwapSeries(bars: BarsView, time: number, source: PriceSource): VwapSeries {
  const first = bars.lowerBound(time);
  const count = Math.max(0, bars.length - first);
  const vwap = new Float64Array(count);
  const deviation = new Float64Array(count);
  let volume = 0;
  let sum = 0;
  let squares = 0;

  for (let offset = 0; offset < count; offset += 1) {
    const index = first + offset;
    const price = barPrice(bars, index, source);
    const traded = bars.volume(index);
    volume += traded;
    sum += price * traded;
    squares += price * price * traded;
    const average = sum / volume;
    vwap[offset] = average;
    deviation[offset] = Math.sqrt(Math.max(0, squares / volume - average * average));
  }

  return { first, vwap, deviation };
}

const seriesCache = /* @__PURE__ */ barsCache<VwapSeries>(64);

function seriesOf(bars: BarsView, time: number, source: PriceSource): VwapSeries {
  return seriesCache(bars, `${time}:${source}`, () => vwapSeries(bars, time, source));
}

/** The bands shown: a level of 0 would be the VWAP itself. */
function shownBands(style: DrawingStyle): ShownLevel[] {
  return shownLevels(style.levels, style).filter((level) => level.value > 0);
}

/** A line of the VWAP: its points in view, from the anchor bar on. */
type Curve = readonly Point[];

interface Lines {
  readonly vwap: Curve;
  readonly bands: ReadonlyArray<{
    readonly color: string;
    readonly upper: Curve;
    readonly lower: Curve;
  }>;
}

/** The VWAP and its bands over the bars in view, and a bar on either side to reach the edges. */
function linesOf(geometry: DrawingGeometry<Anchors<1>>): Lines | null {
  const [anchor] = geometry.anchors;
  const { bars, style } = geometry;
  const series = seriesOf(bars, anchor.time, style.source);

  if (series.vwap.length === 0) {
    return null;
  }

  // Bars are evenly spaced on screen: the first bar's x and the spacing place every other.
  const start = geometry.timeToX(bars.time(series.first));
  const spacing =
    series.vwap.length > 1 ? geometry.timeToX(bars.time(series.first + 1)) - start : 1;
  const from = Math.max(0, Math.floor(-start / spacing) - 1);
  const to = Math.min(series.vwap.length - 1, Math.ceil((geometry.width - start) / spacing) + 1);
  const curve = (value: (offset: number) => number): Point[] => {
    const points: Point[] = [];

    for (let offset = from; offset <= to; offset += 1) {
      const y = geometry.valueToY(value(offset));

      if (Number.isFinite(y)) {
        points.push({ x: start + offset * spacing, y });
      }
    }

    return points;
  };
  const vwapAt = (offset: number) => series.vwap[offset] ?? Number.NaN;
  const deviationAt = (offset: number) => series.deviation[offset] ?? Number.NaN;
  return {
    vwap: curve(vwapAt),
    bands: shownBands(style).map((level) => ({
      color: level.color,
      upper: curve((offset) => vwapAt(offset) + level.value * deviationAt(offset)),
      lower: curve((offset) => vwapAt(offset) - level.value * deviationAt(offset))
    }))
  };
}

/** The area between the curves of a band. */
function bandArea(band: { readonly upper: Curve; readonly lower: Curve }): Point[] {
  return [...band.upper, ...[...band.lower].reverse()];
}

/**
 * The volume-weighted average price from the anchor bar on: of
 * `hlc3` by default, with bands `levels` volume-weighted standard deviations away (the first,
 * at 1, shown, in the up color). Only the anchor's time counts: its handle sits on the VWAP. Alerts watch the
 * VWAP (`vwap`) and the bands shown, by their deviations from it: `1` and `-1` for the band at 1.
 */
export const anchoredVwap: DrawingTypeDefinition<Anchors<1>> = {
  type: 'anchored-vwap',
  points: 1,
  mainPane: true,
  fields: ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', 'source'],
  // The bands in the up color, apart from the VWAP.
  defaultStyle: (theme) => ({
    source: 'hlc3',
    levels: [
      { value: 1, color: theme.up },
      { value: 2, color: theme.up, visible: false },
      { value: 3, color: theme.up, visible: false }
    ]
  }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const lines = linesOf(geometry);

    if (!lines) {
      return;
    }

    if (geometry.style.fill) {
      for (const band of lines.bands) {
        fillArea(ctx, bandArea(band), withAlpha(band.color, 0.06));
      }
    }

    for (const band of lines.bands) {
      strokeDrawing(
        context,
        (path) => {
          tracePath(path, band.upper, false);
          tracePath(path, band.lower, false);
        },
        { color: band.color }
      );
    }

    strokeDrawing(context, (path) => {
      tracePath(path, lines.vwap, false);
    });
  },
  hitTest: (geometry, point, tolerance) => {
    const lines = linesOf(geometry);

    if (!lines) {
      return null;
    }

    const curves = [lines.vwap, ...lines.bands.flatMap((band) => [band.upper, band.lower])];
    // The bands are hit inside where they are filled.
    const inside =
      geometry.style.fill && lines.bands.some((band) => insidePolygon(point, bandArea(band)));
    return (
      segmentsHit(
        point,
        curves.flatMap((curve) => segmentsOf(curve, false)),
        tolerance
      ) ?? (inside ? bodyHit : null)
    );
  },
  handles: (geometry) => {
    const [anchor] = geometry.anchors;
    const series = seriesOf(geometry.bars, anchor.time, geometry.style.source);
    const value = series.vwap[0];
    return value === undefined
      ? []
      : [
          {
            id: '0',
            x: geometry.timeToX(geometry.bars.time(series.first)),
            y: geometry.valueToY(value),
            cursor: 'ew-resize'
          }
        ];
  },
  // Dragging the anchor moves it in time; the value follows from the bars.
  moveHandle: ([anchor], _handle, to) => [{ ...anchor, time: to.time }],
  axisMarks: ([anchor]) => ({ prices: [], times: [anchor.time] }),
  bounds: (geometry) => {
    const lines = linesOf(geometry);
    return (
      lines &&
      boundsOf([...lines.vwap, ...lines.bands.flatMap((band) => [...band.upper, ...band.lower])])
    );
  },
  levels: ([anchor], _scale, style, { bars }) => {
    // Values at the bars from the anchor bar on, which these lines go through.
    const valueAt = (time: number, value: (series: VwapSeries, offset: number) => number) => {
      const series = seriesOf(bars, anchor.time, style.source);
      const index = bars.lowerBound(time);
      const offset = index - series.first;
      return index < bars.length &&
        bars.time(index) === time &&
        offset >= 0 &&
        offset < series.vwap.length
        ? value(series, offset)
        : Number.NaN;
    };
    const line = (
      key: string,
      value: (series: VwapSeries, offset: number) => number
    ): DrawingLevel => ({
      key,
      from: anchor,
      to: anchor,
      valueAt: (time) => valueAt(time, value)
    });
    const vwap = (series: VwapSeries, offset: number) => series.vwap[offset] ?? Number.NaN;
    const deviation = (series: VwapSeries, offset: number) =>
      series.deviation[offset] ?? Number.NaN;
    return [
      line('vwap', vwap),
      ...shownBands(style).flatMap((level) => [
        line(
          ratioText(level.value),
          (series, offset) => vwap(series, offset) + level.value * deviation(series, offset)
        ),
        line(
          ratioText(-level.value),
          (series, offset) => vwap(series, offset) - level.value * deviation(series, offset)
        )
      ])
    ];
  }
};

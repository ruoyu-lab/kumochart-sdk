import { font } from '../canvas/canvas';
import { formatValue, type ValueFormat } from '../format/value-format';
import type { BufferPool } from '../render/contributors';
import type { FrameSources, PlotJob, PlotLabel } from '../render/frame';
import type { LineStyle } from '../options/types';
import { includeValue, type Extents, type PriceScale } from '../scales/price-scale';
import type { IndicatorSeries } from './instance';
import type { IndicatorPlot, ZigzagLabels } from './types';

export type ZigzagPlot = Extract<IndicatorPlot, { kind: 'zigzag' }>;

/** A pivot of a zigzag, or the end it is extended to. */
export interface ZigzagPivot {
  /** The output the value is of, and the bar it is computed on. */
  readonly column: number;
  readonly at: number;
  /** The bar of its series it is drawn on. */
  readonly bar: number;
  readonly price: number;
  readonly high: boolean;
  /** From the pivot before, 0 for the first. */
  readonly change: number;
  /** The price of the pivot before, its own for the first. */
  readonly previous: number;
  /** Of the bars after the pivot before through this one's, from the first bar for the first. */
  readonly volume: number;
}

/** The outputs a zigzag reads: its own, which it is extended to, and those of the pivots. */
export interface ZigzagColumns {
  readonly own: number;
  readonly high: number;
  readonly low: number;
}

/** The pivots worked out of a series as its values were at a version. */
interface Resolved {
  readonly version: number;
  readonly columns: ZigzagColumns;
  readonly pivots: readonly ZigzagPivot[];
}

/** The pivots of each series, worked out again only once its values change. */
const resolved = new WeakMap<IndicatorSeries, Resolved>();

/** A value of the highs or the lows, the bar it is computed on and the bar it is drawn on. */
type Side = Pick<ZigzagPivot, 'column' | 'at' | 'bar' | 'price' | 'high'>;

/** The highs and lows a series has values of, by the bar they are drawn on, a high first. */
function sides(series: IndicatorSeries, columns: ZigzagColumns): Side[] {
  const values: Side[] = [];
  const highShift = series.shift(columns.high);
  const lowShift = series.shift(columns.low);

  for (let at = 0; at < series.length; at += 1) {
    const high = series.value(columns.high, at);
    const low = series.value(columns.low, at);

    if (!Number.isNaN(high)) {
      values.push({ column: columns.high, at, bar: at + highShift, price: high, high: true });
    }

    if (!Number.isNaN(low)) {
      values.push({ column: columns.low, at, bar: at + lowShift, price: low, high: false });
    }
  }

  // Shifted apart, the sides are merged by their bars; the sort keeps the order of each.
  return highShift === lowShift
    ? values
    : values.sort((left, right) => left.bar - right.bar || Number(right.high) - Number(left.high));
}

/** Volume of the bars of `series` after bar `from` through bar `to`. */
function volumeBetween(series: IndicatorSeries, from: number, to: number): number {
  const { bars } = series;
  let total = 0;

  for (let bar = Math.max(0, from + 1); bar <= Math.min(to, bars.length - 1); bar += 1) {
    total += bars.volume(bar);
  }

  return total;
}

/** The pivot `side` makes after `before`, its change and volume measured from it. */
function pivotAfter(
  series: IndicatorSeries,
  side: Side,
  before: ZigzagPivot | undefined
): ZigzagPivot {
  const previous = before?.price ?? side.price;
  return {
    ...side,
    change: side.price - previous,
    previous,
    volume: volumeBetween(series, before?.bar ?? -1, side.bar)
  };
}

/**
 * The pivots of a zigzag: of each run of highs (or lows) the last one. Worked out once for each
 * version of the values, so a frame that only moves the view reuses them.
 */
export function zigzagPivots(
  series: IndicatorSeries,
  columns: ZigzagColumns
): readonly ZigzagPivot[] {
  const known = resolved.get(series);

  if (
    known?.version === series.version &&
    known.columns.high === columns.high &&
    known.columns.low === columns.low
  ) {
    return known.pivots;
  }

  const runs: Side[] = [];

  for (const side of sides(series, columns)) {
    if (runs.at(-1)?.high === side.high) {
      runs[runs.length - 1] = side;
    } else {
      runs.push(side);
    }
  }

  const pivots: ZigzagPivot[] = [];

  for (const run of runs) {
    pivots.push(pivotAfter(series, run, pivots.at(-1)));
  }

  resolved.set(series, { version: series.version, columns, pivots });
  return pivots;
}

/** The end the line is extended to: the own output's value on the latest bar, if it has one. */
function extension(
  series: IndicatorSeries,
  columns: ZigzagColumns,
  last: ZigzagPivot | undefined
): ZigzagPivot | null {
  const at = series.length - 1;
  const price = series.value(columns.own, at);

  if (!last || Number.isNaN(price)) {
    return null;
  }

  const bar = at + series.shift(columns.own);
  return pivotAfter(series, { column: columns.own, at, bar, price, high: !last.high }, last);
}

/** The index of the first pivot drawn at or after logical index `index`, or their count. */
function firstFrom(series: IndicatorSeries, pivots: readonly ZigzagPivot[], index: number): number {
  let low = 0;
  let high = pivots.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const pivot = pivots[middle] as ZigzagPivot;

    if (series.indexOf(pivot.column, pivot.at) < index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/** A zigzag of an indicator as a frame draws it over logical indices `[from, to]`. */
export class ZigzagView {
  /** The pivots the line goes through, one beyond the window on each side, and its end. */
  readonly points: readonly ZigzagPivot[];
  /** Logical index of each of `points`. */
  readonly indices: readonly number[];

  constructor(
    series: IndicatorSeries,
    private readonly plot: ZigzagPlot,
    columns: ZigzagColumns,
    private readonly from: number,
    private readonly to: number
  ) {
    const pivots = zigzagPivots(series, columns);
    const start = Math.max(0, firstFrom(series, pivots, from) - 1);
    const end = Math.min(pivots.length, firstFrom(series, pivots, to + 1) + 1);
    const tail =
      plot.extend && end === pivots.length ? extension(series, columns, pivots.at(-1)) : null;
    this.points = [...pivots.slice(start, end), ...(tail ? [tail] : [])];
    this.indices = this.points.map((point) => series.indexOf(point.column, point.at));
  }

  /** Widens `extents` by the pivots in view. */
  include(extents: Extents): void {
    this.points.forEach((point, index) => {
      if (this.inView(index)) {
        includeValue(extents, point.price);
      }
    });
  }

  /** The line through the points, and the labels of those in view. */
  emit(
    key: string,
    sources: FrameSources,
    scale: PriceScale,
    pool: BufferPool,
    style: { readonly color: string; readonly lineWidth: number; readonly lineStyle: LineStyle },
    format: ValueFormat,
    jobs: PlotJob[]
  ): void {
    const { timeScale, seriesTypes, options } = sources;
    const points = pool.take(key);
    points.reset(this.points.length);
    this.points.forEach((point, index) => {
      points.pushValue(
        timeScale.indexToX(this.indices[index] ?? Number.NaN),
        scale.valueToY(point.price),
        point.high
      );
    });
    jobs.push({
      kind: 'series',
      definition: seriesTypes.require('line'),
      style,
      points,
      valueToY: (value) => scale.valueToY(value),
      bars: null,
      first: this.from,
      transform: null
    });

    const labels = this.labels(sources, scale, format);

    if (labels.length > 0) {
      const size = options.font.size - 1;
      jobs.push({
        kind: 'labels',
        labels,
        font: font(size, options.font.family),
        lineHeight: Math.round(size * 1.3)
      });
    }
  }

  private inView(index: number): boolean {
    const at = this.indices[index] ?? Number.NaN;
    return at >= this.from && at <= this.to;
  }

  private labels(sources: FrameSources, scale: PriceScale, format: ValueFormat): PlotLabel[] {
    const shown: ZigzagLabels = this.plot.labels ?? {};

    if (!shown.price && !shown.change && !shown.volume) {
      return [];
    }

    const { theme } = sources.options;
    return this.points.flatMap((point, index) =>
      this.inView(index)
        ? [
            {
              x: sources.timeScale.indexToX(this.indices[index] ?? Number.NaN),
              y: scale.valueToY(point.price),
              text: labelText(point, shown, sources, format),
              above: point.high,
              color: point.high ? theme.up : theme.down
            }
          ]
        : []
    );
  }
}

/** What the label of a pivot writes: its price and change, then its volume on a line of its own. */
function labelText(
  point: ZigzagPivot,
  shown: ZigzagLabels,
  { formatter }: Pick<FrameSources, 'formatter'>,
  format: ValueFormat
): string {
  const first: string[] = [];

  if (shown.price) {
    first.push(formatValue(formatter, point.price, format));
  }

  if (shown.change) {
    const change =
      shown.change === 'percent'
        ? `${formatValue(formatter, (point.change * 100) / point.previous, { kind: 'decimal', precision: 2 })}%`
        : formatValue(formatter, point.change, format);
    first.push(`(${point.change > 0 ? '+' : ''}${change})`);
  }

  const lines = [first.join(' ')];

  if (shown.volume) {
    lines.push(formatValue(formatter, point.volume, { kind: 'compact' }));
  }

  return lines.filter((line) => line !== '').join('\n');
}

import type { BarsView } from '../data/types';
import type { Theme } from '../options/types';

/** Render-ready points of a series in plot coordinates, ordered from left to right. */
export interface SeriesPoints {
  readonly count: number;
  /** Bar center. */
  x(index: number): number;
  /** y of open, high, low and close for OHLC input. */
  open(index: number): number;
  high(index: number): number;
  low(index: number): number;
  close(index: number): number;
  /** Volume of OHLC input, as traded (not a coordinate); `NaN` for value input. */
  volume(index: number): number;
  /** y of the value for value input; `NaN` marks a gap. */
  value(index: number): number;
  /** Rising point: close ≥ open, or value ≥ the previous value. */
  isUp(index: number): boolean;
  /** A color chosen for this point (the main series' `barColor`), or `null` for the style's. */
  color(index: number): string | null;
}

export interface SeriesPaintContext<Style> {
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  /** Plot width and height; the context is translated to the plot's top-left corner. */
  readonly width: number;
  readonly height: number;
  readonly barSpacing: number;
  readonly style: Style;
  readonly points: SeriesPoints;
  /** Converts a data value into a y coordinate of the plot. */
  readonly valueToY: (value: number) => number;
  /**
   * Every bar of an OHLC series, not only those in view, for types whose look follows from the
   * bars before, such as Kagi lines, thick from where they pass the last shoulder. `null` for
   * value series.
   */
  readonly bars: BarsView | null;
  /** Position of the first point in the series' data: point `i` is bar `first + i`. */
  readonly first: number;
  /**
   * What the transform building the main series' bars reports it builds them with
   * (`chart.transforms.get().resolved`), such as the box size of point & figure columns; `null` for
   * other series and for bars no transform builds.
   */
  readonly transform: Readonly<Record<string, unknown>> | null;
}

/** Describes how a series type is drawn. Register custom types with `chart.series.register()`. */
export interface SeriesTypeDefinition<Style extends object = Record<string, unknown>> {
  /** The type series of it name, such as `candles`. */
  readonly type: string;
  /** `ohlc` series plot open/high/low/close; `value` series plot one value per point. */
  readonly input: 'ohlc' | 'value';
  /** Full style derived from the theme; user overrides are merged on top. */
  defaultStyle(theme: Theme, color: string): Style;
  /** Values the price scale must include in addition to the data, such as a column base. */
  extraExtents?(style: Style): readonly number[];
  paint(context: SeriesPaintContext<Style>): void;
}

/** Reusable typed-array storage behind {@link SeriesPoints}. */
export class PointBuffer implements SeriesPoints {
  count = 0;
  private xs = new Float64Array(64);
  private opens = new Float64Array(64);
  private highs = new Float64Array(64);
  private lows = new Float64Array(64);
  private closes = new Float64Array(64);
  private volumes = new Float64Array(64);
  private values = new Float64Array(64);
  private ups = new Uint8Array(64);
  private colors: Array<string | null> = [];

  /** Empties the buffer and makes room for `size` points. */
  reset(size: number): void {
    this.count = 0;
    this.colors.length = 0;

    if (this.xs.length >= size) {
      return;
    }

    const capacity = Math.max(size, this.xs.length * 2);
    this.xs = new Float64Array(capacity);
    this.opens = new Float64Array(capacity);
    this.highs = new Float64Array(capacity);
    this.lows = new Float64Array(capacity);
    this.closes = new Float64Array(capacity);
    this.volumes = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
    this.ups = new Uint8Array(capacity);
  }

  pushOhlc(
    x: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    up: boolean,
    color: string | null = null
  ): void {
    const index = this.count;
    this.colors[index] = color;
    this.xs[index] = x;
    this.opens[index] = open;
    this.highs[index] = high;
    this.lows[index] = low;
    this.closes[index] = close;
    this.volumes[index] = volume;
    this.ups[index] = up ? 1 : 0;
    this.count = index + 1;
  }

  pushValue(x: number, value: number, up: boolean): void {
    const index = this.count;
    this.colors[index] = null;
    this.xs[index] = x;
    this.volumes[index] = Number.NaN;
    this.values[index] = value;
    this.ups[index] = up ? 1 : 0;
    this.count = index + 1;
  }

  x(index: number): number {
    return this.xs[index] ?? Number.NaN;
  }

  open(index: number): number {
    return this.opens[index] ?? Number.NaN;
  }

  high(index: number): number {
    return this.highs[index] ?? Number.NaN;
  }

  low(index: number): number {
    return this.lows[index] ?? Number.NaN;
  }

  close(index: number): number {
    return this.closes[index] ?? Number.NaN;
  }

  volume(index: number): number {
    return this.volumes[index] ?? Number.NaN;
  }

  value(index: number): number {
    return this.values[index] ?? Number.NaN;
  }

  isUp(index: number): boolean {
    return this.ups[index] === 1;
  }

  color(index: number): string | null {
    return this.colors[index] ?? null;
  }
}

import type { LineStyle } from '../options/types';

export interface CandleStyle {
  upColor: string;
  downColor: string;
  upWickColor: string;
  downWickColor: string;
  upBorderColor: string;
  downBorderColor: string;
  wick: boolean;
  border: boolean;
  /** Body width as a fraction of the bar spacing. */
  bodyRatio: number;
}

export interface OhlcStyle {
  upColor: string;
  downColor: string;
  lineWidth: number;
  /** Draws the open (left) and close (right) ticks. */
  ticks: boolean;
}

export interface HighLowStyle {
  upColor: string;
  downColor: string;
  lineWidth: number;
}

export interface LineSeriesStyle {
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
}

export interface LineMarkersStyle extends LineSeriesStyle {
  markerRadius: number;
}

export interface AreaStyle {
  lineColor: string;
  lineWidth: number;
  topColor: string;
  bottomColor: string;
}

export interface BaselineStyle {
  /** Values above it use the top colors. `null` uses the first visible value. */
  baseValue: number | null;
  lineWidth: number;
  topLineColor: string;
  topFillColor: string;
  bottomLineColor: string;
  bottomFillColor: string;
}

export interface HlcAreaStyle {
  highColor: string;
  lowColor: string;
  closeColor: string;
  /** Between the highs and the closes. */
  highFillColor: string;
  /** Between the closes and the lows. */
  lowFillColor: string;
  lineWidth: number;
}

export interface ColumnsStyle {
  upColor: string;
  downColor: string;
  /**
   * Columns grow from this value; `null` from the bottom of the pane, as price columns do, and
   * so does a value the scale cannot show, such as 0 on a logarithmic one.
   */
  base: number | null;
  /** Column width as a fraction of the bar spacing. */
  widthRatio: number;
}

/** Kagi lines: yang (thick) from where a line passes the last shoulder, yin (thin) under the last waist. */
export interface KagiStyle {
  /** Yang lines. */
  upColor: string;
  /** Yin lines. */
  downColor: string;
  upWidth: number;
  downWidth: number;
}

/** Point & figure columns: X's rising, O's falling, one in each box. */
export interface PointFigureStyle {
  upColor: string;
  downColor: string;
  lineWidth: number;
  /** Width of a box as a fraction of the bar spacing. */
  widthRatio: number;
  /** The box size; `null` takes the one the transform building the bars reports. */
  box: number | null;
}

/**
 * Resolved style of every series type. Plugins add their own types through declaration merging:
 *
 * ```ts
 * declare module '@kumo-charts/core' {
 *   interface SeriesStyleMap { renko: { boxColor: string } }
 * }
 * ```
 */
export interface SeriesStyleMap {
  candles: CandleStyle;
  'hollow-candles': CandleStyle;
  /** Of the chart types module. */
  'volume-candles': CandleStyle;
  ohlc: OhlcStyle;
  'high-low': HighLowStyle;
  line: LineSeriesStyle;
  'step-line': LineSeriesStyle;
  'line-markers': LineMarkersStyle;
  area: AreaStyle;
  baseline: BaselineStyle;
  'hlc-area': HlcAreaStyle;
  columns: ColumnsStyle;
  /** Of the chart types module: the lines of the `kagi` transform. */
  kagi: KagiStyle;
  /** Of the chart types module: the columns of the `point-figure` transform. */
  'point-figure': PointFigureStyle;
}

export type SeriesType = keyof SeriesStyleMap;

/** Partial style overrides keyed by series type; `null` drops those of a type. */
export type SeriesStyleOverrides = { [K in SeriesType]?: Partial<SeriesStyleMap[K]> | null };

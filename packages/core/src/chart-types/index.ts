import type { ChartType } from './module';
import { kagiTransform } from './kagi';
import { kagiSeries } from './kagi-series';
import { pointFigureTransform } from './point-figure';
import { pointFigureSeries } from './point-figure-series';
import { renkoTransform } from './renko';
import {
  heikinAshiTransform,
  lineBreakTransform,
  rangeTransform,
  tickTransform,
  turnoverTransform,
  volumeTransform
} from './transforms';
import { volumeCandlesSeries } from './volume-candles';

export { chartTypes } from './module';
export type { ChartType, ChartTypesModule } from './module';
export type { RenkoSource } from './renko';
export type { PointFigureSource } from './point-figure';

/** Heikin-Ashi candles, each from the average of its bar and the one before. */
export const heikinAshi: ChartType = { transform: heikinAshiTransform };
/** Renko bricks on a grid of multiples of the box. */
export const renko: ChartType = { transform: renkoTransform };
/** Range bars, each spanning the same range. */
export const rangeBars: ChartType = { transform: rangeTransform };
/** Line break: a line goes on until the closes break the lines before. */
export const lineBreak: ChartType = { transform: lineBreakTransform };
/** Kagi lines, thick where they pass the last shoulder and thin under the last waist. */
export const kagi: ChartType = { transform: kagiTransform, series: kagiSeries };
/** Point & figure columns of X's and O's. */
export const pointFigure: ChartType = {
  transform: pointFigureTransform,
  series: pointFigureSeries
};
/** Bars of the same number of trades. */
export const tickBars: ChartType = { transform: tickTransform };
/** Bars of the same volume. */
export const volumeBars: ChartType = { transform: volumeTransform };
/** Bars of the same turnover. */
export const turnoverBars: ChartType = { transform: turnoverTransform };
/** Candles as wide as their volume. */
export const volumeCandles: ChartType = { series: volumeCandlesSeries };

/** Every chart type of the SDK, for `chartTypes(allChartTypes)`. */
export const allChartTypes: readonly ChartType[] = [
  heikinAshi,
  renko,
  rangeBars,
  lineBreak,
  kagi,
  pointFigure,
  tickBars,
  volumeBars,
  turnoverBars,
  volumeCandles
];

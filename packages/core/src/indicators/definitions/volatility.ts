import type { Bar } from '../../data/types';
import {
  MovingSum,
  Previous,
  RollingExtremes,
  SeededAverage,
  StandardDeviation
} from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import {
  choiceParam,
  lineOutput,
  movingAverage,
  ParallelStream,
  periodParam,
  picked,
  ratio,
  type AverageKind,
  type BarStep
} from './shared';

/** `MAX(H - L, |H - C'|, |L - C'|)`; `NaN` without a previous close `C'`. */
export function trueRange(bar: Bar, previousClose: number): number {
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose)
  );
}

/** The true range of each bar, the first bar's being its high minus its low. */
export class TrueRangeStep {
  constructor(private readonly closes = new Previous()) {}

  next(bar: Bar): number {
    const previous = this.closes.next(bar.close);
    return Number.isNaN(previous) ? bar.high - bar.low : trueRange(bar, previous);
  }

  clone(): TrueRangeStep {
    return new TrueRangeStep(this.closes.clone());
  }
}

/**
 * Average true range: Wilder's smoothing of the true range, seeded with the mean of the first
 * `period` ranges, the first of which is the bar's high minus its low.
 */
export class AverageTrueRange {
  constructor(
    private readonly ranges: TrueRangeStep,
    private readonly average: SeededAverage
  ) {}

  static of(period: number): AverageTrueRange {
    return new AverageTrueRange(new TrueRangeStep(), SeededAverage.rma(period));
  }

  next(bar: Bar): number {
    return this.average.next(this.ranges.next(bar));
  }

  clone(): AverageTrueRange {
    return new AverageTrueRange(this.ranges.clone(), this.average.clone());
  }
}

/** A moving average of the true range. */
class AtrStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly ranges: TrueRangeStep,
    private readonly average: BarStep
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.out[0] = this.average.next(this.ranges.next(bar), bar);
    return this.out;
  }

  clone(): IndicatorStream {
    return new AtrStream(this.ranges.clone(), this.average.clone());
  }
}

/** The averages the true range is smoothed with, by option value. */
const ATR_AVERAGES: readonly AverageKind[] = ['rma', 'sma', 'ema', 'wma'];

/**
 * Average true range: a moving average of the true range of `period` bars, Wilder's smoothing
 * (RMA) by default; the first bar's range is its high minus its low.
 */
export const ATR: IndicatorDefinition<{ period: number; smoothing: number }> = {
  type: 'ATR',
  name: 'ATR',
  pane: 'new',
  precision: 'price',
  params: {
    period: periodParam(14, 'Length'),
    smoothing: choiceParam(['RMA', 'SMA', 'EMA', 'WMA'], 0, 'Smoothing')
  },
  outputs: () => [lineOutput('ATR')],
  create: ({ period, smoothing }) =>
    new AtrStream(
      new TrueRangeStep(),
      movingAverage(picked(ATR_AVERAGES, smoothing, 'smoothing'), period)
    )
};

/** Population standard deviation of the source price. */
export const STD: IndicatorDefinition<{ period: number }> = {
  type: 'STD',
  name: 'STD',
  pane: 'new',
  precision: 'price',
  params: { period: { default: 20, min: 2, max: 2000, integer: true, label: 'Period' } },
  outputs: () => [lineOutput('STD')],
  create: ({ period }) =>
    new ParallelStream([new StandardDeviation(period)], (_bar, price) => price)
};

/**
 * Choppiness index: `100 * log10(SUM(TR, N) / (HHV(H, N) - LLV(L, N))) / log10(N)`, the true
 * range of the first bar being its high minus its low. Near 100 the market moves sideways, near 0
 * it trends.
 */
class ChopStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly period: number,
    private readonly ranges = new TrueRangeStep(),
    private readonly sums = new MovingSum(period),
    private readonly extremes = new RollingExtremes(period)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const sum = this.sums.next(this.ranges.next(bar));
    this.extremes.push(bar.high, bar.low);
    const spread = this.extremes.highest() - this.extremes.lowest();
    this.out[0] = (100 * Math.log10(ratio(sum, spread))) / Math.log10(this.period);
    return this.out;
  }

  clone(): IndicatorStream {
    return new ChopStream(
      this.period,
      this.ranges.clone(),
      this.sums.clone(),
      this.extremes.clone()
    );
  }
}

export const CHOP: IndicatorDefinition<{ period: number }> = {
  type: 'CHOP',
  name: 'CHOP',
  pane: 'new',
  precision: 2,
  params: { period: { default: 14, min: 2, max: 2000, integer: true, label: 'Length' } },
  outputs: () => [lineOutput('CHOP')],
  levels: () => [61.8, 50, 38.2],
  create: ({ period }) => new ChopStream(period)
};

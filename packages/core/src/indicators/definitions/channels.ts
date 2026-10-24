import type { Bar } from '../../data/types';
import { RollingExtremes, SeededAverage, StandardDeviation } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import {
  choiceParam,
  movingAverage,
  namedLine,
  periodParam,
  picked,
  switchParam,
  type AverageKind,
  type BarStep
} from './shared';
import { AverageTrueRange, TrueRangeStep } from './volatility';

/** Shades the channel between its upper and lower lines. */
const CHANNEL_FILLS = () => [{ from: 'upper', to: 'lower' }];

/** The averages the basis of Bollinger Bands takes, by option value. */
const BASIS_AVERAGES: readonly AverageKind[] = ['sma', 'ema', 'rma', 'wma', 'vwma'];

class BollingerStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly multiplier: number,
    private readonly mean: BarStep,
    private readonly deviation: StandardDeviation
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const basis = this.mean.next(price, bar);
    const spread = this.deviation.next(price) * this.multiplier;
    this.out[0] = basis;
    this.out[1] = basis + spread;
    this.out[2] = basis - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    return new BollingerStream(this.multiplier, this.mean.clone(), this.deviation.clone());
  }
}

/**
 * Bollinger Bands: a moving average of the price, SMA by default, and bands `multiplier`
 * population standard deviations of the price over the same length above and below it.
 */
export const BOLL: IndicatorDefinition<{ period: number; maType: number; multiplier: number }> = {
  type: 'BOLL',
  name: 'BOLL',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(20, 'Length'),
    maType: choiceParam(['SMA', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'], 0, 'Basis MA Type'),
    multiplier: { default: 2, min: 0.001, max: 50, label: 'StdDev' }
  },
  outputs: () => [
    namedLine('basis', 'Basis'),
    namedLine('upper', 'Upper'),
    namedLine('lower', 'Lower')
  ],
  fills: CHANNEL_FILLS,
  create: ({ period, maType, multiplier }) =>
    new BollingerStream(
      multiplier,
      movingAverage(picked(BASIS_AVERAGES, maType, 'basis average'), period),
      new StandardDeviation(period)
    )
};

/** What the width of Keltner Channels follows, by option value. */
const BAND_STYLES = ['Average True Range', 'True Range', 'Range'];

/** Wilder's smoothing of the bar's high minus its low. */
class RangeAverage {
  constructor(private readonly average: SeededAverage) {}

  next(bar: Bar): number {
    return this.average.next(bar.high - bar.low);
  }

  clone(): RangeAverage {
    return new RangeAverage(this.average.clone());
  }
}

type BandWidth = AverageTrueRange | TrueRangeStep | RangeAverage;

class KeltnerStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly multiplier: number,
    private readonly mean: BarStep,
    private readonly width: BandWidth
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const basis = this.mean.next(price, bar);
    const spread = this.width.next(bar) * this.multiplier;
    this.out[0] = basis + spread;
    this.out[1] = basis;
    this.out[2] = basis - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    return new KeltnerStream(this.multiplier, this.mean.clone(), this.width.clone());
  }
}

/**
 * Keltner Channels: an EMA of the price (or an SMA), seeded with its simple average, and bands
 * `multiplier` times the average true range of `atrPeriod` bars above and below it, or times the
 * true range of the bar, or times Wilder's smoothing of the bar's range over `period` bars.
 */
export const KC: IndicatorDefinition<{
  period: number;
  multiplier: number;
  exponential: number;
  bandStyle: number;
  atrPeriod: number;
}> = {
  type: 'KC',
  name: 'KC',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(20, 'Length'),
    multiplier: { default: 2, min: 0.1, max: 10, label: 'Multiplier' },
    exponential: switchParam(true, 'Use Exponential MA', false),
    bandStyle: choiceParam(BAND_STYLES, 0, 'Bands Style', false),
    atrPeriod: { ...periodParam(10, 'ATR Length'), legend: false }
  },
  outputs: () => [
    namedLine('upper', 'Upper'),
    namedLine('basis', 'Basis'),
    namedLine('lower', 'Lower')
  ],
  fills: CHANNEL_FILLS,
  create: ({ period, multiplier, exponential, bandStyle, atrPeriod }) => {
    picked(BAND_STYLES, bandStyle, 'band style');
    const width =
      bandStyle === 0
        ? AverageTrueRange.of(atrPeriod)
        : bandStyle === 1
          ? new TrueRangeStep()
          : new RangeAverage(SeededAverage.rma(period));
    return new KeltnerStream(
      multiplier,
      movingAverage(exponential === 1 ? 'ema' : 'sma', period),
      width
    );
  }
};

class DonchianStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(private readonly extremes: RollingExtremes) {}

  next(bar: Bar): ArrayLike<number> {
    this.extremes.push(bar.high, bar.low);
    const upper = this.extremes.highest();
    const lower = this.extremes.lowest();
    this.out[0] = (upper + lower) / 2;
    this.out[1] = upper;
    this.out[2] = lower;
    return this.out;
  }

  clone(): IndicatorStream {
    return new DonchianStream(this.extremes.clone());
  }
}

/** Donchian Channels: the highest high and lowest low of `period` bars, and their average. */
export const DC: IndicatorDefinition<{ period: number }> = {
  type: 'DC',
  name: 'DC',
  pane: 'main',
  precision: 'price',
  params: { period: periodParam(20, 'Length') },
  outputs: () => [
    namedLine('basis', 'Basis'),
    namedLine('upper', 'Upper'),
    namedLine('lower', 'Lower')
  ],
  fills: CHANNEL_FILLS,
  create: ({ period }) => new DonchianStream(new RollingExtremes(period))
};

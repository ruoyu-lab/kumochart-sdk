import type { Bar } from '../../data/types';
import { fixedMs, type Interval } from '../../feed/interval';
import {
  MovingSum,
  Previous,
  RingBuffer,
  SeededAverage,
  SimpleAverage,
  StandardDeviation
} from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { lineOutput, namedLine, periodParam, ratio } from './shared';

// How far prices spread: historical volatility, the mass index of the bars' ranges, and the width
// of Bollinger Bands and where the price lies within them.

/**
 * What annualizes a deviation of returns of bars of `interval`: `sqrt(365)` for intraday and
 * one-day bars, and bars without an interval, as daily returns; `sqrt(365 / 7)` for bars of
 * several days, weeks and months, as weekly returns.
 */
function annualization(interval: Interval | null): number {
  const daily =
    interval === null ||
    fixedMs(interval) !== null ||
    (interval.unit === 'day' && interval.count === 1);
  return Math.sqrt(365 / (daily ? 1 : 7));
}

/** The deviation of the logarithmic returns of the close, annualized, in percent. */
class VolatilityStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly scale: number,
    private readonly deviation: StandardDeviation,
    private readonly closes = new Previous()
  ) {}

  next(bar: Bar): ArrayLike<number> {
    // The first bar has no return, which the deviation skips.
    const growth = ratio(bar.close, this.closes.next(bar.close));
    this.out[0] = 100 * this.deviation.next(Math.log(growth)) * this.scale;
    return this.out;
  }

  clone(): IndicatorStream {
    return new VolatilityStream(this.scale, this.deviation.clone(), this.closes.clone());
  }
}

/**
 * Historical volatility: the population standard deviation of `period` logarithmic returns of
 * the close, `ln(C / C')`, in percent, annualized by the bars' interval: times `sqrt(365)` on
 * intraday and one-day bars (and bars without an interval), times `sqrt(365 / 7)` on bars of
 * several days, weeks and months. The first bar has no return, so it starts on bar `period`.
 */
export const HV: IndicatorDefinition<{ period: number }> = {
  type: 'HV',
  name: 'HV',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(10, 'Length') },
  outputs: () => [lineOutput('HV')],
  create: ({ period }, { interval }) =>
    new VolatilityStream(annualization(interval), new StandardDeviation(period))
};

/** Bars of the exponential averages of the mass index. */
const MASS_EMA = 9;

/** The ratio of the EMA of the range to the EMA of that EMA, summed over `period` bars. */
class MassStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly sum: MovingSum,
    private readonly single = SeededAverage.ema(MASS_EMA),
    private readonly double = SeededAverage.ema(MASS_EMA)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const single = this.single.next(bar.high - bar.low);
    this.out[0] = this.sum.next(ratio(single, this.double.next(single)));
    return this.out;
  }

  clone(): IndicatorStream {
    return new MassStream(this.sum.clone(), this.single.clone(), this.double.clone());
  }
}

/**
 * Mass index: the EMA of 9 bars of the range `H - L` divided by the EMA of 9 values of that EMA,
 * summed over `period` bars. Each EMA is seeded with the simple average of its first values, so
 * the ratio starts on bar 16 and the index on bar `16 + period - 1`.
 */
export const MASS: IndicatorDefinition<{ period: number }> = {
  type: 'MASS',
  name: 'Mass Index',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(10, 'Length') },
  outputs: () => [namedLine('massIndex', 'Mass Index')],
  create: ({ period }) => new MassStream(new MovingSum(period))
};

/** The parameters of the bands {@link BBW} and {@link BBP} measure. */
type BandParams = { period: number; multiplier: number };

const BAND_PARAMS = {
  period: periodParam(20, 'Length'),
  multiplier: { default: 2, min: 0.001, max: 50, label: 'StdDev' }
};

/** Bollinger Bands of the price: its simple average, and how far the bands lie from it. */
class Bands {
  /** The basis of the latest price. */
  basis = Number.NaN;
  /** How far the bands of the latest price lie from the basis. */
  spread = Number.NaN;

  constructor(
    private readonly multiplier: number,
    private readonly mean: SimpleAverage,
    private readonly deviation: StandardDeviation
  ) {}

  static of({ period, multiplier }: BandParams): Bands {
    return new Bands(multiplier, new SimpleAverage(period), new StandardDeviation(period));
  }

  next(price: number): void {
    this.basis = this.mean.next(price);
    this.spread = this.deviation.next(price) * this.multiplier;
  }

  clone(): Bands {
    const copy = new Bands(this.multiplier, this.mean.clone(), this.deviation.clone());
    copy.basis = this.basis;
    copy.spread = this.spread;
    return copy;
  }
}

/** The width of the bands in percent of their basis, and its highest and lowest of late. */
class BandWidthStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly bands: Bands,
    private readonly expansions: RingBuffer,
    private readonly contractions: RingBuffer
  ) {}

  next(_bar: Bar, price: number): ArrayLike<number> {
    this.bands.next(price);
    const width = ratio(2 * this.bands.spread, this.bands.basis) * 100;
    this.expansions.push(width);
    this.contractions.push(width);
    this.out[0] = width;
    this.out[1] = this.expansions.full ? this.expansions.max() : Number.NaN;
    this.out[2] = this.contractions.full ? this.contractions.min() : Number.NaN;
    return this.out;
  }

  clone(): IndicatorStream {
    return new BandWidthStream(
      this.bands.clone(),
      this.expansions.clone(),
      this.contractions.clone()
    );
  }
}

/**
 * Bollinger BandWidth: the distance between the Bollinger Bands, `period` bars and `multiplier`
 * population standard deviations wide, in percent of their basis, the simple average:
 * `(upper - lower) / basis * 100`. The highest expansion is its highest value of the last
 * `expansion` bars and the lowest contraction its lowest of the last `contraction` bars, both
 * once that many bars have one.
 */
export const BBW: IndicatorDefinition<BandParams & { expansion: number; contraction: number }> = {
  type: 'BBW',
  name: 'BBW',
  pane: 'new',
  precision: 2,
  params: {
    ...BAND_PARAMS,
    expansion: periodParam(125, 'Highest Expansion Length'),
    contraction: periodParam(125, 'Lowest Contraction Length')
  },
  outputs: () => [
    namedLine('bollingerBandWidth', 'Bollinger BandWidth'),
    namedLine('highestExpansion', 'Highest Expansion'),
    namedLine('lowestContraction', 'Lowest Contraction')
  ],
  create: (params) =>
    new BandWidthStream(
      Bands.of(params),
      new RingBuffer(params.expansion),
      new RingBuffer(params.contraction)
    )
};

/** Where the price lies within the bands, from 0 at the lower band to 1 at the upper one. */
class PercentBStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(private readonly bands: Bands) {}

  next(_bar: Bar, price: number): ArrayLike<number> {
    this.bands.next(price);
    const { basis, spread } = this.bands;
    this.out[0] = ratio(price - (basis - spread), 2 * spread);
    return this.out;
  }

  clone(): IndicatorStream {
    return new PercentBStream(this.bands.clone());
  }
}

/**
 * Bollinger Bands %B: where the price lies within the Bollinger Bands, `period` bars and
 * `multiplier` population standard deviations wide, `(price - lower) / (upper - lower)`: 0 at the
 * lower band, 1 at the upper one, beyond them outside the bands; undefined while they meet.
 */
export const BBP: IndicatorDefinition<BandParams> = {
  type: 'BBP',
  name: 'BB %B',
  pane: 'new',
  precision: 2,
  params: BAND_PARAMS,
  outputs: () => [namedLine('bollingerBandsB', 'Bollinger Bands %b')],
  levels: () => [1, 0.5, 0],
  create: (params) => new PercentBStream(Bands.of(params))
};

import type { Bar } from '../../data/types';
import {
  MovingAverage,
  MovingSum,
  Previous,
  RingBuffer,
  RollingExtremes,
  SeededAverage,
  SimpleAverage,
  WeightedAverage
} from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import {
  choiceParam,
  lineOutput,
  lineOutputs,
  movingAverage,
  namedLine,
  ParallelStream,
  periodParam,
  periodsParam,
  picked,
  ratio,
  SignalStream,
  smoothingFills,
  SmoothedStream,
  smoothingOutputs,
  smoothingParams,
  switchParam,
  type AverageKind,
  type BarStep,
  type SmoothingParams,
  type Step
} from './shared';

/** The averages of the lines of MACD, by option value. */
const MACD_AVERAGES: readonly AverageKind[] = ['ema', 'sma'];

class MacdStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly fast: BarStep,
    private readonly slow: BarStep,
    private readonly signal: BarStep
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const macd = this.fast.next(price, bar) - this.slow.next(price, bar);
    const signal = this.signal.next(macd, bar);
    this.out[0] = macd - signal;
    this.out[1] = macd;
    this.out[2] = signal;
    return this.out;
  }

  clone(): IndicatorStream {
    return new MacdStream(this.fast.clone(), this.slow.clone(), this.signal.clone());
  }
}

/**
 * MACD: the fast EMA of the price minus the slow one, its EMA as the signal line, and the
 * histogram of MACD minus the signal line. Either average can be an SMA instead. Each EMA is
 * seeded with the simple average of its first values, so MACD starts on bar `slow - 1` and the
 * signal line `signal - 1` bars later.
 */
export const MACD: IndicatorDefinition<{
  fast: number;
  slow: number;
  signal: number;
  oscillatorType: number;
  signalType: number;
}> = {
  type: 'MACD',
  name: 'MACD',
  pane: 'new',
  precision: 'price',
  params: {
    fast: { default: 12, min: 1, max: 500, integer: true, label: 'Fast length' },
    slow: { default: 26, min: 1, max: 500, integer: true, label: 'Slow length' },
    signal: { default: 9, min: 1, max: 500, integer: true, label: 'Signal length' },
    oscillatorType: choiceParam(['EMA', 'SMA'], 0, 'Oscillator MA type', false),
    signalType: choiceParam(['EMA', 'SMA'], 0, 'Signal MA type', false)
  },
  outputs: () => [
    { key: 'histogram', label: 'Histogram', plot: { kind: 'histogram', colorBy: 'sign' } },
    namedLine('macd', 'MACD'),
    namedLine('signalLine', 'Signal line')
  ],
  levels: () => [0],
  create: ({ fast, slow, signal, oscillatorType, signalType }) => {
    const oscillator = picked(MACD_AVERAGES, oscillatorType, 'oscillator average');
    return new MacdStream(
      movingAverage(oscillator, fast),
      movingAverage(oscillator, slow),
      movingAverage(picked(MACD_AVERAGES, signalType, 'signal average'), signal)
    );
  }
};

/**
 * Wilder's RSI: RMAs of the gains and the losses, each seeded with its mean over the first
 * `period` changes; 100 when nothing fell, 0 when nothing rose.
 */
export class WilderRsi implements BarStep {
  constructor(
    private readonly period: number,
    private readonly previous = new Previous(),
    private readonly gains = SeededAverage.rma(period),
    private readonly losses = SeededAverage.rma(period)
  ) {}

  next(value: number): number {
    const before = this.previous.next(value);

    if (Number.isNaN(before)) {
      return Number.NaN;
    }

    const up = this.gains.next(Math.max(value - before, 0));
    const down = this.losses.next(Math.max(before - value, 0));
    return down === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / down);
  }

  clone(): WilderRsi {
    return new WilderRsi(
      this.period,
      this.previous.clone(),
      this.gains.clone(),
      this.losses.clone()
    );
  }
}

/**
 * Relative strength index: Wilder's RSI of `period` changes of the price, and a moving average of
 * it, an SMA of 14 values by default, with Bollinger Bands around it if picked.
 */
export const RSI: IndicatorDefinition<{ period: number } & SmoothingParams> = {
  type: 'RSI',
  name: 'RSI',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(14, 'RSI Length'), ...smoothingParams(true) },
  outputs: (params) => [namedLine('rsi', 'RSI'), ...smoothingOutputs('rsi', 'RSI', params)],
  fills: smoothingFills,
  levels: () => [70, 50, 30],
  range: { min: 0, max: 100 },
  create: (params) => SmoothedStream.of(new WilderRsi(params.period), params)
};

/**
 * RSV, the close within the range of the last `period` bars, smoothed into K and D starting from
 * the first RSV; `J = 3K - 2D`.
 */
class KdjStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly range: RollingExtremes,
    private readonly k: WeightedAverage,
    private readonly d: WeightedAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.range.push(bar.high, bar.low);
    const lowest = this.range.lowest();
    const spread = this.range.highest() - lowest;

    if (Number.isNaN(spread)) {
      this.out.fill(Number.NaN);
      return this.out;
    }

    // A flat range leaves RSV undefined, so it counts as 50.
    const rsv = spread === 0 ? 50 : ((bar.close - lowest) / spread) * 100;
    const k = this.k.next(rsv);
    const d = this.d.next(k);
    this.out[0] = k;
    this.out[1] = d;
    this.out[2] = 3 * k - 2 * d;
    return this.out;
  }

  clone(): IndicatorStream {
    return new KdjStream(this.range.clone(), this.k.clone(), this.d.clone());
  }
}

/**
 * 随机指标 as in Chinese charting software: `RSV = (C - LLV(L, N)) / (HHV(H, N) - LLV(L, N)) *
 * 100`, `K = SMA(RSV, M1, 1)`, `D = SMA(K, M2, 1)` and `J = 3K - 2D`; SMA(X, N, 1) starts from
 * the first X, on the first bar with `period` bars.
 */
export const KDJ: IndicatorDefinition<{ period: number; k: number; d: number }> = {
  type: 'KDJ',
  name: 'KDJ',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(9), k: periodParam(3, 'K'), d: periodParam(3, 'D') },
  outputs: () => ['K', 'D', 'J'].map(lineOutput),
  levels: () => [20, 80],
  create: ({ period, k, d }) =>
    new KdjStream(new RollingExtremes(period), new WeightedAverage(k, 1), new WeightedAverage(d, 1))
};

class WilliamsStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(private readonly ranges: readonly RollingExtremes[]) {
    this.out = new Float64Array(ranges.length);
  }

  next(bar: Bar, price: number): ArrayLike<number> {
    this.ranges.forEach((range, index) => {
      range.push(bar.high, bar.low);
      const highest = range.highest();
      this.out[index] = ratio(price - highest, highest - range.lowest()) * 100;
    });
    return this.out;
  }

  clone(): IndicatorStream {
    return new WilliamsStream(this.ranges.map((range) => range.clone()));
  }
}

/**
 * Williams %R: the price below the highest high of `period` bars, in percent of their range,
 * from -100 at the lowest low to 0 at the highest high; undefined over a flat range.
 */
export const WR: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'WR',
  name: 'WR',
  pane: 'new',
  precision: 2,
  params: { periods: periodsParam([14], 'Length') },
  outputs: ({ periods }) =>
    periods.map((period) => namedLine(`wr${String(period)}`, `%R${String(period)}`)),
  levels: () => [-20, -50, -80],
  range: { min: -100, max: 0 },
  create: ({ periods }) => new WilliamsStream(periods.map((period) => new RollingExtremes(period)))
};

/**
 * `(X - MA(X, N)) / (0.015 * mean deviation of X)` of the price over `period` bars; summed as
 * offsets from the latest value, so a flat window has exactly zero deviation (0 / 0 = `NaN`).
 */
class CciStep implements BarStep {
  constructor(private readonly window: RingBuffer) {}

  next(value: number): number {
    this.window.push(value);
    return this.window.full ? this.cci(value) : Number.NaN;
  }

  clone(): BarStep {
    return new CciStep(this.window.clone());
  }

  private cci(value: number): number {
    const count = this.window.length;
    let excess = 0;

    for (let index = 0; index < count; index += 1) {
      excess += value - this.window.at(index);
    }

    excess /= count;
    let deviation = 0;

    for (let index = 0; index < count; index += 1) {
      deviation += Math.abs(value - this.window.at(index) - excess);
    }

    return ratio(excess, (0.015 * deviation) / count);
  }
}

/**
 * Commodity channel index of the typical price `(H + L + C) / 3` by default, and a moving average
 * of it, an SMA of 14 values by default, with Bollinger Bands around it if picked.
 */
export const CCI: IndicatorDefinition<{ period: number } & SmoothingParams> = {
  type: 'CCI',
  name: 'CCI',
  pane: 'new',
  source: 'hlc3',
  precision: 2,
  params: { period: periodParam(20, 'Length'), ...smoothingParams(true) },
  outputs: (params) => [namedLine('cci', 'CCI'), ...smoothingOutputs('cci', 'CCI', params)],
  fills: smoothingFills,
  levels: () => [100, 0, -100],
  create: (params) => SmoothedStream.of(new CciStep(new RingBuffer(params.period)), params)
};

/** Percent change from the value `period` bars back. */
export class RocStep implements Step {
  constructor(
    period: number,
    private readonly history = new RingBuffer(period)
  ) {}

  next(value: number): number {
    const base = this.history.push(value);
    return ratio(value - base, base) * 100;
  }

  clone(): Step {
    return new RocStep(this.history.capacity, this.history.clone());
  }
}

/** Rate of change: `100 * (X - X[N]) / X[N]` of the price over `period` bars. */
export const ROC: IndicatorDefinition<{ period: number }> = {
  type: 'ROC',
  name: 'ROC',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(9, 'Length') },
  outputs: () => [lineOutput('ROC')],
  levels: () => [0],
  create: ({ period }) => new ParallelStream([new RocStep(period)], (_bar, price) => price)
};

/** Percent distance from the moving average. */
class BiasStep implements Step {
  constructor(
    private readonly period: number,
    private readonly average = new MovingAverage(period)
  ) {}

  next(value: number): number {
    const average = this.average.next(value);
    return ratio(value - average, average) * 100;
  }

  clone(): Step {
    return new BiasStep(this.period, this.average.clone());
  }
}

export const BIAS: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'BIAS',
  name: 'BIAS',
  pane: 'new',
  precision: 2,
  params: { periods: periodsParam([6, 12, 24]) },
  outputs: ({ periods }) => lineOutputs('BIAS', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => new BiasStep(period)),
      (_bar, price) => price
    )
};

/** The close within the range of `period` bars, in percent, smoothed into `%K` and `%D`. */
class StochasticStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly range: RollingExtremes,
    private readonly k: SimpleAverage,
    private readonly d: SimpleAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.range.push(bar.high, bar.low);
    const lowest = this.range.lowest();
    const k = this.k.next(ratio(bar.close - lowest, this.range.highest() - lowest) * 100);
    this.out[0] = k;
    this.out[1] = this.d.next(k);
    return this.out;
  }

  clone(): IndicatorStream {
    return new StochasticStream(this.range.clone(), this.k.clone(), this.d.clone());
  }
}

/**
 * Stochastic, 14, 1, 3 by default: the close within the range of `period` bars, in percent
 * (undefined over a flat range, which the averages skip), averaged over `smoothK` bars into `%K`
 * and over `smoothD` into `%D`. KDJ is the variant of Chinese charting software.
 */
export const STOCH: IndicatorDefinition<{ period: number; smoothK: number; smoothD: number }> = {
  type: 'STOCH',
  name: 'Stoch',
  pane: 'new',
  precision: 2,
  params: {
    period: periodParam(14, '%K Length'),
    smoothK: periodParam(1, '%K Smoothing'),
    smoothD: periodParam(3, '%D Smoothing')
  },
  outputs: () => [namedLine('k', '%K'), namedLine('d', '%D')],
  levels: () => [80, 50, 20],
  range: { min: 0, max: 100 },
  create: ({ period, smoothK, smoothD }) =>
    new StochasticStream(
      new RollingExtremes(period),
      new SimpleAverage(smoothK),
      new SimpleAverage(smoothD)
    )
};

/** The stochastic of RSI, smoothed into `K` and `D`. */
class StochRsiStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly rsi: WilderRsi,
    private readonly range: RollingExtremes,
    private readonly k: SimpleAverage,
    private readonly d: SimpleAverage
  ) {}

  next(_bar: Bar, price: number): ArrayLike<number> {
    const rsi = this.rsi.next(price);
    this.range.push(rsi, rsi);
    const lowest = this.range.lowest();
    const k = this.k.next(ratio(rsi - lowest, this.range.highest() - lowest) * 100);
    this.out[0] = k;
    this.out[1] = this.d.next(k);
    return this.out;
  }

  clone(): IndicatorStream {
    return new StochRsiStream(this.rsi.clone(), this.range.clone(), this.k.clone(), this.d.clone());
  }
}

/**
 * Stochastic RSI: Wilder's RSI of `rsiPeriod` changes, its stochastic over `period` values,
 * averaged over `smoothK` into `K` and over `smoothD` into `D`.
 */
export const STOCHRSI: IndicatorDefinition<{
  smoothK: number;
  smoothD: number;
  rsiPeriod: number;
  period: number;
}> = {
  type: 'STOCHRSI',
  name: 'Stoch RSI',
  pane: 'new',
  precision: 2,
  params: {
    smoothK: periodParam(3, 'K'),
    smoothD: periodParam(3, 'D'),
    rsiPeriod: periodParam(14, 'RSI Length'),
    period: periodParam(14, 'Stochastic Length')
  },
  outputs: () => [namedLine('k', 'K'), namedLine('d', 'D')],
  levels: () => [80, 50, 20],
  range: { min: 0, max: 100 },
  create: ({ rsiPeriod, period, smoothK, smoothD }) =>
    new StochRsiStream(
      new WilderRsi(rsiPeriod),
      new RollingExtremes(period),
      new SimpleAverage(smoothK),
      new SimpleAverage(smoothD)
    )
};

/** The previous bar's raw values; a missing one counts as 0. */
interface FisherState {
  value: number;
  fisher: number;
}

/**
 * Ehlers' Fisher transform: the price within the range of `period` bars, smoothed and clamped to
 * ±0.999, through `0.5 * ln((1 + x) / (1 - x))`, smoothed again; the trigger is the previous
 * value. A flat range has no value and restarts the smoothing.
 */
class FisherStream implements IndicatorStream {
  private readonly out = new Float64Array(2);
  private state: FisherState = { value: Number.NaN, fisher: Number.NaN };

  constructor(private readonly range: RollingExtremes) {}

  next(_bar: Bar, price: number): ArrayLike<number> {
    const previous = this.state;
    this.range.push(price, price);
    const lowest = this.range.lowest();
    const raw =
      0.66 * (ratio(price - lowest, this.range.highest() - lowest) - 0.5) +
      0.67 * (Number.isNaN(previous.value) ? 0 : previous.value);
    const value = raw > 0.99 ? 0.999 : raw < -0.99 ? -0.999 : raw;
    const fisher =
      0.5 * Math.log((1 + value) / (1 - value)) +
      0.5 * (Number.isNaN(previous.fisher) ? 0 : previous.fisher);
    this.out[0] = fisher;
    this.out[1] = previous.fisher;
    this.state = { value, fisher };
    return this.out;
  }

  clone(): IndicatorStream {
    const copy = new FisherStream(this.range.clone());
    // Each bar replaces the state rather than changing it, so copies can share it.
    copy.state = this.state;
    return copy;
  }
}

export const FISHER: IndicatorDefinition<{ period: number }> = {
  type: 'FISHER',
  name: 'Fisher',
  pane: 'new',
  source: 'hl2',
  precision: 2,
  params: { period: periodParam(9, 'Length') },
  outputs: () => [lineOutput('Fisher'), lineOutput('Trigger')],
  levels: () => [1.5, 0.75, 0, -0.75, -1.5],
  create: ({ period }) => new FisherStream(new RollingExtremes(period))
};

/** Change from the price `period` bars back. */
class MomentumStep implements Step {
  constructor(private readonly history: RingBuffer) {}

  next(value: number): number {
    return value - this.history.push(value);
  }

  clone(): Step {
    return new MomentumStep(this.history.clone());
  }
}

/** Momentum: the price minus the price `period` bars back. */
export const MTM: IndicatorDefinition<{ period: number }> = {
  type: 'MTM',
  name: 'MTM',
  pane: 'new',
  precision: 'price',
  params: { period: periodParam(10, 'Length') },
  outputs: () => [namedLine('mom', 'MOM')],
  create: ({ period }) =>
    new ParallelStream([new MomentumStep(new RingBuffer(period))], (_bar, price) => price)
};

/**
 * The price minus its simple average of `shift` bars back, or, centered, the price of `shift`
 * bars back minus the average.
 */
class DetrendStep implements Step {
  constructor(
    private readonly centered: boolean,
    private readonly mean: SimpleAverage,
    private readonly prices: RingBuffer,
    private readonly means: RingBuffer
  ) {}

  next(value: number): number {
    const mean = this.mean.next(value);
    const price = this.prices.push(value);
    const before = this.means.push(mean);
    return this.centered ? price - mean : value - before;
  }

  clone(): Step {
    return new DetrendStep(
      this.centered,
      this.mean.clone(),
      this.prices.clone(),
      this.means.clone()
    );
  }
}

/** Bars the detrended price oscillator looks back: half its length, rounded down, plus one. */
function detrendShift(period: number): number {
  return Math.floor(period / 2) + 1;
}

/**
 * Detrended price oscillator: the price minus its simple average of `period / 2 + 1` bars back
 * (the shift rounded down). Centered, it is the price of that many bars back minus the average,
 * drawn back on the bar of that price.
 */
export const DPO: IndicatorDefinition<{ period: number; centered: number }> = {
  type: 'DPO',
  name: 'DPO',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(21, 'Length'), centered: switchParam(false, 'Centered') },
  outputs: ({ period, centered }) => [
    { ...namedLine('dpo', 'DPO'), ...(centered === 1 ? { offset: -detrendShift(period) } : {}) }
  ],
  levels: () => [0],
  create: ({ period, centered }) =>
    new ParallelStream(
      [
        new DetrendStep(
          centered === 1,
          new SimpleAverage(period),
          new RingBuffer(detrendShift(period)),
          new RingBuffer(detrendShift(period))
        )
      ],
      (_bar, price) => price
    )
};

/** Percent of the last `period` bars that closed above the previous close. */
class RiseShareStep implements Step {
  constructor(
    private readonly period: number,
    private readonly previous = new Previous(),
    private readonly rises = new MovingSum(period)
  ) {}

  next(value: number): number {
    const before = this.previous.next(value);
    const rise = Number.isNaN(before) ? Number.NaN : value > before ? 1 : 0;
    return (this.rises.next(rise) / this.period) * 100;
  }

  clone(): Step {
    return new RiseShareStep(this.period, this.previous.clone(), this.rises.clone());
  }
}

/** 心理线 (psychological line): `PSY = COUNT(C > C', N) / N * 100` and `PSYMA = MA(PSY, M)`. */
export const PSY: IndicatorDefinition<{ period: number; signal: number }> = {
  type: 'PSY',
  name: 'PSY',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(12), signal: periodParam(6, 'Signal') },
  outputs: () => [lineOutput('PSY'), lineOutput('PSYMA')],
  range: { min: 0, max: 100 },
  create: ({ period, signal }) =>
    new SignalStream(new RiseShareStep(period), new MovingAverage(signal))
};

/**
 * 人气意愿指标: `BR = SUM(MAX(0, H - C'), N) / SUM(MAX(0, C' - L), N) * 100` against the previous
 * close and `AR = SUM(H - O, N) / SUM(O - L, N) * 100` against the open.
 */
class BrarStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly period: number,
    private readonly closes = new Previous(),
    private readonly bullish = new MovingSum(period),
    private readonly bearish = new MovingSum(period),
    private readonly above = new MovingSum(period),
    private readonly below = new MovingSum(period)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const close = this.closes.next(bar.close);
    const bullish = this.bullish.next(Math.max(0, bar.high - close));
    const bearish = this.bearish.next(Math.max(0, close - bar.low));
    this.out[0] = ratio(bullish, bearish) * 100;
    this.out[1] =
      ratio(this.above.next(bar.high - bar.open), this.below.next(bar.open - bar.low)) * 100;
    return this.out;
  }

  clone(): IndicatorStream {
    return new BrarStream(
      this.period,
      this.closes.clone(),
      this.bullish.clone(),
      this.bearish.clone(),
      this.above.clone(),
      this.below.clone()
    );
  }
}

export const BRAR: IndicatorDefinition<{ period: number }> = {
  type: 'BRAR',
  name: 'BRAR',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(26) },
  outputs: () => [lineOutput('BR'), lineOutput('AR')],
  create: ({ period }) => new BrarStream(period)
};

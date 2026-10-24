import type { Bar } from '../../data/types';
import { MovingAverage, Previous, RingBuffer, RollingExtremes, SeededAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream } from '../types';
import {
  lineOutput,
  namedLine,
  ParallelStream,
  periodParam,
  ratio,
  SignalStream,
  type Step
} from './shared';
import { AverageTrueRange, trueRange } from './volatility';

/** Middle of the highest high and the lowest low of the window. */
function midpoint(window: RollingExtremes): number {
  return (window.highest() + window.lowest()) / 2;
}

class IchimokuStream implements IndicatorStream {
  private readonly out = new Float64Array(7);

  constructor(
    private readonly conversion: RollingExtremes,
    private readonly base: RollingExtremes,
    private readonly spanB: RollingExtremes
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.conversion.push(bar.high, bar.low);
    this.base.push(bar.high, bar.low);
    this.spanB.push(bar.high, bar.low);
    const conversion = midpoint(this.conversion);
    const base = midpoint(this.base);
    const spanA = (conversion + base) / 2;
    const spanB = midpoint(this.spanB);
    this.out[0] = conversion;
    this.out[1] = base;
    this.out[2] = bar.close;
    this.out[3] = spanA;
    this.out[4] = spanB;
    this.out[5] = Math.max(spanA, spanB);
    this.out[6] = Math.min(spanA, spanB);
    return this.out;
  }

  clone(): IndicatorStream {
    return new IchimokuStream(this.conversion.clone(), this.base.clone(), this.spanB.clone());
  }
}

/**
 * Ichimoku Kinko Hyo: the conversion and base lines are the middles of the high-low ranges of
 * their periods, leading span A is their average and leading span B the middle of its own
 * period. The spans lead by `displacement - 1` bars, so the cloud between them reaches past the
 * latest bar, and the close lags as many. The cloud takes the theme's up color where span A is
 * higher and its down color where span B is; its upper and lower edges are hidden outputs, for
 * alerts.
 */
export const ICHIMOKU: IndicatorDefinition<{
  conversion: number;
  base: number;
  spanB: number;
  displacement: number;
}> = {
  type: 'ICHIMOKU',
  name: 'Ichimoku',
  pane: 'main',
  precision: 'price',
  params: {
    conversion: periodParam(9, 'Conversion Line Length'),
    base: periodParam(26, 'Base Line Length'),
    spanB: periodParam(52, 'Leading Span B Length'),
    displacement: periodParam(26, 'Displacement')
  },
  outputs: ({ displacement }) => {
    const lead = displacement - 1;
    const edge = (key: string, label: string): IndicatorOutput => ({
      key,
      label,
      plot: { kind: 'hidden' },
      offset: lead,
      legend: false
    });
    return [
      namedLine('conversionLine', 'Conversion Line'),
      namedLine('baseLine', 'Base Line'),
      { ...namedLine('laggingSpan', 'Lagging Span'), offset: -lead },
      { ...namedLine('leadingSpanA', 'Leading Span A'), themeColor: 'up', offset: lead },
      { ...namedLine('leadingSpanB', 'Leading Span B'), themeColor: 'down', offset: lead },
      edge('kumoCloudUpperLine', 'Kumo Cloud Upper Line'),
      edge('kumoCloudLowerLine', 'Kumo Cloud Lower Line')
    ];
  },
  fills: () => [{ from: 'leadingSpanA', to: 'leadingSpanB', colorBy: 'higher' }],
  create: ({ conversion, base, spanB }) =>
    new IchimokuStream(
      new RollingExtremes(conversion),
      new RollingExtremes(base),
      new RollingExtremes(spanB)
    )
};

/** Bars seen, the trend and the previous bar's close, highs and lows (`2`: two bars back). */
interface SarState {
  index: number;
  sar: number;
  extreme: number;
  acceleration: number;
  rising: boolean;
  close: number;
  high: number;
  low: number;
  high2: number;
  low2: number;
}

/**
 * Wilder's parabolic stop and reverse. The first trend follows the second close and starts at the
 * first bar's low or high; the stop moves toward the extreme of the trend by an acceleration that
 * grows by `increment` with each new extreme, up to `maximum`, stays outside the previous two
 * bars, and reverses to the extreme when the price crosses it.
 */
class SarStream implements IndicatorStream {
  private readonly out = new Float64Array(1);
  private state: SarState = {
    index: 0,
    sar: Number.NaN,
    extreme: Number.NaN,
    acceleration: Number.NaN,
    rising: false,
    close: Number.NaN,
    high: Number.NaN,
    low: Number.NaN,
    high2: Number.NaN,
    low2: Number.NaN
  };

  constructor(
    private readonly start: number,
    private readonly increment: number,
    private readonly maximum: number
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const s = this.state;
    // The first trend follows the second close, and starts at the first bar's low or high.
    let reversed = s.index === 1;

    if (reversed) {
      s.rising = bar.close > s.close;
      s.extreme = s.rising ? bar.high : bar.low;
      s.sar = s.rising ? s.low : s.high;
      s.acceleration = this.start;
    }

    s.sar += s.acceleration * (s.extreme - s.sar);

    if (s.rising ? s.sar > bar.low : s.sar < bar.high) {
      reversed = true;
      s.sar = s.rising ? Math.max(bar.high, s.extreme) : Math.min(bar.low, s.extreme);
      s.rising = !s.rising;
      s.extreme = s.rising ? bar.high : bar.low;
      s.acceleration = this.start;
    }

    if (!reversed && (s.rising ? bar.high > s.extreme : bar.low < s.extreme)) {
      s.extreme = s.rising ? bar.high : bar.low;
      s.acceleration = Math.min(s.acceleration + this.increment, this.maximum);
    }

    // The stop stays outside the previous two bars.
    if (s.rising) {
      s.sar = Math.min(s.sar, s.low, s.index > 1 ? s.low2 : s.low);
    } else {
      s.sar = Math.max(s.sar, s.high, s.index > 1 ? s.high2 : s.high);
    }

    this.out[0] = s.sar;
    s.index += 1;
    s.close = bar.close;
    s.high2 = s.high;
    s.low2 = s.low;
    s.high = bar.high;
    s.low = bar.low;
    return this.out;
  }

  clone(): IndicatorStream {
    const copy = new SarStream(this.start, this.increment, this.maximum);
    copy.state = { ...this.state };
    return copy;
  }
}

/** Parabolic SAR, a dot under the bars in an uptrend and over them in a downtrend. */
export const SAR: IndicatorDefinition<{ start: number; increment: number; maximum: number }> = {
  type: 'SAR',
  name: 'SAR',
  pane: 'main',
  precision: 'price',
  params: {
    start: { default: 0.02, min: 0.001, max: 1, label: 'Start' },
    increment: { default: 0.02, min: 0.001, max: 1, label: 'Increment' },
    maximum: { default: 0.2, min: 0.001, max: 1, label: 'Max value' }
  },
  outputs: () => [
    {
      key: 'parabolicSar',
      label: 'ParabolicSAR',
      plot: { kind: 'marker', shape: 'circle', size: 2 }
    }
  ],
  create: ({ start, increment, maximum }) => new SarStream(start, increment, maximum)
};

/** The previous bar's close, ATR, bands and SuperTrend value. */
interface SuperTrendState {
  close: number;
  atr: number;
  upper: number;
  lower: number;
  trend: number;
}

/**
 * The median price `(H + L) / 2` ± `multiplier` × ATR, each band only tightening while the close
 * stays inside it; the trend turns when the close crosses the band of the trend.
 */
class SuperTrendStream implements IndicatorStream {
  private readonly out = new Float64Array(3);
  private state: SuperTrendState = {
    close: Number.NaN,
    atr: Number.NaN,
    upper: Number.NaN,
    lower: Number.NaN,
    trend: Number.NaN
  };

  constructor(
    private readonly multiplier: number,
    private readonly range: AverageTrueRange
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const previous = this.state;
    const atr = this.range.next(bar);
    const mid = (bar.high + bar.low) / 2;
    // The previous bands count as 0 while the ATR warms up.
    const upperBefore = Number.isNaN(previous.upper) ? 0 : previous.upper;
    const lowerBefore = Number.isNaN(previous.lower) ? 0 : previous.lower;
    let upper = mid + this.multiplier * atr;
    let lower = mid - this.multiplier * atr;

    if (!(lower > lowerBefore || previous.close < lowerBefore)) {
      lower = lowerBefore;
    }

    if (!(upper < upperBefore || previous.close > upperBefore)) {
      upper = upperBefore;
    }

    // Down until the ATR has a previous value; then the close crossing the band of the trend
    // turns it.
    const down =
      Number.isNaN(previous.atr) ||
      (previous.trend === upperBefore ? bar.close <= upper : bar.close < lower);
    const trend = down ? upper : lower;
    // The first bar has no value: its bands are only the zeros taken for the bands before.
    const first = Number.isNaN(previous.close);
    this.out[0] = first || down ? Number.NaN : trend;
    this.out[1] = first || !down ? Number.NaN : trend;
    this.out[2] = first ? Number.NaN : (bar.open + bar.close) / 2;
    this.state = { close: bar.close, atr, upper, lower, trend };
    return this.out;
  }

  clone(): IndicatorStream {
    const copy = new SuperTrendStream(this.multiplier, this.range.clone());
    // Each bar replaces the state rather than changing it, so copies can share it.
    copy.state = this.state;
    return copy;
  }
}

/**
 * SuperTrend: a line under the bars in the theme's up color while the trend is up, over them in
 * the down color while it is down, with a gap where it turns, each shaded to the middle of the
 * bodies of the bars.
 */
export const SUPERTREND: IndicatorDefinition<{ period: number; multiplier: number }> = {
  type: 'SUPERTREND',
  name: 'SuperTrend',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(10, 'ATR Length'),
    multiplier: { default: 3, min: 0.01, max: 10, label: 'Factor' }
  },
  outputs: () => [
    { ...namedLine('upTrend', 'Up Trend'), themeColor: 'up' },
    { ...namedLine('downTrend', 'Down Trend'), themeColor: 'down' },
    { key: 'bodyMiddle', label: 'Body Middle', plot: { kind: 'hidden' }, legend: false }
  ],
  fills: () => [
    { from: 'upTrend', to: 'bodyMiddle' },
    { from: 'downTrend', to: 'bodyMiddle' }
  ],
  create: ({ period, multiplier }) => new SuperTrendStream(multiplier, AverageTrueRange.of(period))
};

/** `value`, or the value before it when it is `NaN`. */
function fixed(value: number, previous: number): number {
  return Number.isNaN(value) ? previous : value;
}

/**
 * Wilder's directional movement: +DI and -DI are the RMAs of +DM and -DM over the RMA of the
 * true range, in percent, a missing one (no range) keeping the one before; ADX is the RMA of
 * `|+DI - -DI| / (+DI + -DI)` (over 1 when both are 0), in percent. Each RMA is seeded with the
 * mean of its first values, which start on the second bar.
 */
class DmiStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly highs: Previous,
    private readonly lows: Previous,
    private readonly closes: Previous,
    private readonly range: SeededAverage,
    private readonly plusMoves: SeededAverage,
    private readonly minusMoves: SeededAverage,
    private readonly adx: SeededAverage,
    private plus = Number.NaN,
    private minus = Number.NaN
  ) {}

  static of(diLength: number, adxSmoothing: number): DmiStream {
    return new DmiStream(
      new Previous(),
      new Previous(),
      new Previous(),
      SeededAverage.rma(diLength),
      SeededAverage.rma(diLength),
      SeededAverage.rma(diLength),
      SeededAverage.rma(adxSmoothing)
    );
  }

  next(bar: Bar): ArrayLike<number> {
    const up = bar.high - this.highs.next(bar.high);
    const down = this.lows.next(bar.low) - bar.low;
    const range = this.range.next(trueRange(bar, this.closes.next(bar.close)));
    // NaN on the first bar, which the averages skip.
    const plusMove = Number.isNaN(up) ? Number.NaN : up > down && up > 0 ? up : 0;
    const minusMove = Number.isNaN(down) ? Number.NaN : down > up && down > 0 ? down : 0;
    this.plus = fixed(ratio(100 * this.plusMoves.next(plusMove), range), this.plus);
    this.minus = fixed(ratio(100 * this.minusMoves.next(minusMove), range), this.minus);
    const sum = this.plus + this.minus;
    this.out[0] = 100 * this.adx.next(Math.abs(this.plus - this.minus) / (sum === 0 ? 1 : sum));
    this.out[1] = this.plus;
    this.out[2] = this.minus;
    return this.out;
  }

  clone(): IndicatorStream {
    return new DmiStream(
      this.highs.clone(),
      this.lows.clone(),
      this.closes.clone(),
      this.range.clone(),
      this.plusMoves.clone(),
      this.minusMoves.clone(),
      this.adx.clone(),
      this.plus,
      this.minus
    );
  }
}

/** Directional movement index: ADX, +DI and -DI. */
export const DMI: IndicatorDefinition<{ adxSmoothing: number; diLength: number }> = {
  type: 'DMI',
  name: 'DMI',
  pane: 'new',
  precision: 4,
  params: {
    adxSmoothing: periodParam(14, 'ADX Smoothing'),
    diLength: periodParam(14, 'DI Length')
  },
  outputs: () => [namedLine('adx', 'ADX'), namedLine('plus', '+DI'), namedLine('minus', '-DI')],
  create: ({ adxSmoothing, diLength }) => DmiStream.of(diLength, adxSmoothing)
};

/** `MA(N1) - MA(N2)`. */
class DifferenceStep implements Step {
  constructor(
    private readonly fast: MovingAverage,
    private readonly slow: MovingAverage
  ) {}

  next(value: number): number {
    return this.fast.next(value) - this.slow.next(value);
  }

  clone(): Step {
    return new DifferenceStep(this.fast.clone(), this.slow.clone());
  }
}

/**
 * 平行线差 (difference of moving averages), as in Chinese charting software: `DIF = MA(C, N1) -
 * MA(C, N2)` and its average `DIFMA = MA(DIF, M)`.
 */
export const DMA: IndicatorDefinition<{ fast: number; slow: number; signal: number }> = {
  type: 'DMA',
  name: 'DMA',
  pane: 'new',
  precision: 'price',
  params: {
    fast: periodParam(10, 'Fast'),
    slow: periodParam(50, 'Slow'),
    signal: periodParam(10, 'Signal')
  },
  outputs: () => [lineOutput('DIF'), lineOutput('DIFMA')],
  create: ({ fast, slow, signal }) =>
    new SignalStream(
      new DifferenceStep(new MovingAverage(fast), new MovingAverage(slow)),
      new MovingAverage(signal)
    )
};

/** The change of a triple EMA of the logarithm of the price, times 10000. */
class TripleChangeStep implements Step {
  constructor(
    private readonly averages: readonly SeededAverage[],
    private readonly previous = new Previous()
  ) {}

  next(value: number): number {
    const triple = this.averages.reduce((result, average) => average.next(result), Math.log(value));
    return 10000 * (triple - this.previous.next(triple));
  }

  clone(): Step {
    return new TripleChangeStep(
      this.averages.map((average) => average.clone()),
      this.previous.clone()
    );
  }
}

/**
 * Triple exponential average: `10000 * Δ EMA(EMA(EMA(ln(price), N), N), N)`, each EMA seeded
 * with the simple average of its first values.
 */
export const TRIX: IndicatorDefinition<{ period: number }> = {
  type: 'TRIX',
  name: 'TRIX',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(18, 'Length') },
  outputs: () => [lineOutput('TRIX')],
  levels: () => [0],
  create: ({ period }) =>
    new ParallelStream(
      [
        new TripleChangeStep([
          SeededAverage.ema(period),
          SeededAverage.ema(period),
          SeededAverage.ema(period)
        ])
      ],
      (_bar, price) => price
    )
};

/** Bars since the latest highest value of the window, the newest bar being 0. */
function barsSinceHighest(window: RingBuffer, sign: 1 | -1): number {
  let best = 0;

  for (let index = 1; index < window.length; index += 1) {
    if (sign * window.at(index) >= sign * window.at(best)) {
      best = index;
    }
  }

  return window.length - 1 - best;
}

/**
 * Aroon: `100 * (period - bars since the highest high) / period` over the last `period + 1` bars,
 * and the same of the lowest low. Equal extremes count from the latest one.
 */
class AroonStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly period: number,
    private readonly highs = new RingBuffer(period + 1),
    private readonly lows = new RingBuffer(period + 1)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.highs.push(bar.high);
    this.lows.push(bar.low);

    if (!this.highs.full) {
      this.out.fill(Number.NaN);
      return this.out;
    }

    this.out[0] = (100 * (this.period - barsSinceHighest(this.highs, 1))) / this.period;
    this.out[1] = (100 * (this.period - barsSinceHighest(this.lows, -1))) / this.period;
    return this.out;
  }

  clone(): IndicatorStream {
    return new AroonStream(this.period, this.highs.clone(), this.lows.clone());
  }
}

export const AROON: IndicatorDefinition<{ period: number }> = {
  type: 'AROON',
  name: 'Aroon',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(14, 'Length') },
  outputs: () => [
    { ...namedLine('aroonUp', 'Aroon Up'), themeColor: 'up' },
    { ...namedLine('aroonDown', 'Aroon Down'), themeColor: 'down' }
  ],
  range: { min: 0, max: 100 },
  create: ({ period }) => new AroonStream(period)
};

/** The highest high and the lowest low of `period` bars, `multiplier` ATRs inward. */
class ChandelierStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly multiplier: number,
    private readonly extremes: RollingExtremes,
    private readonly range: AverageTrueRange
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const spread = this.multiplier * this.range.next(bar);
    this.extremes.push(bar.high, bar.low);
    this.out[0] = this.extremes.highest() - spread;
    this.out[1] = this.extremes.lowest() + spread;
    return this.out;
  }

  clone(): IndicatorStream {
    return new ChandelierStream(this.multiplier, this.extremes.clone(), this.range.clone());
  }
}

/**
 * Chuck LeBeau's chandelier exit: the long exit hangs `multiplier` ATRs of `atrPeriod` bars under
 * the highest high of `period` bars, and the short exit as far above the lowest low.
 */
export const CHANDELIER: IndicatorDefinition<{
  period: number;
  atrPeriod: number;
  multiplier: number;
}> = {
  type: 'CHANDELIER',
  name: 'Chandelier',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(22, 'Length'),
    atrPeriod: periodParam(22, 'ATR length'),
    multiplier: { default: 3, min: 0, max: 100, label: 'ATR multiplier' }
  },
  outputs: () => [
    { ...namedLine('longExit', 'Long exit'), themeColor: 'up' },
    { ...namedLine('shortExit', 'Short exit'), themeColor: 'down' }
  ],
  create: ({ period, atrPeriod, multiplier }) =>
    new ChandelierStream(multiplier, new RollingExtremes(period), AverageTrueRange.of(atrPeriod))
};

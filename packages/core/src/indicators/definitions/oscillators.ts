import type { Bar } from '../../data/types';
import {
  LinearlyWeightedAverage,
  MovingSum,
  Previous,
  RingBuffer,
  RollingExtremes,
  SeededAverage,
  SimpleAverage
} from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { RocStep, WilderRsi } from './momentum';
import {
  IDENTITY,
  movingAverage,
  namedLine,
  ParallelStream,
  periodParam,
  ratio,
  SignalStream,
  switchParam,
  type BarStep,
  type Step
} from './shared';

/** The fast simple average of the price minus the slow one. */
class AwesomeStep implements Step {
  constructor(
    private readonly fast: SimpleAverage,
    private readonly slow: SimpleAverage
  ) {}

  next(value: number): number {
    return this.fast.next(value) - this.slow.next(value);
  }

  clone(): Step {
    return new AwesomeStep(this.fast.clone(), this.slow.clone());
  }
}

/**
 * Awesome oscillator: the simple average of 5 median prices `(H + L) / 2` minus that of 34, from
 * bar `slow - 1`, in columns in the theme's up color where it rose from the bar before (and on
 * the first) and in its down color where it fell or stayed.
 */
export const AO: IndicatorDefinition<{ fast: number; slow: number }> = {
  type: 'AO',
  name: 'AO',
  pane: 'new',
  source: 'hl2',
  precision: 'price',
  params: { fast: periodParam(5, 'Fast length'), slow: periodParam(34, 'Slow length') },
  outputs: () => [{ key: 'ao', label: 'AO', plot: { kind: 'histogram', colorBy: 'change' } }],
  create: ({ fast, slow }) =>
    new ParallelStream(
      [new AwesomeStep(new SimpleAverage(fast), new SimpleAverage(slow))],
      (_bar, price) => price
    )
};

/** `(short - long) / long * 100` of two averages of the price; undefined while `long` is 0. */
class PercentSpreadStep implements BarStep {
  constructor(
    private readonly short: BarStep,
    private readonly long: BarStep
  ) {}

  next(value: number, bar: Bar): number {
    const long = this.long.next(value, bar);
    return ratio(this.short.next(value, bar) - long, long) * 100;
  }

  clone(): BarStep {
    return new PercentSpreadStep(this.short.clone(), this.long.clone());
  }
}

/**
 * Percentage price oscillator: the short simple average of the price minus the long one, in
 * percent of the long one, from bar `long - 1`. Exponential, each average is an EMA seeded with
 * the simple average of its first values, so it starts on the same bar.
 */
export const PPO: IndicatorDefinition<{ short: number; long: number; exponential: number }> = {
  type: 'PPO',
  name: 'PPO',
  pane: 'new',
  precision: 2,
  params: {
    short: periodParam(10, 'Short Length'),
    long: periodParam(21, 'Long Length'),
    exponential: switchParam(false, 'Use Exponential MA', false)
  },
  outputs: () => [namedLine('ppo', 'PPO')],
  levels: () => [0],
  create: ({ short, long, exponential }) => {
    const kind = exponential === 1 ? 'ema' : 'sma';
    return new ParallelStream(
      [new PercentSpreadStep(movingAverage(kind, short), movingAverage(kind, long))],
      (_bar, price) => price
    );
  }
};

/** `100 * (gains - losses) / (gains + losses)` of the changes of the price over `period` bars. */
class ChandeStep implements Step {
  constructor(
    private readonly period: number,
    private readonly previous = new Previous(),
    private readonly gains = new MovingSum(period),
    private readonly losses = new MovingSum(period)
  ) {}

  next(value: number): number {
    // NaN on the first bar, which has no change: the sums wait for `period` changes.
    const change = value - this.previous.next(value);
    const gains = this.gains.next(Math.max(change, 0));
    const losses = this.losses.next(Math.max(-change, 0));
    return ratio(100 * (gains - losses), gains + losses);
  }

  clone(): Step {
    return new ChandeStep(
      this.period,
      this.previous.clone(),
      this.gains.clone(),
      this.losses.clone()
    );
  }
}

/**
 * Chande momentum oscillator: the sum of the rises of the price over `period` bars minus the sum
 * of its falls, in percent of their total, from bar `period`; undefined while the price stays.
 */
export const CMO: IndicatorDefinition<{ period: number }> = {
  type: 'CMO',
  name: 'CMO',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(9, 'Length') },
  outputs: () => [namedLine('chandeMo', 'Chande MO')],
  levels: () => [0],
  create: ({ period }) => new ParallelStream([new ChandeStep(period)], (_bar, price) => price)
};

/** The buying pressure and the true range of `period` bars, summed. */
class PressureSums {
  constructor(
    private readonly pressure: MovingSum,
    private readonly range: MovingSum
  ) {}

  static of(period: number): PressureSums {
    return new PressureSums(new MovingSum(period), new MovingSum(period));
  }

  /** The pressure in the range over the window, after the bar's. */
  next(pressure: number, range: number): number {
    return ratio(this.pressure.next(pressure), this.range.next(range));
  }

  clone(): PressureSums {
    return new PressureSums(this.pressure.clone(), this.range.clone());
  }
}

class UltimateStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly sums: readonly [PressureSums, PressureSums, PressureSums],
    private readonly closes = new Previous()
  ) {}

  next(bar: Bar): ArrayLike<number> {
    // NaN on the first bar, which has no previous close.
    const close = this.closes.next(bar.close);
    const low = Math.min(bar.low, close);
    const pressure = bar.close - low;
    const range = Math.max(bar.high, close) - low;
    const [fast, middle, slow] = this.sums;
    this.out[0] =
      (100 *
        (4 * fast.next(pressure, range) +
          2 * middle.next(pressure, range) +
          slow.next(pressure, range))) /
      7;
    return this.out;
  }

  clone(): IndicatorStream {
    const [fast, middle, slow] = this.sums;
    return new UltimateStream([fast.clone(), middle.clone(), slow.clone()], this.closes.clone());
  }
}

/**
 * Ultimate oscillator: the buying pressure `C - MIN(L, C')` over the true range `MAX(H, C') -
 * MIN(L, C')`, each summed over 7, 14 and 28 bars, weighed 4, 2 and 1, in percent. The first bar
 * has no previous close, so it starts on bar `slow`; undefined over bars without range.
 */
export const UO: IndicatorDefinition<{ fast: number; middle: number; slow: number }> = {
  type: 'UO',
  name: 'UO',
  pane: 'new',
  precision: 2,
  params: {
    fast: periodParam(7, 'Fast length'),
    middle: periodParam(14, 'Middle length'),
    slow: periodParam(28, 'Slow length')
  },
  outputs: () => [namedLine('uo', 'UO')],
  create: ({ fast, middle, slow }) =>
    new UltimateStream([PressureSums.of(fast), PressureSums.of(middle), PressureSums.of(slow)])
};

/** A simple average of the rate of change. */
class SmoothedRoc implements Step {
  constructor(
    private readonly roc: Step,
    private readonly average: SimpleAverage
  ) {}

  static of(period: number, smoothing: number): SmoothedRoc {
    return new SmoothedRoc(new RocStep(period), new SimpleAverage(smoothing));
  }

  next(value: number): number {
    return this.average.next(this.roc.next(value));
  }

  clone(): SmoothedRoc {
    return new SmoothedRoc(this.roc.clone(), this.average.clone());
  }
}

/** The four smoothed rates of change, weighed 1 to 4. */
class KstStep implements Step {
  constructor(private readonly rocs: readonly SmoothedRoc[]) {}

  next(value: number): number {
    return this.rocs.reduce((total, roc, index) => total + (index + 1) * roc.next(value), 0);
  }

  clone(): Step {
    return new KstStep(this.rocs.map((roc) => roc.clone()));
  }
}

/** The parameters of {@link KST}. */
type KstParams = {
  roc1: number;
  roc2: number;
  roc3: number;
  roc4: number;
  sma1: number;
  sma2: number;
  sma3: number;
  sma4: number;
  signal: number;
};

/**
 * Know sure thing: simple averages of four rates of change of the price, `100 * (X - X[N]) /
 * X[N]` over 10, 15, 20 and 30 bars averaged over 10, 10, 10 and 15, weighed 1 to 4, and their
 * simple average over 9 values as the signal line. It starts once the slowest is averaged, on bar
 * 44 by default, the signal line 8 bars later.
 */
export const KST: IndicatorDefinition<KstParams> = {
  type: 'KST',
  name: 'KST',
  pane: 'new',
  precision: 4,
  params: {
    roc1: periodParam(10, 'ROC Length #1'),
    roc2: periodParam(15, 'ROC Length #2'),
    roc3: periodParam(20, 'ROC Length #3'),
    roc4: periodParam(30, 'ROC Length #4'),
    sma1: periodParam(10, 'SMA Length #1'),
    sma2: periodParam(10, 'SMA Length #2'),
    sma3: periodParam(10, 'SMA Length #3'),
    sma4: periodParam(15, 'SMA Length #4'),
    signal: periodParam(9, 'Signal length')
  },
  outputs: () => [namedLine('kst', 'KST'), namedLine('signalLine', 'Signal line')],
  levels: () => [0],
  create: (params) =>
    new SignalStream(
      new KstStep([
        SmoothedRoc.of(params.roc1, params.sma1),
        SmoothedRoc.of(params.roc2, params.sma2),
        SmoothedRoc.of(params.roc3, params.sma3),
        SmoothedRoc.of(params.roc4, params.sma4)
      ]),
      new SimpleAverage(params.signal)
    )
};

/** A linearly weighted average of the sum of two rates of change. */
class CoppockStep implements Step {
  constructor(
    private readonly long: Step,
    private readonly short: Step,
    private readonly average: LinearlyWeightedAverage
  ) {}

  next(value: number): number {
    return this.average.next(this.long.next(value) + this.short.next(value));
  }

  clone(): Step {
    return new CoppockStep(this.long.clone(), this.short.clone(), this.average.clone());
  }
}

/**
 * Coppock curve: the linearly weighted average over 10 bars of the sum of the rates of change of
 * the price over 14 and 11 bars, from bar `longRoc + wmaLength - 1`.
 */
export const COPPOCK: IndicatorDefinition<{
  wmaLength: number;
  longRoc: number;
  shortRoc: number;
}> = {
  type: 'COPPOCK',
  name: 'Coppock',
  pane: 'new',
  precision: 2,
  params: {
    wmaLength: periodParam(10, 'WMA Length'),
    longRoc: periodParam(14, 'Long RoC Length'),
    shortRoc: periodParam(11, 'Short RoC Length')
  },
  outputs: () => [namedLine('coppockCurve', 'Coppock Curve')],
  levels: () => [0],
  create: ({ wmaLength, longRoc, shortRoc }) =>
    new ParallelStream(
      [
        new CoppockStep(
          new RocStep(longRoc),
          new RocStep(shortRoc),
          new LinearlyWeightedAverage(wmaLength)
        )
      ],
      (_bar, price) => price
    )
};

/** An EMA of an EMA, each seeded with the simple average of its first values. */
class DoubleEma implements Step {
  constructor(
    private readonly first: SeededAverage,
    private readonly second: SeededAverage
  ) {}

  static of(first: number, second: number): DoubleEma {
    return new DoubleEma(SeededAverage.ema(first), SeededAverage.ema(second));
  }

  next(value: number): number {
    return this.second.next(this.first.next(value));
  }

  clone(): DoubleEma {
    return new DoubleEma(this.first.clone(), this.second.clone());
  }
}

/** `100 * EMA(EMA(ΔX)) / EMA(EMA(|ΔX|))` of the price. */
class TsiStep implements Step {
  constructor(
    private readonly change: DoubleEma,
    private readonly size: DoubleEma,
    private readonly previous = new Previous()
  ) {}

  next(value: number): number {
    // NaN on the first bar, which the averages skip.
    const change = value - this.previous.next(value);
    return 100 * ratio(this.change.next(change), this.size.next(Math.abs(change)));
  }

  clone(): Step {
    return new TsiStep(this.change.clone(), this.size.clone(), this.previous.clone());
  }
}

/**
 * True strength index: the change of the price smoothed by an EMA of 25 values and that by an
 * EMA of 13, over its size smoothed alike, in percent, and its EMA of 13 values as the signal
 * line. Each EMA is seeded with the simple average of its first values, and the changes start on
 * the second bar, so it starts on bar `long + short - 1`, the signal line `signal - 1` bars later.
 */
export const TSI: IndicatorDefinition<{ long: number; short: number; signal: number }> = {
  type: 'TSI',
  name: 'TSI',
  pane: 'new',
  precision: 4,
  params: {
    long: periodParam(25, 'Long Length'),
    short: periodParam(13, 'Short Length'),
    signal: periodParam(13, 'Signal length')
  },
  outputs: () => [
    namedLine('trueStrengthIndex', 'True Strength Index'),
    namedLine('signalLine', 'Signal line')
  ],
  levels: () => [0],
  create: ({ long, short, signal }) =>
    new SignalStream(
      new TsiStep(DoubleEma.of(long, short), DoubleEma.of(long, short)),
      SeededAverage.ema(signal)
    )
};

/** The close from the middle of the range of `period` bars, over half the range, smoothed. */
class SmiStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly range: RollingExtremes,
    private readonly distance: DoubleEma,
    private readonly width: DoubleEma,
    private readonly average: SeededAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.range.push(bar.high, bar.low);
    const highest = this.range.highest();
    const lowest = this.range.lowest();
    // NaN until the range has `period` bars, which the averages skip.
    const smi =
      200 *
      ratio(
        this.distance.next(bar.close - (highest + lowest) / 2),
        this.width.next(highest - lowest)
      );
    this.out[0] = smi;
    this.out[1] = this.average.next(smi);
    return this.out;
  }

  clone(): IndicatorStream {
    return new SmiStream(
      this.range.clone(),
      this.distance.clone(),
      this.width.clone(),
      this.average.clone()
    );
  }
}

/**
 * Stochastic momentum index: the close's distance from the middle of the highest high and the
 * lowest low of 10 bars, and the width of that range, each smoothed twice by an EMA of 3 values;
 * `200 * distance / width`, and its EMA of 3 values. Each EMA is seeded with the simple average of
 * its first values, so SMI starts on bar `kLength + 2 * (dLength - 1) - 1` and its EMA `emaLength
 * - 1` bars later; undefined while the smoothed width is 0.
 */
export const SMI: IndicatorDefinition<{ kLength: number; dLength: number; emaLength: number }> = {
  type: 'SMI',
  name: 'SMI',
  pane: 'new',
  precision: 2,
  params: {
    kLength: periodParam(10, '%K Length'),
    dLength: periodParam(3, '%D Length'),
    emaLength: periodParam(3, 'EMA Length')
  },
  outputs: () => [namedLine('smi', 'SMI'), namedLine('smiBasedEma', 'SMI-based EMA')],
  levels: () => [40, -40],
  create: ({ kLength, dLength, emaLength }) =>
    new SmiStream(
      new RollingExtremes(kLength),
      DoubleEma.of(dLength, dLength),
      DoubleEma.of(dLength, dLength),
      SeededAverage.ema(emaLength)
    )
};

/**
 * The symmetric weighted average of the latest four values, weighing them 1, 2, 2 and 1; `NaN`
 * until four came and while one of them is `NaN`.
 */
class SymmetricAverage implements Step {
  constructor(private readonly window = new RingBuffer(4)) {}

  next(value: number): number {
    this.window.push(value);
    const { window } = this;
    return window.full
      ? (window.at(0) + 2 * window.at(1) + 2 * window.at(2) + window.at(3)) / 6
      : Number.NaN;
  }

  clone(): SymmetricAverage {
    return new SymmetricAverage(this.window.clone());
  }
}

class RvgiStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly body: SymmetricAverage,
    private readonly span: SymmetricAverage,
    private readonly bodies: MovingSum,
    private readonly spans: MovingSum,
    private readonly signal: SymmetricAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const rvgi = ratio(
      this.bodies.next(this.body.next(bar.close - bar.open)),
      this.spans.next(this.span.next(bar.high - bar.low))
    );
    this.out[0] = rvgi;
    this.out[1] = this.signal.next(rvgi);
    return this.out;
  }

  clone(): IndicatorStream {
    return new RvgiStream(
      this.body.clone(),
      this.span.clone(),
      this.bodies.clone(),
      this.spans.clone(),
      this.signal.clone()
    );
  }
}

/**
 * Relative vigor index: the body `C - O` and the range `H - L` of each bar, each a symmetric
 * weighted average of four bars (weights 1, 2, 2, 1), summed over 10 bars; RVGI is the sum of the
 * bodies over that of the ranges, from bar `period + 2`, and the signal line its symmetric
 * weighted average, 3 bars later. Undefined over bars without range.
 */
export const RVGI: IndicatorDefinition<{ period: number }> = {
  type: 'RVGI',
  name: 'RVGI',
  pane: 'new',
  precision: 4,
  params: { period: periodParam(10, 'Length') },
  outputs: () => [namedLine('rvgi', 'RVGI'), namedLine('signalLine', 'Signal line')],
  create: ({ period }) =>
    new RvgiStream(
      new SymmetricAverage(),
      new SymmetricAverage(),
      new MovingSum(period),
      new MovingSum(period),
      new SymmetricAverage()
    )
};

/** Balance of power: `(C - O) / (H - L)` of each bar, undefined on a bar without range. */
export const BOP: IndicatorDefinition<Record<string, never>> = {
  type: 'BOP',
  name: 'BOP',
  pane: 'new',
  precision: 2,
  params: {},
  outputs: () => [namedLine('bop', 'BOP')],
  create: () =>
    new ParallelStream([IDENTITY], (bar) => ratio(bar.close - bar.open, bar.high - bar.low))
};

/**
 * How many bars in a row the price rose (positive) or fell (negative), 0 when unchanged. The first
 * bar, with no price before it, neither equal nor higher, counts as the first of a fall: -1.
 */
class StreakStep implements Step {
  constructor(
    private readonly previous = new Previous(),
    private streak = 0
  ) {}

  next(value: number): number {
    const before = this.previous.next(value);
    const { streak } = this;
    this.streak =
      value === before ? 0 : value > before ? Math.max(streak, 0) + 1 : Math.min(streak, 0) - 1;
    return this.streak;
  }

  clone(): StreakStep {
    return new StreakStep(this.previous.clone(), this.streak);
  }
}

/**
 * The share of the previous `period` values that are at most the value, in percent; values that
 * are `NaN` are left out, the window holding the latest `period` numbers, `NaN` until it is full.
 */
class PercentRankStep implements Step {
  constructor(private readonly window: RingBuffer) {}

  next(value: number): number {
    if (Number.isNaN(value)) {
      return Number.NaN;
    }

    const { window } = this;
    let count = 0;

    for (let index = 0; index < window.length; index += 1) {
      count += window.at(index) <= value ? 1 : 0;
    }

    const rank = window.full ? (100 * count) / window.capacity : Number.NaN;
    window.push(value);
    return rank;
  }

  clone(): PercentRankStep {
    return new PercentRankStep(this.window.clone());
  }
}

/** The mean of RSI, the RSI of the streak and the percent rank of the one-bar change. */
class ConnorsStep implements Step {
  constructor(
    private readonly rsi: WilderRsi,
    private readonly streak: StreakStep,
    private readonly streakRsi: WilderRsi,
    private readonly change: Step,
    private readonly rank: PercentRankStep
  ) {}

  next(value: number): number {
    const rsi = this.rsi.next(value);
    const streak = this.streakRsi.next(this.streak.next(value));
    return (rsi + streak + this.rank.next(this.change.next(value))) / 3;
  }

  clone(): Step {
    return new ConnorsStep(
      this.rsi.clone(),
      this.streak.clone(),
      this.streakRsi.clone(),
      this.change.clone(),
      this.rank.clone()
    );
  }
}

/**
 * Connors RSI: the mean of Wilder's RSI of the price over 3 bars, Wilder's RSI over 2 bars of the
 * streak of rises and falls (see {@link StreakStep}), and the percent rank of the one-bar rate of
 * change among the previous 100 ones. The rate of change starts on the second bar, so it starts
 * on bar `rocLength + 1`.
 */
export const CRSI: IndicatorDefinition<{
  rsiLength: number;
  streakLength: number;
  rocLength: number;
}> = {
  type: 'CRSI',
  name: 'CRSI',
  pane: 'new',
  precision: 2,
  params: {
    rsiLength: periodParam(3, 'RSI Length'),
    streakLength: periodParam(2, 'UpDown Length'),
    rocLength: periodParam(100, 'ROC Length')
  },
  outputs: () => [namedLine('crsi', 'CRSI')],
  levels: () => [70, 50, 30],
  range: { min: 0, max: 100 },
  create: ({ rsiLength, streakLength, rocLength }) =>
    new ParallelStream(
      [
        new ConnorsStep(
          new WilderRsi(rsiLength),
          new StreakStep(),
          new WilderRsi(streakLength),
          new RocStep(1),
          new PercentRankStep(new RingBuffer(rocLength))
        )
      ],
      (_bar, price) => price
    )
};

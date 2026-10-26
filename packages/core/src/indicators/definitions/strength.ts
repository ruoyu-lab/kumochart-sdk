// Oscillators of Chinese charting software that weigh each bar against the one before it.
import type { Bar } from '../../data/types';
import { MovingAverage, MovingSum, Previous, RingBuffer } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { lineOutput, lineOutputs, periodParam, periodsParam, ratio } from './shared';

/**
 * The swing index of each bar against the one before, `NaN` on the first:
 * `SI = 16 * X / R * MAX(AA, BB)`, undefined where `R` is 0.
 */
class SwingStep {
  constructor(
    private readonly opens = new Previous(),
    private readonly lows = new Previous(),
    private readonly closes = new Previous()
  ) {}

  next(bar: Bar): number {
    const open = this.opens.next(bar.open);
    const low = this.lows.next(bar.low);
    const close = this.closes.next(bar.close);
    const aa = Math.abs(bar.high - close);
    const bb = Math.abs(bar.low - close);
    const cc = Math.abs(bar.high - low);
    const dd = Math.abs(close - open);
    const r =
      aa > bb && aa > cc
        ? aa + bb / 2 + dd / 4
        : bb > cc && bb > aa
          ? bb + aa / 2 + dd / 4
          : cc + dd / 4;
    const x = bar.close - close + (bar.close - bar.open) / 2 + close - open;
    return ratio(16 * x, r) * Math.max(aa, bb);
  }

  clone(): SwingStep {
    return new SwingStep(this.opens.clone(), this.lows.clone(), this.closes.clone());
  }
}

class AsiStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly swing: SwingStep,
    private readonly sum: MovingSum,
    private readonly average: MovingAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const asi = this.sum.next(this.swing.next(bar));
    this.out[0] = asi;
    this.out[1] = this.average.next(asi);
    return this.out;
  }

  clone(): IndicatorStream {
    return new AsiStream(this.swing.clone(), this.sum.clone(), this.average.clone());
  }
}

/**
 * 振动升降指标 (accumulative swing index), as in Chinese charting software. Against the previous
 * close `LC`, low and open: `AA = |H - LC|`, `BB = |L - LC|`, `CC = |H - REF(L, 1)|`, `DD = |LC -
 * REF(O, 1)|`; `R = AA + BB / 2 + DD / 4` where AA is the largest of AA, BB and CC, `BB + AA / 2 +
 * DD / 4` where BB is, else `CC + DD / 4`; `X = C - LC + (C - O) / 2 + LC - REF(O, 1)` and `SI =
 * 16 * X / R * MAX(AA, BB)`. `ASI = SUM(SI, M1)` and `ASIT = MA(ASI, M2)`. The first bar has no
 * swing, so ASI starts on bar `M1` and ASIT `M2 - 1` bars later; a bar where `R` is 0 has none,
 * and the sums over it neither.
 */
export const ASI: IndicatorDefinition<{ period: number; signal: number }> = {
  type: 'ASI',
  name: 'ASI',
  pane: 'new',
  precision: 'price',
  params: { period: periodParam(26), signal: periodParam(10, 'Signal') },
  outputs: () => [lineOutput('ASI'), lineOutput('ASIT')],
  create: ({ period, signal }) =>
    new AsiStream(new SwingStep(), new MovingSum(period), new MovingAverage(signal))
};

/**
 * How many bars late each average of CR is: a bar shows the average of `M / 2.5 + 1` bars before
 * it, the fraction cut off (25 bars for 62).
 */
export function crShift(period: number): number {
  return Math.floor(period / 2.5 + 1);
}

/** The moving average of CR as of `shift` bars before. */
class ShiftedAverage {
  constructor(
    private readonly average: MovingAverage,
    private readonly history: RingBuffer
  ) {}

  static of(period: number): ShiftedAverage {
    return new ShiftedAverage(new MovingAverage(period), new RingBuffer(crShift(period)));
  }

  next(value: number): number {
    return this.history.push(this.average.next(value));
  }

  clone(): ShiftedAverage {
    return new ShiftedAverage(this.average.clone(), this.history.clone());
  }
}

class CrStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(
    private readonly averages: readonly ShiftedAverage[],
    private readonly middles: Previous,
    private readonly above: MovingSum,
    private readonly below: MovingSum
  ) {
    this.out = new Float64Array(1 + averages.length);
  }

  next(bar: Bar): ArrayLike<number> {
    // NaN on the first bar, which has no middle before it.
    const middle = this.middles.next((bar.high + bar.low) / 2);
    const cr =
      ratio(
        this.above.next(Math.max(0, bar.high - middle)),
        this.below.next(Math.max(0, middle - bar.low))
      ) * 100;
    this.out[0] = cr;
    this.averages.forEach((average, index) => {
      this.out[index + 1] = average.next(cr);
    });
    return this.out;
  }

  clone(): IndicatorStream {
    return new CrStream(
      this.averages.map((average) => average.clone()),
      this.middles.clone(),
      this.above.clone(),
      this.below.clone()
    );
  }
}

/**
 * 能量指标 (CR, also 中间意愿指标), as in Chinese charting software: against the middle of the
 * previous bar `MID = REF(H + L, 1) / 2`, `CR = SUM(MAX(0, H - MID), N) / SUM(MAX(0, MID - L), N) *
 * 100`, from bar `N`, undefined while nothing went below the middles. Each average is `REF(MA(CR,
 * M), M / 2.5 + 1)`, the average as of that many bars before, the fraction of the shift cut off
 * (see {@link crShift}): 10, 20, 40 and 62 bars by default, shifted by 5, 9, 17 and 25.
 */
export const CR: IndicatorDefinition<{ period: number; periods: readonly number[] }> = {
  type: 'CR',
  name: 'CR',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(26), periods: periodsParam([10, 20, 40, 62], 'MA Length') },
  outputs: ({ periods }) => [lineOutput('CR'), ...lineOutputs('MA', periods)],
  create: ({ period, periods }) =>
    new CrStream(
      periods.map((each) => ShiftedAverage.of(each)),
      new Previous(),
      new MovingSum(period),
      new MovingSum(period)
    )
};

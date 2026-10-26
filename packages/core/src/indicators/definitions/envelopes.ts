import type { Bar } from '../../data/types';
import { MovingAverage, Previous, RollingExtremes, WeightedAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import {
  lineOutput,
  movingAverage,
  namedLine,
  periodParam,
  switchParam,
  type BarStep
} from './shared';

/** A moving average and the lines `percent` above and below it. */
class EnvelopeStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly share: number,
    private readonly mean: BarStep
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const basis = this.mean.next(price, bar);
    this.out[0] = basis;
    this.out[1] = basis * (1 + this.share);
    this.out[2] = basis * (1 - this.share);
    return this.out;
  }

  clone(): IndicatorStream {
    return new EnvelopeStream(this.share, this.mean.clone());
  }
}

/**
 * Envelope: a simple moving average of the price (or an EMA seeded with its simple average) and
 * the lines `percent` percent above and below it, the area between them shaded.
 */
export const ENVELOPE: IndicatorDefinition<{
  period: number;
  percent: number;
  exponential: number;
}> = {
  type: 'ENVELOPE',
  name: 'Env',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(20, 'Length'),
    percent: { default: 10, min: 0, max: 100, label: 'Percent' },
    exponential: switchParam(false, 'Exponential', false)
  },
  outputs: () => [
    namedLine('basis', 'Basis'),
    namedLine('upper', 'Upper'),
    namedLine('lower', 'Lower')
  ],
  fills: () => [{ from: 'upper', to: 'lower' }],
  create: ({ period, percent, exponential }) =>
    new EnvelopeStream(percent / 100, movingAverage(exponential === 1 ? 'ema' : 'sma', period))
};

/** `EMA(X, 3)` as Chinese charting software computes it: seeded with the first value. */
function ema3(): WeightedAverage {
  return new WeightedAverage(4, 2);
}

/**
 * The six lines of MIKE from the typical price's average of the bars before and the smoothed
 * highest high and lowest low.
 */
class MikeStream implements IndicatorStream {
  private readonly out = new Float64Array(6);

  constructor(
    private readonly typical: MovingAverage,
    private readonly previous: Previous,
    private readonly extremes: RollingExtremes,
    private readonly high: WeightedAverage,
    private readonly low: WeightedAverage,
    /** The EMAs of STOR, MIDR, WEKR, WEKS, MIDS and STOS. */
    private readonly lines: readonly WeightedAverage[]
  ) {}

  static of(period: number): MikeStream {
    return new MikeStream(
      new MovingAverage(period),
      new Previous(),
      new RollingExtremes(period),
      ema3(),
      ema3(),
      Array.from({ length: 6 }, ema3)
    );
  }

  next(bar: Bar): ArrayLike<number> {
    const hlc = this.previous.next(this.typical.next((bar.high + bar.low + bar.close) / 3));
    this.extremes.push(bar.high, bar.low);
    const hv = this.high.next(this.extremes.highest());
    const lv = this.low.next(this.extremes.lowest());
    const raw = [
      2 * hv - lv,
      hlc + hv - lv,
      hlc * 2 - lv,
      hlc * 2 - hv,
      hlc - hv + lv,
      2 * lv - hv
    ];
    this.lines.forEach((line, index) => {
      this.out[index] = line.next(raw[index] ?? Number.NaN);
    });
    return this.out;
  }

  clone(): IndicatorStream {
    return new MikeStream(
      this.typical.clone(),
      this.previous.clone(),
      this.extremes.clone(),
      this.high.clone(),
      this.low.clone(),
      this.lines.map((line) => line.clone())
    );
  }
}

/**
 * 麦克支撑压力 (MIKE support and resistance), as in Chinese charting software:
 * `HLC = REF(MA((H + L + C) / 3, N), 1)`, `HV = EMA(HHV(H, N), 3)`, `LV = EMA(LLV(L, N), 3)`, and
 * the resistances `STOR = EMA(2 * HV - LV, 3)`, `MIDR = EMA(HLC + HV - LV, 3)`,
 * `WEKR = EMA(HLC * 2 - LV, 3)` and the supports `WEKS = EMA(HLC * 2 - HV, 3)`,
 * `MIDS = EMA(HLC - HV + LV, 3)`, `STOS = EMA(2 * LV - HV, 3)`. `EMA(X, 3)` starts from the first
 * X: STOR and STOS on bar `N - 1`, the others, of the average of the bars before, on bar `N`.
 */
export const MIKE: IndicatorDefinition<{ period: number }> = {
  type: 'MIKE',
  name: 'MIKE',
  pane: 'main',
  precision: 'price',
  params: { period: periodParam(10) },
  outputs: () => ['STOR', 'MIDR', 'WEKR', 'WEKS', 'MIDS', 'STOS'].map(lineOutput),
  create: ({ period }) => MikeStream.of(period)
};

import type { Bar } from '../../data/types';
import { fail } from '../../utils/errors';
import { checkNumber, checkOneOf } from '../../utils/validate';
import {
  LinearlyWeightedAverage,
  MovingSum,
  SeededAverage,
  SimpleAverage,
  StandardDeviation
} from '../primitives';
import type {
  IndicatorFill,
  IndicatorOutput,
  IndicatorStream,
  ParamOption,
  ParamSpec
} from '../types';

/** A primitive that maps one input value per bar to one output value. */
export interface Step {
  next(value: number): number;
  clone(): Step;
}

/**
 * A calculation fed a value and its bar, bar by bar, such as a moving average, which a volume
 * weighs; `clone()` copies its state, as a calculator copies its own.
 */
export interface BarStep {
  /** Takes the value of the next bar and returns what it computes, `NaN` while it warms up. */
  next(value: number, bar: Bar): number;
  clone(): BarStep;
}

/** Passes the input through unchanged. */
export const IDENTITY: Step = {
  next: (value) => value,
  clone: () => IDENTITY
};

/** Feeds the same input into several primitives, one output each. */
export class ParallelStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(
    private readonly steps: readonly (Step | BarStep)[],
    private readonly input: (bar: Bar, price: number) => number
  ) {
    this.out = new Float64Array(steps.length);
  }

  next(bar: Bar, price: number): ArrayLike<number> {
    const value = this.input(bar, price);
    this.steps.forEach((step, index) => {
      this.out[index] = step.next(value, bar);
    });
    return this.out;
  }

  clone(): IndicatorStream {
    return new ParallelStream(
      this.steps.map((step) => step.clone()),
      this.input
    );
  }
}

/** A value of the price and its moving average, such as PSY and PSYMA. */
export class SignalStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly step: Step,
    private readonly average: Step
  ) {}

  next(_bar: Bar, price: number): ArrayLike<number> {
    const value = this.step.next(price);
    this.out[0] = value;
    this.out[1] = this.average.next(value);
    return this.out;
  }

  clone(): IndicatorStream {
    return new SignalStream(this.step.clone(), this.average.clone());
  }
}

/** A line keyed by its lower-cased label, such as `rsi6` for `RSI6`. */
export function lineOutput(label: string): IndicatorOutput {
  return { key: label.toLowerCase(), label, plot: { kind: 'line' } };
}

/** A line with a key and a label of their own, such as `signalLine` for `Signal line`. */
export function namedLine(key: string, label: string): IndicatorOutput {
  return { key, label, plot: { kind: 'line' } };
}

export function lineOutputs(prefix: string, periods: readonly number[]): IndicatorOutput[] {
  return periods.map((period) => lineOutput(`${prefix}${period}`));
}

/** A whole-number lookback, such as the RSI length. */
export function periodParam(value: number, label = 'Period'): ParamSpec {
  return { default: value, min: 1, max: 2000, integer: true, label };
}

/** Several lookbacks with one output each, such as MA5 and MA10. */
export function periodsParam(values: readonly number[], label = 'Periods'): ParamSpec {
  return { default: values, min: 1, max: 2000, integer: true, label };
}

/** Options named in order, valued 0, 1, 2… */
export function choices(labels: readonly string[]): ParamOption[] {
  return labels.map((label, value) => ({ value, label }));
}

/** A parameter that picks one of `labels`, by its index. */
export function choiceParam(
  labels: readonly string[],
  defaultValue: number,
  label: string,
  legend = true
): ParamSpec {
  return {
    default: defaultValue,
    label,
    options: choices(labels),
    ...(legend ? {} : { legend: false })
  };
}

/** The item of `items` a choice parameter picked. */
export function picked<T>(items: readonly T[], value: number, what: string): T {
  if (!Number.isInteger(value) || value < 0 || value >= items.length) {
    fail(`There is no ${what} ${String(value)}.`);
  }

  return items[value] as T;
}

/** A parameter that turns something on (1) or off (0). */
export function switchParam(on: boolean, label: string, legend = true): ParamSpec {
  return choiceParam(['Off', 'On'], on ? 1 : 0, label, legend);
}

/** `numerator / denominator`, or `NaN` when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

// ─── Moving averages ─────────────────────────────────────────────────────────

/**
 * The moving averages of {@link movingAverage}: simple, exponential, Wilder's (RMA, also SMMA),
 * linearly weighted and volume-weighted.
 */
export type AverageKind = 'sma' | 'ema' | 'rma' | 'wma' | 'vwma';

const AVERAGE_KINDS: readonly AverageKind[] = ['sma', 'ema', 'rma', 'wma', 'vwma'];

/** A plain average as a step that takes the bar, whose volume a volume-weighted one reads. */
class PlainAverage implements BarStep {
  constructor(private readonly average: SimpleAverage | SeededAverage | LinearlyWeightedAverage) {}

  next(value: number): number {
    return this.average.next(value);
  }

  clone(): BarStep {
    return new PlainAverage(this.average.clone());
  }
}

/**
 * `SUM(X * VOLUME, N) / SUM(VOLUME, N)` over the latest `period` bars where `X` is a number:
 * a `NaN` is skipped, its volume too, and leaves the average as it was. Undefined over a window
 * without volume.
 */
export class VolumeWeightedAverage implements BarStep {
  constructor(
    private readonly flow: MovingSum,
    private readonly volume: MovingSum,
    private value = Number.NaN
  ) {}

  static of(period: number): VolumeWeightedAverage {
    return new VolumeWeightedAverage(new MovingSum(period), new MovingSum(period));
  }

  next(input: number, bar: Bar): number {
    if (Number.isNaN(input)) {
      return this.value;
    }

    this.value = ratio(this.flow.next(input * bar.volume), this.volume.next(bar.volume));
    return this.value;
  }

  clone(): BarStep {
    return new VolumeWeightedAverage(this.flow.clone(), this.volume.clone(), this.value);
  }
}

/**
 * A moving average of the latest `period` values, as the indicators of the library pick them: `NaN`
 * until `period` values came, and a `NaN` skipped, the average left as it was. The EMA and the
 * RMA start from the simple average of their first `period` values; the volume-weighted one
 * weighs each value by the volume of its bar.
 */
export function movingAverage(kind: AverageKind, period: number): BarStep {
  checkOneOf('kind', kind, AVERAGE_KINDS);
  checkNumber('period', period, { min: 1, integer: true });

  switch (kind) {
    case 'sma':
      return new PlainAverage(new SimpleAverage(period));
    case 'ema':
      return new PlainAverage(SeededAverage.ema(period));
    case 'rma':
      return new PlainAverage(SeededAverage.rma(period));
    case 'wma':
      return new PlainAverage(new LinearlyWeightedAverage(period));
    case 'vwma':
      return VolumeWeightedAverage.of(period);
  }
}

// ─── Smoothing ───────────────────────────────────────────────────────────────

/** The parameters of a moving average of an oscillator, with Bollinger Bands around it. */
export type SmoothingParams = {
  maType: number;
  maLength: number;
  bbMult: number;
};

/** The smoothing averages by option value: none, SMA, SMA with bands, EMA, RMA, WMA and VWMA. */
const SMOOTHING: readonly (AverageKind | null)[] = [
  null,
  'sma',
  'sma',
  'ema',
  'rma',
  'wma',
  'vwma'
];
const WITH_BANDS = 2;

/**
 * The type, length and band width of the moving average of an oscillator, `SMA` (1) or none (0)
 * by default; settings left out of the legend.
 */
export function smoothingParams(on: boolean): { [K in keyof SmoothingParams]: ParamSpec } {
  return {
    maType: choiceParam(
      ['None', 'SMA', 'SMA + Bollinger Bands', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'],
      on ? 1 : 0,
      'Type',
      false
    ),
    maLength: { ...periodParam(14, 'Length'), legend: false },
    bbMult: { default: 2, min: 0.001, max: 50, label: 'BB StdDev', legend: false }
  };
}

/**
 * The outputs of the moving average of an oscillator keyed `key`, labeled `${label}-based MA`,
 * and of the Bollinger Bands around it.
 */
export function smoothingOutputs(
  key: string,
  label: string,
  { maType }: SmoothingParams
): IndicatorOutput[] {
  if (picked(SMOOTHING, maType, 'smoothing type') === null) {
    return [];
  }

  const average = namedLine(`${key}BasedMa`, `${label}-based MA`);
  return maType === WITH_BANDS
    ? [
        average,
        namedLine('upperBollingerBand', 'Upper Bollinger Band'),
        namedLine('lowerBollingerBand', 'Lower Bollinger Band')
      ]
    : [average];
}

/** Shades the Bollinger Bands around the moving average of an oscillator, when it has them. */
export function smoothingFills({ maType }: SmoothingParams): IndicatorFill[] {
  return maType === WITH_BANDS ? [{ from: 'upperBollingerBand', to: 'lowerBollingerBand' }] : [];
}

/** An oscillator and its moving average, with Bollinger Bands around it. */
export class SmoothedStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(
    private readonly value: BarStep,
    private readonly average: BarStep | null,
    private readonly deviation: StandardDeviation | null,
    private readonly multiplier: number
  ) {
    this.out = new Float64Array(1 + (average ? 1 : 0) + (deviation ? 2 : 0));
  }

  /** The stream of `value` with the smoothing `params` pick. */
  static of(value: BarStep, { maType, maLength, bbMult }: SmoothingParams): SmoothedStream {
    const kind = picked(SMOOTHING, maType, 'smoothing type');
    return new SmoothedStream(
      value,
      kind && movingAverage(kind, maLength),
      maType === WITH_BANDS ? new StandardDeviation(maLength) : null,
      bbMult
    );
  }

  next(bar: Bar, price: number): ArrayLike<number> {
    const value = this.value.next(price, bar);
    this.out[0] = value;

    if (this.average) {
      const average = this.average.next(value, bar);
      this.out[1] = average;

      if (this.deviation) {
        const spread = this.deviation.next(value) * this.multiplier;
        this.out[2] = average + spread;
        this.out[3] = average - spread;
      }
    }

    return this.out;
  }

  clone(): IndicatorStream {
    return new SmoothedStream(
      this.value.clone(),
      this.average?.clone() ?? null,
      this.deviation?.clone() ?? null,
      this.multiplier
    );
  }
}

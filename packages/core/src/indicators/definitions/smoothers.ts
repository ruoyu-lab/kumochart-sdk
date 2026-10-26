import { RingBuffer, SeededAverage } from '../primitives';
import type { IndicatorDefinition, ParamSpec } from '../types';
import {
  choiceParam,
  lineOutput,
  movingAverage,
  namedLine,
  ParallelStream,
  periodParam,
  picked,
  type AverageKind,
  type Step
} from './shared';

/**
 * `weights[0] * EMA + weights[1] * EMA(EMA) + …` of the price, each EMA of the one before it and
 * seeded with the simple average of its first values, so the `n`-th starts `n * (length - 1)`
 * bars in.
 */
class ChainedEmaStep implements Step {
  constructor(
    private readonly weights: readonly number[],
    private readonly averages: readonly SeededAverage[]
  ) {}

  static of(period: number, weights: readonly number[]): ChainedEmaStep {
    return new ChainedEmaStep(
      weights,
      weights.map(() => SeededAverage.ema(period))
    );
  }

  next(value: number): number {
    let input = value;
    let sum = 0;

    this.averages.forEach((average, index) => {
      input = average.next(input);
      sum += (this.weights[index] ?? 0) * input;
    });

    return sum;
  }

  clone(): Step {
    return new ChainedEmaStep(
      this.weights,
      this.averages.map((average) => average.clone())
    );
  }
}

/**
 * Double exponential moving average: `2 * EMA - EMA(EMA)` of the price, each EMA seeded with the
 * simple average of its first values, so it starts on bar `2 * (length - 1)`.
 */
export const DEMA: IndicatorDefinition<{ period: number }> = {
  type: 'DEMA',
  name: 'DEMA',
  pane: 'main',
  precision: 'price',
  params: { period: periodParam(9, 'Length') },
  outputs: () => [lineOutput('DEMA')],
  create: ({ period }) =>
    new ParallelStream([ChainedEmaStep.of(period, [2, -1])], (_bar, price) => price)
};

/**
 * Triple exponential moving average: `3 * (EMA - EMA(EMA)) + EMA(EMA(EMA))` of the price, each
 * EMA seeded with the simple average of its first values, so it starts on bar `3 * (length - 1)`.
 */
export const TEMA: IndicatorDefinition<{ period: number }> = {
  type: 'TEMA',
  name: 'TEMA',
  pane: 'main',
  precision: 'price',
  params: { period: periodParam(9, 'Length') },
  outputs: () => [lineOutput('TEMA')],
  create: ({ period }) =>
    new ParallelStream([ChainedEmaStep.of(period, [3, -3, 1])], (_bar, price) => price)
};

/**
 * The least squares line through the latest `period` values, the oldest at `x = 0`, read at
 * `x = period - 1 - offset`: on the latest value for offset 0, that many bars before it for a
 * positive offset and past it for a negative one.
 */
class RegressionStep implements Step {
  /** `SUM((x - mean x)^2)` of the positions `0 … period - 1`. */
  private readonly spread: number;

  constructor(
    private readonly offset: number,
    private readonly window: RingBuffer
  ) {
    const count = window.capacity;
    this.spread = (count * (count * count - 1)) / 12;
  }

  next(value: number): number {
    this.window.push(value);

    if (!this.window.full) {
      return Number.NaN;
    }

    const count = this.window.capacity;
    const middle = (count - 1) / 2;
    const mean = this.window.sum() / count;
    let covariance = 0;

    for (let index = 0; index < count; index += 1) {
      covariance += (index - middle) * (this.window.at(index) - mean);
    }

    return mean + (covariance / this.spread) * (count - 1 - this.offset - middle);
  }

  clone(): Step {
    return new RegressionStep(this.offset, this.window.clone());
  }
}

/**
 * Least squares moving average: the linear regression of the latest `period` prices, read on the
 * latest bar, or `offset` bars before it (after it when negative). It starts on bar `period - 1`.
 */
export const LSMA: IndicatorDefinition<{ period: number; offset: number }> = {
  type: 'LSMA',
  name: 'LSMA',
  pane: 'main',
  precision: 'price',
  params: {
    period: { default: 25, min: 2, max: 2000, integer: true, label: 'Length' },
    offset: { default: 0, min: -2000, max: 2000, integer: true, label: 'Offset' }
  },
  outputs: () => [lineOutput('LSMA')],
  create: ({ period, offset }) =>
    new ParallelStream([new RegressionStep(offset, new RingBuffer(period))], (_bar, price) => price)
};

/**
 * `MD = MD' + (X - MD') / (N * (X / MD')^4)`, starting from the EMA of the first `N` values, their
 * simple average, on bar `N - 1`.
 */
class McGinleyStep implements Step {
  constructor(
    private readonly period: number,
    private readonly seed: SeededAverage,
    private value = Number.NaN
  ) {}

  next(price: number): number {
    this.value = Number.isNaN(this.value)
      ? this.seed.next(price)
      : this.value + (price - this.value) / (this.period * (price / this.value) ** 4);
    return this.value;
  }

  clone(): Step {
    return new McGinleyStep(this.period, this.seed.clone(), this.value);
  }
}

/**
 * McGinley Dynamic: a moving average that speeds up as the price runs away from it,
 * `MD = MD' + (X - MD') / (N * (X / MD')^4)`, starting from the simple average of the first `N`
 * prices.
 */
export const MCGINLEY: IndicatorDefinition<{ period: number }> = {
  type: 'MCGINLEY',
  name: 'McGinley Dynamic',
  pane: 'main',
  precision: 'price',
  params: { period: periodParam(14, 'Length') },
  outputs: () => [lineOutput('McGinley')],
  create: ({ period }) =>
    new ParallelStream(
      [new McGinleyStep(period, SeededAverage.ema(period))],
      (_bar, price) => price
    )
};

/** The averages of a ribbon's lines, by option value. */
const RIBBON_AVERAGES: readonly AverageKind[] = ['sma', 'ema', 'rma', 'wma', 'vwma'];
const RIBBON_LENGTHS = [20, 50, 100, 200] as const;

/** Parameters of a moving average ribbon: the type and length of each of its four averages. */
export type RibbonParams = {
  maType1: number;
  period1: number;
  maType2: number;
  period2: number;
  maType3: number;
  period3: number;
  maType4: number;
  period4: number;
};

/** The type and the length of each line, in the order of its lines. */
function ribbonLines(params: RibbonParams): readonly [type: number, length: number][] {
  return [
    [params.maType1, params.period1],
    [params.maType2, params.period2],
    [params.maType3, params.period3],
    [params.maType4, params.period4]
  ];
}

function ribbonParams(): { [K in keyof RibbonParams]: ParamSpec } {
  const type = (slot: number) =>
    choiceParam(['SMA', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'], 0, `Type #${String(slot)}`);
  const length = (slot: number) =>
    periodParam(RIBBON_LENGTHS[slot - 1] ?? 0, `Length #${String(slot)}`);
  return {
    maType1: type(1),
    period1: length(1),
    maType2: type(2),
    period2: length(2),
    maType3: type(3),
    period3: length(3),
    maType4: type(4),
    period4: length(4)
  };
}

/**
 * Moving average ribbon: four moving averages of the price, SMAs of 20, 50, 100 and 200 by
 * default, each of the type picked: simple, exponential, Wilder's (RMA), linearly weighted or
 * volume-weighted, as the averages of the SDK compute them.
 */
export const RIBBON: IndicatorDefinition<RibbonParams> = {
  type: 'RIBBON',
  name: 'MA Ribbon',
  pane: 'main',
  precision: 'price',
  params: ribbonParams(),
  outputs: () => [1, 2, 3, 4].map((slot) => namedLine(`ma${String(slot)}`, `MA №${String(slot)}`)),
  create: (params) =>
    new ParallelStream(
      ribbonLines(params).map(([type, length]) =>
        movingAverage(picked(RIBBON_AVERAGES, type, 'ribbon average'), length)
      ),
      (_bar, price) => price
    )
};

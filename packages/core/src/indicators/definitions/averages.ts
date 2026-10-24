import {
  LinearlyWeightedAverage,
  MovingAverage,
  MovingSum,
  Previous,
  RingBuffer,
  SeededAverage,
  SimpleAverage
} from '../primitives';
import type { IndicatorDefinition } from '../types';
import {
  lineOutput,
  lineOutputs,
  ParallelStream,
  periodParam,
  periodsParam,
  type Step,
  VolumeWeightedAverage
} from './shared';

/** Simple moving averages, one line for each length. */
export const MA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'MA',
  name: 'MA',
  pane: 'main',
  precision: 'price',
  params: { periods: periodsParam([9], 'Length') },
  outputs: ({ periods }) => lineOutputs('MA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => new SimpleAverage(period)),
      (_bar, price) => price
    )
};

/** Exponential moving averages, `alpha = 2 / (length + 1)`, seeded with the simple average. */
export const EMA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'EMA',
  name: 'EMA',
  pane: 'main',
  precision: 'price',
  params: { periods: periodsParam([9], 'Length') },
  outputs: ({ periods }) => lineOutputs('EMA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => SeededAverage.ema(period)),
      (_bar, price) => price
    )
};

/**
 * Smoothed (Wilder) moving averages, `y = (y' * (length - 1) + x) / length`, seeded with the
 * simple average of the first `length` values.
 */
export const SMMA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'SMMA',
  name: 'SMMA',
  pane: 'main',
  precision: 'price',
  params: { periods: periodsParam([7], 'Length') },
  outputs: ({ periods }) => lineOutputs('SMMA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => SeededAverage.rma(period)),
      (_bar, price) => price
    )
};

/** Linearly weighted moving averages, the newest value weighing `length` and the oldest 1. */
export const WMA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'WMA',
  name: 'WMA',
  pane: 'main',
  precision: 'price',
  params: { periods: periodsParam([9], 'Length') },
  outputs: ({ periods }) => lineOutputs('WMA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => new LinearlyWeightedAverage(period)),
      (_bar, price) => price
    )
};

/**
 * Hull moving average, `WMA(2 * WMA(n / 2) - WMA(n), √n)`, both lengths rounded down. The outer
 * average starts once the inner ones have values.
 */
class HullStep implements Step {
  constructor(
    private readonly period: number,
    private readonly half = new LinearlyWeightedAverage(Math.floor(period / 2)),
    private readonly full = new LinearlyWeightedAverage(period),
    private readonly root = new LinearlyWeightedAverage(Math.floor(Math.sqrt(period)))
  ) {}

  next(value: number): number {
    const raw = 2 * this.half.next(value) - this.full.next(value);
    return Number.isNaN(raw) ? raw : this.root.next(raw);
  }

  clone(): Step {
    return new HullStep(this.period, this.half.clone(), this.full.clone(), this.root.clone());
  }
}

export const HMA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'HMA',
  name: 'HMA',
  pane: 'main',
  precision: 'price',
  params: { periods: { default: [9], min: 2, max: 2000, integer: true, label: 'Length' } },
  outputs: ({ periods }) => lineOutputs('HMA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => new HullStep(period)),
      (_bar, price) => price
    )
};

/**
 * Kaufman's adaptive moving average. The efficiency ratio is the net move over `period` bars
 * divided by the sum of the moves of each bar (0 when nothing moved); it scales the smoothing
 * between the `fast` and the `slow` EMA constants, squared. The first value, on bar `period`, is
 * the price.
 */
class KamaStep implements Step {
  private readonly fastest: number;
  private readonly slowest: number;

  constructor(
    private readonly period: number,
    private readonly fast: number,
    private readonly slow: number,
    private readonly previous = new Previous(),
    private readonly history = new RingBuffer(period),
    private readonly moves = new MovingSum(period),
    private value = Number.NaN
  ) {
    this.fastest = 2 / (fast + 1);
    this.slowest = 2 / (slow + 1);
  }

  next(price: number): number {
    const previous = this.previous.next(price);
    const base = this.history.push(price);
    const noise = this.moves.next(Math.abs(price - previous));

    if (Number.isNaN(noise)) {
      return Number.NaN;
    }

    const efficiency = noise === 0 ? 0 : Math.abs(price - base) / noise;
    const smoothing = (efficiency * (this.fastest - this.slowest) + this.slowest) ** 2;
    const from = Number.isNaN(this.value) ? price : this.value;
    this.value = from + smoothing * (price - from);
    return this.value;
  }

  clone(): Step {
    return new KamaStep(
      this.period,
      this.fast,
      this.slow,
      this.previous.clone(),
      this.history.clone(),
      this.moves.clone(),
      this.value
    );
  }
}

export const KAMA: IndicatorDefinition<{ period: number; fast: number; slow: number }> = {
  type: 'KAMA',
  name: 'KAMA',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(10, 'ER length'),
    fast: periodParam(2, 'Fast length'),
    slow: periodParam(30, 'Slow length')
  },
  outputs: () => [lineOutput('KAMA')],
  create: ({ period, fast, slow }) =>
    new ParallelStream([new KamaStep(period, fast, slow)], (_bar, price) => price)
};

/**
 * Arnaud Legoux moving average: a Gaussian-weighted average of the last `period` prices centered
 * `offset` of the way from the oldest to the newest, `period / sigma` wide.
 */
class AlmaStep implements Step {
  constructor(
    private readonly weights: Float64Array,
    private readonly norm: number,
    private readonly window = new RingBuffer(weights.length)
  ) {}

  next(value: number): number {
    this.window.push(value);

    if (!this.window.full) {
      return Number.NaN;
    }

    let sum = 0;

    for (let index = 0; index < this.weights.length; index += 1) {
      sum += this.window.at(index) * (this.weights[index] ?? 0);
    }

    return sum / this.norm;
  }

  clone(): Step {
    return new AlmaStep(this.weights, this.norm, this.window.clone());
  }
}

function almaStep(period: number, offset: number, sigma: number): AlmaStep {
  const center = offset * (period - 1);
  const width = period / sigma;
  const weights = Float64Array.from({ length: period }, (_, index) =>
    Math.exp(-((index - center) ** 2) / (2 * width * width))
  );
  return new AlmaStep(
    weights,
    weights.reduce((sum, weight) => sum + weight, 0)
  );
}

export const ALMA: IndicatorDefinition<{ period: number; offset: number; sigma: number }> = {
  type: 'ALMA',
  name: 'ALMA',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(9, 'Length'),
    offset: { default: 0.85, min: 0, max: 1, label: 'Offset' },
    sigma: { default: 6, min: 0.1, max: 100, label: 'Sigma' }
  },
  outputs: () => [lineOutput('ALMA')],
  create: ({ period, offset, sigma }) =>
    new ParallelStream([almaStep(period, offset, sigma)], (_bar, price) => price)
};

/** Volume-weighted moving averages, `SUM(price * volume, N) / SUM(volume, N)`. */
export const VWMA: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'VWMA',
  name: 'VWMA',
  pane: 'main',
  precision: 'price',
  params: { periods: periodsParam([20], 'Length') },
  outputs: ({ periods }) => lineOutputs('VWMA', periods),
  create: ({ periods }) =>
    new ParallelStream(
      periods.map((period) => VolumeWeightedAverage.of(period)),
      (_bar, price) => price
    )
};

/** The mean of four moving averages. */
class BbiStep implements Step {
  constructor(private readonly averages: readonly MovingAverage[]) {}

  next(value: number): number {
    let sum = 0;

    for (const average of this.averages) {
      sum += average.next(value);
    }

    return sum / this.averages.length;
  }

  clone(): Step {
    return new BbiStep(this.averages.map((average) => average.clone()));
  }
}

/**
 * 多空指标 (bull and bear index), as in Chinese charting software: `(MA(N1) + MA(N2) + MA(N3) +
 * MA(N4)) / 4`.
 */
export const BBI: IndicatorDefinition<{ n1: number; n2: number; n3: number; n4: number }> = {
  type: 'BBI',
  name: 'BBI',
  pane: 'main',
  precision: 'price',
  params: {
    n1: periodParam(3, 'N1'),
    n2: periodParam(6, 'N2'),
    n3: periodParam(12, 'N3'),
    n4: periodParam(24, 'N4')
  },
  outputs: () => [lineOutput('BBI')],
  create: ({ n1, n2, n3, n4 }) =>
    new ParallelStream(
      [new BbiStep([n1, n2, n3, n4].map((period) => new MovingAverage(period)))],
      (_bar, price) => price
    )
};

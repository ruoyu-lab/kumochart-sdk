import type { Bar } from '../../data/types';
import { MovingAverage, MovingSum, Previous, SeededAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { lineOutput, namedLine, ParallelStream, periodParam, ratio, type BarStep } from './shared';

/**
 * The volume of a bar weighted by where its close lies in its range, from `-V` at the low to `V`
 * at the high: `(2C - L - H) / (H - L) * V`, 0 for a bar without range.
 */
function moneyFlowVolume(bar: Bar): number {
  const range = bar.high - bar.low;
  return range === 0 ? 0 : ((2 * bar.close - bar.low - bar.high) / range) * bar.volume;
}

/** The accumulation/distribution line: the running total of the money flow volume of each bar. */
class AccumulationStep implements BarStep {
  constructor(private total = 0) {}

  next(_value: number, bar: Bar): number {
    this.total += moneyFlowVolume(bar);
    return this.total;
  }

  clone(): AccumulationStep {
    return new AccumulationStep(this.total);
  }
}

/**
 * Accumulation/distribution: the running total, from the first bar, of each bar's volume weighted
 * by where its close lies in its range, `(2C - L - H) / (H - L) * V`; a bar without range adds 0.
 */
export const AD: IndicatorDefinition<Record<string, never>> = {
  type: 'AD',
  name: 'Accum/Dist',
  pane: 'new',
  precision: 'volume',
  params: {},
  outputs: () => [namedLine('accumulationDistribution', 'Accumulation/Distribution')],
  create: () => new ParallelStream([new AccumulationStep()], (_bar, price) => price)
};

/** The fast EMA of the accumulation/distribution line minus its slow EMA. */
class ChaikinStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly line: AccumulationStep,
    private readonly fast: SeededAverage,
    private readonly slow: SeededAverage
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const line = this.line.next(price, bar);
    this.out[0] = this.fast.next(line) - this.slow.next(line);
    return this.out;
  }

  clone(): IndicatorStream {
    return new ChaikinStream(this.line.clone(), this.fast.clone(), this.slow.clone());
  }
}

/**
 * Chaikin oscillator: the EMA of `fast` bars of the accumulation/distribution line minus its EMA
 * of `slow` bars, each seeded with the simple average of its first values, so it starts on bar
 * `max(fast, slow) - 1`.
 */
export const CHAIKINOSC: IndicatorDefinition<{ fast: number; slow: number }> = {
  type: 'CHAIKINOSC',
  name: 'Chaikin Osc',
  pane: 'new',
  precision: 'volume',
  params: { fast: periodParam(3, 'Fast length'), slow: periodParam(10, 'Slow length') },
  outputs: () => [namedLine('chaikinOscillator', 'Chaikin Oscillator')],
  levels: () => [0],
  create: ({ fast, slow }) =>
    new ChaikinStream(new AccumulationStep(), SeededAverage.ema(fast), SeededAverage.ema(slow))
};

/** The short EMA of the volume above its long EMA, in percent of the long one. */
class VolumeOscillatorStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly short: SeededAverage,
    private readonly long: SeededAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const short = this.short.next(bar.volume);
    const long = this.long.next(bar.volume);
    this.out[0] = ratio(short - long, long) * 100;
    return this.out;
  }

  clone(): IndicatorStream {
    return new VolumeOscillatorStream(this.short.clone(), this.long.clone());
  }
}

/**
 * Volume oscillator: `100 * (EMA(V, short) - EMA(V, long)) / EMA(V, long)`, each EMA seeded with
 * the simple average of its first values; undefined while the long EMA is 0.
 */
export const VO: IndicatorDefinition<{ short: number; long: number }> = {
  type: 'VO',
  name: 'Volume Osc',
  pane: 'new',
  precision: 2,
  params: { short: periodParam(5, 'Short Length'), long: periodParam(10, 'Long Length') },
  outputs: () => [namedLine('volumeOsc', 'Volume Osc')],
  levels: () => [0],
  create: ({ short, long }) =>
    new VolumeOscillatorStream(SeededAverage.ema(short), SeededAverage.ema(long))
};

/** The change of the close times the volume, smoothed by an EMA. */
class ForceStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly average: SeededAverage,
    private readonly closes = new Previous()
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const change = bar.close - this.closes.next(bar.close);
    this.out[0] = this.average.next(change * bar.volume);
    return this.out;
  }

  clone(): IndicatorStream {
    return new ForceStream(this.average.clone(), this.closes.clone());
  }
}

/**
 * Elder's force index: the EMA of `period` bars of the change of the close times the volume,
 * seeded with the simple average of the first `period` forces; the first bar has no change, so
 * it starts on bar `period`.
 */
export const EFI: IndicatorDefinition<{ period: number }> = {
  type: 'EFI',
  name: 'EFI',
  pane: 'new',
  precision: 'volume',
  params: { period: periodParam(13, 'Length') },
  outputs: () => [namedLine('elderForceIndex', 'Elder Force Index')],
  levels: () => [0],
  create: ({ period }) => new ForceStream(SeededAverage.ema(period))
};

/** The signed volume through its fast EMA minus its slow EMA, and the EMA of that. */
class KlingerStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly fast: SeededAverage,
    private readonly slow: SeededAverage,
    private readonly signal: SeededAverage,
    private readonly typicals = new Previous()
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const typical = (bar.high + bar.low + bar.close) / 3;
    // Not a rise on the first bar, without a change: its volume counts as negative.
    const volume = typical - this.typicals.next(typical) >= 0 ? bar.volume : -bar.volume;
    const klinger = this.fast.next(volume) - this.slow.next(volume);
    this.out[0] = klinger;
    this.out[1] = this.signal.next(klinger);
    return this.out;
  }

  clone(): IndicatorStream {
    return new KlingerStream(
      this.fast.clone(),
      this.slow.clone(),
      this.signal.clone(),
      this.typicals.clone()
    );
  }
}

/**
 * Klinger oscillator: the volume, positive where the typical price `(H + L + C) / 3` did not fall
 * and negative where it fell (and on the first bar, which has no change), through its EMA of
 * `fast` bars minus its EMA of `slow` bars; the signal line is the EMA of `signal` values of it.
 * Each EMA is seeded with the simple average of its first values.
 */
export const KVO: IndicatorDefinition<{ fast: number; slow: number; signal: number }> = {
  type: 'KVO',
  name: 'KVO',
  pane: 'new',
  precision: 'volume',
  params: {
    fast: periodParam(34, 'Fast length'),
    slow: periodParam(55, 'Slow length'),
    signal: periodParam(13, 'Signal length')
  },
  outputs: () => [
    namedLine('klingerOscillator', 'Klinger Oscillator'),
    namedLine('signalLine', 'Signal line')
  ],
  create: ({ fast, slow, signal }) =>
    new KlingerStream(SeededAverage.ema(fast), SeededAverage.ema(slow), SeededAverage.ema(signal))
};

/** Running total of the volume times the relative change of the close, from 0 on the first bar. */
class PriceVolumeTrendStep implements BarStep {
  constructor(
    private readonly closes = new Previous(),
    private total = 0
  ) {}

  next(_value: number, bar: Bar): number {
    const previous = this.closes.next(bar.close);
    const flow = ratio(bar.close - previous, previous) * bar.volume;

    if (!Number.isNaN(flow)) {
      this.total += flow;
    }

    return this.total;
  }

  clone(): BarStep {
    return new PriceVolumeTrendStep(this.closes.clone(), this.total);
  }
}

/**
 * Price volume trend: the running total of `(C - C') / C' * V`, the volume times the relative
 * change of the close, from 0 on the first bar, which has no change.
 */
export const PVT: IndicatorDefinition<Record<string, never>> = {
  type: 'PVT',
  name: 'PVT',
  pane: 'new',
  precision: 'volume',
  params: {},
  outputs: () => [lineOutput('PVT')],
  create: () => new ParallelStream([new PriceVolumeTrendStep()], (_bar, price) => price)
};

/** `SUM((C - O) / (H - L) * V, N) / 10000` and its average. */
class WvadStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly sum: MovingSum,
    private readonly average: MovingAverage
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const range = bar.high - bar.low;
    // A bar without range has no body either: it adds nothing, rather than 0 / 0.
    const flow = range === 0 ? 0 : ((bar.close - bar.open) / range) * bar.volume;
    const wvad = this.sum.next(flow) / 10000;
    this.out[0] = wvad;
    this.out[1] = this.average.next(wvad);
    return this.out;
  }

  clone(): IndicatorStream {
    return new WvadStream(this.sum.clone(), this.average.clone());
  }
}

/**
 * 威廉变异离散量 (Williams' variable accumulation distribution), as in Chinese charting software:
 * `WVAD = SUM((C - O) / (H - L) * VOL, N) / 10000` over `period` bars, a bar without range adding
 * 0, and its average `MAWVAD = MA(WVAD, M)`.
 */
export const WVAD: IndicatorDefinition<{ period: number; signal: number }> = {
  type: 'WVAD',
  name: 'WVAD',
  pane: 'new',
  precision: 'volume',
  params: { period: periodParam(24), signal: periodParam(6, 'Signal') },
  outputs: () => [lineOutput('WVAD'), lineOutput('MAWVAD')],
  create: ({ period, signal }) => new WvadStream(new MovingSum(period), new MovingAverage(signal))
};

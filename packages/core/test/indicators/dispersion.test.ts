import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { computeIndicator, HV } from '../../src/indicators';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, barsFromCloses, compute, expectClose, incrementalMatchesFull } from './helpers';
import {
  closesOnly,
  divide,
  ema,
  field,
  highest,
  lowest,
  N,
  ref,
  skippingNaN,
  sma,
  sum,
  walk,
  zip
} from './reference';

type Bars = readonly Required<BarInput>[];

/** The walk and the real hourly and daily bars of BTCUSDT on Binance. */
const SAMPLES: [name: string, bars: Bars][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT 1h', BTCUSDT['1h']],
  ['BTCUSDT 1d', BTCUSDT['1d']]
];

// ─── References, from the published formulas ───────────────────────────────

/** The population standard deviation of `period` values. */
function stdev(values: readonly number[], period: number): number[] {
  const means = sma(values, period);
  return values.map((_, index) => {
    const mean = means[index] ?? N;
    let total = 0;

    for (let back = 0; back < period; back += 1) {
      total += ((values[index - back] ?? N) - mean) ** 2;
    }

    return Math.sqrt(total / period);
  });
}

function volatility(bars: Bars, period: number, perYear: number): number[] {
  const closes = field(bars, 'close');
  const returns = zip([closes, ref(closes, 1)], (close, previous) => Math.log(close / previous));
  return skippingNaN(returns, (values) => stdev(values, period)).map(
    (deviation) => 100 * deviation * Math.sqrt(perYear)
  );
}

function massIndex(bars: Bars, period: number): number[] {
  const single = ema(
    bars.map((bar) => bar.high - bar.low),
    9
  );
  const double = skippingNaN(single, (values) => ema(values, 9));
  return sum(zip([single, double], divide), period);
}

/** Basis, upper and lower Bollinger Bands of the closes. */
function bands(bars: Bars, period: number, multiplier: number): number[][] {
  const closes = field(bars, 'close');
  const basis = sma(closes, period);
  const deviations = stdev(closes, period);
  return [
    basis,
    zip([basis, deviations], (mean, deviation) => mean + multiplier * deviation),
    zip([basis, deviations], (mean, deviation) => mean - multiplier * deviation)
  ];
}

function bandWidth(bars: Bars, period: number, multiplier: number, length: number): number[][] {
  const [basis = [], upper = [], lower = []] = bands(bars, period, multiplier);
  const width = zip([upper, lower, basis], (top, bottom, mean) => ((top - bottom) / mean) * 100);
  const known = width.filter((value) => !Number.isNaN(value));
  const pad = (values: number[]) => [...width.slice(0, width.length - known.length), ...values];
  return [width, pad(highest(known, length)), pad(lowest(known, length))];
}

function percentB(bars: Bars, period: number, multiplier: number): number[] {
  const [, upper = [], lower = []] = bands(bars, period, multiplier);
  return zip([field(bars, 'close'), upper, lower], (close, top, bottom) =>
    divide(close - bottom, top - bottom)
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('dispersion indicators', () => {
  describe('HV', () => {
    // Returns ln(1.1), ln(0.9), 0: deviations of pairs are half their difference.
    const closes = closesOnly([100, 110, 99, 99]);
    const deviations = [N, N, (Math.log(1.1) - Math.log(0.9)) / 2, -Math.log(0.9) / 2];

    it('annualizes the deviation of the log returns by 365 days on intraday and daily bars', () => {
      for (const interval of [null, '15s', '5m', '4h', '1D']) {
        const { hv = [] } = computeIndicator(HV, closes, { params: { period: 2 }, interval });
        expectClose(
          hv,
          deviations.map((deviation) => 100 * deviation * Math.sqrt(365)),
          9
        );
      }
    });

    it('annualizes it by 365 / 7 weeks on bars of several days, weeks and months', () => {
      for (const interval of ['2D', '1W', '1M', '3M']) {
        const { hv = [] } = computeIndicator(HV, closes, { params: { period: 2 }, interval });
        expectClose(
          hv,
          deviations.map((deviation) => 100 * deviation * Math.sqrt(365 / 7)),
          9
        );
      }
    });

    it('is 0 while the price holds, from bar `period`', () => {
      expectClose(compute('HV', closesOnly([5, 5, 5, 5]), { period: 2 }).hv ?? [], [N, N, 0, 0]);
      const values = compute('HV', walk(20)).hv ?? [];
      expect(values.findIndex((value) => !Number.isNaN(value))).toBe(10);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectClose(compute('HV', bars).hv ?? [], volatility(bars, 10, 365), 9);
      const weekly = computeIndicator(HV, bars, { params: { period: 20 }, interval: '1W' });
      expectClose(weekly.hv ?? [], volatility(bars, 20, 365 / 7), 9);
    });
  });

  describe('MASS', () => {
    it('is the length of the sum while the range holds, from bar 16 + length - 1', () => {
      // Every range 2: both EMAs are 2, every ratio 1.
      const bars = barsFrom(Array.from({ length: 30 }, () => [11, 9, 10] as const));
      const values = compute('MASS', bars).massIndex ?? [];
      expectClose(values, [...Array<number>(25).fill(N), 10, 10, 10, 10, 10]);
    });

    it('is undefined while the bars have no range', () => {
      const bars = barsFrom(Array.from({ length: 30 }, () => [10, 10, 10] as const));
      expect(compute('MASS', bars, { period: 1 }).massIndex?.every(Number.isNaN)).toBe(true);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectClose(compute('MASS', bars).massIndex ?? [], massIndex(bars, 10), 9);
      expectClose(compute('MASS', bars, { period: 25 }).massIndex ?? [], massIndex(bars, 25), 9);
    });
  });

  describe('BBW', () => {
    it('measures the bands in percent of their basis, with its highest and lowest of late', () => {
      // Pairs (1, 3), (3, 3), (3, 7): bases 2, 3, 5, deviations 1, 0, 2; widths 4 * deviation /
      // basis * 100.
      const values = compute('BBW', barsFromCloses([1, 3, 3, 7]), {
        period: 2,
        expansion: 2,
        contraction: 3
      });
      expectClose(values.bollingerBandWidth ?? [], [N, 200, 0, 160]);
      expectClose(values.highestExpansion ?? [], [N, N, 200, 160]);
      expectClose(values.lowestContraction ?? [], [N, N, N, 0]);
    });

    it('has the lines of the highest expansion and the lowest contraction of 125 bars', () => {
      const values = compute('BBW', walk(200));
      const first = (key: string) => values[key]?.findIndex((value) => !Number.isNaN(value));
      expect([
        first('bollingerBandWidth'),
        first('highestExpansion'),
        first('lowestContraction')
      ]).toEqual([19, 143, 143]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      const [width = [], expansion = [], contraction = []] = bandWidth(bars, 20, 2, 125);
      const values = compute('BBW', bars);
      expectClose(values.bollingerBandWidth ?? [], width, 9);
      expectClose(values.highestExpansion ?? [], expansion, 9);
      expectClose(values.lowestContraction ?? [], contraction, 9);
    });
  });

  describe('BBP', () => {
    it('places the price between the lower band (0) and the upper one (1)', () => {
      // Bands 0 to 4, none (a flat pair), 1.5 to 3.5.
      const values = compute('BBP', barsFromCloses([1, 3, 3, 2]), { period: 2 });
      expectClose(values.bollingerBandsB ?? [], [N, 0.75, N, 0.25]);
      // Half a deviation wide, the bands leave the latest price outside.
      const narrow = compute('BBP', barsFromCloses([1, 3]), { period: 2, multiplier: 0.5 });
      expectClose(narrow.bollingerBandsB ?? [], [N, 1.5]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectClose(compute('BBP', bars).bollingerBandsB ?? [], percentB(bars, 20, 2), 9);
      expectClose(
        compute('BBP', bars, { period: 10, multiplier: 1.5 }).bollingerBandsB ?? [],
        percentB(bars, 10, 1.5),
        9
      );
    });
  });

  it.each(['HV', 'MASS', 'BBW', 'BBP'])(
    '%s gives the same values bar by bar on real bars',
    (type) => {
      const { full, incremental } = incrementalMatchesFull(type, BTCUSDT['1h']);

      for (const [key, values] of Object.entries(full)) {
        expectClose(incremental[key] ?? [], values, 9);
      }
    }
  );
});

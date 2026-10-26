import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { BTCUSDT } from '../helpers/market';
import { compute, expectClose } from './helpers';
import { closesOnly, divide, ema, field, N, rma, sma, sum, walk, wma, zip } from './reference';

// Reference implementations written from the published formulas over whole arrays, independent of
// the streams.

/** `2 * EMA - EMA(EMA)`, each EMA seeded with its simple average. */
function referenceDema(values: readonly number[], period: number): number[] {
  const first = ema(values, period);
  return zip([first, ema(first, period)], (e1, e2) => 2 * e1 - e2);
}

/** `3 * (EMA - EMA(EMA)) + EMA(EMA(EMA))`. */
function referenceTema(values: readonly number[], period: number): number[] {
  const first = ema(values, period);
  const second = ema(first, period);
  return zip([first, second, ema(second, period)], (e1, e2, e3) => 3 * (e1 - e2) + e3);
}

/**
 * The least squares line through the latest `period` values by the normal equations, with
 * `x = 0` the oldest, read at `x = period - 1 - offset`.
 */
function referenceLinreg(values: readonly number[], period: number, offset: number): number[] {
  return values.map((_, index) => {
    if (index < period - 1) {
      return N;
    }

    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;

    for (let x = 0; x < period; x += 1) {
      const y = values[index - period + 1 + x] ?? N;
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    }

    const slope = (period * sxy - sx * sy) / (period * sxx - sx * sx);
    const intercept = (sy - slope * sx) / period;
    return intercept + slope * (period - 1 - offset);
  });
}

/** McGinley Dynamic, from the simple average of the first `period` values. */
function referenceMcGinley(values: readonly number[], period: number): number[] {
  const seed = sma(values, period);
  const result: number[] = [];
  values.forEach((value, index) => {
    const previous = result[index - 1] ?? N;
    result.push(
      Number.isNaN(previous)
        ? (seed[index] ?? N)
        : previous + (value - previous) / (period * (value / previous) ** 4)
    );
  });
  return result;
}

/** `SUM(X * V, N) / SUM(V, N)`. */
function referenceVwma(
  values: readonly number[],
  volumes: readonly number[],
  period: number
): number[] {
  return zip(
    [
      sum(
        zip([values, volumes], (value, volume) => value * volume),
        period
      ),
      sum(volumes, period)
    ],
    divide
  );
}

const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT daily', BTCUSDT['1d']],
  ['BTCUSDT hourly', BTCUSDT['1h']]
];

describe('smoothing averages', () => {
  describe('DEMA and TEMA', () => {
    it('chain EMAs seeded with their simple averages', () => {
      // Period 2, α = 2/3, closes 1, 2, 4, 8, 16.
      // EMA: 3/2, 19/6, 115/18, …; EMA of it: 7/3 (the mean of 3/2 and 19/6), 136/27;
      // EMA of that: 199/54. DEMA: 2 * 19/6 - 7/3 = 4, then 2 * 115/18 - 136/27 = 209/27.
      // TEMA: 3 * (115/18 - 136/27) + 199/54 = 209/27.
      const bars = closesOnly([1, 2, 4, 8]);
      expectClose(compute('DEMA', bars, { period: 2 }).dema ?? [], [N, N, 4, 209 / 27]);
      expectClose(compute('TEMA', bars, { period: 2 }).tema ?? [], [N, N, N, 209 / 27]);
    });

    it('start on bar 2 * (length - 1) and 3 * (length - 1)', () => {
      const bars = walk(60);
      const dema = compute('DEMA', bars).dema ?? [];
      const tema = compute('TEMA', bars).tema ?? [];
      expect(dema.findIndex((value) => !Number.isNaN(value))).toBe(16);
      expect(tema.findIndex((value) => !Number.isNaN(value))).toBe(24);
    });

    it('stay on a flat price', () => {
      const flat = closesOnly(Array<number>(30).fill(50));
      expect(compute('DEMA', flat).dema?.slice(16)).toEqual(Array<number>(14).fill(50));
      expect(compute('TEMA', flat).tema?.slice(24)).toEqual(Array<number>(6).fill(50));
    });

    it.each(DATA)('match the reference on %s', (_name, bars) => {
      const closes = field(bars, 'close');
      expectClose(compute('DEMA', bars).dema ?? [], referenceDema(closes, 9), 6);
      expectClose(compute('TEMA', bars).tema ?? [], referenceTema(closes, 9), 6);
      expectClose(compute('TEMA', bars, { period: 30 }).tema ?? [], referenceTema(closes, 30), 6);
    });
  });

  describe('LSMA', () => {
    it('lies on a straight line, read back or ahead by the offset', () => {
      // Closes 10, 12, 14, …: the line is the price itself; offset 2 reads it two bars back, -1
      // one bar ahead.
      const bars = closesOnly([10, 12, 14, 16, 18]);
      expectClose(compute('LSMA', bars, { period: 3 }).lsma ?? [], [N, N, 14, 16, 18]);
      expectClose(compute('LSMA', bars, { period: 3, offset: 2 }).lsma ?? [], [N, N, 10, 12, 14]);
      expectClose(compute('LSMA', bars, { period: 3, offset: -1 }).lsma ?? [], [N, N, 16, 18, 20]);
    });

    it('fits the least squares line through scattered values', () => {
      // 1, 3, 2 at x = 0, 1, 2: slope 1/2, mean 2, so 2 + 1/2 at x = 2; then 3, 2, 6: slope 3/2,
      // mean 11/3, so 11/3 + 3/2.
      const bars = closesOnly([1, 3, 2, 6]);
      expectClose(compute('LSMA', bars, { period: 3 }).lsma ?? [], [N, N, 2.5, 11 / 3 + 1.5]);
      // Flat values lie on a flat line.
      expectClose(compute('LSMA', closesOnly([7, 7, 7]), { period: 2 }).lsma ?? [], [N, 7, 7]);
    });

    it.each(DATA)('matches the normal equations on %s', (_name, bars) => {
      const closes = field(bars, 'close');
      expectClose(compute('LSMA', bars).lsma ?? [], referenceLinreg(closes, 25, 0), 6);
      expectClose(
        compute('LSMA', bars, { period: 50, offset: 5 }).lsma ?? [],
        referenceLinreg(closes, 50, 5),
        5
      );
    });
  });

  describe('MCGINLEY', () => {
    it('starts from the simple average and follows the price faster the further it runs', () => {
      // Period 2: 11 on bar 1, then 11 + (15 - 11) / (2 * (15 / 11)^4).
      const second = 11 + 4 / (2 * (15 / 11) ** 4);
      const third = second + (9 - second) / (2 * (9 / second) ** 4);
      expectClose(compute('MCGINLEY', closesOnly([10, 12, 15, 9]), { period: 2 }).mcginley ?? [], [
        N,
        11,
        second,
        third
      ]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      const closes = field(bars, 'close');
      expectClose(compute('MCGINLEY', bars).mcginley ?? [], referenceMcGinley(closes, 14), 6);
    });
  });

  describe('RIBBON', () => {
    it('draws SMAs of 20, 50, 100 and 200 by default', () => {
      const bars = walk(400);
      const closes = field(bars, 'close');
      const values = compute('RIBBON', bars);
      expectClose(values.ma1 ?? [], sma(closes, 20), 9);
      expectClose(values.ma2 ?? [], sma(closes, 50), 9);
      expectClose(values.ma3 ?? [], sma(closes, 100), 9);
      expectClose(values.ma4 ?? [], sma(closes, 200), 9);
    });

    it.each(DATA)('takes the type and length of each line on %s', (_name, bars) => {
      const closes = field(bars, 'close');
      const values = compute('RIBBON', bars, {
        maType1: 1,
        period1: 10,
        maType2: 2,
        period2: 15,
        maType3: 3,
        period3: 30,
        maType4: 4,
        period4: 40
      });
      expectClose(values.ma1 ?? [], ema(closes, 10), 6);
      expectClose(values.ma2 ?? [], rma(closes, 15), 6);
      expectClose(values.ma3 ?? [], wma(closes, 30), 6);
      expectClose(values.ma4 ?? [], referenceVwma(closes, field(bars, 'volume'), 40), 6);
    });
  });
});

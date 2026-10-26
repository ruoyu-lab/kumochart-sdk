import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, barsFromCloses, compute, expectClose, incrementalMatchesFull } from './helpers';
import { divide, ema, field, N, ref, rows, skippingNaN, sma, sum, walk, zip } from './reference';

type Bars = readonly Required<BarInput>[];

/** The walk and the real hourly and daily bars of BTCUSDT on Binance. */
const SAMPLES: [name: string, bars: Bars][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT 1h', BTCUSDT['1h']],
  ['BTCUSDT 1d', BTCUSDT['1d']]
];

/** Equal `NaN`s, and values equal to 9 significant digits, as large totals of volume are. */
function expectSame(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] ?? N;

    if (Number.isNaN(target)) {
      expect(value, `index ${index}`).toBeNaN();
    } else {
      expect(Math.abs(value - target), `index ${index}: ${value} vs ${target}`).toBeLessThanOrEqual(
        1e-9 * Math.max(1, Math.abs(target))
      );
    }
  });
}

// ─── References, from the published formulas ───────────────────────────────

/** The running total, a missing value adding nothing. */
function cumulative(values: readonly number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += Number.isNaN(value) ? 0 : value;
    return total;
  });
}

/** `(2C - L - H) / (H - L) * V`, 0 without a range. */
function moneyFlowVolumes(bars: Bars): number[] {
  return bars.map(({ high, low, close, volume }) =>
    high === low ? 0 : ((2 * close - low - high) / (high - low)) * volume
  );
}

function accumulation(bars: Bars): number[] {
  return cumulative(moneyFlowVolumes(bars));
}

function chaikin(bars: Bars, fast: number, slow: number): number[] {
  const line = accumulation(bars);
  return zip([ema(line, fast), ema(line, slow)], (a, b) => a - b);
}

function volumeOscillator(bars: Bars, short: number, long: number): number[] {
  const volumes = field(bars, 'volume');
  return zip([ema(volumes, short), ema(volumes, long)], (a, b) => divide(a - b, b) * 100);
}

function force(bars: Bars, period: number): number[] {
  const closes = field(bars, 'close');
  const forces = zip([closes, ref(closes, 1), field(bars, 'volume')], (c, p, v) => (c - p) * v);
  return skippingNaN(forces, (values) => ema(values, period));
}

function klinger(bars: Bars, fast: number, slow: number, signal: number): number[][] {
  const typicals = bars.map(({ high, low, close }) => (high + low + close) / 3);
  // `na >= 0` is false: the first bar counts its volume as negative.
  const signed = bars.map((bar, index) =>
    index > 0 && (typicals[index] ?? N) - (typicals[index - 1] ?? N) >= 0 ? bar.volume : -bar.volume
  );
  const line = zip([ema(signed, fast), ema(signed, slow)], (a, b) => a - b);
  return [line, skippingNaN(line, (values) => ema(values, signal))];
}

function priceVolumeTrend(bars: Bars): number[] {
  const closes = field(bars, 'close');
  return cumulative(
    zip([closes, ref(closes, 1), field(bars, 'volume')], (c, p, v) => divide(c - p, p) * v)
  );
}

/** `WVAD = SUM((C - O) / (H - L) * VOL, N) / 10000`, `MAWVAD = MA(WVAD, M)`. */
function wvad(bars: Bars, period: number, signal: number): number[][] {
  const flows = bars.map(({ open, high, low, close, volume }) =>
    high === low ? 0 : ((close - open) / (high - low)) * volume
  );
  const line = sum(flows, period).map((total) => total / 10000);
  return [line, sma(line, signal)];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('volume flow indicators', () => {
  // Closes at the top (+100), a bar without range (0), a quarter up (-100), at the top (+50).
  const flows = rows([
    [10, 12, 10, 12, 100],
    [11, 11, 11, 11, 300],
    [11, 12, 8, 9, 200],
    [9, 10, 8, 10, 50]
  ]);

  describe('AD', () => {
    it('adds up the volume weighted by where each close lies in its range', () => {
      expectClose(compute('AD', flows).accumulationDistribution ?? [], [100, 100, 0, 50]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectSame(compute('AD', bars).accumulationDistribution ?? [], accumulation(bars));
    });
  });

  describe('CHAIKINOSC', () => {
    it('subtracts the slow EMA of the A/D line from the fast one, each seeded with its mean', () => {
      // EMA(2) of 100, 100, 0, 50: 100 (the mean), then 2/3 * 0 + 1/3 * 100 = 100/3, then
      // 2/3 * 50 + 1/3 * 100/3 = 400/9.
      const values = compute('CHAIKINOSC', flows, { fast: 1, slow: 2 }).chaikinOscillator ?? [];
      expectClose(values, [N, 0, -100 / 3, 50 / 9]);
    });

    it('starts on bar slow - 1', () => {
      const values = compute('CHAIKINOSC', walk(20)).chaikinOscillator ?? [];
      expect(values.findIndex((value) => !Number.isNaN(value))).toBe(9);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectSame(compute('CHAIKINOSC', bars).chaikinOscillator ?? [], chaikin(bars, 3, 10));
    });
  });

  describe('VO', () => {
    it('compares the short EMA of the volume with the long one, in percent', () => {
      // EMA(2) of 100, 200, 300, 400: 150, then 250 and 350.
      const bars = barsFromCloses([1, 1, 1, 1], [100, 200, 300, 400]);
      const values = compute('VO', bars, { short: 1, long: 2 }).volumeOsc ?? [];
      expectClose(values, [N, 100 / 3, 20, 100 / 7]);
    });

    it('is undefined while no volume traded', () => {
      const bars = barsFromCloses([1, 1, 1], [0, 0, 0]);
      expectClose(compute('VO', bars, { short: 1, long: 2 }).volumeOsc ?? [], [N, N, N]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectSame(compute('VO', bars).volumeOsc ?? [], volumeOscillator(bars, 5, 10));
    });
  });

  describe('EFI', () => {
    it('smooths the change of the close times the volume, from bar `period`', () => {
      // Forces 200, 0, -400, 1000; EMA(2): the mean 100, then -700/3, then 5300/9.
      const bars = barsFromCloses([10, 11, 11, 10, 12], [100, 200, 300, 400, 500]);
      const values = compute('EFI', bars, { period: 2 }).elderForceIndex ?? [];
      expectClose(values, [N, N, 100, -700 / 3, 5300 / 9]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectSame(compute('EFI', bars).elderForceIndex ?? [], force(bars, 13));
    });
  });

  describe('KVO', () => {
    it('counts the volume of the first bar, which has no change, as negative', () => {
      // Typical prices 10, 11, 11, 10: volumes -100, +200, +300 (unchanged), -400. EMA(2) of
      // them: 50, 650/3, -1750/9. KVO: 150, 250/3, -1850/9; its EMA(2): 350/3, then -2650/27.
      const bars = barsFrom([
        [11, 9, 10, 100],
        [12, 10, 11, 200],
        [12, 10, 11, 300],
        [11, 9, 10, 400]
      ]);
      const values = compute('KVO', bars, { fast: 1, slow: 2, signal: 2 });
      expectClose(values.klingerOscillator ?? [], [N, 150, 250 / 3, -1850 / 9]);
      expectClose(values.signalLine ?? [], [N, N, 350 / 3, -2650 / 27]);
    });

    it('starts on bar 54, its signal line on bar 66', () => {
      const values = compute('KVO', walk(80));
      const first = (key: string) => values[key]?.findIndex((value) => !Number.isNaN(value));
      expect([first('klingerOscillator'), first('signalLine')]).toEqual([54, 66]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      const [line = [], signal = []] = klinger(bars, 34, 55, 13);
      const values = compute('KVO', bars);
      expectSame(values.klingerOscillator ?? [], line);
      expectSame(values.signalLine ?? [], signal);
    });
  });

  describe('PVT', () => {
    it('adds up the volume times the relative change of the close, from 0', () => {
      // +1/10 * 200, 0, -1/11 * 400, +2/10 * 500.
      const bars = barsFromCloses([10, 11, 11, 10, 12], [100, 200, 300, 400, 500]);
      expectClose(compute('PVT', bars).pvt ?? [], [0, 20, 20, 20 - 400 / 11, 120 - 400 / 11]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      expectSame(compute('PVT', bars).pvt ?? [], priceVolumeTrend(bars));
    });
  });

  describe('WVAD', () => {
    it('sums the body within the range times the volume, a flat bar adding 0', () => {
      // (C - O) / (H - L) * VOL: 1000/3, 0 (no range), -1000, 2000.
      const bars = rows([
        [10, 12, 9, 11, 1000],
        [11, 11, 11, 11, 500],
        [11, 13, 10, 10, 3000],
        [10, 12, 10, 12, 2000]
      ]);
      const values = compute('WVAD', bars, { period: 2, signal: 2 });
      expectClose(values.wvad ?? [], [N, 1 / 30, -0.1, 0.1], 9);
      expectClose(values.mawvad ?? [], [N, N, -1 / 30, 0], 9);
    });

    it('has the defaults 24 and 6', () => {
      const values = compute('WVAD', walk(40));
      const first = (key: string) => values[key]?.findIndex((value) => !Number.isNaN(value));
      expect([first('wvad'), first('mawvad')]).toEqual([23, 28]);
    });

    it.each(SAMPLES)('matches the reference on %s', (_name, bars) => {
      const [line = [], average = []] = wvad(bars, 24, 6);
      const values = compute('WVAD', bars);
      expectSame(values.wvad ?? [], line);
      expectSame(values.mawvad ?? [], average);
    });
  });

  it.each(['AD', 'CHAIKINOSC', 'VO', 'EFI', 'KVO', 'PVT', 'WVAD'])(
    '%s gives the same values bar by bar on real bars',
    (type) => {
      const { full, incremental } = incrementalMatchesFull(type, BTCUSDT['1d']);

      for (const [key, values] of Object.entries(full)) {
        expectSame(incremental[key] ?? [], values);
      }
    }
  );
});

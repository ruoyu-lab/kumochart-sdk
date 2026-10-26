import { describe, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, compute, expectClose } from './helpers';
import {
  chineseEma,
  closesOnly,
  ema,
  field,
  highest,
  lowest,
  N,
  ref,
  sma,
  walk,
  zip
} from './reference';

// Reference implementations written from the published formulas over whole arrays, independent of
// the streams.

/** The MIKE lines in the order STOR, MIDR, WEKR, WEKS, MIDS, STOS. */
function referenceMike(bars: readonly Required<BarInput>[], period: number): number[][] {
  const highs = field(bars, 'high');
  const lows = field(bars, 'low');
  const typical = zip(
    [highs, lows, field(bars, 'close')],
    (high, low, close) => (high + low + close) / 3
  );
  const hlc = ref(sma(typical, period), 1);
  const hv = chineseEma(highest(highs, period), 3);
  const lv = chineseEma(lowest(lows, period), 3);
  const line = (combine: (hlc: number, hv: number, lv: number) => number) =>
    emaSkipping(zip([hlc, hv, lv], combine), 3);
  return [
    line((_c, h, l) => 2 * h - l),
    line((c, h, l) => c + h - l),
    line((c, _h, l) => c * 2 - l),
    line((c, h) => c * 2 - h),
    line((c, h, l) => c - h + l),
    line((_c, h, l) => 2 * l - h)
  ];
}

/** `EMA(X, N)` of Chinese charting software over the values from the first defined one. */
function emaSkipping(values: readonly number[], period: number): number[] {
  const start = values.findIndex((value) => !Number.isNaN(value));
  return start < 0
    ? values.map(() => N)
    : [...values.slice(0, start), ...chineseEma(values.slice(start), period)];
}

const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT daily', BTCUSDT['1d']],
  ['BTCUSDT hourly', BTCUSDT['1h']]
];

describe('envelopes', () => {
  describe('ENVELOPE', () => {
    it('puts lines a percentage above and below a simple or exponential average', () => {
      // SMA(2) of 10, 12, 15: 11, 13.5; EMA(2): 11, then 2/3 * 15 + 1/3 * 11.
      const bars = closesOnly([10, 12, 15]);
      const simple = compute('ENVELOPE', bars, { period: 2 });
      expectClose(simple.basis ?? [], [N, 11, 13.5]);
      expectClose(simple.upper ?? [], [N, 12.1, 14.85]);
      expectClose(simple.lower ?? [], [N, 9.9, 12.15]);
      const exponential = compute('ENVELOPE', bars, { period: 2, percent: 50, exponential: 1 });
      expectClose(exponential.basis ?? [], [N, 11, 41 / 3]);
      expectClose(exponential.upper ?? [], [N, 16.5, 41 / 2]);
      expectClose(exponential.lower ?? [], [N, 5.5, 41 / 6]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      const closes = field(bars, 'close');
      const basis = sma(closes, 20);
      const values = compute('ENVELOPE', bars);
      expectClose(values.basis ?? [], basis, 6);
      expectClose(
        values.upper ?? [],
        basis.map((value) => value * 1.1),
        6
      );
      expectClose(
        values.lower ?? [],
        basis.map((value) => value * 0.9),
        6
      );
      const exponential = ema(closes, 30);
      const curved = compute('ENVELOPE', bars, { period: 30, percent: 2.5, exponential: 1 });
      expectClose(curved.basis ?? [], exponential, 6);
      expectClose(
        curved.lower ?? [],
        exponential.map((value) => value * 0.975),
        6
      );
    });
  });

  describe('MIKE', () => {
    it('follows the formula of Chinese charting software', () => {
      // N = 2. Typical prices 9, 32/3, 35/3, 31/3; their MA(2) the bar before: 59/6, 67/6.
      // HHV(H, 2): 12, 13, 13 and LLV(L, 2): 8, 9, 9 from bar 1, through EMA(X, 3) from the
      // first X: HV 12, 12.5, 12.75 and LV 8, 8.5, 8.75.
      // STOR = EMA(2HV - LV): 16, 16.25, 16.5; STOS = EMA(2LV - HV): 4, 4.25, 4.5.
      // MIDR = EMA(HLC + HV - LV) from bar 2: 83/6, then (91/6 + 83/6) / 2 = 14.5.
      // WEKR = EMA(2HLC - LV): 67/6, then (163/12 + 67/6) / 2; WEKS = EMA(2HLC - HV): 43/6, then
      // (115/12 + 43/6) / 2; MIDS = EMA(HLC - HV + LV): 35/6, then 6.5.
      const bars = barsFrom([
        [10, 8, 9],
        [12, 9, 11],
        [13, 10, 12],
        [12, 9, 10]
      ]);
      const values = compute('MIKE', bars, { period: 2 });
      expectClose(values.stor ?? [], [N, 16, 16.25, 16.5]);
      expectClose(values.midr ?? [], [N, N, 83 / 6, 14.5]);
      expectClose(values.wekr ?? [], [N, N, 67 / 6, (163 / 12 + 67 / 6) / 2]);
      expectClose(values.weks ?? [], [N, N, 43 / 6, (115 / 12 + 43 / 6) / 2]);
      expectClose(values.mids ?? [], [N, N, 35 / 6, 6.5]);
      expectClose(values.stos ?? [], [N, 4, 4.25, 4.5]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      for (const period of [10, 26]) {
        const values = compute('MIKE', bars, { period });
        const expected = referenceMike(bars, period);
        ['stor', 'midr', 'wekr', 'weks', 'mids', 'stos'].forEach((key, index) => {
          expectClose(values[key] ?? [], expected[index] ?? [], 6);
        });
      }
    });
  });
});

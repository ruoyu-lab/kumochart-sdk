import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { crShift } from '../../src/indicators/definitions/strength';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, compute, expectClose } from './helpers';
import { divide, N, ref, rows, sma, sum, walk, zip } from './reference';

/** Bars to compare with the references: a random walk and real BTCUSDT days and hours. */
const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT days', BTCUSDT['1d']],
  ['BTCUSDT hours', BTCUSDT['1h']]
];

/**
 * Asserts that `actual` is `NaN` exactly where `expected` is, and elsewhere equal to nine
 * significant digits, as real prices make values of any size.
 */
function expectSame(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  const wrong = expected.flatMap((target, index) => {
    const value = actual?.[index] ?? N;
    const same = Number.isNaN(target)
      ? Number.isNaN(value)
      : Math.abs(value - target) <= 1e-9 * Math.max(1, Math.abs(target));
    return same ? [] : [`${String(index)}: ${String(value)} ≠ ${String(target)}`];
  });
  expect(wrong).toEqual([]);
  expect(expected.some((value) => !Number.isNaN(value))).toBe(true);
}

describe.each(DATA)('ASI and CR on %s', (_name, bars) => {
  const O = bars.map((bar) => bar.open);
  const H = bars.map((bar) => bar.high);
  const L = bars.map((bar) => bar.low);
  const C = bars.map((bar) => bar.close);

  it('ASI sums the swing index of 26 bars, ASIT averages it over 10', () => {
    // The formula of Chinese charting software, line by line.
    const LC = ref(C, 1);
    const AA = zip([H, LC], (high, close) => Math.abs(high - close));
    const BB = zip([L, LC], (low, close) => Math.abs(low - close));
    const CC = zip([H, ref(L, 1)], (high, low) => Math.abs(high - low));
    const DD = zip([LC, ref(O, 1)], (close, open) => Math.abs(close - open));
    const R = zip([AA, BB, CC, DD], (aa, bb, cc, dd) =>
      aa > bb && aa > cc
        ? aa + bb / 2 + dd / 4
        : bb > cc && bb > aa
          ? bb + aa / 2 + dd / 4
          : cc + dd / 4
    );
    const X = zip(
      [C, LC, O, ref(O, 1)],
      (close, lc, open, open1) => close - lc + (close - open) / 2 + lc - open1
    );
    const SI = zip([X, R, AA, BB], (x, r, aa, bb) =>
      r === 0 ? 0 : divide(16 * x, r) * Math.max(aa, bb)
    );
    const asi = sum(SI, 26);
    const values = compute('ASI', bars);
    expectSame(values.asi, asi);
    expectSame(values.asit, sma(asi, 10));
  });

  it('CR compares the highs and lows with the previous middle, its averages shifted back', () => {
    const MID = ref(
      zip([H, L], (high, low) => high + low),
      1
    ).map((total) => total / 2);
    const cr = zip(
      [
        sum(
          zip([H, MID], (high, mid) => Math.max(0, high - mid)),
          26
        ),
        sum(
          zip([MID, L], (mid, low) => Math.max(0, mid - low)),
          26
        )
      ],
      (above, below) => divide(above, below) * 100
    );
    const values = compute('CR', bars);
    expectSame(values.cr, cr);
    // REF(MA(CR, M), M / 2.5 + 1): 5, 9, 17 and 25.8 bars, the last cut to 25.
    expectSame(values.ma10, ref(sma(cr, 10), 5));
    expectSame(values.ma20, ref(sma(cr, 20), 9));
    expectSame(values.ma40, ref(sma(cr, 40), 17));
    expectSame(values.ma62, ref(sma(cr, 62), 25));
  });
});

describe('ASI and CR by hand', () => {
  it('takes the swing of each bar against the one before', () => {
    // Bar 1: AA 2, BB 0.5, CC 3, DD 0 → R = CC + DD / 4 = 3; X = 1.5 + 0.75; SI = 12 * 2 = 24.
    // Bar 2: AA 0.5, BB 1.5, CC 2.5, DD 1.5 → R = 2.875; X = -1 - 0.5 + 1.5 = 0; SI = 0.
    // Bar 3, a gap down: AA 1.1, BB 2.5, CC 0.6, DD 1 → R = BB + AA / 2 + DD / 4 = 3.3;
    // X = -2 - 0.25 - 1 = -3.25; SI = 16 * -3.25 / 3.3 * 2.5 = -1300/33.
    const bars = rows([
      [10, 11, 9, 10],
      [10, 12, 9.5, 11.5],
      [11.5, 12, 10, 10.5],
      [9, 9.4, 8, 8.5]
    ]);
    const values = compute('ASI', bars, { period: 1, signal: 2 });
    expectClose(values.asi ?? [], [N, 24, 0, -1300 / 33]);
    expectClose(values.asit ?? [], [N, N, 12, (0 - 1300 / 33) / 2]);
    // Sums of two start on bar 2.
    expectClose(compute('ASI', bars, { period: 2, signal: 1 }).asi ?? [], [N, N, 24, -1300 / 33]);
  });

  it('swings 0 where the bar and the one before never moved', () => {
    const flat = rows([
      [10, 10, 10, 10],
      [10, 10, 10, 10],
      [10, 10, 10, 10],
      [10, 12, 9, 11]
    ]);
    // Bar 3: AA 2, BB 1, CC 2, DD 0 → R = CC + DD / 4 = 2; X = 1 + 0.5 = 1.5; SI = 12 * 2 = 24.
    expectClose(compute('ASI', flat, { period: 1, signal: 1 }).asi ?? [], [N, 0, 0, 24]);
    expectClose(compute('ASI', flat, { period: 3, signal: 1 }).asi ?? [], [N, N, N, 24]);
  });

  it('compares each high and low with the middle of the bar before for CR', () => {
    // Middles 10, 11, 11, 10.5. Above / below them from bar 1: 2 / 0, 0.5 / 0.5, 1 / 2,
    // 0.5 / 0.5 → CR(2) 500, 60, 60 from bar 2; MA(2) 280 on bar 4 is that of bar 3, a bar back.
    const bars = barsFrom([
      [11, 9, 10],
      [12, 10, 11],
      [11.5, 10.5, 11],
      [12, 9, 10],
      [11, 10, 10.5]
    ]);
    const values = compute('CR', bars, { period: 2, periods: [2, 1] });
    expectClose(values.cr ?? [], [N, N, 500, 60, 60]);
    expectClose(values.ma2 ?? [], [N, N, N, N, 280]);
    // MA(1) is CR itself, shifted by 1.4 bars, cut to 1.
    expectClose(values.ma1 ?? [], [N, N, N, 500, 60]);
  });

  it('cuts the fraction of the shift of each average of CR', () => {
    expect([10, 20, 40, 62, 1, 2, 3, 4].map(crShift)).toEqual([5, 9, 17, 25, 1, 1, 2, 2]);
  });

  it('has no CR while nothing went below the middles', () => {
    // Rising bars, each low above the middle of the one before.
    const bars = barsFrom([
      [11, 9, 10],
      [13, 11, 12],
      [15, 13, 14]
    ]);
    expectClose(compute('CR', bars, { period: 2, periods: [1] }).cr ?? [], [N, N, N]);
  });
});

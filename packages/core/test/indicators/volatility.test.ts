import { describe, it } from 'vitest';
import { barsFrom, barsFromCloses, compute, expectClose } from './helpers';
import { atr, divide, field, highest, lowest, N, sum, trueRanges, walk, zip } from './reference';

const bars = walk(400);
const highs = field(bars, 'high');
const lows = field(bars, 'low');

describe('volatility indicators', () => {
  it("smooths the true range into ATR, with Wilder's average seeded with the mean", () => {
    // TR: 2 (the first bar's high minus low), max(2, 2, 0) = 2, max(2, 4, 2) = 4, max(1, 2, 3) = 3.
    // RMA(3): (2 + 2 + 4) / 3 = 8/3, then (3 + 2 * 8/3) / 3 = 25/9.
    const few = barsFrom([
      [11, 9, 10],
      [12, 10, 11],
      [15, 13, 14],
      [12, 11, 11]
    ]);
    expectClose(compute('ATR', few, { period: 3 }).atr ?? [], [N, N, 8 / 3, 25 / 9]);
    // Smoothed by SMA, EMA (α = 1/2) or WMA instead.
    expectClose(compute('ATR', few, { period: 3, smoothing: 1 }).atr ?? [], [N, N, 8 / 3, 3]);
    expectClose(compute('ATR', few, { period: 3, smoothing: 2 }).atr ?? [], [N, N, 8 / 3, 17 / 6]);
    expectClose(compute('ATR', few, { period: 3, smoothing: 3 }).atr ?? [], [N, N, 3, 19 / 6]);
    expectClose(compute('ATR', bars).atr ?? [], atr(bars, 14), 9);
  });

  it('computes STD as a population standard deviation', () => {
    // Pairs (1, 3), (3, 3), (3, 7) → half the difference.
    const values = compute('STD', barsFromCloses([1, 3, 3, 7]), { period: 2 });
    expectClose(values.std ?? [], [N, 1, 0, 2]);
  });

  it('computes the choppiness index from the true ranges and the range', () => {
    const expected = zip(
      [sum(trueRanges(bars), 14), highest(highs, 14), lowest(lows, 14)],
      (total, high, low) => (100 * Math.log10(divide(total, high - low))) / Math.log10(14)
    );
    expectClose(compute('CHOP', bars).chop ?? [], expected, 9);
  });
});

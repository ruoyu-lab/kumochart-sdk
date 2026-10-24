import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { barsFrom, compute, expectClose } from './helpers';
import { N, walk } from './reference';

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`No value at ${index}.`);
  }

  return value;
}

// Reference implementations written bar by bar over whole arrays, reading the values of earlier
// bars by index, independent of the streams.

/** The ATR: RMA of the true range, seeded with the SMA of the first `period` ranges. */
function referenceAtr(bars: readonly Required<BarInput>[], period: number): number[] {
  const ranges = bars.map((bar, index) => {
    const previous = bars[index - 1];
    return previous
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      : bar.high - bar.low;
  });
  return referenceAverage(ranges, period, 1 / period);
}

/** The EMA or RMA, by `alpha`: seeded with the SMA of the first `period` values. */
function referenceAverage(values: readonly number[], period: number, alpha: number): number[] {
  const result: number[] = [];
  values.forEach((value, index) => {
    const previous = result[index - 1] ?? N;
    result.push(
      !Number.isNaN(previous)
        ? alpha * value + (1 - alpha) * previous
        : index >= period - 1
          ? values.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item, 0) /
            period
          : N
    );
  });
  return result;
}

/** Wilder's parabolic stop and reverse, written out bar by bar. */
function referenceSar(
  bars: readonly Required<BarInput>[],
  start: number,
  increment: number,
  maximum: number
): number[] {
  let result = N;
  let maxMin = N;
  let acceleration = N;
  let isBelow = false;

  return bars.map((bar, index) => {
    let isFirstTrendBar = false;

    if (index === 1) {
      const previous = at(bars, 0);

      if (bar.close > previous.close) {
        isBelow = true;
        maxMin = bar.high;
        result = previous.low;
      } else {
        isBelow = false;
        maxMin = bar.low;
        result = previous.high;
      }

      isFirstTrendBar = true;
      acceleration = start;
    }

    result = result + acceleration * (maxMin - result);

    if (isBelow) {
      if (result > bar.low) {
        isFirstTrendBar = true;
        isBelow = false;
        result = Math.max(bar.high, maxMin);
        maxMin = bar.low;
        acceleration = start;
      }
    } else if (result < bar.high) {
      isFirstTrendBar = true;
      isBelow = true;
      result = Math.min(bar.low, maxMin);
      maxMin = bar.high;
      acceleration = start;
    }

    if (!isFirstTrendBar) {
      if (isBelow) {
        if (bar.high > maxMin) {
          maxMin = bar.high;
          acceleration = Math.min(acceleration + increment, maximum);
        }
      } else if (bar.low < maxMin) {
        maxMin = bar.low;
        acceleration = Math.min(acceleration + increment, maximum);
      }
    }

    const back1 = bars[index - 1];
    const back2 = bars[index - 2];

    if (isBelow) {
      result = Math.min(result, back1?.low ?? N);

      if (index > 1) {
        result = Math.min(result, back2?.low ?? N);
      }
    } else {
      result = Math.max(result, back1?.high ?? N);

      if (index > 1) {
        result = Math.max(result, back2?.high ?? N);
      }
    }

    return result;
  });
}

/** SuperTrend and its up and down lines, which skip the first bar. */
function referenceSuperTrend(
  bars: readonly Required<BarInput>[],
  factor: number,
  period: number
): { up: number[]; down: number[] } {
  const atr = referenceAtr(bars, period);
  const orZero = (value: number | undefined) =>
    value === undefined || Number.isNaN(value) ? 0 : value;
  const upperBands: number[] = [];
  const lowerBands: number[] = [];
  const trends: number[] = [];
  const up: number[] = [];
  const down: number[] = [];

  bars.forEach((bar, index) => {
    const source = (bar.high + bar.low) / 2;
    const range = at(atr, index);
    let upperBand = source + factor * range;
    let lowerBand = source - factor * range;
    const prevLowerBand = orZero(lowerBands[index - 1]);
    const prevUpperBand = orZero(upperBands[index - 1]);
    const prevClose = bars[index - 1]?.close ?? N;
    lowerBand = lowerBand > prevLowerBand || prevClose < prevLowerBand ? lowerBand : prevLowerBand;
    upperBand = upperBand < prevUpperBand || prevClose > prevUpperBand ? upperBand : prevUpperBand;
    let direction: number;

    if (Number.isNaN(atr[index - 1] ?? N)) {
      direction = 1;
    } else if (trends[index - 1] === prevUpperBand) {
      direction = bar.close > upperBand ? -1 : 1;
    } else {
      direction = bar.close < lowerBand ? 1 : -1;
    }

    const trend = direction === -1 ? lowerBand : upperBand;
    upperBands.push(upperBand);
    lowerBands.push(lowerBand);
    trends.push(trend);
    up.push(index === 0 || direction > 0 ? N : trend);
    down.push(index === 0 || direction < 0 ? N : trend);
  });

  return { up, down };
}

/** How often a series turns between being defined and not. */
function turns(values: readonly number[]): number {
  return values.filter(
    (value, index) => index > 0 && Number.isNaN(value) !== Number.isNaN(values[index - 1] ?? N)
  ).length;
}

describe('stops and bands', () => {
  const bars = walk(400);

  describe('SAR', () => {
    it('starts, accelerates up to the maximum, stays outside two bars and reverses', () => {
      // start 0.1, increment 0.1, maximum 0.3.
      // Bar 1 closes higher: rising from the low of bar 0, 9, toward the high 11:
      //   9 + 0.1 * 2 = 9.2, held under the previous low 9 → 9.
      // Bar 2: 9.2, held under the low of two bars back (9) → 9; new high 12, factor 0.2.
      // Bar 3: 9 + 0.2 * 3 = 9.6; new high 13, factor 0.3.
      // Bar 4: 9.6 + 0.3 * 3.4 = 10.62; new high 14, factor stays 0.3.
      // Bar 5: 10.62 + 0.3 * 3.38 = 11.634 > low 10: reverses to max(high, extreme) = 14,
      //   extreme 10, factor 0.1.
      // Bar 6: 14 - 0.1 * 4 = 13.6, held over the high of two bars back (14) → 14; low 9, 0.2.
      // Bar 7: 14 - 0.2 * 5 = 13, held over the high of bar 5 (13.5) → 13.5; low 8, 0.3.
      // Bar 8: 13.5 - 0.3 * 5.5 = 11.85 < high 14: reverses to min(low, extreme) = 8.
      const rows: [number, number, number][] = [
        [10, 9, 9.5],
        [11, 10, 10.5],
        [12, 11, 11.5],
        [13, 12, 12.5],
        [14, 13, 13.5],
        [13.5, 10, 10.5],
        [12, 9, 9.5],
        [11, 8, 8.5],
        [14, 12, 13.8]
      ];
      const values = compute('SAR', barsFrom(rows), { start: 0.1, increment: 0.1, maximum: 0.3 });
      expectClose(values.parabolicSar ?? [], [N, 9, 9, 9.6, 10.62, 14, 14, 13.5, 8]);
    });

    it('starts falling from the first high when the second close is not higher', () => {
      // 11 - 0.02 * (11 - 9) = 10.96, held over the previous high 11 → 11.
      const values = compute(
        'SAR',
        barsFrom([
          [11, 9, 10],
          [10.5, 9, 10]
        ])
      );
      expectClose(values.parabolicSar ?? [], [N, 11]);
    });

    it('matches the reference through many reversals', () => {
      const expected = referenceSar(bars, 0.02, 0.02, 0.2);
      expectClose(compute('SAR', bars).parabolicSar ?? [], expected, 9);
      const rising = expected.map((value, index) => (value < at(bars, index).low ? 1 : Number.NaN));
      expect(turns(rising)).toBeGreaterThan(20);
    });
  });

  describe('SUPERTREND', () => {
    it('follows a band that only tightens and turns when the close crosses it', () => {
      // ATR 2 (RMA from the SMA of 2 ranges: 2, 2.5, 2.25, 2.875, 2.4375), factor 1, hl2 ± ATR.
      // Bar 1: the ATR has no previous value, so the trend is down at the upper band 11 + 2 = 13.
      // Bar 2: upper 15.5 does not tighten 13; the close 13.5 crosses 13: up at 13 - 2.5 = 10.5.
      // Bar 3: lower 14 - 2.25 = 11.75 tightens 10.5: up at 11.75.
      // Bar 4: lower 9.625 cannot loosen 11.75; the close 11.5 crosses it: down at the upper
      //   band 12.5 + 2.875 = 15.375.
      // Bar 5: upper 11 + 2.4375 tightens 15.375: down at 13.4375.
      const rows: [number, number, number][] = [
        [11, 9, 10],
        [12, 10, 11],
        [14, 12, 13.5],
        [15, 13, 14.5],
        [14, 11, 11.5],
        [12, 10, 10.5]
      ];
      const values = compute('SUPERTREND', barsFrom(rows), { period: 2, multiplier: 1 });
      // Each trend is a line of its own: nothing joins 13 to 10.5 or 11.75 to 15.375.
      expectClose(values.upTrend ?? [], [N, N, 10.5, 11.75, N, N]);
      expectClose(values.downTrend ?? [], [N, 13, N, N, 15.375, 13.4375]);
      // The middle of the bodies the trend lines are shaded to, from the second bar.
      expectClose(values.bodyMiddle ?? [], [N, 11, 13.5, 14.5, 11.5, 10.5]);
    });

    it('has its first value, a downtrend, once the ATR has one', () => {
      const values = compute('SUPERTREND', bars.slice(0, 12));
      expect(values.downTrend?.slice(0, 10).map(Number.isNaN)).toEqual([
        ...Array<boolean>(9).fill(true),
        false
      ]);
      expect(values.upTrend?.slice(0, 10).every(Number.isNaN)).toBe(true);
    });

    it.each([
      [3, 10, 4],
      [1, 5, 20]
    ])('matches the reference with factor %d and ATR %d', (multiplier, period, minTurns) => {
      const expected = referenceSuperTrend(bars, multiplier, period);
      const values = compute('SUPERTREND', bars, { period, multiplier });
      expectClose(values.upTrend ?? [], expected.up, 9);
      expectClose(values.downTrend ?? [], expected.down, 9);
      expect(turns(expected.up)).toBeGreaterThanOrEqual(minTurns);
    });
  });

  describe('KC', () => {
    it('puts ATR bands around an EMA seeded with its SMA', () => {
      // Ranges 2 (high - low on the first bar), 2, 4, 3 → ATR(2): 2, 3, 3.
      // EMA(3) of 10, 11, 14, 11: the SMA 35/3, then (11 + 35/3) / 2 = 34/3.
      const bars4 = barsFrom([
        [11, 9, 10],
        [12, 10, 11],
        [15, 13, 14],
        [12, 11, 11]
      ]);
      const values = compute('KC', bars4, { period: 3, multiplier: 2, atrPeriod: 2 });
      expectClose(values.basis ?? [], [N, N, 35 / 3, 34 / 3]);
      expectClose(values.upper ?? [], [N, N, 35 / 3 + 6, 34 / 3 + 6]);
      expectClose(values.lower ?? [], [N, N, 35 / 3 - 6, 34 / 3 - 6]);
    });

    it('takes an SMA, the true range or the average range when picked', () => {
      const bars4 = barsFrom([
        [11, 9, 10],
        [12, 10, 11],
        [15, 13, 14],
        [12, 11, 11]
      ]);
      // The SMA of 10, 11, 14 and of 11, 14, 11; the true ranges 4 and 3.
      const simple = compute('KC', bars4, {
        period: 3,
        multiplier: 1,
        exponential: 0,
        bandStyle: 1
      });
      expectClose(simple.basis ?? [], [N, N, 35 / 3, 12]);
      expectClose(simple.upper ?? [], [N, N, 35 / 3 + 4, 15]);
      // The RMA over 3 bars of the ranges 2, 2, 2, 1: 2, then (1 + 2 * 2) / 3.
      const ranged = compute('KC', bars4, { period: 3, multiplier: 1, bandStyle: 2 });
      expectClose(ranged.upper ?? [], [N, N, 35 / 3 + 2, 34 / 3 + 5 / 3]);
    });

    it('matches the reference with the default parameters', () => {
      const mid = referenceAverage(
        bars.map((bar) => bar.close),
        20,
        2 / 21
      );
      const atr = referenceAtr(bars, 10);
      const values = compute('KC', bars);
      expectClose(values.basis ?? [], mid, 9);
      expectClose(
        values.upper ?? [],
        mid.map((value, index) => value + 2 * at(atr, index)),
        9
      );
      expectClose(
        values.lower ?? [],
        mid.map((value, index) => value - 2 * at(atr, index)),
        9
      );
    });
  });

  it('computes DC from the highest high and the lowest low', () => {
    // Highs 10, 11, 12, 13 and lows 8, 9, 10, 9 over 3 bars.
    const values = compute(
      'DC',
      barsFrom([
        [10, 8, 9],
        [11, 9, 10],
        [12, 10, 11],
        [13, 9, 9]
      ]),
      { period: 3 }
    );
    expectClose(values.upper ?? [], [N, N, 12, 13]);
    expectClose(values.lower ?? [], [N, N, 8, 9]);
    expectClose(values.basis ?? [], [N, N, 10, 11]);
  });
});

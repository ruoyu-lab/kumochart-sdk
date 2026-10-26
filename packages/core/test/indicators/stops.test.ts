import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, compute, expectClose, FLAT } from './helpers';
import { atr, divide, field, highest, lowest, N, sum, trueRanges, walk, zip } from './reference';

// Reference implementations written from the published formulas over whole arrays, independent of
// the streams.

/**
 * The volatility stop of the close: the trailing stop and whether the trend is up, bar by bar.
 * The true range without a previous close is undefined; it stands in for the ATR while that warms
 * up.
 */
function referenceVolatilityStop(
  bars: readonly Required<BarInput>[],
  length: number,
  factor: number
): { up: number[]; down: number[] } {
  const ranges = atr(bars, length);
  const up: number[] = [];
  const down: number[] = [];
  let max = N;
  let min = N;
  let uptrend = true;
  let stop = N;

  bars.forEach((bar, index) => {
    const previous = bars[index - 1];
    const range = previous
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      : N;
    const scaled = (ranges[index] ?? N) * factor;
    const offset = Number.isNaN(scaled) ? range : scaled;
    const source = bar.close;
    max = index === 0 ? source : Math.max(max, source);
    min = index === 0 ? source : Math.min(min, source);
    const trailed = uptrend ? Math.max(stop, max - offset) : Math.min(stop, min + offset);
    stop = Number.isNaN(trailed) ? source : trailed;
    const turned = source - stop >= 0;

    if (turned !== uptrend) {
      max = source;
      min = source;
      stop = turned ? max - offset : min + offset;
    }

    uptrend = turned;
    up.push(uptrend ? stop : N);
    down.push(uptrend ? N : stop);
  });

  return { up, down };
}

/** The Chande Kroll stops. */
function referenceChandeKroll(
  bars: readonly Required<BarInput>[],
  p: number,
  x: number,
  q: number
): { long: number[]; short: number[] } {
  const range = atr(bars, p);
  const firstHigh = zip(
    [highest(field(bars, 'high'), p), range],
    (high, value) => high - x * value
  );
  const firstLow = zip([lowest(field(bars, 'low'), p), range], (low, value) => low + x * value);
  return { long: lowest(firstLow, q), short: highest(firstHigh, q) };
}

/** VI+ and VI-. */
function referenceVortex(
  bars: readonly Required<BarInput>[],
  period: number
): { plus: number[]; minus: number[] } {
  const upward = bars.map((bar, index) => Math.abs(bar.high - (bars[index - 1]?.low ?? N)));
  const downward = bars.map((bar, index) => Math.abs(bar.low - (bars[index - 1]?.high ?? N)));
  const range = sum(trueRanges(bars), period);
  return {
    plus: zip([sum(upward, period), range], divide),
    minus: zip([sum(downward, period), range], divide)
  };
}

const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT daily', BTCUSDT['1d']],
  ['BTCUSDT hourly', BTCUSDT['1h']]
];

describe('stops and the vortex', () => {
  describe('VSTOP', () => {
    it('trails the extreme by ATRs and turns when the price crosses it', () => {
      // Length 2, multiplier 1. True ranges 2, 2, 2, 3.5, 2; ATR(2) 2, 2, 2.75, 2.375 from bar 1.
      // Bar 0: the stop is the close, 10, in an uptrend. Bar 1: max(10, 11.5 - 2) = 10.
      // Bar 2: max(10, 12.5 - 2) = 10.5. Bar 3: max(10.5, 12.5 - 2.75) holds 10.5, the close
      // 9.5 is below it: down, from 9.5 + 2.75. Bar 4: min(12.25, 8.5 + 2.375).
      const bars = barsFrom([
        [11, 9, 10],
        [12, 10, 11.5],
        [13, 11, 12.5],
        [12.5, 9, 9.5],
        [10, 8, 8.5]
      ]);
      const values = compute('VSTOP', bars, { period: 2, multiplier: 1 });
      expectClose(values.upTrend ?? [], [10, 10, 10.5, N, N]);
      expectClose(values.downTrend ?? [], [N, N, N, 12.25, 10.875]);
    });

    it('takes the true range, unmultiplied, while the ATR warms up', () => {
      // Length 4, multiplier 3. Bar 2: the true range 0.2 under the highest close 14 lifts the
      // stop to 13.8 (three times it would leave 13.4). Bar 3: the ATR, (1 + 4.2 + 0.2 + 0.5) / 4,
      // times 3 is 4.425; the close 13.6 under 13.8 turns the trend down at 13.6 + 4.425.
      const bars = barsFrom([
        [10.5, 9.5, 10],
        [14.2, 10, 14],
        [14, 13.8, 13.9],
        [14, 13.5, 13.6]
      ]);
      const values = compute('VSTOP', bars, { period: 4, multiplier: 3 });
      expectClose(values.upTrend ?? [], [10, 10, 13.8, N]);
      expectClose(values.downTrend ?? [], [N, N, N, 18.025]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      for (const [period, multiplier] of [
        [20, 2],
        [5, 0.5]
      ] as const) {
        const values = compute('VSTOP', bars, { period, multiplier });
        const expected = referenceVolatilityStop(bars, period, multiplier);
        expectClose(values.upTrend ?? [], expected.up, 6);
        expectClose(values.downTrend ?? [], expected.down, 6);
        // The trend turns many times.
        const turns = expected.up.filter(
          (value, index) =>
            index > 0 && Number.isNaN(value) !== Number.isNaN(expected.up[index - 1])
        ).length;
        expect(turns).toBeGreaterThan(4);
      }
    });
  });

  describe('CKSTOP', () => {
    it('takes the extremes of the first stops over the stop length', () => {
      // p = 2, x = 1, q = 2. ATR(2): 2, 2.5, 2.75 from bar 1. First high stops HHV(H, 2) - ATR:
      // 10, 11.5, 11.25; first low stops LLV(L, 2) + ATR: 11, 12.5, 12.75.
      const bars = barsFrom([
        [11, 9, 10],
        [12, 10, 11],
        [14, 11, 13],
        [13, 10, 11]
      ]);
      const values = compute('CKSTOP', bars, { period: 2, multiplier: 1, stopPeriod: 2 });
      expectClose(values.stopLong ?? [], [N, N, 11, 12.5]);
      expectClose(values.stopShort ?? [], [N, N, 11.5, 11.5]);
    });

    it('starts on bar period + stop length - 2', () => {
      const values = compute('CKSTOP', walk(40));
      expect(values.stopLong?.findIndex((value) => !Number.isNaN(value))).toBe(17);
      expect(values.stopShort?.findIndex((value) => !Number.isNaN(value))).toBe(17);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      for (const [p, x, q] of [
        [10, 1, 9],
        [20, 2.5, 5]
      ] as const) {
        const values = compute('CKSTOP', bars, { period: p, multiplier: x, stopPeriod: q });
        const expected = referenceChandeKroll(bars, p, x, q);
        expectClose(values.stopLong ?? [], expected.long, 6);
        expectClose(values.stopShort ?? [], expected.short, 6);
      }
    });
  });

  describe('VORTEX', () => {
    it('divides the summed vortex movements by the summed true range', () => {
      // Period 2. VM+ |H - L'|: 3, 4, 2; VM- |L - H'|: 1, 1, 4; true ranges 2, 2, 3, 3.
      // Bar 2: 7 / 5 and 2 / 5; bar 3: 6 / 6 and 5 / 6.
      const bars = barsFrom([
        [11, 9, 10],
        [12, 10, 11],
        [14, 11, 13],
        [13, 10, 11]
      ]);
      const values = compute('VORTEX', bars, { period: 2 });
      expectClose(values.viPlus ?? [], [N, N, 1.4, 1]);
      expectClose(values.viMinus ?? [], [N, N, 0.4, 5 / 6]);
    });

    it('has no value over bars without range', () => {
      const values = compute('VORTEX', FLAT, { period: 2 });
      expectClose(values.viPlus ?? [], [N, N, N]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      const values = compute('VORTEX', bars);
      const expected = referenceVortex(bars, 14);
      expectClose(values.viPlus ?? [], expected.plus, 9);
      expectClose(values.viMinus ?? [], expected.minus, 9);
    });
  });
});

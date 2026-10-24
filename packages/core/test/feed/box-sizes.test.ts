import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import type { Bar } from '../../src/data/types';
import {
  averageTrueRange,
  roundSize,
  sizedStream,
  sizeFor,
  sizeRuleOf
} from '../../src/chart-types/box-sizes';
import type { BarTransformStream } from '../../src/feed/transform';
import { ATR } from '../../src/indicators';
import { computeIndicator } from '../../src/indicators/headless';
import { BTCUSDT } from '../helpers/market';

function store(bars: readonly Bar[]): BarStore {
  const result = new BarStore();
  result.assign(bars);
  return result;
}

/** True range of bar `index`, across the gap from the close before. */
function trueRange(bars: readonly Bar[], index: number): number {
  const bar = bars[index];
  const before = bars[index - 1];

  if (!bar) {
    throw new Error(`No bar ${index}.`);
  }

  return before
    ? Math.max(bar.high, before.close) - Math.min(bar.low, before.close)
    : bar.high - bar.low;
}

describe('box sizes', () => {
  it('rounds automatic sizes to halves of their leading power of ten', () => {
    // Reference sizes of a percentage of the last price for BTCUSDT at 82,080 (0.1 % to 4.5 %) and
    // ETHUSDT at 2,470 (2 %), noted on 22 October 2026.
    const cases: [number, number][] = [
      [82.08, 80],
      [205.2, 200],
      [410.4, 400],
      [574.56, 550],
      [820.8, 800],
      [1067.04, 1000],
      [1313.28, 1500],
      [1641.6, 1500],
      [2462.4, 2500],
      [3693.6, 3500],
      [49.4, 50]
    ];

    cases.forEach(([size, rounded]) => {
      expect(roundSize(size)).toBe(rounded);
    });
    // Written out exactly, with no rounding error left.
    expect(roundSize(0.694)).toBe(0.7);
    expect(roundSize(0.0000003204)).toBe(0.0000003);
  });

  it('measures the average true range', () => {
    const daily = BTCUSDT['1d'];
    // The ATR indicator, Wilder's smoothing of the true range, computed separately.
    const atr = computeIndicator(ATR, daily, { params: { period: 14 } }).atr ?? [];

    expect(averageTrueRange(store(daily), 14)).toBeCloseTo(atr.at(-1) ?? 0, 6);
    // Fewer bars than the length average the ranges there are.
    expect(averageTrueRange(store(daily.slice(0, 3)), 14)).toBeCloseTo(
      (trueRange(daily, 0) + trueRange(daily, 1) + trueRange(daily, 2)) / 3
    );
    expect(averageTrueRange(new BarStore(), 14)).toBeNaN();
  });

  it('leaves out the latest bar, which may still be forming', () => {
    const daily = BTCUSDT['1d'];
    const last = daily.length - 1;

    // Sizes with an ATR length of 1 are the true range of the last closed bar.
    expect(sizeFor({ kind: 'atr', length: 1 }, store(daily))).toBe(
      roundSize(trueRange(daily, last - 1))
    );
    expect(averageTrueRange(store(daily), 14, last)).toBeCloseTo(
      averageTrueRange(store(daily.slice(0, last)), 14)
    );
    // Fewer closed bars than the length do not give the average true range yet.
    expect(sizeFor({ kind: 'atr', length: 14 }, store(daily.slice(0, 14)))).toBeNaN();
    expect(sizeFor({ kind: 'atr', length: 14 }, store(daily.slice(0, 15)))).toBe(
      roundSize(averageTrueRange(store(daily), 14, 14))
    );
    expect(sizeFor({ kind: 'atr', length: 1 }, store(daily.slice(0, 1)))).toBeNaN();
  });

  it('waits for the closed bars to give a size the bars it was built from did not', () => {
    const daily = BTCUSDT['1d'];
    const built: number[] = [];
    const echo = (size: number): BarTransformStream => {
      built.push(size);
      return {
        next: (bar) => [bar],
        current: () => null,
        clone: () => echo(size)
      };
    };
    const stream = sizedStream({ kind: 'atr', length: 14 }, store(daily.slice(0, 5)), echo);
    const given = daily.slice(0, 15).map((bar) => stream.next(bar, null));

    // The 15th bar closes the 14th: the size of the 15 bars, and every bar from the first.
    expect(given.slice(0, 14).every((bars) => bars.length === 0)).toBe(true);
    expect(given[14]).toEqual(daily.slice(0, 15));
    expect(built).toEqual([sizeFor({ kind: 'atr', length: 14 }, store(daily.slice(0, 15)))]);
    expect(stream.resolved?.()).toBeNull();
    // The bars after keep it.
    expect(stream.next(daily[15] as Bar, null)).toEqual([daily[15]]);
    expect(built).toHaveLength(1);
  });

  it('sizes from the bars by the rule the parameters give', () => {
    const daily = store(BTCUSDT['1d']);
    const atr = averageTrueRange(daily, 14, BTCUSDT['1d'].length - 1);
    const last = BTCUSDT['1d'].at(-1)?.close ?? 0;

    expect(sizeFor(sizeRuleOf('kagi', 'reversal', {}, 'bars'), daily)).toBe(roundSize(atr));
    expect(sizeFor(sizeRuleOf('kagi', 'reversal', { atrLength: 30 }, 'bars'), daily)).toBe(
      roundSize(averageTrueRange(daily, 30, BTCUSDT['1d'].length - 1))
    );
    expect(sizeFor(sizeRuleOf('kagi', 'reversal', { reversal: 1234.5 }, 'bars'), daily)).toBe(
      1234.5
    );
    expect(sizeFor(sizeRuleOf('kagi', 'reversal', { percentage: 1 }, 'bars'), daily)).toBe(
      roundSize(last / 100)
    );
    expect(sizeFor(sizeRuleOf('kagi', 'reversal', {}, 'bars'), new BarStore())).toBeNaN();
  });

  it('takes one way of sizing, and checks it', () => {
    expect(() => sizeRuleOf('kagi', 'reversal', { reversal: 1, percentage: 1 }, 'bars')).toThrow(
      'The "kagi" transform takes one of params.reversal, params.percentage and params.atrLength, received params.reversal and params.percentage.'
    );
    expect(() => sizeRuleOf('point-figure', 'box', { box: 0 }, 'bars')).toThrow(
      'params.box must be greater than 0, received 0.'
    );
    expect(() => sizeRuleOf('kagi', 'reversal', { atrLength: 2.5 }, 'bars')).toThrow(
      'params.atrLength must be an integer'
    );
    expect(() => sizeRuleOf('kagi', 'reversal', { percentage: 120 }, 'bars')).toThrow(
      'params.percentage must be at most 100'
    );
    expect(sizeRuleOf('kagi', 'reversal', { percentage: 1 }, 'trades')).toEqual({
      kind: 'percentage',
      percentage: 1
    });
    expect(() => sizeRuleOf('kagi', 'reversal', { atrLength: 14 }, 'trades')).toThrow(
      'Trades have no true range to size the "kagi" transform by: give params.reversal or params.percentage.'
    );
  });
});

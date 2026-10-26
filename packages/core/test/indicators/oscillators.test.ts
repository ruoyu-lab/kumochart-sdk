import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { createTestChart } from '../helpers/chart';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, barsFromCloses, compute, expectClose, FLAT } from './helpers';
import {
  closesOnly,
  divide,
  ema,
  highest,
  lowest,
  N,
  ref,
  rma,
  rows,
  skippingNaN,
  sma,
  sum,
  walk,
  wma,
  zip
} from './reference';

/** Bars to compare with the references: a random walk and real BTCUSDT days and hours. */
const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT days', BTCUSDT['1d']],
  ['BTCUSDT hours', BTCUSDT['1h']]
];

type Column = 'open' | 'high' | 'low' | 'close';

function column(bars: readonly Required<BarInput>[], key: Column): number[] {
  return bars.map((bar) => bar[key]);
}

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

/** The bar the first value of a column is on. */
function first(values: readonly number[] | undefined): number {
  return values?.findIndex((value) => !Number.isNaN(value)) ?? -1;
}

/** `100 * (X - X[N]) / X[N]`. */
function roc(values: readonly number[], period: number): number[] {
  return zip([values, ref(values, period)], (now, before) => divide(now - before, before) * 100);
}

/** `X - X[1]`. */
function change(values: readonly number[]): number[] {
  return zip([values, ref(values, 1)], (now, before) => now - before);
}

/** An EMA of each value that is a number, the missing ones before them left out. */
function emaOf(values: readonly number[], period: number): number[] {
  return skippingNaN(values, (kept) => ema(kept, period));
}

/** Wilder's RSI: RMAs of the gains and the losses from the second value; 100 without losses. */
function rsi(values: readonly number[], period: number): number[] {
  const changes = change(values).slice(1);
  const up = rma(
    changes.map((each) => Math.max(each, 0)),
    period
  );
  const down = rma(
    changes.map((each) => Math.max(-each, 0)),
    period
  );
  return [
    N,
    ...zip([up, down], (gain, loss) =>
      loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss)
    )
  ];
}

/** The symmetric weighted average of four values: `(X[3] + 2X[2] + 2X[1] + X) / 6`. */
function swma(values: readonly number[]): number[] {
  return zip(
    [values, ref(values, 1), ref(values, 2), ref(values, 3)],
    (now, one, two, three) => (three + 2 * two + 2 * one + now) / 6
  );
}

describe.each(DATA)('oscillators on %s', (_name, bars) => {
  const opens = column(bars, 'open');
  const highs = column(bars, 'high');
  const lows = column(bars, 'low');
  const closes = column(bars, 'close');
  const medians = zip([highs, lows], (high, low) => (high + low) / 2);

  it('AO is the 5-bar SMA of the median price minus the 34-bar one', () => {
    expectSame(
      compute('AO', bars).ao,
      zip([sma(medians, 5), sma(medians, 34)], (fast, slow) => fast - slow)
    );
  });

  it('PPO is the short average over the long one, simple or exponential', () => {
    const percent = (short: number[], long: number[]) =>
      zip([short, long], (fast, slow) => ((fast - slow) / slow) * 100);
    expectSame(compute('PPO', bars).ppo, percent(sma(closes, 10), sma(closes, 21)));
    expectSame(
      compute('PPO', bars, { exponential: 1 }).ppo,
      percent(ema(closes, 10), ema(closes, 21))
    );
  });

  it('CMO compares the sums of the rises and the falls over 9 bars', () => {
    // As published: a missing change counts as a rise of 0 and leaves the falls missing.
    const changes = change(closes);
    const rises = sum(
      changes.map((each) => (each >= 0 ? each : 0)),
      9
    );
    const falls = sum(
      changes.map((each) => (each >= 0 ? 0 : -each)),
      9
    );
    expectSame(
      compute('CMO', bars).chandeMo,
      zip([rises, falls], (up, down) => (100 * (up - down)) / (up + down))
    );
  });

  it('UO weighs the buying pressure over the true range of 7, 14 and 28 bars 4, 2 and 1', () => {
    const before = ref(closes, 1);
    const low = zip([lows, before], Math.min);
    const pressure = zip([closes, low], (close, bottom) => close - bottom);
    const range = zip(
      [highs, before, low],
      (high, close, bottom) => Math.max(high, close) - bottom
    );
    const average = (period: number) => zip([sum(pressure, period), sum(range, period)], divide);
    expectSame(
      compute('UO', bars).uo,
      zip(
        [average(7), average(14), average(28)],
        (fast, middle, slow) => ((4 * fast + 2 * middle + slow) * 100) / 7
      )
    );
  });

  it('KST weighs four averaged rates of change 1 to 4, with a 9-bar SMA as signal', () => {
    const kst = zip(
      [
        sma(roc(closes, 10), 10),
        sma(roc(closes, 15), 10),
        sma(roc(closes, 20), 10),
        sma(roc(closes, 30), 15)
      ],
      (one, two, three, four) => one + 2 * two + 3 * three + 4 * four
    );
    const values = compute('KST', bars);
    expectSame(values.kst, kst);
    expectSame(values.signalLine, sma(kst, 9));
  });

  it('the Coppock curve is a 10-bar WMA of the 14- and 11-bar rates of change', () => {
    expectSame(
      compute('COPPOCK', bars).coppockCurve,
      wma(
        zip([roc(closes, 14), roc(closes, 11)], (long, short) => long + short),
        10
      )
    );
  });

  it('TSI divides the doubly smoothed change by its doubly smoothed size', () => {
    const smooth = (values: number[]) => emaOf(emaOf(values, 25), 13);
    const changes = change(closes);
    const tsi = zip(
      [smooth(changes), smooth(changes.map(Math.abs))],
      (move, size) => 100 * (move / size)
    );
    const values = compute('TSI', bars);
    expectSame(values.trueStrengthIndex, tsi);
    expectSame(values.signalLine, emaOf(tsi, 13));
  });

  it('SMI scales the distance from the middle of the range by its width, both smoothed twice', () => {
    const high = highest(highs, 10);
    const low = lowest(lows, 10);
    const smooth = (values: number[]) => emaOf(emaOf(values, 3), 3);
    const smi = zip(
      [
        smooth(zip([closes, high, low], (close, top, bottom) => close - (top + bottom) / 2)),
        smooth(zip([high, low], (top, bottom) => top - bottom))
      ],
      (distance, width) => 200 * (distance / width)
    );
    const values = compute('SMI', bars);
    expectSame(values.smi, smi);
    expectSame(values.smiBasedEma, emaOf(smi, 3));
  });

  it('RVGI sums the symmetric averages of the bodies over those of the ranges', () => {
    const rvgi = zip(
      [
        sum(swma(zip([closes, opens], (close, open) => close - open)), 10),
        sum(swma(zip([highs, lows], (high, low) => high - low)), 10)
      ],
      divide
    );
    const values = compute('RVGI', bars);
    expectSame(values.rvgi, rvgi);
    expectSame(values.signalLine, swma(rvgi));
  });

  it('BOP is the body of each bar over its range', () => {
    expectSame(
      compute('BOP', bars).bop,
      zip([closes, opens, highs, lows], (close, open, high, low) =>
        divide(close - open, high - low)
      )
    );
  });

  it('CRSI averages RSI, the RSI of the streak and the rank of the change', () => {
    // The streak as published: the first bar, with no close before it, counts as a fall.
    const streaks: number[] = [];
    closes.forEach((close, index) => {
      const before = closes[index - 1] ?? N;
      const last = streaks[index - 1] ?? 0;
      streaks.push(
        close === before
          ? 0
          : close > before
            ? last <= 0
              ? 1
              : last + 1
            : last >= 0
              ? -1
              : last - 1
      );
    });
    // The share of the previous 100 one-bar changes at most the latest one.
    const changes = roc(closes, 1);
    const ranks = changes.map((value, index) => {
      const previous = changes
        .slice(0, index)
        .filter((each) => !Number.isNaN(each))
        .slice(-100);
      return previous.length < 100
        ? N
        : (100 * previous.filter((each) => each <= value).length) / 100;
    });
    expectSame(
      compute('CRSI', bars).crsi,
      zip(
        [rsi(closes, 3), rsi(streaks, 2), ranks],
        (price, streak, rank) => (price + streak + rank) / 3
      )
    );
  });
});

describe('oscillators by hand', () => {
  it('draws AO in the up color where it rose and the down color where it fell or stayed', () => {
    // Medians 10, 12, 11, 11, 13: with lengths 1 and 2 AO is 1, -0.5, 0, 1 from bar 1.
    const chart = createTestChart({ locale: 'en-US' });
    chart.data.set(
      barsFrom([10, 12, 11, 11, 13].map((median) => [median + 1, median - 1, median]))
    );
    const id = chart.indicators.add({ type: 'AO', params: { fast: 1, slow: 2 } });
    const { theme } = chart.options();
    const shown = [1, 2, 3, 4].map((index) => chart.indicators.valuesAt(id, index)[0]);

    expect(shown.map((value) => value?.value)).toEqual([1, -0.5, 0, 1]);
    // The first rises from nothing.
    expect(shown.map((value) => value?.color)).toEqual([theme.up, theme.down, theme.up, theme.up]);
    // Equal lengths make 0 on every bar, which stays.
    const flat = chart.indicators.add({ type: 'AO', params: { fast: 1, slow: 1 } });
    expect(chart.indicators.valuesAt(flat, 2)[0]?.color).toBe(theme.down);
    expect(first(compute('AO', walk(60)).ao)).toBe(33);
  });

  it('starts PPO on the long average, and has none against a zero average', () => {
    // Long 2: SMA 15, 30, 40 from bar 1; EMA (α = 2/3) 15, 95/3, 335/9.
    const closes = barsFromCloses([10, 20, 40, 40]);
    expectClose(compute('PPO', closes, { short: 1, long: 2 }).ppo ?? [], [N, 100 / 3, 100 / 3, 0]);
    expectClose(compute('PPO', closes, { short: 1, long: 2, exponential: 1 }).ppo ?? [], [
      N,
      100 / 3,
      2500 / 95,
      2500 / 335
    ]);
    expectClose(compute('PPO', barsFromCloses([0, 0, 1]), { short: 1, long: 2 }).ppo ?? [], [
      N,
      N,
      100
    ]);
  });

  it('sums `period` changes for CMO, and has none while the price stays', () => {
    // Changes 1, -1, 0, 2 from bar 1. Bar 2: 1 up, 1 down → 0; bar 3: 0 up, 1 down → -100.
    const values = compute('CMO', closesOnly([10, 11, 10, 10, 12]), { period: 2 });
    expectClose(values.chandeMo ?? [], [N, N, 0, -100, 100]);
    expectClose(compute('CMO', FLAT, { period: 1 }).chandeMo ?? [], [N, N, N]);
  });

  it('takes the previous close into the range of UO, which starts on the slow length', () => {
    // Pressure / range from bar 1: 2/3, 1/4, 3/4. Bar 3: 4 * 3/4 + 2 * 4/8 + 6/11, over 7.
    const bars = barsFrom([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [12, 8, 11]
    ]);
    expectClose(compute('UO', bars, { fast: 1, middle: 2, slow: 3 }).uo ?? [], [
      N,
      N,
      N,
      5000 / 77
    ]);
    expectClose(compute('UO', FLAT, { fast: 1, middle: 1, slow: 2 }).uo ?? [], [N, N, N]);
  });

  it('starts KST, Coppock, TSI, SMI and RVGI once their averages are seeded', () => {
    const bars = walk(80);
    const kst = compute('KST', bars);
    expect([first(kst.kst), first(kst.signalLine)]).toEqual([44, 52]);
    expect(first(compute('COPPOCK', bars).coppockCurve)).toBe(23);
    const tsi = compute('TSI', bars);
    expect([first(tsi.trueStrengthIndex), first(tsi.signalLine)]).toEqual([37, 49]);
    const smi = compute('SMI', bars);
    expect([first(smi.smi), first(smi.smiBasedEma)]).toEqual([13, 15]);
    const rvgi = compute('RVGI', bars);
    expect([first(rvgi.rvgi), first(rvgi.signalLine)]).toEqual([12, 15]);
  });

  it('has no TSI, SMI, RVGI or BOP over prices that never move', () => {
    const flat = closesOnly(Array.from({ length: 60 }, () => 10));
    const none = (values: number[] | undefined) => values?.every(Number.isNaN);

    expect(none(compute('TSI', flat).trueStrengthIndex)).toBe(true);
    expect(none(compute('SMI', flat).smi)).toBe(true);
    expect(none(compute('RVGI', flat).rvgi)).toBe(true);
    expect(none(compute('BOP', flat).bop)).toBe(true);
  });

  it('measures the body of each bar in its range for BOP', () => {
    const bars = rows([
      [10, 12, 8, 11],
      [11, 11, 11, 11],
      [11, 13, 9, 9]
    ]);
    expectClose(compute('BOP', bars).bop ?? [], [0.25, N, -0.5]);
  });

  it('counts the first bar as a fall in the streak of CRSI', () => {
    // RSI(1) 100, 100, 100, 0, 0 from bar 1. Streaks -1, 1, 2, 0, -1, -2: changes 2, 1, -2, -1,
    // -1 → RSI(2) 100, 300/7, 300/11, 300/19 from bar 2. Ranks among one change: 0 from bar 2.
    const values = compute('CRSI', closesOnly([10, 11, 12, 12, 11, 10]), {
      rsiLength: 1,
      streakLength: 2,
      rocLength: 1
    });
    expectClose(values.crsi ?? [], [N, N, 200 / 3, 1000 / 21, 100 / 11, 100 / 19]);
    // The rank of 100 one-bar changes needs 100 before it.
    expect(first(compute('CRSI', walk(200)).crsi)).toBe(101);
  });

  it('ranks a change equal to all the previous ones at 100', () => {
    // Doubling: every change is 100%, at most the latest.
    const values = compute('CRSI', closesOnly([1, 2, 4, 8, 16]), {
      rsiLength: 1,
      streakLength: 1,
      rocLength: 2
    });
    expectClose(values.crsi ?? [], [N, N, N, 100, 100]);
  });
});

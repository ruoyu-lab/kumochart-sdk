import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, BarInput } from '../../src/data/types';
import { averageTrueRange, roundSize } from '../../src/chart-types/box-sizes';
import { createTestChart } from '../helpers/chart';
import { BTCUSDT } from '../helpers/market';
import { canvasCalls } from '../setup';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

/** Bars of these closes, a day apart, with a volume of one each. */
function closes(values: readonly number[]): Bar[] {
  return values.map((close, index) => ({
    time: T0 + index * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1
  }));
}

function chartOf(bars: readonly BarInput[], interval = '1d'): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  chart.data.set(bars, { interval });
  return chart;
}

function renko(bars: readonly BarInput[], params: Record<string, unknown>): Bar[] {
  const chart = chartOf(bars);
  chart.transforms.set({ type: 'renko', params });
  return chart.data.toArray();
}

/** The bricks after streaming `bars`, each first as a partial bar at its open. */
function streamed(bars: readonly Bar[], params: Record<string, unknown>, interval: string): Bar[] {
  const chart = chartOf(bars.slice(0, 2), interval);
  chart.transforms.set({ type: 'renko', params });

  for (const bar of bars.slice(2)) {
    chart.data.update({ ...bar, high: bar.open, low: bar.open, close: bar.open, volume: 0 });
    chart.data.update(bar);
  }

  return chart.data.toArray();
}

/**
 * Renko bricks, written apart from the transform and checked against reference bricks: on 23
 * October 2026 the bricks of BTCUSDT 1D with a box of 2500, from the closes and from OHLC,
 * matched them brick for brick, their volumes to a hundred-thousandth. The bars become a list of
 * prices: the closes, or with OHLC each bar's open, low, high and close (open, high, low and
 * close when it fell), each with a quarter of its volume. The first price stands in the box of
 * the grid it is in; a brick needs a price a box past the last brick, on the grid. A brick is
 * timed at the bar of its price, a millisecond after the one before in the same bar, and holds
 * the volume since the price of the bricks before, shared by the bricks of one price. The first
 * brick of a price has a wick to the highest or lowest price since then, if it went more than a
 * box past the brick's open the other way.
 */
function referenceRenko(
  bars: readonly Bar[],
  box: number,
  source: 'close' | 'ohlc',
  wicks: boolean
): Bar[] {
  const prices = bars.flatMap((bar) => {
    const path =
      source === 'close'
        ? [bar.close]
        : bar.close >= bar.open
          ? [bar.open, bar.low, bar.high, bar.close]
          : [bar.open, bar.high, bar.low, bar.close];
    return path.map((price) => ({ time: bar.time, price, volume: bar.volume / path.length }));
  });
  const bricks: Bar[] = [];
  const reached = (distance: number) => distance >= box * (1 - 1e-9);
  const level = (value: number) => Math.round(value / box) * box;
  let low = Number.NaN;
  let high = Number.NaN;
  let volume = 0;
  let since: number[] = [];

  for (const { time, price, volume: share } of prices) {
    volume += share;
    since.push(price);

    if (Number.isNaN(low)) {
      low = Math.floor(price / box + 1e-9) * box;
      high = low + box;
    }

    const made: [number, number][] = [];

    while (reached(price - high)) {
      made.push([high, level(high + box)]);
      [low, high] = [high, level(high + box)];
    }

    while (reached(low - price)) {
      made.push([low, level(low - box)]);
      [low, high] = [level(low - box), low];
    }

    made.forEach(([open, close], index) => {
      const top = Math.max(...since);
      const bottom = Math.min(...since);
      const wick = wicks && index === 0;
      bricks.push({
        time,
        open,
        high: wick && close < open && top > open + box * (1 + 1e-9) ? top : Math.max(open, close),
        low:
          wick && close > open && bottom < open - box * (1 + 1e-9) ? bottom : Math.min(open, close),
        close,
        volume: volume / made.length
      });
    });

    if (made.length > 0) {
      volume = 0;
      since = [];
    }
  }

  // Bricks of one bar a millisecond apart.
  let last = Number.NEGATIVE_INFINITY;
  return bricks.map((brick) => {
    last = Math.max(brick.time, last + 1);
    return { ...brick, time: last };
  });
}

/** Prices to 1e-6, volumes to 1e-9 of their size: sums of shares differ in the last digits. */
function rounded(bars: readonly Bar[]): number[][] {
  return bars.map((bar) => [
    bar.time,
    ...[bar.open, bar.high, bar.low, bar.close].map((value) => Math.round(value * 1e6) / 1e6),
    Number(bar.volume.toPrecision(9))
  ]);
}

describe('Renko bricks', () => {
  it('places a brick a box past the last, with a $2 box', () => {
    // 51 stands in the box from 50 to 52; 54.5 makes the brick 52 → 54. Then no brick until a
    // close at 56 or above, or at 50 or below: at 57.3, between 56 and 58, the brick is 54 → 56.
    // A reversal takes two boxes: 52 or below from the brick 54 → 56.
    const bricks = renko(closes([51, 54.5, 55.9, 50.2, 57.3, 52.1, 51.6]), { box: 2 });

    expect(bricks.map((brick) => [brick.open, brick.close])).toEqual([
      [52, 54],
      [54, 56],
      [54, 52]
    ]);
    // Each is timed at its bar and holds the volume since the bar of the brick before.
    expect(bricks.map((brick) => (brick.time - T0) / DAY)).toEqual([1, 4, 6]);
    expect(bricks.map((brick) => brick.volume)).toEqual([2, 3, 2]);
  });

  it('starts from the box the first price is in', () => {
    // From 0.8899 in the box 0.6 to 0.9 of 0.3, 0.9028 is no brick: up needs 1.2, down 0.3.
    // XRPUSDT's first brick, on 11 August 2018, has this wick at 0.9028.
    const bricks = renko(closes([0.8899, 0.9028, 0.55, 0.29]), { box: 0.3 });

    expect(bricks).toEqual([
      { time: T0 + 3 * DAY, open: 0.6, high: 0.9028, low: 0.3, close: 0.3, volume: 4 }
    ]);
  });

  it('draws a wick where the price went more than a box back', () => {
    // A box of 3 on the highs and lows: down bricks 174 → 171 and 171 → 168, then a rally to
    // 171.27, past 171 but short of the reversal at 174, and a fall to 165: the brick 168 → 165
    // has a high wick at 171.27.
    const bar = (index: number, open: number, high: number, low: number, close: number) => ({
      time: T0 + index * DAY,
      open,
      high,
      low,
      close,
      volume: 4
    });
    const bars = [
      bar(0, 176, 176, 176, 176),
      bar(1, 175, 175, 170.5, 170.8),
      bar(2, 170.8, 171, 167.9, 168.2),
      bar(3, 168.2, 171.27, 168, 170),
      bar(4, 170, 170.5, 164.8, 165.2)
    ];
    const bricks = renko(bars, { box: 3, source: 'ohlc' });

    expect(bricks.map((brick) => [brick.open, brick.high, brick.low, brick.close])).toEqual([
      [174, 174, 171, 171],
      [171, 171, 168, 168],
      [168, 171.27, 165, 165]
    ]);
    // Each price of a bar holds a quarter of its volume: the last brick holds the close of the
    // bar of the brick before, the bar after it and the last bar to its low.
    expect(bricks.map((brick) => brick.volume)).toEqual([7, 4, 8]);

    // A rally that stays within the brick above draws no wick, nor do bricks without wicks.
    const short = bars.map((each, index) => (index === 3 ? { ...each, high: 170.9 } : each));
    expect(renko(short, { box: 3, source: 'ohlc' })[2]?.high).toBe(168);
    expect(renko(bars, { box: 3, source: 'ohlc', wicks: false })[2]?.high).toBe(168);
  });

  it('shares the volume of a price among its bricks, a millisecond apart', () => {
    const bricks = renko(closes([100.5, 104.2, 104.5]), { box: 1 });

    expect(bricks.map((brick) => [brick.time - T0, brick.open, brick.close, brick.volume])).toEqual(
      [
        [DAY, 101, 102, 2 / 3],
        [DAY + 1, 102, 103, 2 / 3],
        [DAY + 2, 103, 104, 2 / 3]
      ]
    );
  });

  it.each([
    { interval: '1d', params: { box: 2500 } },
    { interval: '1d', params: { box: 1000, source: 'ohlc' } },
    { interval: '1d', params: { box: 2500, source: 'ohlc', wicks: false } },
    { interval: '1d', params: {} },
    { interval: '1d', params: { percentage: 1, source: 'ohlc' } },
    { interval: '1h', params: { box: 250 } },
    { interval: '1h', params: { box: 500, source: 'ohlc' } },
    { interval: '1h', params: { atrLength: 30 } }
  ] as const)(
    'matches a reference on BTCUSDT $interval bars with $params',
    ({ interval, params }) => {
      const bars = BTCUSDT[interval];
      const chart = chartOf(bars, interval);
      chart.transforms.set({ type: 'renko', params });
      const resolved = chart.transforms.get()?.resolved ?? {};
      const built = chart.data.toArray();

      expect(built.length).toBeGreaterThan(10);
      expect(rounded(built)).toEqual(
        rounded(
          referenceRenko(
            bars,
            resolved.box as number,
            resolved.source as 'close' | 'ohlc',
            resolved.wicks as boolean
          )
        )
      );

      if ('box' in params) {
        expect(rounded(streamed(bars, params, interval))).toEqual(rounded(built));
      }
    }
  );

  it('sizes the box from the average true range of the closed bars, or the last close', () => {
    const bars = BTCUSDT['1d'];
    const store = new BarStore();
    store.assign(bars);
    const chart = chartOf(bars);
    chart.transforms.set({ type: 'renko' });

    expect(chart.transforms.get()).toEqual({
      type: 'renko',
      params: {},
      input: 'bars',
      resolved: {
        box: roundSize(averageTrueRange(store, 14, bars.length - 1)),
        source: 'close',
        wicks: true
      }
    });
    chart.transforms.set({ type: 'renko', params: { percentage: 3 } });
    expect(chart.transforms.get()?.resolved?.box).toBe(
      roundSize(((bars.at(-1)?.close ?? 0) * 3) / 100)
    );

    // The reference box with an ATR length of 1 on 23 October 2026, 00:22 UTC: 3500, the true
    // range of the day before, rounded; the day under way is left out.
    chart.data.set(
      [
        ...bars,
        {
          time: Date.UTC(2026, 9, 22),
          open: 84093.42,
          high: 84377.21,
          low: 80939.54,
          close: 81416.09
        },
        {
          time: Date.UTC(2026, 9, 23),
          open: 81416.09,
          high: 81416.09,
          low: 81145.82,
          close: 81180.1
        }
      ],
      { interval: '1d' }
    );
    chart.transforms.set({ type: 'renko', params: { atrLength: 1 } });
    expect(chart.transforms.get()?.resolved?.box).toBe(3500);
  });

  it('labels the real-time price apart from the last brick', () => {
    const chart = chartOf(closes([100.5, 103.2, 102.6]));
    chart.transforms.set({ type: 'renko', params: { box: 1 } });
    const labels = () => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };

    // The last brick ends at 103; the price is 102.6.
    expect(labels()).toEqual(expect.arrayContaining(['103.00', '102.60']));

    chart.applyOptions({ latestPrice: { label: false } });
    expect(labels()).not.toContain('102.60');

    // Bars that end at the price, and bars of time, have the one label.
    chart.applyOptions({ latestPrice: { label: true } });
    chart.transforms.set({ type: 'range', params: { range: 1 } });
    expect(labels().filter((text) => text === '102.60')).toHaveLength(1);
    chart.transforms.set(null);
    expect(labels().filter((text) => text === '102.60')).toHaveLength(1);
  });

  it('checks its parameters', () => {
    const chart = chartOf(closes([100, 101, 102]));

    expect(() => {
      chart.transforms.set({ type: 'renko', params: { box: 1, atrLength: 14 } });
    }).toThrow('takes one of params.box, params.percentage and params.atrLength');
    expect(() => {
      chart.transforms.set({ type: 'renko', params: { source: 'hl' } });
    }).toThrow('params.source');
    expect(() => {
      chart.transforms.set({ type: 'renko', params: { wicks: 'yes' } });
    }).toThrow('params.wicks');
  });
});

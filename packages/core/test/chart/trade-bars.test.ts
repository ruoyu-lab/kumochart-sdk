import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { TradeLog, type Trade } from '../../src/data/trades';
import type { Bar, BarInput, TradeInput } from '../../src/data/types';
import type { SeriesPaintContext } from '../../src/series/types';
import { MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';
import type { ChartOptionsInput } from '../../src/options/resolve';

const SECOND = 1000;

/** Bars from closes a minute apart, open, high and low at the close. */
function closes(values: readonly number[], volumes?: readonly number[]): BarInput[] {
  return values.map((close, index) => ({
    time: T0 + index * MINUTE,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes?.[index] ?? 1
  }));
}

function chartOf(options?: ChartOptionsInput): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' }, ...options });
  return chart;
}

/** Trades every 300 ms, the price walking up and down, sizes 1 to 5, bought and sold in turn. */
function trades(count: number, from = 0): Array<Trade & TradeInput> {
  return Array.from({ length: count }, (_, index) => {
    const position = from + index;
    return {
      time: T0 + position * 300,
      price: 100 + Math.round(10 * Math.sin(position / 7)) / 4,
      size: 1 + (position % 5),
      side: position % 2 === 0 ? 'buy' : 'sell'
    };
  });
}

/** The bars of `count` trades each, as tick bars should be. */
function tickBars(list: readonly Trade[], count: number): Bar[] {
  const bars: Bar[] = [];

  for (let start = 0; start < list.length; start += count) {
    const group = list.slice(start, start + count);
    const prices = group.map((trade) => trade.price);
    bars.push({
      time: group[0]?.time ?? 0,
      open: prices[0] ?? 0,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices.at(-1) ?? 0,
      volume: group.reduce((sum, trade) => sum + trade.size, 0)
    });
  }

  return bars;
}

/** Bars spaced as the chart spaces bars with equal times: a millisecond apart. */
function spaced(bars: readonly Bar[]): Bar[] {
  let last = Number.NEGATIVE_INFINITY;
  return bars.map((bar) => {
    last = Math.max(bar.time, last + 1);
    return { ...bar, time: last };
  });
}

describe('line break', () => {
  it('draws a line when a close breaks the last three lines', () => {
    const chart = chartOf();
    chart.data.set(closes([10, 11, 12, 11.5, 13, 9, 9.5, 8, 12.5, 14]), { interval: '1m' });
    chart.transforms.set({ type: 'line-break' });
    const lines = chart.data.toArray();

    expect(lines.map((line) => [line.open, line.close])).toEqual([
      [10, 11],
      [11, 12],
      // 11.5 breaks nothing.
      [12, 13],
      // 9 falls below the three lines (10 to 13): from the bottom of the last line.
      [12, 9],
      // 9.5 breaks nothing; 8 goes on down from 9.
      [9, 8],
      // 12.5 stays under the top of the last three lines, 13; 14 turns up from the top of 9.
      [9, 14]
    ]);
    // Each line starts after the previous one and holds the volume since.
    expect(lines.map((line) => (line.time - T0) / MINUTE)).toEqual([0, 2, 3, 5, 6, 8]);
    expect(lines.map((line) => line.volume)).toEqual([2, 1, 2, 1, 2, 2]);
    expect(lines.every((line) => line.high === Math.max(line.open, line.close))).toBe(true);
  });

  it('breaks the last line alone with one line', () => {
    const chart = chartOf();
    chart.data.set(closes([10, 11, 12, 10.5, 13]), { interval: '1m' });
    chart.transforms.set({ type: 'line-break', params: { lines: 1 } });

    // 10.5 is under the bottom of the line from 11 to 12; 13 over the top of 11 to 10.5.
    expect(chart.data.toArray().map((line) => [line.open, line.close])).toEqual([
      [10, 11],
      [11, 12],
      [11, 10.5],
      [11, 13]
    ]);
    expect(() => {
      chart.transforms.set({ type: 'line-break', params: { lines: 0 } });
    }).toThrow('params.lines must be at least 1, received 0.');
  });
});

describe('bars of an amount of trading', () => {
  it('merges whole bars until they reach the size', () => {
    const chart = chartOf();
    chart.data.set(closes([10, 11, 12, 13, 14, 15, 16], [3, 4, 2, 5, 1, 6, 2]), {
      interval: '1m'
    });
    chart.transforms.set({ type: 'volume', params: { volume: 6 } });
    const bars = chart.data.toArray();

    // 3 + 4, 2 + 5, 1 + 6, and the bar forming with 2.
    expect(bars.map((bar) => [bar.open, bar.close, bar.volume])).toEqual([
      [10, 11, 7],
      [12, 13, 7],
      [14, 15, 7],
      [16, 16, 2]
    ]);

    // Turnover weighs the volume by the typical price: 10 × 3 + 11 × 4 = 74 ≥ 70.
    chart.transforms.set({ type: 'turnover', params: { turnover: 70 } });
    expect(chart.data.toArray().map((bar) => bar.volume)).toEqual([7, 7, 7, 2]);

    // Built from bars, tick bars count bars.
    chart.transforms.set({ type: 'tick', params: { count: 3 } });
    expect(chart.data.toArray().map((bar) => bar.volume)).toEqual([9, 12, 2]);
  });

  it('needs the size and nothing else', () => {
    const chart = chartOf();
    chart.data.set(closes([10, 11]), { interval: '1m' });

    expect(() => {
      chart.transforms.set({ type: 'volume' });
    }).toThrow('The "volume" transform needs params.volume, the volume of each bar.');
    expect(() => {
      chart.transforms.set({ type: 'turnover', params: { turnover: 0 } });
    }).toThrow('params.turnover must be greater than 0, received 0.');
    expect(() => {
      chart.transforms.set({ type: 'tick', params: { count: 2.5 } });
    }).toThrow('params.count must be an integer, received 2.5.');
    expect(() => {
      chart.transforms.set({ type: 'tick', params: { count: 2, size: 3 } });
    }).toThrow('The "tick" transform has no parameter "size".');
    expect(() => {
      chart.transforms.set({ type: 'tick', params: { count: 2 }, input: 'ticks' as never });
    }).toThrow('transform.input must be one of "bars", "trades", received "ticks".');
  });
});

describe('bars built from trades', () => {
  it('get the side of each trade’s taker, and none from bars', () => {
    const chart = chartOf();
    const sides: Array<string | null> = [];
    chart.transforms.register({
      type: 'sides',
      name: 'Sides',
      keepsTime: false,
      create: () => {
        const stream = {
          next: (bar: Bar, side: 'buy' | 'sell' | null) => {
            sides.push(side);
            return [bar];
          },
          current: () => null,
          clone: () => stream
        };
        return stream;
      }
    });
    chart.data.set([], { interval: '1s' });
    chart.data.addTrades([
      { time: T0, price: 100, size: 1, side: 'buy' },
      { time: T0 + 100, price: 101, size: 1, side: 'sell' },
      { time: T0 + 200, price: 101, size: 1 },
      { time: T0 + 1200, price: 102, size: 1, side: 'buy' }
    ]);
    chart.transforms.set({ type: 'sides', input: 'trades' });

    // The latest input goes to a copy of the stream too, for the bar it forms.
    expect(sides.slice(0, 4)).toEqual(['buy', 'sell', null, 'buy']);
    sides.length = 0;
    chart.transforms.set({ type: 'sides' });
    expect(sides.every((side) => side === null)).toBe(true);
    expect(() => chart.data.addTrades({ time: T0 + 2000, price: 1, side: 'bid' as never })).toThrow(
      'trades[0].side must be one of "buy", "sell", received "bid".'
    );
  });

  it('builds tick bars from every trade', () => {
    const chart = chartOf();
    chart.data.set([], { interval: '1s' });
    const list = trades(100);
    chart.data.addTrades(list);
    chart.transforms.set({ type: 'tick', params: { count: 7 }, input: 'trades' });

    expect(chart.transforms.get()).toEqual({
      type: 'tick',
      params: { count: 7 },
      input: 'trades',
      resolved: null
    });
    expect(chart.data.toArray()).toEqual(tickBars(list, 7));
    // The source bars are bars of seconds, as before.
    expect(chart.data.source.length).toBe(30);
  });

  it('streams trade by trade exactly like a rebuild', () => {
    const list = trades(300);
    const streamed = chartOf();
    streamed.data.set([], { interval: '1s' });
    streamed.transforms.set({ type: 'volume', params: { volume: 20 }, input: 'trades' });

    for (let index = 0; index < list.length; index += 13) {
      streamed.data.addTrades(list.slice(index, index + 13));
    }

    const rebuilt = chartOf();
    rebuilt.data.set([], { interval: '1s' });
    rebuilt.data.addTrades(list);
    rebuilt.transforms.set({ type: 'volume', params: { volume: 20 }, input: 'trades' });

    expect(streamed.data.toArray()).toEqual(rebuilt.data.toArray());
    expect(
      rebuilt.data
        .toArray()
        .slice(0, -1)
        .every((bar) => bar.volume >= 20)
    ).toBe(true);
    expect(rebuilt.data.toArray().reduce((sum, bar) => sum + bar.volume, 0)).toBe(
      list.reduce((sum, trade) => sum + trade.size, 0)
    );
  });

  it('spaces bars of trades with the same time a millisecond apart', () => {
    const chart = chartOf();
    chart.data.set([], { interval: '1s' });
    const burst: TradeInput[] = [100, 101, 102, 103].map((price) => ({ time: T0, price, size: 1 }));
    chart.data.addTrades(burst);
    chart.transforms.set({ type: 'tick', params: { count: 1 }, input: 'trades' });

    expect(chart.data.toArray().map((bar) => bar.time - T0)).toEqual([0, 1, 2, 3]);
  });

  it('shows only the trades a replay has revealed', () => {
    const chart = chartOf();
    chart.data.set([], { interval: '1s' });
    const list = trades(120);
    chart.data.addTrades(list);
    chart.transforms.set({ type: 'tick', params: { count: 5 }, input: 'trades' });
    // The source bar of second 10 holds the trades up to 10.999 s.
    chart.replay.start(T0 + 10 * SECOND);
    const revealed = list.filter((trade) => trade.time < T0 + 11 * SECOND);

    expect(chart.data.toArray()).toEqual(spaced(tickBars(revealed, 5)));
    chart.replay.step();
    expect(chart.data.toArray()).toEqual(
      spaced(
        tickBars(
          list.filter((trade) => trade.time < T0 + 12 * SECOND),
          5
        )
      )
    );
    chart.replay.stop();
    expect(chart.data.toArray()).toEqual(tickBars(list, 5));
  });

  it('keeps the latest trades, and the bars built from older ones until a rebuild', () => {
    const chart = chartOf({ performance: { maxTrades: 50 } });
    chart.data.set([], { interval: '1s' });
    chart.transforms.set({ type: 'tick', params: { count: 10 }, input: 'trades' });
    const list = trades(120);

    for (let index = 0; index < list.length; index += 10) {
      chart.data.addTrades(list.slice(index, index + 10));
    }

    // Streamed: every bar stays.
    expect(chart.data.toArray()).toEqual(tickBars(list, 10));

    // Rebuilt: from the 50 latest trades.
    chart.transforms.set({ type: 'tick', params: { count: 10 }, input: 'trades' });
    expect(chart.data.toArray()).toEqual(tickBars(list.slice(70), 10));

    // Fewer kept trades drop more; none keeps none.
    chart.applyOptions({ performance: { maxTrades: 20 } });
    chart.transforms.set({ type: 'tick', params: { count: 10 }, input: 'trades' });
    expect(chart.data.toArray()).toEqual(tickBars(list.slice(100), 10));
    chart.applyOptions({ performance: { maxTrades: 0 } });
    chart.data.addTrades(trades(10, 120));
    chart.transforms.set({ type: 'tick', params: { count: 10 }, input: 'trades' });
    expect(chart.data.length).toBe(0);
    expect(() => {
      chart.applyOptions({ performance: { maxTrades: -1 } });
    }).toThrow('options.performance.maxTrades must be at least 0, received -1.');
  });

  it('forgets the trades with the data', () => {
    const chart = chartOf();
    chart.data.set([], { interval: '1s' });
    chart.data.addTrades(trades(30));
    chart.transforms.set({ type: 'tick', params: { count: 3 }, input: 'trades' });
    expect(chart.data.length).toBe(10);

    chart.data.set([], { interval: '1s' });
    expect(chart.data.length).toBe(0);
    chart.data.addTrades(trades(6, 100));
    expect(chart.data.length).toBe(2);
    chart.data.clear();
    expect(chart.data.length).toBe(0);
  });
});

describe('trade log', () => {
  it('reads on by position while the oldest trades go', () => {
    const log = new TradeLog(4);
    const list = trades(6);
    log.append(list.slice(0, 3), [1, 1, 2]);
    const seen = log.revision;
    log.append(list.slice(3), [2, 3, 3]);

    expect([log.first, log.end]).toEqual([2, 6]);
    expect(log.changesSince(seen)).toEqual({ kind: 'tail', from: 3 });
    expect(log.bar(5).close).toBe(list[5]?.price);
    // A revision it never had, such as one of another log, reads everything again.
    expect(log.changesSince(log.revision + 1)).toEqual({ kind: 'reset' });
    expect(log.view().length).toBe(4);
    expect(log.view().time(0)).toBe(list[2]?.time);

    // Hiding trades is a reset; revealing them again a tail.
    log.setCutoff(2);
    expect(log.end).toBe(4);
    const hidden = log.revision;
    log.setCutoff(Number.POSITIVE_INFINITY);
    expect(log.changesSince(hidden)).toEqual({ kind: 'tail', from: 4 });
    expect(log.changesSince(seen)).toEqual({ kind: 'reset' });

    // A smaller capacity keeps the latest, a larger one keeps what there is.
    log.setCapacity(2);
    expect([log.first, log.end, log.view().close(0)]).toEqual([4, 6, list[4]?.price]);
    log.setCapacity(10);
    log.append(trades(1, 6), [4]);
    expect([log.first, log.end, log.view().close(2)]).toEqual([4, 7, trades(1, 6)[0]?.price]);
  });
});

/**
 * A series type of bars recording the bars it paints, which `painted()` gives: their prices as
 * the y of the prices given, and their volume.
 */
function probed(chart: Chart): {
  painted(prices: readonly number[]): { ys: number[][]; volumes: number[] };
} {
  let last: SeriesPaintContext<object> | null = null;
  chart.series.register({
    type: 'probe',
    input: 'ohlc',
    defaultStyle: () => ({}),
    paint: (context) => {
      last = context;
    }
  });
  return {
    painted: (prices) => {
      chart.screenshot();
      const { points, valueToY } = last ?? expect.unreachable('The series was not painted.');
      const indices = Array.from({ length: points.count }, (_, index) => index);
      return {
        ys: [
          indices.flatMap((index) => [
            points.open(index),
            points.high(index),
            points.low(index),
            points.close(index)
          ]),
          prices.map((price) => valueToY(price))
        ],
        volumes: indices.map((index) => points.volume(index))
      };
    }
  };
}

describe('trades of a series', () => {
  it('fold into its bars of the source interval, shown in the timeframe', () => {
    const chart = chartOf();
    chart.data.set(closes([100, 101, 102]), { interval: '1m' });
    chart.data.setTimeframe('3m');
    const probe = probed(chart);
    const id = chart.series.add({ type: 'probe', data: closes([50, 51]) });

    expect(
      chart.series.addTrades(id, [
        { time: T0 + MINUTE + 10 * SECOND, price: 53, size: 2 },
        { time: T0 + 2 * MINUTE, price: 49, size: 1 },
        // Late: before the latest trade.
        { time: T0 + MINUTE, price: 70, size: 1 }
      ])
    ).toBe(2);
    expect(chart.series.addTrades(id, { time: T0 + 2 * MINUTE + SECOND, price: 48 })).toBe(1);
    const { ys, volumes } = probe.painted([50, 53, 48, 48]);
    expect(ys[0]).toEqual(ys[1]);
    expect(volumes).toEqual([5]);
  });

  it('go after the bars set anew', () => {
    const chart = chartOf();
    chart.data.set(closes([100, 101]), { interval: '1m' });
    const probe = probed(chart);
    const id = chart.series.add({ type: 'probe', data: closes([50, 51]) });
    chart.series.addTrades(id, { time: T0 + MINUTE + 30 * SECOND, price: 52 });
    chart.series.setData(id, closes([60]));

    expect(chart.series.addTrades(id, { time: T0 + 10 * SECOND, price: 61 })).toBe(1);
    const { ys } = probe.painted([60, 61, 60, 61]);
    expect(ys[0]).toEqual(ys[1]);
  });

  it('give a series of values the price of the last trade of each source interval', () => {
    const chart = chartOf();
    chart.data.set(closes([100, 101, 102]), { interval: '1m' });
    const painted: { last: SeriesPaintContext<object> | null } = { last: null };
    chart.series.register({
      type: 'values',
      input: 'value',
      defaultStyle: () => ({}),
      paint: (context) => {
        painted.last = context;
      }
    });
    const id = chart.series.add({ type: 'values', data: [{ time: T0, value: 50 }] });

    expect(
      chart.series.addTrades(id, [
        { time: T0 + 20 * SECOND, price: 51 },
        { time: T0 + MINUTE + 5 * SECOND, price: 52 },
        { time: T0 + MINUTE + 50 * SECOND, price: 53 },
        // Late: before the latest trade.
        { time: T0 + 30 * SECOND, price: 70 }
      ])
    ).toBe(3);
    chart.screenshot();
    const { points, valueToY } = painted.last ?? expect.unreachable('The series was not painted.');
    expect(Array.from({ length: points.count }, (_, index) => points.value(index))).toEqual([
      valueToY(51),
      valueToY(53)
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { MarketData } from '../../src/chart/market-data';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, BarInput } from '../../src/data/types';
import { createBarFeed, identityBucketer } from '../../src/feed/aggregator';
import { parseInterval } from '../../src/feed/interval';
import { IndicatorBases, type IndicatorBasis } from '../../src/indicators/basis';
import { IndicatorSeries, resolveParams } from '../../src/indicators/instance';
import type { IndicatorPlot, ParamValues } from '../../src/indicators/types';
import {
  zigzagPivots,
  ZigzagView,
  type ZigzagPivot,
  type ZigzagPlot
} from '../../src/indicators/zigzag-plot';
import { createDefaultOptions } from '../../src/options/defaults';
import { createSeriesRegistry } from '../../src/series/built-in';
import { SeriesStore } from '../../src/series/series-store';
import { MINUTE, T0 } from '../helpers/bars';
import { BTCUSDT } from '../helpers/market';
import { barsFrom, compute, createSeries, definitionOf, expectClose, UTC_DAYS } from './helpers';
import { N, walk } from './reference';

// The zigzag written out over whole arrays from its published rules, independent of the stream
// and of the drawing: a swing is checked against the bars on both sides, a pivot of the side of
// the last one moves it when beyond it, one of the other side needs the deviation, and the
// volume is summed as each bar comes, `depth` bars late, into the pivot that takes it.

interface ReferencePivot {
  bar: number;
  price: number;
  high: boolean;
  /** The price the pivot's line starts at: the pivot before, or its own for the first. */
  start: number;
  volume: number;
}

function referenceZigzag(
  bars: readonly BarInput[],
  deviation: number,
  legs: number
): { pivots: ReferencePivot[]; end: ReferencePivot | null } {
  const depth = Math.max(2, Math.floor(legs / 2));
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const pivots: ReferencePivot[] = [];
  let pending = 0;

  bars.forEach((_bar, index) => {
    pending += index >= depth ? (bars[index - depth]?.volume ?? 0) : 0;

    for (const high of [true, false]) {
      if (depth * 2 > index) {
        continue;
      }

      const values = high ? highs : lows;
      const price = values[index - depth] ?? N;
      const above = (value: number) => (high ? value > price : value < price);
      const reaches = (value: number) => (high ? value >= price : value <= price);
      let found = true;

      for (let back = 0; back < depth; back += 1) {
        found &&= !above(values[index - back] ?? N);
      }

      for (let back = depth + 1; back <= 2 * depth; back += 1) {
        found &&= !reaches(values[index - back] ?? N);
      }

      if (!found) {
        continue;
      }

      const last = pivots[pivots.length - 1];

      if (!last) {
        pivots.push({ bar: index - depth, price, high, start: price, volume: pending });
        pending = 0;
      } else if (last.high === high) {
        if (high ? price > last.price : price < last.price) {
          if (pivots.length === 1) {
            last.start = price;
          }

          last.bar = index - depth;
          last.price = price;
          last.volume += pending;
          pending = 0;
        }
      } else {
        const change = (100 * (price - last.price)) / Math.abs(last.price);

        if (high ? change >= deviation : change <= -deviation) {
          pivots.push({ bar: index - depth, price, high, start: last.price, volume: pending });
          pending = 0;
        }
      }
    }
  });

  const last = pivots[pivots.length - 1];
  const lastBar = bars[bars.length - 1];

  if (!last || !lastBar) {
    return { pivots, end: null };
  }

  const recent = bars.slice(-depth).reduce((total, bar) => total + (bar.volume ?? 0), 0);
  return {
    pivots,
    end: {
      bar: bars.length - 1,
      price: last.high ? lastBar.low : lastBar.high,
      high: !last.high,
      start: last.price,
      volume: pending + recent
    }
  };
}

/** The pivots as the drawing has them: bar, price, side, change and volume. */
function described(pivots: readonly ZigzagPivot[]) {
  return pivots.map(({ bar, price, high, change, volume }) => ({
    bar,
    price,
    high,
    change,
    volume
  }));
}

function expectedOf(pivots: readonly ReferencePivot[]) {
  return pivots.map(({ bar, price, high, start, volume }) => ({
    bar,
    price,
    high,
    change: price - start,
    volume
  }));
}

/** The same pivots, changes and volumes summed in another order equal to 12 digits. */
function expectPivots(
  actual: readonly ZigzagPivot[],
  expected: readonly ReferencePivot[],
  label = ''
): void {
  const want = expectedOf(expected);
  expect(
    actual.map(({ bar, price, high }) => [bar, price, high]),
    label
  ).toEqual(want.map(({ bar, price, high }) => [bar, price, high]));
  actual.forEach((pivot, index) => {
    const { change = N, volume = N } = want[index] ?? {};
    expect(pivot.change, `${label} change ${index}`).toBeCloseTo(change, 6);
    expect(
      Math.abs(pivot.volume - volume) / Math.max(1, volume),
      `${label} volume ${index}`
    ).toBeLessThan(1e-12);
  });
}

/** The columns of the ZIGZAG outputs: the line, the highs and the lows. */
const COLUMNS = { own: 0, high: 1, low: 2 };

/** The plot of ZIGZAG with `params`. */
function plotOf(params: ParamValues = {}): ZigzagPlot {
  const definition = definitionOf('ZIGZAG');
  const plot: IndicatorPlot | undefined = definition.outputs(
    resolveParams(definition, params, 'ZIGZAG')
  )[0]?.plot;

  if (plot?.kind !== 'zigzag') {
    throw new Error('ZIGZAG draws a zigzag.');
  }

  return plot;
}

/** The series of ZIGZAG over `bars`, up to date. */
function seriesOf(bars: readonly BarInput[], params?: ParamValues): IndicatorSeries {
  const store = new BarStore();
  store.set(bars);
  const { series } = createSeries(store, 'ZIGZAG', params);
  series.sync();
  return series;
}

/** Everything the line goes through over `count` bars, its end included. */
function line(series: IndicatorSeries, count: number, params?: ParamValues): ZigzagPivot[] {
  return [...new ZigzagView(series, plotOf(params), COLUMNS, 0, count - 1).points];
}

const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(600)],
  ['BTCUSDT daily', BTCUSDT['1d']],
  ['BTCUSDT hourly', BTCUSDT['1h']]
];

/** Bars from `[high, low]` rows with volumes 1, 2, 3, …, the close at the low. */
function swings(rows: readonly (readonly [number, number])[]): BarInput[] {
  return barsFrom(rows.map(([high, low], index) => [high, low, low, index + 1]));
}

describe('ZIGZAG', () => {
  // Pivot legs 4: swings of 2 bars on each side; deviation 10 %.
  // Highs 10 11 13 12 11 10 9 10 11 14 13 12 13, lows one less: a high swing of 13 on bar 2,
  // known on bar 4, the first pivot; a low swing of 8 on bar 6, known on bar 8, 38 % under it; a
  // high swing of 14 on bar 9, known on bar 11, 75 % over it. The line goes on to the low of the
  // last bar, 12.
  const SIMPLE = swings([
    [10, 9],
    [11, 10],
    [13, 12],
    [12, 11],
    [11, 10],
    [10, 9],
    [9, 8],
    [10, 9],
    [11, 10],
    [14, 13],
    [13, 12],
    [12, 11],
    [13, 12]
  ]);
  const PARAMS = { deviation: 10, depth: 4 };

  it('gives on each bar the swings it takes as pivots, and where the line would go on to', () => {
    const values = compute('ZIGZAG', SIMPLE, PARAMS);
    expectClose(values.high ?? [], [N, N, N, N, 13, N, N, N, N, N, N, 14, N]);
    expectClose(values.low ?? [], [N, N, N, N, N, N, N, N, 8, N, N, N, N]);
    // The low of each bar after a high, its high after a low.
    expectClose(values.zigZag ?? [], [N, N, N, N, 10, 9, 8, 9, 11, 14, 13, 11, 12]);
    // The pivots are drawn back on their bars.
    const outputs = definitionOf('ZIGZAG').outputs(
      resolveParams(definitionOf('ZIGZAG'), PARAMS, 'ZIGZAG')
    );
    expect(outputs.map((output) => output.offset ?? 0)).toEqual([0, -2, -2]);
  });

  it('joins the pivots, measuring each from the one before, and goes on to the latest bar', () => {
    // Volumes 1 to 13: bars 0–2 (6) to the first pivot, 3–6 (22), 7–9 (27), and 10–12 (36) to
    // the end of the line.
    expect(described(line(seriesOf(SIMPLE, PARAMS), SIMPLE.length, PARAMS))).toEqual([
      { bar: 2, price: 13, high: true, change: 0, volume: 6 },
      { bar: 6, price: 8, high: false, change: -5, volume: 22 },
      { bar: 9, price: 14, high: true, change: 6, volume: 27 },
      { bar: 12, price: 12, high: false, change: -2, volume: 36 }
    ]);
  });

  it('moves the last pivot to a swing beyond it, of the same side, without the deviation', () => {
    // A high swing of 13 on bar 2, then of 15 on bar 5 before any low swing far enough: the
    // second replaces the first, which stays in the values of bar 4 only.
    const bars = swings([
      [10, 9],
      [11, 10],
      [13, 12],
      [12, 11],
      [12.5, 11.5],
      [15, 14],
      [14, 13],
      [13, 12],
      [12, 11]
    ]);
    const values = compute('ZIGZAG', bars, PARAMS);
    expectClose(values.high ?? [], [N, N, N, N, 13, N, N, 15, N]);
    expect(described(zigzagPivots(seriesOf(bars, PARAMS), COLUMNS))).toEqual([
      { bar: 5, price: 15, high: true, change: 0, volume: 21 }
    ]);
  });

  it('takes the first of equal highs as the swing, and a high and a low of one bar, the high first', () => {
    // Highs 9 10 12 12 11 10: the swing is the 12 of bar 2, above the bars before it, the 12
    // after it being no higher; the 12 of bar 3 is not above the one before it.
    // Bar 6 is both a high swing (20), which replaces the 12, and a low swing (1), 95 % under it.
    const bars = swings([
      [9, 8.5],
      [10, 9.5],
      [12, 11.5],
      [12, 11.5],
      [11, 10.5],
      [10, 9.5],
      [20, 1],
      [10, 9.5],
      [10.5, 9.8],
      [10, 9.6]
    ]);
    const values = compute('ZIGZAG', bars, PARAMS);
    expectClose(values.high ?? [], [N, N, N, N, 12, N, N, N, 20, N]);
    expectClose(values.low ?? [], [N, N, N, N, N, N, N, N, 1, N]);
    // The first pivot takes the volume of every bar to it, the low of the same bar none.
    expect(described(zigzagPivots(seriesOf(bars, PARAMS), COLUMNS))).toEqual([
      { bar: 6, price: 20, high: true, change: 0, volume: 28 },
      { bar: 6, price: 1, high: false, change: -19, volume: 0 }
    ]);
  });

  it('counts pivot legs as twice the bars on each side, at least two', () => {
    for (const [depth, first] of [
      [2, 4],
      [5, 4],
      [6, 6],
      [10, 10]
    ] as const) {
      const values = compute('ZIGZAG', walk(80), { depth, deviation: 0.5 });
      // The first value can come on bar 2 * depth / 2 at the earliest.
      const known = [...(values.high ?? []), ...(values.low ?? [])];
      expect(known.slice(0, first).every(Number.isNaN), String(depth)).toBe(true);
    }
  });

  it.each(DATA)('matches the whole-array zigzag on %s', (_name, bars) => {
    for (const [deviation, depth] of [
      [5, 10],
      [1, 4],
      [2, 20],
      [0.3, 6]
    ] as const) {
      const params = { deviation, depth };
      const series = seriesOf(bars, params);
      const { pivots, end } = referenceZigzag(bars, deviation, depth);
      expect(pivots.length, `${deviation} ${depth}`).toBeGreaterThan(2);
      expectPivots(zigzagPivots(series, COLUMNS), pivots, `${deviation} ${depth}`);
      expectPivots(line(series, bars.length, params), [...pivots, ...(end ? [end] : [])]);
    }
  });

  it('works the pivots out once for each version of the values', () => {
    const series = seriesOf(walk(300));
    const pivots = zigzagPivots(series, COLUMNS);
    expect(zigzagPivots(series, COLUMNS)).toBe(pivots);
    series.sync();
    expect(zigzagPivots(series, COLUMNS)).toBe(pivots);
  });

  it('follows the latest bar as it makes a new high and falls back, as computed in full', () => {
    const bars = BTCUSDT['1h'].slice(0, 600);
    const params = { deviation: 1, depth: 6 };
    const feed = createBarFeed(identityBucketer);
    const { series } = createSeries(feed.display, 'ZIGZAG', params);

    bars.forEach((bar, index) => {
      const range = bar.high - bar.low;
      // The bar first runs far above its high and below its low, then settles where it closed.
      for (const tick of [
        { ...bar, high: bar.high + 3 * range, close: bar.high + 3 * range },
        { ...bar, low: bar.low - 3 * range, close: bar.low - 3 * range },
        bar
      ]) {
        feed.planUpdate([tick])();
        series.sync();
        const full = seriesOf([...bars.slice(0, index), tick], params);
        const count = index + 1;
        expect(described(line(series, count, params)), `bar ${index}`).toEqual(
          described(line(full, count, params))
        );
      }
    });
  });

  describe('in view', () => {
    // Highs 10, 13 (replaced), 15, then a low, a high… over a long flat stretch between them.
    const params = { deviation: 10, depth: 4 };
    const bars = swings([
      ...Array.from({ length: 6 }, (): [number, number] => [10, 9]),
      [13, 12],
      ...Array.from({ length: 5 }, (): [number, number] => [12, 11]),
      [15, 14],
      ...Array.from({ length: 20 }, (): [number, number] => [12, 11]),
      [9, 5],
      ...Array.from({ length: 20 }, (): [number, number] => [8.5, 8]),
      [14, 13],
      ...Array.from({ length: 4 }, (): [number, number] => [13, 12])
    ]);
    const series = seriesOf(bars, params);
    const plot = plotOf(params);
    const at = (from: number, to: number) => new ZigzagView(series, plot, COLUMNS, from, to);
    const bar = (points: readonly ZigzagPivot[]) => points.map((point) => point.bar);

    it('has the pivots of the data', () => {
      // The 13 of bar 6 is a swing replaced by the 15 of bar 12; the first swing of the flat
      // highs is none: nothing is above the bars before it.
      expect(bar(zigzagPivots(series, COLUMNS))).toEqual([12, 33, 54]);
      const values = compute('ZIGZAG', bars, params);
      expect(values.high?.findIndex((value) => !Number.isNaN(value))).toBe(8);
    });

    it('takes a run of highs across an edge as its last, beyond the view', () => {
      // Bar 6's high is in view, its run goes on to bar 12 to the right: the line starts there.
      expect(bar(at(0, 9).points)).toEqual([12]);
      expect(at(0, 9).indices).toEqual([12]);
    });

    it('draws a segment whose pivots are both out of view', () => {
      expect(bar(at(20, 30).points)).toEqual([12, 33]);
      expect(bar(at(40, 50).points)).toEqual([33, 54, bars.length - 1]);
    });

    it('draws everything zoomed out, and the ends panned to', () => {
      expect(bar(at(-500, 500).points)).toEqual([12, 33, 54, bars.length - 1]);
      // Past the latest bar: the last pivot and the end of the line.
      expect(bar(at(bars.length + 5, bars.length + 50).points)).toEqual([54, bars.length - 1]);
      // Before the first bar: the first pivot only.
      expect(bar(at(-50, -5).points)).toEqual([12]);
    });

    it('goes on to the latest bar only when extended', () => {
      const plain = new ZigzagView(series, { ...plot, extend: false }, COLUMNS, -500, 500);
      expect(bar(plain.points)).toEqual([12, 33, 54]);
    });
  });

  describe('in a timeframe of its own', () => {
    /** Ten-minute bars of a random walk, from 09:30 UTC. */
    function market(count: number) {
      const displayed = new BarStore();
      const options = createDefaultOptions();
      const store = new SeriesStore(createSeriesRegistry(), () => options.theme);
      const data = new MarketData(displayed, store, options);
      const bars = walk(count).map((bar, index) => ({ ...bar, time: T0 + index * 10 * MINUTE }));
      data.set(bars, '10m');
      return { data, displayed, bars };
    }

    /** Bars of an hour merged from the ten-minute bars. */
    function hours(bars: readonly Bar[]): Bar[] {
      const merged: Bar[] = [];

      for (const bar of bars) {
        const time = UTC_DAYS.bucket(bar.time, '1h') ?? Number.NaN;
        const last = merged[merged.length - 1];

        if (last?.time === time) {
          merged[merged.length - 1] = {
            ...last,
            high: Math.max(last.high, bar.high),
            low: Math.min(last.low, bar.low),
            close: bar.close,
            volume: last.volume + bar.volume
          };
        } else {
          merged.push({ ...bar, time });
        }
      }

      return merged;
    }

    it('finds the pivots of its bars, summing their volumes, drawn once where each shows', () => {
      const { data, displayed, bars } = market(1200);
      const bases = new IndicatorBases(data, displayed);
      const basis = bases.of(parseInterval('1h'));
      const definition = definitionOf('ZIGZAG');
      const params = resolveParams(definition, { deviation: 1, depth: 4 }, 'ZIGZAG');
      const series = new IndicatorSeries(
        definition,
        params,
        definition.outputs(params),
        'close',
        basis
      );
      series.sync();
      const hourly = hours(bars);
      const { pivots, end } = referenceZigzag(hourly, 1, 4);
      expect(pivots.length).toBeGreaterThan(5);
      expectPivots(zigzagPivots(series, COLUMNS), pivots);

      const view = new ZigzagView(series, plotOf(params), COLUMNS, 0, displayed.length - 1);
      const shown: IndicatorBasis = basis();
      const first = pivots.findIndex((pivot) => pivot.bar >= shown.barAt(0));
      expectPivots(view.points, [...pivots.slice(Math.max(0, first - 1)), ...(end ? [end] : [])]);
      view.points.forEach((point, index) => {
        const drawn = view.indices[index] ?? N;
        // The first displayed bar showing the hour of the pivot.
        expect(shown.barAt(drawn)).toBe(point.bar);
        expect(shown.barAt(drawn - 1)).toBeLessThan(point.bar);
      });
      // The volumes are those of the hours, ten-minute bars summed into them.
      const total = hourly.reduce((sum, bar) => sum + bar.volume, 0);
      const counted = described(line(series, displayed.length, params)).reduce(
        (sum, pivot) => sum + pivot.volume,
        0
      );
      expect(counted).toBeCloseTo(total, 6);
    });
  });
});

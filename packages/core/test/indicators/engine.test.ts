import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import { createBarFeed, identityBucketer } from '../../src/feed/aggregator';
import type { Bar } from '../../src/data/types';
import { resolveParams } from '../../src/indicators/instance';
import { createBars } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';
import { barsFromCloses, compute, createSeries, definitionOf, expectClose, read } from './helpers';

describe('indicator engine', () => {
  it('computes MA with a warm-up period', () => {
    const values = compute('MA', barsFromCloses([1, 2, 3, 4, 5]), { periods: [3] });
    expectClose(values.ma3 ?? [], [Number.NaN, Number.NaN, 2, 3, 4]);
  });

  it('seeds EMA with the simple average of its first values', () => {
    const values = compute('EMA', barsFromCloses([10, 20, 30, 40]), { periods: [3] });
    // The SMA 20, then alpha = 0.5: 30.
    expectClose(values.ema3 ?? [], [Number.NaN, Number.NaN, 20, 30]);
  });

  it('takes the MACD histogram as MACD minus its signal line', () => {
    const values = compute('MACD', barsFromCloses([10, 12, 11, 14]), {
      fast: 1,
      slow: 3,
      signal: 2
    });
    // Fast EMA(1) = price; slow EMA(3): the SMA 11, then 12.5 → MACD 0, 1.5.
    // Signal EMA(2): the SMA 0.75 on bar 3 → histogram 0.75.
    expectClose(values.macd ?? [], [Number.NaN, Number.NaN, 0, 1.5]);
    expectClose(values.signalLine ?? [], [Number.NaN, Number.NaN, Number.NaN, 0.75]);
    expectClose(values.histogram ?? [], [Number.NaN, Number.NaN, Number.NaN, 0.75]);
  });

  it('computes BOLL with a population standard deviation', () => {
    const values = compute('BOLL', barsFromCloses([2, 4, 4, 4, 5, 5, 7, 9]), {
      period: 8,
      multiplier: 2
    });
    expect(values.basis?.[7]).toBeCloseTo(5);
    expect(values.upper?.[7]).toBeCloseTo(9);
    expect(values.lower?.[7]).toBeCloseTo(1);
  });

  it('computes VOL with volume moving averages', () => {
    const values = compute('VOL', barsFromCloses([1, 1, 1], [10, 20, 30]), { periods: [2] });
    expectClose(values.volume ?? [], [10, 20, 30]);
    expectClose(values.ma2 ?? [], [Number.NaN, 15, 25]);
  });

  it('recomputes after history is prepended', () => {
    const bars = createBars(60);
    const feed = createBarFeed(identityBucketer);
    const store = feed.display;
    feed.planSet(bars.slice(30), identityBucketer)();
    const { series, keys } = createSeries(store, 'MA', { periods: [5] });
    read(series, keys, store.length);
    feed.planPrepend(bars.slice(0, 30)).commit();

    expectClose(
      read(series, keys, store.length).ma5 ?? [],
      compute('MA', bars, { periods: [5] }).ma5 ?? []
    );
  });

  it('recomputes from the first bar a change of the latest bars reaches', () => {
    const bars = createBars(40);
    const store = new BarStore();
    store.set(bars);
    const { series, keys } = createSeries(store, 'MA', { periods: [3] });
    read(series, keys, store.length);
    // The last three bars are written again, two of them changed, one bar fewer.
    const revised = [
      { ...bars[37], close: bars[37]?.high },
      { ...bars[38], close: bars[38]?.low }
    ] as Bar[];
    store.replaceFrom(37, revised);

    expectClose(
      read(series, keys, store.length).ma3 ?? [],
      compute('MA', [...bars.slice(0, 37), ...revised], { periods: [3] }).ma3 ?? []
    );
  });

  it('follows the bricks a tick on the latest bar builds again', () => {
    const day = 86_400_000;
    const bar = (index: number, close: number) => ({
      time: Date.UTC(2024, 0, 1) + index * day,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1
    });
    const history = [100, 101, 102, 103, 104, 105].map((close, index) => bar(index, close));
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(history, { interval: '1d' });
    chart.transforms.set({ type: 'renko', params: { box: 1 } });
    const ma = chart.indicators.add({ type: 'MA', params: { periods: [2] } });
    // The forming bar first makes three bricks up, then two bricks down instead.
    chart.data.update(bar(6, 108));
    chart.indicators.valuesAt(ma);
    chart.data.update(bar(6, 102));

    const rebuilt = createTestChart({ calendar: { timeZone: 'UTC' } });
    rebuilt.data.set([...history, bar(6, 102)], { interval: '1d' });
    rebuilt.transforms.set({ type: 'renko', params: { box: 1 } });
    const expected = rebuilt.indicators.add({ type: 'MA', params: { periods: [2] } });
    const values = (of: typeof chart, id: string) =>
      Array.from(
        { length: of.data.length },
        (_, index) => of.indicators.valuesAt(id, index)[0]?.value
      );

    expect(chart.data.toArray()).toEqual(rebuilt.data.toArray());
    expect(values(chart, ma)).toEqual(values(rebuilt, expected));
  });

  it('validates parameters', () => {
    const definition = definitionOf('MACD');

    expect(() => resolveParams(definition, { fast: 0 }, 'MACD')).toThrow(
      'params.fast must be at least 1'
    );
    expect(() => resolveParams(definition, { speed: 3 }, 'MACD')).toThrow(
      'has no parameter "speed"'
    );
    expect(() => resolveParams(definitionOf('MA'), { periods: [] }, 'MA')).toThrow(
      /list of 1 to 8/
    );
    expect(resolveParams(definition, { fast: 5 }, 'MACD')).toEqual({
      fast: 5,
      slow: 26,
      signal: 9,
      oscillatorType: 0,
      signalType: 0
    });
    // The volume takes no averages by default, so it takes an empty list too.
    expect(resolveParams(definitionOf('VOL'), { periods: [] }, 'VOL').periods).toEqual([]);
  });

  it('takes only the values of a parameter with options', () => {
    const vwap = definitionOf('VWAP');

    expect(vwap.params.anchor?.options?.map((option) => option.label)).toEqual([
      'Session',
      'Week',
      'Month',
      'Quarter',
      'Year'
    ]);
    expect(resolveParams(vwap, { anchor: 4 }, 'VWAP').anchor).toBe(4);
    expect(() => resolveParams(vwap, { anchor: 5 }, 'VWAP')).toThrow(
      'params.anchor must be one of 0 (Session), 1 (Week), 2 (Month), 3 (Quarter), 4 (Year), received 5.'
    );
  });
});

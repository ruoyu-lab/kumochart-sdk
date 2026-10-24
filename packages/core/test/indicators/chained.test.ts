import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { IndicatorStream } from '../../src/indicators/types';
import { createBars } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** Values of one output of an indicator at every bar. */
function values(chart: Chart, id: string, key: string): number[] {
  return Array.from({ length: chart.data.length }, (_, index) => {
    const value = chart.indicators.valuesAt(id, index).find((item) => item.key === key)?.value;
    return value ?? Number.NaN;
  });
}

/** A simple moving average of the finite values, NaN until `period` of them. */
function movingAverage(input: readonly number[], period: number): number[] {
  const seen: number[] = [];
  return input.map((value) => {
    if (Number.isNaN(value)) {
      return Number.NaN;
    }

    seen.push(value);
    return seen.length < period
      ? Number.NaN
      : seen.slice(-period).reduce((sum, item) => sum + item, 0) / period;
  });
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    if (Number.isNaN(expected[index] ?? Number.NaN)) {
      expect(value).toBeNaN();
    } else {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 9);
    }
  });
}

/** Counts the bars it receives. */
class Counter implements IndicatorStream {
  constructor(private count = 0) {}

  next(): number[] {
    this.count += 1;
    return [this.count];
  }

  clone(): IndicatorStream {
    return new Counter(this.count);
  }
}

describe('indicators on indicators', () => {
  it('averages another indicator, skipping the bars it has no value for', () => {
    const chart = chartWithBars(80);
    const rsi = chart.indicators.add({ id: 'rsi', type: 'RSI', params: { period: 6 } });
    const ma = chart.indicators.add({
      type: 'MA',
      params: { periods: [5] },
      source: { kind: 'indicator', id: rsi }
    });

    expectClose(values(chart, ma, 'ma5'), movingAverage(values(chart, rsi, 'rsi'), 5));

    // A 10-bar average has no value on its first 9 bars; an average of it starts after them.
    const slow = chart.indicators.add({ type: 'MA', params: { periods: [10] } });
    const smooth = chart.indicators.add({
      type: 'MA',
      params: { periods: [3] },
      source: { kind: 'indicator', id: slow }
    });
    const smoothed = values(chart, smooth, 'ma3');
    expect(smoothed.slice(0, 11).every(Number.isNaN)).toBe(true);
    expectClose(smoothed, movingAverage(values(chart, slow, 'ma10'), 3));

    // Calculators never see those bars: this one counts the bars it was given.
    chart.indicators.register({
      type: 'COUNT',
      name: 'COUNT',
      pane: 'new',
      precision: 0,
      params: {},
      outputs: () => [{ key: 'count', label: 'COUNT', plot: { kind: 'line' } }],
      create: () => new Counter()
    });
    const count = chart.indicators.add({ type: 'COUNT', source: { kind: 'indicator', id: slow } });
    expect(chart.indicators.valuesAt(count)[0]?.value).toBe(80 - 9);
    expect(chart.indicators.get(ma)?.source).toEqual({ kind: 'indicator', id: 'rsi' });
  });

  it('places overlays in the pane of the indicator they read', () => {
    const chart = chartWithBars(80);
    const rsi = chart.indicators.add({ type: 'RSI' });
    const rsiPane = chart.indicators.get(rsi)?.pane;
    const ma = chart.indicators.add({ type: 'MA', source: { kind: 'indicator', id: rsi } });
    const macd = chart.indicators.add({ type: 'MACD', source: { kind: 'indicator', id: rsi } });

    expect(chart.indicators.get(ma)?.pane).toBe(rsiPane);
    expect(chart.indicators.get(macd)?.pane).not.toBe(rsiPane);
    // The average takes the RSI's precision, not the price's.
    expect(chart.indicators.valuesAt(ma)[0]?.text).toMatch(/^\d+\.\d{2}$/);
  });

  it('share the scale of the indicator they read in its pane only', () => {
    const chart = chartWithBars(80);
    const volume = chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
    const shared = chart.indicators.add({ type: 'MA', source: { kind: 'indicator', id: volume } });
    const own = chart.indicators.add({
      type: 'MA',
      pane: 'new',
      source: { kind: 'indicator', id: volume }
    });

    expect(chart.indicators.get(shared)).toMatchObject({ pane: 'main', scale: 'volume' });
    // A pane of its own has no volume scale to share.
    expect(chart.indicators.get(own)?.pane).not.toBe('main');
    expect(chart.indicators.get(own)?.scale).toBe('right');
  });

  it('streams exactly like a rebuild, and follows the indicator it reads', () => {
    const bars = createBars(120);
    const streamed = createTestChart();
    streamed.data.set(bars.slice(0, 60));
    const rsi = streamed.indicators.add({ id: 'rsi', type: 'RSI', params: { period: 6 } });
    const ma = streamed.indicators.add({
      id: 'ma',
      type: 'MA',
      params: { periods: [4] },
      source: { kind: 'indicator', id: rsi }
    });

    for (const bar of bars.slice(60)) {
      streamed.data.update({ ...bar, close: bar.open });
      streamed.data.update(bar);
    }

    const rebuilt = chartWithBars(120);
    rebuilt.indicators.add({ id: 'rsi', type: 'RSI', params: { period: 6 } });
    rebuilt.indicators.add({
      id: 'ma',
      type: 'MA',
      params: { periods: [4] },
      source: { kind: 'indicator', id: 'rsi' }
    });
    expectClose(values(streamed, ma, 'ma4'), values(rebuilt, 'ma', 'ma4'));

    // A new RSI period changes its values, which the average follows.
    streamed.indicators.update(rsi, { params: { period: 9 } });
    expectClose(values(streamed, ma, 'ma4'), movingAverage(values(streamed, rsi, 'rsi'), 4));

    // A new period of an average renames its output; one reading its first output follows.
    const fast = streamed.indicators.add({ type: 'MA', params: { periods: [5] } });
    const ofFast = streamed.indicators.add({
      type: 'MA',
      params: { periods: [2] },
      source: { kind: 'indicator', id: fast }
    });
    streamed.indicators.update(fast, { params: { periods: [7] } });
    expectClose(values(streamed, ofFast, 'ma2'), movingAverage(values(streamed, fast, 'ma7'), 2));
  });

  it('reads a chosen output and protects what others read', () => {
    const chart = chartWithBars(80);
    const macd = chart.indicators.add({ id: 'macd', type: 'MACD' });
    const signal = chart.indicators.add({
      id: 'avg',
      type: 'MA',
      params: { periods: [3] },
      source: { kind: 'indicator', id: macd, key: 'signalLine' }
    });

    expect(() =>
      chart.indicators.add({ type: 'MA', source: { kind: 'indicator', id: 'nope' } })
    ).toThrow('unknown indicator "nope"');
    expect(() =>
      chart.indicators.add({ type: 'MA', source: { kind: 'indicator', id: macd, key: 'x' } })
    ).toThrow('indicator "macd" has no output "x"');
    expect(() => {
      chart.indicators.remove(macd);
    }).toThrow('Indicator "macd" is read by the indicators "avg"; remove them first.');
    // MACD reading its own average would be a loop.
    expect(() => {
      chart.indicators.update(macd, { source: { kind: 'indicator', id: signal } });
    }).toThrow('"avg" reads "macd", so "macd" cannot read it');

    const ma = chart.indicators.add({ id: 'ma', type: 'MA', params: { periods: [5, 10] } });
    chart.indicators.add({
      id: 'of-ma10',
      type: 'EMA',
      source: { kind: 'indicator', id: ma, key: 'ma10' }
    });
    expect(() => {
      chart.indicators.update(ma, { params: { periods: [5] } });
    }).toThrow('Indicator "ma" would no longer produce "ma10", which indicator "of-ma10" reads.');

    chart.indicators.remove(signal);
    chart.indicators.remove(macd);
    expect(chart.indicators.get(macd)).toBeNull();
  });

  it('names its input in the legend', () => {
    const chart = chartWithBars(80);
    const rsi = chart.indicators.add({ type: 'RSI', params: { period: 6 } });
    chart.indicators.add({
      type: 'MA',
      params: { periods: [5] },
      source: { kind: 'indicator', id: rsi }
    });
    const macd = chart.indicators.add({ type: 'MACD' });
    chart.indicators.add({
      type: 'EMA',
      params: { periods: [3] },
      source: { kind: 'indicator', id: macd, key: 'signalLine' }
    });
    const cursor = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
    const calls = cursor ? canvasCalls(cursor) : [];
    calls.length = 0;
    chart.screenshot();
    const texts = calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);

    expect(texts).toContain('MA 5 · RSI');
    expect(texts).toContain('EMA 3 · MACD signalLine');
  });

  it('saves the indicator it reads before it, whatever the order they were added', () => {
    const chart = chartWithBars(80);
    const ma = chart.indicators.add({ id: 'ma', type: 'MA', params: { periods: [5] } });
    chart.indicators.add({ id: 'rsi', type: 'RSI' });
    chart.indicators.update(ma, { source: { kind: 'indicator', id: 'rsi' } });
    const state = chart.saveState();

    expect(state.indicators.map((indicator) => indicator.id)).toEqual(['rsi', 'ma']);

    const restored = chartWithBars(80);
    restored.loadState(state);
    expectClose(values(restored, 'ma', 'ma5'), values(chart, 'ma', 'ma5'));
  });
});

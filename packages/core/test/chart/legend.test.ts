import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { createBars } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** The texts painted on the cursor layer, where the legends are. */
function legend(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

/** Where the cursor layer painted each text: its left, its right and its top. */
function placed(chart: Chart): Array<{ left: number; right: number; top: number }> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls
    .filter((call) => call.name === 'fillText')
    .map((call) => {
      const left = Number(call.args[1]);
      // Texts measure 6 pixels a character in the tests.
      return { left, right: left + String(call.args[0]).length * 6, top: Number(call.args[2]) };
    });
}

describe('legend', () => {
  it('labels the values of the bar with the chart texts', () => {
    const chart = chartWithBars(100, { locale: 'en-US', latestPrice: { label: false } });
    const labels = () =>
      legend(chart)
        .filter((text) => /^\S+ [\d.,]+[KM]?$/.test(text))
        .map((text) => text.split(' ')[0]);

    expect(labels()).toEqual(['O', 'H', 'L', 'C', 'V']);
    chart.applyOptions({
      texts: {
        legendOpen: '开',
        legendHigh: '高',
        legendLow: '低',
        legendClose: '收',
        legendVolume: '量'
      }
    });
    expect(labels()).toEqual(['开', '高', '低', '收', '量']);
  });

  it('wraps a row longer than a narrow chart instead of running under the price axis', () => {
    // Without the latest price's label, the legends are all the cursor layer paints.
    const options = { locale: 'en-US', latestPrice: { label: false } };
    const wide = createTestChart(options, 800, 400);
    const narrow = createTestChart(options, 260, 400);

    for (const chart of [wide, narrow]) {
      chart.data.set(createBars(100));
      chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20, 30, 60] } });
    }

    const lines = (texts: ReturnType<typeof placed>) => new Set(texts.map((text) => text.top)).size;
    const wideTexts = placed(wide);
    const narrowTexts = placed(narrow);

    expect(lines(narrowTexts)).toBeGreaterThan(lines(wideTexts));
    // The price axis takes the right of the narrow chart: no legend reaches into it.
    expect(Math.max(...narrowTexts.map((text) => text.right))).toBeLessThan(260 - 30);
  });

  it('shows the value of a comparison series at the latest bar', () => {
    const chart = chartWithBars(100, { locale: 'en-US' });
    const bars = createBars(100);
    chart.series.add({
      id: 'eth',
      type: 'line',
      title: 'ETH',
      data: bars.map((bar, index) => ({ time: bar.time, value: index === 99 ? 2345.5 : 2000 }))
    });
    chart.series.add({ id: 'idx', type: 'candles', title: 'Index', data: bars });
    const texts = legend(chart);

    expect(texts).toContain('ETH');
    expect(texts).toContain('2,345.50');
    expect(texts).toContain('Index');
    expect(texts).toContain(
      (bars[99]?.close ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
    );
  });

  it('names the values of parameters that have options, and leaves out settings', () => {
    const chart = chartWithBars(100, { locale: 'en-US' });
    chart.indicators.add({ type: 'VWAP' });
    chart.indicators.add({ type: 'VWAP', params: { anchor: 2, band1: 2 } });
    // The smoothing of RSI and the averages of MACD are settings the legend leaves out.
    chart.indicators.add({ type: 'RSI', params: { maType: 3 } });
    chart.indicators.add({ type: 'MACD', params: { signalType: 1 } });
    chart.indicators.register<{ length: number; modes: readonly number[] }>({
      type: 'PICK',
      name: 'Pick',
      pane: 'new',
      precision: 2,
      params: {
        length: { default: 3 },
        modes: {
          default: [0, 1],
          options: [
            { value: 0, label: 'Fast' },
            { value: 1, label: 'Slow' }
          ]
        }
      },
      outputs: () => [{ key: 'v', label: 'V', plot: { kind: 'line' } }],
      lookback: () => 1,
      compute: () => [1]
    });
    chart.indicators.add({ type: 'PICK' });
    const texts = legend(chart);

    expect(texts).toContain('VWAP Session');
    expect(texts).toContain('VWAP Month');
    expect(texts).toContain('RSI 14');
    expect(texts).toContain('MACD 12 26 9');
    expect(texts).toContain('Pick 3 Fast Slow');
  });

  it('names the values of an indicator of several, and of one only in its title', () => {
    const chart = chartWithBars(120);
    chart.indicators.add({ type: 'MA', params: { periods: [9] } });
    chart.indicators.add({ type: 'EMA', params: { periods: [5, 10] } });
    const texts = legend(chart);

    expect(texts).toContain('MA 9');
    expect(texts.some((text) => text.startsWith('MA9'))).toBe(false);
    expect(texts.filter((text) => /^EMA(5|10) /.test(text))).toHaveLength(2);
  });
});

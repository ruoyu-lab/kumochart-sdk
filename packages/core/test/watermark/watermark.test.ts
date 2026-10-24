import { describe, expect, it } from 'vitest';
import { watermark } from '../../src/watermark';
import { createBars } from '../helpers/bars';
import { createModularChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** What the scene fills as text, with where and how large. */
function texts(chart: { element: HTMLElement; screenshot(): unknown }) {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls
    .filter((call) => call.name === 'fillText')
    .map((call) => ({
      text: String(call.args[0]),
      x: Number(call.args[1]),
      y: Number(call.args[2])
    }));
}

describe('the watermark', () => {
  it('shows its lines in the middle of the main pane, from the top down', () => {
    const chart = createModularChart({
      modules: [watermark()],
      watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
    });
    chart.data.set(createBars(50));
    const plot = chart.layout().panes[0]?.plot;
    const [symbol, timeframe] = texts(chart).filter(
      (each) => each.text === 'BTCUSDT' || each.text === '1h'
    );

    expect(symbol?.x).toBeCloseTo((plot?.width ?? 0) / 2);
    expect(timeframe?.x).toBeCloseTo((plot?.width ?? 0) / 2);
    // The two lines, 40 and 20 pixels in lines 1.25 as high, 75 pixels together, are centered.
    const middle = (plot?.height ?? 0) / 2;
    expect(symbol?.y).toBeCloseTo(middle - 37.5 + 25);
    expect(timeframe?.y).toBeCloseTo(middle - 37.5 + 50 + 12.5);
  });

  it('changes with its option, and shows nothing without lines', () => {
    const chart = createModularChart({ modules: [watermark()] });
    chart.data.set(createBars(50));

    expect(texts(chart).some((each) => each.text === 'ETHUSDT')).toBe(false);
    chart.applyOptions({ watermark: { lines: [{ text: 'ETHUSDT' }] } });
    expect(texts(chart).some((each) => each.text === 'ETHUSDT')).toBe(true);
    expect(() => {
      chart.applyOptions({ watermark: { lines: [{ text: 'X', size: 2 }] } });
    }).toThrow('options.watermark.lines[0].size');
    expect(() => {
      chart.applyOptions({ watermark: { color: 'reed' } });
    }).toThrow('options.watermark.color must be a CSS color');
  });
});

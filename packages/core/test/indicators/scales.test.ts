import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { chartWithBars } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** The texts painted on every layer. */
function texts(chart: Chart): string[] {
  const canvases = [...chart.element.querySelectorAll<HTMLCanvasElement>('canvas')];
  canvases.forEach((canvas) => {
    canvasCalls(canvas).length = 0;
  });
  chart.screenshot();
  return canvases.flatMap((canvas) =>
    canvasCalls(canvas)
      .filter((call) => call.name === 'fillText')
      .map((call) => String(call.args[0]))
  );
}

describe('indicators on price scales', () => {
  it('measure a percent scale from their first value in view, after their warm-up', () => {
    // Every bar is in view, the first nine in the warm-up of the average.
    const chart = chartWithBars(30, { locale: 'en-US' });
    const id = chart.indicators.add({ type: 'MA', pane: 'new', params: { periods: [10] } });
    const pane = chart.indicators.get(id)?.pane;
    const before = texts(chart).filter((text) => text.endsWith('%'));
    chart.priceScale(pane).setMode('percent');

    expect(chart.indicators.valuesAt(id, 0)[0]?.value).toBeNull();
    expect(texts(chart).filter((text) => text.endsWith('%')).length).toBeGreaterThan(before.length);
  });
});

describe('indicators moved to another pane', () => {
  const paneIds = (chart: Chart) => chart.panes.list().map((pane) => pane.id);

  it('move to a pane of their own, on its right scale, and back, the pane going with them', () => {
    const chart = chartWithBars(60);
    const ma = chart.indicators.add({ type: 'MA', scale: 'overlay' });
    chart.indicators.update(ma, { pane: 'new' });

    expect(chart.indicators.get(ma)).toMatchObject({ pane: ma, scale: 'right' });
    expect(paneIds(chart)).toEqual(['main', ma]);

    chart.indicators.update(ma, { pane: 'main' });

    expect(chart.indicators.get(ma)?.pane).toBe('main');
    expect(paneIds(chart)).toEqual(['main']);
  });

  it('join an existing pane and leave the one made for them', () => {
    const chart = chartWithBars(60);
    const rsi = chart.indicators.add({ type: 'RSI' });
    const macd = chart.indicators.add({ type: 'MACD' });
    const pane = chart.indicators.get(rsi)?.pane ?? '';
    chart.indicators.update(macd, { pane, scale: 'left' });

    expect(chart.indicators.get(macd)).toMatchObject({ pane, scale: 'left' });
    expect(paneIds(chart)).toEqual(['main', pane]);
  });

  it('fail for a pane that is not there, changing nothing', () => {
    const chart = chartWithBars(60);
    const rsi = chart.indicators.add({ type: 'RSI' });
    const before = chart.indicators.get(rsi);

    expect(() => {
      chart.indicators.update(rsi, { pane: 'nowhere', params: { period: 7 } });
    }).toThrow('Unknown pane "nowhere".');
    expect(chart.indicators.get(rsi)).toEqual(before);
  });
});

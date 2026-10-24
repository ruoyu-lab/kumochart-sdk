import { describe, expect, it } from 'vitest';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, type Chart } from '../helpers/chart';

const COUNT = 3000;

/** A chart scrolled to its latest bars, thousands of bars after the first. */
function scrolledChart(): Chart {
  const chart = chartWithBars(COUNT, { timeScale: { barSpacing: 6 } });
  chart.timeScale.scrollToRealTime();
  return chart;
}

/** Whether clicking at bar `index` and `price` selects the drawing `id`. */
function selects(chart: Chart, id: string, index: number, price: number): boolean {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  chart.select(null);
  click(chart, x, y);
  const selection = chart.selection();
  return selection?.kind === 'drawing' && selection.id === id;
}

describe('lines extended past their anchors', () => {
  it('cross the plot however far before it their anchors are', () => {
    const chart = scrolledChart();
    const price = chart.data.last()?.close ?? 0;
    const visible = COUNT - 20;
    const lines = [
      { type: 'ray', extend: {} },
      { type: 'extended-line', extend: {} },
      { type: 'trend-line', extend: { extendRight: true } }
    ].map(({ type, extend }) =>
      chart.drawings.add({
        type,
        points: [
          { time: T0 + 100 * MINUTE, price },
          { time: T0 + 110 * MINUTE, price }
        ],
        style: extend
      })
    );

    expect(chart.timeScale.timeToX(T0 + 100 * MINUTE)).toBeLessThan(-10_000);

    // The latest drawn is on top: each is hidden once clicked, for the one below.
    for (const id of lines.reverse()) {
      expect(selects(chart, id, visible, price)).toBe(true);
      chart.drawings.update(id, { visible: false });
    }
  });

  it('cross the plot from anchors after it, back to the left', () => {
    const chart = chartWithBars(COUNT, { timeScale: { barSpacing: 6 } });
    chart.timeScale.scrollToIndex(200, 'center');
    const price = chart.data.at(200)?.close ?? 0;
    const id = chart.drawings.add({
      type: 'trend-line',
      points: [
        { time: T0 + 2900 * MINUTE, price },
        { time: T0 + 2910 * MINUTE, price }
      ],
      style: { extendLeft: true }
    });

    expect(selects(chart, id, 200, price)).toBe(true);
  });
});

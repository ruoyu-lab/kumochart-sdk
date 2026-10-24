import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import { regression } from '../../src/drawings/tools/regression';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, drag } from '../helpers/chart';
import type { DrawingPointInput, DrawingStyle } from '../../src/drawings/types';

/** Chart coordinates of bar `index` at `price`. */
function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

const point = (index: number, price: number): DrawingPointInput => ({
  time: T0 + index * MINUTE,
  price
});

function add(
  chart: Chart,
  type: string,
  points: readonly DrawingPointInput[],
  style: Partial<DrawingStyle> = {}
): string {
  return chart.drawings.add({ type, points, style });
}

/** The drawing a click at bar `index` and `price` selects. */
function selectedAt(chart: Chart, index: number, price: number): string | null {
  chart.select(null);
  click(chart, ...at(chart, index, price));
  const selection = chart.selection();
  return selection?.kind === 'drawing' ? selection.id : null;
}

describe('hit testing', () => {
  it('takes a line over the inside of a shape drawn over it', () => {
    const chart = chartWithBars(200);
    const line = add(chart, 'horizontal-line', [point(100, 170)]);
    const box = add(chart, 'rectangle', [point(150, 160), point(180, 180)]);

    expect(selectedAt(chart, 165, 170)).toBe(line);
    expect(selectedAt(chart, 165, 175)).toBe(box);
  });

  it('takes the nearer of two lines, the one drawn over at the same distance', () => {
    const chart = chartWithBars(200);
    const lower = add(chart, 'horizontal-line', [point(100, 170)]);
    const upper = add(chart, 'horizontal-line', [point(100, 170.6)]);
    const same = add(chart, 'horizontal-line', [point(100, 170)]);

    expect(lower).not.toBe(same);
    expect(selectedAt(chart, 160, 170.05)).toBe(same);
    expect(selectedAt(chart, 160, 170.5)).toBe(upper);
  });

  it('takes no unfilled area: the inside of a rectangle without fill is the chart', () => {
    const chart = chartWithBars(200);
    const box = add(chart, 'rectangle', [point(150, 160), point(180, 180)], { fill: false });

    expect(selectedAt(chart, 165, 170)).toBeNull();
    expect(selectedAt(chart, 165, 180)).toBe(box);

    const before = chart.drawings.get(box)?.points;
    drag(chart, at(chart, 165, 170), at(chart, 175, 175));
    expect(chart.drawings.get(box)?.points).toEqual(before);
  });

  /** The base line of a regression of the closes of bars 150 to 180, at bar 165. */
  function fitted(): number {
    const bars = new BarStore();
    bars.set(createBars(200));
    const fit = regression(bars, T0 + 150 * MINUTE, T0 + 180 * MINUTE, 'close');
    return (fit?.start ?? 0) + (fit?.slope ?? 0) * 15;
  }

  const filled: Array<[string, DrawingPointInput[], Partial<DrawingStyle>, () => number]> = [
    [
      'fib-retracement',
      [point(150, 160), point(180, 180)],
      { levels: [{ value: 0 }, { value: 1 }] },
      () => 170
    ],
    // Its lines 2 deviations away, the base line hidden.
    [
      'regression-trend',
      [point(150, 0), point(180, 0)],
      { levels: [{ value: 2 }, { value: -2 }] },
      fitted
    ],
    ['parallel-channel', [point(150, 160), point(180, 170), point(150, 175)], {}, () => 168],
    ['circle', [point(165, 170), point(175, 170)], {}, () => 171]
  ];

  it.each(filled)(
    'takes the inside of a filled %s, and not without fill',
    (type, points, style, inside) => {
      const chart = chartWithBars(200);
      const id = add(chart, type, points, style);

      expect(selectedAt(chart, 165, inside())).toBe(id);

      chart.drawings.update(id, { style: { fill: false } });
      expect(selectedAt(chart, 165, inside())).toBeNull();
    }
  );

  it('takes the arrow and the label of a price range, and its box only filled', () => {
    const chart = chartWithBars(200);
    const id = add(chart, 'price-range', [point(150, 160), point(180, 180)], { fill: false });

    // The arrow runs down the middle.
    expect(selectedAt(chart, 165, 170)).toBe(id);
    expect(selectedAt(chart, 155, 170)).toBeNull();
    // Its border is not drawn.
    expect(selectedAt(chart, 150, 170)).toBeNull();

    chart.drawings.update(id, { style: { fill: true } });
    expect(selectedAt(chart, 155, 170)).toBe(id);
  });
});

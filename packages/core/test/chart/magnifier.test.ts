import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

const TOUCH = { pointerType: 'touch' } as const;

function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

/** How many layer copies the cursor layer drew in its last paint: two while the loupe shows. */
function loupeCopies(chart: Chart): number {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'drawImage').length;
}

describe('touch magnifier', () => {
  it('shows a loupe while a finger places an anchor, and hides it when it lifts', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('trend-line');
    const [x, y] = at(chart, 150, 170);
    pointer(chart, 'pointerdown', x, y, TOUCH);

    expect(loupeCopies(chart)).toBe(2);

    pointer(chart, 'pointermove', x + 20, y - 10, TOUCH);
    expect(loupeCopies(chart)).toBe(2);

    pointer(chart, 'pointerup', x + 20, y - 10, TOUCH);
    expect(loupeCopies(chart)).toBe(0);
  });

  it('shows it while a finger drags a drawing, never for a mouse', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }]
    });
    chart.select({ kind: 'drawing', id });
    const [x, y] = at(chart, 150, 170);
    pointer(chart, 'pointerdown', x, y, TOUCH);
    pointer(chart, 'pointermove', x, y - 30, TOUCH);

    expect(loupeCopies(chart)).toBe(2);
    pointer(chart, 'pointerup', x, y - 30, TOUCH);

    const [mx, my] = at(chart, 150, chart.drawings.get(id)?.points[0]?.price ?? 0);
    pointer(chart, 'pointerdown', mx, my);
    pointer(chart, 'pointermove', mx, my - 30);
    expect(loupeCopies(chart)).toBe(0);
    pointer(chart, 'pointerup', mx, my - 30);
  });

  it('can be turned off', () => {
    const chart = chartWithBars(200, { interaction: { touchMagnifier: false } });
    chart.drawings.startTool('trend-line');
    const [x, y] = at(chart, 150, 170);
    pointer(chart, 'pointerdown', x, y, TOUCH);

    expect(loupeCopies(chart)).toBe(0);
  });
});

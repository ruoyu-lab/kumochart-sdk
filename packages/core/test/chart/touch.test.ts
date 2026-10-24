import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { chartWithBars, pointer } from '../helpers/chart';

/** Puts finger `id` down, moves it or lifts it at chart coordinates. */
function finger(
  chart: Chart,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  id: number,
  x: number,
  y: number
): void {
  pointer(chart, type, x, y, { pointerType: 'touch', pointerId: id });
}

describe('pinch zoom', () => {
  it('zooms by how far the fingers move apart across the chart', () => {
    const chart = chartWithBars(300);
    const spacing = chart.timeScale.barSpacing();
    finger(chart, 'pointerdown', 1, 300, 150);
    finger(chart, 'pointerdown', 2, 400, 150);
    finger(chart, 'pointermove', 2, 500, 150);

    expect(chart.timeScale.barSpacing()).toBeCloseTo(spacing * 2);
  });

  it('waits for fingers placed one above the other to move apart across the chart', () => {
    const chart = chartWithBars(300);
    const spacing = chart.timeScale.barSpacing();
    finger(chart, 'pointerdown', 1, 300, 100);
    finger(chart, 'pointerdown', 2, 300, 250);
    finger(chart, 'pointermove', 2, 310, 250);

    expect(chart.timeScale.barSpacing()).toBe(spacing);

    finger(chart, 'pointermove', 2, 400, 250);
    finger(chart, 'pointermove', 2, 500, 250);
    expect(chart.timeScale.barSpacing()).toBeCloseTo(spacing * 2);
  });
});

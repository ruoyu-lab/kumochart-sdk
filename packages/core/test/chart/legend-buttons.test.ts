import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { LegendItem } from '../../src/options/types';
import { chartWithBars, nextFrame, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

const CROSS = 'M6 6L18 18M18 6L6 18';

/** Texts the cursor layer writes when it repaints. */
function legendTexts(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

describe('legend rows', () => {
  it('list visible indicators, and hidden ones too when asked', () => {
    const chart = chartWithBars(120);
    chart.indicators.add({ id: 'ma', type: 'MA', visible: false });

    expect(legendTexts(chart).some((text) => text.startsWith('MA'))).toBe(false);

    chart.applyOptions({ legend: { rows: () => true } });
    expect(legendTexts(chart).some((text) => text.startsWith('MA'))).toBe(true);
    expect(() => {
      chart.applyOptions({ legend: { rows: true as never } });
    }).toThrow('options.legend.rows must be a function');
  });
});

describe('legend buttons', () => {
  it('show on the row under the pointer, and report their clicks', async () => {
    const buttons = vi.fn((item: LegendItem) =>
      item.kind === 'main'
        ? [{ id: 'settings', icon: CROSS }]
        : [
            { id: 'hide', icon: CROSS },
            { id: 'remove', icon: CROSS }
          ]
    );
    const chart = chartWithBars(120, { legend: { buttons } });
    const clicks = vi.fn();
    chart.on('legendButtonClick', clicks);
    await nextFrame();
    expect(buttons).not.toHaveBeenCalled();

    // The main series' row starts at the top left of the plot, its buttons first.
    pointer(chart, 'pointermove', 40, 10, { buttons: 0 });
    await nextFrame();
    await nextFrame();
    expect(buttons).toHaveBeenCalledWith(expect.objectContaining({ kind: 'main', id: 'main' }));

    const size = chart.options().font.size + 5;
    const at = { x: 8 + size / 2, y: 4 + size / 2 };
    pointer(chart, 'pointermove', at.x, at.y, { buttons: 0 });
    await nextFrame();
    await nextFrame();
    expect(chart.element.style.cursor).toBe('pointer');

    const range = chart.timeScale.visibleLogicalRange();
    pointer(chart, 'pointerdown', at.x, at.y);
    pointer(chart, 'pointermove', at.x + 60, at.y);
    pointer(chart, 'pointerup', at.x, at.y);

    expect(clicks).toHaveBeenCalledWith({
      item: { kind: 'main', id: 'main', type: null, paneId: 'main', visible: true },
      buttonId: 'settings'
    });
    // Pressing a button does not pan the chart.
    expect(chart.timeScale.visibleLogicalRange()).toEqual(range);
  });

  it('take the place of the values while they show, unless asked to keep them', async () => {
    const buttons = () => [{ id: 'settings', icon: CROSS }];
    const shown = async (keep: boolean) => {
      const chart = chartWithBars(120, { legend: { buttons, hideValuesOnHover: !keep } });
      chart.indicators.add({ id: 'ma', type: 'MA' });
      // With the crosshair, as on the legend: its labels count too.
      pointer(chart, 'pointermove', 300, 200, { buttons: 0 });
      await nextFrame();
      const values = legendTexts(chart).length;
      pointer(chart, 'pointermove', 40, 10, { buttons: 0 });
      await nextFrame();
      await nextFrame();
      const hovered = legendTexts(chart);
      // The hovered row stays as wide: the pointer on its hidden values keeps the buttons.
      const width = chart.layout().plotWidth;
      pointer(chart, 'pointermove', Math.min(width - 10, 200), 10, { buttons: 0 });
      await nextFrame();
      await nextFrame();
      return { values, hovered, after: legendTexts(chart) };
    };

    const hidden = await shown(false);
    expect(hidden.hovered.length).toBeLessThan(hidden.values);
    expect(hidden.hovered.some((text) => text.startsWith('MA'))).toBe(true);
    // Another bar is under the pointer there, with other values: the same texts, not the same values.
    expect(hidden.after).toHaveLength(hidden.hovered.length);

    const kept = await shown(true);
    expect(kept.hovered).toHaveLength(kept.values);
  });

  it('need a function', () => {
    expect(() => chartWithBars(10, { legend: { buttons: [] as never } })).toThrow(
      'options.legend.buttons must be a function'
    );
  });
});

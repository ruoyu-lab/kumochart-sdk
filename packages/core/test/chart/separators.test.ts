import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaneResizeEvent } from '../../src/chart/events';
import type { Chart } from '../helpers/chart';
import { chartWithBars, nextFrame, pointer } from '../helpers/chart';

afterEach(() => {
  vi.useRealTimers();
});

/** The color and width of every line the scene strokes when it repaints. */
function strokes(chart: Chart): Array<{ color: unknown; width: unknown }> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D;
  const seen: Array<{ color: unknown; width: unknown }> = [];
  ctx.stroke = () => {
    seen.push({ color: ctx.strokeStyle, width: ctx.lineWidth });
  };
  chart.applyOptions({});
  chart.screenshot();
  return seen;
}

function separatorY(chart: Chart): number {
  const separator = chart.layout().separators[0];
  return (separator?.y ?? 0) + (separator?.height ?? 0) / 2;
}

describe('pane separators', () => {
  it('draw a line of the width and colors set, the hover color under the pointer', async () => {
    const chart = chartWithBars(200, {
      panes: { separatorWidth: 3, separatorColor: '#123456', separatorHoverColor: '#abcdef' }
    });
    chart.indicators.add({ type: 'MACD' });

    expect(strokes(chart)).toContainEqual({ color: '#123456', width: 3 });

    pointer(chart, 'pointermove', 100, separatorY(chart), { buttons: 0 });
    await nextFrame();
    expect(strokes(chart)).toContainEqual({ color: '#abcdef', width: 3 });
    expect(chart.element.style.cursor).toBe('row-resize');

    pointer(chart, 'pointermove', 100, 40, { buttons: 0 });
    await nextFrame();
    const after = strokes(chart);
    expect(after).toContainEqual({ color: '#123456', width: 3 });
    expect(after).not.toContainEqual({ color: '#abcdef', width: 3 });
  });

  it('are 2 pixels wide by default, in the theme colors', () => {
    const chart = chartWithBars(200);
    chart.indicators.add({ type: 'MACD' });
    const { border } = chart.options().theme;

    expect(chart.options().panes.separatorWidth).toBe(2);
    expect(strokes(chart)).toContainEqual({ color: border, width: 2 });
    expect(() => chartWithBars(10, { panes: { separatorWidth: -1 } })).toThrow('separatorWidth');
  });

  it('hide the crosshair while they are hovered and dragged', async () => {
    const chart = chartWithBars(200);
    chart.indicators.add({ type: 'MACD' });
    pointer(chart, 'pointermove', 100, 40, { buttons: 0 });
    await nextFrame();
    expect(chart.crosshair.get()).not.toBeNull();

    const y = separatorY(chart);
    pointer(chart, 'pointermove', 100, y, { buttons: 0 });
    await nextFrame();
    expect(chart.crosshair.get()).toBeNull();

    pointer(chart, 'pointerdown', 100, y);
    pointer(chart, 'pointermove', 100, y - 30);
    await nextFrame();
    expect(chart.crosshair.get()).toBeNull();
    pointer(chart, 'pointerup', 100, y - 30);
  });
});

describe('dragging a separator while the panes do not fit', () => {
  it('moves the separator with the pointer and leaves the other panes as they are', () => {
    const chart = chartWithBars(200);
    chart.panes.add({ id: 'a', height: 300 });
    chart.panes.add({ id: 'b', height: 300 });
    const shown = () => chart.layout().panes.map((pane) => Math.round(pane.plot.height));
    const [main = 0, a = 0, b = 0] = shown();
    const resizes = vi.fn<(event: PaneResizeEvent) => void>();
    chart.on('paneResize', resizes);

    expect(a).toBe(b);
    expect(a).toBeLessThan(300);

    const y = separatorY(chart);
    pointer(chart, 'pointerdown', 100, y);
    pointer(chart, 'pointermove', 100, y + 10);

    expect(shown()).toEqual([main + 10, a - 10, b]);

    pointer(chart, 'pointerup', 100, y + 10);
    expect(shown()).toEqual([main + 10, a - 10, b]);
    expect(resizes.mock.calls.map(([event]) => event)).toEqual([
      { paneId: 'a', height: chart.panes.get('a')?.height },
      { paneId: 'b', height: chart.panes.get('b')?.height }
    ]);
  });

  it('gives the panes back their heights when the drag is cancelled', () => {
    const chart = chartWithBars(200);
    chart.panes.add({ id: 'a', height: 300 });
    chart.panes.add({ id: 'b', height: 300 });
    const y = separatorY(chart);
    pointer(chart, 'pointerdown', 100, y);
    pointer(chart, 'pointermove', 100, y + 10);
    pointer(chart, 'pointercancel', 100, y + 10);

    expect(chart.panes.list().map((pane) => pane.height)).toEqual([
      chart.panes.get('main')?.height,
      300,
      300
    ]);
  });
});

describe('the crosshair while the bars move', () => {
  it('follows the pointer itself, and snaps to a bar once the pointer moves after they rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const chart = chartWithBars(400);
    const spacing = chart.timeScale.barSpacing();
    // Between two bar centers.
    const x = Math.round(chart.layout().plotWidth / 2) + spacing / 3;
    pointer(chart, 'pointermove', x, 100, { buttons: 0 });
    await nextFrame();
    const snapped = chart.crosshair.get()?.x ?? 0;
    expect(Math.abs(snapped - x)).toBeGreaterThan(0.5);

    chart.element.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 37, clientX: x, clientY: 100, cancelable: true })
    );
    await nextFrame();
    expect(chart.crosshair.get()?.x).toBe(x);

    // At rest under a pointer that keeps still, the line stays.
    vi.advanceTimersByTime(200);
    chart.applyOptions({});
    expect(chart.crosshair.get()?.x).toBe(x);

    pointer(chart, 'pointermove', x + 1, 100, { buttons: 0 });
    const rest = chart.crosshair.get();
    expect(rest?.x).not.toBe(x + 1);
    expect(Math.abs((rest?.x ?? 0) - x - 1)).toBeLessThanOrEqual(spacing / 2);
  });

  it('is where the pointer is in any frame painted after it moves', () => {
    const chart = chartWithBars(400);
    pointer(chart, 'pointermove', 200, 100, { buttons: 0 });
    pointer(chart, 'pointermove', 260, 120, { buttons: 0 });

    // Before the hover is handled in the next animation frame.
    expect(chart.crosshair.get()).toMatchObject({ y: 120 });
    expect(Math.abs((chart.crosshair.get()?.x ?? 0) - 260)).toBeLessThanOrEqual(
      chart.timeScale.barSpacing() / 2
    );
  });
});

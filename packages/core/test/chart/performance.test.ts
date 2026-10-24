import { afterEach, describe, expect, it, vi } from 'vitest';
import { blend, withAlpha } from '../../src/canvas/color';
import type { ChartCore } from '../../src/chart/chart-core';
import { defineModule } from '../../src/chart/modules';
import { createBars } from '../helpers/bars';
import { chartWithBars, createModularChart, nextFrame, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** A chart with bars, and a count of the frames it builds. */
function countingChart() {
  let core: ChartCore | null = null;
  const probe = defineModule({
    name: 'probe',
    install: (installed) => {
      core = installed;
      return {};
    }
  });
  const chart = createModularChart({ modules: [probe] });
  chart.data.set(createBars(300));
  chart.screenshot();
  const settle = vi.spyOn((core as unknown as ChartCore).timeScale, 'settle');
  return { chart, builds: () => settle.mock.calls.length };
}

describe('frames built for input', () => {
  it('are one a frame while panning and zooming', async () => {
    const { chart, builds } = countingChart();
    pointer(chart, 'pointerdown', 300, 200);
    pointer(chart, 'pointermove', 320, 200);
    await nextFrame();
    const start = builds();

    for (let step = 1; step <= 5; step += 1) {
      pointer(chart, 'pointermove', 320 + step * 10, 200);
      chart.element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -40, clientX: 300, clientY: 200, cancelable: true })
      );
    }

    expect(builds()).toBe(start);

    await nextFrame();
    await nextFrame();
    expect(builds()).toBeLessThanOrEqual(start + 2);
    pointer(chart, 'pointerup', 370, 200);
  });
});

describe('the wheel and the hover', () => {
  function calls(chart: ReturnType<typeof chartWithBars>, layer: string) {
    const canvas = chart.element.querySelector<HTMLCanvasElement>(`canvas[data-layer="${layer}"]`);
    const recorded = canvas ? canvasCalls(canvas) : [];
    recorded.length = 0;
    return recorded;
  }

  it('zoom in the frame that paints the zoom', async () => {
    const chart = chartWithBars(300);
    chart.screenshot();
    const spacing = chart.timeScale.barSpacing();
    const scene = calls(chart, 'scene');
    chart.element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 200, cancelable: true })
    );
    await nextFrame();

    expect(chart.timeScale.barSpacing()).toBeGreaterThan(spacing);
    expect(scene.length).toBeGreaterThan(0);
  });

  it('highlight what is under the pointer in the frame after it moves there', async () => {
    const chart = chartWithBars(300);
    const price = chart.data.last()?.close ?? 0;
    chart.orders.set([{ id: 'o', side: 'buy', price }]);
    chart.screenshot();
    const y = chart.priceScale().priceToY(price) ?? 0;
    const objects = calls(chart, 'objects');
    pointer(chart, 'pointermove', 300, y, { buttons: 0 });
    await nextFrame();

    expect(objects.length).toBeGreaterThan(0);
    expect(chart.element.style.cursor).not.toBe('crosshair');
  });
});

describe('a view that cannot move', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('stops a fling at the oldest bar', async () => {
    const { chart, builds } = countingChart();
    chart.timeScale.scrollToIndex(0, 'left');
    chart.screenshot();
    pointer(chart, 'pointerdown', 200, 200);

    for (let step = 1; step <= 4; step += 1) {
      await wait(8);
      pointer(chart, 'pointermove', 200 + step * 60, 200);
    }

    pointer(chart, 'pointerup', 440, 200);
    await nextFrame();
    const released = builds();

    for (let frame = 0; frame < 6; frame += 1) {
      await nextFrame();
    }

    expect(builds()).toBe(released);
  });

  it('builds no frame for a zoom past the widest bars', async () => {
    const { chart, builds } = countingChart();
    chart.timeScale.setBarSpacing(chart.options().timeScale.maxBarSpacing);
    chart.screenshot();
    const before = builds();

    for (let turn = 0; turn < 3; turn += 1) {
      chart.element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 200, cancelable: true })
      );
      await nextFrame();
    }

    expect(builds()).toBe(before);
  });
});

describe('styles and colors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are worked out again only when what they come from changes', () => {
    const chart = chartWithBars(100);
    const defaultStyle = vi.fn(() => ({ color: '#123456' }));
    chart.series.register({ type: 'probe', input: 'value', defaultStyle, paint: () => undefined });
    chart.series.add({
      type: 'probe',
      lastValueLabel: true,
      data: createBars(100).map((bar) => ({ time: bar.time, value: bar.close }))
    });
    chart.screenshot();
    defaultStyle.mockClear();
    chart.applyOptions({});
    chart.screenshot();

    expect(defaultStyle).not.toHaveBeenCalled();

    chart.applyOptions({ theme: { up: '#00ff00' } });
    chart.screenshot();
    expect(defaultStyle).toHaveBeenCalledTimes(1);
  });

  it('parse a color once', () => {
    withAlpha('#2a6f97', 0.5);
    blend('#2a6f97', '#ffffff', 0.4);
    const exec = vi.spyOn(RegExp.prototype, 'exec');

    expect(withAlpha('#2a6f97', 0.5)).toBe('rgba(42, 111, 151, 0.5)');
    expect(blend('#2a6f97', '#ffffff', 0.4)).toBe('rgb(170, 197, 213)');
    expect(exec).not.toHaveBeenCalled();
  });
});

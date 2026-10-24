import { describe, expect, it, vi } from 'vitest';
import { chartTypes } from '../../src/chart-types/module';
import { createChart } from '../../src/chart/create-chart';
import type { CrosshairMoveEvent } from '../../src/chart/events';
import type { BarInput } from '../../src/data/types';
import { darkTheme, lightTheme } from '../../src/options/themes';
import { lineSeries } from '../../src/series/lines';
import { ChartError } from '../../src/utils/errors';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart, pointer } from '../helpers/chart';
import { canvasCalls, resizeObservers } from '../setup';

describe('createChart', () => {
  it('builds its own element with three canvases and removes it on destroy', () => {
    const chart = createTestChart();
    const container = chart.element.parentElement;

    expect(chart.element.querySelectorAll('canvas')).toHaveLength(3);
    expect(resizeObservers.size).toBe(1);

    chart.destroy();

    expect(container?.children).toHaveLength(0);
    expect(resizeObservers.size).toBe(0);
    expect(() => {
      chart.data.set([]);
    }).toThrow('destroyed');
  });

  it('sizes the canvases to whole device pixels and repaints them right after a resize', () => {
    const ratio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });

    try {
      const chart = chartWithBars(100);
      const scene = chart.element.querySelector('canvas') as HTMLCanvasElement;
      const calls = canvasCalls(scene);
      calls.length = 0;
      resizeObservers.forEach((observer) => {
        observer.report(800.5, 661.5);
      });

      expect([scene.width, scene.height]).toEqual([1601, 1323]);
      expect([scene.style.width, scene.style.height]).toEqual(['800.5px', '661.5px']);
      expect(chart.layout().height).toBe(661.5);
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      if (ratio) {
        Object.defineProperty(window, 'devicePixelRatio', ratio);
      }
    }
  });

  it('rejects a missing container and invalid options', () => {
    expect(() => createChart(null as unknown as HTMLElement)).toThrow(ChartError);
    expect(() => createTestChart({ timeScale: { barSpacing: -1 } })).toThrow(
      'options.timeScale.barSpacing'
    );
  });

  it('applies options atomically', () => {
    const chart = createTestChart();
    const before = chart.options();

    expect(() => {
      chart.applyOptions({ theme: lightTheme, crosshair: { mode: 'sticky' as 'free' } });
    }).toThrow();
    expect(chart.options()).toBe(before);

    chart.applyOptions({ theme: lightTheme });
    expect(chart.options().theme.background).toBe(lightTheme.background);
  });

  it('applies nothing of options the bars cannot take', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(createBars(30), { interval: '1m' });
    const before = chart.options();
    const bars = chart.data.toArray();

    expect(() => {
      chart.applyOptions({
        timeScale: { rightOffset: 5 },
        calendar: { bucket: () => 'soon' as unknown as number }
      });
    }).toThrow();
    expect(chart.options()).toBe(before);
    expect(chart.data.toArray()).toEqual(bars);
    expect(chart.data.calendar().bucket(T0 + 90_000, '1m')).toBe(T0 + MINUTE);
  });

  it('leaves nothing in the container when a module fails to join', () => {
    const container = document.createElement('div');
    const failing = chartTypes([{ series: { ...lineSeries, type: 'candles' } }]);

    expect(() => createChart(container, { modules: [failing] })).toThrow(
      'A series type "candles" is already registered'
    );
    expect(container.children).toHaveLength(0);
  });

  it('freezes resolved options and themes but leaves arrays passed in untouched', () => {
    const palette: [string, ...string[]] = ['#111111', '#222222'];
    const chart = createTestChart({ theme: { palette } });

    expect(Object.isFrozen(chart.options().theme.palette)).toBe(true);
    expect(Object.isFrozen(darkTheme)).toBe(true);
    expect(Object.isFrozen(palette)).toBe(false);
    expect(chart.options().theme.palette).toEqual(palette);
  });

  it('cancels a gesture in progress on destroy without notifying anyone', () => {
    const chart = chartWithBars(200);
    chart.orders.set([{ id: 'o1', side: 'buy', price: 180 }]);
    const drags = vi.fn();
    chart.on('orderDrag', drags);
    const x = chart.timeScale.timeToX(T0 + 120 * MINUTE) ?? 0;
    const y = chart.priceScale().priceToY(180) ?? 0;
    pointer(chart, 'pointerdown', x, y);
    pointer(chart, 'pointermove', x, y - 40);
    drags.mockClear();

    expect(() => {
      chart.destroy();
    }).not.toThrow();
    expect(drags).not.toHaveBeenCalled();
  });
});

describe('data', () => {
  it('follows new bars while the latest bar is visible', () => {
    const chart = chartWithBars(200);
    const before = chart.timeScale.visibleRange();
    chart.data.update(createBars(201).slice(200));
    const after = chart.timeScale.visibleRange();

    expect(after?.to).toBe(T0 + 200 * MINUTE);
    expect(after?.from).toBe((before?.from ?? 0) + MINUTE);
  });

  it('keeps the view on history while the latest bar is scrolled out', () => {
    const chart = chartWithBars(400);
    chart.timeScale.scrollToIndex(100, 'center');
    const before = chart.timeScale.visibleRange();
    chart.data.update(createBars(405).slice(400));

    expect(chart.timeScale.visibleRange()).toEqual(before);
  });

  it('keeps the view when history is prepended', () => {
    const all = createBars(300);
    const chart = createTestChart();
    chart.data.set(all.slice(100));
    const before = chart.timeScale.visibleRange();

    expect(chart.data.prepend(all.slice(0, 110))).toBe(100);
    expect(chart.timeScale.visibleRange()).toEqual(before);
    expect(chart.data.length).toBe(300);
  });

  it('keeps following new bars while the container is hidden', () => {
    const chart = createTestChart(undefined, 0, 500);
    chart.data.set(createBars(200));
    chart.data.update(createBars(205).slice(200));
    resizeObservers.forEach((observer) => {
      observer.report(800, 500);
    });

    expect(chart.timeScale.isFollowing()).toBe(true);
    expect(chart.timeScale.visibleRange()?.to).toBe(T0 + 204 * MINUTE);
  });

  it('shows a view asked for while the container is hidden once it has a size', () => {
    const show = () => {
      resizeObservers.forEach((observer) => {
        observer.report(800, 500);
      });
    };
    const fitted = createTestChart(undefined, 0, 0);
    fitted.data.set(createBars(200));
    fitted.timeScale.fitContent();
    show();
    const range = fitted.timeScale.visibleLogicalRange();

    expect(range?.from).toBeLessThanOrEqual(0);
    expect(range?.to).toBeGreaterThanOrEqual(199);

    resizeObservers.clear();
    const centered = createTestChart(undefined, 0, 0);
    centered.data.set(createBars(400));
    centered.timeScale.scrollToIndex(100, 'center');
    show();
    const view = centered.timeScale.visibleLogicalRange();

    expect(((view?.from ?? 0) + (view?.to ?? 0)) / 2).toBeCloseTo(100, 0);

    resizeObservers.clear();
    const latest = createTestChart(undefined, 0, 0);
    latest.data.set(createBars(400));
    latest.timeScale.fitContent();
    // The view asked for last wins.
    latest.timeScale.scrollToRealTime();
    show();

    expect(latest.timeScale.barSpacing()).toBe(latest.options().timeScale.barSpacing);
  });

  it('takes from the page only the keys it does something with', () => {
    const chart = chartWithBars(50);
    const press = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      chart.element.dispatchEvent(event);
      return event.defaultPrevented;
    };

    // The browser's: zooming the page, going back, closing what Escape closes.
    expect(press('-', { ctrlKey: true })).toBe(false);
    expect(press('=', { metaKey: true })).toBe(false);
    expect(press('ArrowLeft', { altKey: true })).toBe(false);
    expect(press('Escape')).toBe(false);
    // Nothing to undo, delete or paste.
    expect(press('z', { ctrlKey: true })).toBe(false);
    expect(press('Delete')).toBe(false);
    expect(press('v', { metaKey: true })).toBe(false);
    // The chart's.
    expect(press('ArrowLeft')).toBe(true);
    expect(press('-')).toBe(true);

    chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 10 * MINUTE, price: 100 }]
    });
    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(chart.drawings.list()).toHaveLength(0);
  });

  it('copies inputs and validates them', () => {
    const chart = createTestChart();
    const bars = createBars(3);
    chart.data.set(bars);
    bars[0]!.close = 999;

    expect(chart.data.at(0)?.close).not.toBe(999);
    expect(() => {
      chart.data.update(createBars(2)[0]!);
    }).toThrow('older than the last bar');
    expect(() => {
      chart.data.set([null as unknown as BarInput]);
    }).toThrow('bars[0] must be an object, received null');
  });
});

describe('loadMore', () => {
  it('fires once near the oldest bar, not on every tick, and again after more history arrives', () => {
    const all = createBars(600);
    const chart = createTestChart({ timeScale: { loadMoreThreshold: 10 } });
    const requests: number[] = [];
    chart.on('loadMore', ({ before }) => requests.push(before));
    chart.data.set(all.slice(300));
    chart.timeScale.scrollToIndex(0, 'left');
    chart.timeScale.visibleRange();

    expect(requests).toEqual([all[300]!.time]);

    for (let tick = 0; tick < 5; tick += 1) {
      chart.data.update({ ...all[599]!, close: all[599]!.close + tick * 0.01 });
      chart.timeScale.visibleRange();
    }

    expect(requests).toHaveLength(1);

    chart.data.prepend(all.slice(0, 300));
    chart.timeScale.scrollToIndex(0, 'left');
    chart.timeScale.visibleRange();

    expect(requests).toEqual([all[300]!.time, all[0]!.time]);
  });
});

describe('time scale', () => {
  it('converts between times and coordinates', () => {
    const chart = chartWithBars(200);
    const time = T0 + 150 * MINUTE;
    const x = chart.timeScale.timeToX(time);

    expect(x).not.toBeNull();
    expect(chart.timeScale.xToTime(x ?? 0)).toBeCloseTo(time);
  });

  it('checks the coordinates and indices it converts, as it checks those it scrolls to', () => {
    const chart = chartWithBars(200);
    const scale = chart.priceScale();

    expect(() => chart.timeScale.indexToX(Number.NaN)).toThrow(
      'index must be a finite number, received NaN.'
    );
    expect(() => chart.timeScale.xToIndex(Number.POSITIVE_INFINITY)).toThrow(
      'x must be a finite number, received Infinity.'
    );
    expect(() => chart.timeScale.xToTime('300' as never)).toThrow(
      'x must be a finite number, received "300".'
    );
    expect(() => scale.priceToY(Number.NaN)).toThrow('price must be a finite number');
    expect(() => scale.yToPrice(Number.NaN)).toThrow('y must be a finite number');
    expect(() => {
      chart.timeScale.scrollToIndex(Number.NaN);
    }).toThrow('index must be a finite number, received NaN.');
    expect(chart.timeScale.xToIndex(chart.timeScale.indexToX(120) ?? 0)).toBeCloseTo(120);
  });

  it('shows a requested time range', () => {
    const chart = chartWithBars(200);
    chart.timeScale.setVisibleRange({ from: T0 + 50 * MINUTE, to: T0 + 80 * MINUTE });

    expect(chart.timeScale.visibleRange()).toEqual({
      from: T0 + 50 * MINUTE,
      to: T0 + 80 * MINUTE
    });
  });

  it('pans with a mouse drag and reports visible range changes after the operation', async () => {
    const chart = chartWithBars(400);
    const changes = vi.fn();
    chart.on('visibleRangeChange', changes);
    const before = chart.timeScale.visibleRange();
    pointer(chart, 'pointerdown', 300, 200);
    pointer(chart, 'pointermove', 340, 200);
    pointer(chart, 'pointermove', 400, 200);
    pointer(chart, 'pointerup', 400, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chart.timeScale.visibleRange()?.from).toBeLessThan(before?.from ?? 0);
    expect(changes).toHaveBeenCalled();
  });
});

describe('events', () => {
  it('dispatches events after the operation, so listeners can call back into the chart', () => {
    const chart = createTestChart();
    const seen: string[] = [];
    chart.on('visibleRangeChange', () => {
      seen.push(`length ${chart.data.length}`);
      chart.timeScale.scrollToRealTime();
    });
    chart.batch(() => {
      chart.data.set(createBars(50));
      seen.push('set done');
    });
    chart.timeScale.visibleRange();

    expect(seen[0]).toBe('set done');
    expect(seen).toContain('length 50');
  });

  it('dispatches the events of a read after it, as of any call', () => {
    const chart = chartWithBars(400);
    chart.layout();
    chart.timeScale.scrollToIndex(100, 'center');
    const order: string[] = [];
    chart.on('visibleRangeChange', () => {
      order.push('visibleRangeChange');
      chart.timeScale.scrollToRealTime();
    });
    const range = chart.timeScale.visibleRange();
    order.push('read');

    // The range of the view the read saw, not of the one its listener moved to.
    expect(range?.to).toBeLessThan(T0 + 300 * MINUTE);
    expect(order).toEqual(['visibleRangeChange', 'read']);
    expect(chart.timeScale.isFollowing()).toBe(true);
  });

  it('emits crosshairMove for pointer movement once per frame, not for programmatic positions', async () => {
    const chart = chartWithBars(200);
    const moves = vi.fn();
    chart.on('crosshairMove', moves);
    chart.crosshair.set({ time: T0 + 180 * MINUTE });
    chart.screenshot();

    expect(moves).not.toHaveBeenCalled();
    expect(chart.crosshair.get()?.time).toBe(T0 + 180 * MINUTE);

    pointer(chart, 'pointermove', 200, 100, { buttons: 0 });
    pointer(chart, 'pointermove', 210, 100, { buttons: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    chart.screenshot();

    expect(moves).toHaveBeenCalledTimes(1);
    expect(moves.mock.calls[0]?.[0]).toMatchObject({ visible: true, paneId: 'main' });
  });

  it('hides a programmatic crosshair with set(null)', () => {
    const chart = chartWithBars(200);
    chart.crosshair.set({ time: T0 + 180 * MINUTE });
    chart.crosshair.set(null);

    expect(chart.crosshair.get()).toBeNull();
  });

  it('emits crosshairMove when what is under a pointer at rest changes', () => {
    const chart = chartWithBars(200);
    const x = chart.timeScale.timeToX(T0 + 199 * MINUTE) ?? 0;
    pointer(chart, 'pointermove', x, 100, { buttons: 0 });
    chart.screenshot();
    const moves = vi.fn<(event: CrosshairMoveEvent) => void>();
    chart.on('crosshairMove', moves);

    // The latest bar under the pointer changes.
    chart.data.update([{ time: T0 + 199 * MINUTE, open: 200, high: 500, low: 199, close: 500 }]);
    chart.screenshot();
    expect(moves).toHaveBeenCalledTimes(1);
    expect(moves.mock.calls[0]?.[0]).toMatchObject({ visible: true, bar: { close: 500 } });

    // The bars scroll under the pointer.
    chart.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    chart.screenshot();
    expect(moves).toHaveBeenCalledTimes(2);
    expect(moves.mock.calls[1]?.[0]).toMatchObject({ visible: true });
    expect(moves.mock.calls[1]?.[0]).not.toMatchObject({ time: T0 + 199 * MINUTE });

    // Nothing changed: nothing to tell.
    chart.applyOptions({});
    chart.screenshot();
    expect(moves).toHaveBeenCalledTimes(2);
  });

  it('puts a programmatic crosshair past the data where a bar of its time would be', () => {
    const chart = chartWithBars(200);
    const last = 199;
    // The bars are a minute apart; the latest one's period runs a minute.
    const at = (time: number) => {
      chart.crosshair.set({ time });
      return chart.crosshair.get();
    };

    expect(at(T0 + last * MINUTE + 30_000)).toMatchObject({ index: last });
    expect(at(T0 + (last + 2) * MINUTE)).toMatchObject({
      index: last + 2,
      bar: null,
      x: chart.timeScale.indexToX(last + 2)
    });
    chart.timeScale.setVisibleLogicalRange({ from: -10, to: 60 });
    expect(at(T0 - 3 * MINUTE)).toMatchObject({ index: -3, bar: null });
    expect(at(T0 + 40 * MINUTE)).toMatchObject({ index: 40 });
  });

  it('keeps the horizontal crosshair line at the pointer unless the magnet mode is on', async () => {
    const chart = chartWithBars(200);
    pointer(chart, 'pointermove', 200, 120, { buttons: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    chart.screenshot();
    const free = chart.crosshair.get();

    expect(free?.y).toBe(120);
    expect(free?.price).not.toBe(free?.bar?.close);

    chart.applyOptions({ crosshair: { mode: 'magnet' } });
    pointer(chart, 'pointermove', 200, 120, { buttons: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    chart.screenshot();
    const magnet = chart.crosshair.get();

    expect(magnet?.price).toBe(magnet?.bar?.close);
    expect(magnet?.x).toBe(free?.x);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/chart/modules';
import { createBars } from '../helpers/bars';
import { chartWithBars, createModularChart, pointer } from '../helpers/chart';
import { resizeObservers } from '../setup';

/** Errors thrown by listeners of the page's events, which the browser reports on the window. */
const uncaught: unknown[] = [];
const report = (event: ErrorEvent) => {
  uncaught.push(event.error);
  event.preventDefault();
};

beforeEach(() => {
  uncaught.length = 0;
  window.addEventListener('error', report);
});

afterEach(() => {
  window.removeEventListener('error', report);
});

describe('destroying a chart from its own events', () => {
  it('ends a tap whose click listener destroyed the chart', () => {
    const chart = chartWithBars(100);
    chart.on('click', () => {
      chart.destroy();
    });
    pointer(chart, 'pointerdown', 200, 100, { pointerType: 'touch' });
    pointer(chart, 'pointerup', 200, 100, { pointerType: 'touch' });

    expect(uncaught).toEqual([]);
    expect(chart.element.isConnected).toBe(false);
  });

  it('ends a pan whose visible range listener destroyed the chart', () => {
    const chart = chartWithBars(100);
    chart.priceScale().setRange({ min: 0, max: 1000 });
    chart.layout();
    chart.on('visibleRangeChange', () => {
      chart.destroy();
    });
    pointer(chart, 'pointerdown', 200, 100);
    pointer(chart, 'pointermove', 260, 140);
    pointer(chart, 'pointermove', 300, 160);
    pointer(chart, 'pointerup', 300, 160);

    expect(uncaught).toEqual([]);
  });
});

describe('destroying a chart', () => {
  it('detaches every plugin and releases everything when one fails to detach', () => {
    const chart = chartWithBars(100);
    const failure = new Error('detach failed');
    const second = vi.fn();
    chart.plugins.add({
      name: 'first',
      detach: () => {
        throw failure;
      }
    });
    chart.plugins.add({ name: 'second', detach: second });

    expect(() => {
      chart.destroy();
    }).toThrow(failure);
    expect(second).toHaveBeenCalledOnce();
    expect(chart.element.isConnected).toBe(false);
    expect(resizeObservers.size).toBe(0);
    expect(() => {
      chart.destroy();
    }).not.toThrow();
  });

  it('releases everything when a module fails to clean up or to cancel its gesture', () => {
    const failure = new Error('destroyed hook failed');
    const pointerDown = vi.fn();
    const module = defineModule({
      name: 'failing',
      install: (core) => {
        core.hooks.destroyed.push(() => {
          throw failure;
        });
        core.tool = () => ({
          pointerDown,
          pointerMove: () => undefined,
          pointerUp: () => undefined,
          doubleClick: () => undefined,
          cancelPress: () => {
            throw new Error('cancel failed');
          }
        });
        return {};
      }
    });
    const chart = createModularChart({ modules: [module] });
    chart.data.set(createBars(100));
    pointer(chart, 'pointerdown', 200, 100);

    // The gesture ends first, while the module is still there.
    expect(() => {
      chart.destroy();
    }).toThrow('cancel failed');
    expect(chart.element.isConnected).toBe(false);
    expect(resizeObservers.size).toBe(0);

    pointer(chart, 'pointerdown', 200, 100);
    expect(pointerDown).toHaveBeenCalledOnce();
  });
});

describe('a destroyed chart', () => {
  it('throws for every call, reads as well as changes, and may be destroyed again', () => {
    const chart = chartWithBars(100);
    const scale = chart.priceScale();
    chart.destroy();
    const calls: Array<[string, () => unknown]> = [
      ['layout', () => chart.layout()],
      ['options', () => chart.options()],
      ['on', () => chart.on('click', () => undefined)],
      ['visibleRange', () => chart.timeScale.visibleRange()],
      ['data.length', () => chart.data.length],
      ['data.last', () => chart.data.last()],
      ['crosshair.get', () => chart.crosshair.get()],
      ['priceScale', () => chart.priceScale()],
      ['a price scale read before', () => scale.range()],
      ['indicators.list', () => chart.indicators.list()],
      ['saveState', () => chart.saveState()]
    ];

    for (const [name, call] of calls) {
      expect(call, name).toThrow('The chart has been destroyed.');
    }

    expect(() => {
      chart.destroy();
    }).not.toThrow();
    expect(chart.element.isConnected).toBe(false);
  });
});

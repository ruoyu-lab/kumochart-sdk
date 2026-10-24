import { describe, expect, it, vi } from 'vitest';
import type { ChartPlugin, PluginHost, PluginPaintContext } from '../../src/chart/plugins';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** A plugin recording what it was given. */
function recorder(name = 'recorder') {
  const painted: PluginPaintContext[] = [];
  let host: PluginHost | null = null;
  const plugin = {
    name,
    attach: vi.fn((given: PluginHost) => {
      host = given;
    }),
    detach: vi.fn(),
    paint: vi.fn((context: PluginPaintContext) => {
      painted.push(context);
    })
  } satisfies ChartPlugin;
  return { plugin, painted, host: () => host };
}

describe('plugins', () => {
  it('attaches, lists and detaches plugins', () => {
    const chart = chartWithBars(50);
    const { plugin, host } = recorder();
    chart.plugins.add(plugin);

    expect(plugin.attach).toHaveBeenCalledTimes(1);
    expect(host()?.chart).toBe(chart);
    expect(host()?.bars.length).toBe(50);
    expect(chart.plugins.list()).toEqual([plugin]);
    expect(chart.plugins.get('recorder')).toBe(plugin);

    chart.plugins.remove('recorder');
    expect(plugin.detach).toHaveBeenCalledTimes(1);
    expect(chart.plugins.list()).toEqual([]);
    expect(chart.plugins.get('recorder')).toBeNull();
  });

  it('validates plugins before attaching them', () => {
    const chart = chartWithBars(10);
    chart.plugins.add({ name: 'one' });

    expect(() => {
      chart.plugins.add({ name: 'one' });
    }).toThrow('A plugin named "one" is already added');
    expect(() => {
      chart.plugins.add({ name: '' });
    }).toThrow('plugin.name');
    expect(() => {
      chart.plugins.add({ name: 'two', paint: 3 } as never);
    }).toThrow('plugin.paint must be a function');
    expect(() => {
      chart.plugins.remove('missing');
    }).toThrow('There is no plugin named "missing"');

    // A plugin whose attach() throws is not added.
    expect(() => {
      chart.plugins.add({
        name: 'broken',
        attach: () => {
          throw new Error('no');
        }
      });
    }).toThrow('no');
    expect(chart.plugins.list().map((each) => each.name)).toEqual(['one']);
  });

  it('paints every pane below and above the series', () => {
    const chart = chartWithBars(120);
    const rsi = chart.indicators.add({ type: 'RSI' });
    const rsiPane = chart.indicators.get(rsi)?.pane;
    const { plugin, painted } = recorder();
    chart.plugins.add(plugin);
    chart.screenshot();

    expect(painted.map((context) => `${context.pane.id}:${context.layer}`)).toEqual([
      'main:below',
      'main:above',
      `${rsiPane}:below`,
      `${rsiPane}:above`
    ]);

    const context = painted[0];

    if (!context?.visible) {
      throw new Error('Nothing painted.');
    }

    const index = context.visible.to;
    expect(context.timeToX(context.bars.time(index))).toBeCloseTo(context.indexToX(index));
    expect(context.xToIndex(context.indexToX(index))).toBeCloseTo(index);
    expect(context.pane.yToValue(context.pane.valueToY(110))).toBeCloseTo(110);
    expect(context.pane.formatValue(110)).toBe('110.00');
    expect(context.theme).toBe(chart.options().theme);
  });

  it('shows plugins only the source a replay has revealed', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(createBars(60), { interval: '1m' });
    chart.data.setTimeframe('5m');
    const { plugin, host } = recorder();
    chart.plugins.add(plugin);
    const source = host()?.source;

    expect(source?.length).toBe(60);
    expect(host()?.bars.length).toBe(12);
    // Applications read the same views.
    expect(chart.data.source).toBe(source);
    expect(chart.data.bars.length).toBe(12);
    expect(chart.data.bars.close(11)).toBe(chart.data.last()?.close);
    // The views cannot change the chart.
    expect('clear' in chart.data.bars || 'assign' in chart.data.source).toBe(false);

    chart.replay.start(T0 + 20 * MINUTE);
    const revision = source?.revision;
    expect(source?.length).toBe(21);
    expect(source?.bar(21)).toBeNull();
    expect(source?.lowerBound(T0 + 50 * MINUTE)).toBe(21);

    // A step completes the 5-minute bar in progress.
    chart.replay.step();
    expect(source?.length).toBe(25);
    expect(source?.revision).not.toBe(revision);
  });

  it('tells plugins where the data is cut while replaying', () => {
    const chart = chartWithBars(60);
    const { plugin, painted } = recorder();
    chart.plugins.add(plugin);
    chart.screenshot();
    expect(painted.at(-1)?.cutoff).toBe(Number.POSITIVE_INFINITY);

    chart.replay.start(T0 + 20 * MINUTE);
    chart.screenshot();
    expect(painted.at(-1)?.cutoff).toBe(T0 + 20 * MINUTE);

    chart.replay.stop();
    chart.screenshot();
    expect(painted.at(-1)?.cutoff).toBe(Number.POSITIVE_INFINITY);
  });

  it('repaints on request and detaches when the chart is destroyed', () => {
    const chart = chartWithBars(30);
    const { plugin, painted, host } = recorder();
    chart.plugins.add(plugin);
    chart.screenshot();
    const count = painted.length;
    host()?.repaint();
    chart.screenshot();

    expect(painted.length).toBeGreaterThan(count);

    chart.destroy();
    expect(plugin.detach).toHaveBeenCalledTimes(1);
  });

  it('that fail leave the canvases as they were, every layer painted', () => {
    const chart = chartWithBars(50);
    let fail = true;
    chart.plugins.add({
      name: 'failing',
      paint: () => {
        if (fail) {
          throw new Error('not ready');
        }
      }
    });
    const canvas = (layer: string) =>
      chart.element.querySelector<HTMLCanvasElement>(`canvas[data-layer="${layer}"]`);
    const calls = (layer: string) => {
      const element = canvas(layer);
      return element ? canvasCalls(element) : [];
    };
    const count = (layer: string, name: string) =>
      calls(layer).filter((call) => call.name === name).length;
    ['scene', 'objects', 'cursor'].forEach((layer) => {
      calls(layer).length = 0;
    });

    expect(() => chart.screenshot()).toThrow('not ready');
    expect(count('scene', 'save')).toBe(count('scene', 'restore'));
    expect(count('objects', 'clearRect')).toBe(1);
    expect(count('cursor', 'clearRect')).toBe(1);

    fail = false;
    chart.applyOptions({});
    expect(() => chart.screenshot()).not.toThrow();
    expect(count('scene', 'save')).toBe(count('scene', 'restore'));
  });
});

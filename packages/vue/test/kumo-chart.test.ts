import { createModule, type BarInput, type Chart as ChartOf } from '@kumo-charts/core';
import { ALL_EVENTS, allModules, type AllModules } from '@kumo-charts/core/all';
import type { OrderInput } from '@kumo-charts/core/trading';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { KumoChart } from '../src';

/** A chart with every module, as most tests give it. */
type Chart = ChartOf<AllModules>;

function bars(count: number, close = 100): BarInput[] {
  return Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2024, 0, 1) + index * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close
  }));
}

function mount(render: () => ReturnType<typeof h>, onError?: (error: unknown) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(defineComponent({ setup: () => render }));

  if (onError) {
    app.config.errorHandler = onError;
  }

  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    }
  };
}

describe('KumoChart', () => {
  it('applies the source interval and the timeframe', async () => {
    const timeframe = ref<string | null>('5m');
    let chart: Chart | null = null;
    const { unmount } = mount(() =>
      h(KumoChart, {
        data: bars(30),
        interval: '1m',
        timeframe: timeframe.value,
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    const current = () => chart ?? expect.unreachable('The chart was not created.');

    expect(current().data.length).toBe(6);

    timeframe.value = '15m';
    await nextTick();
    expect(current().data.length).toBe(2);

    timeframe.value = null;
    await nextTick();
    expect(current().data.length).toBe(30);
    unmount();
  });

  it('sets the timeframe once as it mounts, and only when it changes after', async () => {
    let setTimeframe: MockInstance<ChartOf['data']['setTimeframe']> | null = null;
    const watch = createModule({
      name: 'watch',
      install: (chart) => {
        setTimeframe = vi.spyOn(chart.data, 'setTimeframe');
      }
    });
    const timeframes = () => (setTimeframe?.mock.calls ?? []).map(([timeframe]) => timeframe);
    const data = ref(bars(30));
    const timeframe = ref('5m');
    let chart: Chart | null = null;
    const { unmount } = mount(() =>
      h(KumoChart, {
        modules: [watch],
        data: data.value,
        interval: '1m',
        timeframe: timeframe.value,
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    const current = () => chart ?? expect.unreachable('The chart was not created.');

    expect(timeframes()).toEqual(['5m']);

    // New bars of the interval keep the timeframe, which needs not be built again.
    data.value = bars(40);
    await nextTick();
    expect(current().data.length).toBe(8);
    timeframe.value = '15m';
    await nextTick();
    expect(timeframes()).toEqual(['5m', '15m']);
    expect(current().data.length).toBe(3);
    unmount();
  });

  it('applies the transform, keeping it when an equal one is passed', async () => {
    const tick = ref(0);
    const transform = ref<string | null>('heikin-ashi');
    const input = ref<'bars' | 'trades'>('bars');
    let chart: Chart | null = null;
    const { unmount } = mount(() =>
      h(KumoChart, {
        data: bars(30),
        interval: '1m',
        class: `render-${tick.value}`,
        // A new object on every render, as written inline in a template.
        transform: transform.value === null ? null : { type: transform.value, input: input.value },
        // The modules bring the transform before the prop is applied.
        modules: allModules(),
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    const current = () => chart ?? expect.unreachable('The chart was not created.');
    const setTransform = vi.spyOn(current().transforms, 'set');

    expect(current().transforms.get()).toEqual({
      type: 'heikin-ashi',
      params: {},
      input: 'bars',
      resolved: null
    });

    tick.value += 1;
    await nextTick();
    expect(setTransform).not.toHaveBeenCalled();

    // The same type and parameters built from the trades are other bars.
    input.value = 'trades';
    await nextTick();
    expect(current().transforms.get()?.input).toBe('trades');

    transform.value = null;
    await nextTick();
    expect(current().transforms.get()).toBeNull();
    unmount();
  });

  it('waits for data before applying the timeframe', async () => {
    const data = ref<BarInput[] | undefined>(undefined);
    let chart: Chart | null = null;
    const { unmount } = mount(() =>
      h(KumoChart, {
        ...(data.value ? { data: data.value } : {}),
        interval: '1m',
        timeframe: '5m',
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    const current = () => chart ?? expect.unreachable('The chart was not created.');

    expect(current().data.length).toBe(0);

    data.value = bars(30);
    await nextTick();
    expect(current().data.timeframe()).toEqual({ unit: 'minute', count: 5 });
    expect(current().data.length).toBe(6);
    unmount();
  });

  it('creates the chart on mount, syncs props and destroys it on unmount', async () => {
    const data = ref(bars(10));
    const orders = ref<OrderInput[]>([{ id: 'o1', side: 'buy', price: 99 }]);
    let chart: Chart | null = null;
    const { host, unmount } = mount(() =>
      h(KumoChart, {
        modules: allModules(),
        data: data.value,
        orders: orders.value,
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();

    expect(chart).not.toBeNull();
    expect(host.querySelectorAll('canvas')).toHaveLength(3);
    expect((chart as Chart | null)?.data.length).toBe(10);

    data.value = bars(20);
    orders.value[0]!.price = 98;
    await nextTick();

    expect((chart as Chart | null)?.data.length).toBe(20);
    expect((chart as Chart | null)?.orders.get('o1')?.price).toBe(98);

    unmount();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('declares every event of the chart and its modules, and ready', () => {
    expect(Object.keys(KumoChart.emits ?? {})).toEqual(['ready', ...ALL_EVENTS]);
    expect(ALL_EVENTS).toContain('alertTrigger');
    expect(new Set(ALL_EVENTS).size).toBe(ALL_EVENTS.length);
  });

  it('re-emits chart events in kebab-case', async () => {
    const onAlertTrigger = vi.fn();
    let chart: Chart | null = null;
    mount(() =>
      h(KumoChart, {
        modules: allModules(),
        data: bars(10),
        alerts: [{ id: 'a', trigger: 'cross-up', value: 105 }],
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        },
        onAlertTrigger
      })
    );
    await nextTick();
    (chart as Chart | null)?.data.update({ ...bars(10)[9]!, close: 110, high: 111 });

    expect(onAlertTrigger).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', value: 110 }));
  });

  it('creates the chart with its modules, whose types the options can use', async () => {
    let chart: Chart | null = null;
    const { unmount } = mount(() =>
      h(KumoChart, {
        options: { locale: 'zh-CN', mainSeries: { type: 'volume-candles' } },
        modules: allModules(),
        data: bars(10),
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    const options = (chart as Chart | null)?.options();

    expect(options?.mainSeries.type).toBe('volume-candles');
    expect(options?.locale).toBe('zh-CN');
    unmount();
  });

  it('says which module a prop needs', async () => {
    const errors: unknown[] = [];
    const { unmount } = mount(
      () => h(KumoChart, { data: bars(10), orders: [{ id: 'o', side: 'buy', price: 99 }] }),
      (error) => errors.push(error)
    );
    await nextTick();

    expect(String(errors[0])).toContain('The orders prop needs the orders module in modules.');
    unmount();
  });

  it('applies option changes', async () => {
    const locale = ref('en-US');
    let chart: Chart | null = null;
    mount(() =>
      h(KumoChart, {
        options: { locale: locale.value },
        onReady: (instance: ChartOf) => {
          chart = instance as Chart;
        }
      })
    );
    await nextTick();
    locale.value = 'zh-CN';
    await nextTick();

    expect((chart as Chart | null)?.options().locale).toBe('zh-CN');
  });
});

import {
  createModule,
  type BarInput,
  type Chart as ChartOf,
  type ChartOptionsInput
} from 'kumo-charts';
import { allModules, type AllModules } from 'kumo-charts/all';
import type { OrderInput } from 'kumo-charts/trading';
import { act, createElement, StrictMode, useEffect, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { KumoChart, useKumoChart, type KumoChartProps } from '../src';

/** A chart with every module, as most tests give it. */
type Chart = ChartOf<AllModules>;
const MODULES = allModules();

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function bars(count: number, close = 100): BarInput[] {
  return Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2024, 0, 1) + index * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close
  }));
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

function render(element: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    host.remove();
  };
  cleanups.push(unmount);
  return {
    host,
    rerender: (next: ReactElement) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      cleanups.splice(cleanups.indexOf(unmount), 1);
      unmount();
    }
  };
}

function chartOf(props: KumoChartProps = {}) {
  let chart: Chart | null = null;
  const onReady = (instance: ChartOf) => {
    chart = instance as Chart;
  };
  const view = render(createElement(KumoChart, { modules: MODULES, ...props, onReady }));
  return {
    ...view,
    chart: () => chart ?? expect.unreachable('The chart was not created.'),
    rerender: (next: KumoChartProps) => {
      view.rerender(createElement(KumoChart, { modules: MODULES, ...next, onReady }));
    }
  };
}

describe('KumoChart', () => {
  it('creates the chart with its props applied, syncs changes and destroys it on unmount', () => {
    const orders: OrderInput[] = [{ id: 'o1', side: 'buy', price: 99 }];
    const view = chartOf({ data: bars(10), orders });

    expect(view.host.querySelectorAll('canvas')).toHaveLength(3);
    expect(view.chart().data.length).toBe(10);
    expect(view.chart().orders.get('o1')?.price).toBe(99);

    view.rerender({ data: bars(20), orders: [{ ...orders[0]!, price: 98 }] });

    expect(view.chart().data.length).toBe(20);
    expect(view.chart().orders.get('o1')?.price).toBe(98);

    view.unmount();
    expect(view.host.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('applies the source interval and the timeframe', () => {
    const data = bars(30);
    const view = chartOf({ data, interval: '1m', timeframe: '5m' });

    expect(view.chart().data.sourceInterval()).toEqual({ unit: 'minute', count: 1 });
    expect(view.chart().data.length).toBe(6);

    view.rerender({ data, interval: '1m', timeframe: '15m' });
    expect(view.chart().data.length).toBe(2);

    view.rerender({ data, interval: '1m', timeframe: null });
    expect(view.chart().data.length).toBe(30);
  });

  it('sets the timeframe once as it mounts, and only when it changes after', () => {
    let setTimeframe: MockInstance<ChartOf['data']['setTimeframe']> | null = null;
    const watch = createModule({
      name: 'watch',
      install: (chart) => {
        setTimeframe = vi.spyOn(chart.data, 'setTimeframe');
      }
    });
    const timeframes = () => (setTimeframe?.mock.calls ?? []).map(([timeframe]) => timeframe);
    const modules = [...MODULES, watch];
    const view = chartOf({ modules, data: bars(30), interval: '1m', timeframe: '5m' });

    expect(timeframes()).toEqual(['5m']);

    // New bars of the interval keep the timeframe, which needs not be built again.
    view.rerender({ modules, data: bars(40), interval: '1m', timeframe: '5m' });
    expect(view.chart().data.length).toBe(8);
    view.rerender({ modules, data: bars(40), interval: '1m', timeframe: '15m' });
    expect(timeframes()).toEqual(['5m', '15m']);
    expect(view.chart().data.length).toBe(3);
  });

  it('applies the transform, keeping it when an equal one is passed', () => {
    const data = bars(30);
    // The modules bring the transform before the prop is applied.
    const view = chartOf({ data, transform: { type: 'heikin-ashi' } });
    const setTransform = vi.spyOn(view.chart().transforms, 'set');

    expect(view.chart().transforms.get()).toEqual({
      type: 'heikin-ashi',
      params: {},
      input: 'bars',
      resolved: null
    });

    view.rerender({ data, transform: { type: 'heikin-ashi' } });
    expect(setTransform).not.toHaveBeenCalled();

    // The same type and parameters built from the trades are other bars.
    const fromTrades = { type: 'heikin-ashi', input: 'trades' } as const;
    view.rerender({ data, transform: fromTrades });
    expect(view.chart().transforms.get()?.input).toBe('trades');

    view.rerender({ data, transform: null });
    expect(view.chart().transforms.get()).toBeNull();
  });

  it('waits for data before applying the timeframe', () => {
    const view = chartOf({ interval: '1m', timeframe: '5m' });

    expect(view.chart().data.length).toBe(0);

    view.rerender({ data: bars(30), interval: '1m', timeframe: '5m' });
    expect(view.chart().data.timeframe()).toEqual({ unit: 'minute', count: 5 });
    expect(view.chart().data.length).toBe(6);
  });

  it('passes the instance through a ref', () => {
    const ref = { current: null as ChartOf | null };
    render(createElement(KumoChart, { ref, data: bars(5) }));

    expect(ref.current?.data.length).toBe(5);
  });

  it('forwards chart events to the latest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const alerts = [{ id: 'a', trigger: 'cross-up' as const, value: 105 }];
    const data = bars(10);
    const view = chartOf({ data, alerts, onAlertTrigger: first });
    view.rerender({ data, alerts, onAlertTrigger: second });
    act(() => {
      view.chart().data.update({ ...data[9]!, close: 110, high: 111 });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', value: 110 }));
  });

  it('creates the chart with its modules, whose types the options can use', () => {
    const view = chartOf({
      options: { locale: 'zh-CN', mainSeries: { type: 'volume-candles' } },
      data: bars(10)
    });

    expect(view.chart().options().mainSeries.type).toBe('volume-candles');
    expect(view.chart().options().locale).toBe('zh-CN');
  });

  it('says which module a prop needs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(createElement(KumoChart, { data: bars(5), markers: [] }))).toThrow(
      'The markers prop needs the markers module in modules.'
    );
  });

  it('applies new options objects', () => {
    const view = chartOf({ options: { locale: 'en-US' } });
    expect(view.chart().options().locale).toBe('en-US');

    view.rerender({ options: { locale: 'zh-CN' } });
    expect(view.chart().options().locale).toBe('zh-CN');
  });

  it('survives StrictMode, leaving exactly one live chart', () => {
    const ready = vi.fn();
    const { host } = render(
      createElement(StrictMode, null, createElement(KumoChart, { data: bars(5), onReady: ready }))
    );
    const last = ready.mock.calls.at(-1)?.[0] as ChartOf;

    expect(host.querySelectorAll('canvas')).toHaveLength(3);
    expect(last.data.length).toBe(5);
    expect(() => {
      last.timeScale.reset();
    }).not.toThrow();
  });
});

describe('useKumoChart', () => {
  it('creates the chart once its element is rendered', () => {
    const seen: Array<ChartOf | null> = [];
    const options: ChartOptionsInput = { locale: 'zh-CN' };

    function View({ visible }: { visible: boolean }) {
      const [ref, chart] = useKumoChart(options);

      useEffect(() => {
        seen.push(chart);
        chart?.data.set(bars(3));
      }, [chart]);

      return visible ? createElement('div', { ref }) : null;
    }

    const view = render(createElement(View, { visible: false }));
    expect(seen.at(-1)).toBeNull();

    view.rerender(createElement(View, { visible: true }));
    const chart = seen.at(-1);
    expect(chart?.data.length).toBe(3);
    expect(chart?.options().locale).toBe('zh-CN');

    view.rerender(createElement(View, { visible: false }));
    expect(seen.at(-1)).toBeNull();
    expect(() => chart?.data.set([])).toThrow('destroyed');
  });
});

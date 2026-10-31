import {
  ChartError,
  parseInterval,
  type BarInput,
  type BarTransformInput,
  type Chart,
  type ChartModule,
  type ChartOptionsInput,
  type IntervalInput
} from 'kumo-charts';
import type { AlertInput } from 'kumo-charts/alerts';
import type { MarkerInput, OrderInput } from 'kumo-charts/trading';
import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties
} from 'react';
import { EVENTS, type KumoChartEventName, type KumoChartEventMap } from './events';
import { useBrowserLayoutEffect } from './layout-effect';
import { useKumoChart } from './use-kumo-chart';

type HandlerName<K extends KumoChartEventName> = `on${Capitalize<K>}`;

/**
 * One optional `on*` prop per event of the chart and its modules, e.g. `onCrosshairMove` or
 * `onOrderDrag`.
 */
export type KumoChartEventHandlers = {
  [K in KumoChartEventName as `on${Capitalize<K>}`]?: (event: KumoChartEventMap[K]) => void;
};

export interface KumoChartProps extends KumoChartEventHandlers {
  /** The chart's modules, such as `[indicators(allIndicators)]`, read when it is created. */
  modules?: readonly ChartModule[];
  /**
   * Applied with `chart.applyOptions()` whenever a new object is passed, the options of the
   * modules too.
   */
  options?: ChartOptionsInput & Readonly<Record<string, unknown>>;
  /** Replaces all bars when a new array or `interval` is passed. */
  data?: readonly BarInput[];
  /** Resolution of `data`, such as `'1m'`; needed for `timeframe` and `chart.data.addTrades()`. */
  interval?: IntervalInput;
  /** The displayed timeframe, such as `'15m'`; `null` shows the source resolution. */
  timeframe?: IntervalInput | null;
  /** Builds the displayed bars, e.g. `{ type: 'renko' }`; `null` shows the timeframe's bars. */
  transform?: BarTransformInput | null;
  /** Needs the orders module. */
  orders?: readonly OrderInput[];
  /** Needs the markers module. */
  markers?: readonly MarkerInput[];
  /** Needs the alerts module. */
  alerts?: readonly AlertInput[];
  className?: string;
  /** Merged over the default `width: 100%; height: 100%`. */
  style?: CSSProperties;
  /** Called once the chart is created, after the props above were applied. */
  onReady?: (chart: Chart) => void;
}

function handlerName<K extends KumoChartEventName>(name: K): HandlerName<K> {
  return `on${name[0]?.toUpperCase() ?? ''}${name.slice(1)}` as HandlerName<K>;
}

/**
 * Applies `value` once the chart exists and whenever a new value is passed. `apply` must be a
 * stable (module-level) function.
 */
function useSync<T>(
  chart: Chart | null,
  value: T | undefined,
  apply: (chart: Chart, value: T) => void
): void {
  useBrowserLayoutEffect(() => {
    if (chart && value !== undefined) {
      apply(chart, value);
    }
  }, [chart, value, apply]);
}

/**
 * React component around `createChart()`. `modules` are read when the chart is created. Props
 * replace the chart's data, orders, markers or alerts whenever a new value is passed (compare by
 * reference, as React state does); every event of the chart and its modules is available as an
 * `on*` prop, plus `onReady` with the chart instance. A ref receives the chart instance. Stream
 * real-time bars with `chart.data.update()`.
 */
export const KumoChart = forwardRef<Chart | null, KumoChartProps>(function KumoChart(props, ref) {
  const { options, data, interval, timeframe, transform, orders, markers, alerts } = props;
  const { className, style } = props;
  const creation = useMemo(
    () => ({ ...options, ...(props.modules ? { modules: props.modules } : {}) }),
    [options, props.modules]
  );
  const [container, chart] = useKumoChart(creation);
  const latest = useRef(props);

  useBrowserLayoutEffect(() => {
    latest.current = props;
  });

  const source = useMemo(() => data && ([data, interval] as const), [data, interval]);
  /** The chart and the data last set on it. */
  const synced = useRef<{ chart: Chart; source: Source | undefined } | null>(null);
  // The timeframe needs the source interval: it applies with the data, the chart's first
  // included, and on its own changes.
  useBrowserLayoutEffect(() => {
    if (!chart) {
      return;
    }

    const previous = synced.current;
    synced.current = { chart, source };

    if (source && (previous?.chart !== chart || previous.source !== source)) {
      setData(chart, source);
    }

    applyTimeframe(chart, timeframe);
  }, [chart, source, timeframe]);
  useBrowserLayoutEffect(() => {
    if (chart && transform !== undefined && !sameTransform(chart.transforms.get(), transform)) {
      chart.transforms.set(transform);
    }
  }, [chart, transform]);
  useSync(chart, orders, setOrders);
  useSync(chart, markers, setMarkers);
  useSync(chart, alerts, setAlerts);

  // Subscribe only to the events that have a handler, so unused events cost nothing.
  const handled = EVENTS.filter((name) => props[handlerName(name)] !== undefined).join(',');

  useBrowserLayoutEffect(() => {
    if (!chart || handled === '') {
      return;
    }

    // The chart has the events of its modules: those of a module it lacks never fire.
    const events = chart as unknown as {
      on(
        name: KumoChartEventName,
        listener: (event: KumoChartEventMap[KumoChartEventName]) => void
      ): () => void;
    };
    const unsubscribe = EVENTS.filter((name) => handled.split(',').includes(name)).map((name) =>
      events.on(name, (event) => {
        const handler = latest.current[handlerName(name)] as
          ((payload: KumoChartEventMap[KumoChartEventName]) => void) | undefined;
        handler?.(event);
      })
    );

    return () => {
      unsubscribe.forEach((off) => {
        off();
      });
    };
  }, [chart, handled]);

  useBrowserLayoutEffect(() => {
    if (chart) {
      latest.current.onReady?.(chart);
    }
  }, [chart]);

  useImperativeHandle<Chart | null, Chart | null>(ref, () => chart, [chart]);

  return createElement('div', {
    ref: container,
    className,
    style: { width: '100%', height: '100%', ...style }
  });
});

/** The bars of the `data` prop and their interval. */
type Source = readonly [readonly BarInput[], IntervalInput | undefined];

function setData(chart: Chart, [bars, interval]: Source): void {
  chart.data.set(bars, interval === undefined ? {} : { interval });
}

/**
 * Displays a timeframe once the chart knows the source interval, unless it displays it already:
 * `data.set()` keeps a timeframe that its bars build, and setting one builds the bars again.
 */
function applyTimeframe(chart: Chart, timeframe: IntervalInput | null | undefined): void {
  const source = chart.data.sourceInterval();

  if (timeframe === undefined || source === null) {
    return;
  }

  const shown = chart.data.timeframe() ?? source;
  const wanted = timeframe === null ? source : parseInterval(timeframe, 'timeframe');

  if (shown.unit !== wanted.unit || shown.count !== wanted.count) {
    chart.data.setTimeframe(timeframe);
  }
}

/** Whether two transforms build the same bars, so an equal prop does not rebuild them. */
function sameTransform(left: BarTransformInput | null, right: BarTransformInput | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.type === right.type &&
      (left.input ?? 'bars') === (right.input ?? 'bars') &&
      JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {}))
  );
}

/** What a prop of objects sets: the namespace its module adds. */
interface ObjectsApi {
  set(inputs: readonly unknown[]): void;
}

/** Sets the objects of a prop through the namespace of its module, which the chart must have. */
function setObjects(chart: Chart, name: string, inputs: readonly unknown[]): void {
  const api = (chart as unknown as Readonly<Record<string, ObjectsApi | undefined>>)[name];

  if (api === undefined) {
    throw new ChartError(`The ${name} prop needs the ${name} module in modules.`);
  }

  api.set(inputs);
}

function setOrders(chart: Chart, orders: readonly OrderInput[]): void {
  setObjects(chart, 'orders', orders);
}

function setMarkers(chart: Chart, markers: readonly MarkerInput[]): void {
  setObjects(chart, 'markers', markers);
}

function setAlerts(chart: Chart, alerts: readonly AlertInput[]): void {
  setObjects(chart, 'alerts', alerts);
}

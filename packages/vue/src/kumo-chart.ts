import {
  ChartError,
  parseInterval,
  type BarInput,
  type BarTransformInput,
  type Chart,
  type ChartModule,
  type ChartOptionsInput,
  type IntervalInput
} from '@kumo-charts/core';
import type { AlertInput } from '@kumo-charts/core/alerts';
import type { MarkerInput, OrderInput } from '@kumo-charts/core/trading';
import { defineComponent, h, ref, watch, type ExtractPublicPropTypes, type PropType } from 'vue';
import { EVENTS, type KumoChartEventName, type KumoChartEventMap } from './events';
import { useKumoChart } from './use-kumo-chart';

/** The events the component emits: `ready` with the chart, and every event of the chart. */
type Emits = { ready: (chart: Chart) => true } & {
  [K in KumoChartEventName]: (event: KumoChartEventMap[K]) => true;
};

/** Validators only type the emitted events; every payload is accepted. */
const emits = Object.fromEntries(
  ['ready', ...EVENTS].map((name) => [name, () => true] as const)
) as unknown as Emits;

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

/** The props of {@link KumoChart}. */
const kumoChartProps = {
  /** The chart's modules, such as `[indicators(allIndicators)]`, read when it is created. */
  modules: { type: Array as PropType<readonly ChartModule[]>, default: undefined },
  /** Applied with `chart.applyOptions()`, the options of the modules too. */
  options: {
    type: Object as PropType<ChartOptionsInput & Readonly<Record<string, unknown>>>,
    default: undefined
  },
  /** Replaces all bars when the array or `interval` changes. */
  data: { type: Array as PropType<readonly BarInput[]>, default: undefined },
  /** Resolution of `data`, such as `'1m'`; needed for `timeframe` and `chart.data.addTrades()`. */
  interval: { type: [String, Object] as PropType<IntervalInput>, default: undefined },
  /** The displayed timeframe, such as `'15m'`; `null` shows the source resolution. */
  timeframe: {
    type: [String, Object, null] as PropType<IntervalInput | null>,
    default: undefined
  },
  /** Builds the displayed bars, e.g. `{ type: 'renko' }`; `null` shows the timeframe's bars. */
  transform: {
    type: [Object, null] as PropType<BarTransformInput | null>,
    default: undefined
  },
  /** Needs the orders module. */
  orders: { type: Array as PropType<readonly OrderInput[]>, default: undefined },
  /** Needs the markers module. */
  markers: { type: Array as PropType<readonly MarkerInput[]>, default: undefined },
  /** Needs the alerts module. */
  alerts: { type: Array as PropType<readonly AlertInput[]>, default: undefined }
};

/** What `KumoChart` takes as props, for typing a wrapper or a props object. */
export type KumoChartProps = ExtractPublicPropTypes<typeof kumoChartProps>;

/**
 * Vue 3 component around `createChart()`. `modules` are read when the chart is created. Props
 * replace the chart's data, orders, markers or alerts whenever their value changes; every event of
 * the chart and its modules is re-emitted (e.g. `@crosshair-move`, `@order-drag`), plus `@ready`
 * with the chart instance. Stream real-time bars with `chart.data.update()`; manage indicators
 * and drawings through the instance and persist them with `chart.saveState()`.
 */
export const KumoChart = defineComponent({
  name: 'KumoChart',
  props: kumoChartProps,
  emits,
  setup(props, { emit, expose }) {
    const container = ref<HTMLDivElement | null>(null);
    const chart = useKumoChart(container, () => ({
      ...props.options,
      ...(props.modules ? { modules: props.modules } : {})
    }));

    /** Applies a prop once the chart exists and whenever the prop changes. */
    const sync = <T>(
      source: () => T | undefined,
      apply: (chart: Chart, value: T) => void,
      deep: boolean
    ) => {
      const run = () => {
        const instance = chart.value;
        const value = source();

        if (instance && value !== undefined) {
          apply(instance, value);
        }
      };

      watch(() => chart.value, run);
      watch(source, run, { deep });
    };

    // The timeframe needs the source interval: it applies with the data, the chart's first
    // included, and on its own changes.
    sync(
      () => props.data && ([props.data, props.interval] as const),
      (instance, [bars, interval]) => {
        instance.data.set(bars, interval === undefined ? {} : { interval });
        applyTimeframe(instance, props.timeframe);
      },
      false
    );
    watch(
      () => props.timeframe,
      (timeframe) => {
        if (chart.value) {
          applyTimeframe(chart.value, timeframe);
        }
      }
    );
    sync(
      () => props.transform,
      (instance, transform) => {
        if (!sameTransform(instance.transforms.get(), transform)) {
          instance.transforms.set(transform);
        }
      },
      true
    );
    sync(
      () => props.orders,
      (instance, orders) => {
        setObjects(instance, 'orders', orders);
      },
      true
    );
    sync(
      () => props.markers,
      (instance, markers) => {
        setObjects(instance, 'markers', markers);
      },
      true
    );
    sync(
      () => props.alerts,
      (instance, alerts) => {
        setObjects(instance, 'alerts', alerts);
      },
      true
    );

    watch(
      () => chart.value,
      (instance, _previous, onCleanup) => {
        if (!instance) {
          return;
        }

        // `emits` declares exactly the events in EVENTS, each with its payload.
        const forward = emit as (
          name: KumoChartEventName,
          payload: KumoChartEventMap[KumoChartEventName]
        ) => void;
        const events = instance as unknown as Chart & {
          on(
            name: KumoChartEventName,
            listener: (event: KumoChartEventMap[KumoChartEventName]) => void
          ): () => void;
        };
        const unsubscribe = EVENTS.map((name) =>
          events.on(name, (event) => {
            forward(name, event);
          })
        );
        onCleanup(() => {
          unsubscribe.forEach((off) => {
            off();
          });
        });
        emit('ready', instance);
      }
    );

    expose({ chart });

    return () => h('div', { ref: container, style: { width: '100%', height: '100%' } });
  }
});

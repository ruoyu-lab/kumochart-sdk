import { createChart, type Chart, type ChartModule, type CreateChartOptions } from 'kumo-charts';
import {
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef
} from 'vue';

/**
 * Creates a chart inside `target` once it is mounted, with the `modules` of the options as they
 * are then, and destroys it on unmount. The other options and their changes are applied with
 * `chart.applyOptions()`.
 *
 * ```ts
 * const container = useTemplateRef<HTMLDivElement>('container');
 * const chart = useKumoChart(container, { modules: [indicators(allIndicators)], locale: 'zh-CN' });
 * ```
 */
export function useKumoChart<const M extends readonly ChartModule[] = readonly []>(
  target: Ref<HTMLElement | null>,
  options?: MaybeRefOrGetter<CreateChartOptions<M> | undefined>
): ShallowRef<Chart<M> | null> {
  const chart: ShallowRef<Chart<M> | null> = shallowRef(null);
  /** The options without the modules, which only the creation takes. */
  const settings = () =>
    Object.fromEntries(
      Object.entries(toValue(options) ?? {}).filter(([key]) => key !== 'modules')
    ) as Parameters<Chart<M>['applyOptions']>[0];

  onMounted(() => {
    if (target.value) {
      chart.value = createChart<M>(target.value, toValue(options));
    }
  });

  watch(
    settings,
    (next) => {
      chart.value?.applyOptions(next);
    },
    { deep: true }
  );

  onBeforeUnmount(() => {
    chart.value?.destroy();
    chart.value = null;
  });

  return chart;
}

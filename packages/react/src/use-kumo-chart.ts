import {
  createChart,
  type Chart,
  type ChartModule,
  type CreateChartOptions
} from '@kumo-charts/core';
import { useRef, useState } from 'react';
import { useBrowserLayoutEffect } from './layout-effect';

/**
 * Creates a chart in the element that receives the returned ref, with the `modules` of the
 * options as they are then, and destroys it when the element goes away. The other options are
 * applied with `chart.applyOptions()` whenever a new object is passed, so keep them stable (a
 * module constant or `useMemo`).
 *
 * ```tsx
 * const [ref, chart] = useKumoChart({ modules: [indicators(allIndicators)] });
 * useEffect(() => chart?.data.set(bars), [chart, bars]);
 * return <div ref={ref} style={{ height: 480 }} />;
 * ```
 */
export function useKumoChart<const M extends readonly ChartModule[] = readonly []>(
  options?: CreateChartOptions<M>
): [ref: (element: HTMLElement | null) => void, chart: Chart<M> | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [chart, setChart] = useState<Chart<M> | null>(null);
  // The options when the chart is created, without recreating it when they change.
  const initial = useRef(options);

  useBrowserLayoutEffect(() => {
    initial.current = options;
  });

  useBrowserLayoutEffect(() => {
    if (!element) {
      return;
    }

    const instance = createChart<M>(element, initial.current);
    setChart(instance);

    return () => {
      instance.destroy();
      setChart(null);
    };
  }, [element]);

  useBrowserLayoutEffect(() => {
    if (chart && options) {
      // The modules only take effect when the chart is created.
      chart.applyOptions(
        Object.fromEntries(
          Object.entries(options).filter(([key]) => key !== 'modules')
        ) as Parameters<Chart<M>['applyOptions']>[0]
      );
    }
  }, [chart, options]);

  return [setElement, chart];
}

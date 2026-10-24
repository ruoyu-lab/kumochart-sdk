import { validateSeriesDefinition } from '../chart/api/series';
import { validateTransformDefinition } from '../chart/api/transforms';
import { defineModule, type ChartModule } from '../chart/modules';
import type { BarTransformDefinition } from '../feed/transform';
import type { SeriesTypeDefinition } from '../series/types';
import { fail } from '../utils/errors';
import { checkArray, checkObject } from '../utils/validate';

/**
 * A chart type: how its bars are built from the bars of the timeframe (`transform`, set with
 * `chart.transforms.set()`), how they are drawn (`series`, the main series' `type`), or both, as
 * Kagi lines are.
 */
export interface ChartType {
  readonly transform?: BarTransformDefinition;
  readonly series?: SeriesTypeDefinition<object>;
}

/** Adds nothing to the chart's API: its types join `chart.transforms` and `chart.series`. */
export type ChartTypesModule = ChartModule;

/**
 * The chart types module, with the chart types given, such as `chartTypes(allChartTypes)` or
 * `chartTypes([heikinAshi, renko])`: their transforms join `chart.transforms`, their series types
 * `chart.series`.
 */
export function chartTypes(types: readonly ChartType[] = []): ChartTypesModule {
  // Checked at runtime: the types may come from plain JavaScript.
  checkArray('chartTypes()', types);
  const given = { transform: new Set<string>(), 'series type': new Set<string>() };
  const once = (kind: keyof typeof given, type: string) => {
    if (given[kind].has(type)) {
      fail(`chartTypes() is given the ${kind} "${type}" twice.`);
    }

    given[kind].add(type);
  };

  types.forEach((type, index) => {
    checkObject(`chartTypes()[${index}]`, type);

    if (!type.transform && !type.series) {
      fail(`chartTypes()[${index}] has neither a transform nor a series type.`);
    }

    if (type.transform) {
      validateTransformDefinition(type.transform);
      once('transform', type.transform.type);
    }

    if (type.series) {
      validateSeriesDefinition(type.series);
      once('series type', type.series.type);
    }
  });

  return defineModule({
    name: 'chartTypes',
    install: (core) => {
      for (const { transform, series } of types) {
        if (transform) {
          core.market.transforms.register(transform);
        }

        if (series) {
          core.seriesTypes.register(series);
        }
      }

      return {};
    }
  });
}

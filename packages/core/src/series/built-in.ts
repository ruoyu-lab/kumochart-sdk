import { Registry } from '../utils/registry';
import { candlesSeries, highLowSeries, hollowCandlesSeries, ohlcSeries } from './bars';
import {
  areaSeries,
  baselineSeries,
  columnsSeries,
  hlcAreaSeries,
  lineMarkersSeries,
  lineSeries,
  stepLineSeries
} from './lines';
import type { SeriesTypeDefinition } from './types';

export type AnySeriesDefinition = SeriesTypeDefinition<object>;

/** The series types of every chart; indicators draw with `line` and `columns`. */
export function createSeriesRegistry(): Registry<AnySeriesDefinition> {
  return new Registry<AnySeriesDefinition>(
    'series type',
    [
      candlesSeries,
      hollowCandlesSeries,
      ohlcSeries,
      highLowSeries,
      lineSeries,
      stepLineSeries,
      lineMarkersSeries,
      areaSeries,
      baselineSeries,
      hlcAreaSeries,
      columnsSeries
    ] as AnySeriesDefinition[],
    'Register it with chart.series.register().'
  );
}

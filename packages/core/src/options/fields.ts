import { checkFields, fieldsOf } from '../utils/validate';
import type {
  CalendarOptions,
  ChartOptions,
  CrosshairOptions,
  FontOptions,
  GridOptions,
  InteractionOptions,
  LatestPriceOptions,
  LegendOptions,
  MainSeriesOptions,
  PaneOptions,
  PerformanceOptions,
  PriceScaleOptions,
  TimeScaleOptions
} from './types';

/** The fields of each section of the chart's options that holds settings, not entries by name. */
const SECTION_FIELDS: {
  readonly [K in keyof ChartOptions]?: readonly string[];
} = {
  font: fieldsOf<FontOptions>({ family: true, size: true }),
  grid: fieldsOf<GridOptions>({ vertical: true, horizontal: true, style: true }),
  crosshair: fieldsOf<CrosshairOptions>({
    mode: true,
    vertical: true,
    horizontal: true,
    labels: true,
    style: true,
    snapToBars: true
  }),
  mainSeries: fieldsOf<MainSeriesOptions>({
    type: true,
    source: true,
    styles: true,
    barColor: true
  }),
  timeScale: fieldsOf<TimeScaleOptions>({
    visible: true,
    height: true,
    barSpacing: true,
    minBarSpacing: true,
    maxBarSpacing: true,
    rightOffset: true,
    loadMoreThreshold: true,
    formatter: true
  }),
  priceScale: fieldsOf<PriceScaleOptions>({
    visible: true,
    margins: true,
    precision: true,
    formatter: true,
    minWidth: true
  }),
  latestPrice: fieldsOf<LatestPriceOptions>({
    line: true,
    label: true,
    countdown: true,
    style: true,
    color: true
  }),
  legend: fieldsOf<LegendOptions>({
    visible: true,
    rows: true,
    buttons: true,
    hideValuesOnHover: true
  }),
  interaction: fieldsOf<InteractionOptions>({
    pan: true,
    wheelZoom: true,
    pinchZoom: true,
    axisScale: true,
    kineticScroll: true,
    keyboard: true,
    longPressMs: true,
    touchMagnifier: true,
    hitTolerance: true
  }),
  panes: fieldsOf<PaneOptions>({
    defaultHeight: true,
    minHeight: true,
    separatorHeight: true,
    separatorWidth: true,
    separatorColor: true,
    separatorHoverColor: true
  }),
  calendar: fieldsOf<CalendarOptions>({
    timeZone: true,
    sessions: true,
    dayStart: true,
    weekdays: true,
    weekStart: true,
    bucket: true
  }),
  performance: fieldsOf<PerformanceOptions>({ maxPixelRatio: true, maxTrades: true })
};

/** Throws for a field no section of the chart's options has, such as `crosshair.mdoe`. */
export function checkSectionFields(options: ChartOptions): void {
  for (const [key, fields] of Object.entries(SECTION_FIELDS)) {
    checkFields(`options.${key}`, options[key as keyof ChartOptions], fields);
  }
}

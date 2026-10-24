import { alerts } from './alerts';
import type { ChartEventMap } from './chart/events';
import type { ModulesEvents } from './chart/modules';
import { allChartTypes, chartTypes } from './chart-types';
import { allDrawings, drawings } from './drawings';
import { allIndicators, indicators, type IndicatorsModuleOptions } from './indicators';
import { replay } from './replay';
import { markers, orders } from './trading';
import { fixedRangeVolumeProfile, volumeProfiles } from './volume-profile';
import { checkFields } from './utils/validate';
import { watermark } from './watermark';

/** What `allModules()` takes: what its modules take beside their types. */
export interface AllModulesOptions {
  /** As `indicators()` takes them, such as `{ texts: [indicatorTexts] }`. */
  readonly indicators?: IndicatorsModuleOptions;
}

/**
 * Every module of the SDK with everything in it: `createChart(container, { modules:
 * allModules() })` gives a chart with all its indicators, drawings (the fixed range volume profile
 * among them), chart types, alerts, orders, markers, replay, volume profiles and the watermark.
 */
export function allModules(options: AllModulesOptions = {}) {
  checkFields('allModules() options', options, ['indicators']);
  return [
    indicators(allIndicators, options.indicators),
    drawings([...allDrawings, fixedRangeVolumeProfile()]),
    chartTypes(allChartTypes),
    alerts(),
    orders(),
    markers(),
    replay(),
    volumeProfiles(),
    watermark()
  ] as const;
}

/** The modules of {@link allModules}, for `Chart<AllModules>`. */
export type AllModules = ReturnType<typeof allModules>;

/** The events of a chart with every module: the core's and those of the modules. */
export type AllEventMap = ChartEventMap & ModulesEvents<AllModules>;

/** Each event of {@link AllEventMap}, listed: an event lacking from it fails to compile. */
const EVENT_NAMES: { readonly [K in keyof AllEventMap]-?: true } = {
  crosshairMove: true,
  visibleRangeChange: true,
  loadMore: true,
  click: true,
  doubleClick: true,
  contextMenu: true,
  selectionChange: true,
  paneResize: true,
  buttonClick: true,
  legendButtonClick: true,
  barsChange: true,
  typesChange: true,
  optionsChange: true,
  drawingsChange: true,
  toolEnd: true,
  orderDrag: true,
  alertDrag: true,
  alertTrigger: true,
  replay: true
};

/**
 * The name of every event of the core and of the modules of the SDK, e.g. to forward them all as
 * the components of the SDK for frameworks do. A chart emits those of the modules it has.
 */
export const ALL_EVENTS = /* @__PURE__ */ Object.keys(
  EVENT_NAMES
) as readonly (keyof AllEventMap)[];

import { fail } from '../utils/errors';
import { checkColor, checkStyleColors } from '../canvas/color';
import { deepFreeze, deepMerge, type DeepPartial } from '../utils/merge';
import {
  checkBoolean,
  checkFields,
  checkFunctionOrNull,
  checkNumber,
  checkObject,
  checkOneOf,
  checkString,
  checkTimeZone
} from '../utils/validate';
import { PRICE_SOURCES } from '../data/types';
import { parseCalendar } from './calendar';
import { checkMargins } from './margins';
import { checkSectionFields } from './fields';
import { CHART_TEXTS, checkTexts } from './texts';
import { LINE_STYLES, type ChartOptions, type Theme } from './types';

export type ChartOptionsInput = DeepPartial<ChartOptions>;

/** A section of the chart's options a module owns, such as `drawings`. */
export interface OptionsSection<Section extends object = object> {
  readonly key: string;
  defaults(): Section;
  /** Throws for an invalid section; `label` names it, e.g. `options.drawings`. */
  validate(section: Section, label: string): void;
}

const THEME_COLORS: readonly (keyof Omit<Theme, 'palette'>)[] = [
  'background',
  'text',
  'textMuted',
  'grid',
  'border',
  'crosshair',
  'crosshairLabelBackground',
  'crosshairLabelText',
  'up',
  'down',
  'volumeUp',
  'volumeDown',
  'accent',
  'buy',
  'sell',
  'alert'
];

function checkLocale(locale: string | null): void {
  if (locale === null) {
    return;
  }

  try {
    new Intl.NumberFormat(locale);
  } catch {
    fail(`options.locale ${JSON.stringify(locale)} is not a valid BCP 47 language tag.`);
  }
}

function validateTheme(theme: Theme): void {
  checkFields('options.theme', theme, [...THEME_COLORS, 'palette']);
  THEME_COLORS.forEach((key) => {
    checkColor(`options.theme.${key}`, theme[key]);
  });

  if (!Array.isArray(theme.palette) || theme.palette.length === 0) {
    fail('options.theme.palette must contain at least one color.');
  }

  theme.palette.forEach((color, index) => {
    checkColor(`options.theme.palette[${index}]`, color);
  });
}

function validateOptions(options: ChartOptions): void {
  checkSectionFields(options);
  checkBoolean('options.autoSize', options.autoSize);
  checkLocale(options.locale);

  if (options.timeZone !== null) {
    checkTimeZone('options.timeZone', options.timeZone);
  }

  validateTheme(options.theme);
  checkString('options.font.family', options.font.family);
  checkNumber('options.font.size', options.font.size, { min: 6, max: 48 });

  checkBoolean('options.grid.vertical', options.grid.vertical);
  checkBoolean('options.grid.horizontal', options.grid.horizontal);
  checkOneOf('options.grid.style', options.grid.style, LINE_STYLES);

  checkOneOf('options.crosshair.mode', options.crosshair.mode, ['magnet', 'free']);
  checkBoolean('options.crosshair.vertical', options.crosshair.vertical);
  checkBoolean('options.crosshair.horizontal', options.crosshair.horizontal);
  checkBoolean('options.crosshair.labels', options.crosshair.labels);
  checkOneOf('options.crosshair.style', options.crosshair.style, LINE_STYLES);
  checkBoolean('options.crosshair.snapToBars', options.crosshair.snapToBars);

  checkString('options.mainSeries.type', options.mainSeries.type);
  checkOneOf('options.mainSeries.source', options.mainSeries.source, PRICE_SOURCES);
  checkFunctionOrNull('options.mainSeries.barColor', options.mainSeries.barColor);
  checkObject('options.mainSeries.styles', options.mainSeries.styles);

  for (const [type, style] of Object.entries(options.mainSeries.styles)) {
    if (style !== null) {
      checkObject(`options.mainSeries.styles.${type}`, style);
      checkStyleColors(`options.mainSeries.styles.${type}`, style);
    }
  }

  const time = options.timeScale;
  checkBoolean('options.timeScale.visible', time.visible);
  checkNumber('options.timeScale.height', time.height, { min: 0 });
  checkNumber('options.timeScale.minBarSpacing', time.minBarSpacing, { min: 0.1 });
  checkNumber('options.timeScale.maxBarSpacing', time.maxBarSpacing, { min: time.minBarSpacing });
  checkNumber('options.timeScale.barSpacing', time.barSpacing, {
    min: time.minBarSpacing,
    max: time.maxBarSpacing
  });
  checkNumber('options.timeScale.rightOffset', time.rightOffset, { min: 0 });
  checkNumber('options.timeScale.loadMoreThreshold', time.loadMoreThreshold, {
    min: 0,
    integer: true
  });
  checkFunctionOrNull('options.timeScale.formatter', time.formatter);

  const price = options.priceScale;
  checkBoolean('options.priceScale.visible', price.visible);
  checkMargins('options.priceScale.margins', price.margins);

  if (price.precision !== 'auto') {
    checkNumber('options.priceScale.precision', price.precision, {
      min: 0,
      max: 12,
      integer: true
    });
  }

  checkFunctionOrNull('options.priceScale.formatter', price.formatter);
  checkNumber('options.priceScale.minWidth', price.minWidth, { min: 0 });

  checkBoolean('options.latestPrice.line', options.latestPrice.line);
  checkBoolean('options.latestPrice.label', options.latestPrice.label);
  checkBoolean('options.latestPrice.countdown', options.latestPrice.countdown);
  checkOneOf('options.latestPrice.style', options.latestPrice.style, LINE_STYLES);

  if (options.latestPrice.color !== null) {
    checkColor('options.latestPrice.color', options.latestPrice.color);
  }

  checkBoolean('options.legend.visible', options.legend.visible);
  checkBoolean('options.legend.hideValuesOnHover', options.legend.hideValuesOnHover);
  checkNumber('options.legend.top', options.legend.top, { min: 0 });

  const interaction = options.interaction;
  checkBoolean('options.interaction.pan', interaction.pan);
  checkBoolean('options.interaction.wheelZoom', interaction.wheelZoom);
  checkBoolean('options.interaction.pinchZoom', interaction.pinchZoom);
  checkBoolean('options.interaction.axisScale', interaction.axisScale);
  checkBoolean('options.interaction.kineticScroll', interaction.kineticScroll);
  checkBoolean('options.interaction.keyboard', interaction.keyboard);
  checkNumber('options.interaction.longPressMs', interaction.longPressMs, { min: 0 });
  checkBoolean('options.interaction.touchMagnifier', interaction.touchMagnifier);
  checkNumber('options.interaction.hitTolerance', interaction.hitTolerance, { min: 1 });

  checkNumber('options.panes.defaultHeight', options.panes.defaultHeight, { min: 1 });
  checkNumber('options.panes.minHeight', options.panes.minHeight, { min: 1 });
  checkNumber('options.panes.separatorHeight', options.panes.separatorHeight, { min: 0 });
  checkFunctionOrNull('options.legend.rows', options.legend.rows);
  checkFunctionOrNull('options.legend.buttons', options.legend.buttons);

  checkNumber('options.panes.separatorWidth', options.panes.separatorWidth, { min: 0 });

  for (const key of ['separatorColor', 'separatorHoverColor'] as const) {
    if (options.panes[key] !== null) {
      checkColor(`options.panes.${key}`, options.panes[key]);
    }
  }

  checkTimeZone('options.calendar.timeZone', options.calendar.timeZone);

  parseCalendar(options.calendar, 'options.calendar');

  checkNumber('options.performance.maxPixelRatio', options.performance.maxPixelRatio, { min: 1 });
  checkNumber('options.performance.maxTrades', options.performance.maxTrades, {
    min: 0,
    max: 10_000_000,
    integer: true
  });

  checkTexts('options.texts', options.texts, CHART_TEXTS);
}

/**
 * Merges `patch` into `base`, validates the result, the sections of the modules too, and freezes
 * it. `base` is never mutated.
 */
export function resolveOptions(
  base: ChartOptions,
  patch: ChartOptionsInput | undefined,
  sections: readonly OptionsSection[]
): ChartOptions {
  if (patch !== undefined) {
    checkObject('options', patch);

    for (const key of Object.keys(patch)) {
      if (!Object.hasOwn(base, key)) {
        fail(`The chart has no option "${key}"; a module the chart lacks may add it.`);
      }
    }
  }

  const next = deepMerge<ChartOptions>(base, patch);
  validateOptions(next);
  sections.forEach((section) => {
    const label = `options.${section.key}`;
    const value: unknown = (next as unknown as Readonly<Record<string, unknown>>)[section.key];
    checkObject(label, value);
    section.validate(value as object, label);
  });
  return deepFreeze(next);
}

import { font } from '../canvas/canvas';
import { checkColor } from '../canvas/color';
import { LINE_STYLES, type ChartOptions } from '../options/types';
import { fail } from '../utils/errors';
import { deepFreeze, deepMerge } from '../utils/merge';
import {
  checkArray,
  checkBoolean,
  checkFields,
  checkNumber,
  checkOneOf,
  fieldsOf
} from '../utils/validate';
import { PRICE_SOURCES } from '../data/types';
import type {
  DrawingField,
  DrawingLevelStyle,
  DrawingStyle,
  DrawingTypeDefinition,
  WaveDegree
} from './types';

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
const TEXT_POSITIONS = ['top', 'middle', 'bottom'] as const;
export const WAVE_DEGREES: readonly WaveDegree[] = [
  'supermillennium',
  'millennium',
  'submillennium',
  'grand-supercycle',
  'supercycle',
  'cycle',
  'primary',
  'intermediate',
  'minor',
  'minute',
  'minuette',
  'subminuette',
  'micro',
  'submicro',
  'miniscule'
];
const FLAGS = [
  'fill',
  'bold',
  'italic',
  'extendLeft',
  'extendRight',
  'startArrow',
  'endArrow'
] as const;
const MAX_LEVELS = 32;

/** What a form offers for a type that does not say. */
export const DEFAULT_FIELDS: readonly DrawingField[] = ['color', 'lineWidth', 'lineStyle'];

/** Text weight of a bold style. */
const BOLD = 600;

const LEVEL_FIELDS = fieldsOf<DrawingLevelStyle>({ value: true, color: true, visible: true });

function checkLevel(path: string, level: DrawingLevelStyle): DrawingLevelStyle {
  checkFields(path, level, LEVEL_FIELDS);
  return {
    value: checkNumber(`${path}.value`, level.value),
    ...(level.color !== undefined ? { color: checkColor(`${path}.color`, level.color) } : {}),
    ...(level.visible !== undefined
      ? { visible: checkBoolean(`${path}.visible`, level.visible) }
      : {})
  };
}

function checkLevels(key: 'levels' | 'timeLevels', levels: readonly DrawingLevelStyle[]) {
  checkArray(`style.${key}`, levels);

  if (levels.length > MAX_LEVELS) {
    fail(`style.${key} can have at most ${MAX_LEVELS} levels, received ${levels.length}.`);
  }

  return levels.map((level, index) => checkLevel(`style.${key}[${index}]`, level));
}

/** Every field of a drawing's style, to reject one misspelled. */
const STYLE_FIELDS = fieldsOf<DrawingStyle>({
  color: true,
  lineWidth: true,
  lineStyle: true,
  fill: true,
  fillColor: true,
  textColor: true,
  fontSize: true,
  bold: true,
  italic: true,
  textAlign: true,
  textPosition: true,
  extendLeft: true,
  extendRight: true,
  startArrow: true,
  endArrow: true,
  levels: true,
  timeLevels: true,
  source: true,
  degree: true
});

/** Validates the fields of a style that are given, leaving the others out. */
export function checkStyle(style: Partial<DrawingStyle>): Partial<DrawingStyle> {
  checkFields('style', style, STYLE_FIELDS);
  const result: Partial<DrawingStyle> = {};

  for (const key of ['color', 'fillColor', 'textColor'] as const) {
    if (style[key] !== undefined) {
      result[key] = checkColor(`style.${key}`, style[key]);
    }
  }

  for (const key of FLAGS) {
    if (style[key] !== undefined) {
      result[key] = checkBoolean(`style.${key}`, style[key]);
    }
  }

  if (style.lineWidth !== undefined) {
    result.lineWidth = checkNumber('style.lineWidth', style.lineWidth, { min: 0.5, max: 20 });
  }

  if (style.fontSize !== undefined) {
    result.fontSize = checkNumber('style.fontSize', style.fontSize, { min: 6, max: 72 });
  }

  if (style.lineStyle !== undefined) {
    result.lineStyle = checkOneOf('style.lineStyle', style.lineStyle, LINE_STYLES);
  }

  if (style.textAlign !== undefined) {
    result.textAlign = checkOneOf('style.textAlign', style.textAlign, TEXT_ALIGNS);
  }

  if (style.textPosition !== undefined) {
    result.textPosition = checkOneOf('style.textPosition', style.textPosition, TEXT_POSITIONS);
  }

  for (const key of ['levels', 'timeLevels'] as const) {
    if (style[key] !== undefined) {
      result[key] = checkLevels(key, style[key]);
    }
  }

  if (style.source !== undefined) {
    result.source = checkOneOf('style.source', style.source, PRICE_SOURCES);
  }

  if (style.degree !== undefined) {
    result.degree = checkOneOf('style.degree', style.degree, WAVE_DEGREES);
  }

  return result;
}

/** The style of a drawing nothing sets: the chart's accent, text color and font size. */
function chartStyle(options: ChartOptions): DrawingStyle {
  const { theme } = options;
  return {
    color: theme.accent,
    lineWidth: 1.5,
    lineStyle: 'solid',
    fill: true,
    fillColor: theme.grid,
    textColor: theme.text,
    fontSize: options.font.size + 1,
    bold: false,
    italic: false,
    textAlign: 'left',
    textPosition: 'top',
    extendLeft: false,
    extendRight: false,
    startArrow: false,
    endArrow: false,
    levels: [],
    timeLevels: [],
    source: 'close',
    degree: 'intermediate'
  };
}

/** The style of each type under a chart's options, which change as a whole. */
const typeStyles = new WeakMap<ChartOptions, WeakMap<DrawingTypeDefinition, DrawingStyle>>();

/** The style a type's drawings take where their own leaves a field out; frozen, as it is kept. */
export function typeStyle(options: ChartOptions, definition: DrawingTypeDefinition): DrawingStyle {
  let styles = typeStyles.get(options);

  if (!styles) {
    styles = new WeakMap();
    typeStyles.set(options, styles);
  }

  let style = styles.get(definition);

  if (!style) {
    style = deepFreeze(
      deepMerge<DrawingStyle>(chartStyle(options), definition.defaultStyle?.(options.theme))
    );
    styles.set(definition, style);
  }

  return style;
}

/**
 * The style each drawing's own style gives under the options it was last painted with: a
 * drawing is painted and hit-tested over and over, and its style object is replaced when it
 * changes.
 */
const resolvedStyles = new WeakMap<
  Partial<DrawingStyle>,
  {
    readonly options: ChartOptions;
    readonly definition: DrawingTypeDefinition;
    readonly style: DrawingStyle;
  }
>();

/** The style a drawing paints with: the chart's defaults, its type's, then its own; frozen. */
export function resolveStyle(
  options: ChartOptions,
  definition: DrawingTypeDefinition,
  style: Partial<DrawingStyle>
): DrawingStyle {
  const cached = resolvedStyles.get(style);

  if (cached?.options === options && cached.definition === definition) {
    return cached.style;
  }

  const resolved = deepFreeze(deepMerge<DrawingStyle>(typeStyle(options, definition), style));
  resolvedStyles.set(style, { options, definition, style: resolved });
  return resolved;
}

/** The CSS font of a style's text in `family`. */
export function textFont(style: DrawingStyle, family: string): string {
  const slant = style.italic ? 'italic ' : '';
  return `${slant}${font(style.fontSize, family, style.bold ? BOLD : 'normal')}`;
}

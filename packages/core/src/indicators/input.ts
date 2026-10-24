import { checkColor } from '../canvas/color';
import type { PriceSource } from '../data/types';
import { fail } from '../utils/errors';
import {
  checkArray,
  checkBoolean,
  checkFields,
  checkNumber,
  checkObject,
  checkOneOf,
  checkString,
  fieldsOf
} from '../utils/validate';
import { PRICE_SOURCES } from '../data/types';
import { parseInterval, type Interval, type IntervalInput } from '../feed/interval';
import { LINE_STYLES } from '../options/types';
import { checkFills, checkOutputs } from './definition';
import { resolveParams } from './instance';
import type {
  IndicatorDefinition,
  IndicatorFill,
  IndicatorInput,
  IndicatorOutput,
  IndicatorOutputStyle,
  IndicatorPatch,
  IndicatorReference,
  ParamValues
} from './types';

const INPUT_FIELDS = fieldsOf<IndicatorInput>({
  id: true,
  type: true,
  params: true,
  pane: true,
  scale: true,
  source: true,
  timeframe: true,
  visible: true,
  colors: true,
  styles: true,
  levels: true
});
const PATCH_FIELDS = fieldsOf<IndicatorPatch>({
  params: true,
  pane: true,
  source: true,
  timeframe: true,
  visible: true,
  scale: true,
  colors: true,
  styles: true,
  levels: true
});
const STYLE_FIELDS = fieldsOf<IndicatorOutputStyle>({
  visible: true,
  lineWidth: true,
  lineStyle: true,
  autoscale: true
});
const REFERENCE_FIELDS = fieldsOf<IndicatorReference>({ kind: true, id: true, key: true });

/** Checks that an indicator is an object of the fields an input has. */
export function checkInputFields(input: IndicatorInput): void {
  checkFields('indicator', input, INPUT_FIELDS);
}

/** Checks that changes of an indicator are an object of the fields a patch has. */
export function checkPatchFields(patch: IndicatorPatch): void {
  checkFields('patch', patch, PATCH_FIELDS);
}

/**
 * What of an indicator type its settings are checked against: its shades and its window too, if
 * it has them.
 */
export type IndicatorRules = Pick<IndicatorDefinition, 'type' | 'params' | 'outputs' | 'fills'> & {
  lookback?(params: ParamValues): number;
};

export function checkStyle(label: string, style: IndicatorOutputStyle): IndicatorOutputStyle {
  checkFields(label, style, STYLE_FIELDS);
  const { visible, lineWidth, lineStyle, autoscale } = style;
  return {
    ...(visible === undefined ? {} : { visible: checkBoolean(`${label}.visible`, visible) }),
    ...(autoscale === undefined
      ? {}
      : { autoscale: checkBoolean(`${label}.autoscale`, autoscale) }),
    ...(lineWidth === undefined
      ? {}
      : { lineWidth: checkNumber(`${label}.lineWidth`, lineWidth, { min: 0.5, max: 10 }) }),
    ...(lineStyle === undefined
      ? {}
      : { lineStyle: checkOneOf(`${label}.lineStyle`, lineStyle, LINE_STYLES) })
  };
}

/**
 * Settings by output key, such as colors, over `current`: those of outputs gone go, `null`
 * restores the type's, and a key of no output fails.
 */
export function byOutput<T>(
  type: string,
  current: Readonly<Record<string, T>>,
  patch: Readonly<Record<string, T | null>> | undefined,
  outputs: readonly IndicatorOutput[],
  what: 'colors' | 'styles',
  check: (label: string, value: T) => T
): Record<string, T> {
  const keys = new Set(outputs.map((output) => output.key));
  const result = new Map(Object.entries(current).filter(([key]) => keys.has(key)));

  if (patch !== undefined) {
    checkObject(`indicator.${what}`, patch);
  }

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!keys.has(key)) {
      fail(`Indicator "${type}" has no output "${key}" for ${what}.`);
    }

    if (value === null) {
      result.delete(key);
    } else {
      result.set(key, check(`${what}.${key}`, value));
    }
  }

  return Object.fromEntries(result);
}

export function checkLevels(levels: readonly number[]): readonly number[] {
  checkArray('indicator.levels', levels);
  return levels.map((level, index) => checkNumber(`indicator.levels[${String(index)}]`, level));
}

/** Checks the form of a source: a price, or another indicator's output by its id. */
export function checkSource(
  source: PriceSource | IndicatorReference
): PriceSource | IndicatorReference {
  if (typeof source === 'string') {
    return checkOneOf('indicator.source', source, PRICE_SOURCES);
  }

  checkFields('indicator.source', source, REFERENCE_FIELDS);
  checkOneOf('indicator.source.kind', source.kind, ['indicator']);
  checkString('indicator.source.id', source.id);

  if (source.key !== undefined) {
    checkString('indicator.source.key', source.key);
  }

  return source;
}

/** Parses the timeframe of an indicator; `null` for the chart's bars. */
export function parseTimeframe(timeframe: IntervalInput | null): Interval | null {
  return timeframe === null ? null : parseInterval(timeframe, 'indicator.timeframe');
}

/**
 * The parameters of an indicator, the type's defaults merged with `overrides`, and the outputs
 * and shades they make, checked with the window they make.
 */
export function resolveSettings(
  definition: IndicatorRules,
  overrides: ParamValues | undefined,
  type: string
): {
  params: ParamValues;
  outputs: readonly IndicatorOutput[];
  fills: readonly IndicatorFill[];
} {
  const params = resolveParams(definition, overrides, type);
  const outputs = definition.outputs(params);
  checkOutputs(outputs, type);
  const fills = definition.fills?.(params) ?? [];
  checkFills(fills, outputs, type);

  if (definition.lookback) {
    checkNumber(`lookback() of "${type}"`, definition.lookback(params), { min: 1, integer: true });
  }

  return { params, outputs, fills };
}

/** What an input sets that its type decides, checked: parameters, outputs and their looks. */
export function parseSettings(definition: IndicatorRules, input: IndicatorInput) {
  const { params, outputs, fills } = resolveSettings(definition, input.params, input.type);
  return {
    params,
    outputs,
    fills,
    visible: input.visible === undefined ? true : checkBoolean('indicator.visible', input.visible),
    colors: byOutput(input.type, {}, input.colors, outputs, 'colors', checkColor),
    styles: byOutput(input.type, {}, input.styles, outputs, 'styles', checkStyle),
    levels: input.levels === undefined ? null : checkLevels(input.levels)
  };
}

/**
 * Checks an indicator against its type as `chart.indicators.add()` does, without a chart: the
 * parameters and the outputs and shades they make, the source, the timeframe, the colors and
 * styles by output key and the reference lines. Throws the `ChartError` that `add()` would, e.g.
 * on what a user typed into a settings form, before keeping it. `definition` is the type's, such
 * as `MACD` of `@kumochart-sdk/core/indicators` or one of `chart.indicators.definition()`. What
 * needs the chart is left to `add()`: the pane, the indicator a source reads and its timeframe, a
 * free id.
 */
export function checkIndicatorInput(definition: IndicatorRules, input: IndicatorInput): void {
  checkInputFields(input);
  checkString('indicator.type', input.type);

  if (input.type !== definition.type) {
    fail(`indicator.type is "${input.type}", but the definition is of "${definition.type}".`);
  }

  if (input.id !== undefined) {
    checkString('indicator.id', input.id);
  }

  if (input.scale !== undefined) {
    checkString('indicator.scale', input.scale);
  }

  if (input.source !== undefined) {
    checkSource(input.source);
  }

  if (input.timeframe !== undefined) {
    parseTimeframe(input.timeframe);
  }

  parseSettings(definition, input);
}

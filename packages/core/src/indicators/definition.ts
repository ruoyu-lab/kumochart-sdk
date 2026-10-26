import { MARKER_SHAPES } from '../canvas/shapes';
import { PRICE_SOURCES } from '../data/types';
import { fail } from '../utils/errors';
import {
  checkArray,
  checkBoolean,
  checkNumber,
  checkObject,
  checkOneOf,
  checkString
} from '../utils/validate';
import { LINE_STYLES } from '../options/types';
import type { IndicatorDefinition, IndicatorFill, IndicatorOutput } from './types';

const PLOT_KINDS = ['line', 'segments', 'box', 'histogram', 'columns', 'marker', 'hidden'] as const;

/** Checks that `name` of a definition is a function. */
function checkFunction(definition: object, name: string): void {
  if (typeof (definition as Readonly<Record<string, unknown>>)[name] !== 'function') {
    fail(`definition.${name} must be a function.`);
  }
}

/**
 * Checks the shape of a definition before it is registered or computed, with a chart as without
 * one; what its parameters make is checked with them.
 */
export function validateDefinition(definition: IndicatorDefinition): void {
  checkObject('indicator definition', definition);
  checkString('definition.type', definition.type);
  const streaming = 'create' in definition;
  const windowed = 'compute' in definition && 'lookback' in definition;

  if (!streaming && !windowed) {
    fail('An indicator definition needs create(), or lookback() and compute().');
  }

  (streaming ? ['create'] : ['lookback', 'compute']).forEach((name) => {
    checkFunction(definition, name);
  });
  checkString('definition.name', definition.name);
  checkOneOf('definition.pane', definition.pane, ['main', 'new']);
  checkObject('definition.params', definition.params);

  for (const [key, spec] of Object.entries(definition.params)) {
    if (spec.legend !== undefined) {
      checkBoolean(`definition.params.${key}.legend`, spec.legend);
    }
  }

  if (typeof definition.precision === 'string') {
    checkOneOf('definition.precision', definition.precision, ['price', 'volume']);
  } else {
    checkNumber('definition.precision', definition.precision, { min: 0, max: 12, integer: true });
  }

  if (typeof definition.outputs !== 'function') {
    fail('An indicator definition needs an outputs() function.');
  }

  if (definition.source !== undefined) {
    checkOneOf('definition.source', definition.source, PRICE_SOURCES);
  }

  for (const name of ['levels', 'fills'] as const) {
    if (definition[name] !== undefined && typeof definition[name] !== 'function') {
      fail(`definition.${name} must be a function of the parameters.`);
    }
  }

  if (definition.range !== undefined) {
    checkObject('definition.range', definition.range);
    checkNumber('definition.range.min', definition.range.min);
    checkNumber('definition.range.max', definition.range.max);
  }
}

/** Checks the shades of a definition for one set of parameters, between `outputs` it makes. */
export function checkFills(
  fills: readonly IndicatorFill[],
  outputs: readonly IndicatorOutput[],
  type: string
): void {
  checkArray(`definition.fills of "${type}"`, fills);
  const keys = new Set(outputs.map((output) => output.key));

  fills.forEach((fill, index) => {
    const label = `definition.fills[${index}]`;
    checkObject(label, fill);

    if (!keys.has(fill.from) || !keys.has(fill.to)) {
      fail(`${label} of "${type}" shades from "${fill.from}" to "${fill.to}", which is no output.`);
    }

    if (fill.colorBy !== undefined) {
      checkOneOf(`${label}.colorBy`, fill.colorBy, ['from', 'higher']);
    }
  });
}

/** Checks the outputs a definition produces for one set of parameters. */
export function checkOutputs(outputs: readonly IndicatorOutput[], type: string): void {
  checkArray(`outputs of "${type}"`, outputs);
  const keys = new Set<string>();

  outputs.forEach((output, index) => {
    checkObject(`outputs of "${type}"[${index}]`, output);
    checkString(`outputs of "${type}": key`, output.key);

    if (keys.has(output.key)) {
      fail(
        `Indicator "${type}" produces the output key "${output.key}" twice; use distinct parameter values.`
      );
    }

    keys.add(output.key);
  });

  for (const { key, plot, offset, themeColor, precision, autoscale } of outputs) {
    const label = `output "${key}" of "${type}"`;
    checkObject(`${label}: plot`, plot);
    checkOneOf(`${label}: kind`, plot.kind, PLOT_KINDS);

    if (autoscale !== undefined) {
      checkBoolean(`${label}: autoscale`, autoscale);
    }

    if (offset !== undefined) {
      checkNumber(`${label}: offset`, offset, { integer: true });
    }

    if (precision !== undefined) {
      checkNumber(`${label}: precision`, precision, { min: 0, max: 12, integer: true });
    }

    if (themeColor !== undefined) {
      checkOneOf(`${label}: themeColor`, themeColor, ['up', 'down']);
    }

    if ((plot.kind === 'line' || plot.kind === 'segments') && plot.style !== undefined) {
      checkOneOf(`${label}: style`, plot.style, LINE_STYLES);
    }

    if ((plot.kind === 'line' || plot.kind === 'segments') && plot.width !== undefined) {
      checkNumber(`${label}: width`, plot.width, { min: 0.5, max: 10 });
    }

    if (plot.kind === 'histogram') {
      checkOneOf(`${label}: colorBy`, plot.colorBy, ['sign', 'change', 'bar']);
    }

    if (plot.kind === 'box' && !keys.has(plot.from)) {
      fail(`The boxes of ${label} reach down to "${plot.from}", which is no output.`);
    }

    if (plot.kind === 'box' && plot.group !== undefined && !keys.has(plot.group)) {
      fail(`The boxes of ${label} are told apart by "${plot.group}", which is no output.`);
    }

    if (plot.kind === 'columns') {
      if (typeof plot.from === 'number') {
        checkNumber(`${label}: from`, plot.from);
      } else if (!keys.has(plot.from)) {
        fail(`The columns of ${label} start at "${plot.from}", which is no output.`);
      }

      if (plot.width !== undefined) {
        checkNumber(`${label}: width`, plot.width, { min: 0, max: 1, exclusiveMin: true });
      }
    } else if (plot.kind === 'marker') {
      if (plot.value !== undefined) {
        checkBoolean(`${label}: value`, plot.value);
      }

      if (plot.shape === undefined && plot.text === undefined && plot.value !== true) {
        fail(`The marker of ${label} needs a shape, a text or the value.`);
      }

      if (plot.shape !== undefined) {
        checkOneOf(`${label}: shape`, plot.shape, MARKER_SHAPES);
      }

      if (plot.size !== undefined) {
        checkNumber(`${label}: size`, plot.size, { min: 1, max: 40 });
      }
    }
  }
}

import type { ChartCore } from '../chart/chart-core';
import { formatValue } from '../format/value-format';
import { fail } from '../utils/errors';
import { checkNumber } from '../utils/validate';
import { indicatorColors, indicatorFormat, outputFormat, valueColor } from './contributor';
import type { ChartIndicators } from './chart-indicators';
import type { IndicatorLanguage } from './texts';
import { validateDefinition } from './definition';
import type {
  Indicator,
  IndicatorDefinition,
  IndicatorInput,
  IndicatorPatch,
  IndicatorValue,
  ParamValues
} from './types';

export interface IndicatorsApi {
  /**
   * Replaces every indicator, in order: one may read an indicator before it. What reads an
   * indicator, such as an alert, must find it among them. An invalid input throws and changes
   * nothing.
   */
  set(indicators: readonly IndicatorInput[]): void;
  /** Adds an indicator and returns its id: the one it has, or one the chart numbers for it. */
  add(indicator: IndicatorInput): string;
  /**
   * Changes an indicator. Colors and styles change by output key, `null` restoring the type's;
   * `levels: null` restores the type's reference lines.
   */
  update(id: string, patch: IndicatorPatch): void;
  /** Throws for an unknown id, and while something, such as an alert, reads the indicator. */
  remove(id: string): void;
  /** Removes every indicator; throws while something, such as an alert, reads one. */
  clear(): void;
  /** The indicator of an id, or `null`. */
  get(id: string): Indicator | null;
  list(): Indicator[];
  /**
   * Values of every output drawn on bar `index` (default: the latest bar). Shifted outputs give
   * the value computed `offset` bars earlier, and are drawn beyond the bars too: `index` may lie
   * before the first bar or after the latest one. An indicator of a timeframe of its own gives
   * what the bar shows: the value of the latest bar of the timeframe closed by its end, of the
   * one still forming on the latest bar.
   */
  valuesAt(id: string, index?: number): IndicatorValue[];
  /**
   * Computes an indicator again from the bar holding time `from` on, with the indicators reading
   * it: for a calculator that reads data besides the bars, such as trades or funding rates it
   * fetches, which is to be called whenever that data changes, as the chart cannot tell. From
   * the latest bar, only that bar is computed again, as for a tick; from an earlier one, or
   * without `from`, the whole indicator is. Throws for an unknown id.
   */
  refresh(id: string, from?: number): void;
  /** Adds an indicator type to this chart, named by its `type`. */
  register<P extends ParamValues>(definition: IndicatorDefinition<P>): void;
  /** Removes an indicator type. Fails while indicators of it are on the chart. */
  unregister(type: string): void;
  /** Every indicator type the chart has. */
  types(): string[];
  /**
   * The definition of a type, or `null` for an unknown type: its parameters, outputs and
   * reference lines, for a form of its settings.
   */
  definition(type: string): Readonly<IndicatorDefinition> | null;
  /**
   * The full name of a type in the chart's language, from the texts given to the module, such
   * as `Moving average` for `MA`; `null` without one.
   */
  title(type: string): string | null;
  /**
   * A word of the definitions, such as the label of an output, a parameter or an option, in the
   * chart's language, from the texts given to the module; the word itself without one.
   */
  label(text: string): string;
}

export function createIndicatorsApi(
  core: ChartCore,
  indicators: ChartIndicators,
  language: () => IndicatorLanguage
): IndicatorsApi {
  const { store } = indicators;

  return {
    set: (inputs) => {
      core.run(() => {
        indicators.set(inputs);
      });
    },
    add: (indicator) => core.run(() => indicators.add(indicator)),
    update: (id, patch) => {
      core.run(() => {
        indicators.update(id, patch);
      });
    },
    remove: (id) => {
      core.run(() => {
        indicators.remove(id);
      });
    },
    clear: () => {
      core.run(() => {
        indicators.set([]);
      });
    },
    get: (id) => {
      const entry = store.get(id);
      return entry ? store.info(entry) : null;
    },
    list: () => store.list().map((entry) => store.info(entry)),
    valuesAt: (id, index = core.bars.length - 1) => {
      const entry = store.require(id);
      entry.series.sync();
      const frame = core.frame();
      const colors = indicatorColors(entry, core.options.theme);
      const format = indicatorFormat(entry, frame.priceFormat);

      return entry.outputs.map((output, column) => {
        const value = entry.series.drawn(column, index);
        return {
          key: output.key,
          label: language().label(output.label),
          color: valueColor(entry, output, column, index, colors, core.options.theme),
          value: Number.isNaN(value) ? null : value,
          text: formatValue(core.formatter, value, outputFormat(output, format))
        };
      });
    },
    refresh: (id, from) => {
      core.run(() => {
        const entry = store.require(id);
        const time =
          from === undefined ? Number.NEGATIVE_INFINITY : checkNumber('refresh() from', from);

        // Values computed again before the latest bar are no live move, which alerts would hear.
        if (entry.series.refresh(time)) {
          core.values.reset();
        }

        core.invalidate();
      });
    },
    register: (definition) => {
      core.run(() => {
        validateDefinition(definition);
        store.registry.register(definition);
        core.bus.emit('typesChange', {
          kind: 'indicator',
          type: definition.type,
          registered: true
        });
      });
    },
    unregister: (type) => {
      core.run(() => {
        store.registry.require(type);
        const used = store.list().filter((entry) => entry.type === type);

        if (used.length > 0) {
          fail(
            `The indicators ${used.map((entry) => `"${entry.id}"`).join(', ')} are of type "${type}"; remove them first.`
          );
        }

        store.registry.unregister(type);
        core.bus.emit('typesChange', { kind: 'indicator', type, registered: false });
      });
    },
    types: () => store.registry.types(),
    definition: (type) => store.registry.get(type) ?? null,
    title: (type) => language().title(type),
    label: (text) => language().label(text)
  };
}

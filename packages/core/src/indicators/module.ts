import { defineModule, type ChartModule } from '../chart/modules';
import { fail } from '../utils/errors';
import { Registry } from '../utils/registry';
import { checkArray, checkFields } from '../utils/validate';
import { createIndicatorsApi, type IndicatorsApi } from './api';
import { IndicatorBases } from './basis';
import { ChartIndicators, type SavedIndicator } from './chart-indicators';
import { indicatorContributors } from './contributor';
import { validateDefinition } from './definition';
import { IndicatorStore } from './indicator-store';
import { indicatorLegend } from './legend';
import {
  checkIndicatorTexts,
  indicatorLanguage,
  type IndicatorLanguage,
  type IndicatorTexts
} from './texts';
import type { IndicatorDefinition } from './types';

export type IndicatorsModule = ChartModule<{
  readonly api: { readonly indicators: IndicatorsApi };
  readonly state: { readonly indicators: readonly SavedIndicator[] };
}>;

/** What `indicators()` takes beside the types. */
export interface IndicatorsModuleOptions {
  /**
   * The words of the indicators in other languages, such as the `indicatorTexts` of the SDK's
   * types; those given later win. The legend and `valuesAt()` follow the chart's `locale`.
   */
  readonly texts?: readonly IndicatorTexts[];
}

/**
 * The indicators module: `chart.indicators`, with the indicator types given, such as
 * `indicators(allIndicators)` or `indicators([MA, MACD, RSI])`. Other types can be registered
 * with `chart.indicators.register()`.
 */
export function indicators(
  definitions: readonly IndicatorDefinition[] = [],
  options: IndicatorsModuleOptions = {}
): IndicatorsModule {
  // Checked at runtime: the definitions may come from plain JavaScript.
  checkArray('indicators()', definitions);
  const types = new Set<string>();

  definitions.forEach((definition) => {
    validateDefinition(definition);

    if (types.has(definition.type)) {
      fail(`indicators() is given the indicator type "${definition.type}" twice.`);
    }

    types.add(definition.type);
  });
  checkFields('indicators() options', options, ['texts']);
  const texts = options.texts ?? [];
  checkIndicatorTexts('indicators() texts', texts);

  return defineModule({
    name: 'indicators',
    install: (core) => {
      const registry = new Registry<IndicatorDefinition>(
        'indicator type',
        [],
        'Give it to the indicators module, or register it with chart.indicators.register().'
      );
      definitions.forEach((definition) => {
        registry.register(definition);
      });
      const store = new IndicatorStore(new IndicatorBases(core.market, core.bars), registry);
      const chartIndicators = new ChartIndicators(core, store);
      let spoken: { readonly locale: string | null; readonly words: IndicatorLanguage } | null =
        null;
      /** The words of the indicators in the chart's language, worked out as it changes. */
      const language = () => {
        const { locale } = core.options;

        if (spoken?.locale !== locale) {
          spoken = { locale, words: indicatorLanguage(texts, locale) };
        }

        return spoken.words;
      };
      core.contributors.push(indicatorContributors(store));
      core.legendRows.push(
        indicatorLegend(
          store,
          () => core.options,
          () => core.formatter,
          language
        )
      );
      core.values.provide('indicator', chartIndicators.values());
      core.paneOccupants.push({
        occupants: (paneId) =>
          store
            .list()
            .filter((entry) => entry.pane === paneId)
            .map((entry) => entry.id),
        removed: () => undefined
      });
      core.stateParts.push(chartIndicators.state());
      return { indicators: createIndicatorsApi(core, chartIndicators, language) };
    }
  });
}

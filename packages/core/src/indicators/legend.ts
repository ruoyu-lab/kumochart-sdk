import type { LegendProvider } from '../chart/cursor';
import { formatInterval } from '../feed/interval';
import type { Formatter } from '../format/formatter';
import { formatValue } from '../format/value-format';
import type { ChartOptions } from '../options/types';
import type { LegendSegment } from '../render/cursor-painter';
import { indicatorColors, indicatorFormat, outputFormat, valueColor } from './contributor';
import { timeframeOf, type IndicatorEntry, type IndicatorStore } from './indicator-store';
import type { IndicatorLanguage } from './texts';

/** Parameter values for the legend, options by their names: `20 2`, `Session`. */
function paramText({ definition, params }: IndicatorEntry, language: IndicatorLanguage): string {
  return Object.entries(params)
    .flatMap(([key, value]) => {
      const spec = definition.params[key];

      if (spec?.legend === false) {
        return [];
      }

      return (typeof value === 'number' ? [value] : [...value]).map((item) => {
        const option = spec?.options?.find((each) => each.value === item);
        return option ? language.label(option.label) : item;
      });
    })
    .join(' ');
}

/** The indicator an indicator reads, e.g. ` · RSI` or ` · MACD dea`. */
function inputText(entry: IndicatorEntry, language: IndicatorLanguage): string {
  const upstream = entry.upstream;

  if (!upstream || typeof entry.source === 'string') {
    return '';
  }

  const key = entry.source.key === undefined ? '' : ` ${entry.source.key}`;
  return ` · ${language.label(upstream.definition.name)}${key}`;
}

/**
 * One legend row per indicator: its name, parameters and timeframe, such as `MA 20 1h`, then the
 * values of its outputs.
 */
export function indicatorLegend(
  store: IndicatorStore,
  options: () => ChartOptions,
  formatter: () => Formatter,
  language: () => IndicatorLanguage
): LegendProvider {
  return (frame, index) =>
    store.list().map((entry) => ({
      item: {
        kind: 'indicator',
        id: entry.id,
        type: entry.type,
        paneId: entry.pane,
        visible: entry.visible
      },
      segments: () => {
        const { theme } = options();
        entry.series.sync();
        const colors = indicatorColors(entry, theme);
        const format = indicatorFormat(entry, frame.priceFormat);
        const words = language();
        const name = words.label(entry.definition.name);
        const timeframe = timeframeOf(entry);
        const title = [name, paramText(entry, words), timeframe ? formatInterval(timeframe) : '']
          .filter((part) => part !== '')
          .join(' ');
        const segments: LegendSegment[] = [
          { text: `${title}${inputText(entry, words)}`, color: theme.textMuted }
        ];
        // The title names the value of an indicator of one: it goes without its label.
        const labelled = entry.outputs.filter((output) => output.legend !== false).length > 1;

        entry.outputs.forEach((output, column) => {
          if (output.legend === false || entry.styles[output.key]?.visible === false) {
            return;
          }

          const value = entry.series.drawn(column, index);
          const text = formatValue(formatter(), value, outputFormat(output, format));
          segments.push({
            text: labelled ? `${words.label(output.label)} ${text}` : text,
            color: valueColor(entry, output, column, index, colors, theme)
          });
        });

        return segments;
      }
    }));
}

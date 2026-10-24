import { describe, expect, it } from 'vitest';
import {
  allIndicators,
  BOLL,
  indicatorLanguage,
  indicators,
  indicatorTexts,
  MA
} from '../../src/indicators';
import { createBars } from '../helpers/bars';
import { createModularChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** The texts the legend paints. */
function legend(chart: { element: HTMLElement; screenshot(): unknown }): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

describe('the words of indicators', () => {
  it('follow the locale of the chart, from the texts given to the module', () => {
    const chart = createModularChart({
      modules: [indicators(allIndicators, { texts: [indicatorTexts] })],
      locale: 'zh-CN'
    });
    chart.data.set(createBars(120));
    const id = chart.indicators.add({ type: 'BOLL' });

    expect(legend(chart).some((text) => text.startsWith('上轨 '))).toBe(true);
    expect(chart.indicators.valuesAt(id).map((value) => value.label)).toContain('上轨');
    expect(chart.indicators.title('BOLL')).toBe('布林带');
    expect(chart.indicators.label('Period')).toBe('周期');

    chart.applyOptions({ locale: 'en-US' });
    expect(legend(chart).some((text) => text.startsWith('Upper '))).toBe(true);
    expect(chart.indicators.title('BOLL')).toBe('Bollinger Bands');
    expect(chart.indicators.label('Period')).toBe('Period');
  });

  it('are those given later, a numbered label taking those of its number', () => {
    const chart = createModularChart({
      modules: [
        indicators([MA, BOLL], {
          texts: [
            indicatorTexts,
            { zh: { names: { MA: '均线' }, labels: { Upper: '上沿', 'Band #{n}': '带 {n}' } } }
          ]
        })
      ],
      locale: 'zh'
    });

    expect(chart.indicators.title('MA')).toBe('均线');
    expect(chart.indicators.label('Upper')).toBe('上沿');
    expect(chart.indicators.label('Band #3')).toBe('带 3');
    expect(chart.indicators.label('Lower')).toBe('下轨');
    expect(chart.indicators.title('UNKNOWN')).toBeNull();
  });

  it('are the definitions’ own without texts, and checked as they are given', () => {
    const chart = createModularChart({ modules: [indicators([BOLL])], locale: 'zh-CN' });

    expect(chart.indicators.label('Upper')).toBe('Upper');
    expect(chart.indicators.title('BOLL')).toBeNull();
    expect(() =>
      indicators([BOLL], { texts: [{ zh: { labels: { Upper: 1 as never } } }] })
    ).toThrow('indicators() texts[0].zh.labels."Upper"');
    expect(() => indicators([BOLL], { texts: [{ zh: { word: {} } as never }] })).toThrow(
      'has no field "word"'
    );
  });

  it('are told without a chart, by the same rules', () => {
    const words = indicatorLanguage([indicatorTexts, { ja: { labels: { Upper: '上' } } }], 'ja-JP');

    expect(words.title('MA')).toBe('移動平均線');
    expect(words.label('Upper')).toBe('上');
    expect(words.label('Upper Band #2')).toBe('上限バンド 2');
    expect(indicatorLanguage([], 'ja-JP').label('Upper')).toBe('Upper');
  });
});

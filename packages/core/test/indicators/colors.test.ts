import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { createTestChart } from '../helpers/chart';
import { barsFromCloses } from './helpers';

/** The color the legend paints each of its texts in. */
function legendColors(chart: Chart): Map<string, string> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const ctx = canvas?.getContext('2d');
  const colors = new Map<string, string>();

  if (ctx) {
    ctx.fillText = (text: string) => {
      // The legend paints in colors given as strings.
      colors.set(text, ctx.fillStyle as string);
    };
  }

  chart.screenshot();
  return colors;
}

describe('the colors of values', () => {
  it('are those the values are drawn in, in valuesAt() and the legend', () => {
    const chart = createTestChart({ locale: 'en-US' });
    // The latest bar falls from 13 to 12.5.
    chart.data.set(barsFromCloses([10, 11, 12, 13, 12.5]));
    chart.indicators.register({
      type: 'SIGNS',
      name: 'Signs',
      pane: 'new',
      precision: 2,
      params: {},
      outputs: () => [
        { key: 'close', label: 'CLOSE', plot: { kind: 'histogram', colorBy: 'change' } },
        { key: 'sell', label: 'SELL', plot: { kind: 'marker', shape: 'arrow-down' } }
      ],
      lookback: () => 1,
      compute: (window) => [window.bar(0).close, window.bar(0).high]
    });
    const volume = chart.indicators.add({ type: 'VOL' });
    // Short enough to have a histogram on the few bars.
    const macd = chart.indicators.add({ type: 'MACD', params: { fast: 1, slow: 2, signal: 2 } });
    const signs = chart.indicators.add({ type: 'SIGNS' });
    const { theme } = chart.options();
    const value = (id: string, key: string) => {
      const found = chart.indicators.valuesAt(id).find((item) => item.key === key);

      if (!found) {
        throw new Error(`No value ${key}.`);
      }

      return found;
    };
    const histogram = value(macd, 'histogram');
    expect(histogram.value).not.toBeNull();
    const labelled = (item: ReturnType<typeof value>) => `${item.label} ${item.text}`;
    const expected: Array<[ReturnType<typeof value>, string, string]> = [
      // Volume columns follow the bar, the MACD histogram its sign, the closes their change.
      // The volume, the one value of its indicator, goes without its label.
      [value(volume, 'volume'), theme.volumeDown, value(volume, 'volume').text],
      [histogram, (histogram.value ?? 0) < 0 ? theme.down : theme.up, labelled(histogram)],
      [value(signs, 'close'), theme.down, labelled(value(signs, 'close'))],
      // Downward arrows take the sell color.
      [value(signs, 'sell'), theme.sell, labelled(value(signs, 'sell'))]
    ];
    const legend = legendColors(chart);

    for (const [item, color, text] of expected) {
      expect(item.color, item.key).toBe(color);
      expect(legend.get(text), item.key).toBe(color);
    }
  });
});

/** The colors the scene fills columns in, as `fillRect()` paints them. */
function columnColors(chart: Chart): Set<string> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const ctx = canvas?.getContext('2d');
  const colors = new Set<string>();

  if (ctx) {
    ctx.fillRect = function (this: CanvasRenderingContext2D) {
      colors.add(this.fillStyle as string);
    };
  }

  chart.screenshot();
  return colors;
}

describe('the colors of histograms', () => {
  it('draw the columns in the color set for them, as the legend shows it', () => {
    const chart = createTestChart({ locale: 'en-US' });
    chart.data.set(barsFromCloses([10, 11, 12, 13, 12.5, 12, 13, 14]));
    const { theme } = chart.options();
    const volume = chart.indicators.add({ type: 'VOL' });
    const theirs = columnColors(chart);
    expect(theirs).toContain(theme.volumeUp);
    expect(theirs).toContain(theme.volumeDown);

    chart.indicators.update(volume, { colors: { volume: '#123456' } });
    const own = columnColors(chart);
    expect(own).toContain('#123456');
    expect(own).not.toContain(theme.volumeUp);
    expect(own).not.toContain(theme.volumeDown);
    expect(chart.indicators.valuesAt(volume)[0]?.color).toBe('#123456');
  });
});

describe('the widths of lines', () => {
  /** The widths of the lines the scene strokes when it repaints. */
  function widths(chart: Chart): number[] {
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D;
    const seen: number[] = [];
    ctx.stroke = () => {
      seen.push(ctx.lineWidth);
    };
    chart.applyOptions({});
    chart.screenshot();
    return seen;
  }

  it("are the plot's unless the user sets one", () => {
    const chart = createTestChart();
    chart.data.set(barsFromCloses([10, 11, 12, 13, 12.5]));
    chart.indicators.register({
      type: 'THICK',
      name: 'Thick',
      pane: 'new',
      precision: 2,
      params: {},
      outputs: () => [{ key: 'close', label: 'CLOSE', plot: { kind: 'line', width: 3.5 } }],
      lookback: () => 1,
      compute: (window) => [window.bar(0).close]
    });
    const id = chart.indicators.add({ type: 'THICK' });
    expect(widths(chart)).toContain(3.5);

    chart.indicators.update(id, { styles: { close: { lineWidth: 2 } } });
    expect(widths(chart)).toContain(2);
    expect(widths(chart)).not.toContain(3.5);
  });
});

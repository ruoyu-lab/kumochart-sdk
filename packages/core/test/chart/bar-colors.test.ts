import { describe, expect, it, vi } from 'vitest';
import type { BarColorContext } from '../../src/options/types';
import { candlesSeries, hollowCandlesSeries, ohlcSeries } from '../../src/series/bars';
import { PointBuffer, type SeriesTypeDefinition } from '../../src/series/types';
import { lightTheme } from '../../src/options/themes';
import { chartWithBars } from '../helpers/chart';

/** A context recording the color of every fill and stroke. */
function recorder() {
  const painted: Array<{ kind: 'fill' | 'stroke'; color: string }> = [];
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt' };
  const noop = () => undefined;
  const ctx = {
    ...state,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    save: noop,
    restore: noop,
    clip: noop,
    setLineDash: noop,
    fill() {
      painted.push({ kind: 'fill', color: this.fillStyle });
    },
    stroke() {
      painted.push({ kind: 'stroke', color: this.strokeStyle });
    }
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted };
}

function paint<Style extends object>(definition: SeriesTypeDefinition<Style>, points: PointBuffer) {
  const { ctx, painted } = recorder();
  definition.paint({
    ctx,
    pixelRatio: 1,
    width: 400,
    height: 300,
    barSpacing: 10,
    style: definition.defaultStyle(lightTheme, lightTheme.accent),
    points,
    valueToY: (value) => value,
    bars: null,
    first: 0,
    transform: null
  });
  return painted;
}

/** A rising bar, a rising bar in teal and a falling bar in teal. */
function points(): PointBuffer {
  const buffer = new PointBuffer();
  buffer.reset(3);
  buffer.pushOhlc(10, 60, 40, 80, 50, 100, true);
  buffer.pushOhlc(20, 60, 40, 80, 50, 100, true, '#0d9488');
  buffer.pushOhlc(30, 50, 40, 80, 60, 100, false, '#0d9488');
  return buffer;
}

describe('bar colors', () => {
  it('draws the chosen colors over the style colors', () => {
    const fills = paint(candlesSeries, points())
      .filter((item) => item.kind === 'fill')
      .map((item) => item.color);

    expect(fills).toContain(lightTheme.up);
    expect(fills.filter((color) => color === '#0d9488')).toHaveLength(2);
    // Hollow candles keep rising bars hollow, in their chosen color.
    expect(
      paint(hollowCandlesSeries, points()).filter(
        (item) => item.kind === 'stroke' && item.color === '#0d9488'
      ).length
    ).toBeGreaterThanOrEqual(2);
    expect(paint(ohlcSeries, points()).map((item) => item.color)).toEqual([
      lightTheme.up,
      lightTheme.down,
      '#0d9488',
      '#0d9488'
    ]);
  });

  it('reads the color of each bar once, however many colors there are', () => {
    const count = 500;
    const buffer = new PointBuffer();
    buffer.reset(count);

    for (let index = 0; index < count; index += 1) {
      const color = index % 2 === 0 ? null : `#${String(index).padStart(6, '0')}`;
      buffer.pushOhlc(index, 60, 40, 80, 50, 100, index % 3 === 0, color);
    }

    let reads = 0;
    const counted = Object.create(buffer, {
      color: {
        value: (index: number) => {
          reads += 1;
          return buffer.color(index);
        }
      }
    }) as PointBuffer;

    const readsOf = (painting: () => void) => {
      reads = 0;
      painting();
      return reads;
    };

    expect(readsOf(() => paint(candlesSeries, counted))).toBe(count);
    expect(readsOf(() => paint(hollowCandlesSeries, counted))).toBe(count);
    expect(readsOf(() => paint(ohlcSeries, counted))).toBe(count);
  });

  it('asks for the color of every visible bar, with indicator values at hand', () => {
    const chart = chartWithBars(200);
    const ma = chart.indicators.add({ id: 'ma', type: 'MA', params: { periods: [5] } });
    const seen: Array<{ index: number; close: number; ma: number }> = [];
    const barColor = vi.fn(({ index, bar, indicator }: BarColorContext) => {
      seen.push({ index, close: bar.close, ma: indicator(ma) });
      return bar.close > indicator(ma, 'ma5') ? '#0d9488' : null;
    });
    chart.applyOptions({ mainSeries: { barColor } });
    chart.screenshot();

    const visible = chart.timeScale.visibleLogicalRange();
    const last = seen.at(-1);
    expect(seen.length).toBeGreaterThan(20);
    expect(last?.index).toBe(chart.data.length - 1);
    expect(last?.close).toBe(chart.data.last()?.close);
    expect(last?.ma).toBeCloseTo(chart.indicators.valuesAt(ma)[0]?.value ?? Number.NaN);
    expect(seen[0]?.index).toBeLessThanOrEqual(Math.ceil(visible?.from ?? 0));
  });

  it('names a bad color or an unknown indicator', () => {
    const chart = chartWithBars(50);
    chart.applyOptions({ mainSeries: { barColor: () => 3 as never } });
    expect(() => chart.screenshot()).toThrow(
      'mainSeries.barColor must return a color string or null, received 3'
    );

    chart.applyOptions({ mainSeries: { barColor: ({ indicator }) => String(indicator('nope')) } });
    expect(() => chart.screenshot()).toThrow('unknown indicator "nope"');

    expect(() => {
      chart.applyOptions({ mainSeries: { barColor: 'red' as never } });
    }).toThrow('options.mainSeries.barColor');
  });
});

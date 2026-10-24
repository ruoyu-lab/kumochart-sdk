import { describe, expect, it } from 'vitest';
import { withAlpha } from '../../src/canvas/color';
import type { Chart } from '../helpers/chart';
import type { BarInput } from '../../src/data/types';
import { lightTheme } from '../../src/options/themes';
import { MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';
import { compute, definitionOf, expectClose, incrementalMatchesFull } from './helpers';

const N = Number.NaN;
const KEYS = [
  'conversionLine',
  'baseLine',
  'laggingSpan',
  'leadingSpanA',
  'leadingSpanB',
  'kumoCloudUpperLine',
  'kumoCloudLowerLine'
] as const;
type Key = (typeof KEYS)[number];

/** A deterministic random walk, so highs and lows move independently of the closes. */
function randomBars(count: number): BarInput[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = open + (random() - 0.5) * 4;
    return {
      time: T0 + index * MINUTE,
      open,
      high: Math.max(open, close) + random() * 2,
      low: Math.min(open, close) - random() * 2,
      close
    };
  });
}

/**
 * Ichimoku written out plainly, by the bar each value is drawn on: the conversion and base lines
 * are the middles of the high-low ranges of their lengths, the lagging span is the close drawn
 * `displacement - 1` bars back, leading span A the average of the conversion and base lines and
 * leading span B the middle of its own length, both drawn `displacement - 1` bars ahead; the
 * edges of the cloud are the higher and the lower span.
 */
function reference(
  bars: readonly BarInput[],
  { conversion = 9, base = 26, spanB = 52, displacement = 26 } = {}
): (key: Key, at: number) => number {
  const donchian = (index: number, length: number) => {
    if (index < length - 1 || index >= bars.length) {
      return N;
    }

    const window = bars.slice(index - length + 1, index + 1);
    return (
      (Math.max(...window.map((bar) => bar.high)) + Math.min(...window.map((bar) => bar.low))) / 2
    );
  };
  const shift = displacement - 1;

  const spanAt = (at: number) =>
    (donchian(at - shift, conversion) + donchian(at - shift, base)) / 2;
  return (key, at) => {
    switch (key) {
      case 'conversionLine':
        return donchian(at, conversion);
      case 'baseLine':
        return donchian(at, base);
      case 'laggingSpan':
        return bars[at + shift]?.close ?? N;
      case 'leadingSpanA':
        return spanAt(at);
      case 'leadingSpanB':
        return donchian(at - shift, spanB);
      case 'kumoCloudUpperLine':
        return Math.max(spanAt(at), donchian(at - shift, spanB));
      case 'kumoCloudLowerLine':
        return Math.min(spanAt(at), donchian(at - shift, spanB));
    }
  };
}

/** Values of `key` the chart draws on the logical indices `from` to `to`. */
function drawn(chart: Chart, id: string, key: Key, from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => {
    const value = chart.indicators.valuesAt(id, from + offset).find((item) => item.key === key);
    return value?.value ?? N;
  });
}

function expected(
  reference: (key: Key, at: number) => number,
  key: Key,
  from: number,
  to: number
): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => reference(key, from + offset));
}

/** Highs, lows and closes of six bars. */
const SIX: BarInput[] = [
  [10, 8, 9],
  [11, 9, 10],
  [12, 10, 11],
  [13, 9, 9],
  [12, 8, 10],
  [14, 11, 13]
].map(([high = 0, low = 0, close = 0], index) => ({
  time: T0 + index * MINUTE,
  open: close,
  high,
  low,
  close
}));

describe('ICHIMOKU', () => {
  it('has its parameters and shifts', () => {
    const definition = definitionOf('ICHIMOKU');
    const params = { conversion: 9, base: 26, spanB: 52, displacement: 26 };

    expect(
      Object.fromEntries(Object.entries(definition.params).map(([k, v]) => [k, v.default]))
    ).toEqual(params);
    expect(definition.outputs(params).map(({ key, offset }) => [key, offset ?? 0])).toEqual([
      ['conversionLine', 0],
      ['baseLine', 0],
      ['laggingSpan', -25],
      ['leadingSpanA', 25],
      ['leadingSpanB', 25],
      ['kumoCloudUpperLine', 25],
      ['kumoCloudLowerLine', 25]
    ]);
    expect(definition.fills?.(params)).toEqual([
      { from: 'leadingSpanA', to: 'leadingSpanB', colorBy: 'higher' }
    ]);
  });

  it('shades the cloud in the theme colors: up where span A is higher, down where span B is', () => {
    const chart = createTestChart();
    chart.data.set(randomBars(100));
    const id = chart.indicators.add({ type: 'ICHIMOKU' });
    const spans = () =>
      chart.indicators
        .valuesAt(id)
        .filter((value) => value.key.startsWith('leadingSpan'))
        .map((value) => value.color);
    /** The shades of the cloud, in the order painted: where span A is higher, then span B. */
    const cloud = (up: string, down: string) => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
      const ctx = canvas?.getContext('2d');

      if (!ctx) {
        throw new Error('No scene layer.');
      }

      const colors: string[] = [];
      ctx.fill = function (this: CanvasRenderingContext2D) {
        colors.push(this.fillStyle as string);
      };
      chart.applyOptions({});
      chart.screenshot();
      const shades = [withAlpha(up, 0.14), withAlpha(down, 0.14)];
      return colors.filter((color) => shades.includes(color));
    };

    expect(spans()).toEqual([lightTheme.up, lightTheme.down]);
    expect(cloud(lightTheme.up, lightTheme.down)).toEqual([
      withAlpha(lightTheme.up, 0.14),
      withAlpha(lightTheme.down, 0.14)
    ]);

    // Red for up and green for down, as Chinese markets color them.
    chart.applyOptions({ theme: { up: '#e5484d', down: '#14a37f' } });
    expect(spans()).toEqual(['#e5484d', '#14a37f']);
    expect(cloud('#e5484d', '#14a37f')).toEqual([
      withAlpha('#e5484d', 0.14),
      withAlpha('#14a37f', 0.14)
    ]);

    chart.indicators.update(id, { colors: { leadingSpanB: '#123456' } });
    expect(spans()).toEqual(['#e5484d', '#123456']);
  });

  it('computes the middles of the high-low ranges', () => {
    // Conversion (2): middles of bars 0-1, 1-2, …: (11 + 8) / 2, (12 + 9) / 2, 11, 10.5, 11.
    // Base (3): (12 + 8) / 2, (13 + 9) / 2, (13 + 8) / 2, (14 + 8) / 2.
    // Span A averages them: (10.5 + 10) / 2, 11, 10.5, 11. Span B (4): 10.5, 10.5, 11.
    const values = compute('ICHIMOKU', SIX, {
      conversion: 2,
      base: 3,
      spanB: 4,
      displacement: 3
    });
    expectClose(values.conversionLine ?? [], [N, 9.5, 10.5, 11, 10.5, 11]);
    expectClose(values.baseLine ?? [], [N, N, 10, 11, 10.5, 11]);
    expectClose(values.laggingSpan ?? [], [9, 10, 11, 9, 10, 13]);
    expectClose(values.leadingSpanA ?? [], [N, N, 10.25, 11, 10.5, 11]);
    expectClose(values.leadingSpanB ?? [], [N, N, N, 10.5, 10.5, 11]);
    expectClose(values.kumoCloudUpperLine ?? [], [N, N, N, 11, 10.5, 11]);
    expectClose(values.kumoCloudLowerLine ?? [], [N, N, N, 10.5, 10.5, 11]);
  });

  it('draws the spans displacement - 1 bars ahead and the close as many behind', () => {
    const chart = createTestChart();
    chart.data.set(SIX);
    const id = chart.indicators.add({
      type: 'ICHIMOKU',
      params: { conversion: 2, base: 3, spanB: 4, displacement: 3 }
    });

    // Logical indices -3 to 8: two bars before the first bar to two after the latest.
    expectClose(drawn(chart, id, 'leadingSpanA', -3, 8), [
      N,
      N,
      N,
      N,
      N,
      N,
      N,
      10.25,
      11,
      10.5,
      11,
      N
    ]);
    expectClose(drawn(chart, id, 'leadingSpanB', -3, 8), [
      N,
      N,
      N,
      N,
      N,
      N,
      N,
      N,
      10.5,
      10.5,
      11,
      N
    ]);
    expectClose(drawn(chart, id, 'laggingSpan', -3, 8), [N, 9, 10, 11, 9, 10, 13, N, N, N, N, N]);
    expectClose(drawn(chart, id, 'baseLine', -3, 8), [N, N, N, N, N, 10, 11, 10.5, 11, N, N, N]);
  });

  it('matches the reference on every bar it draws on, before and after the bars', () => {
    const bars = randomBars(300);
    const chart = createTestChart();
    chart.data.set(bars);
    const id = chart.indicators.add({ type: 'ICHIMOKU' });
    const expectedOf = reference(bars);

    for (const key of KEYS) {
      expectClose(drawn(chart, id, key, -30, 330), expected(expectedOf, key, -30, 330), 9);
    }

    // The cloud is drawn up to 25 bars past the latest bar, the lagging span up to 25 before it.
    const at = (key: Key, index: number) =>
      chart.indicators.valuesAt(id, index).find((item) => item.key === key)?.value ?? null;
    expect(at('leadingSpanA', 324)).not.toBeNull();
    expect(at('leadingSpanA', 325)).toBeNull();
    expect(at('laggingSpan', 274)).not.toBeNull();
    expect(at('laggingSpan', 275)).toBeNull();
  });

  it('matches the reference with other parameters', () => {
    const bars = randomBars(120);
    const params = { conversion: 7, base: 22, spanB: 44, displacement: 22 };
    const chart = createTestChart();
    chart.data.set(bars);
    const id = chart.indicators.add({ type: 'ICHIMOKU', params });
    const expectedOf = reference(bars, params);

    for (const key of KEYS) {
      expectClose(drawn(chart, id, key, -25, 145), expected(expectedOf, key, -25, 145), 9);
    }
  });

  it('gives the same values incrementally and in full', () => {
    const { full, incremental } = incrementalMatchesFull('ICHIMOKU', randomBars(120));

    for (const [key, values] of Object.entries(full)) {
      expectClose(incremental[key] ?? [], values, 9);
    }
  });

  it('shows the values drawn on the hovered bar in the legend', () => {
    const bars = randomBars(100);
    const chart = createTestChart({ locale: 'en-US' });
    chart.data.set(bars);
    const id = chart.indicators.add({ type: 'ICHIMOKU' });
    const texts = () => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };
    const label = (key: Key, index: number) => {
      const value = chart.indicators.valuesAt(id, index).find((item) => item.key === key);
      return `${value?.label ?? ''} ${value?.text ?? ''}`;
    };

    // The latest bar: no lagging span is drawn on it, and the spans computed 25 bars before are.
    const latest = texts();
    expect(latest).toContain('Ichimoku 9 26 52 26');
    expect(latest).toContain('Lagging Span —');
    expect(latest).toContain(label('leadingSpanA', 99));
    expect(chart.indicators.valuesAt(id)[3]?.value).toBeCloseTo(
      reference(bars)('leadingSpanA', 99),
      9
    );
    // The edges of the cloud are not in the legend.
    expect(latest.some((text) => text.startsWith('Kumo'))).toBe(false);

    chart.crosshair.set({ time: bars[60]?.time ?? 0 });
    expect(texts()).toContain(label('laggingSpan', 60));
    expect(chart.indicators.valuesAt(id, 60)[2]?.value).toBe(bars[85]?.close);
  });

  it('shows nothing of the bars after the replay cursor, also after seeking back', () => {
    const bars = randomBars(200);
    const chart = createTestChart();
    chart.data.set(bars, { interval: '1m' });
    const id = chart.indicators.add({ type: 'ICHIMOKU' });

    chart.replay.start(bars[150]?.time ?? 0);
    expect(chart.data.length).toBe(151);
    const revealed = reference(bars.slice(0, 151));

    for (const key of KEYS) {
      expectClose(drawn(chart, id, key, -30, 220), expected(revealed, key, -30, 220), 9);
    }

    // Seeking back recomputes fewer bars: the lagging span must not show the closes it had.
    chart.replay.seek(bars[90]?.time ?? 0);
    expect(chart.data.length).toBe(91);
    const earlier = reference(bars.slice(0, 91));

    for (const key of KEYS) {
      expectClose(drawn(chart, id, key, -30, 220), expected(earlier, key, -30, 220), 9);
    }
  });

  it('passes its shift on to an indicator that reads it', () => {
    const chart = createTestChart();
    chart.data.set(randomBars(120));
    const cloud = chart.indicators.add({ type: 'ICHIMOKU' });
    const average = chart.indicators.add({
      type: 'MA',
      params: { periods: [1] },
      source: { kind: 'indicator', id: cloud, key: 'leadingSpanA' }
    });
    const spanA = drawn(chart, cloud, 'leadingSpanA', 100, 150);
    const ma = Array.from(
      { length: 51 },
      (_, offset) => chart.indicators.valuesAt(average, 100 + offset)[0]?.value ?? N
    );

    expectClose(ma, spanA, 9);
    // Up to 25 bars past the latest one.
    expect(ma[44]).not.toBeNaN();
  });
});

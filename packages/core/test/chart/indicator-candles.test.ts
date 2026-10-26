import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type {
  IndicatorDefinition,
  IndicatorOutput,
  IndicatorStream
} from '../../src/indicators/types';
import { lightTheme } from '../../src/options/themes';
import { chartWithBars } from '../helpers/chart';
import { canvasCalls } from '../setup';

const BARS = 30;

/** Outputs of a candle: its open, high and low hidden, its close drawn as the candle. */
const CANDLE: readonly IndicatorOutput[] = [
  { key: 'open', label: 'Open', plot: { kind: 'hidden' } },
  { key: 'high', label: 'High', plot: { kind: 'hidden' } },
  { key: 'low', label: 'Low', plot: { kind: 'hidden' } },
  {
    key: 'close',
    label: 'Close',
    plot: { kind: 'candles', open: 'open', high: 'high', low: 'low' }
  }
];

/**
 * Candles of every bar but each fourth, which has no close: rising on even bars (from 0 to 10,
 * reaching 12 and -3), falling on odd ones (from 0 to -5, reaching 4 and -20).
 */
function candleAt(index: number): number[] {
  if (index % 4 === 3) {
    return [0, 1, -1, Number.NaN];
  }

  return index % 2 === 0 ? [0, 12, -3, 10] : [0, 4, -20, -5];
}

function candles(outputs: readonly IndicatorOutput[] = CANDLE): IndicatorDefinition {
  return {
    type: 'CANDLES',
    name: 'Candles',
    pane: 'new',
    params: {},
    precision: 2,
    outputs: () => outputs,
    create: () => {
      const from = (index: number): IndicatorStream => ({
        next() {
          index += 1;
          return candleAt(index - 1);
        },
        clone: () => from(index)
      });
      return from(0);
    }
  };
}

/** The bodies the scene filled, each with its color: the rectangles of a path, then its fill. */
function bodies(chart: Chart): Array<{ color: string; count: number }> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const ctx = canvas?.getContext('2d');

  if (!canvas || !ctx) {
    throw new Error('No scene layer.');
  }

  const calls = canvasCalls(canvas);
  ctx.fill = function (this: CanvasRenderingContext2D) {
    calls.push({ name: 'fill', args: [this.fillStyle] });
  };
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  const found: Array<{ color: string; count: number }> = [];
  let rects = 0;

  for (const { name, args } of calls) {
    if (name === 'beginPath') {
      rects = 0;
    } else if (name === 'rect') {
      rects += 1;
    } else if (name === 'fill' && rects > 0) {
      found.push({ color: String(args[0]), count: rects });
    }
  }

  return found;
}

/** The texts of the legend, each with the color it is written in. */
function legend(chart: Chart): Array<{ text: string; color: string }> {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const ctx = canvas?.getContext('2d');

  if (!canvas || !ctx) {
    throw new Error('No cursor layer.');
  }

  const written: Array<{ text: string; color: string }> = [];
  ctx.fillText = function (this: CanvasRenderingContext2D, text: string) {
    // The legend paints in colors, never gradients.
    written.push({ text, color: this.fillStyle as string });
  };
  chart.screenshot();
  return written;
}

function setUp(outputs?: readonly IndicatorOutput[]) {
  const chart = chartWithBars(BARS);
  chart.indicators.register(candles(outputs));
  const before = bodies(chart).length;
  const id = chart.indicators.add({ type: 'CANDLES' });
  return { chart, id, before };
}

describe('indicator outputs drawn as candles', () => {
  it('draw a candle on each bar with all four values, rising up and falling down', () => {
    const { chart, before } = setUp();
    const drawn = bodies(chart).slice(before);

    // Of the thirty bars, 0 2 4 … 28 rise and 1 5 9 … 29 fall; 3 7 11 … 27 have no close.
    expect(drawn).toEqual([
      { color: lightTheme.up, count: 15 },
      { color: lightTheme.down, count: 8 }
    ]);
  });

  it('fit the price scale to their highs and lows, which are hidden outputs', () => {
    const { chart, id } = setUp();
    const range = chart.priceScale(chart.indicators.get(id)?.pane ?? '').range();

    expect(range?.max).toBeGreaterThanOrEqual(12);
    expect(range?.min).toBeLessThanOrEqual(-20);
  });

  it('write their four values in the legend in the color of the candle', () => {
    const { chart, id } = setUp();
    // The latest bar, 29, falls.
    const row = legend(chart).filter(({ text }) => /^(Open|High|Low|Close) /.test(text));
    expect(row).toEqual([
      { text: 'Open 0.00', color: lightTheme.down },
      { text: 'High 4.00', color: lightTheme.down },
      { text: 'Low -20.00', color: lightTheme.down },
      { text: 'Close -5.00', color: lightTheme.down }
    ]);
    expect(chart.indicators.valuesAt(id, 28).map((value) => value.color)).toEqual(
      Array.from({ length: 4 }, () => lightTheme.up)
    );
  });

  it('take the color of their output on every candle, the legend too', () => {
    const { chart, id, before } = setUp();
    chart.indicators.update(id, { colors: { close: '#123456' } });

    expect(bodies(chart).slice(before)).toEqual([
      { color: '#123456', count: 15 },
      { color: '#123456', count: 8 }
    ]);
    expect(chart.indicators.valuesAt(id, 28).map((value) => value.color)).toEqual(
      Array.from({ length: 4 }, () => '#123456')
    );
  });

  it('take their open, high and low from outputs there are', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register(
      candles([
        { key: 'open', label: 'Open', plot: { kind: 'hidden' } },
        {
          key: 'close',
          label: 'Close',
          plot: { kind: 'candles', open: 'open', high: 'top', low: 'open' }
        }
      ])
    );

    expect(() => chart.indicators.add({ type: 'CANDLES' })).toThrow(
      'The candles of output "close" of "CANDLES" take their high from "top", which is no output.'
    );
  });
});

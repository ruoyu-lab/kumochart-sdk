import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { IndicatorDefinition } from '../../src/indicators/types';
import { createBars } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

const BARS = 30;
const FAST = '#111111';
const SLOW = '#222222';

/** Two lines at 40 and 60, between reference lines at 30 and 70. */
const LINES: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'LINES',
  name: 'Lines',
  pane: 'new',
  params: { periods: { default: [5, 10], integer: true, min: 1 } },
  precision: 0,
  levels: () => [30, 70],
  outputs: ({ periods }) =>
    periods.map((period, index) => ({
      key: `l${String(period)}`,
      label: `L${String(period)}`,
      plot: { kind: 'line' as const },
      color: index === 0 ? FAST : SLOW
    })),
  lookback: () => 1,
  compute: (_window, { periods }) => periods.map((_period, index) => 40 + index * 20)
};

function chartWithLines(): Chart {
  const chart = chartWithBars(BARS);
  chart.indicators.register(LINES);
  return chart;
}

interface Stroke {
  readonly color: string;
  readonly width: number;
  readonly dash: readonly number[];
}

/** The strokes of the scene, each with its color, width and dash. */
function strokes(chart: Chart): Stroke[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const ctx = canvas?.getContext('2d');

  if (!canvas || !ctx) {
    throw new Error('No scene layer.');
  }

  const painted: Stroke[] = [];
  let dash: readonly number[] = [];
  ctx.setLineDash = (segments: number[]) => {
    dash = segments;
  };
  ctx.stroke = function (this: CanvasRenderingContext2D) {
    painted.push({ color: this.strokeStyle as string, width: this.lineWidth, dash });
  };
  canvasCalls(canvas).length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return painted;
}

const colored = (list: readonly Stroke[], color: string) =>
  list.filter((stroke) => stroke.color === color);

function legend(chart: Chart): string {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return calls
    .filter((call) => call.name === 'fillText')
    .map((call) => String(call.args[0]))
    .join(' ');
}

describe('indicator styles', () => {
  it('hide an output from the plot, the legend and the price scale', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({ type: 'LINES' });
    const pane = chart.indicators.get(id)?.pane ?? '';

    expect(colored(strokes(chart), SLOW)).toHaveLength(1);
    expect(legend(chart)).toContain('L10');
    expect(chart.priceScale(pane).range()?.max).toBeGreaterThanOrEqual(60);

    chart.indicators.update(id, { styles: { l10: { visible: false } } });

    expect(colored(strokes(chart), SLOW)).toHaveLength(0);
    expect(colored(strokes(chart), FAST)).toHaveLength(1);
    expect(legend(chart)).not.toContain('L10');
    expect(chart.priceScale(pane).range()?.max).toBeLessThan(60);
  });

  it('leave an output out of fitting the price scale, still drawn', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({ type: 'LINES', styles: { l10: { autoscale: false } } });
    const pane = chart.indicators.get(id)?.pane ?? '';

    expect(chart.priceScale(pane).range()?.max).toBeLessThan(60);
    expect(colored(strokes(chart), SLOW)).toHaveLength(1);

    // With nothing else to fit, the scale fits them all the same.
    chart.indicators.update(id, { styles: { l5: { autoscale: false } } });
    expect(chart.priceScale(pane).range()?.max).toBeGreaterThanOrEqual(60);

    // As the type sets it, and in its place.
    chart.indicators.register({
      ...LINES,
      type: 'FAR',
      outputs: (params) =>
        LINES.outputs(params).map((output, index) => ({ ...output, autoscale: index === 0 }))
    });
    const far = chart.indicators.add({ type: 'FAR', pane });
    chart.indicators.update(id, { styles: { l5: null, l10: null } });
    expect(chart.priceScale(pane).range()?.max).toBeGreaterThanOrEqual(60);
    chart.indicators.remove(id);
    expect(chart.priceScale(pane).range()?.max).toBeLessThan(60);
    chart.indicators.update(far, { styles: { l10: { autoscale: true } } });
    expect(chart.priceScale(pane).range()?.max).toBeGreaterThanOrEqual(60);
  });

  it('leave the bars as they are when pivot points, the previous period and sessions are added', () => {
    const chart = createTestChart({ timeZone: 'UTC' });
    chart.data.set(createBars(3000));
    const before = chart.priceScale('main').range();
    const pivots = chart.indicators.add({ type: 'PIVOTS' });
    const sessions = chart.indicators.add({ type: 'SESSIONS' });
    chart.indicators.add({ type: 'PREVHLC', params: { period: 4 } });
    const value = (id: string, key: string) =>
      chart.indicators.valuesAt(id).find((item) => item.key === key)?.value ?? Number.NaN;

    expect(value(pivots, 'r5')).toBeGreaterThan(before?.max ?? Number.NaN);
    expect(value(pivots, 's5')).toBeLessThan(before?.min ?? Number.NaN);
    // The London session began before the bars in view.
    expect(value(sessions, 'londonLow')).toBeLessThan(before?.min ?? Number.NaN);
    expect(chart.priceScale('main').range()).toEqual(before);
  });

  it('set the width and the style of a line', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({
      type: 'LINES',
      styles: { l5: { lineWidth: 3, lineStyle: 'dashed' } }
    });
    const [fast] = colored(strokes(chart), FAST);
    const [slow] = colored(strokes(chart), SLOW);

    expect(fast?.width).toBe(3);
    expect(fast?.dash.length).toBeGreaterThan(0);
    expect(slow?.width).toBe(1.25);
    expect(slow?.dash).toEqual([]);

    // `null` restores the type's.
    chart.indicators.update(id, { styles: { l5: null } });
    expect(colored(strokes(chart), FAST)[0]?.width).toBe(1.25);
    expect(chart.indicators.get(id)?.styles).toEqual({});
  });

  it('replace the reference lines of the type, or restore them', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({ type: 'LINES', levels: [] });
    // Reference lines are dashed, a pixel wide, as the latest price's line is.
    const dashed = () =>
      strokes(chart).filter((stroke) => stroke.width === 1 && stroke.dash.length > 0).length;
    const none = dashed();

    chart.indicators.update(id, { levels: null });
    expect(dashed() - none).toBe(2);
    expect(chart.indicators.get(id)?.levels).toBeNull();

    chart.indicators.update(id, { levels: [20, 50, 80] });
    expect(dashed() - none).toBe(3);
    expect(chart.indicators.get(id)?.levels).toEqual([20, 50, 80]);
  });

  it('follow the outputs as the parameters change', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({
      type: 'LINES',
      colors: { l5: '#ff0000', l10: '#00ff00' },
      styles: { l10: { visible: false } }
    });

    // The overrides of outputs gone go; those of new outputs can come with the parameters.
    chart.indicators.update(id, { params: { periods: [7, 10] }, colors: { l7: '#0000ff' } });

    expect(chart.indicators.get(id)?.colors).toEqual({ l7: '#0000ff', l10: '#00ff00' });
    expect(chart.indicators.get(id)?.styles).toEqual({ l10: { visible: false } });

    chart.indicators.update(id, { colors: { l7: null } });
    expect(chart.indicators.get(id)?.colors).toEqual({ l10: '#00ff00' });
  });

  it('are checked', () => {
    const chart = chartWithLines();
    const id = chart.indicators.add({ type: 'LINES' });

    expect(() => {
      chart.indicators.update(id, { styles: { nope: { visible: false } } });
    }).toThrow('Indicator "LINES" has no output "nope" for styles.');
    expect(() => {
      chart.indicators.update(id, { styles: { l5: { lineWidth: 20 } } });
    }).toThrow(/lineWidth/);
    expect(() => {
      chart.indicators.update(id, {
        styles: { l5: { lineStyle: 'wavy' as unknown as 'solid' } }
      });
    }).toThrow(/lineStyle/);
    expect(() => {
      chart.indicators.update(id, { levels: [Number.NaN] });
    }).toThrow(/levels\[0\]/);
    expect(() => {
      chart.indicators.update(id, { styles: { l5: { autoscale: 'no' as unknown as boolean } } });
    }).toThrow('styles.l5.autoscale must be a boolean, received "no".');
    expect(() => {
      chart.indicators.register({
        ...LINES,
        type: 'BAD',
        outputs: () => [
          { key: 'x', label: 'X', plot: { kind: 'line' }, autoscale: 0 as unknown as boolean }
        ]
      });
      chart.indicators.add({ type: 'BAD' });
    }).toThrow('output "x" of "BAD": autoscale must be a boolean, received 0.');
  });

  it('are kept by the chart state', () => {
    const chart = chartWithLines();
    chart.indicators.add({
      id: 'lines',
      type: 'LINES',
      styles: { l5: { lineWidth: 2 } },
      levels: [50]
    });
    const state = chart.saveState();
    const other = chartWithLines();
    other.loadState(state);

    expect(other.indicators.get('lines')).toMatchObject({
      styles: { l5: { lineWidth: 2 } },
      levels: [50]
    });
  });
});

describe('indicator definitions', () => {
  it('describe a type for a form of its settings', () => {
    const chart = chartWithLines();
    const rsi = chart.indicators.definition('RSI');

    expect(rsi?.params.period?.default).toBe(14);
    const params = { period: 14, maType: 1, maLength: 14, bbMult: 2 };
    expect(rsi?.outputs(params).map((output) => output.key)).toEqual(['rsi', 'rsiBasedMa']);
    expect(rsi?.levels?.(params)).toEqual([70, 50, 30]);
    expect(chart.indicators.definition('LINES')).toBe(LINES);
    expect(chart.indicators.definition('NOPE')).toBeNull();
  });
});

describe('indicator colors', () => {
  it('leave the palette colors of the other outputs as they were when one is set', () => {
    const chart = chartWithBars(BARS);
    const id = chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20] } });
    const colors = () => chart.indicators.valuesAt(id).map((value) => value.color);
    const [, ten, twenty] = colors();

    chart.indicators.update(id, { colors: { ma5: '#ff0000' } });

    expect(colors()).toEqual(['#ff0000', ten, twenty]);
  });
});

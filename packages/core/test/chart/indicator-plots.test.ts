import { describe, expect, it, vi } from 'vitest';
import { withAlpha } from '../../src/canvas/color';
import type { Chart } from '../helpers/chart';
import type {
  IndicatorDefinition,
  IndicatorFill,
  IndicatorOutput,
  IndicatorStream
} from '../../src/indicators/types';
import { lightTheme } from '../../src/options/themes';
import type { Theme } from '../../src/options/types';
import { indicatorColors } from '../../src/indicators/contributor';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';
import { canvasCalls, type CanvasCall } from '../setup';

const BARS = 30;

/**
 * An indicator whose outputs give `values(index)` at each bar: every bar of the 30 on the chart
 * is visible, so every defined value is drawn.
 */
function plots(
  outputs: readonly IndicatorOutput[],
  values: (index: number) => number[],
  pane: 'main' | 'new' = 'new'
): IndicatorDefinition {
  return {
    type: 'PLOTS',
    name: 'Plots',
    pane,
    params: {},
    precision: 2,
    outputs: () => outputs,
    create: () => {
      /** Gives the values of bar `index` next; a copy goes on from the same bar. */
      const from = (index: number): IndicatorStream => ({
        next() {
          index += 1;
          return values(index - 1);
        },
        clone: () => from(index)
      });
      return from(0);
    }
  };
}

function scene(chart: Chart): CanvasCall[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');

  if (!canvas) {
    throw new Error('No scene layer.');
  }

  const calls = canvasCalls(canvas);
  calls.length = 0;
  chart.screenshot();
  return [...calls];
}

function legend(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

interface PaintedPath {
  readonly color: string;
  /** The points of each subpath. */
  readonly shapes: ReadonlyArray<ReadonlyArray<readonly [x: number, y: number]>>;
}

/** The paths the scene fills or strokes, with the color each one is painted in. */
function painted(chart: Chart, method: 'fill' | 'stroke'): PaintedPath[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const ctx = canvas?.getContext('2d');

  if (!canvas || !ctx) {
    throw new Error('No scene layer.');
  }

  const calls = canvasCalls(canvas);
  // The stub context records calls only; record the color too.
  ctx[method] = function (this: CanvasRenderingContext2D) {
    const color = method === 'fill' ? this.fillStyle : this.strokeStyle;
    calls.push({ name: method, args: [color] });
  };
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  const paths: PaintedPath[] = [];
  let shapes: Array<Array<[number, number]>> = [];

  for (const { name, args } of calls) {
    if (name === 'beginPath') {
      shapes = [];
    } else if (name === 'moveTo') {
      shapes.push([[Number(args[0]), Number(args[1])]]);
    } else if (name === 'lineTo') {
      shapes.at(-1)?.push([Number(args[0]), Number(args[1])]);
    } else if (name === method) {
      paths.push({ color: args[0] as string, shapes });
    }
  }

  return paths;
}

/** Logical indices `from` to `to`. */
function indices(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

function count(calls: readonly CanvasCall[], name: string, text?: string): number {
  return calls.filter((call) => call.name === name && (text === undefined || call.args[0] === text))
    .length;
}

/** Every third bar: 0, 3, 6 … 27, ten bars of the thirty. */
const third = (index: number) => index % 3 === 0;

describe('columns', () => {
  const outputs: IndicatorOutput[] = [
    { key: 'low', label: 'Low', plot: { kind: 'hidden' }, legend: false },
    { key: 'high', label: 'High', plot: { kind: 'columns', from: 'low' }, color: '#123456' }
  ];

  it('are drawn from another output to the value, where both are defined', () => {
    const chart = chartWithBars(BARS);
    const before = count(scene(chart), 'fillRect');
    chart.indicators.register({
      ...plots(outputs, (i) => (third(i) ? [10, 20] : [10, NaN])),
      type: 'COLUMNS'
    });
    const id = chart.indicators.add({ type: 'COLUMNS' });

    expect(count(scene(chart), 'fillRect') - before).toBe(10);
    // The scale holds the starts, though their output is hidden.
    const range = chart.priceScale(chart.indicators.get(id)?.pane ?? '').range();
    expect(range?.min).toBeLessThanOrEqual(10);
    expect(range?.max).toBeGreaterThanOrEqual(20);
  });

  it('start at a fixed value and can be hollow', () => {
    const chart = chartWithBars(BARS);
    const before = scene(chart);
    chart.indicators.register({
      ...plots(
        [{ key: 'v', label: 'V', plot: { kind: 'columns', from: 0, hollow: true, width: 0.8 } }],
        (i) => [third(i) ? 50 : NaN]
      ),
      type: 'HOLLOW'
    });
    const id = chart.indicators.add({ type: 'HOLLOW' });
    const after = scene(chart);

    expect(count(after, 'fillRect')).toBe(count(before, 'fillRect'));
    // Ten outlines, and the clip of the new pane.
    expect(count(after, 'rect') - count(before, 'rect')).toBe(11);
    expect(chart.priceScale(chart.indicators.get(id)?.pane ?? '').range()?.min).toBeLessThanOrEqual(
      0
    );
  });

  it('must start at an output or a number', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'columns', from: 'nope' } }], () => [1]),
      type: 'BAD'
    });
    expect(() => chart.indicators.add({ type: 'BAD' })).toThrow(/start at "nope"/);

    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'columns', from: 0, width: 2 } }], () => [1]),
      type: 'WIDE'
    });
    expect(() => chart.indicators.add({ type: 'WIDE' })).toThrow(/width/);
  });
});

describe('markers', () => {
  it('draw a shape and a text at the value, where it is defined', () => {
    const chart = chartWithBars(BARS);
    const before = scene(chart);
    chart.indicators.register({
      ...plots(
        [
          {
            key: 'buy',
            label: 'Buy',
            plot: { kind: 'marker', shape: 'arrow-up', text: 'B' },
            legend: false
          },
          { key: 'note', label: 'Note', plot: { kind: 'marker', text: '金叉' }, legend: false }
        ],
        (i) => [third(i) ? 95 : NaN, i === 4 ? 120 : NaN],
        'main'
      ),
      type: 'SIGNALS'
    });
    chart.indicators.add({ type: 'SIGNALS' });
    const after = scene(chart);

    expect(count(after, 'fillText', 'B')).toBe(10);
    expect(count(after, 'fillText', '金叉')).toBe(1);
    // One path of shapes, filled once.
    expect(count(after, 'fill') - count(before, 'fill')).toBe(1);
  });

  it('write their value, after their text, as the legend writes it', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots(
        [
          { key: 'top', label: 'Top', plot: { kind: 'marker', shape: 'circle', value: true } },
          { key: 'low', label: 'Low', plot: { kind: 'marker', text: 'L', value: true } }
        ],
        (i) => [i === 3 ? 101.5 : NaN, i === 7 ? 99.25 : NaN],
        'main'
      ),
      type: 'VALUES'
    });
    chart.indicators.add({ type: 'VALUES' });
    const after = scene(chart);

    expect(count(after, 'fillText', '101.50')).toBe(1);
    expect(count(after, 'fillText', 'L 99.25')).toBe(1);
  });

  it('need a shape, a text or the value', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'marker' } }], () => [1]),
      type: 'EMPTY'
    });
    expect(() => chart.indicators.add({ type: 'EMPTY' })).toThrow(/shape, a text or the value/);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'marker', value: 1 as never } }], () => [1]),
      type: 'NUMBERED'
    });
    expect(() => chart.indicators.add({ type: 'NUMBERED' })).toThrow(/value/);
  });
});

describe('outputs out of the legend', () => {
  it('leave the legend and the palette to the others', () => {
    const chart = chartWithBars(BARS, { locale: 'en-US' });
    const outputs: IndicatorOutput[] = [
      { key: 'base', label: 'Base', plot: { kind: 'hidden' }, legend: false },
      { key: 'line', label: 'Line', plot: { kind: 'line' } }
    ];
    chart.indicators.register({ ...plots(outputs, () => [1, 2]), type: 'PARTS' });
    chart.indicators.add({ type: 'PARTS' });
    const texts = legend(chart);

    // The one value in the legend goes without its label.
    expect(texts).toContain('2.00');
    expect(texts.some((text) => text.startsWith('Base') || text.startsWith('Line'))).toBe(false);

    const theme: Theme = { ...lightTheme, palette: ['#111111', '#222222'] };
    const colors = indicatorColors(
      { outputs, colors: {} } as unknown as Parameters<typeof indicatorColors>[0],
      theme
    );
    expect(colors.get('line')).toBe('#111111');
    expect(colors.has('base')).toBe(false);

    // Arrows and triangles take the buy and sell colors instead.
    const marked = indicatorColors(
      {
        outputs: [
          { key: 'buy', label: 'Buy', plot: { kind: 'marker', shape: 'arrow-up' } },
          { key: 'dot', label: 'Dot', plot: { kind: 'marker', shape: 'circle' } }
        ],
        colors: {}
      } as unknown as Parameters<typeof indicatorColors>[0],
      theme
    );
    expect([...marked]).toEqual([['dot', '#111111']]);
  });
});

describe('shifted outputs', () => {
  const outputs: IndicatorOutput[] = [
    { key: 'lead', label: 'Lead', plot: { kind: 'line' }, color: '#111111', offset: 3 },
    { key: 'lag', label: 'Lag', plot: { kind: 'line' }, color: '#222222', offset: -2 }
  ];

  it('are drawn on the bars they are shifted to, past the bars too', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({ ...plots(outputs, (i) => [i, i]), type: 'SHIFTED' });
    chart.indicators.add({ type: 'SHIFTED' });
    const lines = painted(chart, 'stroke');
    const xs = (color: string) =>
      lines.find((path) => path.color === color)?.shapes.flatMap((shape) => shape.map(([x]) => x));
    const at = (from: number, to: number) =>
      indices(from, to).map((index) => chart.timeScale.indexToX(index));

    // Bars 0 to 29, drawn on 3 to 32 (after the latest bar) and on -2 to 27 (before the first).
    expect(xs('#111111')).toEqual(at(3, 32));
    expect(xs('#222222')).toEqual(at(-2, 27));
  });

  it('fit the price scale to the values drawn in view', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'line' }, offset: 5 }], (i) => [
        i === 29 ? 1000 : 10
      ]),
      type: 'PEAK'
    });
    const pane = chart.indicators.get(chart.indicators.add({ type: 'PEAK' }))?.pane ?? '';
    const max = () => chart.priceScale(pane).range()?.max ?? Number.NaN;

    // The peak of the latest bar is drawn five bars after it, in the space on the right.
    expect(max()).toBeGreaterThanOrEqual(1000);

    chart.timeScale.scrollToIndex(30, 'right');
    expect(max()).toBeLessThan(1000);

    chart.timeScale.scrollToIndex(40, 'right');
    expect(max()).toBeGreaterThanOrEqual(1000);
  });

  it('show the value drawn on a bar in the legend, valuesAt() and barColor', () => {
    const chart = chartWithBars(BARS, { locale: 'en-US' });
    chart.indicators.register({ ...plots(outputs, (i) => [i, i]), type: 'SHIFTED' });
    const id = chart.indicators.add({ type: 'SHIFTED' });
    const texts = legend(chart);
    const values = (index: number) =>
      chart.indicators.valuesAt(id, index).map((item) => item.value);

    // The latest bar shows the lead computed three bars before; nothing lags onto it.
    expect(texts).toContain('Lead 26.00');
    expect(texts).toContain('Lag —');
    expect(values(29)).toEqual([26, null]);
    expect(values(32)).toEqual([29, null]);
    expect(values(33)).toEqual([null, null]);
    expect(values(-2)).toEqual([null, 0]);

    const seen = new Map<number, number>();
    chart.applyOptions({
      mainSeries: {
        barColor: ({ index, indicator }) => {
          seen.set(index, indicator(id, 'lead'));
          return null;
        }
      }
    });
    chart.screenshot();
    expect(seen.get(29)).toBe(26);
    expect(seen.get(2)).toBeNaN();
  });

  it('trigger alerts when the value drawn on the bar crosses', () => {
    const chart = createTestChart();
    const bar = (index: number, close: number) => ({
      time: T0 + index * MINUTE,
      open: close,
      high: close + 1,
      low: close - 1,
      close
    });
    chart.data.set(Array.from({ length: 10 }, (_, index) => bar(index, 100)));
    chart.indicators.register({
      type: 'LEAD',
      name: 'Lead',
      pane: 'main',
      precision: 2,
      params: {},
      outputs: () => [{ key: 'v', label: 'V', plot: { kind: 'line' }, offset: 2 }],
      lookback: () => 1,
      compute: (window) => [window.price(0)]
    });
    const id = chart.indicators.add({ type: 'LEAD' });
    const triggers = vi.fn();
    chart.on('alertTrigger', triggers);
    chart.alerts.add({
      id: 'a',
      source: { kind: 'indicator', id, key: 'v' },
      trigger: 'cross-up',
      value: 105
    });

    // The close of bar 9 is drawn on bar 11.
    chart.data.update(bar(9, 106));
    chart.data.update(bar(10, 106));
    expect(triggers).not.toHaveBeenCalled();

    chart.data.update(bar(11, 106));
    expect(triggers).toHaveBeenCalledWith(
      expect.objectContaining({ time: T0 + 11 * MINUTE, value: 106 })
    );
  });

  it('shift by whole bars', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'line' }, offset: 1.5 }], () => [1]),
      type: 'HALF'
    });
    expect(() => chart.indicators.add({ type: 'HALF' })).toThrow(/offset must be an integer/);
  });
});

describe('fills', () => {
  const outputs: IndicatorOutput[] = [
    { key: 'a', label: 'A', plot: { kind: 'line' }, color: '#111111' },
    { key: 'b', label: 'B', plot: { kind: 'line' }, color: '#222222' }
  ];
  // Shades by the higher output are stronger than a plain shade.
  const shadeA = withAlpha('#111111', 0.14);
  const shadeB = withAlpha('#222222', 0.14);
  const plainA = withAlpha('#111111', 0.08);

  /** Shades the area between `a`, rising, and `b` from bar 5, falling: they cross at 14.75. */
  function addAreas(chart: Chart, colorBy?: IndicatorFill['colorBy']): string {
    chart.indicators.register({
      ...plots(outputs, (i) => [i, i < 5 ? Number.NaN : 29.5 - i]),
      type: 'AREAS',
      fills: () => [{ from: 'a', to: 'b', ...(colorBy ? { colorBy } : {}) }]
    });
    return chart.indicators.add({ type: 'AREAS' });
  }

  const shades = (chart: Chart) =>
    painted(chart, 'fill').filter((path) => [shadeA, shadeB, plainA].includes(path.color));

  const xsOf = (path: PaintedPath | undefined) =>
    path?.shapes.flatMap((shape) => shape.map(([x]) => x)) ?? [];

  it('shade where both outputs are drawn, in the color of from', () => {
    const chart = chartWithBars(BARS);
    addAreas(chart);
    const fills = shades(chart);

    expect(fills.map((path) => path.color)).toEqual([plainA]);
    expect(Math.min(...xsOf(fills[0]))).toBe(chart.timeScale.indexToX(5));
    expect(Math.max(...xsOf(fills[0]))).toBe(chart.timeScale.indexToX(29));
  });

  it('take the color of the higher output, split exactly where the lines cross', () => {
    const chart = chartWithBars(BARS);
    addAreas(chart, 'higher');
    const [higherA, higherB] = shades(chart);
    const crossing = chart.timeScale.indexToX(14.75) ?? Number.NaN;

    // `a` is higher after the crossing and drawn above, so its shade comes first.
    expect(higherA?.color).toBe(shadeA);
    expect(higherB?.color).toBe(shadeB);
    expect(Math.min(...xsOf(higherA))).toBeCloseTo(crossing, 9);
    expect(Math.max(...xsOf(higherA))).toBe(chart.timeScale.indexToX(29));
    expect(Math.min(...xsOf(higherB))).toBe(chart.timeScale.indexToX(5));
    expect(Math.max(...xsOf(higherB))).toBeCloseTo(crossing, 9);

    // Both sides end at the same point, where the lines meet.
    const corner = (path: PaintedPath | undefined) =>
      path?.shapes.flat().find(([x]) => Math.abs(x - crossing) < 1e-9);
    expect(corner(higherA)).toBeDefined();
    expect(corner(higherA)?.[1]).toBeCloseTo(corner(higherB)?.[1] ?? Number.NaN, 9);
  });

  it('follow the values on an inverted scale', () => {
    const chart = chartWithBars(BARS);
    const id = addAreas(chart, 'higher');
    chart.priceScale(chart.indicators.get(id)?.pane ?? '').setInverted(true);
    const fills = shades(chart);
    const crossing = chart.timeScale.indexToX(14.75) ?? Number.NaN;
    const higherA = fills.find((path) => path.color === shadeA);

    // `a` is drawn below `b` after the crossing now, and still takes its own shade there.
    expect(fills.map((path) => path.color)).toEqual([shadeB, shadeA]);
    expect(Math.min(...xsOf(higherA))).toBeCloseTo(crossing, 9);
  });

  it('take the theme colors of shifted outputs, and follow the theme', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots(
        [
          { key: 'a', label: 'A', plot: { kind: 'line' }, themeColor: 'up', offset: 3 },
          { key: 'b', label: 'B', plot: { kind: 'line' }, themeColor: 'down', offset: 3 }
        ],
        (i) => [i, i < 5 ? Number.NaN : 29.5 - i]
      ),
      type: 'TONES',
      fills: () => [{ from: 'a', to: 'b', colorBy: 'higher' }]
    });
    chart.indicators.add({ type: 'TONES' });
    const shadesOf = (up: string, down: string) =>
      painted(chart, 'fill').filter((path) =>
        [withAlpha(up, 0.14), withAlpha(down, 0.14)].includes(path.color)
      );
    const [higherA, higherB] = shadesOf(lightTheme.up, lightTheme.down);
    // Three bars after 14.75, where the lines cross.
    const crossing = chart.timeScale.indexToX(17.75) ?? Number.NaN;

    expect(higherA?.color).toBe(withAlpha(lightTheme.up, 0.14));
    expect(higherB?.color).toBe(withAlpha(lightTheme.down, 0.14));
    expect(Math.min(...xsOf(higherA))).toBeCloseTo(crossing, 9);
    expect(Math.max(...xsOf(higherA))).toBe(chart.timeScale.indexToX(32));
    expect(Math.min(...xsOf(higherB))).toBe(chart.timeScale.indexToX(8));

    chart.applyOptions({ theme: { up: '#e5484d', down: '#14a37f' } });
    expect(shadesOf('#e5484d', '#14a37f').map((path) => path.color)).toEqual([
      withAlpha('#e5484d', 0.14),
      withAlpha('#14a37f', 0.14)
    ]);
  });

  it('are colored by "from" or "higher"', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots(outputs, () => [1, 2]),
      type: 'BAD',
      fills: () => [{ from: 'a', to: 'b', colorBy: 'lower' as 'higher' }]
    });
    expect(() => chart.indicators.add({ type: 'BAD' })).toThrow(
      /colorBy must be one of "from", "higher"/
    );
  });
});

describe('segments', () => {
  it('draw a line through each run of equal values, edge to edge of its bars', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots(
        [{ key: 'v', label: 'V', plot: { kind: 'segments' }, color: '#123456' }],
        // Bars 0 to 9 at 10, none on 10 to 14, 15 to 29 at 20.
        (i) => [i < 10 ? 10 : i < 15 ? NaN : 20]
      ),
      type: 'LEVELS'
    });
    chart.indicators.add({ type: 'LEVELS' });
    const shapes = painted(chart, 'stroke').find((path) => path.color === '#123456')?.shapes;
    const half = chart.timeScale.barSpacing() / 2;
    const x = (index: number) => chart.timeScale.indexToX(index) ?? Number.NaN;

    expect(shapes?.map((shape) => shape.map(([left]) => left))).toEqual([
      [x(0) - half, x(9) + half],
      [x(15) - half, x(29) + half]
    ]);
    // Horizontal lines.
    expect(shapes?.every(([start, end]) => start?.[1] === end?.[1])).toBe(true);
  });

  it('shade a fill between two of them bar by bar', () => {
    const chart = chartWithBars(BARS);
    const before = count(scene(chart), 'rect');
    chart.indicators.register({
      ...plots(
        [
          { key: 'top', label: 'Top', plot: { kind: 'segments' } },
          { key: 'bottom', label: 'Bottom', plot: { kind: 'segments' } }
        ],
        (i) => (third(i) ? [20 + i, 10] : [NaN, NaN])
      ),
      type: 'STEPS',
      fills: () => [{ from: 'top', to: 'bottom' }]
    });
    chart.indicators.add({ type: 'STEPS' });

    // One slot per bar with both values, and the clip of the new pane.
    expect(count(scene(chart), 'rect') - before).toBe(11);
  });
});

describe('boxes', () => {
  const outputs: IndicatorOutput[] = [
    { key: 'high', label: 'High', plot: { kind: 'box', from: 'low' }, color: '#123456' },
    { key: 'low', label: 'Low', plot: { kind: 'hidden' } }
  ];

  it('cover each run from its lowest to its highest value, past the view too', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots(
        outputs,
        // Runs 0 to 9 and 20 to 29, highs and lows so far.
        (i) => (i < 10 ? [100 + i, 100 - i] : i < 20 ? [NaN, NaN] : [200 + i, 190 - i])
      ),
      type: 'BOXES'
    });
    const id = chart.indicators.add({ type: 'BOXES' });
    const pane = chart.indicators.get(id)?.pane ?? '';
    /** The rectangles of the path filled in the boxes' shade. */
    const rects = () => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
      const ctx = canvas?.getContext('2d');
      const calls = canvas ? canvasCalls(canvas) : [];

      if (ctx) {
        ctx.fill = function (this: CanvasRenderingContext2D) {
          calls.push({ name: 'fill', args: [this.fillStyle] });
        };
      }

      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      let path: number[][] = [];

      for (const { name, args } of calls) {
        if (name === 'beginPath') {
          path = [];
        } else if (name === 'rect') {
          path.push(args.map(Number));
        } else if (name === 'fill' && args[0] === withAlpha('#123456', 0.1)) {
          return path;
        }
      }

      return [];
    };
    const scale = chart.priceScale(pane);
    const boxes = rects();
    const half = chart.timeScale.barSpacing() / 2;

    // Snapped to half pixels, so their outlines are crisp.
    [0, 20].forEach((index, box) => {
      const start = (chart.timeScale.indexToX(index) ?? Number.NaN) - half;
      expect(Math.abs((boxes[box]?.[0] ?? 0) - start)).toBeLessThanOrEqual(1);
    });
    expect(boxes.map(([, , width]) => width)).toEqual([10, 10].map((bars) => bars * half * 2));
    // The first box reaches from the lowest low, 91, to the highest high, 109.
    const y = (price: number) => scale.priceToY(price) ?? Number.NaN;
    expect(Math.abs((boxes[0]?.[3] ?? 0) - (y(91) - y(109)))).toBeLessThanOrEqual(1);
    expect(scale.range()?.max).toBeGreaterThanOrEqual(229);

    // Scrolled so that only the end of the second run is in view, its box still holds all of it.
    chart.timeScale.setVisibleLogicalRange({ from: 27, to: 29 });
    const [last] = rects();
    const start = (chart.timeScale.indexToX(20) ?? Number.NaN) - chart.timeScale.barSpacing() / 2;
    expect(Math.abs((last?.[0] ?? 0) - start)).toBeLessThanOrEqual(1);
  });

  it('give the box color to the output they reach down to', () => {
    const colors = indicatorColors(
      {
        outputs: [
          { key: 'high', label: 'High', plot: { kind: 'box', from: 'low' } },
          { key: 'low', label: 'Low', plot: { kind: 'hidden' } },
          { key: 'line', label: 'Line', plot: { kind: 'line' } }
        ],
        colors: {}
      } as unknown as Parameters<typeof indicatorColors>[0],
      { ...lightTheme, palette: ['#111111', '#222222'] }
    );
    expect([...colors]).toEqual([
      ['high', '#111111'],
      ['line', '#222222'],
      ['low', '#111111']
    ]);
  });

  it('must reach down to an output', () => {
    const chart = chartWithBars(BARS);
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'box', from: 'nope' } }], () => [1]),
      type: 'BAD_BOX'
    });
    expect(() => chart.indicators.add({ type: 'BAD_BOX' })).toThrow(/reach down to "nope"/);
  });
});

describe('output precision', () => {
  it('formats an output in its own decimals', () => {
    const chart = chartWithBars(BARS, { locale: 'en-US' });
    chart.indicators.register({
      ...plots(
        [
          { key: 'price', label: 'Price', plot: { kind: 'line' } },
          { key: 'share', label: 'Share', plot: { kind: 'hidden' }, precision: 1 }
        ],
        () => [123.456, 45.678]
      ),
      type: 'MIXED'
    });
    const id = chart.indicators.add({ type: 'MIXED' });

    expect(chart.indicators.valuesAt(id).map((value) => value.text)).toEqual(['123.46', '45.7']);
    expect(legend(chart)).toEqual(expect.arrayContaining(['Price 123.46', 'Share 45.7']));
    chart.indicators.register({
      ...plots([{ key: 'v', label: 'V', plot: { kind: 'line' }, precision: 1.5 }], () => [1]),
      type: 'BAD_PRECISION'
    });
    expect(() => chart.indicators.add({ type: 'BAD_PRECISION' })).toThrow(
      'output "v" of "BAD_PRECISION": precision must be an integer, received 1.5.'
    );
  });
});

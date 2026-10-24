import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import { trendLine } from '../../src/drawings/tools/lines';
import { drawings } from '../../src/drawings/module';
import { regression } from '../../src/drawings/tools/regression';
import type { DrawingInput, DrawingStyle } from '../../src/drawings/types';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, createModularChart, drag, key, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** The drawing types added with these tools, and their anchors. */
const TOOLS: Readonly<Record<string, number>> = {
  'cross-line': 1,
  'trend-angle': 2,
  'regression-trend': 2,
  'fib-channel': 3,
  'fib-time-zone': 2,
  'fib-speed-fan': 2,
  'gann-box': 2,
  circle: 2,
  ellipse: 3,
  triangle: 3,
  'price-label': 1,
  'flag-mark': 1,
  'xabcd-pattern': 5,
  'head-and-shoulders': 7,
  'elliott-impulse': 6,
  'elliott-correction': 4,
  'anchored-vwap': 1
};

function chartWithTools(): Chart {
  return chartWithBars(200, { timeScale: { barSpacing: 12 } });
}

/** Chart coordinates of bar `index` at `price`. */
function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

const point = (index: number, price: number) => ({ time: T0 + index * MINUTE, price });

function storeOf(bars: ReturnType<typeof createBars>): BarStore {
  const store = new BarStore();
  store.set(bars);
  return store;
}

/** Texts painted on the objects layer. */
function objectTexts(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

/** Whether clicking at bar `index` and `price` selects the drawing `id`. */
function selects(chart: Chart, id: string, index: number, price: number): boolean {
  chart.select(null);
  click(chart, ...at(chart, index, price));
  const selection = chart.selection();
  return selection?.kind === 'drawing' && selection.id === id;
}

describe('the drawing tools beyond the classic ones', () => {
  it('come with the drawing types given to the drawings module', () => {
    const chart = createModularChart({ modules: [drawings([trendLine])] });

    for (const type of [...Object.keys(TOOLS), 'brush']) {
      expect(() => {
        chart.drawings.startTool(type);
      }).toThrow(/Give it to the drawings module/);
    }

    expect(chartWithTools().drawings.types()).toEqual(
      expect.arrayContaining([...Object.keys(TOOLS), 'brush'])
    );
  });

  it('are placed with a click for each anchor', () => {
    for (const [type, anchors] of Object.entries(TOOLS)) {
      const chart = chartWithTools();
      chart.drawings.startTool(type);

      for (let index = 0; index < anchors; index += 1) {
        click(chart, ...at(chart, 150 + index * 6, 180 + (index % 2) * 10 + index));
      }

      const drawings = chart.drawings.list();
      expect(
        drawings.map((drawing) => drawing.type),
        type
      ).toEqual([type]);
      expect(drawings[0]?.points, type).toHaveLength(anchors);
      expect(chart.drawings.activeTool(), type).toBeNull();
    }
  });

  it('offer the style fields their settings show', () => {
    const chart = chartWithTools();

    expect(chart.drawings.fields('regression-trend')).toEqual([
      'color',
      'lineWidth',
      'lineStyle',
      'levels',
      'fill',
      'extendRight',
      'source'
    ]);
    expect(chart.drawings.fields('gann-box')).toContain('timeLevels');
    expect(chart.drawings.fields('fib-speed-fan')).toContain('timeLevels');
    expect(chart.drawings.fields('anchored-vwap')).toContain('source');
    expect(chart.drawings.fields('elliott-impulse')).toContain('degree');
    expect(chart.drawings.fields('circle')).toContain('text');
    expect(chart.drawings.fields('flag-mark')).toEqual(['color']);
    // The bands of a VWAP in the up color, apart from its line.
    const { up } = chart.options().theme;
    expect(chart.drawings.defaultStyle('anchored-vwap')).toMatchObject({
      source: 'hlc3',
      levels: [
        { value: 1, color: up },
        { value: 2, color: up, visible: false },
        { value: 3, color: up, visible: false }
      ]
    });
    expect(chart.drawings.defaultStyle('regression-trend')).toMatchObject({
      source: 'close',
      levels: [{ value: 2 }, { value: 0 }, { value: -2 }]
    });
    expect(chart.drawings.defaultStyle('fib-time-zone').levels.map((level) => level.value)).toEqual(
      [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
    );
    expect(chart.drawings.defaultStyle('elliott-impulse').degree).toBe('intermediate');
  });

  it('check the new style fields', () => {
    const chart = chartWithTools();
    const add = (style: Partial<DrawingStyle>) =>
      chart.drawings.add({ type: 'gann-box', points: [point(120, 180), point(150, 200)], style });

    expect(() => add({ source: 'typical' as 'close' })).toThrow(/style.source must be one of/);
    expect(() => add({ degree: 'huge' as 'minor' })).toThrow(/style.degree must be one of/);
    expect(() => add({ timeLevels: [{ value: 'x' as unknown as number }] })).toThrow(
      /style.timeLevels\[0\].value/
    );
    expect(() =>
      add({ timeLevels: [{ value: 0.5, color: '#ff0000' }], degree: 'minor' })
    ).not.toThrow();
  });
});

describe('brush', () => {
  it('draws while the button is held and finishes when it is let go', () => {
    const chart = chartWithTools();
    chart.drawings.startTool('brush');
    drag(chart, at(chart, 150, 180), at(chart, 185, 210), 20);

    const [stroke] = chart.drawings.list();
    expect(stroke?.type).toBe('brush');
    expect(stroke?.points.length).toBeGreaterThan(10);
    // Anchors follow the pointer between bars, without the magnet.
    expect(stroke?.points.some((each) => (each.time - T0) % MINUTE !== 0)).toBe(true);
    expect(chart.drawings.activeTool()).toBeNull();
    expect(chart.selection()).toEqual({ kind: 'drawing', id: stroke?.id });
  });

  it('ends with Escape while the button is held, and draws nothing once it is let go', () => {
    const chart = chartWithTools();
    const ends: unknown[] = [];
    chart.on('toolEnd', (event) => ends.push(event));
    chart.drawings.startTool('brush');
    pointer(chart, 'pointerdown', ...at(chart, 150, 180));
    pointer(chart, 'pointermove', ...at(chart, 160, 190));
    key(chart, 'Escape');
    pointer(chart, 'pointerup', ...at(chart, 165, 195));
    pointer(chart, 'pointermove', ...at(chart, 180, 200));

    expect(chart.drawings.activeTool()).toBeNull();
    expect(chart.drawings.list()).toEqual([]);
    expect(ends).toEqual([{ type: 'brush', completed: false }]);
  });

  it('drops a stroke whose press is lost, and keeps the tool for the next one', () => {
    const chart = chartWithTools();
    chart.drawings.startTool('brush');
    pointer(chart, 'pointerdown', ...at(chart, 150, 180));
    pointer(chart, 'pointermove', ...at(chart, 160, 190));
    window.dispatchEvent(new Event('blur'));
    pointer(chart, 'pointermove', ...at(chart, 180, 200));
    pointer(chart, 'pointerup', ...at(chart, 185, 205));

    expect(chart.drawings.list()).toEqual([]);
    expect(chart.drawings.activeTool()).toBe('brush');
    drag(chart, at(chart, 150, 180), at(chart, 165, 190));
    expect(chart.drawings.list()).toHaveLength(1);
  });

  it('places nothing on a click, and keeps drawing strokes with a continuous tool', () => {
    const chart = chartWithTools();
    chart.drawings.startTool('brush', { continuous: true });
    click(chart, ...at(chart, 150, 180));

    expect(chart.drawings.list()).toHaveLength(0);

    drag(chart, at(chart, 150, 180), at(chart, 165, 190));
    drag(chart, at(chart, 170, 180), at(chart, 185, 170));
    expect(chart.drawings.list()).toHaveLength(2);
    expect(chart.drawings.activeTool()).toBe('brush');
  });

  it('is moved as a whole: it has no handles', () => {
    const chart = chartWithTools();
    chart.drawings.startTool('brush');
    drag(chart, at(chart, 150, 180), at(chart, 180, 210), 10);
    const [stroke] = chart.drawings.list();
    const before = stroke?.points ?? [];
    drag(chart, at(chart, 150, 180), at(chart, 160, 180), 4);
    const after = chart.drawings.get(stroke?.id ?? '')?.points ?? [];

    expect(after).toHaveLength(before.length);
    expect((after[0]?.time ?? 0) - (before[0]?.time ?? 0)).toBe(10 * MINUTE);
    expect(chart.drawings.bounds(stroke?.id ?? '')?.width).toBeGreaterThan(0);
  });
});

describe('editing and hit testing', () => {
  it('moves the ends of a regression trend in time only, on its base line', () => {
    const chart = chartWithTools();
    const id = chart.drawings.add({
      type: 'regression-trend',
      points: [point(150, 1), point(180, 2)]
    });
    chart.select({ kind: 'drawing', id });

    expect(chart.drawings.levels(id)).toEqual(['2', '-2', '0']);

    // The second end sits on the base line at bar 180, whatever the anchor's price.
    const fit = regression(
      storeOf(createBars(200)),
      point(150, 0).time,
      point(180, 0).time,
      'close'
    );
    const [x, y] = at(chart, 180, (fit?.start ?? 0) + (fit?.slope ?? 0) * 30);
    drag(chart, [x, y], [x + 60, y + 80]);
    const [, end] = chart.drawings.get(id)?.points ?? [];

    expect(end).toEqual({ time: T0 + 185 * MINUTE, price: 2 });
  });

  it('selects each tool where it is drawn', () => {
    const chart = chartWithTools();
    const add = (type: string, points: DrawingInput['points']) =>
      chart.drawings.add({ type, points });

    const cross = add('cross-line', [point(150, 190)]);
    expect(selects(chart, cross, 165, 190)).toBe(true);
    expect(selects(chart, cross, 150, 200)).toBe(true);
    chart.drawings.remove(cross);

    const circle = add('circle', [point(150, 190), point(160, 190)]);
    expect(selects(chart, circle, 152, 190)).toBe(true);
    chart.drawings.remove(circle);

    const triangle = add('triangle', [point(145, 180), point(165, 180), point(155, 210)]);
    expect(selects(chart, triangle, 155, 190)).toBe(true);
    expect(selects(chart, triangle, 146, 208)).toBe(false);
    chart.drawings.remove(triangle);

    const flag = add('flag-mark', [point(150, 180)]);
    const [fx, fy] = at(chart, 150, 180);
    chart.select(null);
    click(chart, fx + 6, fy - 16);
    expect(chart.selection()).toEqual({ kind: 'drawing', id: flag });
    chart.drawings.remove(flag);

    const zones = add('fib-time-zone', [point(150, 180), point(153, 190)]);
    expect(selects(chart, zones, 159, 195)).toBe(true);
    expect(selects(chart, zones, 158, 195)).toBe(false);
  });

  it('labels the waves, the patterns and the price label', () => {
    const chart = chartWithTools();
    chart.applyOptions({ locale: 'zh-CN' });
    chart.drawings.add({
      type: 'elliott-impulse',
      points: [180, 195, 188, 200, 192, 204].map((price, index) => point(150 + index * 5, price))
    });
    chart.drawings.add({
      type: 'elliott-correction',
      points: [204, 190, 197, 185].map((price, index) => point(170 + index * 5, price)),
      style: { degree: 'minor' }
    });
    chart.drawings.add({
      type: 'head-and-shoulders',
      points: [180, 192, 186, 198, 187, 193, 181].map((price, index) =>
        point(150 + index * 6, price)
      )
    });
    chart.drawings.add({ type: 'price-label', points: [point(150, 192.5)] });
    const texts = objectTexts(chart);

    expect(texts).toEqual(
      expect.arrayContaining([
        '(1)',
        '(2)',
        '(3)',
        '(4)',
        '(5)',
        'A',
        'B',
        'C',
        '左肩',
        '头部',
        '右肩',
        '192.50'
      ])
    );
  });
});

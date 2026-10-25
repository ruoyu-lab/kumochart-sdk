import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { DrawingInput } from '../../src/drawings/types';
import { gannAngleText } from '../../src/drawings/tools/gann';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, drag } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** The drawing types added with these tools, and their anchors. */
const TOOLS: Readonly<Record<string, number>> = {
  'info-line': 2,
  'schiff-pitchfork': 3,
  'modified-schiff-pitchfork': 3,
  'gann-fan': 2,
  'abcd-pattern': 4,
  'elliott-triangle': 6,
  'elliott-double-combo': 4,
  'elliott-triple-combo': 6,
  'cyclic-lines': 2,
  'rotated-rectangle': 3,
  'arrow-mark-up': 1,
  'arrow-mark-down': 1
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

/** Texts painted on the objects layer. */
function objectTexts(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

/** Whether clicking at `x`, `y` selects the drawing `id`. */
function selectsAt(chart: Chart, id: string, x: number, y: number): boolean {
  chart.select(null);
  click(chart, x, y);
  const selection = chart.selection();
  return selection?.kind === 'drawing' && selection.id === id;
}

/** Whether clicking at bar `index` and `price` selects the drawing `id`. */
function selects(chart: Chart, id: string, index: number, price: number): boolean {
  return selectsAt(chart, id, ...at(chart, index, price));
}

function add(chart: Chart, type: string, points: DrawingInput['points']): string {
  return chart.drawings.add({ type, points });
}

describe('the practical drawing tools', () => {
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

    expect(chart.drawings.fields('info-line')).toEqual([
      'color',
      'lineWidth',
      'lineStyle',
      'extendLeft',
      'extendRight',
      'fontSize'
    ]);
    expect(chart.drawings.fields('gann-fan')).toContain('levels');
    expect(chart.drawings.fields('highlighter')).toEqual(['color', 'lineWidth']);
    expect(chart.drawings.fields('arrow-mark-up')).toContain('text');
    expect(chart.drawings.fields('cyclic-lines')).toEqual(['color', 'lineWidth', 'lineStyle']);
    expect(chart.drawings.defaultStyle('gann-fan').levels.map((level) => level.value)).toEqual([
      8,
      4,
      3,
      2,
      1,
      1 / 2,
      1 / 3,
      1 / 4,
      1 / 8
    ]);
    // A highlighter is a wide, see-through stroke; the arrows take the colors of up and down.
    expect(chart.drawings.defaultStyle('highlighter').lineWidth).toBe(12);
    const { up, down } = chart.options().theme;
    expect(chart.drawings.defaultStyle('arrow-mark-up').color).toBe(up);
    expect(chart.drawings.defaultStyle('arrow-mark-down').color).toBe(down);
  });
});

describe('info line', () => {
  it('shows the change, the bars, the time and the angle between its anchors', () => {
    const chart = chartWithTools();
    add(chart, 'info-line', [point(150, 180), point(160, 189)]);
    const texts = objectTexts(chart);

    expect(texts).toContain('+9.00 (+5.00%)');
    expect(texts).toContain('10 bars · 10m');
    expect(texts.some((text) => /^-?\d+\.\d\d°$/.test(text))).toBe(true);
  });

  it('is selected on its line and on its box, and alerts watch its line', () => {
    const chart = chartWithTools();
    const id = add(chart, 'info-line', [point(150, 180), point(160, 190)]);

    expect(selects(chart, id, 155, 185)).toBe(true);
    // The box lies past the second anchor, away from the first.
    const [x, y] = at(chart, 160, 190);
    expect(selectsAt(chart, id, x + 30, y - 20)).toBe(true);
    expect(chart.drawings.levels(id)).toEqual(['line']);
  });
});

describe('pitchforks', () => {
  it('start the median line of a Schiff pitchfork halfway up the handle', () => {
    const points = [point(155, 170), point(175, 200), point(175, 180)];
    // Whether a click at bar `index` and `price` hits a fork of `type` on the anchors.
    const hits = (type: string, index: number, price: number) => {
      const chart = chartWithTools();
      return selects(chart, add(chart, type, points), index, price);
    };

    // Andrews' starts at the pivot, Schiff's above it, halfway to the first anchor in value,
    // and the modified one halfway to it in time as well.
    expect(hits('pitchfork', 165, 180)).toBe(true);
    expect(hits('pitchfork', 155, 185)).toBe(false);
    expect(hits('schiff-pitchfork', 155, 185)).toBe(true);
    expect(hits('modified-schiff-pitchfork', 155, 185)).toBe(false);
    expect(hits('modified-schiff-pitchfork', 165, 185)).toBe(true);
  });
});

describe('Gann fan', () => {
  it('labels its angles as Gann wrote them, and alerts watch each', () => {
    const chart = chartWithTools();
    const id = add(chart, 'gann-fan', [point(150, 180), point(160, 190)]);
    const keys = ['8×1', '4×1', '3×1', '2×1', '1×1', '1×2', '1×3', '1×4', '1×8'];

    expect(objectTexts(chart)).toEqual(expect.arrayContaining(keys));
    expect(chart.drawings.levels(id)).toEqual(keys);
    expect(gannAngleText(0.333)).toBe('1×3');
    expect(gannAngleText(1.5)).toBe('1.5×1');
  });

  it('runs the 1×1 through the second anchor, the 2×1 twice as steep', () => {
    const chart = chartWithTools();
    const id = add(chart, 'gann-fan', [point(150, 180), point(160, 190)]);
    chart.drawings.update(id, { style: { fill: false } });

    expect(selects(chart, id, 170, 200)).toBe(true);
    expect(selects(chart, id, 155, 190)).toBe(true);
    expect(selects(chart, id, 160, 200)).toBe(true);
    // Between the 2×1 and the 1×1, unfilled.
    expect(selects(chart, id, 160, 195)).toBe(false);
  });
});

describe('cyclic lines', () => {
  it('repeat the span between the anchors on to the right edge', () => {
    const chart = chartWithTools();
    const id = add(chart, 'cyclic-lines', [point(150, 180), point(155, 190)]);

    for (const bar of [150, 155, 160, 165, 185]) {
      expect(selects(chart, id, bar, 170), String(bar)).toBe(true);
    }

    expect(selects(chart, id, 145, 170)).toBe(false);
    expect(selects(chart, id, 162, 170)).toBe(false);
  });
});

describe('rotated rectangle', () => {
  it('is as wide as its third anchor is from its first side', () => {
    const chart = chartWithTools();
    const id = add(chart, 'rotated-rectangle', [point(150, 180), point(170, 190), point(150, 186)]);

    expect(selects(chart, id, 160, 187)).toBe(true);
    expect(selects(chart, id, 152, 194)).toBe(false);
    chart.drawings.update(id, { style: { fill: false } });
    expect(selects(chart, id, 160, 187)).toBe(false);
  });
});

describe('patterns and waves', () => {
  it('label the points of an ABCD, a triangle and the combinations', () => {
    const chart = chartWithTools();
    add(
      chart,
      'abcd-pattern',
      [180, 196, 186, 202].map((price, index) => point(140 + index * 5, price))
    );
    chart.drawings.add({
      type: 'elliott-triangle',
      points: [204, 190, 200, 192, 198, 194].map((price, index) => point(160 + index * 5, price)),
      style: { degree: 'minor' }
    });
    chart.drawings.add({
      type: 'elliott-double-combo',
      points: [204, 190, 197, 185].map((price, index) => point(150 + index * 5, price)),
      style: { degree: 'minor' }
    });
    chart.drawings.add({
      type: 'elliott-triple-combo',
      points: [204, 190, 197, 185, 192, 180].map((price, index) => point(150 + index * 5, price))
    });
    const texts = objectTexts(chart);

    // BC retraces 10 of AB's 16, CD extends 16 of BC's 10.
    expect(texts).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', '0.625', '1.6']));
    expect(texts).toEqual(expect.arrayContaining(['E', 'W', 'X', 'Y']));
    expect(texts).toEqual(expect.arrayContaining(['(W)', '(X)', '(Y)', '(Z)']));
  });
});

describe('marks', () => {
  it('point an arrow up under the anchor and down above it, with their text', () => {
    const chart = chartWithTools();
    const up = chart.drawings.add({
      type: 'arrow-mark-up',
      points: [point(150, 180)],
      text: 'Buy'
    });
    const down = add(chart, 'arrow-mark-down', [point(170, 200)]);
    const [ux, uy] = at(chart, 150, 180);
    const [dx, dy] = at(chart, 170, 200);

    expect(objectTexts(chart)).toContain('Buy');
    expect(selectsAt(chart, up, ux, uy + 10)).toBe(true);
    expect(selectsAt(chart, up, ux, uy - 12)).toBe(false);
    expect(selectsAt(chart, down, dx, dy - 10)).toBe(true);
    expect(selectsAt(chart, down, dx, dy + 12)).toBe(false);
  });
});

describe('highlighter', () => {
  it('draws a wide stroke while the button is held, moved as a whole', () => {
    const chart = chartWithTools();
    chart.drawings.startTool('highlighter');
    drag(chart, at(chart, 150, 180), at(chart, 185, 210), 20);

    const [stroke] = chart.drawings.list();
    expect(stroke?.type).toBe('highlighter');
    expect(stroke?.points.length).toBeGreaterThan(10);
    expect(chart.drawings.activeTool()).toBeNull();

    // Hit across its width, not just on its middle.
    const [x, y] = at(chart, 150, 180);
    expect(selectsAt(chart, stroke?.id ?? '', x, y + 6)).toBe(true);
  });
});

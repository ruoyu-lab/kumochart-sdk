import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import { constrainAngle } from '../../src/drawings/anchoring';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, drag, key, nextFrame, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** Chart coordinates of bar `index` at `price`, in the main pane or another. */
function at(chart: Chart, index: number, price: number, pane = 'main'): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale(pane).priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

function trendLine(chart: Chart, from: [number, number], to: [number, number]): string {
  return chart.drawings.add({
    type: 'trend-line',
    points: [
      { time: T0 + from[0] * MINUTE, price: from[1] },
      { time: T0 + to[0] * MINUTE, price: to[1] }
    ]
  });
}

/** The errors the chart's handlers of the DOM events `run` dispatches threw. */
function errorsOf(run: () => void): unknown[] {
  const errors: unknown[] = [];
  const listener = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', listener);

  try {
    run();
  } finally {
    window.removeEventListener('error', listener);
  }

  return errors;
}

function keyUp(chart: Chart, keyName: string, init: KeyboardEventInit = {}): void {
  chart.element.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, bubbles: true, ...init }));
}

describe('anchoring', () => {
  it('constrains a direction to the nearest multiple of 45 degrees', () => {
    expect(constrainAngle({ x: 0, y: 0 }, { x: 100, y: 12 })).toEqual({ x: 100, y: 0 });
    expect(constrainAngle({ x: 0, y: 0 }, { x: -8, y: 90 })).toEqual({ x: 0, y: 90 });
    const diagonal = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(diagonal.x).toBeCloseTo(95);
    expect(diagonal.y).toBeCloseTo(95);
  });

  it('places a horizontal line with Shift held', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 170));
    const [x, y] = at(chart, 180, 178);
    pointer(chart, 'pointerdown', x, y, { shiftKey: true });
    pointer(chart, 'pointerup', x, y, { shiftKey: true });

    const [first, second] = chart.drawings.list()[0]?.points ?? [];
    expect(second?.price).toBeCloseTo(first?.price ?? Number.NaN, 6);
  });

  it('snaps to OHLC with the strong magnet, near it with the weak one, and inverts with Ctrl', () => {
    const chart = chartWithBars(200);
    const bar = chart.data.at(150);

    if (!bar) {
      throw new Error('No bar.');
    }

    const place = (price: number, init: PointerEventInit = {}) => {
      chart.drawings.startTool('horizontal-line');
      const [x, y] = at(chart, 150, price);
      pointer(chart, 'pointerdown', x, y, init);
      pointer(chart, 'pointerup', x, y, init);
      return chart.drawings.list().at(-1)?.points[0]?.price;
    };
    const near = bar.high + 0.05;
    const far = bar.high + 3;

    expect(place(near)).not.toBe(bar.high);

    chart.applyOptions({ drawings: { magnet: 'weak' } });
    expect(place(near)).toBe(bar.high);
    expect(place(far)).not.toBe(bar.high);
    expect(place(near, { ctrlKey: true })).not.toBe(bar.high);

    chart.applyOptions({ drawings: { magnet: 'strong' } });
    expect(place(far)).toBe(bar.high);

    chart.applyOptions({ drawings: { magnet: 'off' } });
    expect(place(far, { metaKey: true })).toBe(bar.high);
  });

  it('rejects unknown magnet modes', () => {
    const chart = chartWithBars(20);
    expect(() => {
      chart.applyOptions({ drawings: { magnet: true as never } });
    }).toThrow('options.drawings.magnet');
  });
});

describe('handles', () => {
  it('can be grabbed on a hovered drawing, not only a selected one', async () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const id = trendLine(chart, [150, 170], [180, 185]);
    const [x, y] = at(chart, 165, 177.5);
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    await nextFrame();
    const [ax, ay] = at(chart, 150, 170);
    pointer(chart, 'pointermove', ax, ay, { buttons: 0 });
    await nextFrame();

    expect(chart.element.style.cursor).toBe('move');

    drag(chart, [ax, ay], at(chart, 140, 160));
    const points = chart.drawings.get(id)?.points;
    expect(points?.[0]?.time).toBe(T0 + 140 * MINUTE);
    expect(points?.[1]).toEqual({ time: T0 + 180 * MINUTE, price: 185 });
  });

  it('are grabbed only in the pane of their drawing', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const rsi = chart.indicators.get(chart.indicators.add({ type: 'RSI' }))?.pane ?? '';
    // The second anchor's value lies below the main pane, where the RSI pane is.
    const [x, y] = at(chart, 180, 50, rsi);
    const id = chart.drawings.add({
      type: 'trend-line',
      points: [
        { time: T0 + 150 * MINUTE, price: 170 },
        { time: T0 + 180 * MINUTE, price: chart.priceScale().yToPrice(y) ?? 0 }
      ]
    });
    chart.select({ kind: 'drawing', id });
    const before = chart.drawings.get(id)?.points;
    drag(chart, [x, y], [x - 60, y + 20]);

    expect(chart.drawings.get(id)?.points).toEqual(before);
  });

  it('moves one edge of a rectangle with its edge handle', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const id = chart.drawings.add({
      type: 'rectangle',
      points: [
        { time: T0 + 150 * MINUTE, price: 170 },
        { time: T0 + 180 * MINUTE, price: 185 }
      ]
    });
    chart.select({ kind: 'drawing', id });
    const [x] = at(chart, 165, 0);
    const [, y] = at(chart, 0, 185);
    drag(chart, [x, y], [x + 40, y - 30]);

    const [first, second] = chart.drawings.get(id)?.points ?? [];
    expect(first).toEqual({ time: T0 + 150 * MINUTE, price: 170 });
    expect(second?.time).toBe(T0 + 180 * MINUTE);
    expect(second?.price).toBeGreaterThan(185);
  });

  it('constrains a dragged anchor with Shift, also when Shift is pressed mid-drag', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.select({ kind: 'drawing', id });
    const [ax, ay] = at(chart, 180, 185);
    const [tx, ty] = at(chart, 190, 172);
    pointer(chart, 'pointerdown', ax, ay);
    pointer(chart, 'pointermove', tx, ty);
    key(chart, 'Shift', { shiftKey: true });

    const [first, second] = chart.drawings.get(id)?.points ?? [];
    expect(second?.price).toBeCloseTo(first?.price ?? Number.NaN, 6);

    keyUp(chart, 'Shift');
    expect(chart.drawings.get(id)?.points[1]?.price).not.toBeCloseTo(170, 1);
    pointer(chart, 'pointerup', tx, ty);
  });

  it('restores the drawing when a handle drag is cancelled with Escape', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.select({ kind: 'drawing', id });
    const before = chart.drawings.get(id)?.points;
    const [ax, ay] = at(chart, 150, 170);
    pointer(chart, 'pointerdown', ax, ay);
    pointer(chart, 'pointermove', ax + 50, ay + 20);
    key(chart, 'Escape');
    pointer(chart, 'pointerup', ax + 50, ay + 20);

    expect(chart.drawings.get(id)?.points).toEqual(before);
  });
});

describe('a drag the API changes the drawings under', () => {
  /** A horizontal line `id` at `price` on bar 150. */
  const level = (id: string, price: number) => ({
    id,
    type: 'horizontal-line',
    points: [{ time: T0 + 150 * MINUTE, price }]
  });

  /** Starts dragging the line at 170 up, and runs `change` halfway. */
  function dragging(chart: Chart, change: () => void): [number, number] {
    const [x, y] = at(chart, 150, 170);
    pointer(chart, 'pointerdown', x, y);
    pointer(chart, 'pointermove', x, y - 30);
    change();
    pointer(chart, 'pointermove', x, y - 40);
    return [x, y - 40];
  }

  it('keeps what the API changed when the drag is cancelled', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(level('line', 170));
    chart.drawings.add(level('other', 150));
    dragging(chart, () => {
      chart.drawings.update('other', { style: { color: '#e5484d' } });
    });
    key(chart, 'Escape');

    expect(chart.drawings.get('other')?.style.color).toBe('#e5484d');
    expect(chart.drawings.get('line')?.points[0]?.price).toBe(170);
  });

  it('undoes only the drag in its step', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(level('line', 170));
    chart.drawings.add(level('other', 150));
    const end = dragging(chart, () => {
      chart.drawings.update('other', { style: { color: '#e5484d' } });
    });
    pointer(chart, 'pointerup', ...end);
    chart.drawings.undo();

    expect(chart.drawings.get('line')?.points[0]?.price).toBe(170);
    expect(chart.drawings.get('other')?.style.color).toBe('#e5484d');
  });

  it('leaves the drawings set while it went on alone', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(level('line', 170));
    const end = dragging(chart, () => {
      chart.drawings.set([level('line', 160)]);
    });
    pointer(chart, 'pointerup', ...end);

    expect(chart.drawings.get('line')?.points[0]?.price).toBe(160);
    expect(chart.drawings.canUndo()).toBe(false);

    chart.drawings.set([level('line', 170)]);
    dragging(chart, () => {
      chart.drawings.set([level('line', 170), level('next', 150)]);
    });
    key(chart, 'Escape');
    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual(['line', 'next']);
  });
});

describe('copies', () => {
  it('drags a copy with Alt and leaves the original in place', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 12 } });
    const id = trendLine(chart, [150, 170], [180, 185]);
    const changes = vi.fn();
    chart.on('drawingsChange', changes);
    const [x, y] = at(chart, 165, 177.5);
    const before = chart.drawings.get(id)?.points;
    pointer(chart, 'pointerdown', x, y, { altKey: true });
    pointer(chart, 'pointermove', x + 30, y, { altKey: true });
    pointer(chart, 'pointermove', x + 60, y, { altKey: true });
    pointer(chart, 'pointerup', x + 60, y, { altKey: true });

    const [original, copy] = chart.drawings.list();
    expect(original?.points).toEqual(before);
    expect(copy?.points[0]?.time).toBe(T0 + 155 * MINUTE);
    expect(chart.selection()).toEqual({ kind: 'drawing', id: copy?.id });
    expect(changes).toHaveBeenCalledWith({ reason: 'create', ids: [copy?.id] });

    chart.drawings.undo();
    expect(chart.drawings.list()).toHaveLength(1);
  });

  it('copies and pastes the selected drawing with the keyboard, a few bars to the right', () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.select({ kind: 'drawing', id });
    key(chart, 'c', { ctrlKey: true });
    key(chart, 'v', { ctrlKey: true });
    key(chart, 'v', { metaKey: true });

    const times = chart.drawings.list().map((drawing) => drawing.points[0]?.time);
    expect(times).toEqual([T0 + 150 * MINUTE, T0 + 155 * MINUTE, T0 + 160 * MINUTE]);
    expect(chart.selection()).toEqual({ kind: 'drawing', id: chart.drawings.list()[2]?.id });
  });

  it('duplicates a drawing through the API', () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    const copy = chart.drawings.duplicate(id);

    expect(copy).not.toBe(id);
    // A few bars to the right, where it does not hide the original.
    const shift = (index: number) =>
      (chart.drawings.get(copy)?.points[index]?.time ?? 0) -
      (chart.drawings.get(id)?.points[index]?.time ?? 0);
    expect(shift(0)).toBeGreaterThan(0);
    expect(shift(1)).toBe(shift(0));
    expect(chart.drawings.get(copy)?.points.map((point) => point.price)).toEqual(
      chart.drawings.get(id)?.points.map((point) => point.price)
    );
  });
});

describe('tools', () => {
  it('keeps a continuous tool active for the next drawing', () => {
    const chart = chartWithBars(200);
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('trend-line', { continuous: true });
    click(chart, ...at(chart, 150, 170));
    click(chart, ...at(chart, 160, 175));
    click(chart, ...at(chart, 165, 170));
    click(chart, ...at(chart, 175, 175));

    expect(chart.drawings.list()).toHaveLength(2);
    expect(chart.drawings.activeTool()).toBe('trend-line');
    expect(tools).not.toHaveBeenCalled();

    key(chart, 'Escape');
    expect(tools.mock.calls).toEqual([[{ type: 'trend-line', completed: false }]]);
  });

  it('leaves the selected drawing alone while a tool marks only its own', () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.select({ kind: 'drawing', id });
    chart.drawings.startTool('rectangle');
    click(chart, ...at(chart, 120, 160));
    key(chart, 'Backspace');
    key(chart, 'Delete');
    key(chart, 'c', { ctrlKey: true });
    key(chart, 'Escape');
    key(chart, 'v', { ctrlKey: true });

    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual([id]);
    expect(chart.selection()).toEqual({ kind: 'drawing', id });
  });

  it('reports nothing when the API ends a tool, as API calls never do', () => {
    const chart = chartWithBars(200);
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 170));
    chart.drawings.startTool('rectangle');
    chart.drawings.cancelTool();

    expect(chart.drawings.activeTool()).toBeNull();
    expect(tools).not.toHaveBeenCalled();
  });

  it('keeps the next anchor under a pointer that keeps still as the bars scroll by', () => {
    const chart = chartWithBars(200);
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    /** Where the objects layer draws circles: the anchors, and the handles of a line. */
    const circles = () => {
      const calls = canvasCalls(objects as HTMLCanvasElement);
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter(({ name }) => name === 'arc').map(({ args }) => Number(args[0]));
    };
    const spacing = chart.timeScale.barSpacing();
    const near = (list: number[], x: number) => list.some((each) => Math.abs(each - x) < spacing);
    const scroll = (bars: number) => {
      const range = chart.timeScale.visibleLogicalRange();

      if (range) {
        chart.timeScale.setVisibleLogicalRange({ from: range.from - bars, to: range.to - bars });
      }
    };

    // Before the first anchor, as a trackpad scrolls the bars under the pointer.
    chart.drawings.startTool('trend-line');
    const [x, y] = at(chart, 180, 175);
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    expect(near(circles(), x)).toBe(true);
    scroll(10);
    expect(near(circles(), x)).toBe(true);

    // And the end of the line once the first is placed.
    click(chart, ...at(chart, 150, 170));
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    scroll(-10);
    expect(near(circles(), x)).toBe(true);
  });

  it('places the next anchor under the pointer after the panes moved', () => {
    const chart = chartWithBars(200);
    const rsi = chart.indicators.get(chart.indicators.add({ type: 'RSI' }))?.pane ?? '';
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 50, rsi));
    // The main pane grows, and the RSI pane moves down under it.
    chart.resize(800, 600);
    click(chart, ...at(chart, 180, 50, rsi));

    expect(chart.drawings.list()[0]?.pane).toBe(rsi);
    expect(chart.drawings.list()[0]?.points.map((point) => point.price)).toEqual([
      expect.closeTo(50, 1),
      expect.closeTo(50, 1)
    ]);
  });

  it('shows the first anchor under the pointer in the pane it is over', () => {
    const chart = chartWithBars(200);
    const rsi = chart.indicators.get(chart.indicators.add({ type: 'RSI' }))?.pane ?? '';
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    chart.drawings.startTool('trend-line');
    const [x, y] = at(chart, 150, 50, rsi);
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    const calls = canvasCalls(objects as HTMLCanvasElement);
    calls.length = 0;
    chart.screenshot();
    const circles = calls.filter(({ name }) => name === 'arc').map(({ args }) => args.slice(0, 2));

    expect(circles).toEqual([[expect.closeTo(x, 1), expect.closeTo(y, 1)]]);
  });

  it('joins the anchors placed so far until the drawing is complete', () => {
    const chart = chartWithBars(200);
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const lines = () => {
      const calls = canvasCalls(objects as HTMLCanvasElement);
      calls.length = 0;
      chart.screenshot();
      return calls.filter(({ name }) => name === 'lineTo').length;
    };
    chart.drawings.startTool('parallel-channel');
    click(chart, ...at(chart, 150, 170));
    const [x, y] = at(chart, 180, 180);
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    chart.applyOptions({});

    // The base line of the channel shows before its third anchor.
    expect(lines()).toBe(1);
  });

  it('finishes a path with Enter, dropping the point a double click placed twice', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('path');
    click(chart, ...at(chart, 150, 170));
    click(chart, ...at(chart, 160, 175));
    click(chart, ...at(chart, 170, 168));
    click(chart, ...at(chart, 170, 168));
    key(chart, 'Enter');

    expect(chart.drawings.list()[0]?.points).toHaveLength(3);
    expect(chart.drawings.activeTool()).toBeNull();
  });
});

describe('a single bar', () => {
  /** A chart of one bar, which gives a time only where it is. */
  function oneBar(): Chart {
    const chart = chartWithBars(1);
    chart.drawings.add({ id: 'line', type: 'horizontal-line', points: [{ time: T0, price: 100 }] });
    return chart;
  }

  it('places anchors only on the bar', () => {
    const chart = oneBar();
    const [x, y] = at(chart, 0, 101);
    chart.drawings.startTool('horizontal-line');
    const errors = errorsOf(() => {
      click(chart, x - 100, y);
    });

    expect(errors).toEqual([]);
    expect(chart.drawings.list()).toHaveLength(1);

    click(chart, x, y);
    expect(chart.drawings.list()[1]?.points[0]?.time).toBe(T0);
  });

  it('keeps a drawing on the bar while it is dragged off it', () => {
    const chart = oneBar();
    const [x, y] = at(chart, 0, 100);
    drag(chart, [x, y], [x - 100, y - 20]);

    expect(chart.drawings.get('line')?.points[0]?.time).toBe(T0);
    expect(() => {
      chart.loadState(JSON.parse(JSON.stringify(chart.saveState())) as never);
    }).not.toThrow();
  });

  it('copies nothing on top of the original without two bars to move the copy by', () => {
    const chart = oneBar();
    chart.select({ kind: 'drawing', id: 'line' });
    const errors = errorsOf(() => {
      key(chart, 'c', { ctrlKey: true });
      key(chart, 'v', { ctrlKey: true });
    });

    expect(errors).toEqual([]);
    expect(() => chart.drawings.duplicate('line')).toThrow('two bars or more');
    expect(chart.drawings.list()).toHaveLength(1);
  });
});

describe('a removed pane', () => {
  /** A chart with an RSI pane, which goes when the RSI is removed. */
  function withRsi(): { chart: Chart; pane: string; remove: () => void } {
    const chart = chartWithBars(200);
    const id = chart.indicators.add({ type: 'RSI' });
    return {
      chart,
      pane: chart.indicators.get(id)?.pane ?? '',
      remove: () => {
        chart.indicators.remove(id);
      }
    };
  }

  it('takes the anchors the tool placed there with it', () => {
    const { chart, pane, remove } = withRsi();
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 50, pane));
    remove();
    const errors = errorsOf(() => {
      click(chart, ...at(chart, 160, 170));
      click(chart, ...at(chart, 180, 175));
    });

    expect(errors).toEqual([]);
    expect(chart.drawings.list().map((drawing) => drawing.pane)).toEqual(['main']);
    expect(() => {
      chart.loadState(chart.saveState());
    }).not.toThrow();
  });

  it('takes a copy of a drawing of it with it', () => {
    const { chart, pane, remove } = withRsi();
    const id = chart.drawings.add({
      type: 'horizontal-line',
      pane,
      points: [{ time: T0 + 150 * MINUTE, price: 50 }]
    });
    chart.select({ kind: 'drawing', id });
    key(chart, 'c', { ctrlKey: true });
    remove();
    key(chart, 'v', { ctrlKey: true });

    expect(chart.drawings.list()).toEqual([]);
  });

  it('takes a copy of a drawing of it with it when a layout without it is loaded', () => {
    const chart = chartWithBars(200);
    const plain = chart.saveState();
    chart.panes.add({ id: 'lower' });
    const id = chart.drawings.add({
      type: 'horizontal-line',
      pane: 'lower',
      points: [{ time: T0 + 150 * MINUTE, price: 50 }]
    });
    chart.select({ kind: 'drawing', id });
    key(chart, 'c', { ctrlKey: true });
    chart.loadState(plain);
    key(chart, 'v', { ctrlKey: true });

    expect(chart.drawings.list()).toEqual([]);
    expect(() => {
      chart.loadState(chart.saveState());
    }).not.toThrow();
  });

  it('closes the editor of a text placed there', () => {
    const { chart, pane, remove } = withRsi();
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 50, pane));
    remove();

    expect(document.querySelector('textarea')).toBeNull();
    expect(chart.drawings.list()).toEqual([]);
    // Removing the pane is the API's doing, which reports no end of the tool.
    expect(tools).not.toHaveBeenCalled();
  });
});

describe('hidden drawings', () => {
  it('are neither deleted nor copied by the keys while they are selected', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }]
    });
    chart.select({ kind: 'drawing', id });
    chart.drawings.update(id, { visible: false });
    key(chart, 'Delete');
    key(chart, 'c', { ctrlKey: true });
    key(chart, 'v', { ctrlKey: true });

    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual([id]);
  });

  it('hide all with the option, each kept as it is and nothing recorded to undo', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }]
    });
    chart.applyOptions({ drawings: { visible: false } });
    click(chart, ...at(chart, 150, 170));

    expect(chart.selection()).toBeNull();
    expect(chart.drawings.get(id)?.visible).toBe(true);

    chart.applyOptions({ drawings: { visible: true } });
    click(chart, ...at(chart, 150, 170));

    expect(chart.selection()).toEqual({ kind: 'drawing', id });
    // The one step to undo is adding it.
    chart.drawings.undo();
    expect(chart.drawings.list()).toEqual([]);
  });

  it('keep no history to undo with the option off, by the keys or the API', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }]
    });
    chart.applyOptions({ drawings: { history: false } });
    chart.drawings.update(id, { text: 'Support' });

    expect(chart.drawings.canUndo()).toBe(false);
    key(chart, 'z', { ctrlKey: true });
    expect(chart.drawings.undo()).toBe(false);
    expect(chart.drawings.get(id)?.text).toBe('Support');

    // Turned on again, it starts afresh: nothing from before to undo.
    chart.applyOptions({ drawings: { history: true } });
    expect(chart.drawings.canUndo()).toBe(false);
  });
});

describe('text', () => {
  const editor = () => document.querySelector('textarea');

  it('asks for the text of a new text drawing in place', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));

    expect(chart.drawings.list()).toHaveLength(0);
    const area = editor();

    if (!area) {
      throw new Error('No editor.');
    }

    area.value = 'Support\nzone';
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(editor()).toBeNull();
    expect(chart.drawings.list()[0]).toMatchObject({ type: 'text', text: 'Support\nzone' });
  });

  it('closes its editor when the chart is destroyed', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));
    const area = editor();
    chart.destroy();

    expect(editor()).toBeNull();
    expect(() => area?.dispatchEvent(new FocusEvent('blur'))).not.toThrow();
  });

  it('places nothing when the new text is left empty or cancelled', () => {
    const chart = chartWithBars(200);
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));
    editor()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));
    editor()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(chart.drawings.list()).toHaveLength(0);
    expect(tools.mock.calls).toEqual([
      [{ type: 'text', completed: false }],
      [{ type: 'text', completed: false }]
    ]);
  });

  it('ends the text tool once the text is kept, after reporting the drawing', () => {
    const chart = chartWithBars(200);
    const events: string[] = [];
    chart.on('drawingsChange', ({ reason }) => events.push(reason));
    chart.on('toolEnd', ({ type, completed }) => events.push(`${type} ${String(completed)}`));
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));

    expect(chart.drawings.activeTool()).toBeNull();
    expect(events).toEqual([]);

    const area = editor();

    if (area) {
      area.value = 'Note';
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    expect(events).toEqual(['create', 'text true']);
  });

  it('reports no end of the text tool when the API closes its editor', () => {
    const chart = chartWithBars(200);
    const placeText = (text: string) => {
      chart.drawings.startTool('text');
      click(chart, ...at(chart, 150, 170));
      const area = editor();

      if (area) {
        area.value = text;
      }
    };
    const tools = vi.fn();
    chart.on('toolEnd', tools);

    // Another tool keeps the text; cancelTool(), set() and loadState() drop it.
    placeText('Kept');
    chart.drawings.startTool('trend-line');
    expect(chart.drawings.list().map((drawing) => drawing.text)).toEqual(['Kept']);
    chart.drawings.cancelTool();

    placeText('Cancelled');
    chart.drawings.cancelTool();
    expect(editor()).toBeNull();

    placeText('Replaced');
    chart.drawings.set([]);
    const state = chart.saveState();
    placeText('Loaded over');
    chart.loadState(state);

    expect(editor()).toBeNull();
    expect(chart.drawings.list()).toEqual([]);
    expect(tools).not.toHaveBeenCalled();
  });

  it('drops the text being edited when the chart is destroyed', () => {
    const chart = chartWithBars(200);
    const changes = vi.fn();
    chart.on('drawingsChange', changes);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));
    const area = editor();

    if (area) {
      area.value = 'Gone';
    }

    chart.destroy();
    area?.dispatchEvent(new Event('blur'));

    expect(changes).not.toHaveBeenCalled();
  });

  it('edits existing text on double click, keeping keys away from the chart', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'text',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }],
      text: 'Old'
    });
    const changes = vi.fn();
    chart.on('drawingsChange', changes);
    const [x, y] = at(chart, 150, 170);
    chart.element.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: x + 5, clientY: y })
    );
    const area = editor();

    expect(area?.value).toBe('Old');

    area?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(chart.drawings.get(id)).not.toBeNull();

    if (area) {
      area.value = 'New';
      area.dispatchEvent(new Event('focus'));
      area.dispatchEvent(new Event('blur'));
    }

    expect(chart.drawings.get(id)?.text).toBe('New');
    expect(changes).toHaveBeenCalledWith({ reason: 'edit', ids: [id] });
    expect(chart.drawings.editText(id)).toBe(true);
    editor()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(chart.drawings.get(id)?.text).toBe('New');
    expect(chart.drawings.editText(trendLine(chart, [1, 1], [2, 2]))).toBe(false);
  });
});

describe('text and replaced drawings', () => {
  const editor = () => document.querySelector('textarea');

  function type(text: string): void {
    const area = editor();

    if (area) {
      area.value = text;
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }

  it('closes the editor of a drawing that a loaded layout replaces', () => {
    const chart = chartWithBars(200);
    const note = { id: 'note', type: 'text', points: [{ time: T0 + 150 * MINUTE, price: 170 }] };
    chart.drawings.add({ ...note, text: 'Old' });
    chart.drawings.editText('note');
    // Another layout with a drawing of the same id, as ids repeat from one layout to the next.
    chart.drawings.set([{ ...note, text: 'Other' }]);
    type('New');

    expect(editor()).toBeNull();
    expect(chart.drawings.get('note')?.text).toBe('Other');
  });

  it('closes the editor of a drawing that remove() or clear() removes', () => {
    const chart = chartWithBars(200);
    const note = { type: 'text', points: [{ time: T0 + 150 * MINUTE, price: 170 }] };

    for (const removeIt of [
      (id: string) => {
        chart.drawings.remove(id);
      },
      () => {
        chart.drawings.clear();
      }
    ]) {
      const id = chart.drawings.add({ ...note, text: 'Old' });
      chart.drawings.editText(id);
      removeIt(id);

      expect(editor()).toBeNull();
    }

    chart.drawings.undo();
    expect(chart.drawings.list().map((drawing) => drawing.text)).toEqual(['Old']);
  });

  it('keeps the editor open when undo() has no step to undo', () => {
    const chart = chartWithBars(200, { drawings: { history: false } });
    const id = chart.drawings.add({
      type: 'text',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }],
      text: 'Old'
    });
    chart.drawings.editText(id);
    const area = editor();

    if (area) {
      area.value = 'New';
    }

    expect(chart.drawings.undo()).toBe(false);
    expect(chart.drawings.redo()).toBe(false);
    expect(editor()).not.toBeNull();
    expect(chart.drawings.get(id)?.text).toBe('Old');
  });

  it('drops a text being placed when a layout is loaded', () => {
    const chart = chartWithBars(200);
    const plain = chart.saveState();
    const rsi = chart.indicators.get(chart.indicators.add({ type: 'RSI' }))?.pane ?? '';
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 50, rsi));
    chart.loadState(plain);
    type('Note');

    expect(chart.drawings.list()).toEqual([]);
    expect(tools).not.toHaveBeenCalled();
  });
});

describe('bounds and axis marks', () => {
  it('reports the area of a drawing in chart coordinates', () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    const [x1, y1] = at(chart, 150, 170);
    const [x2, y2] = at(chart, 180, 185);
    const bounds = chart.drawings.bounds(id);

    expect(bounds?.x).toBeCloseTo(Math.min(x1, x2));
    expect(bounds?.y).toBeCloseTo(Math.min(y1, y2));
    expect(bounds?.width).toBeCloseTo(Math.abs(x2 - x1));
    expect(bounds?.height).toBeCloseTo(Math.abs(y2 - y1));

    chart.drawings.update(id, { visible: false });
    expect(chart.drawings.bounds(id)).toBeNull();
  });

  it('covers what a drawing draws, past its anchors too, and nothing for what draws nothing', () => {
    const chart = chartWithBars(200);
    // Its anchor is far left of the bars in view; the line crosses the plot.
    const line = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 10 * MINUTE, price: 170 }]
    });
    const [, y] = at(chart, 190, 170);
    const plot = chart.drawings.bounds(line);

    expect(plot?.y).toBeCloseTo(y);
    expect(plot?.height).toBe(0);
    expect(plot?.width).toBeGreaterThan(600);

    // Anchored after the last bar, a VWAP has no bars to average.
    const vwap = chart.drawings.add({
      type: 'anchored-vwap',
      points: [{ time: T0 + 400 * MINUTE, price: 0 }]
    });
    expect(chart.drawings.bounds(vwap)).toBeNull();
  });

  it('labels the selected drawing on the axes and a horizontal line always', () => {
    const chart = chartWithBars(200, { priceScale: { precision: 2 } });
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 100 * MINUTE, price: 160 }]
    });
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const texts = () => {
      const calls = canvasCalls(objects as HTMLCanvasElement);
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter(({ name }) => name === 'fillText').map(({ args }) => args[0]);
    };

    expect(texts()).toEqual(['160.00']);

    chart.select({ kind: 'drawing', id });
    const selected = texts();
    expect(selected).toEqual(expect.arrayContaining(['160.00', '170.00', '185.00']));
    expect(selected).toHaveLength(5);
  });
});

describe('undo', () => {
  it('brings back a drawing the Delete key removed without the hover it had', async () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    /** The circles of handles the objects layer draws. */
    const handles = () => {
      const calls = canvasCalls(objects as HTMLCanvasElement);
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter(({ name }) => name === 'arc').length;
    };
    const [x, y] = at(chart, 165, 177.5);
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    await nextFrame();
    chart.select({ kind: 'drawing', id });
    key(chart, 'Delete');
    key(chart, 'z', { ctrlKey: true });

    expect(chart.drawings.get(id)).not.toBeNull();
    expect(chart.selection()).toBeNull();
    expect(handles()).toBe(0);
  });

  it('records no step for a change that changes nothing', () => {
    const chart = chartWithBars(200);
    const id = trendLine(chart, [150, 170], [180, 185]);
    chart.drawings.update(id, {});
    chart.drawings.update(id, { style: { lineWidth: 2 } });
    chart.drawings.update(id, { style: { lineWidth: 2 } });
    chart.drawings.clear();
    chart.drawings.clear();

    chart.drawings.undo();
    expect(chart.drawings.get(id)?.style.lineWidth).toBe(2);
    chart.drawings.undo();
    expect(chart.drawings.get(id)?.style.lineWidth).toBeUndefined();
    chart.drawings.undo();
    expect(chart.drawings.list()).toEqual([]);
    expect(chart.drawings.canUndo()).toBe(false);
  });
});

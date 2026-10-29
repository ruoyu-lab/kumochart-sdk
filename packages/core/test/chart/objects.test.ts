import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import type { MarkerInput } from '../../src/trading/markers';
import type { OrderInput } from '../../src/trading/orders';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, drag, key, pointer } from '../helpers/chart';

function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

describe('drawings', () => {
  it('places a trend line with two clicks, selects it and reports the creation', () => {
    const chart = chartWithBars(200);
    const changes = vi.fn();
    const tools = vi.fn();
    chart.on('drawingsChange', changes);
    chart.on('toolEnd', tools);
    chart.drawings.startTool('trend-line');
    const [x1, y1] = at(chart, 150, 170);
    const [x2, y2] = at(chart, 180, 185);
    click(chart, x1, y1);
    click(chart, x2, y2);

    const [drawing] = chart.drawings.list();
    expect(drawing).toMatchObject({ type: 'trend-line', pane: 'main' });
    expect(drawing?.points.map((point) => point.time)).toEqual([
      T0 + 150 * MINUTE,
      T0 + 180 * MINUTE
    ]);
    expect(chart.selection()).toEqual({ kind: 'drawing', id: drawing?.id });
    expect(changes).toHaveBeenCalledWith({ reason: 'create', ids: [drawing?.id] });
    expect(tools).toHaveBeenCalledWith({ type: 'trend-line', completed: true });
    expect(chart.drawings.activeTool()).toBeNull();
  });

  it('completes a tool step before dispatching its events, even if a listener throws', () => {
    const chart = chartWithBars(200);
    const tools = vi.fn();
    const errors = vi.fn((event: ErrorEvent) => {
      event.preventDefault();
    });
    window.addEventListener('error', errors);
    chart.on('drawingsChange', () => {
      throw new Error('listener failed');
    });
    chart.on('toolEnd', tools);
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 170));
    click(chart, ...at(chart, 180, 185));
    window.removeEventListener('error', errors);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(chart.drawings.list()).toHaveLength(1);
    expect(tools).toHaveBeenCalledWith({ type: 'trend-line', completed: true });
    expect(chart.drawings.activeTool()).toBeNull();
  });

  it('validates tool options when the tool starts', () => {
    const chart = chartWithBars(20);

    expect(() => {
      chart.drawings.startTool('trend-line', { style: { lineWidth: 0 } });
    }).toThrow('style.lineWidth');
    expect(() => {
      chart.drawings.startTool('spiral');
    }).toThrow('spiral');
    expect(chart.drawings.activeTool()).toBeNull();
  });

  it('places anchors with mouse clicks, never by holding the button', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('rectangle');
    // Holding the button while moving only places the first anchor.
    drag(chart, at(chart, 150, 170), at(chart, 170, 180));
    expect(chart.drawings.list()).toHaveLength(0);

    click(chart, ...at(chart, 170, 180));
    expect(chart.drawings.list()[0]?.points).toHaveLength(2);
  });

  it('places an anchor where a finger lifts, aimed while it presses', () => {
    const chart = chartWithBars(200);
    const touch = { pointerType: 'touch' } as const;
    chart.drawings.startTool('rectangle');
    // Pressing places nothing yet: the anchor follows the finger.
    pointer(chart, 'pointerdown', ...at(chart, 150, 170), touch);
    expect(chart.drawings.list()).toEqual([]);
    drag(chart, at(chart, 150, 170), at(chart, 160, 175), 4, touch);
    drag(chart, at(chart, 170, 180), at(chart, 170, 180), 1, touch);

    const points = chart.drawings.list()[0]?.points ?? [];
    expect(points.map((anchor) => anchor.time)).toEqual([T0 + 160 * MINUTE, T0 + 170 * MINUTE]);
    expect(points[0]?.price).toBeCloseTo(175, 0);
    expect(points[1]?.price).toBeCloseTo(180, 0);
  });

  it('cancels the tool with Escape without creating anything', () => {
    const chart = chartWithBars(200);
    const tools = vi.fn();
    chart.on('toolEnd', tools);
    chart.drawings.startTool('trend-line');
    click(chart, ...at(chart, 150, 170));
    key(chart, 'Escape');

    expect(chart.drawings.list()).toHaveLength(0);
    expect(tools).toHaveBeenCalledWith({ type: 'trend-line', completed: false });
  });

  it('moves a drawing by dragging it, and dragging it back restores the original points', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 170 * MINUTE, price: 180 }]
    });
    const start = at(chart, 170, 180);
    const changes = vi.fn();
    chart.on('drawingsChange', changes);

    pointer(chart, 'pointerdown', ...start);
    pointer(chart, 'pointermove', start[0], start[1] - 40);
    expect(chart.drawings.get(id)?.points[0]?.price).toBeGreaterThan(180);
    pointer(chart, 'pointermove', ...start);
    pointer(chart, 'pointerup', ...start);

    expect(chart.drawings.get(id)?.points[0]?.price).toBeCloseTo(180, 6);
    expect(changes).toHaveBeenCalledWith({ reason: 'edit', ids: [id] });
  });

  it('reverts a drag on pointercancel', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 170 * MINUTE, price: 180 }]
    });
    const start = at(chart, 170, 180);
    pointer(chart, 'pointerdown', ...start);
    pointer(chart, 'pointermove', start[0], start[1] - 50);
    pointer(chart, 'pointercancel', start[0], start[1] - 50);

    expect(chart.drawings.get(id)?.points[0]?.price).toBe(180);
  });

  it('ignores editing keys while a drag is in progress', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 170 * MINUTE, price: 180 }]
    });
    const start = at(chart, 170, 180);
    pointer(chart, 'pointerdown', ...start);
    pointer(chart, 'pointermove', start[0], start[1] - 40);
    key(chart, 'Delete');
    key(chart, 'z', { ctrlKey: true });
    pointer(chart, 'pointerup', start[0], start[1] - 40);

    expect(chart.drawings.get(id)?.points[0]?.price).toBeGreaterThan(180);
  });

  it('undoes and redoes API and user changes; set() clears the history', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'vertical-line',
      points: [{ time: T0 + 160 * MINUTE, price: 0 }]
    });
    chart.drawings.update(id, { locked: true });

    expect(chart.drawings.undo()).toBe(true);
    expect(chart.drawings.get(id)?.locked).toBe(false);
    expect(chart.drawings.undo()).toBe(true);
    expect(chart.drawings.list()).toHaveLength(0);
    expect(chart.drawings.redo()).toBe(true);
    expect(chart.drawings.list()).toHaveLength(1);

    chart.drawings.set([]);
    expect(chart.drawings.canUndo()).toBe(false);
  });

  it('forgets drawings of a removed pane in the undo history', () => {
    const chart = chartWithBars(200);
    const macd = chart.indicators.add({ type: 'MACD' });
    chart.drawings.add({
      type: 'horizontal-line',
      pane: macd,
      points: [{ time: T0 + 100 * MINUTE, price: 0 }]
    });
    const main = chart.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 100 * MINUTE, price: 150 }]
    });
    chart.indicators.remove(macd);

    expect(chart.panes.get(macd)).toBeNull();
    expect(chart.drawings.undo()).toBe(true);
    expect(chart.drawings.list()).toEqual([]);
    expect(chart.drawings.redo()).toBe(true);
    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual([main]);
  });

  it('deletes the selected drawing with the Delete key as an undoable step', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({ type: 'horizontal-line', points: [{ time: T0, price: 180 }] });
    const changes = vi.fn();
    chart.on('drawingsChange', changes);
    chart.select({ kind: 'drawing', id });
    key(chart, 'Delete');

    expect(chart.drawings.list()).toHaveLength(0);
    expect(chart.selection()).toBeNull();
    expect(changes).toHaveBeenCalledWith({ reason: 'remove', ids: [id] });

    key(chart, 'z', { ctrlKey: true });
    expect(chart.drawings.list()).toHaveLength(1);
  });

  it('validates drawing input', () => {
    const chart = chartWithBars(10);

    expect(() =>
      chart.drawings.add({ type: 'trend-line', points: [{ time: T0, price: 1 }] })
    ).toThrow('needs 2 points');
    expect(() => chart.drawings.add({ type: 'spiral', points: [] })).toThrow(
      'Unknown drawing type "spiral"'
    );
    expect(() =>
      chart.drawings.add({ type: 'text', pane: 'nope', points: [{ time: T0, price: 1 }] })
    ).toThrow('Unknown pane');
  });
});

describe('selection', () => {
  it('changes selection through the API without an event, and by clicking with one', () => {
    const chart = chartWithBars(200);
    const selections = vi.fn();
    chart.on('selectionChange', selections);
    const id = chart.drawings.add({ type: 'horizontal-line', points: [{ time: T0, price: 180 }] });
    chart.select({ kind: 'drawing', id });

    expect(selections).not.toHaveBeenCalled();

    click(chart, 100, 20);
    expect(chart.selection()).toBeNull();
    expect(selections).toHaveBeenCalledWith({ selection: null });
    expect(() => {
      chart.select({ kind: 'order', id: 'missing' });
    }).toThrow('There is no order');
  });
});

describe('orders', () => {
  it('drags an order to a new price, reporting each phase', () => {
    const chart = chartWithBars(200, { priceScale: { precision: 2 } });
    chart.orders.set([{ id: 'o1', side: 'buy', price: 180, quantity: 1 }]);
    const drags = vi.fn();
    chart.on('orderDrag', drags);
    const [x, y] = at(chart, 120, 180);
    drag(chart, [x, y], [x, y - 30]);
    const price = chart.orders.get('o1')?.price ?? 0;

    expect(price).toBeGreaterThan(180);
    expect(drags.mock.calls.map(([event]) => (event as { phase: string }).phase)).toEqual([
      'start',
      'move',
      'move',
      'move',
      'move',
      'end'
    ]);
    expect(drags.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'o1',
      phase: 'end',
      price,
      initialPrice: 180
    });
  });

  it('stays where it is when pulled from, telling where the pointer is let go', () => {
    const chart = chartWithBars(200, { priceScale: { precision: 2 } });
    chart.orders.set([{ id: 'p1', side: 'buy', price: 180, pull: true }]);
    const drags = vi.fn();
    chart.on('orderDrag', drags);
    const [x, y] = at(chart, 120, 180);
    drag(chart, [x, y], [x, y - 30]);
    const end = drags.mock.calls.at(-1)?.[0] as { phase: string; price: number };

    expect(chart.orders.get('p1')?.price).toBe(180);
    expect(end.phase).toBe('end');
    expect(end.price).toBeGreaterThan(180);
    expect(drags.mock.calls[0]?.[0]).toMatchObject({ phase: 'start', price: 180 });
    expect(() => {
      chart.orders.update('p1', { pull: 'yes' as unknown as boolean });
    }).toThrow('order.pull');
  });

  it('restores the price when the drag is cancelled with Escape', () => {
    const chart = chartWithBars(200);
    chart.orders.set([{ id: 'o1', side: 'sell', price: 180 }]);
    const drags = vi.fn();
    chart.on('orderDrag', drags);
    const [x, y] = at(chart, 120, 180);
    pointer(chart, 'pointerdown', x, y);
    pointer(chart, 'pointermove', x, y - 40);
    key(chart, 'Escape');

    expect(chart.orders.get('o1')?.price).toBe(180);
    expect(drags.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'cancel', price: 180 });
  });

  it('does not loop when the application feeds dragged prices back through set()', () => {
    const chart = chartWithBars(200);
    let orders = [{ id: 'o1', side: 'buy' as const, price: 180 }];
    chart.orders.set(orders);
    const drags = vi.fn((event: { price: number }) => {
      orders = [{ ...orders[0]!, price: event.price }];
      chart.orders.set(orders);
    });
    chart.on('orderDrag', drags);
    const [x, y] = at(chart, 120, 180);
    drag(chart, [x, y], [x, y - 30], 2);

    expect(drags).toHaveBeenCalledTimes(4);
  });

  it('emits buttonClick for label buttons without selecting the order', () => {
    const chart = chartWithBars(200);
    chart.orders.set([
      { id: 'o1', side: 'buy', price: 180, label: 'LIMIT', buttons: [{ id: 'close', text: 'X' }] }
    ]);
    const buttons = vi.fn();
    chart.on('buttonClick', buttons);
    const [, y] = at(chart, 120, 180);
    // The button is the right-most part of the label, which ends 8px left of the plot edge.
    click(chart, chart.layout().plotWidth - 8 - 4, y);

    expect(buttons).toHaveBeenCalledWith({ kind: 'order', id: 'o1', buttonId: 'close' });
    expect(chart.selection()).toBeNull();
  });

  it('validates orders, including button icons', () => {
    const chart = chartWithBars(10);

    expect(() => {
      chart.orders.set([{ id: 'a', side: 'long' as 'buy', price: 1 }]);
    }).toThrow('order');
    expect(() => {
      chart.orders.set([
        { id: 'a', side: 'buy', price: 1, buttons: [{ id: 'x', icon: 'not a path' }] }
      ]);
    }).toThrow('SVG path');
    expect(() => {
      chart.orders.set([null as unknown as OrderInput]);
    }).toThrow('orders[0] must be an object, received null');
  });
});

describe('markers', () => {
  it('validates and reports markers', () => {
    const chart = chartWithBars(200);
    chart.markers.set([
      { id: 'm', time: T0 + 190 * MINUTE, position: 'below', shape: 'arrow-up', text: 'B' }
    ]);

    expect(chart.markers.get('m')).toMatchObject({ position: 'below', text: 'B' });
    expect(() => {
      chart.markers.add({ id: 'p', time: T0, position: 'price', shape: 'circle' });
    }).toThrow('price is required');
    expect(() => {
      chart.markers.add(null as unknown as MarkerInput);
    }).toThrow('marker must be an object, received null');
  });

  it('colors shapes that point nowhere as text, as the markers of indicators are', () => {
    const chart = chartWithBars(60, { timeScale: { barSpacing: 40 } });
    chart.markers.set(
      (['arrow-up', 'arrow-down', 'circle', 'square'] as const).map((shape, index) => ({
        id: shape,
        time: T0 + (50 + index) * MINUTE,
        position: 'above',
        shape
      }))
    );
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const ctx = canvas?.getContext('2d') ?? expect.unreachable('No objects layer.');
    const filled: unknown[] = [];
    ctx.fill = () => {
      filled.push(ctx.fillStyle);
    };
    chart.screenshot();
    const { theme } = chart.options();

    expect(filled).toEqual([theme.buy, theme.sell, theme.text, theme.text]);
  });

  it('look up the bars of the markers in view only, as they paint and as the pointer moves', () => {
    const chart = chartWithBars(10_000);
    // A marker on every bar, of a backtest say; about a hundred bars are in view.
    chart.markers.set(
      createBars(10_000).map((bar, index) => ({
        id: String(index),
        time: bar.time,
        position: 'below',
        shape: 'arrow-up'
      }))
    );
    const lookups = vi.spyOn(BarStore.prototype, 'indexAt');
    chart.screenshot();
    const range = chart.timeScale.visibleLogicalRange();
    const inView = Math.ceil((range?.to ?? 0) - (range?.from ?? 0)) + 3;

    expect(lookups.mock.calls.length).toBeGreaterThan(0);
    expect(lookups.mock.calls.length).toBeLessThanOrEqual(inView);

    lookups.mockClear();
    pointer(chart, 'pointermove', 200, 200, { buttons: 0 });
    expect(lookups.mock.calls.length).toBeLessThanOrEqual(inView + 1);
    lookups.mockRestore();
  });

  it('wait for their bar when they come after the latest one', () => {
    const chart = chartWithBars(60, { timeScale: { barSpacing: 40 } });
    chart.markers.set([
      // In the period of the latest bar, and two periods after it.
      { id: 'latest', time: T0 + 59.5 * MINUTE, position: 'above', shape: 'arrow-down' },
      { id: 'later', time: T0 + 62 * MINUTE, position: 'above', shape: 'arrow-up' }
    ]);
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const ctx = canvas?.getContext('2d') ?? expect.unreachable('No objects layer.');
    const filled: unknown[] = [];
    ctx.fill = () => {
      filled.push(ctx.fillStyle);
    };
    chart.screenshot();
    const { theme } = chart.options();

    expect(filled).toEqual([theme.sell]);

    // Its bar comes: it sits on it.
    chart.data.update(createBars(63).slice(60));
    filled.length = 0;
    chart.screenshot();
    expect(filled).toEqual([theme.sell, theme.buy]);
  });

  it('sit on the latest brick when they come after it, as bricks take no time', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 40 } });
    chart.transforms.set({ type: 'renko', params: { box: 2 } });
    const latest = chart.data.last()?.time ?? 0;
    chart.markers.set([
      { id: 'later', time: latest + 60 * MINUTE, position: 'above', shape: 'arrow-up' }
    ]);
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const ctx = canvas?.getContext('2d') ?? expect.unreachable('No objects layer.');
    const filled: unknown[] = [];
    ctx.fill = () => {
      filled.push(ctx.fillStyle);
    };
    chart.screenshot();

    expect(filled).toEqual([chart.options().theme.buy]);
  });

  it('join a marker to the one it links to with a dashed line in that one\u2019s color', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 10 } });
    const { theme } = chart.options();
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const ctx = canvas?.getContext('2d') ?? expect.unreachable('No objects layer.');
    const stroked: Array<{ color: unknown; dashed: boolean }> = [];
    let dash: number[] = [];
    ctx.setLineDash = (segments: number[]) => {
      dash = segments;
    };
    ctx.stroke = () => {
      stroked.push({ color: ctx.strokeStyle, dashed: dash.length > 0 });
    };
    const entry = { id: 'in', time: T0 + 190 * MINUTE, position: 'price', price: 150 } as const;
    chart.markers.set([
      { ...entry, shape: 'arrow-up' },
      {
        id: 'out',
        time: T0 + 195 * MINUTE,
        position: 'price',
        price: 160,
        shape: 'arrow-down',
        link: 'in'
      },
      // Linked to no marker, or to one before the data: no line.
      { id: 'lost', time: T0 + 196 * MINUTE, position: 'above', shape: 'circle', link: 'gone' },
      { id: 'early', time: T0 - 500 * MINUTE, position: 'below', shape: 'arrow-up' },
      { id: 'late', time: T0 + 197 * MINUTE, position: 'above', shape: 'circle', link: 'early' }
    ]);
    chart.screenshot();

    expect(stroked).toEqual([{ color: theme.buy, dashed: true }]);

    // Its entry scrolled out of view, the line still runs to it.
    chart.timeScale.scrollToIndex(193, 'left');
    stroked.length = 0;
    chart.screenshot();
    expect(stroked).toEqual([{ color: theme.buy, dashed: true }]);
    expect(() => {
      chart.markers.update('out', { link: 7 as unknown as string });
    }).toThrow('marker.link');
  });

  it('outline a marker, and the line of one linked to it, so that they stand out of the bars', () => {
    const chart = chartWithBars(200, { timeScale: { barSpacing: 10 } });
    const { theme } = chart.options();
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const ctx = canvas?.getContext('2d') ?? expect.unreachable('No objects layer.');
    const stroked: Array<[unknown, number]> = [];
    ctx.stroke = () => {
      stroked.push([ctx.strokeStyle, ctx.lineWidth]);
    };
    chart.markers.set([
      {
        id: 'in',
        time: T0 + 190 * MINUTE,
        position: 'price',
        price: 150,
        shape: 'triangle-up',
        outline: '#000000'
      },
      {
        id: 'out',
        time: T0 + 195 * MINUTE,
        position: 'price',
        price: 160,
        shape: 'triangle-down',
        link: 'in'
      }
    ]);
    chart.screenshot();

    // The line's outline under it, then the line; then the outline of the shape that has one.
    expect(stroked).toEqual([
      ['#000000', 3],
      [theme.buy, 1],
      ['#000000', 1]
    ]);
    expect(() => {
      chart.markers.update('in', { outline: 'not a color' });
    }).toThrow('marker.outline');
  });

  it('centers markers on their bar', () => {
    const chart = chartWithBars(60, { timeScale: { barSpacing: 40 } });
    chart.markers.set([
      { id: 'm', time: T0 + 55 * MINUTE, position: 'price', price: 130, shape: 'circle' }
    ]);
    const clicks = vi.fn();
    chart.on('click', clicks);
    click(chart, ...at(chart, 55, 130));

    expect(clicks.mock.calls[0]?.[0]).toMatchObject({ target: { kind: 'marker', id: 'm' } });
  });
});

describe('pane resize', () => {
  it('drags a separator without drifting and keeps the main pane above the minimum height', () => {
    const chart = chartWithBars(200);
    chart.indicators.add({ type: 'MACD' });
    const [pane] = chart.panes.list().slice(1);
    const resizes = vi.fn();
    chart.on('paneResize', resizes);
    const separator = chart.layout().separators[0];
    const separatorY = (separator?.y ?? 0) + (separator?.height ?? 0) / 2;
    pointer(chart, 'pointerdown', 100, separatorY);
    pointer(chart, 'pointermove', 100, separatorY - 2000);
    pointer(chart, 'pointermove', 100, separatorY - 50);
    pointer(chart, 'pointerup', 100, separatorY - 50);

    expect(chart.panes.get(pane?.id ?? '')?.height).toBeCloseTo((pane?.height ?? 0) + 50, 0);
    expect(resizes).toHaveBeenCalledTimes(1);

    pointer(chart, 'pointerdown', 100, separatorY - 50);
    pointer(chart, 'pointermove', 100, -5000);
    pointer(chart, 'pointerup', 100, -5000);
    const mainPane = chart.layout().panes[0];
    expect(mainPane?.plot.height).toBeGreaterThanOrEqual(chart.options().panes.minHeight);
  });

  it('restores the heights when a separator drag is cancelled', () => {
    const chart = chartWithBars(200);
    chart.indicators.add({ type: 'MACD' });
    const before = chart.panes.list().map((pane) => pane.height);
    const resizes = vi.fn();
    chart.on('paneResize', resizes);
    const separator = chart.layout().separators[0];
    const separatorY = (separator?.y ?? 0) + (separator?.height ?? 0) / 2;
    pointer(chart, 'pointerdown', 100, separatorY);
    pointer(chart, 'pointermove', 100, separatorY - 60);
    key(chart, 'Escape');

    expect(chart.panes.list().map((pane) => pane.height)).toEqual(before);
    expect(resizes).not.toHaveBeenCalled();
  });
});

describe('indicators', () => {
  it('creates and removes an own pane for oscillators', () => {
    const chart = chartWithBars(200);
    const id = chart.indicators.add({ type: 'RSI' });

    expect(chart.panes.list().map((pane) => pane.id)).toEqual(['main', id]);
    expect(chart.indicators.valuesAt(id)[0]).toMatchObject({ key: 'rsi' });

    chart.indicators.remove(id);
    expect(chart.panes.list()).toHaveLength(1);
  });

  it('accepts custom indicators computed from a window of bars', () => {
    const chart = chartWithBars(50);
    chart.indicators.register<{ period: number }>({
      type: 'MOMENTUM',
      name: 'MOM',
      pane: 'new',
      precision: 2,
      params: { period: { default: 3, min: 1, integer: true } },
      outputs: () => [{ key: 'mom', label: 'MOM', plot: { kind: 'line' } }],
      lookback: ({ period }) => period + 1,
      compute: (window) => [window.bar(window.length - 1).close - window.bar(0).close]
    });
    const id = chart.indicators.add({ type: 'MOMENTUM' });
    const bars = createBars(50);

    expect(chart.indicators.valuesAt(id)[0]?.value).toBeCloseTo(bars[49]!.close - bars[46]!.close);
  });

  it('refuses to remove an indicator an alert reads', () => {
    const chart = chartWithBars(50);
    const id = chart.indicators.add({ type: 'MA', params: { periods: [5] } });
    chart.alerts.add({
      id: 'a',
      source: { kind: 'indicator', id, key: 'ma5' },
      trigger: 'cross-up',
      value: 120
    });

    expect(() => {
      chart.indicators.remove(id);
    }).toThrow('is read by alert "a"; remove it first');
  });
});

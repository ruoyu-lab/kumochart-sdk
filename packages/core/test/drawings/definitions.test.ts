import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import { drawings } from '../../src/drawings';
import type { DrawingPoint, DrawingSpace, DrawingStyle } from '../../src/drawings/types';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click } from '../helpers/chart';

/** Chart coordinates of bar `index` at `price`. */
function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
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

describe('the definition of a drawing type', () => {
  it('must be an object', () => {
    const chart = chartWithBars(20);

    expect(() => {
      chart.drawings.register(null as never);
    }).toThrow('drawing type definition must be an object, received null.');
    expect(() => drawings([5 as never])).toThrow(
      'drawing type definition must be an object, received 5.'
    );
  });

  it('places nothing whose complete() gives another number of anchors than it has', () => {
    const chart = chartWithBars(200);
    chart.drawings.register({
      type: 'short',
      points: 3,
      place: 2,
      complete: (placed) => [...placed],
      paint: () => undefined,
      hitTest: () => null
    });
    chart.drawings.startTool('short');
    click(chart, ...at(chart, 150, 170));
    const errors = errorsOf(() => {
      click(chart, ...at(chart, 160, 175));
    });

    expect(String(errors[0])).toContain(
      'complete() of "short" gives 2 anchors; a "short" drawing has 3.'
    );
    expect(chart.drawings.list()).toEqual([]);
    expect(chart.drawings.activeTool()).toBe('short');
  });

  it('names an anchor by each handle when it moves none itself', () => {
    const chart = chartWithBars(200);
    chart.drawings.register({
      type: 'handled',
      points: 1,
      paint: () => undefined,
      hitTest: () => null,
      handles: (geometry) => geometry.points.map((point) => ({ id: 'middle', ...point }))
    });
    const id = chart.drawings.add({
      type: 'handled',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }]
    });
    chart.select({ kind: 'drawing', id });

    expect(() => {
      chart.applyOptions({});
      chart.screenshot();
    }).toThrow('The handle "middle" of a "handled" drawing is no anchor; define moveHandle()');
  });

  it('gives moveHandle() and axisMarks() the style of the drawing', () => {
    const chart = chartWithBars(200);
    const axisMarks = vi.fn(() => ({ prices: [], times: [] }));
    const moveHandle = vi.fn(
      (
        anchors: readonly DrawingPoint[],
        _handle: string,
        _to: DrawingPoint,
        _space: DrawingSpace,
        _style: DrawingStyle
      ) => [...anchors]
    );
    chart.drawings.register({
      type: 'styled',
      points: 1,
      paint: () => undefined,
      hitTest: () => null,
      moveHandle,
      axisMarks
    });
    const id = chart.drawings.add({
      type: 'styled',
      points: [{ time: T0 + 150 * MINUTE, price: 170 }],
      style: { color: '#123456' }
    });
    chart.select({ kind: 'drawing', id });
    chart.applyOptions({});
    chart.screenshot();

    expect(axisMarks).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ color: '#123456' })
    );

    const [x, y] = at(chart, 150, 170);
    click(chart, x, y);
    chart.element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })
    );
    chart.element.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y - 30, pointerId: 1 })
    );

    expect(moveHandle.mock.calls[0]?.[4]).toEqual(expect.objectContaining({ color: '#123456' }));
  });
});

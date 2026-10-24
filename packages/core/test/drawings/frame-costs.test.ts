import { describe, expect, it, vi } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import { allDrawings } from '../../src/drawings/all';
import { DrawingStore } from '../../src/drawings/drawing-store';
import { DRAWING_OPTIONS } from '../../src/drawings/options';
import { resolveStyle } from '../../src/drawings/style';
import { ENGLISH } from '../../src/drawings/texts';
import { longPosition } from '../../src/drawings/tools/position';
import type { Anchors, DrawingGeometry, DrawingPoint } from '../../src/drawings/types';
import { createDefaultOptions } from '../../src/options/defaults';
import { darkTheme } from '../../src/options/themes';
import { Registry } from '../../src/utils/registry';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, type Chart } from '../helpers/chart';

/** Paints every layer of a chart `times` times, the view moving a bar each time. */
function paint(chart: Chart, times: number): void {
  for (let index = 0; index < times; index += 1) {
    chart.timeScale.scrollToIndex(150 + index, 'center');
    chart.screenshot();
  }
}

describe('what painting a drawing costs', () => {
  it('works out the style of a type once for the options', () => {
    const chart = chartWithBars(200);
    const defaultStyle = vi.fn(() => ({ lineWidth: 3 }));
    chart.drawings.register({
      type: 'styled',
      points: 1,
      defaultStyle,
      paint: () => undefined,
      hitTest: () => null
    });
    chart.drawings.add({ type: 'styled', points: [{ time: T0 + 150 * MINUTE, price: 170 }] });
    paint(chart, 1);
    defaultStyle.mockClear();
    paint(chart, 3);

    expect(defaultStyle).not.toHaveBeenCalled();
    expect(chart.drawings.defaultStyle('styled').lineWidth).toBe(3);

    chart.applyOptions({ theme: { accent: '#123456' } });
    chart.screenshot();
    expect(defaultStyle).toHaveBeenCalledTimes(1);
  });

  it('paints and hit-tests only the drawings whose bounds reach the plot and the pointer', () => {
    const chart = chartWithBars(200);
    const paint_ = vi.fn();
    const hitTest = vi.fn(() => null);
    chart.drawings.register({
      type: 'boxed',
      points: 1,
      paint: paint_,
      hitTest,
      // A box 40 pixels wide right of the anchor.
      bounds: (geometry) => {
        const [anchor] = geometry.points;
        return anchor ? { x: anchor.x, y: anchor.y - 20, width: 40, height: 40 } : null;
      }
    });
    const far = chart.drawings.add({
      type: 'boxed',
      points: [{ time: T0 + 10 * MINUTE, price: 170 }]
    });
    paint(chart, 1);

    expect(paint_).not.toHaveBeenCalled();

    chart.drawings.update(far, { points: [{ time: T0 + 170 * MINUTE, price: 170 }] });
    paint(chart, 1);
    expect(paint_).toHaveBeenCalled();

    const x = chart.timeScale.timeToX(T0 + 170 * MINUTE) ?? 0;
    const y = chart.priceScale().priceToY(170) ?? 0;
    click(chart, x - 30, y);
    expect(hitTest).not.toHaveBeenCalled();
    click(chart, x + 20, y);
    expect(hitTest).toHaveBeenCalledTimes(1);
  });

  it('walks the bars of a position once a frame, though it paints under them and over them', () => {
    const source = new BarStore();
    source.set(createBars(60));
    let reads = 0;
    const counted = new Proxy(source, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target);

        if (key === 'low') {
          return (index: number) => {
            reads += 1;
            return target.low(index);
          };
        }

        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const anchors: Anchors<3> = [
      { time: T0 + 10 * MINUTE, price: 106 },
      { time: T0 + 50 * MINUTE, price: 130 },
      { time: T0 + 50 * MINUTE, price: 95 }
    ];
    const at = ({ time, price }: DrawingPoint) => ({ x: (time - T0) / MINUTE, y: price });
    const geometry: DrawingGeometry<Anchors<3>> = {
      points: [at(anchors[0]), at(anchors[1]), at(anchors[2])],
      anchors,
      width: 400,
      height: 300,
      style: resolveStyle(createDefaultOptions([DRAWING_OPTIONS]), longPosition, {}),
      text: '',
      theme: darkTheme,
      fontFamily: 'sans-serif',
      textFont: '12px sans-serif',
      valueToY: (value) => value,
      yToValue: (y) => y,
      timeToX: (time) => (time - T0) / MINUTE,
      barIndex: (time) => (time - T0) / MINUTE,
      bars: counted,
      source: counted,
      formatValue: (value) => value.toFixed(2),
      measureText: (text) => text.length * 6,
      texts: ENGLISH
    };
    const context = {
      ctx: document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D,
      pixelRatio: 1,
      geometry,
      hovered: false,
      selected: false,
      editing: false
    };
    longPosition.paintBelow?.(context);

    expect(reads).toBeGreaterThan(0);

    const walked = reads;
    longPosition.paint(context);
    expect(reads).toBe(walked);
  });
});

describe('the steps of the history', () => {
  it('share the drawings that did not change', () => {
    const store = new DrawingStore(new Registry('drawing type', allDrawings));
    const line = (price: number) =>
      store.create(
        { type: 'horizontal-line', points: [{ time: T0, price }] },
        (pane) => pane === 'main'
      );
    store.add(line(100));
    store.add(line(110));
    const before = store.snapshot();
    const [first, second] = before;
    store.update(second?.id ?? '', { text: 'Support' }, () => true);
    const after = store.snapshot();

    expect(after[0]).toBe(first);
    expect(after[1]).not.toBe(second);
    expect(second?.text).toBe('');

    store.restore(before);
    expect(store.snapshot()).toEqual(before);
    expect(store.snapshot()[1]).toBe(second);
  });
});

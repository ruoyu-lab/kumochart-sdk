import { describe, expect, it } from 'vitest';
import type { AlertTriggerEvent } from '../../src/alerts/types';
import type { Chart } from '../helpers/chart';
import type { BarInput } from '../../src/data/types';
import type { DrawingInput } from '../../src/drawings/types';
import { MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';

function bar(index: number, close: number): BarInput {
  return { time: T0 + index * MINUTE, open: close, high: close, low: close, close };
}

/** A chart of `closes`, recording the alerts it fires. */
function chartOf(closes: readonly number[]) {
  const chart = createTestChart();
  chart.data.set(closes.map((close, index) => bar(index, close)));
  const fired: AlertTriggerEvent[] = [];
  chart.on('alertTrigger', (event) => fired.push(event));
  const next = (close: number) => {
    chart.data.update(bar(chart.data.length, close));
  };
  return { chart, fired, next };
}

/** A trend line rising by one per bar: 100 at bar 0, 110 at bar 10. */
function rising(chart: Chart, type = 'trend-line'): string {
  return chart.drawings.add({
    id: 'line',
    type,
    points: [
      { time: T0, price: 100 },
      { time: T0 + 10 * MINUTE, price: 110 }
    ]
  });
}

describe('alerts on drawings', () => {
  it('fires when the price crosses a trend line where the line is at that bar', () => {
    const { chart, fired, next } = chartOf([100, 100, 100, 100, 100]);
    rising(chart);
    chart.alerts.add({
      id: 'breakout',
      trigger: 'cross-up',
      value: { kind: 'drawing', id: 'line' },
      frequency: 'every-time'
    });

    // The line is at 105 on bar 5 and 106 on bar 6.
    next(104);
    next(107);

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ id: 'breakout', time: T0 + 6 * MINUTE, value: 107 });
    expect(fired[0]?.threshold).toBeCloseTo(106);
  });

  it('follows how far each type of line reaches', () => {
    const watch = (type: string) => {
      const { chart, fired, next } = chartOf(Array.from({ length: 12 }, () => 100));
      rising(chart, type);
      chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: 'line' } });
      // Past the second anchor (bar 10) the line would be at 112 and 113.
      next(111);
      next(114);
      return fired.length;
    };

    expect(watch('trend-line')).toBe(0);
    expect(watch('arrow')).toBe(0);
    expect(watch('ray')).toBe(1);
    expect(watch('extended-line')).toBe(1);
  });

  it('follows how far the style extends a trend line, a rectangle or Fibonacci levels', () => {
    const watch = (input: Omit<DrawingInput, 'id'>, level?: string) => {
      const { chart, fired, next } = chartOf(Array.from({ length: 12 }, () => 100));
      chart.drawings.add({ id: 'line', ...input });
      chart.alerts.add({
        id: 'a',
        trigger: 'cross-up',
        value: { kind: 'drawing', id: 'line', ...(level ? { level } : {}) }
      });
      next(111);
      next(114);
      return fired.length;
    };
    const rising = [
      { time: T0, price: 100 },
      { time: T0 + 10 * MINUTE, price: 110 }
    ];
    const box = [
      { time: T0, price: 90 },
      { time: T0 + 10 * MINUTE, price: 112 }
    ];

    expect(watch({ type: 'trend-line', points: rising, style: { extendRight: true } })).toBe(1);
    expect(watch({ type: 'trend-line', points: rising, style: { extendLeft: true } })).toBe(0);
    expect(watch({ type: 'rectangle', points: box }, 'top')).toBe(0);
    expect(watch({ type: 'rectangle', points: box, style: { extendRight: true } }, 'top')).toBe(1);
  });

  it('watches the Fibonacci levels the style shows', () => {
    const { chart } = chartOf([100, 100, 100]);
    chart.drawings.add({
      id: 'fib',
      type: 'fib-retracement',
      points: [
        { time: T0, price: 100 },
        { time: T0 + 20 * MINUTE, price: 90 }
      ],
      style: { levels: [{ value: 0 }, { value: 0.65 }, { value: 1, visible: false }] }
    });

    expect(chart.drawings.levels('fib')).toEqual(['0', '0.65']);
    expect(() => {
      chart.alerts.add({
        id: 'a',
        trigger: 'cross',
        value: { kind: 'drawing', id: 'fib', level: '1' }
      });
    }).toThrow(/has no line "1"/);
  });

  it('watches horizontal lines, rectangles, channels and Fibonacci levels', () => {
    const { chart, fired, next } = chartOf([100, 100, 100]);
    chart.drawings.add({ id: 'h', type: 'horizontal-ray', points: [{ time: T0, price: 98 }] });
    chart.drawings.add({
      id: 'box',
      type: 'rectangle',
      points: [
        { time: T0, price: 95 },
        { time: T0 + 20 * MINUTE, price: 103 }
      ]
    });
    chart.drawings.add({
      id: 'channel',
      type: 'parallel-channel',
      points: [
        { time: T0, price: 90 },
        { time: T0 + 10 * MINUTE, price: 100 },
        { time: T0, price: 94 }
      ]
    });
    chart.drawings.add({
      id: 'fib',
      type: 'fib-retracement',
      points: [
        { time: T0, price: 100 },
        { time: T0 + 20 * MINUTE, price: 90 }
      ]
    });
    const watch = (id: string, level: string | undefined, trigger: 'cross-up' | 'cross-down') => {
      chart.alerts.add({
        id: `${id}:${level ?? ''}`,
        trigger,
        value: { kind: 'drawing', id, ...(level ? { level } : {}) },
        frequency: 'every-time'
      });
    };
    watch('h', undefined, 'cross-down');
    watch('box', 'top', 'cross-up');
    watch('channel', 'parallel', 'cross-down');
    watch('fib', '0.618', 'cross-down');

    // Bar 3 crosses above the box; bar 4 crosses below the channel's parallel (94 + 4 = 98),
    // the 0.618 level (96.18, measured back from where the move ended) and the ray (98).
    next(104);
    next(93);

    const thresholds = Object.fromEntries(fired.map((event) => [event.id, event.threshold]));
    expect(Object.keys(thresholds).sort()).toEqual([
      'box:top',
      'channel:parallel',
      'fib:0.618',
      'h:'
    ]);
    expect(thresholds['box:top']).toBe(103);
    expect(thresholds['channel:parallel']).toBeCloseTo(98);
    expect(thresholds['fib:0.618']).toBeCloseTo(96.18);
    expect(thresholds['h:']).toBe(98);
  });

  it('never fires because a drawing moved, only because the price did', () => {
    const { chart, fired, next } = chartOf([100, 100, 100]);
    chart.drawings.add({ id: 'h', type: 'horizontal-line', points: [{ time: T0, price: 102 }] });
    chart.alerts.add({
      id: 'a',
      trigger: 'cross',
      value: { kind: 'drawing', id: 'h' },
      frequency: 'every-time'
    });

    // The line moves under the price, then the next tick stays put.
    chart.drawings.update('h', { points: [{ time: T0, price: 98 }] });
    next(100);
    expect(fired).toHaveLength(0);

    next(97);
    expect(fired).toHaveLength(1);
  });

  it('waits while the drawing is removed and resumes after undo', () => {
    const { chart, fired, next } = chartOf([100, 100, 100]);
    chart.drawings.add({ id: 'h', type: 'horizontal-line', points: [{ time: T0, price: 102 }] });
    chart.alerts.add({
      id: 'a',
      trigger: 'cross',
      value: { kind: 'drawing', id: 'h' },
      frequency: 'every-time'
    });
    chart.drawings.remove('h');
    next(105);
    next(99);
    expect(fired).toHaveLength(0);

    chart.drawings.undo();
    next(103);
    expect(fired).toHaveLength(1);
  });

  it('interpolates on a logarithmic scale as the line is drawn', () => {
    const { chart, fired, next } = chartOf([50, 50, 50, 50, 50]);
    chart.priceScale().setMode('log');
    chart.drawings.add({
      id: 'line',
      type: 'trend-line',
      points: [
        { time: T0, price: 10 },
        { time: T0 + 10 * MINUTE, price: 1000 }
      ]
    });
    chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: 'line' } });
    // Halfway, bar 5, the line is at 100 on a log scale (not 505).
    next(101);

    expect(fired[0]?.threshold).toBeCloseTo(100);
  });

  it('reads custom levels and validates the drawing and its line', () => {
    const { chart, fired, next } = chartOf([100, 100]);
    chart.drawings.register({
      type: 'zone',
      points: 1,
      paint: () => undefined,
      hitTest: () => null,
      levels: ([anchor]) =>
        anchor
          ? [
              {
                key: 'upper',
                from: anchor,
                to: { ...anchor, price: anchor.price + 5 },
                extend: 'both'
              },
              { key: 'flat', from: anchor, to: anchor, extend: 'both' }
            ]
          : []
    });
    chart.drawings.add({ id: 'z', type: 'zone', points: [{ time: T0, price: 100 }] });
    chart.drawings.add({ id: 't', type: 'text', points: [{ time: T0, price: 100 }], text: 'note' });
    chart.alerts.add({
      id: 'a',
      trigger: 'above',
      value: { kind: 'drawing', id: 'z', level: 'flat' }
    });
    next(101);
    expect(fired).toHaveLength(1);

    expect(() => {
      chart.alerts.add({ id: 'b', trigger: 'cross', value: { kind: 'drawing', id: 'missing' } });
    }).toThrow('unknown drawing "missing"');
    expect(() => {
      chart.alerts.add({ id: 'b', trigger: 'cross', value: { kind: 'drawing', id: 't' } });
    }).toThrow('a "text" drawing has no lines to watch');
    expect(() => {
      chart.alerts.add({
        id: 'b',
        trigger: 'cross',
        value: { kind: 'drawing', id: 'z', level: 'lower' }
      });
    }).toThrow('has no line "lower"; it has "upper", "flat"');
    expect(chart.alerts.list().map((alert) => alert.id)).toEqual(['a']);
    expect(chart.drawings.levels('z')).toEqual(['upper', 'flat']);
    expect(chart.drawings.levels('t')).toEqual([]);
    expect(() => chart.drawings.levels('missing')).toThrow('Unknown drawing "missing"');
  });

  it('does not block removing an indicator with the id of a watched drawing', () => {
    const { chart } = chartOf([100, 100]);
    const ma = chart.indicators.add({ type: 'MA' });
    chart.drawings.add({ id: ma, type: 'horizontal-line', points: [{ time: T0, price: 100 }] });
    chart.alerts.add({ id: 'a', trigger: 'cross', value: { kind: 'drawing', id: ma } });

    expect(() => {
      chart.indicators.remove(ma);
    }).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { TypesChangeEvent } from '../../src/chart/events';
import { withAlpha } from '../../src/canvas/color';
import { trendLine } from '../../src/drawings/tools/lines';
import type { DrawingInput, DrawingStyle, DrawingTimeframes } from '../../src/drawings/types';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, createTestChart } from '../helpers/chart';

/** Chart coordinates of bar `index` at `price`. */
function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

/** A trend line from bar 150 to bar 180, on a chart of one-minute bars. */
function line(extra: Partial<DrawingInput> = {}): DrawingInput {
  return {
    id: 'line',
    type: 'trend-line',
    points: [
      { time: T0 + 150 * MINUTE, price: 170 },
      { time: T0 + 180 * MINUTE, price: 180 }
    ],
    ...extra
  };
}

function minuteChart(): Chart {
  const chart = createTestChart();
  chart.data.set(createBars(600), { interval: '1m' });
  return chart;
}

describe('timeframes of drawings', () => {
  it('shows a drawing only on the timeframes it is given', () => {
    const chart = minuteChart();
    chart.drawings.add(line({ timeframes: { minute: { from: 1, to: 5 } } }));
    chart.timeScale.fitContent();

    expect(chart.drawings.bounds('line')).not.toBeNull();

    chart.data.setTimeframe('15m');
    expect(chart.drawings.bounds('line')).toBeNull();

    chart.data.setTimeframe('5m');
    expect(chart.drawings.bounds('line')).not.toBeNull();
    expect(chart.drawings.get('line')?.timeframes).toEqual({ minute: { from: 1, to: 5 } });
  });

  it('rejects a misspelled field of a style', () => {
    const chart = minuteChart();
    chart.drawings.add(line());
    const misspelled = { colour: '#f00' } as Partial<DrawingStyle>;

    expect(() => chart.drawings.add(line({ id: 'other', style: misspelled }))).toThrow(
      'style has no field "colour"'
    );
    expect(() => {
      chart.drawings.update('line', { style: misspelled });
    }).toThrow('colour');
    expect(() => {
      chart.drawings.setToolStyle('trend-line', misspelled);
    }).toThrow('colour');
    expect(chart.drawings.list()).toHaveLength(1);
  });

  it('shows 60 minutes as one hour', () => {
    const chart = minuteChart();
    chart.drawings.add(
      line({ timeframes: { minute: { from: 1, to: 59 }, hour: { from: 1, to: 4 } } })
    );
    chart.drawings.add(line({ id: 'minutes', timeframes: { minute: { from: 1, to: 59 } } }));
    chart.data.setTimeframe('60m');
    chart.timeScale.fitContent();

    expect(chart.drawings.bounds('line')).not.toBeNull();
    expect(chart.drawings.bounds('minutes')).toBeNull();
  });

  it('shows on bars that do not stand for time only when it says so', () => {
    const chart = minuteChart();
    chart.drawings.add(line({ timeframes: { minute: { from: 1, to: 59 } } }));
    chart.drawings.add(line({ id: 'renko', timeframes: { untimed: true } }));
    chart.transforms.set({ type: 'renko', params: { box: 2 } });
    chart.timeScale.fitContent();

    expect(chart.drawings.bounds('line')).toBeNull();
    expect(chart.drawings.bounds('renko')).not.toBeNull();
  });

  it('shows every drawing on bars of unknown resolution, and on every timeframe without', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(line({ timeframes: { day: { from: 1, to: 1 } } }));
    chart.drawings.add(line({ id: 'all' }));
    chart.timeScale.fitContent();

    expect(chart.drawings.bounds('line')).not.toBeNull();
    expect(chart.drawings.get('all')?.timeframes).toBeNull();

    chart.drawings.update('line', { timeframes: null });
    expect(chart.drawings.get('line')?.timeframes).toBeNull();
  });

  it('rejects units and ranges that are not', () => {
    const chart = chartWithBars(200);
    const add = (timeframes: unknown) =>
      chart.drawings.add(line({ timeframes: timeframes as DrawingTimeframes }));

    expect(() => add({ minutes: { from: 1, to: 5 } })).toThrow(/minutes is not a unit/);
    expect(() => add({ hour: { from: 4, to: 2 } })).toThrow(/hour.to must be at least 4/);
    expect(() => add({ day: { from: 0, to: 2 } })).toThrow(/day.from must be at least 1/);
    expect(() => add({ untimed: 'yes' })).toThrow(/untimed must be a boolean/);
    expect(chart.drawings.list()).toHaveLength(0);
  });
});

describe('styles of tools', () => {
  it('gives the drawings a tool places its style, under the style startTool() is given', () => {
    const chart = chartWithBars(200);
    chart.drawings.setToolStyle('trend-line', { color: '#e5484d', lineWidth: 3 });
    const place = (style?: { color: string }) => {
      chart.drawings.startTool('trend-line', style ? { style } : {});
      click(chart, ...at(chart, 150, 170));
      click(chart, ...at(chart, 180, 175));
      return chart.drawings.list().at(-1)?.style;
    };

    expect(place()).toEqual({ color: '#e5484d', lineWidth: 3 });
    expect(place({ color: '#14a37f' })).toEqual({ color: '#14a37f', lineWidth: 3 });
    expect(chart.drawings.toolStyle('trend-line')).toEqual({ color: '#e5484d', lineWidth: 3 });

    // Drawings keep the style they were placed with.
    chart.drawings.setToolStyle('trend-line', null);
    expect(chart.drawings.toolStyle('trend-line')).toEqual({});
    expect(chart.drawings.list()[0]?.style).toEqual({ color: '#e5484d', lineWidth: 3 });
    expect(place()).toEqual({});
  });

  it('checks the style and the type', () => {
    const chart = chartWithBars(20);

    expect(() => {
      chart.drawings.setToolStyle('trend-line', { lineWidth: 0 });
    }).toThrow(/style.lineWidth must be at least 0.5/);
    expect(() => {
      chart.drawings.setToolStyle('fib-retracement', { levels: [{ value: Number.NaN }] });
    }).toThrow(/style.levels\[0\].value must be a finite number/);
    expect(() => chart.drawings.toolStyle('nothing')).toThrow(/Unknown drawing type "nothing"/);
  });

  it('describes the style each type paints with and its defaults', () => {
    const chart = chartWithBars(20);
    const { accent } = chart.options().theme;

    expect(chart.drawings.fields('rectangle')).toEqual(
      expect.arrayContaining(['fill', 'fillColor', 'extendLeft', 'text', 'textPosition'])
    );
    expect(chart.drawings.fields('horizontal-line')).not.toContain('fill');
    expect(chart.drawings.defaultStyle('rectangle')).toMatchObject({
      color: accent,
      fill: true,
      fillColor: withAlpha(accent, 0.12),
      textAlign: 'center'
    });
    // The 24 levels of a retracement, those to 4.236 shown.
    const fib = chart.drawings.defaultStyle('fib-retracement').levels;
    expect(fib.filter((level) => level.visible !== false).map((level) => level.value)).toEqual([
      0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236
    ]);
    expect(fib.filter((level) => level.visible === false).map((level) => level.value)).toEqual([
      1.272, 1.414, 2.272, 2.414, 2, 3, 3.272, 3.414, 4, 4.272, 4.414, 4.618, 4.764
    ]);
    expect(chart.drawings.defaultStyle('arrow').endArrow).toBe(true);
    expect(chart.drawings.definition('text')?.editableText).toBe(true);
    expect(chart.drawings.definition('nothing')).toBeNull();

    chart.drawings.register({
      type: 'custom',
      points: 1,
      paint: () => undefined,
      hitTest: () => null
    });
    expect(chart.drawings.fields('custom')).toEqual(['color', 'lineWidth', 'lineStyle']);
  });

  it('takes text styles, alignment and levels through the API', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(line({ text: 'Breakout' }));
    chart.drawings.update('line', {
      style: { bold: true, italic: true, textAlign: 'right', textPosition: 'bottom' }
    });

    expect(chart.drawings.get('line')?.style).toEqual({
      bold: true,
      italic: true,
      textAlign: 'right',
      textPosition: 'bottom'
    });
    expect(() => {
      chart.drawings.update('line', { style: { textAlign: 'justify' as 'left' } });
    }).toThrow(/style.textAlign must be one of/);
  });
});

describe('the drawings API', () => {
  it('sets anchors exactly as given, as an undoable step', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(line());
    const points = [
      { time: T0 + 150.5 * MINUTE, price: 171.234 },
      { time: T0 + 400 * MINUTE, price: 160 }
    ];
    chart.drawings.update('line', { points });

    expect(chart.drawings.get('line')?.points).toEqual(points);
    chart.drawings.undo();
    expect(chart.drawings.get('line')?.points[1]?.price).toBe(180);
  });

  it('undoes the updates of one edit at once: those in a row with the same merge key', () => {
    const chart = chartWithBars(200);
    chart.drawings.add(line({ text: 'B' }));
    chart.drawings.add(line({ id: 'other' }));
    const text = () => chart.drawings.get('line')?.text;
    const type = (typed: string, merge: string) => {
      chart.drawings.update('line', { text: typed }, { merge });
    };

    // One edit of the text, typed letter by letter, then another.
    type('Br', 'text#1');
    type('Bre', 'text#1');
    type('Brea', 'text#1');
    type('Break', 'text#2');
    type('Breako', 'text#2');
    expect(chart.drawings.undo()).toBe(true);
    expect(text()).toBe('Brea');
    expect(chart.drawings.undo()).toBe(true);
    expect(text()).toBe('B');
    expect(chart.drawings.redo()).toBe(true);
    expect(text()).toBe('Brea');

    // After an undo or redo, a change with the key of the edit before is a step of its own.
    type('Bread', 'text#1');
    expect(chart.drawings.canRedo()).toBe(false);
    chart.drawings.undo();
    expect(text()).toBe('Brea');

    // Another change between them, another drawing, or no key: steps of their own.
    type('Brew', 'text#3');
    chart.drawings.update('other', { style: { lineWidth: 3 } });
    type('Brews', 'text#3');
    chart.drawings.update('other', { text: 'x' }, { merge: 'text#3' });
    chart.drawings.update('line', { text: 'Brewer' });
    chart.drawings.update('line', { text: 'Brewery' });
    expect(() => {
      chart.drawings.update('other', { text: 'y' }, { merge: '' });
    }).toThrow(/options.merge must be a non-empty string/);
    const steps: string[] = [];

    while (chart.drawings.undo()) {
      steps.push(`${text() ?? ''} ${chart.drawings.get('other')?.text ?? ''}`);
    }

    expect(steps).toEqual([
      'Brewer x',
      'Brews x',
      'Brews ',
      'Brew ',
      'Brew ',
      'Brea ',
      'B ',
      'B ',
      ' '
    ]);
  });

  it('validates a drawing without adding it', () => {
    const chart = chartWithBars(20);
    chart.drawings.add(line());

    // The ids of the drawings there do not matter.
    expect(() => {
      chart.drawings.validate(line());
    }).not.toThrow();
    expect(() => {
      chart.drawings.validate(line({ type: 'nothing' }));
    }).toThrow(/Unknown drawing type "nothing"/);
    expect(() => {
      chart.drawings.validate(line({ points: [] }));
    }).toThrow(/needs 2 points/);
    expect(() => {
      chart.drawings.validate(line({ pane: 'RSI' }));
    }).toThrow(/Unknown pane "RSI"/);
    expect(chart.drawings.list()).toHaveLength(1);
  });

  it('copies what it returns', () => {
    const chart = chartWithBars(20);
    chart.drawings.add(
      line({
        style: { levels: [{ value: 0.5 }] },
        timeframes: { hour: { from: 1, to: 4 } }
      })
    );
    const drawing = chart.drawings.get('line');
    (drawing?.style.levels as { value: number }[] | undefined)?.push({ value: 2 });
    (drawing?.timeframes?.hour as { to: number } | undefined)!.to = 24;

    expect(chart.drawings.get('line')?.style.levels).toEqual([{ value: 0.5 }]);
    expect(chart.drawings.get('line')?.timeframes).toEqual({ hour: { from: 1, to: 4 } });
  });
});

describe('registered types', () => {
  it('unregisters a drawing type once no drawing of it is left, and reports both', () => {
    const chart = chartWithBars(200);
    const events: TypesChangeEvent[] = [];
    chart.on('typesChange', (event) => events.push(event));
    chart.drawings.register({ ...trendLine, type: 'cross' });
    chart.drawings.setToolStyle('cross', { color: '#e5484d' });
    chart.drawings.add(line({ type: 'cross' }));

    expect(() => {
      chart.drawings.unregister('cross');
    }).toThrow(/Drawings of type "cross" are on the chart/);

    chart.drawings.remove('line');
    chart.drawings.unregister('cross');

    expect(chart.drawings.types()).not.toContain('cross');
    expect(events).toEqual([
      { kind: 'drawing', type: 'cross', registered: true },
      { kind: 'drawing', type: 'cross', registered: false }
    ]);
    // Undo cannot bring back a drawing of a type that is gone.
    expect(chart.drawings.undo()).toBe(true);
    expect(chart.drawings.list()).toHaveLength(0);

    // Registered again, the type starts afresh.
    chart.drawings.register({ ...trendLine, type: 'cross' });
    expect(chart.drawings.toolStyle('cross')).toEqual({});
  });

  it('unregisters the types of the module as any other, but keeps an active tool', () => {
    const chart = chartWithBars(20);
    chart.drawings.register({ ...trendLine, type: 'cross' });
    chart.drawings.startTool('cross');
    chart.drawings.unregister('trend-line');

    expect(chart.drawings.types()).not.toContain('trend-line');
    expect(() => {
      chart.drawings.unregister('cross');
    }).toThrow(/The "cross" tool is active/);
    expect(() => {
      chart.drawings.unregister('nothing');
    }).toThrow(/Unknown drawing type "nothing"/);
  });

  it('drops a text of a type being placed when the type is unregistered', () => {
    const chart = chartWithBars(200);
    const tools: unknown[] = [];
    chart.on('toolEnd', (event) => tools.push(event));
    chart.drawings.startTool('text');
    click(chart, ...at(chart, 150, 170));
    chart.drawings.unregister('text');

    expect(document.querySelector('textarea')).toBeNull();
    expect(chart.drawings.list()).toEqual([]);
    // Unregistering is the API's doing, which reports no end of the tool.
    expect(tools).toEqual([]);
  });

  it('unregisters an indicator type once no indicator of it is left', () => {
    const chart = chartWithBars(50);
    const events: TypesChangeEvent[] = [];
    chart.on('typesChange', (event) => events.push(event));
    const average = chart.indicators.definition('MA');

    if (!average) {
      throw new Error('No MA.');
    }

    chart.indicators.register({ ...average, type: 'MY_SMA' });
    const id = chart.indicators.add({ type: 'MY_SMA' });

    expect(() => {
      chart.indicators.unregister('MY_SMA');
    }).toThrow(/are of type "MY_SMA"; remove them first/);

    chart.indicators.remove(id);
    chart.indicators.unregister('MY_SMA');

    expect(chart.indicators.types()).not.toContain('MY_SMA');
    expect(chart.indicators.definition('MY_SMA')).toBeNull();
    expect(events).toEqual([
      { kind: 'indicator', type: 'MY_SMA', registered: true },
      { kind: 'indicator', type: 'MY_SMA', registered: false }
    ]);
  });
});

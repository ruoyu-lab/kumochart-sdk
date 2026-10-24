import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { ChartPointerEvent } from '../../src/chart/events';
import type { ToolEndEvent } from '../../src/drawings/module';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click, drag, pointer } from '../helpers/chart';
import { spreadLabels } from '../../src/render/axis-labels';
import { canvasCalls } from '../setup';

/** A comparison series priced about a hundred times the main bars. */
function addExpensive(chart: Chart, scale: string): string {
  return chart.series.add({
    id: 'eth',
    type: 'line',
    scale,
    data: createBars(200).map((bar) => ({ time: bar.time, value: bar.close * 100 }))
  });
}

/**
 * Registers a series type `probe` that keeps where its points were placed, and gives the y it
 * placed the value of a time at, in chart coordinates.
 */
function probe(chart: Chart): (time: number) => number {
  const placed = new Map<number, number>();
  chart.series.register({
    type: 'probe',
    input: 'value',
    defaultStyle: () => ({}),
    paint: ({ points }) => {
      placed.clear();

      for (let index = 0; index < points.count; index += 1) {
        placed.set(points.x(index), points.value(index));
      }
    }
  });
  return (time) => {
    const top = chart.layout().panes[0]?.plot.y ?? 0;
    return (placed.get(chart.timeScale.timeToX(time) ?? Number.NaN) ?? Number.NaN) + top;
  };
}

function sceneTexts(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

describe('price scales', () => {
  it('puts an indicator on an overlay scale of its own, e.g. volume under the bars', () => {
    const chart = chartWithBars(200);
    const before = chart.priceScale().range();
    chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
    chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });

    // The bars keep their range; the volume gets its own, squeezed into the bottom fifth.
    expect(chart.priceScale().range()).toEqual(before);
    const volume = chart.priceScale('main', 'volume');
    const plot = chart.layout().panes[0]?.plot;
    const largest = chart.data.bars.volume(chart.data.length - 1);
    expect(volume.priceToY(largest)).toBeCloseTo((plot?.y ?? 0) + (plot?.height ?? 0) * 0.8, 0);
    expect(volume.priceToY(0)).toBeCloseTo((plot?.y ?? 0) + (plot?.height ?? 0), 0);
    expect(volume.margins()).toEqual({ top: 0.8, bottom: 0 });
    // An overlay has no axis.
    expect(chart.layout().leftAxisWidth).toBe(0);

    expect(() => {
      volume.setMargins({ top: 0.6, bottom: 0.5 });
    }).toThrow('must leave a tenth of the pane for the data');
  });

  it('shows a left axis for what is placed on the left scale', () => {
    const chart = chartWithBars(200);
    addExpensive(chart, 'left');
    const layout = chart.layout();
    const [main] = layout.panes;

    expect(layout.leftAxisWidth).toBeGreaterThan(0);
    expect(main?.leftAxis).toEqual({
      x: 0,
      y: main?.plot.y,
      width: layout.leftAxisWidth,
      height: main?.plot.height
    });
    expect(main?.plot.x).toBe(layout.leftAxisWidth);
    expect(main?.axis.x).toBe(layout.leftAxisWidth + layout.plotWidth);
    // Each scale fits its own data: the bars around 100–200, the comparison in the thousands.
    expect(chart.priceScale().range()?.max).toBeLessThan(1000);
    expect(chart.priceScale('main', 'left').range()?.min).toBeGreaterThan(9000);
    // Left labels are the comparison's prices, in the thousands.
    expect(sceneTexts(chart).some((text) => /^\d{2},\d{3}\.\d{2}$/.test(text))).toBe(true);

    chart.series.update('eth', { scale: 'right' });
    expect(chart.layout().leftAxisWidth).toBe(0);
  });

  it('reports coordinates from the chart edge, beyond the left axis', async () => {
    const chart = chartWithBars(200);
    addExpensive(chart, 'left');
    const { leftAxisWidth } = chart.layout();
    const time = T0 + 150 * MINUTE;
    const x = chart.timeScale.timeToX(time) ?? 0;
    const y = chart.priceScale().priceToY(170) ?? 0;

    expect(x).toBeGreaterThan(leftAxisWidth);
    expect(chart.timeScale.xToTime(x)).toBe(time);

    const clicks: Array<{ x: number; time: number | null }> = [];
    chart.on('click', (event) => clicks.push({ x: event.x, time: event.time }));
    click(chart, x, y);
    expect(clicks).toEqual([{ x, time }]);

    // Hover moves are handled once per frame.
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(chart.crosshair.get()?.x).toBeCloseTo(x);
    expect(chart.crosshair.get()?.time).toBe(time);

    const id = chart.drawings.add({
      type: 'rectangle',
      points: [
        { time, price: 160 },
        { time: T0 + 170 * MINUTE, price: 175 }
      ]
    });
    expect(chart.drawings.bounds(id)?.x).toBeCloseTo(x);
  });

  it('cancels a tool on a right click, as Escape does, and opens no menu', () => {
    const chart = chartWithBars(200);
    const events: ChartPointerEvent[] = [];
    const tools: ToolEndEvent[] = [];
    chart.on('contextMenu', (event) => events.push(event));
    chart.on('toolEnd', (event) => tools.push(event));
    const { panes } = chart.layout();
    const plot = panes[0]?.plot;

    if (!plot) {
      throw new Error('The chart has no pane.');
    }

    const rightClick = () => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: plot.x + plot.width / 2,
        clientY: plot.y + plot.height / 2
      });
      chart.element.dispatchEvent(event);
      return event.defaultPrevented;
    };

    // Halfway through a trend line: the line is dropped, the tool ends, no menu opens.
    chart.drawings.startTool('trend-line');
    click(chart, plot.x + 100, plot.y + 100);
    expect(rightClick()).toBe(true);
    expect(chart.drawings.activeTool()).toBeNull();
    expect(chart.drawings.list()).toEqual([]);
    expect(tools).toEqual([{ type: 'trend-line', completed: false }]);
    expect(events).toEqual([]);

    // With no tool, the menu is the page's again.
    expect(rightClick()).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('tells which part of the chart a context menu is over, and the value of a price axis', () => {
    const chart = chartWithBars(200);
    addExpensive(chart, 'left');
    const rsi = chart.indicators.get(chart.indicators.add({ type: 'RSI' }))?.pane ?? '';
    const events: ChartPointerEvent[] = [];
    chart.on('contextMenu', (event) => events.push(event));
    const menuAt = (x: number, y: number) => {
      chart.element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
      return events.at(-1);
    };
    const { panes, timeAxis, leftAxisWidth } = chart.layout();
    const [main, lower] = panes;

    if (!main || !lower || !timeAxis) {
      throw new Error('The chart has no panes or time axis.');
    }

    const middle = (rect: { y: number; height: number }) => rect.y + rect.height / 2;
    const time = T0 + 150 * MINUTE;
    const x = chart.timeScale.timeToX(time) ?? 0;

    expect(menuAt(x, middle(main.plot))).toMatchObject({
      area: 'plot',
      paneId: 'main',
      scaleId: null,
      time,
      price: chart.priceScale().yToPrice(middle(main.plot))
    });
    expect(menuAt(main.axis.x + 10, middle(main.plot))).toMatchObject({
      area: 'price-axis',
      paneId: 'main',
      scaleId: 'right',
      index: null,
      time: null,
      price: chart.priceScale().yToPrice(middle(main.plot))
    });
    // An indicator pane, and the left axis with its own scale.
    expect(menuAt(lower.axis.x + 10, middle(lower.plot))).toMatchObject({
      area: 'price-axis',
      paneId: rsi,
      scaleId: 'right',
      price: chart.priceScale(rsi).yToPrice(middle(lower.plot))
    });
    expect(menuAt(leftAxisWidth / 2, middle(main.plot))).toMatchObject({
      area: 'price-axis',
      paneId: 'main',
      scaleId: 'left',
      price: chart.priceScale('main', 'left').yToPrice(middle(main.plot))
    });
    expect(menuAt(x, middle(timeAxis))).toMatchObject({
      area: 'time-axis',
      paneId: null,
      scaleId: null,
      time,
      price: null
    });
    // The corner below the price axis is part of neither axis.
    expect(menuAt(main.axis.x + 10, middle(timeAxis))).toMatchObject({
      area: 'outside',
      paneId: null,
      index: null
    });
  });

  it('scales the left axis by dragging it and resets it with a double click', () => {
    const chart = chartWithBars(200);
    addExpensive(chart, 'left');
    const left = chart.priceScale('main', 'left');
    const { leftAxisWidth, panes } = chart.layout();
    const middle = (panes[0]?.plot.height ?? 0) / 2;
    drag(chart, [leftAxisWidth / 2, middle], [leftAxisWidth / 2, middle - 60]);

    expect(left.isAutoScale()).toBe(false);
    expect(chart.priceScale().isAutoScale()).toBe(true);

    chart.element.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: leftAxisWidth / 2, clientY: middle })
    );
    expect(left.isAutoScale()).toBe(true);
  });

  it('lets the right scale follow the left one when nothing else is on the right', () => {
    const chart = chartWithBars(200);
    const pane = chart.indicators.get(chart.indicators.add({ type: 'RSI', scale: 'left' }))?.pane;

    expect(chart.priceScale(pane, 'right').range()).toEqual(chart.priceScale(pane, 'left').range());
  });

  it('keeps the right scale on the left one after the left axis is scaled and moved', () => {
    const chart = chartWithBars(200);
    const pane = chart.indicators.get(chart.indicators.add({ type: 'RSI', scale: 'left' }))?.pane;
    const left = chart.priceScale(pane, 'left');
    const right = chart.priceScale(pane, 'right');
    const { leftAxisWidth, panes, plotWidth } = chart.layout();
    const plot = panes.find((each) => each.id === pane)?.plot;
    const middle = (plot?.y ?? 0) + (plot?.height ?? 0) / 2;
    drag(chart, [leftAxisWidth / 2, middle], [leftAxisWidth / 2, middle - 60]);
    const zoomed = left.range();

    expect(left.isAutoScale()).toBe(false);
    expect(right.range()).toEqual(zoomed);

    // Dragging the plot up and down moves the scale that was scaled by hand.
    drag(chart, [leftAxisWidth + 200, middle], [leftAxisWidth + 200, middle + 30]);
    const moved = left.range();
    expect(moved?.min).toBeGreaterThan(zoomed?.min ?? 0);
    expect(moved?.max).toBeGreaterThan(zoomed?.max ?? 0);
    expect(right.range()).toEqual(moved);

    // The right axis shows the left scale, and scaling it scales that one.
    const rightAxisX = leftAxisWidth + plotWidth + 10;
    drag(chart, [rightAxisX, middle], [rightAxisX, middle - 60]);
    expect(left.range()).not.toEqual(moved);
    expect(right.range()).toEqual(left.range());

    chart.element.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: rightAxisX, clientY: middle })
    );
    expect(left.isAutoScale()).toBe(true);
    expect(right.isAutoScale()).toBe(true);
  });

  it('measures a compared symbol against its own first value on a percent scale', () => {
    const chart = chartWithBars(200);
    const at = probe(chart);
    // Another symbol about 30 times the price, moving its own way.
    const other = createBars(200).map((bar, index) => ({
      time: Number(bar.time),
      value: 3000 + Math.sin(index / 7) * 120 + index * 2
    }));
    chart.series.add({ id: 'eth', type: 'probe', data: other });
    chart.priceScale().setMode('percent');
    chart.screenshot();

    const firstIndex = other.findIndex(
      (point) => point.time === chart.timeScale.visibleRange()?.from
    );
    const base = chart.data.at(firstIndex)?.close ?? Number.NaN;
    const own = other[firstIndex]?.value ?? Number.NaN;
    const y = (price: number) => chart.priceScale().priceToY(price) ?? Number.NaN;

    expect(firstIndex).toBeGreaterThan(0);
    // Both start at 0% on the first bar in view…
    expect(at(other[firstIndex]?.time ?? 0)).toBeCloseTo(y(base), 6);

    // …and each moves as many percent as it moves from its own start.
    for (const point of other.slice(firstIndex, firstIndex + 40)) {
      expect(at(point.time)).toBeCloseTo(y(base * (1 + (point.value - own) / own)), 6);
    }

    // Indexed to 100 the same way: both at 100 on the first bar in view.
    chart.priceScale().setMode('indexed');
    chart.screenshot();

    for (const point of other.slice(firstIndex, firstIndex + 40)) {
      expect(at(point.time)).toBeCloseTo(y(base * (point.value / own)), 6);
    }

    // On a regular scale its prices are its own, far above the bars.
    chart.priceScale().setMode('normal');
    chart.screenshot();
    expect(at(other[firstIndex]?.time ?? 0)).toBeCloseTo(y(own), 6);
  });

  it('measures a symbol that starts after the first bar in view against its first value', () => {
    const chart = chartWithBars(200);
    const at = probe(chart);
    chart.priceScale().setMode('percent');
    const from = chart.timeScale.visibleRange()?.from ?? 0;
    const later = createBars(200)
      .map((bar) => ({ time: Number(bar.time), value: bar.close * 50 }))
      .filter((point) => point.time >= from + 10 * MINUTE);
    chart.series.add({ id: 'new', type: 'probe', data: later });
    chart.screenshot();

    const base = chart.data.at(chart.data.indexOf(from))?.close ?? Number.NaN;
    const own = later[0]?.value ?? Number.NaN;
    const y = (price: number) => chart.priceScale().priceToY(price) ?? Number.NaN;

    expect(at(later[0]?.time ?? 0)).toBeCloseTo(y(base), 6);
    expect(at(later[20]?.time ?? 0)).toBeCloseTo(
      y(base * (1 + ((later[20]?.value ?? 0) - own) / own)),
      6
    );
  });

  it('writes the values of a series in its own decimals', () => {
    const chart = chartWithBars(200);
    chart.series.add({
      id: 'doge',
      type: 'line',
      title: 'DOGE',
      precision: 5,
      data: createBars(200).map((bar) => ({ time: bar.time, value: bar.close / 1000 }))
    });
    const texts = () => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };
    const last = (createBars(200).at(-1)?.close ?? 0) / 1000;

    expect(chart.series.get('doge')?.precision).toBe(5);
    expect(texts()).toContain(last.toFixed(5));

    chart.series.update('doge', { precision: null });
    expect(texts()).toContain(last.toFixed(2));
    expect(() => {
      chart.series.update('doge', { precision: 13 });
    }).toThrow('series.precision must be at most 12, received 13.');
  });

  it('labels the latest value of a series on the axis of its scale', () => {
    const chart = chartWithBars(200);
    const cursorTexts = () => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };
    const data = createBars(200).map((bar) => ({ time: bar.time, value: bar.close * 30 }));
    const last = data.at(-1)?.value ?? 0;
    chart.series.add({ id: 'eth', type: 'line', data, precision: 3, lastValueLabel: true });

    // On the right scale in percent, the label is its own change since the first bar in view.
    chart.priceScale().setMode('percent');
    const from = chart.timeScale.visibleRange()?.from ?? 0;
    const own = data.find((point) => point.time === from)?.value ?? 0;
    const percent = `${(((last - own) / own) * 100).toFixed(2)}%`;
    expect(cursorTexts()).toContain(percent);

    // On the left scale, its price in its own decimals, as the legend writes it too.
    chart.priceScale().setMode('normal');
    chart.series.update('eth', { scale: 'left' });
    const price = last.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
    expect(cursorTexts().filter((text) => text === price)).toHaveLength(2);

    chart.series.update('eth', { lastValueLabel: false });
    expect(cursorTexts().filter((text) => text === price)).toHaveLength(1);
  });

  it('moves labels of series apart, around the latest price, where they overlap', () => {
    // Labels 20 pixels tall; the latest price's from 100 to 134, with its countdown.
    const fixed = { top: 100, bottom: 134 };

    // Those clear of each other and of the latest price stay where they are.
    expect(spreadLabels([40, 200], 20, fixed)).toEqual([40, 200]);
    // Over the latest price's: up from it, or down, as they lie above its middle or below.
    expect(spreadLabels([110, 125], 20, fixed)).toEqual([90, 144]);
    // On each other, each past the one before, away from the latest price.
    expect(spreadLabels([95, 92, 140, 141], 20, fixed)).toEqual([90, 70, 144, 164]);
    // Without a latest price, down from the topmost.
    expect(spreadLabels([50, 45, 300], 20, null)).toEqual([65, 45, 300]);
  });

  it('creates no scale for a pointer over an empty left axis or for reading one', () => {
    const chart = chartWithBars(200);
    addExpensive(chart, 'left');
    chart.panes.add({ id: 'empty', height: 150 });
    const { leftAxisWidth, panes } = chart.layout();
    const pane = panes.find((each) => each.id === 'empty');
    const y = (pane?.plot.y ?? 0) + (pane?.plot.height ?? 0) / 2;
    const menus: ChartPointerEvent[] = [];
    chart.on('contextMenu', (event) => menus.push(event));
    pointer(chart, 'pointermove', leftAxisWidth / 2, y, { buttons: 0 });
    chart.element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 100, clientX: leftAxisWidth / 2, clientY: y })
    );
    chart.element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: leftAxisWidth / 2, clientY: y })
    );
    const left = chart.priceScale('empty', 'left');

    expect(menus[0]).toMatchObject({ area: 'price-axis', paneId: 'empty', price: null });
    expect([left.isAutoScale(), left.mode(), left.range(), left.priceToY(1)]).toEqual([
      true,
      'normal',
      null,
      null
    ]);
    expect(chart.saveState().panes.find((each) => each.id === 'empty')?.scales).toEqual([]);
  });

  it('takes margins by one rule, for the chart and for a scale alike', () => {
    const chart = chartWithBars(50, { priceScale: { margins: { top: 0.8, bottom: 0 } } });
    const volume = chart.priceScale('main', 'volume');
    volume.setMargins({ top: 0.8, bottom: 0 });

    expect(chart.options().priceScale.margins).toEqual({ top: 0.8, bottom: 0 });
    expect(volume.margins()).toEqual({ top: 0.8, bottom: 0 });

    for (const margins of [
      { top: 0.5, bottom: 0.45 },
      { top: -0.1, bottom: 0 }
    ]) {
      expect(() => {
        chart.applyOptions({ priceScale: { margins } });
      }).toThrow('options.priceScale.margins');
      expect(() => {
        volume.setMargins(margins);
      }).toThrow('margins');
    }
  });

  it('saves and restores every scale of a pane', () => {
    const chart = chartWithBars(200);
    chart.indicators.add({ id: 'vol', type: 'VOL', pane: 'main', scale: 'volume' });
    chart.priceScale('main', 'volume').setMargins({ top: 0.75, bottom: 0 });
    chart.priceScale('main', 'left').setMode('log');
    const state = chart.saveState();

    expect(state.panes[0]?.scales).toEqual([
      {
        id: 'volume',
        mode: 'normal',
        inverted: false,
        margins: { top: 0.75, bottom: 0 },
        range: null
      },
      { id: 'left', mode: 'log', inverted: false, margins: null, range: null }
    ]);
    expect(state.indicators.find((indicator) => indicator.id === 'vol')?.scale).toBe('volume');

    const restored = chartWithBars(200);
    restored.loadState(state);
    expect(restored.priceScale('main', 'volume').margins()).toEqual({ top: 0.75, bottom: 0 });
    expect(restored.priceScale('main', 'left').mode()).toBe('log');
    expect(restored.indicators.get('vol')?.scale).toBe('volume');
  });
});

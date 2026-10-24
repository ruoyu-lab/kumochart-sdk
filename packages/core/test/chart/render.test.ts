import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { ChartPointerEvent } from '../../src/chart/events';
import type { SeriesType } from '../../src/series/styles';
import type { SeriesPaintContext } from '../../src/series/types';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import {
  chartWithBars,
  click,
  createTestChart,
  drag,
  key,
  nextFrame,
  pointer
} from '../helpers/chart';
import { canvasCalls } from '../setup';

/** Message of bars whose OHLC fields are missing. */
const NOT_A_BAR = /finite number/;

const SERIES_TYPES: SeriesType[] = [
  'candles',
  'hollow-candles',
  'ohlc',
  'high-low',
  'line',
  'step-line',
  'line-markers',
  'area',
  'baseline',
  'hlc-area',
  'columns'
];

function layer(chart: Chart, name: 'scene' | 'objects' | 'cursor'): HTMLCanvasElement {
  const canvas = chart.element.querySelector<HTMLCanvasElement>(`canvas[data-layer="${name}"]`);

  if (!canvas) {
    throw new Error(`Missing ${name} layer.`);
  }

  return canvas;
}

function paint(chart: Chart, name: 'scene' | 'objects' | 'cursor'): string[] {
  const calls = canvasCalls(layer(chart, name));
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return calls.map((call) => call.name);
}

describe('rendering', () => {
  it('leaves out the price ticks under the label of the latest price', () => {
    const chart = createTestChart();
    chart.data.set(
      Array.from({ length: 50 }, (_, index) => ({
        time: T0 + index * MINUTE,
        open: 99,
        high: 101,
        low: 98,
        close: 100
      }))
    );
    chart.priceScale().setRange({ min: 90, max: 110 });
    const ticks = () => {
      const calls = canvasCalls(layer(chart, 'scene'));
      calls.length = 0;
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };

    chart.applyOptions({ latestPrice: { label: false } });
    const all = ticks();
    chart.applyOptions({ latestPrice: { label: true } });
    const shown = ticks();
    const covered = all.filter((text) => !shown.includes(text));

    expect(covered).toEqual(['100.00']);
  });

  it('leaves out the ticks under the labels of the crosshair while it is there', async () => {
    const chart = createTestChart({ latestPrice: { label: false } });
    chart.data.set(createBars(50));
    chart.priceScale().setRange({ min: 100, max: 160 });
    const scene = canvasCalls(layer(chart, 'scene'));
    let cleared = false;
    const texts = () => {
      const painted = scene.filter((call) => call.name === 'fillText');
      cleared = scene.some((call) => call.name === 'clearRect');
      scene.length = 0;
      return painted.map((call) => ({ text: String(call.args[0]), x: Number(call.args[1]) }));
    };
    chart.screenshot();
    const all = texts();
    const y = chart.priceScale().priceToY(130) ?? 0;
    const tick = all.find((each) => each.text === '130.00');
    const timeTick = all.find((each) => /^\d\d:\d\d$/.test(each.text));
    const x = (timeTick?.x ?? 0) + chart.layout().leftAxisWidth;
    pointer(chart, 'pointermove', x, y, { buttons: 0 });
    await nextFrame();
    chart.screenshot();
    const hovered = texts().map((each) => each.text);

    expect(tick).toBeDefined();
    expect(hovered).not.toContain('130.00');
    expect(hovered).not.toContain(timeTick?.text);
    expect(hovered).toContain('140.00');
    // The axes alone paint again, over the series.
    expect(cleared).toBe(false);

    chart.element.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await nextFrame();
    chart.screenshot();
    const left = texts().map((each) => each.text);
    expect(left).toContain('130.00');
    expect(left).toContain(timeTick?.text);
  });

  it.each(SERIES_TYPES)('paints the main series as %s', (type) => {
    const chart = chartWithBars(120);
    chart.applyOptions({ mainSeries: { type } });
    const calls = paint(chart, 'scene');

    expect(calls).toContain('stroke');
    expect(calls.some((name) => name === 'fill' || name === 'stroke')).toBe(true);
    expect(calls).toContain('fillText');
  });

  it('paints indicators, levels and fills', () => {
    const chart = chartWithBars(120);
    chart.indicators.add({ type: 'BOLL' });
    chart.indicators.add({ type: 'RSI' });
    chart.indicators.add({ type: 'MACD' });
    const calls = paint(chart, 'scene');

    expect(calls.filter((name) => name === 'stroke').length).toBeGreaterThan(10);
    expect(calls).toContain('setLineDash');
  });

  it('paints drawings, orders, alerts and markers on the objects layer', () => {
    const chart = chartWithBars(120);
    const bars = createBars(120);
    chart.drawings.add({
      type: 'fib-retracement',
      points: [
        { time: T0, price: bars[0]!.low },
        { time: T0 + 100 * MINUTE, price: bars[100]!.high }
      ]
    });
    chart.orders.set([
      { id: 'o', side: 'buy', price: bars[110]!.close, buttons: [{ id: 'x', icon: 'M6 6L18 18' }] }
    ]);
    chart.alerts.set([{ id: 'a', trigger: 'cross', value: bars[105]!.close, label: 'A' }]);
    chart.markers.set([
      { id: 'm', time: T0 + 110 * MINUTE, position: 'above', shape: 'arrow-down', text: 'S' }
    ]);
    const calls = paint(chart, 'objects');

    expect(calls.filter((name) => name === 'fillText').length).toBeGreaterThan(8);
    expect(calls).toContain('roundRect');
  });

  it('paints what drawings put under the series in the scene, before the series', () => {
    const chart = chartWithBars(120);
    const order: string[] = [];
    // Plugins paint under the series and over them: what the drawing puts below comes between.
    chart.plugins.add({
      name: 'layers',
      paint: ({ layer, pane }) => {
        if (pane.id === 'main') {
          order.push(`plugin ${layer}`);
        }
      }
    });
    chart.drawings.register({
      type: 'band',
      points: 2,
      paintBelow: ({ ctx }) => {
        order.push(`below on ${ctx.canvas.dataset.layer ?? ''}`);
      },
      paint: ({ ctx }) => {
        order.push(`over on ${ctx.canvas.dataset.layer ?? ''}`);
      },
      hitTest: () => null
    });
    const id = chart.drawings.add({
      type: 'band',
      points: [
        { time: T0, price: 100 },
        { time: T0 + 50 * MINUTE, price: 110 }
      ]
    });
    chart.screenshot();

    expect(order).toEqual(['plugin below', 'below on scene', 'plugin above', 'over on objects']);

    // Changing the drawing repaints both parts.
    order.length = 0;
    chart.drawings.update(id, {
      points: [
        { time: T0, price: 101 },
        { time: T0 + MINUTE, price: 111 }
      ]
    });
    chart.screenshot();
    expect(order).toContain('below on scene');
    expect(order).toContain('over on objects');

    expect(() => {
      chart.drawings.register({
        type: 'broken',
        points: 1,
        paintBelow: 1,
        paint: () => undefined,
        hitTest: () => null
      } as never);
    }).toThrow('definition.paintBelow must be a function');
  });

  it('paints the crosshair, legends and countdown on the cursor layer', async () => {
    const chart = chartWithBars(120, { latestPrice: { countdown: true } });
    pointer(chart, 'pointermove', 300, 200, { buttons: 0 });
    await nextFrame();
    const calls = paint(chart, 'cursor');

    expect(calls.filter((name) => name === 'fillText').length).toBeGreaterThan(6);
  });

  it('paints the latest price in its own color when one is set', () => {
    const colors = (chart: ReturnType<typeof chartWithBars>, layer: 'scene' | 'cursor') => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>(
        `canvas[data-layer="${layer}"]`
      );
      const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D;
      const seen: unknown[] = [];
      ctx.stroke = () => {
        seen.push(ctx.strokeStyle);
      };
      ctx.fill = () => {
        seen.push(ctx.fillStyle);
      };
      chart.applyOptions({});
      chart.screenshot();
      return seen;
    };
    const chart = chartWithBars(120);
    const { up, down } = chart.options().theme;
    expect([...colors(chart, 'scene'), ...colors(chart, 'cursor')]).not.toContain('#ff00aa');

    chart.applyOptions({ latestPrice: { color: '#ff00aa' } });
    expect(colors(chart, 'scene')).toContain('#ff00aa');
    expect(colors(chart, 'cursor')).toContain('#ff00aa');

    chart.applyOptions({ latestPrice: { color: null } });
    expect(colors(chart, 'cursor').some((color) => color === up || color === down)).toBe(true);

    // Left to the bars, it takes the colors the main series gives them.
    chart.applyOptions({
      mainSeries: { styles: { candles: { upColor: '#00aaff', downColor: '#00aaff' } } }
    });
    expect(colors(chart, 'scene')).toContain('#00aaff');
    expect(colors(chart, 'cursor')).toContain('#00aaff');
    expect(() => {
      chart.applyOptions({ latestPrice: { color: 3 as never } });
    }).toThrow('latestPrice.color');
  });

  it('counts down the bar of the timeframe, and not while replaying', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0 + 119.5 * MINUTE);
    const chart = chartWithBars(120, { latestPrice: { countdown: true } });
    chart.data.set(createBars(120), { interval: '1m' });
    const texts = () => paint(chart, 'cursor').filter((name) => name === 'fillText').length;
    const live = texts();

    chart.replay.start(T0 + 100 * MINUTE);
    expect(texts()).toBe(live - 1);

    chart.replay.stop();
    expect(texts()).toBe(live);
    vi.restoreAllMocks();
  });

  it('writes the days of the countdown with the chart texts', () => {
    const DAY = 86_400_000;
    const chart = createTestChart({
      calendar: { timeZone: 'UTC' },
      latestPrice: { countdown: true },
      texts: { days: (count) => `${count}天` }
    });
    chart.data.set(createBars(60, Date.UTC(2024, 0, 1), DAY), { interval: '1D' });
    chart.data.setTimeframe('1W');
    const last = chart.data.last()?.time ?? Number.NaN;
    vi.spyOn(Date, 'now').mockReturnValue(last + 3_600_000);
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
    const calls = canvas ? canvasCalls(canvas) : [];
    calls.length = 0;
    chart.screenshot();

    expect(calls.map((call) => call.args[0])).toContain('6天 23:00:00');
    vi.restoreAllMocks();
  });

  it('counts down to the end of the trading day, week or month the calendar gives the bar', () => {
    const HOUR = 3_600_000;
    // Forex: days end at 17:00 New York time, though dated at midnight.
    const chart = createTestChart({
      calendar: { timeZone: 'America/New_York', dayStart: '17:00', weekdays: [1, 2, 3, 4, 5] },
      latestPrice: { countdown: true }
    });
    // Hours from Sunday 25 October 2026, 17:00 in New York (21:00 UTC in daylight saving time),
    // across the change to standard time on 1 November, to Friday 6 November, 10:00 there.
    chart.data.set(createBars(283, Date.UTC(2026, 9, 25, 21), HOUR), { interval: '1h' });
    const countdown = (timeframe: string, now: number) => {
      chart.data.setTimeframe(timeframe);
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      vi.restoreAllMocks();
      return calls.map((call) => call.args[0]).filter((text) => /\d:\d\d:\d\d$/.test(String(text)));
    };
    // Friday 6 November at 10:00 in New York: the day, and the week, end at 17:00.
    const friday = Date.UTC(2026, 10, 6, 15);
    expect(countdown('1D', friday)).toEqual(['7:00:00']);
    expect(countdown('1W', friday)).toEqual(['7:00:00']);
    // November ends on Monday 30 at 17:00 in New York.
    expect(countdown('1M', friday)).toEqual(['24d 07:00:00']);
    chart.destroy();
  });
});

describe('series', () => {
  it('adds a comparison series in its own pane and removes the pane with it', () => {
    const chart = chartWithBars(120);
    const id = chart.series.add({
      type: 'line',
      pane: 'new',
      title: 'BTC',
      data: createBars(120).map((bar) => ({ time: bar.time, value: bar.close * 2 }))
    });

    expect(chart.panes.list()).toHaveLength(2);
    expect(chart.series.get(id)).toMatchObject({ type: 'line', title: 'BTC' });
    expect(paint(chart, 'scene')).toContain('stroke');

    chart.series.updateData(id, { time: T0 + 120 * MINUTE, value: 1 });
    expect(() => {
      chart.series.updateData(id, { time: T0, value: 1 });
    }).toThrow('older than the last point');

    chart.series.remove(id);
    expect(chart.panes.list()).toHaveLength(1);
  });

  it('rejects value points for OHLC series and unknown types', () => {
    const chart = chartWithBars(10);

    expect(() => chart.series.add({ type: 'candles', data: [{ time: T0, value: 1 }] })).toThrow(
      NOT_A_BAR
    );
    expect(() => chart.series.add({ type: 'renko' })).toThrow('Unknown series type "renko"');
  });

  it('draws volume candles as wide as their share of the most volume in view', () => {
    const chart = createTestChart();
    chart.data.set(
      createBars(4).map((bar, index) => ({ ...bar, volume: [100, 400, 200, 0][index] ?? 0 }))
    );
    chart.applyOptions({ mainSeries: { type: 'volume-candles' }, timeScale: { barSpacing: 50 } });
    const calls = canvasCalls(layer(chart, 'scene'));
    calls.length = 0;
    chart.screenshot();
    // The bodies are the rectangles as wide as a share of 50 * 0.72 = 36 pixels.
    const widths = calls
      .filter((call) => call.name === 'rect' && Number(call.args[2]) < 100)
      .map((call) => Number(call.args[2]));

    expect([...widths].sort((a, b) => a - b)).toEqual([1, 9, 18, 36]);
  });

  it('draws columns from the bottom of a logarithmic pane, where zero is not', () => {
    const chart = chartWithBars(30);
    const id = chart.series.add({
      type: 'columns',
      pane: 'new',
      data: createBars(30).map((bar, index) => ({ time: bar.time, value: 10 + index }))
    });
    chart.priceScale(chart.series.get(id)?.pane, 'right').setMode('log');
    const plot = chart.layout().panes[1]?.plot;
    const calls = canvasCalls(layer(chart, 'scene'));
    calls.length = 0;
    chart.screenshot();
    const columns = calls.filter(
      (call) => call.name === 'fillRect' && Number(call.args[2]) < chart.layout().plotWidth
    );

    expect(columns).toHaveLength(30);
    columns.forEach((call) => {
      expect(Number(call.args[1]) + Number(call.args[3])).toBeCloseTo(plot?.height ?? 0);
    });
  });

  it('accepts custom series types', () => {
    const chart = chartWithBars(30);
    const paintSpy = vi.fn(
      (context: SeriesPaintContext<{ color: string }>) => context.points.count
    );
    chart.series.register({
      type: 'dots',
      input: 'value',
      defaultStyle: (_theme, color) => ({ color }),
      paint: paintSpy
    });
    chart.series.add({
      type: 'dots',
      data: createBars(30).map((bar) => ({ time: bar.time, value: bar.close }))
    });
    chart.screenshot();

    expect(paintSpy).toHaveBeenCalled();
    expect(paintSpy.mock.results[0]?.value).toBeGreaterThan(0);
  });
});

describe('pointer behavior', () => {
  it('reports clicks on markers', () => {
    const chart = chartWithBars(120);
    chart.markers.set([
      { id: 'm', time: T0 + 110 * MINUTE, position: 'price', price: 160, shape: 'circle' }
    ]);
    const clicks = vi.fn();
    chart.on('click', clicks);
    const x = chart.timeScale.timeToX(T0 + 110 * MINUTE) ?? 0;
    const y = chart.priceScale().priceToY(160) ?? 0;
    click(chart, x, y);

    expect(clicks.mock.calls[0]?.[0]).toMatchObject({ target: { kind: 'marker', id: 'm' } });
    expect(chart.selection()).toEqual({ kind: 'marker', id: 'm' });
  });

  it('drags an alert level and keeps it', () => {
    const chart = chartWithBars(120, { priceScale: { precision: 2 } });
    chart.alerts.set([{ id: 'a', trigger: 'cross', value: 160 }]);
    const drags = vi.fn();
    chart.on('alertDrag', drags);
    const y = chart.priceScale().priceToY(160) ?? 0;
    drag(chart, [200, y], [200, y + 40]);

    expect(chart.alerts.get('a')?.value).toBeLessThan(160);
    expect(drags.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'a', phase: 'end', bound: null });
  });

  it('drags an alert on tiny values, as of a cheap coin heavily traded, to values of their size', () => {
    const chart = createTestChart();
    chart.data.set(
      Array.from({ length: 120 }, (_, index) => {
        const price = 0.0001 * (1 + 0.1 * Math.sin(index / 5));
        return {
          time: T0 + index * MINUTE,
          open: price,
          high: price * 1.01,
          low: price * 0.99,
          close: price,
          volume: 1e9
        };
      })
    );
    const emv = chart.indicators.add({ type: 'EMV' });
    const pane = chart.indicators.get(emv)?.pane ?? '';
    const plot = chart.layout().panes.find((each) => each.id === pane)?.plot;
    const scale = chart.priceScale(pane);
    const top = (plot?.y ?? 0) + (plot?.height ?? 0) / 3;
    const value = scale.yToPrice(top) ?? 0;
    chart.alerts.set([
      { id: 'a', source: { kind: 'indicator', id: emv, key: 'eom' }, trigger: 'cross', value }
    ]);
    drag(chart, [200, scale.priceToY(value) ?? 0], [200, (scale.priceToY(value) ?? 0) + 10]);
    const dragged = chart.alerts.get('a')?.value as number;

    expect(Math.abs(value)).toBeLessThan(1e-6);
    expect(dragged).not.toBe(0);
    expect(dragged).toBeLessThan(value);
    expect(Math.abs(dragged - (scale.yToPrice(top + 10) ?? 0))).toBeLessThan(
      Math.abs(value - (scale.yToPrice(top + 1) ?? 0))
    );
  });

  it('draws a line at each bound of a channel that is a number, and drags each', () => {
    const chart = chartWithBars(120, { priceScale: { precision: 2 } });
    chart.drawings.add({
      id: 'top',
      type: 'horizontal-line',
      points: [{ time: T0, price: 160 }]
    });
    chart.alerts.set([
      { id: 'band', trigger: 'enter-channel', value: [155, 140] },
      // A bound that is a drawing's line is the drawing's: only the number has a line.
      { id: 'mixed', trigger: 'exit-channel', value: [125, { kind: 'drawing', id: 'top' }] }
    ]);
    const drags = vi.fn();
    const clicks = vi.fn();
    chart.on('alertDrag', drags);
    chart.on('click', clicks);
    const y = (price: number) => chart.priceScale().priceToY(price) ?? 0;
    click(chart, 200, y(140));
    click(chart, 200, y(125));

    expect(clicks.mock.calls.map(([event]) => (event as ChartPointerEvent).target)).toEqual([
      { kind: 'alert', id: 'band', part: 'line:1' },
      { kind: 'alert', id: 'mixed', part: 'line:0' }
    ]);

    drag(chart, [200, y(155)], [200, y(155) - 20]);
    const [upper, lower] = chart.alerts.get('band')?.value as [number, number];

    expect(upper).toBeGreaterThan(155);
    expect(lower).toBe(140);
    expect(drags.mock.calls.at(-1)?.[0]).toEqual({
      id: 'band',
      phase: 'end',
      price: upper,
      initialPrice: 155,
      bound: 0
    });
  });

  it('draws the bounds of an indicator channel in the indicator pane', () => {
    const chart = chartWithBars(120, { priceScale: { precision: 2 } });
    const rsi = chart.indicators.add({ type: 'RSI' });
    const pane = chart.indicators.get(rsi)?.pane ?? '';
    chart.alerts.set([
      {
        id: 'rsi',
        source: { kind: 'indicator', id: rsi, key: 'rsi' },
        trigger: 'inside-channel',
        value: [30, 70]
      }
    ]);
    const clicks = vi.fn();
    chart.on('click', clicks);
    click(chart, 200, chart.priceScale(pane).priceToY(70) ?? 0);

    expect(clicks.mock.calls[0]?.[0]).toMatchObject({
      target: { kind: 'alert', id: 'rsi', part: 'line:1' }
    });
  });

  it('shows a resize cursor over axes and a pointer over objects', async () => {
    const chart = chartWithBars(120);
    chart.orders.set([{ id: 'o', side: 'buy', price: 160 }]);
    const y = chart.priceScale().priceToY(160) ?? 0;
    pointer(chart, 'pointermove', 200, y, { buttons: 0 });
    await nextFrame();
    expect(chart.element.style.cursor).toBe('ns-resize');

    pointer(chart, 'pointermove', chart.layout().plotWidth + 10, 100, { buttons: 0 });
    await nextFrame();
    expect(chart.element.style.cursor).toBe('ns-resize');

    pointer(chart, 'pointermove', 200, 20, { buttons: 0 });
    await nextFrame();
    expect(chart.element.style.cursor).toBe('crosshair');
  });

  it('zooms with the wheel and scrolls horizontally with a trackpad', async () => {
    const chart = chartWithBars(400);
    const spacing = chart.timeScale.barSpacing();
    chart.element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -200, clientX: 300, clientY: 200, cancelable: true })
    );
    await nextFrame();
    expect(chart.timeScale.barSpacing()).toBeGreaterThan(spacing);

    const from = chart.timeScale.visibleLogicalRange()?.from ?? 0;
    chart.element.dispatchEvent(
      new WheelEvent('wheel', { deltaX: -300, clientX: 300, clientY: 200, cancelable: true })
    );
    await nextFrame();
    expect(chart.timeScale.visibleLogicalRange()?.from).toBeLessThan(from);
  });

  it('zooms keeping the latest bar put while following it, else where it zooms from', async () => {
    const wheel = (chart: Chart, x: number) => {
      chart.element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -200, clientX: x, clientY: 200, cancelable: true })
      );
    };
    /** How far a zoom moves the bar at chart x `at`. */
    const shift = async (chart: Chart, at: number, zoom: () => void | Promise<void>) => {
      const index = chart.timeScale.xToIndex(at) ?? Number.NaN;
      const before = chart.timeScale.indexToX(index) ?? Number.NaN;
      await zoom();
      await nextFrame();
      return Math.abs((chart.timeScale.indexToX(index) ?? Number.NaN) - before);
    };
    const following = chartWithBars(400);
    const latest = following.timeScale.indexToX(399) ?? 0;
    const width = following.layout().plotWidth;
    const middle = width / 2;

    // Following the latest bar: it stays put, whatever zooms.
    expect(
      await shift(following, latest, () => {
        wheel(following, 300);
      })
    ).toBeLessThan(1);
    expect(
      await shift(following, latest, () => {
        key(following, 'ArrowUp');
      })
    ).toBeLessThan(1);
    expect(
      await shift(following, latest, () => {
        following.timeScale.zoomIn();
      })
    ).toBeLessThan(1);
    expect(following.timeScale.isFollowing()).toBe(true);

    // In the history: the wheel at the pointer, the keys and the API in the middle.
    const history = chartWithBars(400);
    history.timeScale.scrollToIndex(100, 'center');
    expect(history.timeScale.isFollowing()).toBe(false);
    expect(
      await shift(history, 300, () => {
        wheel(history, 300);
      })
    ).toBeLessThan(1);
    expect(
      await shift(history, middle, () => {
        key(history, 'ArrowDown');
      })
    ).toBeLessThan(1);
    expect(
      await shift(history, middle, () => {
        history.timeScale.zoomOut();
      })
    ).toBeLessThan(1);
    // Dragging the time axis, where it was pressed.
    const axis = history.layout().timeAxis;
    const y = (axis?.y ?? 0) + (axis?.height ?? 0) / 2;
    expect(
      await shift(history, 200, () => {
        drag(history, [200, y], [260, y]);
      })
    ).toBeLessThan(1);
    expect(() =>
      chartWithBars(10, { interaction: { wheelZoomAnchor: 'pointer' } as never })
    ).toThrow('wheelZoomAnchor');
  });
});

describe('resetting the time scale', () => {
  it('goes back alike by a double click on the time axis and by the API', () => {
    const viewAfter = (reset: (chart: Chart) => void) => {
      const chart = chartWithBars(400);
      chart.timeScale.scrollToIndex(100, 'center');
      chart.timeScale.setBarSpacing(20);
      reset(chart);
      return [chart.timeScale.barSpacing(), chart.timeScale.visibleLogicalRange()];
    };
    const byApi = viewAfter((chart) => {
      chart.timeScale.reset();
    });
    const byAxis = viewAfter((chart) => {
      const axis = chart.layout().timeAxis;
      chart.element.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          clientX: 300,
          clientY: (axis?.y ?? 0) + (axis?.height ?? 0) / 2
        })
      );
    });

    expect(byAxis).toEqual(byApi);
    expect(byApi[0]).toBe(8);
  });
});

describe('the countdown', () => {
  /** Texts painted on the cursor layer when it next repaints. */
  function cursorTexts(chart: Chart): () => string[] {
    const calls = canvasCalls(layer(chart, 'cursor'));
    calls.length = 0;
    return () =>
      calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
  }

  /** Timers, frames and the clock of the test, from `now`. */
  function clockAt(now: number): void {
    vi.useFakeTimers({
      now,
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame'
      ]
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('widens the price axis to its label', () => {
    clockAt(T0 + 30_000);
    const chart = createTestChart({ latestPrice: { countdown: true } });
    chart.data.set(createBars(1, T0, 7 * 86_400_000), { interval: '1W' });

    // "6d 23:59:30", 6 pixels a character, between the padding of the axis.
    expect(chart.layout().axisWidth).toBeGreaterThanOrEqual(11 * 6 + 20);
  });

  it('ticks every second, also with a single bar', () => {
    clockAt(T0 + 10_000);
    const chart = createTestChart({ latestPrice: { countdown: true } });
    chart.data.set(createBars(1), { interval: '1m' });
    chart.screenshot();
    const texts = cursorTexts(chart);
    vi.advanceTimersByTime(1100);

    expect(texts()).toContain('00:49');
  });

  it('leaves the cursor alone where it shows nothing: replaying, or for bricks', () => {
    clockAt(T0 + 199.5 * MINUTE);
    const chart = chartWithBars(200, { latestPrice: { countdown: true } });
    chart.replay.start(T0 + 100 * MINUTE);
    chart.screenshot();
    const replaying = cursorTexts(chart);
    vi.advanceTimersByTime(3000);

    expect(replaying()).toEqual([]);

    chart.replay.stop();
    chart.transforms.set({ type: 'renko', params: { box: 1 } });
    chart.screenshot();
    const bricks = cursorTexts(chart);
    vi.advanceTimersByTime(3000);

    expect(bricks()).toEqual([]);
  });

  it('shows nothing once the latest bar has closed, as when the market is closed', () => {
    clockAt(T0 + 199.5 * MINUTE);
    const chart = chartWithBars(200, { latestPrice: { countdown: true } });
    chart.screenshot();
    const counting = cursorTexts(chart);
    vi.advanceTimersByTime(1100);

    expect(counting()).toContain('00:29');

    vi.advanceTimersByTime(30_000);
    const closed = cursorTexts(chart);
    chart.applyOptions({});
    chart.screenshot();
    expect(closed().some((text) => /^\d\d:\d\d$/.test(text))).toBe(false);

    const idle = cursorTexts(chart);
    vi.advanceTimersByTime(3000);
    expect(idle()).toEqual([]);
  });
});

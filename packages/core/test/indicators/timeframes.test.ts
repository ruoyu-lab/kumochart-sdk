import { describe, expect, it, vi } from 'vitest';
import { MarketData } from '../../src/chart/market-data';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, BarInput, BarsView } from '../../src/data/types';
import { parseInterval } from '../../src/feed/interval';
import { IndicatorBases } from '../../src/indicators/basis';
import { computeIndicator, createIndicatorCalculator } from '../../src/indicators/headless';
import { checkIndicatorInput } from '../../src/indicators/input';
import type { ParamValues } from '../../src/indicators/types';
import { createDefaultOptions } from '../../src/options/defaults';
import { createSeriesRegistry } from '../../src/series/built-in';
import { SeriesStore } from '../../src/series/series-store';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createTestChart, type Chart, type TestChartOptions } from '../helpers/chart';
import { canvasCalls } from '../setup';
import { definitionOf, expectClose } from './helpers';

const HOUR = 60 * MINUTE;

/** Every bar of a view. */
function barsOf(view: BarsView): Bar[] {
  return Array.from({ length: view.length }, (_, index) => view.bar(index) as Bar);
}

/** Bars of `frame` merged from `bars` with the chart's trading calendar. */
function frameBars(chart: Chart, bars: readonly Bar[], frame: string): Bar[] {
  const calendar = chart.data.calendar();
  const merged: Bar[] = [];

  for (const bar of bars) {
    const time = calendar.bucket(bar.time, frame);
    const last = merged[merged.length - 1];

    if (time === null) {
      continue;
    }

    if (last?.time === time) {
      merged[merged.length - 1] = {
        ...last,
        high: Math.max(last.high, bar.high),
        low: Math.min(last.low, bar.low),
        close: bar.close,
        volume: last.volume + bar.volume
      };
    } else {
      merged.push({ ...bar, time });
    }
  }

  return merged;
}

/**
 * What each displayed bar shows of `values`, one a bar of the timeframe: the value of the latest
 * one closed by its end, the next displayed bar's time, as the next one has started by then; the
 * latest displayed bar shows the latest value.
 */
function shown(displayed: readonly number[], starts: readonly number[], values: readonly number[]) {
  return displayed.map((_time, index) => {
    if (index === displayed.length - 1) {
      return values[values.length - 1] ?? Number.NaN;
    }

    const end = displayed[index + 1] ?? Number.NaN;
    let closed = -1;

    starts.forEach((start, bar) => {
      if (bar > 0 && start <= end) {
        closed = bar - 1;
      }
    });

    return closed < 0 ? Number.NaN : (values[closed] ?? Number.NaN);
  });
}

/** The values of `type` on bars of `frame` built from the chart's source bars, as displayed. */
function expected(
  chart: Chart,
  frame: string,
  type: string,
  params: ParamValues,
  key: string
): number[] {
  const bars = frameBars(chart, barsOf(chart.data.source), frame);
  const values =
    computeIndicator(definitionOf(type), bars, {
      params,
      calendar: chart.data.calendar(),
      interval: frame
    })[key] ?? [];
  return shown(
    barsOf(chart.data.bars).map((bar) => bar.time),
    bars.map((bar) => bar.time),
    values
  );
}

/** The values of `type` computed on the displayed bars, as without a timeframe. */
function plain(chart: Chart, type: string, params: ParamValues, key: string): number[] {
  return computeIndicator(definitionOf(type), chart.data.toArray(), { params })[key] ?? [];
}

/** Values of one output of an indicator at every displayed bar. */
function values(chart: Chart, id: string, key: string): number[] {
  return Array.from({ length: chart.data.length }, (_, index) => {
    const value = chart.indicators.valuesAt(id, index).find((item) => item.key === key)?.value;
    return value ?? Number.NaN;
  });
}

/** A chart of `count` five-minute bars from `start`, 09:30 UTC by default. */
function fiveMinutes(count = 120, start = T0, options?: TestChartOptions) {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' }, ...options });
  const bars = createBars(count, start, 5 * MINUTE);
  chart.data.set(bars, { interval: '5m' });
  return { chart, bars };
}

const MA3 = { periods: [3] };

describe('indicators of a timeframe of their own', () => {
  it('compute on bars of the timeframe, and show each the latest closed by the end of a bar', () => {
    const { chart } = fiveMinutes();
    const id = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    const actual = values(chart, id, 'ma3');

    expectClose(actual, expected(chart, '1h', 'MA', MA3, 'ma3'));

    // The 10:55 bar is the last of the 10:00 hour, which it shows; the bar before it shows 09:00.
    const hours = frameBars(chart, barsOf(chart.data.source), '1h');
    const averages = computeIndicator(definitionOf('MA'), hours, { params: MA3 }).ma3 ?? [];
    const at = (time: number) => actual[chart.data.indexOf(time)] ?? Number.NaN;
    const hour = (time: number) => averages[hours.findIndex((bar) => bar.time === time)];
    expect(at(Date.UTC(2024, 0, 2, 13, 55))).toBeCloseTo(hour(Date.UTC(2024, 0, 2, 13)) ?? 0, 9);
    expect(at(Date.UTC(2024, 0, 2, 13, 50))).toBeCloseTo(hour(Date.UTC(2024, 0, 2, 12)) ?? 0, 9);
    expect(at(Date.UTC(2024, 0, 2, 13, 0))).toBeCloseTo(hour(Date.UTC(2024, 0, 2, 12)) ?? 0, 9);
    expect(chart.indicators.get(id)?.timeframe).toBe('1h');
  });

  it('show the bar still forming on the latest bar, live, as updates and trades come', () => {
    const { chart, bars } = fiveMinutes(60);
    const id = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    const check = () => {
      expectClose(values(chart, id, 'ma3'), expected(chart, '1h', 'MA', MA3, 'ma3'));
    };
    check();
    const latest = bars[bars.length - 1] as BarInput & { time: number };

    chart.data.update({ ...latest, high: latest.high + 20, close: latest.high + 20 });
    check();

    // Bars after it, in the same hour and into the next ones, a few ticks each.
    for (let index = 0; index < 30; index += 1) {
      const [bar] = createBars(1, latest.time + (index + 1) * 5 * MINUTE);
      const next = bar as BarInput;
      chart.data.update({ ...next, close: next.low, open: next.low });
      check();
      chart.data.update(next);
      check();
    }

    const time = latest.time + 31 * 5 * MINUTE;
    chart.data.addTrades([
      { time, price: 300, size: 1 },
      { time: time + MINUTE, price: 320, size: 2 }
    ]);
    check();
    chart.data.addTrades({ time: time + 5 * MINUTE, price: 250, size: 1 });
    check();
  });

  it('follow the time where the periods do not nest, as 5 minutes on 3-minute bars', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(createBars(97), { interval: '1m' });
    chart.data.setTimeframe('3m');
    const id = chart.indicators.add({ type: 'EMA', params: { periods: [4] }, timeframe: '5m' });

    expectClose(values(chart, id, 'ema4'), expected(chart, '5m', 'EMA', { periods: [4] }, 'ema4'));

    chart.data.update(createBars(1, T0 + 97 * MINUTE));
    expectClose(values(chart, id, 'ema4'), expected(chart, '5m', 'EMA', { periods: [4] }, 'ema4'));
  });

  it('follow gaps and sessions: a bar is closed once the one after it has started', () => {
    const sessions = ['09:30-12:00', '13:00-16:00'];
    const chart = createTestChart({ calendar: { timeZone: 'UTC', sessions } });
    const day = (date: number, from: number, to: number) =>
      createBars((to - from) / 5, Date.UTC(2024, 0, date) + from * MINUTE, 5 * MINUTE);
    chart.data.set(
      [
        ...day(2, 570, 720),
        ...day(2, 780, 960),
        // A gap within the session: no bars from 10:00 to 11:15.
        ...day(3, 570, 600),
        ...day(3, 675, 720),
        ...day(3, 780, 960)
      ],
      { interval: '5m' }
    );
    const id = chart.indicators.add({ type: 'MA', params: { periods: [2] }, timeframe: '1h' });

    expectClose(values(chart, id, 'ma2'), expected(chart, '1h', 'MA', { periods: [2] }, 'ma2'));

    // The last bar of the day shows its last hour, closed once the next day started.
    const close = chart.data.indexOf(Date.UTC(2024, 0, 2, 15, 55));
    const hours = frameBars(chart, barsOf(chart.data.source), '1h');
    const averages = computeIndicator(definitionOf('MA'), hours, { params: { periods: [2] } });
    const last = hours.findIndex((bar) => bar.time === Date.UTC(2024, 0, 2, 15));
    expect(values(chart, id, 'ma2')[close]).toBeCloseTo(averages.ma2?.[last] ?? 0, 9);
  });

  it('compute weeks on days, a week nominally longer', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(createBars(60, Date.UTC(2024, 0, 1), 24 * HOUR), { interval: '1D' });
    const id = chart.indicators.add({ type: 'MA', params: { periods: [2] }, timeframe: '1W' });

    expectClose(values(chart, id, 'ma2'), expected(chart, '1W', 'MA', { periods: [2] }, 'ma2'));
  });

  it('are computed on the displayed bars while those cannot show the timeframe, and back', () => {
    const { chart } = fiveMinutes(300);
    const id = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    const own = () => expected(chart, '1h', 'MA', MA3, 'ma3');

    chart.data.setTimeframe('1h');
    expectClose(values(chart, id, 'ma3'), plain(chart, 'MA', MA3, 'ma3'));
    chart.data.setTimeframe('1D');
    expectClose(values(chart, id, 'ma3'), plain(chart, 'MA', MA3, 'ma3'));
    chart.data.setTimeframe('15m');
    expectClose(values(chart, id, 'ma3'), own());

    // Bricks give up time; candles a transform builds bar for bar keep it.
    chart.transforms.set({ type: 'renko', params: { box: 2 } });
    expectClose(values(chart, id, 'ma3'), plain(chart, 'MA', MA3, 'ma3'));
    chart.transforms.set({ type: 'heikin-ashi' });
    expectClose(values(chart, id, 'ma3'), own());
    chart.transforms.set(null);
    expectClose(values(chart, id, 'ma3'), own());
  });

  it('are computed on the displayed bars in a timeframe their source cannot build', () => {
    const { chart } = fiveMinutes();
    const odd = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '7m' });
    expectClose(values(chart, odd, 'ma3'), plain(chart, 'MA', MA3, 'ma3'));

    const untimed = createTestChart();
    untimed.data.set(createBars(50));
    const id = untimed.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    expectClose(values(untimed, id, 'ma3'), plain(untimed, 'MA', MA3, 'ma3'));
    expect(untimed.indicators.get(id)?.timeframe).toBe('1h');
  });

  it('shift outputs by bars of the timeframe, past the latest bar too', () => {
    // Twenty whole hours, twelve bars each.
    const { chart } = fiveMinutes(240, T0 - 30 * MINUTE);
    const params = { jaw: 3, teeth: 2, lips: 2, jawShift: 2, teethShift: 1, lipsShift: 1 };
    const id = chart.indicators.add({ type: 'ALLIGATOR', params, timeframe: '1h' });
    const hours = frameBars(chart, barsOf(chart.data.source), '1h');
    const computed = computeIndicator(definitionOf('ALLIGATOR'), hours, { params }).jaw ?? [];
    // The value computed on an hour is drawn two hours later.
    const drawn = hours.map((_bar, index) => computed[index - 2] ?? Number.NaN);
    const jaw = (index: number) =>
      chart.indicators.valuesAt(id, index).find((item) => item.key === 'jaw')?.value ?? Number.NaN;
    const latest = chart.data.length - 1;

    expectClose(
      Array.from({ length: chart.data.length }, (_, index) => jaw(index)),
      shown(
        barsOf(chart.data.bars).map((bar) => bar.time),
        hours.map((bar) => bar.time),
        drawn
      )
    );
    // Twelve bars an hour: the value of the latest hour shows two hours after it.
    expect(jaw(latest + 24)).toBeCloseTo(computed[computed.length - 1] ?? 0, 9);
    expect(jaw(latest + 12)).toBeCloseTo(computed[computed.length - 2] ?? 0, 9);
    expect(jaw(latest + 25)).toBeNaN();
  });

  it('read an indicator in its timeframe, and no other', () => {
    const { chart } = fiveMinutes(240);
    const rsi = chart.indicators.add({ type: 'RSI', params: { period: 4 }, timeframe: '1h' });
    const ma = chart.indicators.add({
      type: 'MA',
      params: MA3,
      source: { kind: 'indicator', id: rsi }
    });
    const reference = () => {
      const hours = frameBars(
        chart,
        barsOf(chart.data.source),
        chart.indicators.get(rsi)?.timeframe ?? ''
      );
      const strength = computeIndicator(definitionOf('RSI'), hours, { params: { period: 4 } }).rsi;
      const average = createIndicatorCalculator(definitionOf('MA'), { params: MA3 });
      const averaged = hours.map(
        (bar, index) => average.nextOf(bar, strength?.[index] ?? 0)[0] ?? 0
      );
      return shown(
        barsOf(chart.data.bars).map((bar) => bar.time),
        hours.map((bar) => bar.time),
        averaged
      );
    };

    expect(chart.indicators.get(ma)?.timeframe).toBe('1h');
    expectClose(values(chart, ma, 'ma3'), reference());

    expect(() =>
      chart.indicators.add({
        type: 'MA',
        source: { kind: 'indicator', id: rsi },
        timeframe: '4h'
      })
    ).toThrow(
      'indicator.timeframe must be "1h", the timeframe of the indicator "rsi-1" it reads, received "4h".'
    );
    expect(() => {
      chart.indicators.update(ma, { timeframe: null });
    }).toThrow('indicator.timeframe must be "1h"');
    chart.indicators.update(ma, { timeframe: '1h' });

    // It follows the one it reads.
    chart.indicators.update(rsi, { timeframe: '4h' });
    expect(chart.indicators.get(ma)?.timeframe).toBe('4h');
    expectClose(values(chart, ma, 'ma3'), reference());
  });

  it('are watched by alerts on the displayed bars', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const flat = (time: number, close: number): BarInput => ({
      time,
      open: close,
      high: close,
      low: close,
      close
    });
    // Three hours at 100, then a 5-minute bar at 100.
    chart.data.set(
      Array.from({ length: 37 }, (_, index) => flat(T0 + index * 5 * MINUTE, 100)),
      { interval: '5m' }
    );
    const ma = chart.indicators.add({ type: 'MA', params: { periods: [2] }, timeframe: '1h' });
    const triggers = vi.fn();
    chart.on('alertTrigger', triggers);
    chart.alerts.add({
      source: { kind: 'indicator', id: ma, key: 'ma2' },
      trigger: 'cross-up',
      value: 105
    });
    const last = T0 + 36 * 5 * MINUTE;

    // The bar rises to 108: the hour's close too, but its average with the hour before not.
    chart.data.update(flat(last, 108));
    expect(triggers).not.toHaveBeenCalled();
    chart.data.update(flat(last, 112));
    expect(triggers).toHaveBeenCalledWith(expect.objectContaining({ value: 106 }));
  });

  it('are kept by the saved state', () => {
    const { chart, bars } = fiveMinutes();
    const rsi = chart.indicators.add({ type: 'RSI', timeframe: '1h' });
    chart.indicators.add({ type: 'MA', source: { kind: 'indicator', id: rsi } });
    chart.indicators.add({ type: 'EMA' });
    const state = chart.saveState();

    expect(state.indicators.map((indicator) => indicator.timeframe)).toEqual([
      '1h',
      '1h',
      undefined
    ]);

    const target = createTestChart({ calendar: { timeZone: 'UTC' } });
    target.data.set(bars, { interval: '5m' });
    target.loadState(state);
    expect(target.indicators.list().map((indicator) => indicator.timeframe)).toEqual([
      '1h',
      '1h',
      null
    ]);
    expectClose(values(target, rsi, 'rsi'), values(chart, rsi, 'rsi'));
    expect(target.saveState()).toEqual(state);
  });

  it('show no more than a replay revealed, as it moves on and back', () => {
    const { chart } = fiveMinutes(200);
    const id = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    const check = () => {
      expectClose(values(chart, id, 'ma3'), expected(chart, '1h', 'MA', MA3, 'ma3'));
    };

    chart.replay.start(T0 + 100 * 5 * MINUTE);
    check();
    chart.replay.step(7);
    check();
    chart.replay.seek(T0 + 40 * 5 * MINUTE);
    check();
    chart.replay.stop();
    check();
  });

  it('follow bars put before the first and calendars changed', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const bars = createBars(200, T0, 5 * MINUTE);
    chart.data.set(bars.slice(100), { interval: '5m' });
    const id = chart.indicators.add({ type: 'MA', params: MA3, timeframe: '1h' });
    values(chart, id, 'ma3');

    chart.data.prepend(bars.slice(0, 100));
    expectClose(values(chart, id, 'ma3'), expected(chart, '1h', 'MA', MA3, 'ma3'));

    // Hours of a zone half an hour off start at half past.
    chart.applyOptions({ calendar: { timeZone: 'Asia/Kolkata' } });
    expect(chart.data.calendar().bucket(T0, '1h')).toBe(T0);
    expectClose(values(chart, id, 'ma3'), expected(chart, '1h', 'MA', MA3, 'ma3'));
  });

  it('change their timeframe with a patch', () => {
    const { chart } = fiveMinutes(300);
    const id = chart.indicators.add({ type: 'MA', params: MA3 });

    chart.indicators.update(id, { timeframe: '1h' });
    expectClose(values(chart, id, 'ma3'), expected(chart, '1h', 'MA', MA3, 'ma3'));
    chart.indicators.update(id, { params: { periods: [2] } });
    expect(chart.indicators.get(id)?.timeframe).toBe('1h');
    chart.indicators.update(id, { timeframe: { unit: 'hour', count: 4 } });
    expect(chart.indicators.get(id)?.timeframe).toBe('4h');
    expectClose(values(chart, id, 'ma2'), expected(chart, '4h', 'MA', { periods: [2] }, 'ma2'));
    chart.indicators.update(id, { timeframe: null });
    expect(chart.indicators.get(id)?.timeframe).toBeNull();
    expectClose(values(chart, id, 'ma2'), plain(chart, 'MA', { periods: [2] }, 'ma2'));
  });

  it('draw a marker of a bar of the timeframe once, on the first bar showing it', () => {
    const { chart } = fiveMinutes(30);
    chart.indicators.register({
      type: 'SIGNALS',
      name: 'Signals',
      pane: 'main',
      params: {},
      precision: 2,
      outputs: () => [{ key: 'buy', label: 'Buy', plot: { kind: 'marker', text: 'B' } }],
      lookback: () => 1,
      compute: (window) => [window.bar(0).low]
    });
    const scene = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
    const calls = scene ? canvasCalls(scene) : [];
    const marks = () => {
      calls.length = 0;
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText' && call.args[0] === 'B').length;
    };
    const id = chart.indicators.add({ type: 'SIGNALS' });

    expect(marks()).toBe(30);
    // From 09:30 to 11:55: the bars of 09:55, 10:55 and 11:55 show the hours of 09:00, 10:00 and
    // 11:00, the latest one forming.
    chart.indicators.update(id, { timeframe: '1h' });
    expect(marks()).toBe(3);
  });

  it('color columns by the bar of the timeframe they show', () => {
    const { chart } = fiveMinutes(60);
    const own = chart.indicators.add({ type: 'VOL', timeframe: '1h' });
    const bars = chart.indicators.add({ type: 'VOL' });
    const { theme } = chart.options();
    // The 10:05 bar falls, the 09:00 hour it shows rose.
    const index = chart.data.indexOf(Date.UTC(2024, 0, 2, 10, 5));
    const color = (id: string) => chart.indicators.valuesAt(id, index)[0]?.color;

    expect(chart.data.at(index)?.close).toBeLessThan(chart.data.at(index)?.open ?? 0);
    expect(color(bars)).toBe(theme.volumeDown);
    expect(color(own)).toBe(theme.volumeUp);
  });

  it('color columns by the change from the bar of the timeframe before', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const start = Date.UTC(2024, 0, 2, 9);
    // Four hours, each a point lower than the one before.
    chart.data.set(
      Array.from({ length: 48 }, (_, index) => {
        const close = 200 - Math.floor(index / 12);
        return { time: start + index * 5 * MINUTE, open: close, high: close, low: close, close };
      }),
      { interval: '5m' }
    );
    chart.indicators.register({
      type: 'CLOSES',
      name: 'Closes',
      pane: 'new',
      params: {},
      precision: 2,
      outputs: () => [
        { key: 'close', label: 'Close', plot: { kind: 'histogram', colorBy: 'change' } }
      ],
      lookback: () => 1,
      compute: (window) => [window.bar(0).close]
    });
    const id = chart.indicators.add({ type: 'CLOSES', timeframe: '1h' });
    const { theme } = chart.options();
    const color = (time: number) =>
      chart.indicators.valuesAt(id, chart.data.indexOf(time))[0]?.color;

    // The 11:30 bar shows the 10:00 hour, lower than the 09:00 one, as the bar before it does.
    expect(color(Date.UTC(2024, 0, 2, 11, 30))).toBe(theme.down);
    expect(color(Date.UTC(2024, 0, 2, 10, 55))).toBe(theme.down);
  });

  it('share the bars of a timeframe, built once for all its indicators', () => {
    const displayed = new BarStore();
    const options = createDefaultOptions();
    const series = new SeriesStore(createSeriesRegistry(), () => options.theme);
    const market = new MarketData(displayed, series, options);
    market.set(createBars(120, T0, 5 * MINUTE), '5m');
    const bases = new IndicatorBases(market, displayed);
    const hourly = bases.of(parseInterval('1h'))();

    // Ten hours from 09:30.
    expect(hourly.bars.length).toBe(11);
    expect(bases.of(parseInterval('1h'))()).toBe(hourly);
    expect(bases.of(parseInterval('4h'))()).not.toBe(hourly);
    expect(bases.of(null)()).toBe(bases.displayed);

    bases.keep([parseInterval('4h')]);
    expect(bases.of(parseInterval('1h'))()).not.toBe(hourly);
  });

  it('name their timeframe in the legend', () => {
    const { chart } = fiveMinutes();
    chart.indicators.add({ type: 'MA', params: { periods: [20] }, timeframe: '1h' });
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="cursor"]');
    chart.screenshot();
    const texts = (canvas ? canvasCalls(canvas) : []).map((call) => String(call.args[0]));

    expect(texts).toContain('MA 20 1h');
  });

  it('check their timeframe', () => {
    const { chart } = fiveMinutes();

    expect(() => chart.indicators.add({ type: 'MA', timeframe: 'hourly' })).toThrow(
      'indicator.timeframe "hourly" is not an interval'
    );
    expect(() => chart.indicators.add({ type: 'MA', timeframe: 5 as never })).toThrow(
      'indicator.timeframe must be a string such as "5m" or an object { unit, count }, received 5.'
    );
    const id = chart.indicators.add({ type: 'MA' });
    expect(() => {
      chart.indicators.update(id, { timeframe: '0h' });
    }).toThrow('indicator.timeframe needs a positive integer count');
    expect(() => {
      checkIndicatorInput(definitionOf('MA'), { type: 'MA', timeframe: '1x' });
    }).toThrow('indicator.timeframe "1x" is not an interval');
    expect(() => {
      checkIndicatorInput(definitionOf('MA'), { type: 'MA', timeframe: '4h' });
    }).not.toThrow();
  });
});

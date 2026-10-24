import { describe, expect, it, vi } from 'vitest';
import { withAlpha } from '../../src/canvas/color';
import type { Chart } from '../helpers/chart';
import type { BarInput } from '../../src/data/types';
import { createCalendar, type Calendar } from '../../src/feed/calendar';
import type { IndicatorStream } from '../../src/indicators/types';
import { darkTheme, lightTheme } from '../../src/options/themes';
import { createTestChart } from '../helpers/chart';
import { compute, expectClose } from './helpers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type TestBar = BarInput & { time: number; volume: number };

/** Bars at `times` whose hlc3 is `prices[i]` (high and low 1 around the close). */
function barsAt(times: readonly number[], prices: (index: number) => number): TestBar[] {
  return times.map((time, index) => {
    const price = prices(index);
    return {
      time,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 100 + ((index * 37) % 11) * 50
    };
  });
}

function every(start: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index * step);
}

/** A price that drifts and swings, so every period has its own VWAP and deviation. */
const drift = (index: number) => 100 + index * 0.7 + ((index * 13) % 7);
/** A price that rises and falls in turn. */
const wave = (index: number) => 100 + 10 * Math.sin(index / 8);

/**
 * VWAP of hlc3 restarting whenever `period` of the bar time changes, with the volume-weighted
 * standard deviation from central moments.
 */
function referenceVwap(
  bars: readonly TestBar[],
  period: (time: number) => number,
  price: (bar: TestBar) => number = (bar) => (bar.high + bar.low + bar.close) / 3
): { vwap: number[]; deviation: number[] } {
  const vwap: number[] = [];
  const deviation: number[] = [];

  bars.forEach((bar, index) => {
    let from = index;

    while (from > 0 && period(bars[from - 1]?.time ?? 0) === period(bar.time)) {
      from -= 1;
    }

    const slice = bars.slice(from, index + 1);
    const volume = slice.reduce((sum, item) => sum + item.volume, 0);
    const mean = slice.reduce((sum, item) => sum + price(item) * item.volume, 0) / volume;
    const variance =
      slice.reduce((sum, item) => sum + item.volume * (price(item) - mean) ** 2, 0) / volume;
    vwap.push(mean);
    deviation.push(Math.sqrt(variance));
  });

  return { vwap, deviation };
}

const utcDay = (time: number) => Math.floor(time / DAY);
/** New York (EST in January) days from 17:00. */
const fxDay = (time: number) => Math.floor((time - 5 * HOUR + 7 * HOUR) / DAY);
const shanghaiDay = (time: number) => Math.floor((time + 8 * HOUR) / DAY);

function values(chart: Chart, id: string, key: string): number[] {
  return Array.from({ length: chart.data.length }, (_, index) => {
    const value = chart.indicators.valuesAt(id, index).find((item) => item.key === key)?.value;
    return value ?? Number.NaN;
  });
}

describe('VWAP over the trading calendar', () => {
  it('restarts at midnight UTC with bands one deviation away', () => {
    // Hourly from 18:00 UTC over three days.
    const bars = barsAt(every(Date.UTC(2024, 0, 2, 18), HOUR, 60), drift);
    const { vwap, deviation } = referenceVwap(bars, utcDay);
    const result = compute('VWAP', bars, undefined, createCalendar({ timeZone: 'UTC' }));

    expectClose(result.vwap ?? [], vwap);
    expectClose(
      result.upperBand1 ?? [],
      vwap.map((value, index) => value + (deviation[index] ?? 0))
    );
    expectClose(
      result.lowerBand1 ?? [],
      vwap.map((value, index) => value - (deviation[index] ?? 0))
    );
    // The first bar of each day stands alone.
    expect(result.vwap?.[6]).toBeCloseTo(drift(6));
    expect(result.upperBand1?.[6]).toBeCloseTo(drift(6));
  });

  it('restarts at 17:00 New York time for FX', () => {
    const bars = barsAt(every(Date.UTC(2024, 0, 2, 18), HOUR, 60), drift);
    const calendar = createCalendar({ timeZone: 'America/New_York', dayStart: '17:00' });
    const result = compute('VWAP', bars, undefined, calendar);

    expectClose(result.vwap ?? [], referenceVwap(bars, fxDay).vwap);
    // 22:00 UTC is 17:00 in New York: a new day there, not at midnight UTC.
    expect(result.vwap?.[4]).toBeCloseTo(drift(4));
    expect(result.vwap?.[6]).not.toBeCloseTo(drift(6));
  });

  it('restarts at the first session of an A-share day and runs through the lunch break', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Shanghai',
      sessions: ['09:30-11:30', '13:00-15:00']
    });
    // Two days of 30-minute bars from 09:30 to 14:30 Shanghai time, with one at 12:00 (lunch)
    // that the calendar drops and that stays in the morning's period.
    const times = [6, 7].flatMap((day) =>
      [
        [9, 30],
        [10, 0],
        [10, 30],
        [11, 0],
        [12, 0],
        [13, 0],
        [13, 30],
        [14, 0],
        [14, 30]
      ].map(([hour = 0, minute = 0]) => Date.UTC(2024, 4, day, hour - 8, minute))
    );
    const bars = barsAt(times, drift);
    const result = compute('VWAP', bars, undefined, calendar);

    expectClose(result.vwap ?? [], referenceVwap(bars, shanghaiDay).vwap);
    expect(result.vwap?.[9]).toBeCloseTo(drift(9));
    expect(result.vwap?.[5]).not.toBeCloseTo(drift(5));
  });

  it.each([
    [1, 'week', (time: number) => Math.floor((utcDay(time) + 3) / 7)],
    [
      2,
      'month',
      (time: number) => new Date(time).getUTCFullYear() * 12 + new Date(time).getUTCMonth()
    ],
    [
      3,
      'quarter',
      (time: number) =>
        new Date(time).getUTCFullYear() * 4 + Math.floor(new Date(time).getUTCMonth() / 3)
    ],
    [4, 'year', (time: number) => new Date(time).getUTCFullYear()]
  ])('anchors to periods %d (%s) of the calendar', (anchor, _name, period) => {
    // Daily bars from Wednesday 2023-11-01 over 15 months.
    const bars = barsAt(every(Date.UTC(2023, 10, 1), DAY, 460), drift);
    const result = compute('VWAP', bars, { anchor }, createCalendar({ timeZone: 'UTC' }));
    expectClose(result.vwap ?? [], referenceVwap(bars, period).vwap);
  });

  it('draws the bands that have a multiplier, and fills between each pair', () => {
    const bars = barsAt(every(Date.UTC(2024, 0, 2), HOUR, 30), drift);
    const result = compute('VWAP', bars, { band1: 0, band2: 2, band3: 3 });
    const { vwap, deviation } = referenceVwap(bars, utcDay);

    expect(Object.keys(result)).toEqual([
      'vwap',
      'upperBand2',
      'lowerBand2',
      'upperBand3',
      'lowerBand3'
    ]);
    expectClose(
      result.lowerBand3 ?? [],
      vwap.map((value, index) => value - 3 * (deviation[index] ?? 0))
    );
  });

  it('puts the bands a percent of VWAP away when picked', () => {
    const bars = barsAt(every(Date.UTC(2024, 0, 2), HOUR, 30), drift);
    const result = compute('VWAP', bars, { bandMode: 1, band1: 0.5 });
    const { vwap } = referenceVwap(bars, utcDay);
    expectClose(
      result.upperBand1 ?? [],
      vwap.map((value) => value * 1.005)
    );
  });
});

describe('VWAP in a chart', () => {
  const bars = barsAt(every(Date.UTC(2024, 0, 2, 18), HOUR, 60), drift);

  it('weights hlc3 by default, and any other source', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(bars);
    const id = chart.indicators.add({ type: 'VWAP' });
    const closes = chart.indicators.add({ type: 'VWAP', source: 'close' });
    const ma = chart.indicators.add({ type: 'MA', params: { periods: [3] } });
    const ofMa = chart.indicators.add({
      type: 'VWAP',
      source: { kind: 'indicator', id: ma }
    });
    const maValues = values(chart, ma, 'ma3');

    expect(chart.indicators.get(id)?.source).toBe('hlc3');
    expectClose(values(chart, id, 'vwap'), referenceVwap(bars, utcDay).vwap);
    expectClose(
      values(chart, closes, 'vwap'),
      referenceVwap(bars, utcDay, (bar) => bar.close).vwap
    );
    // Fed by MA, VWAP starts once MA has values and weights them by the bars' volumes.
    const fed = bars.slice(2);
    expectClose(
      values(chart, ofMa, 'vwap').slice(2),
      referenceVwap(fed, utcDay, (bar) => maValues[bars.indexOf(bar)] ?? Number.NaN).vwap
    );
    expect(values(chart, ofMa, 'vwap').slice(0, 2).every(Number.isNaN)).toBe(true);
  });

  it.each([
    ['bars shown as given', undefined],
    ['hourly source bars', '1h']
  ])('computes again, with what reads it, when the calendar changes (%s)', (_name, interval) => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(bars, interval === undefined ? undefined : { interval });
    const id = chart.indicators.add({ type: 'VWAP' });
    const ma = chart.indicators.add({
      type: 'MA',
      params: { periods: [3] },
      source: { kind: 'indicator', id }
    });
    expectClose(values(chart, id, 'vwap'), referenceVwap(bars, utcDay).vwap);

    chart.applyOptions({ calendar: { timeZone: 'America/New_York', dayStart: '17:00' } });
    const fx = referenceVwap(bars, fxDay).vwap;
    expectClose(values(chart, id, 'vwap'), fx);
    expectClose(
      values(chart, ma, 'ma3'),
      fx.map((_, index) =>
        index < 2
          ? Number.NaN
          : ((fx[index] ?? 0) + (fx[index - 1] ?? 0) + (fx[index - 2] ?? 0)) / 3
      )
    );
  });

  it('does not alert on a calendar change, which moves VWAP without a tick', () => {
    // 20:00 to 23:00 UTC: one day in UTC (VWAP 150 on the last bar), but 22:00 UTC starts a
    // New York day at 17:00 (VWAP 200).
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const day = barsAt(every(Date.UTC(2024, 0, 2, 20), HOUR, 4), (index) =>
      index < 2 ? 100 : 200
    ).map((bar) => ({ ...bar, volume: 100 }));
    chart.data.set(day);
    const id = chart.indicators.add({ type: 'VWAP' });
    const triggers = vi.fn();
    chart.on('alertTrigger', triggers);
    chart.alerts.add({
      id: 'vwap',
      source: { kind: 'indicator', id, key: 'vwap' },
      trigger: 'cross-up',
      value: 175
    });

    chart.applyOptions({ calendar: { timeZone: 'America/New_York', dayStart: '17:00' } });
    chart.data.update(day.slice(-1));

    expect(chart.indicators.valuesAt(id)[0]?.value).toBeCloseTo(200);
    expect(triggers).not.toHaveBeenCalled();
  });

  it('sees only the revealed bars in a replay', () => {
    // 15-minute source bars over two UTC days, shown hourly.
    const source = barsAt(every(Date.UTC(2024, 0, 2, 12), 15 * MINUTE, 160), drift);
    const replayed = createTestChart({ calendar: { timeZone: 'UTC' } });
    replayed.data.set(source, { interval: '15m' });
    replayed.data.setTimeframe('1h');
    const id = replayed.indicators.add({ type: 'VWAP' });
    values(replayed, id, 'vwap');

    const expectRevealed = () => {
      const cutoff = replayed.replay.state()?.time ?? Number.POSITIVE_INFINITY;
      const fresh = createTestChart({ calendar: { timeZone: 'UTC' } });
      fresh.data.set(
        source.filter((bar) => bar.time <= cutoff),
        { interval: '15m' }
      );
      fresh.data.setTimeframe('1h');
      const reference = fresh.indicators.add({ type: 'VWAP' });

      for (const key of ['vwap', 'upperBand1', 'lowerBand1']) {
        expectClose(values(replayed, id, key), values(fresh, reference, key));
      }
    };

    // 11:15 UTC on the second day: the 11:00 bar is forming.
    replayed.replay.start(Date.UTC(2024, 0, 3, 11, 15));
    expectRevealed();
    replayed.replay.step(1);
    expectRevealed();
    replayed.replay.configure({ step: 'source' });
    replayed.replay.step(3);
    expectRevealed();
    replayed.replay.seek(Date.UTC(2024, 0, 2, 23, 30));
    expectRevealed();
  });
});

describe('the indicator context', () => {
  it('gives the calendar to windowed calculators too', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(barsAt(every(Date.UTC(2024, 0, 2, 20), HOUR, 4), drift));
    chart.indicators.register({
      type: 'DAY',
      name: 'DAY',
      pane: 'new',
      precision: 0,
      params: {},
      outputs: () => [{ key: 'start', label: 'Start', plot: { kind: 'line' } }],
      lookback: () => 1,
      compute: (window, _params, { calendar }) => [
        calendar.bucket(window.bar(0).time, '1D') ?? Number.NaN
      ]
    });
    const id = chart.indicators.add({ type: 'DAY' });
    expect(values(chart, id, 'start')).toEqual(Array<number>(4).fill(Date.UTC(2024, 0, 2)));

    chart.applyOptions({ calendar: { timeZone: 'America/New_York', dayStart: '17:00' } });
    // 17:00 New York (22:00 UTC) starts January 3 there, at 05:00 UTC.
    expect(values(chart, id, 'start')).toEqual([
      Date.UTC(2024, 0, 2, 5),
      Date.UTC(2024, 0, 2, 5),
      Date.UTC(2024, 0, 3, 5),
      Date.UTC(2024, 0, 3, 5)
    ]);
  });

  it('computes shifted outputs on the trading day of the bar they are computed on', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(barsAt(every(Date.UTC(2024, 0, 2, 20), HOUR, 4), drift));
    const stream = (calendar: Calendar): IndicatorStream => ({
      next: (bar) => [calendar.bucket(bar.time, '1D') ?? Number.NaN],
      clone: () => stream(calendar)
    });
    chart.indicators.register({
      type: 'LATER',
      name: 'LATER',
      pane: 'new',
      precision: 0,
      params: {},
      outputs: () => [{ key: 'start', label: 'Start', plot: { kind: 'line' }, offset: 2 }],
      create: (_params, { calendar }) => stream(calendar)
    });
    const id = chart.indicators.add({ type: 'LATER' });
    const ma = chart.indicators.add({
      type: 'MA',
      params: { periods: [1] },
      source: { kind: 'indicator', id }
    });
    // Drawn two bars later, up to two bars past the latest one.
    const drawn = (of: string) =>
      [0, 1, 2, 3, 4, 5].map(
        (index) => chart.indicators.valuesAt(of, index)[0]?.value ?? Number.NaN
      );
    const N = Number.NaN;
    expect(drawn(id)).toEqual([N, N, ...Array<number>(4).fill(Date.UTC(2024, 0, 2))]);

    chart.applyOptions({ calendar: { timeZone: 'America/New_York', dayStart: '17:00' } });
    const fx = [Date.UTC(2024, 0, 2, 5), Date.UTC(2024, 0, 3, 5)];
    expect(drawn(id)).toEqual([N, N, fx[0], fx[0], fx[1], fx[1]]);
    expect(drawn(ma)).toEqual(drawn(id));
  });
});

describe('theme colors', () => {
  it('color SuperTrend by the theme, unless colors are given', () => {
    const chart = createTestChart();
    chart.data.set(barsAt(every(Date.UTC(2024, 0, 2), HOUR, 40), drift));
    const id = chart.indicators.add({ type: 'SUPERTREND' });
    const colors = () =>
      Object.fromEntries(
        chart.indicators
          .valuesAt(id)
          .filter((value) => value.key !== 'bodyMiddle')
          .map((value) => [value.key, value.color])
      );

    expect(colors()).toEqual({ upTrend: lightTheme.up, downTrend: lightTheme.down });

    chart.applyOptions({ theme: darkTheme });
    expect(colors()).toEqual({ upTrend: darkTheme.up, downTrend: darkTheme.down });

    chart.indicators.update(id, { colors: { downTrend: '#123456' } });
    expect(colors()).toEqual({ upTrend: darkTheme.up, downTrend: '#123456' });
  });

  it('shade SuperTrend from each trend line to the middle of the bodies', () => {
    const chart = createTestChart();
    chart.data.set(barsAt(every(Date.UTC(2024, 0, 2), HOUR, 120), wave));
    chart.indicators.add({ type: 'SUPERTREND', params: { period: 5, multiplier: 1 } });
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
    const ctx = canvas?.getContext('2d');
    const fills: string[] = [];

    if (ctx) {
      ctx.fill = function (this: CanvasRenderingContext2D) {
        fills.push(this.fillStyle as string);
      };
    }

    chart.screenshot();
    expect(fills).toContain(withAlpha(lightTheme.up, 0.08));
    expect(fills).toContain(withAlpha(lightTheme.down, 0.08));
  });

  it('must be up or down', () => {
    const chart = createTestChart();
    chart.indicators.register({
      type: 'TONE',
      name: 'TONE',
      pane: 'main',
      precision: 2,
      params: {},
      outputs: () => [
        { key: 'v', label: 'V', plot: { kind: 'line' }, themeColor: 'accent' as unknown as 'up' }
      ],
      lookback: () => 1,
      compute: () => [1]
    });
    expect(() => chart.indicators.add({ type: 'TONE' })).toThrow(/themeColor/);
  });
});

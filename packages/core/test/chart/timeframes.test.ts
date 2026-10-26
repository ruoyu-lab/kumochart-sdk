import { describe, expect, it, vi } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { createBarFeed, createValueFeed, identityBucketer } from '../../src/feed/aggregator';
import { createCalendar } from '../../src/feed/calendar';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';

const SECOND = 1000;

/** 60 one-minute bars from 09:30 UTC with the chart's calendar in UTC. */
function minuteChart(count = 60) {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  const bars = createBars(count);
  chart.data.set(bars, { interval: '1m' });
  return { chart, bars };
}

function merged(bars: readonly BarInput[]) {
  return {
    time: bars[0]?.time,
    open: bars[0]?.open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars[bars.length - 1]?.close,
    volume: bars.reduce((sum, bar) => sum + (bar.volume ?? 0), 0)
  };
}

describe('timeframes', () => {
  it('gives the trading calendar it builds them with, in its own time zone', () => {
    const chart = createTestChart({
      timeZone: 'America/New_York',
      calendar: { timeZone: 'Asia/Shanghai', sessions: ['09:30-11:30', '13:00-15:00'] }
    });
    const shanghai = createCalendar({
      timeZone: 'Asia/Shanghai',
      sessions: ['09:30-11:30', '13:00-15:00']
    });
    const time = Date.UTC(2026, 4, 6, 2, 15);

    expect(chart.data.calendar().bucket(time, '1h')).toBe(shanghai.bucket(time, '1h'));
    expect(chart.data.calendar().bucket(Date.UTC(2026, 4, 6, 4), '1h')).toBeNull();

    chart.applyOptions({ calendar: { timeZone: 'UTC', sessions: [] } });
    expect(chart.data.calendar().bucket(time, '1h')).toBe(Date.UTC(2026, 4, 6, 2));
  });

  it('build days in UTC unless the calendar says otherwise, whatever zone shows the times', () => {
    const chart = createTestChart({ timeZone: 'Asia/Shanghai' });
    const day = Date.UTC(2026, 9, 20);

    expect(chart.options().calendar.timeZone).toBe('UTC');
    expect(chart.data.calendar().bucket(day + 10 * 3_600_000, '1D')).toBe(day);
  });

  it('take only bars of hours the calendar times as the data does', () => {
    const hour = 3_600_000;
    const t0 = Date.UTC(2026, 9, 20);
    const bars = (count: number, step: number) =>
      createBars(count, t0, step).map((bar) => ({ ...bar, volume: 1 }));
    const kolkata = createTestChart({ timeZone: 'Asia/Kolkata' });

    // Hours from midnight UTC, shown in Kolkata half an hour past: the bars keep their times.
    kolkata.data.set(bars(3, hour), { interval: '1h' });
    expect(kolkata.data.toArray().map((bar) => bar.time)).toEqual([t0, t0 + hour, t0 + 2 * hour]);
    expect(kolkata.data.addTrades({ time: t0 + 2 * hour + 10 * MINUTE, price: 1 })).toBe(1);
    expect(kolkata.data.length).toBe(3);

    const kolkataCalendar = createTestChart({ calendar: { timeZone: 'Asia/Kolkata' } });

    expect(() => {
      kolkataCalendar.data.set(bars(3, hour), { interval: '1h' });
    }).toThrow('does not start a bar of the trading calendar');
    expect(kolkataCalendar.data.length).toBe(0);

    const utc = createTestChart();
    utc.data.set(bars(3, hour), { interval: '1h' });
    expect(() => {
      utc.applyOptions({ calendar: { timeZone: 'Asia/Kolkata' } });
    }).toThrow('does not start a bar of the trading calendar');
    expect(utc.options().calendar.timeZone).toBe('UTC');
    expect(utc.data.length).toBe(3);
  });

  it('take bars of days by their trading date, whatever time dates them', () => {
    const hour = 3_600_000;
    const day = 24 * hour;
    // Days of UTC bars, as exchanges give them, on a calendar of Shanghai.
    const t0 = Date.UTC(2026, 9, 19);
    const utcDays = createBars(5, t0, day);
    const shanghai = createTestChart({ calendar: { timeZone: 'Asia/Shanghai' } });
    shanghai.data.set(utcDays, { interval: '1D' });

    expect(shanghai.data.length).toBe(5);
    // A trade at 18:00 in Shanghai, on the date of the last bar, goes into it.
    expect(shanghai.data.addTrades({ time: t0 + 4 * day + 10 * hour, price: 1 })).toBe(1);
    expect(shanghai.data.length).toBe(5);
    expect(shanghai.data.last()?.close).toBe(1);

    // Monday to Friday of a market with sessions, dated at midnight, outside them: none is dropped.
    const monday = Date.UTC(2026, 9, 18, 16);
    const sessions = createTestChart({
      calendar: {
        timeZone: 'Asia/Shanghai',
        sessions: ['09:30-11:30', '13:00-15:00'],
        weekdays: [1, 2, 3, 4, 5]
      }
    });
    sessions.data.set(createBars(5, monday, day), { interval: '1D' });

    expect(sessions.data.length).toBe(5);
    sessions.data.setTimeframe('1W');
    expect(sessions.data.length).toBe(1);
  });

  it('displays the source bars as given without an interval', () => {
    const chart = createTestChart();
    chart.data.set(createBars(10));

    expect(chart.data.sourceInterval()).toBeNull();
    expect(chart.data.length).toBe(10);
    expect(() => {
      chart.data.set([], null as never);
    }).toThrow('data.set() options must be an object');
    expect(() => {
      chart.data.set([], { interval: '1x' });
    }).toThrow('interval "1x" is not an interval');
    expect(() => {
      chart.data.setTimeframe('5m');
    }).toThrow('needs the source interval');
  });

  it('aggregates the source into a coarser timeframe and back', () => {
    const { chart, bars } = minuteChart();
    chart.data.setTimeframe('5m');

    expect(chart.data.timeframe()).toEqual({ unit: 'minute', count: 5 });
    expect(chart.data.length).toBe(12);
    expect(chart.data.at(0)).toEqual(merged(bars.slice(0, 5)));
    expect(chart.data.last()).toEqual(merged(bars.slice(55)));

    chart.data.setTimeframe('1h');
    // 09:30–09:59 and 10:00–10:29.
    expect(chart.data.toArray().map((bar) => bar.time)).toEqual([
      Date.UTC(2024, 0, 2, 9),
      Date.UTC(2024, 0, 2, 10)
    ]);

    chart.data.setTimeframe('1m');
    expect(chart.data.timeframe()).toBeNull();
    expect(chart.data.length).toBe(60);
  });

  it('rejects timeframes the source cannot build and keeps the current one', () => {
    const { chart } = minuteChart();
    chart.data.setTimeframe('5m');

    expect(() => {
      chart.data.setTimeframe('90s');
    }).toThrow('cannot be built from 1m');
    expect(() => {
      chart.data.setTimeframe('30s');
    }).toThrow('finer than the source');
    expect(chart.data.length).toBe(12);
  });

  it('builds history taken page after page as from the bars at once, pages ending inside a bar', () => {
    // From 07:13: pages of seven bars end inside bars of five minutes, which they then share.
    const all = createBars(200, T0 - 137 * MINUTE);
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set(all.slice(137), { interval: '1m' });
    chart.data.setTimeframe('5m');

    for (let end = 137; end > 0; end -= 7) {
      chart.data.prepend(all.slice(Math.max(0, end - 7), end));
    }

    const atOnce = createTestChart({ calendar: { timeZone: 'UTC' } });
    atOnce.data.set(all, { interval: '1m' });
    atOnce.data.setTimeframe('5m');
    expect(chart.data.source.length).toBe(200);
    expect(chart.data.toArray()).toEqual(atOnce.data.toArray());
  });

  it('reads only the source bars of a history page and of the bar it joins', () => {
    const fiveMinutes = (time: number) => Math.floor(time / (5 * MINUTE)) * 5 * MINUTE;
    const all = createBars(10_012, T0 - 10 * MINUTE);
    const feed = createBarFeed(fiveMinutes);
    // From 09:32, in the bar of 09:30 that the page's last two bars join.
    feed.planSet(all.slice(12), fiveMinutes)();
    const reads = vi.spyOn(feed.source, 'high');
    feed.planPrepend(all.slice(0, 12)).commit();

    // The twelve bars added and the three of 09:30 after them, not the 10,000 bars of the source.
    expect(reads.mock.calls.length).toBeLessThan(100);
    const atOnce = createBarFeed(fiveMinutes);
    atOnce.planSet(all, fiveMinutes)();
    expect(feed.display.toArray()).toEqual(atOnce.display.toArray());
  });

  it('updates the forming bar from source updates and opens new ones', () => {
    const { chart, bars } = minuteChart();
    chart.data.setTimeframe('5m');
    const last = bars[59] as BarInput;
    chart.data.update({ ...last, high: 500, close: 450 });

    expect(chart.data.length).toBe(12);
    expect(chart.data.last()).toMatchObject({ high: 500, close: 450 });

    chart.data.update({ time: T0 + 60 * MINUTE, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(chart.data.length).toBe(13);
    expect(chart.data.last()).toMatchObject({ time: T0 + 60 * MINUTE, open: 1, close: 1.5 });
  });

  it('keeps the timeframe across history pages and compatible sets', () => {
    const { chart, bars } = minuteChart();
    chart.data.setTimeframe('5m');
    const earlier = createBars(30, T0 - 30 * MINUTE);

    expect(chart.data.prepend(earlier)).toBe(30);
    expect(chart.data.length).toBe(18);
    expect(chart.data.at(0)?.time).toBe(T0 - 30 * MINUTE);

    chart.data.set(bars, { interval: '1m' });
    expect(chart.data.timeframe()).toEqual({ unit: 'minute', count: 5 });

    chart.data.set(createBars(10, T0, 10 * MINUTE), { interval: '10m' });
    expect(chart.data.timeframe()).toBeNull();
    expect(chart.data.length).toBe(10);
  });

  it('displays series beside a single bar', () => {
    const { chart } = minuteChart();
    chart.data.set(chart.data.toArray().slice(0, 3), { interval: '1m' });
    chart.data.setTimeframe('3m');
    const counts: number[] = [];
    chart.series.register({
      type: 'count',
      input: 'value',
      defaultStyle: () => ({}),
      paint: ({ points }) => {
        counts.push(points.count);
      }
    });
    chart.series.add({
      type: 'count',
      data: [
        { time: T0, value: 1 },
        { time: T0 + MINUTE, value: 2 }
      ]
    });
    chart.screenshot();

    expect(chart.data.length).toBe(1);
    expect(counts.at(-1)).toBe(1);
  });

  it('displays series in the timeframe, added with their points or without', () => {
    const { chart } = minuteChart();
    chart.data.setTimeframe('5m');
    const painted = new Map<string, number[]>();
    chart.series.register<{ name: string }>({
      type: 'probe',
      input: 'value',
      defaultStyle: () => ({ name: '' }),
      paint: ({ style, points }) => {
        painted.set(
          style.name,
          Array.from({ length: points.count }, (_, index) => points.x(index))
        );
      }
    });
    const points = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        time: T0 + (from + index) * MINUTE,
        value: from + index
      }));

    const add = (name: string, data?: ReturnType<typeof points>) =>
      chart.series.add({ id: name, type: 'probe', style: { name }, ...(data ? { data } : {}) });
    add('given', points(0, 10));
    chart.series.updateData(add('empty'), points(0, 10));
    chart.series.prependData(add('later'), points(0, 10));
    chart.screenshot();

    // A point at each of the two bars of five minutes, as for the series added with its points.
    const bars = [T0, T0 + 5 * MINUTE].map((time) => chart.timeScale.timeToX(time));
    const left = chart.layout().panes[0]?.plot.x ?? 0;
    expect(painted.get('given')?.map((x) => x + left)).toEqual(bars);
    expect(painted.get('empty')).toEqual(painted.get('given'));
    expect(painted.get('later')).toEqual(painted.get('given'));
  });

  it('builds bars from trades', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set([], { interval: '1m' });

    const applied = chart.data.addTrades([
      { time: T0 + 5 * SECOND, price: 10, size: 1 },
      { time: T0 + 20 * SECOND, price: 12, size: 2 },
      { time: T0 + 40 * SECOND, price: 9 },
      { time: T0 + 61 * SECOND, price: 11, size: 1 }
    ]);

    expect(applied).toBe(4);
    expect(chart.data.toArray()).toEqual([
      { time: T0, open: 10, high: 12, low: 9, close: 9, volume: 3 },
      { time: T0 + MINUTE, open: 11, high: 11, low: 11, close: 11, volume: 1 }
    ]);

    chart.data.addTrades({ time: T0 + 70 * SECOND, price: 13, size: 4 });
    expect(chart.data.last()).toEqual({
      time: T0 + MINUTE,
      open: 11,
      high: 13,
      low: 11,
      close: 13,
      volume: 5
    });

    chart.data.setTimeframe('5m');
    expect(chart.data.toArray()).toEqual([
      { time: T0, open: 10, high: 13, low: 9, close: 13, volume: 8 }
    ]);
  });

  it('validates trades and skips the ones outside the sessions', () => {
    const chart = createTestChart({
      calendar: { timeZone: 'UTC', sessions: ['09:30-16:00'] }
    });

    expect(() => chart.data.addTrades({ time: T0, price: 1 })).toThrow('needs the source interval');

    chart.data.set([], { interval: '1m' });
    chart.data.addTrades({ time: T0 + 5 * MINUTE, price: 1 });

    expect(chart.data.addTrades({ time: Date.UTC(2024, 0, 2, 8), price: 2 })).toBe(0);
    // Late, as a stream may deliver them: older than the last bar, or than the latest trade.
    expect(chart.data.addTrades({ time: T0, price: 2 })).toBe(0);
    expect(
      chart.data.addTrades([
        { time: T0 + 5 * MINUTE + 1000, price: 3 },
        { time: T0 + 5 * MINUTE + 500, price: 9 },
        { time: T0 + 6 * MINUTE, price: 4 }
      ])
    ).toBe(2);
    expect(chart.data.toArray().map((bar) => bar.close)).toEqual([3, 4]);
    chart.data.set([], { interval: '1m' });
    chart.data.addTrades({ time: T0 + 5 * MINUTE, price: 1 });
    expect(() => chart.data.addTrades({ time: T0 + 6 * MINUTE, price: Number.NaN })).toThrow(
      'trades[0].price must be a finite number'
    );
    expect(() => chart.data.addTrades({ time: T0 + 6 * MINUTE, price: 1, size: -1 })).toThrow(
      'trades[0].size'
    );
    expect(chart.data.length).toBe(1);
  });

  it('buckets again when the calendar changes', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    // Hourly bars from 2024-01-02 00:00 UTC for two days.
    chart.data.set(createBars(48, Date.UTC(2024, 0, 2), 60 * MINUTE), { interval: '1h' });
    chart.data.setTimeframe('1D');

    expect(chart.data.toArray().map((bar) => bar.time)).toEqual([
      Date.UTC(2024, 0, 2),
      Date.UTC(2024, 0, 3)
    ]);

    chart.applyOptions({ calendar: { timeZone: 'Asia/Shanghai' } });
    // Shanghai dates: Jan 2 (00:00–15:59 UTC), Jan 3, Jan 4 (16:00–23:59 UTC on Jan 3).
    expect(chart.data.toArray().map((bar) => bar.time)).toEqual([
      Date.UTC(2024, 0, 1, 16),
      Date.UTC(2024, 0, 2, 16),
      Date.UTC(2024, 0, 3, 16)
    ]);
  });

  it('asks for history before the first source bar', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const loadMore = vi.fn();
    chart.on('loadMore', loadMore);
    chart.data.set(createBars(40, T0 + 2 * MINUTE), { interval: '1m' });
    chart.data.setTimeframe('5m');
    chart.timeScale.scrollToIndex(0, 'left');
    chart.timeScale.visibleRange();

    expect(loadMore).toHaveBeenLastCalledWith(expect.objectContaining({ before: T0 + 2 * MINUTE }));
  });

  it('computes indicators on the displayed bars', () => {
    const { chart } = minuteChart();
    chart.data.setTimeframe('5m');
    const id = chart.indicators.add({ type: 'MA', params: { periods: [3] } });

    expect(chart.indicators.valuesAt(id, 11)[0]?.value).toBeCloseTo(
      ((chart.data.at(9)?.close ?? 0) +
        (chart.data.at(10)?.close ?? 0) +
        (chart.data.at(11)?.close ?? 0)) /
        3
    );
  });
});

describe('feeds', () => {
  const calendar = createCalendar({ timeZone: 'UTC' });
  const fiveMinutes = (time: number) => calendar.bucket(time, '5m');

  it('keeps the last value of each bucket for value series', () => {
    const feed = createValueFeed(identityBucketer);
    const points = Array.from({ length: 12 }, (_, index) => ({
      time: T0 + index * MINUTE,
      value: index === 4 ? null : index
    }));
    feed.planSet(points, fiveMinutes)();

    expect([0, 1, 2].map((index) => feed.display.value(index))).toEqual([3, 9, 11]);
    expect(feed.display.length).toBe(3);
  });

  it('reveals and hides source points with the cutoff', () => {
    const feed = createBarFeed(identityBucketer);
    feed.planSet(createBars(10), fiveMinutes)();

    expect(feed.setCutoff(T0 + 6 * MINUTE)).toBe(true);
    expect(feed.display.length).toBe(2);
    expect(feed.display.close(1)).toBe(createBars(10)[6]?.close);
    expect(feed.nextCutoff(T0 + 6 * MINUTE, false)).toBe(T0 + 7 * MINUTE);
    expect(feed.nextCutoff(T0 + 6 * MINUTE, true)).toBe(T0 + 9 * MINUTE);
    expect(feed.nextCutoff(T0 + 9 * MINUTE, true)).toBeNull();

    expect(feed.setCutoff(T0 + 2 * MINUTE)).toBe(true);
    expect(feed.display.length).toBe(1);
    expect(feed.setCutoff(T0 + 2 * MINUTE + 30 * SECOND)).toBe(false);
  });
});

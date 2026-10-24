import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { withAlpha } from '../../src/canvas/color';
import { createCalendar } from '../../src/feed/calendar';
import { sessionsIndicator } from '../../src/indicators';
import { computeIndicator } from '../../src/indicators/headless';
import { createTestChart } from '../helpers/chart';
import { compute, definitionOf, expectClose, UTC_DAYS } from './helpers';
import { field, N, rma, rows, sma, walk, zip } from './reference';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const bars = walk(400);
const highs = field(bars, 'high');
const lows = field(bars, 'low');

interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The OHLC of each UTC day of `values`, by the index of the day since the first one. */
function days(values: readonly Required<BarInput>[]): { day: number[]; ohlc: Ohlc[] } {
  const first = Math.floor(Number(values[0]?.time) / DAY);
  const day = values.map((bar) => Math.floor(Number(bar.time) / DAY) - first);
  const ohlc: Ohlc[] = [];

  values.forEach((bar, index) => {
    const at = day[index] ?? 0;
    const current = ohlc[at];
    ohlc[at] = current
      ? {
          open: current.open,
          high: Math.max(current.high, bar.high),
          low: Math.min(current.low, bar.low),
          close: bar.close
        }
      : { open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  });

  return { day, ohlc };
}

/** Bars every `step` milliseconds from `start`, each 1 high and 1 low around a rising walk. */
function timed(start: number, count: number, step: number): Required<BarInput>[] {
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * step,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1
  }));
}

describe('pivot points', () => {
  it('computes the traditional levels from the previous day', () => {
    // Day 0: H 12, L 8, C 10 → P 10.
    const start = Date.UTC(2024, 0, 1);
    const values = compute(
      'PIVOTS',
      [
        { time: start, open: 9, high: 12, low: 9, close: 11 },
        { time: start + HOUR, open: 11, high: 11, low: 8, close: 10 },
        { time: start + DAY, open: 10, high: 11, low: 9, close: 10 }
      ],
      { period: 1 }
    );
    const day1 = (key: string) => values[key]?.[2];
    expect([day1('p'), day1('r1'), day1('s1'), day1('r2'), day1('s2')]).toEqual([10, 12, 8, 14, 6]);
    expect([day1('r3'), day1('s3'), day1('r4'), day1('s4'), day1('r5'), day1('s5')]).toEqual([
      16, 4, 18, 2, 20, 0
    ]);
    expectClose(values.p ?? [], [N, N, 10]);
  });

  it.each([
    [0, 'Traditional'],
    [1, 'Fibonacci'],
    [2, 'Woodie'],
    [3, 'Classic'],
    [4, 'DM'],
    [5, 'Camarilla']
  ])('holds the %s levels of type %s over each day', (kind) => {
    const { day, ohlc } = days(bars);
    const values = compute('PIVOTS', bars, { kind, period: 1 });

    for (const [key, column] of Object.entries(values)) {
      const expected = bars.map((_bar, index) => {
        const today = day[index] ?? 0;
        const previous = ohlc[today - 1];
        const open = ohlc[today]?.open ?? N;
        return previous ? (referencePivots(kind, previous, open)[key] ?? N) : N;
      });
      expectClose(column, expected, 9);
    }
  });

  it('follows the period of the calendar', () => {
    // 2024-01-01 is a Monday: weeks start on Mondays by default.
    const weekly = compute('PIVOTS', bars, { kind: 1, period: 2 });
    const weekStart = bars.findIndex((bar) => Number(bar.time) >= Date.UTC(2024, 0, 8));
    expect(weekly.p?.slice(0, weekStart).every(Number.isNaN)).toBe(true);
    const previous = bars.slice(0, weekStart);
    const high = Math.max(...previous.map((bar) => bar.high));
    const low = Math.min(...previous.map((bar) => bar.low));
    const close = previous.at(-1)?.close ?? N;
    expect(weekly.p?.[weekStart]).toBeCloseTo((high + low + close) / 3, 9);
    expect(weekly.r3?.[weekStart]).toBeCloseTo((high + low + close) / 3 + (high - low), 9);
  });

  it("picks the timeframe from the chart's interval by default", () => {
    const start = Date.UTC(2024, 0, 1);
    const pivots = definitionOf('PIVOTS');
    const auto = (bars: readonly BarInput[], interval: string | null) =>
      computeIndicator(pivots, bars, { calendar: UTC_DAYS, interval });
    // Bars of 15 minutes or less: daily pivots. Other intraday bars: weekly ones. Daily bars:
    // monthly ones. Weekly bars over years: yearly ones.
    for (const [step, count, interval, period] of [
      [HOUR / 4, 400, '15m', 1],
      [HOUR, 400, '1h', 2],
      [DAY, 100, '1D', 3],
      [7 * DAY, 160, '1W', 5]
    ] as const) {
      const bars = timed(start, count, step);
      expect(auto(bars, interval), interval).toEqual(compute('PIVOTS', bars, { period }));
    }

    expect(auto(timed(start, 160, 7 * DAY), '1W').p?.some((value) => !Number.isNaN(value))).toBe(
      true
    );
    // Without an interval, daily pivots.
    const hours = timed(start, 400, HOUR);
    expect(auto(hours, null)).toEqual(compute('PIVOTS', hours, { period: 1 }));
  });

  it('keeps the timeframe of the interval whatever time lies between the first bars', () => {
    // 15-minute bars: one on a Friday at 23:45, then five days of them from Monday on. The first
    // two bars are two days apart, which is no reason for monthly pivots.
    const friday = Date.UTC(2024, 0, 5, 23, 45);
    const week = [
      ...timed(friday, 1, HOUR / 4),
      ...timed(Date.UTC(2024, 0, 8), 480, HOUR / 4).map((bar) => ({ ...bar, open: bar.open + 1 }))
    ];
    const daily = compute('PIVOTS', week, { period: 1 });
    const chart = createTestChart();
    chart.data.set(week, { interval: '15m' });
    const id = chart.indicators.add({ type: 'PIVOTS' });
    const shown = week.map((_bar, index) => chart.indicators.valuesAt(id, index)[0]?.value ?? N);

    expectClose(shown, daily.p ?? []);
    // Every bar from Monday on holds the levels of the day before.
    expect(shown.filter((value) => !Number.isNaN(value))).toHaveLength(480);

    // A page of history from further back, starting after a gap, keeps the timeframe too.
    chart.data.prepend([
      ...timed(Date.UTC(2024, 0, 1), 1, HOUR / 4),
      ...timed(Date.UTC(2024, 0, 3), 96, HOUR / 4)
    ]);
    const all = chart.data.toArray();
    const again = compute('PIVOTS', all, { period: 1 });
    expectClose(
      all.map((_bar, index) => chart.indicators.valuesAt(id, index)[0]?.value ?? N),
      again.p ?? []
    );
  });

  it('spans several years from a year divisible by their number', () => {
    // A bar a month from 2019 to 2026: two-year periods start in 2020, 2022, 2024 and 2026.
    const months = Array.from({ length: 96 }, (_, index) => ({
      time: Date.UTC(2019, index, 1),
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index
    }));
    const values = compute('PIVOTS', months, { period: 6 });
    const changes = months.flatMap((bar, index) =>
      index > 0 && !Object.is(values.p?.[index], values.p?.[index - 1])
        ? [new Date(bar.time).getUTCFullYear()]
        : []
    );
    // 2019 and 2020-2021 are the periods before the first levels.
    expect(changes).toEqual([2022, 2024, 2026]);
    // 2022 holds the levels of 2020 and 2021.
    const before = months.slice(12, 36);
    const high = Math.max(...before.map((bar) => bar.high));
    const low = Math.min(...before.map((bar) => bar.low));
    const close = before.at(-1)?.close ?? N;
    expect(values.p?.[36]).toBeCloseTo((high + low + close) / 3, 9);
  });

  it('gives the previous period high, low and close', () => {
    const { day, ohlc } = days(bars);
    const values = compute('PREVHLC', bars);
    const previous = (key: keyof Ohlc) =>
      bars.map((_bar, index) => ohlc[(day[index] ?? 0) - 1]?.[key] ?? N);
    expectClose(values.high ?? [], previous('high'));
    expectClose(values.low ?? [], previous('low'));
    expectClose(values.close ?? [], previous('close'));
  });

  it('averages the range of the bars into ADR', () => {
    const ranges = bars.map((bar) => bar.high - bar.low);
    expectClose(compute('ADR', bars).adr ?? [], sma(ranges, 14), 9);
    expectClose(compute('ADR', bars, { period: 3 }).adr ?? [], sma(ranges, 3), 9);
  });

  it('counts bars outside the sessions to the day they follow', () => {
    const calendar = createCalendar({ timeZone: 'UTC', sessions: ['09:00-15:00'] });
    // Bars at 08:00 (dropped, before the first day), 09:00, 16:00 (dropped), then the next day.
    const values = compute(
      'PREVHLC',
      [8, 9, 16, 33].map((hour, index) => ({
        time: Date.UTC(2024, 0, 1) + hour * HOUR,
        open: 10 + index,
        high: 20 + index,
        low: 5 - index,
        close: 10 + index
      })),
      {},
      calendar
    );
    // Day 1 is the 09:00 and 16:00 bars: high 22, low 3, close 12.
    expectClose(values.high ?? [], [N, N, N, 22]);
    expectClose(values.low ?? [], [N, N, N, 3]);
    expectClose(values.close ?? [], [N, N, N, 12]);
  });
});

describe('sessions', () => {
  it('follow each session in its own time zone, daylight saving included', () => {
    // 30-minute bars over a day in winter and one in summer: London is UTC in January and UTC+1
    // in July, so its session starts at 08:30 UTC, then 07:30 UTC.
    for (const [month, open] of [
      [0, 8],
      [6, 7]
    ] as const) {
      const day = timed(Date.UTC(2024, month, 3), 48, HOUR / 2);
      const values = compute('SESSIONS', day);
      const inside = (values.londonHigh ?? []).map((value) => !Number.isNaN(value));
      // 08:30-16:30 London: 16 half hours.
      expect(inside.indexOf(true)).toBe(open * 2 + 1);
      expect(inside.filter(Boolean)).toHaveLength(16);
      // The high and low so far.
      const first = open * 2 + 1;
      expect(values.londonHigh?.[first + 3]).toBe(day[first + 3]?.high);
      expect(values.londonLow?.[first + 3]).toBe(day[first]?.low);
    }
  });

  it('keep a session that crosses midnight together', () => {
    const indicator = sessionsIndicator([
      { key: 'sydney', label: 'Sydney', session: '22:00-06:00', timeZone: 'UTC' }
    ]);
    expect(indicator.outputs({}).map((output) => output.key)).toEqual([
      'sydneyHigh',
      'sydneyLow',
      'sydneyDay'
    ]);
    // Hourly from 20:00: the session holds the bars from 22:00 to 05:00, the third to the tenth.
    const night = timed(Date.UTC(2024, 0, 1, 20), 12, HOUR);
    const values = computeIndicator(indicator, night, {
      calendar: createCalendar({ timeZone: 'UTC' })
    });
    const inside = (index: number) => index >= 2 && index < 10;
    expectClose(
      values.sydneyHigh ?? [],
      night.map((bar, index) => (inside(index) ? bar.high : N))
    );
    expectClose(
      values.sydneyLow ?? [],
      night.map((_bar, index) => (inside(index) ? (night[2]?.low ?? N) : N))
    );
    // One session, of the trading day it ends on.
    expectClose(
      values.sydneyDay ?? [],
      night.map((_bar, index) => (inside(index) ? Date.UTC(2024, 0, 2) : N))
    );
  });

  it('draw a box of its own for each session, also one right after another', () => {
    // Bars only in trading hours, as stocks have them: 09:00 to 15:00 UTC on two days, so that
    // the last bar of the first day and the first of the second are neighbors.
    const hours = [0, 1].flatMap((day) => timed(Date.UTC(2024, 0, 1 + day, 9), 7, HOUR));
    const chart = createTestChart({ timeZone: 'UTC' });
    chart.indicators.register(
      sessionsIndicator(
        [{ key: 'day', label: 'Day', session: '09:00-16:00', timeZone: 'UTC' }],
        'DAYS'
      )
    );
    chart.data.set(hours);
    chart.timeScale.fitContent();
    const id = chart.indicators.add({ type: 'DAYS' });
    const shade = withAlpha(chart.indicators.valuesAt(id)[0]?.color ?? '', 0.1);
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
    const ctx = canvas?.getContext('2d');
    // The widths of the rectangles of each path, by the color it is filled in.
    let path: number[] = [];
    const boxes: number[] = [];

    if (ctx) {
      ctx.beginPath = () => {
        path = [];
      };
      ctx.rect = (_x: number, _y: number, width: number) => {
        path.push(width);
      };
      ctx.fill = function (this: CanvasRenderingContext2D) {
        if (this.fillStyle === shade) {
          boxes.push(...path);
        }
      };
    }

    chart.screenshot();
    const spacing = chart.timeScale.barSpacing();
    expect(boxes).toHaveLength(2);
    boxes.forEach((width) => {
      expect(width).toBeCloseTo(7 * spacing, 0);
    });
  });

  it('reject sessions they cannot follow', () => {
    const london = {
      key: 'london',
      label: 'London',
      session: '08:00-16:30',
      timeZone: 'Europe/London'
    };
    expect(() => sessionsIndicator([])).toThrow('sessions must contain at least one session.');
    expect(() => sessionsIndicator([{ ...london, key: 'new york' }])).toThrow(
      'sessions[0].key must be letters and digits, starting with a letter, received "new york".'
    );
    expect(() => sessionsIndicator([{ ...london, session: '8-16' }])).toThrow(
      'must be a time of day such as "09:30"'
    );
    expect(() => sessionsIndicator([{ ...london, timeZone: 'Europe/Nowhere' }])).toThrow(
      'is not a valid IANA time zone'
    );
  });
});

describe('Bill Williams', () => {
  it('draws the Alligator from smoothed averages of the median price', () => {
    const median = zip([highs, lows], (high, low) => (high + low) / 2);
    const values = compute('ALLIGATOR', bars);
    expectClose(values.jaw ?? [], rma(median, 13), 9);
    expectClose(values.teeth ?? [], rma(median, 8), 9);
    expectClose(values.lips ?? [], rma(median, 5), 9);
  });

  it('marks fractals once the bars after them are known', () => {
    // Highs 1 2 3 2 1: a fractal high of 3, known on the last bar. Lows mirror them.
    const peak = rows([1, 2, 3, 2, 1].map((high) => [high, high, -high, high]));
    const values = compute('FRACTALS', peak);
    expectClose(values.upFractal ?? [], [N, N, N, N, 3]);
    expectClose(values.downFractal ?? [], [N, N, N, N, -3]);
    // An equal high just before the fractal is allowed; one just after is not.
    const plateau = rows([1, 2, 3, 3, 2, 1].map((high) => [high, high, 0, high]));
    expectClose(compute('FRACTALS', plateau).upFractal ?? [], [N, N, N, N, N, 3]);
  });

  it('matches the fractals written out frontier by frontier', () => {
    for (const period of [2, 3]) {
      const values = compute('FRACTALS', bars, { period });
      const expected = referenceFractals(period);
      expectClose(values.upFractal ?? [], expected.up);
      expectClose(values.downFractal ?? [], expected.down);
      expect(expected.up.filter((value) => !Number.isNaN(value)).length).toBeGreaterThan(10);
    }
  });
});

/** The pivot levels of each type by output key. */
function referencePivots(kind: number, previous: Ohlc, open: number): Record<string, number> {
  const { open: o, high: h, low: l, close: c } = previous;
  const levels = (list: number[]) =>
    Object.fromEntries(
      list.map((value, index) => [
        index === 0 ? 'p' : `${index % 2 === 1 ? 'r' : 's'}${Math.ceil(index / 2)}`,
        value
      ])
    );
  const p = (h + l + c) / 3;

  switch (kind) {
    case 0:
      return levels([
        p,
        p * 2 - l,
        p * 2 - h,
        p + (h - l),
        p - (h - l),
        p * 2 + (h - 2 * l),
        p * 2 - (2 * h - l),
        p * 3 + (h - 3 * l),
        p * 3 - (3 * h - l),
        p * 4 + (h - 4 * l),
        p * 4 - (4 * h - l)
      ]);
    case 1:
      return levels([
        p,
        p + 0.382 * (h - l),
        p - 0.382 * (h - l),
        p + 0.618 * (h - l),
        p - 0.618 * (h - l),
        p + (h - l),
        p - (h - l)
      ]);
    case 2: {
      const w = (h + l + 2 * open) / 4;
      const r3 = h + 2 * (w - l);
      const s3 = l - 2 * (h - w);
      return levels([
        w,
        2 * w - l,
        2 * w - h,
        w + (h - l),
        w - (h - l),
        r3,
        s3,
        r3 + (h - l),
        s3 - (h - l)
      ]);
    }
    case 3:
      return levels([
        p,
        2 * p - l,
        2 * p - h,
        p + (h - l),
        p - (h - l),
        p + 2 * (h - l),
        p - 2 * (h - l),
        p + 3 * (h - l),
        p - 3 * (h - l)
      ]);
    case 4: {
      const x = o === c ? h + l + 2 * c : c > o ? 2 * h + l + c : 2 * l + h + c;
      return levels([x / 4, x / 2 - l, x / 2 - h]);
    }
    default: {
      const r5 = (h / l) * c;
      return levels([
        p,
        c + (1.1 * (h - l)) / 12,
        c - (1.1 * (h - l)) / 12,
        c + (1.1 * (h - l)) / 6,
        c - (1.1 * (h - l)) / 6,
        c + (1.1 * (h - l)) / 4,
        c - (1.1 * (h - l)) / 4,
        c + (1.1 * (h - l)) / 2,
        c - (1.1 * (h - l)) / 2,
        r5,
        c - (r5 - c)
      ]);
    }
  }
}

/** Bill Williams' fractals, the frontiers on either side written out one by one. */
function referenceFractals(n: number): { up: number[]; down: number[] } {
  const detect = (values: readonly number[], index: number, sign: number) => {
    const at = (back: number) => sign * (values[index - back] ?? N);
    let downFrontier = true;
    const upFrontier = [true, true, true, true, true];

    for (let i = 1; i <= n; i += 1) {
      downFrontier &&= at(n - i) < at(n);
      upFrontier[0] &&= at(n + i) < at(n);
      upFrontier[1] &&= at(n + 1) <= at(n) && at(n + i + 1) < at(n);
      upFrontier[2] &&= at(n + 1) <= at(n) && at(n + 2) <= at(n) && at(n + i + 2) < at(n);
      upFrontier[3] &&=
        at(n + 1) <= at(n) && at(n + 2) <= at(n) && at(n + 3) <= at(n) && at(n + i + 3) < at(n);
      upFrontier[4] &&=
        at(n + 1) <= at(n) &&
        at(n + 2) <= at(n) &&
        at(n + 3) <= at(n) &&
        at(n + 4) <= at(n) &&
        at(n + i + 4) < at(n);
    }

    return downFrontier && upFrontier.some(Boolean) ? (values[index - n] ?? N) : N;
  };

  return {
    up: highs.map((_value, index) => detect(highs, index, 1)),
    down: lows.map((_value, index) => detect(lows, index, -1))
  };
}

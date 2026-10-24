import { describe, expect, it } from 'vitest';
import { BarsReader, BarStore, parseBars } from '../../src/data/bar-store';
import type { BarInput, BarsView } from '../../src/data/types';
import { createCalendar, type Calendar } from '../../src/feed/calendar';
import { lightTheme } from '../../src/options/themes';
import {
  paintChartProfile,
  ProfileCache,
  type ProfileView,
  type SourceBars
} from '../../src/volume-profile/chart-profiles';
import { computeVolumeProfile } from '../../src/volume-profile';
import type { VolumeProfile } from '../../src/volume-profile';
import { canvasCalls, type CanvasCall } from '../setup';
import { DAY_START, HOUR, hourly } from './helpers';

const DAY = 24 * HOUR;
const T0 = DAY_START;
const UTC = createCalendar({ timeZone: 'UTC' });

function store(bars: readonly BarInput[]): BarStore {
  const result = new BarStore();
  result.set(bars);
  return result;
}

/** All the source bars, as a chart without a replay reads them. */
function sourceOf(bars: BarStore): SourceBars {
  return { source: bars, changes: bars };
}

/** Bars counting how many volumes are read, which computing a profile does once a bar. */
function counted(bars: BarStore): { view: SourceBars; reads: () => number } {
  let reads = 0;
  const view: BarsView = {
    get length() {
      return bars.length;
    },
    get revision() {
      return bars.revision;
    },
    time: (index) => bars.time(index),
    open: (index) => bars.open(index),
    high: (index) => bars.high(index),
    low: (index) => bars.low(index),
    close: (index) => bars.close(index),
    volume: (index) => {
      reads += 1;
      return bars.volume(index);
    },
    bar: (index) => bars.bar(index),
    lowerBound: (time) => bars.lowerBound(time)
  };
  return { view: { source: view, changes: bars }, reads: () => reads };
}

/** A plot 400 wide, bars 10 apart from x 5, and values from y 300 up. */
function viewOf(
  bars: BarsView,
  source: BarStore,
  visible: { from: number; to: number },
  calendar: Calendar = UTC
): ProfileView {
  return {
    bars,
    source,
    changes: source,
    visible,
    calendar,
    theme: lightTheme,
    width: 400,
    barSpacing: 10,
    indexToX: (index) => index * 10 + 5,
    valueToY: (value) => 300 - value
  };
}

function settings(patch: Partial<VolumeProfile>): VolumeProfile {
  return {
    id: 'profile',
    mode: 'visible',
    rows: 10,
    valueArea: 0.7,
    width: null,
    placement: 'right',
    upColor: null,
    downColor: null,
    pocColor: null,
    visible: true,
    ...patch
  };
}

/** The calls of painting a profile. */
function paint(view: ProfileView, profile: VolumeProfile): CanvasCall[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No context.');
  }

  paintChartProfile(ctx, view, profile, new ProfileCache(profile));
  return canvasCalls(canvas);
}

function argsOf(calls: readonly CanvasCall[], name: string): number[][] {
  return calls.filter((call) => call.name === name).map((call) => call.args as number[]);
}

describe('the profile of the bars in view', () => {
  it('grows from the right edge over a quarter of the plot, its point of control across it', () => {
    const bars = store(hourly(40));
    const calls = paint(viewOf(bars, bars, { from: 0, to: 39 }), settings({}));
    const rects = argsOf(calls, 'fillRect');
    const [from, to] = [argsOf(calls, 'moveTo')[0], argsOf(calls, 'lineTo')[0]];

    // Two rects a row: the rising bars' volume, then the falling bars'.
    expect(rects).toHaveLength(20);

    for (const [x = 0, , width = 0] of rects) {
      expect(x).toBeGreaterThanOrEqual(300 - 1e-9);
      expect(x + width).toBeLessThanOrEqual(400 + 1e-9);
    }

    expect(Math.min(...rects.map(([x = 0]) => x))).toBeCloseTo(300);
    expect(from?.[0]).toBe(400);
    expect(to?.[0]).toBe(0);
  });

  it('grows from the left edge, as far as its width says', () => {
    const bars = store(hourly(40));
    const calls = paint(
      viewOf(bars, bars, { from: 0, to: 39 }),
      settings({ placement: 'left', width: 0.5 })
    );
    const rects = argsOf(calls, 'fillRect');

    expect(Math.min(...rects.map(([x = 0]) => x))).toBe(0);
    expect(Math.max(...rects.map(([x = 0, , width = 0]) => x + width))).toBeCloseTo(200);
    expect(argsOf(calls, 'moveTo')[0]?.[0]).toBe(0);
    expect(argsOf(calls, 'lineTo')[0]?.[0]).toBe(400);
  });

  it('is computed from the source bars of the displayed bars in view', () => {
    // A day bar from 90 to 110 whose hours traded mostly around 105.
    const source = store(
      hourly(24).map((bar, index) => ({
        ...bar,
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: index === 3 ? 0 : 100,
        ...(index === 0 ? { high: 110, low: 90 } : {})
      }))
    );
    const day = store([{ time: T0, open: 104, high: 110, low: 90, close: 105, volume: 2300 }]);
    const calls = paint(viewOf(day, source, { from: 0, to: 0 }), settings({ rows: 20 }));
    const expected = computeVolumeProfile(source, 0, 24, { rows: 20 });
    const poc = expected?.rows[expected.poc];

    expect(poc && Math.round(300 - (poc.low + poc.high) / 2) + 0.5).toBe(
      argsOf(calls, 'moveTo')[0]?.[1]
    );
    expect(poc?.low).toBeGreaterThan(102);
  });

  it('paints nothing without bars in view or volume in them', () => {
    const bars = store(hourly(10).map((bar) => ({ ...bar, volume: 0 })));
    const view = viewOf(bars, bars, { from: 0, to: 9 });

    expect(paint(view, settings({}))).toEqual([]);
    expect(paint({ ...view, visible: null }, settings({ mode: 'session' }))).toEqual([]);
  });
});

describe('the profiles of the trading days', () => {
  it('paint one profile per day in view, from its first bar to its last', () => {
    const bars = store(hourly(72));
    const profile = settings({ mode: 'session', rows: 4 });
    const all = paint(viewOf(bars, bars, { from: 0, to: 71 }), profile);

    expect(argsOf(all, 'fillRect')).toHaveLength(3 * 4 * 2);
    expect(argsOf(all, 'moveTo').map(([x]) => x)).toEqual([0, 240, 480]);
    expect(argsOf(all, 'lineTo').map(([x]) => x)).toEqual([240, 480, 720]);
    // The rows grow over 70% of the day.
    expect(
      Math.max(...argsOf(all, 'fillRect').map(([x = 0, , width = 0]) => x + width))
    ).toBeCloseTo(480 + 168);

    // A day partly in view has its profile of the whole day.
    const second = paint(viewOf(bars, bars, { from: 30, to: 40 }), profile);
    expect(argsOf(second, 'moveTo').map(([x]) => x)).toEqual([240]);
  });

  it('follow the days of the calendar, its sessions and the bars it drops', () => {
    // Two days of sessions from 09:00 to 12:00 and from 13:00 to 16:00, every 30 minutes, with a
    // bar at 12:30 the calendar drops and one before the first session.
    const times = [8, 9, 10, 11, 12.5, 13, 14, 15].flatMap((hour) => [
      T0 + hour * HOUR,
      T0 + DAY + hour * HOUR
    ]);
    const bars = store(
      times
        .sort((left, right) => left - right)
        .map((time) => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 10 }))
    );
    const calendar = createCalendar({ timeZone: 'UTC', sessions: ['09:00-12:00', '13:00-16:00'] });
    const cache = new ProfileCache(settings({ mode: 'session' }));
    const days = [...cache.sessions(sourceOf(bars), calendar, 0, bars.length)];

    // Each day from its first session on, with the dropped bars after it, the next morning's too;
    // the first bar comes before any day.
    expect(days.map(({ start, end }) => [start, end])).toEqual([
      [1, 9],
      [9, 16]
    ]);
    expect(days[0]?.profile?.total).toBeCloseTo(80);
    expect(days[1]?.profile?.total).toBeCloseTo(70);
    expect([
      ...new ProfileCache(settings({})).sessions(sourceOf(bars), calendar, 4, 5)
    ]).toHaveLength(1);
  });

  it('start each day where the calendar does', () => {
    const bars = store(hourly(72));
    const cache = new ProfileCache(settings({ mode: 'session' }));
    const noon = createCalendar({ timeZone: 'UTC', dayStart: '12:00' });

    expect(
      [...cache.sessions(sourceOf(bars), noon, 0, 72)].map(({ start, end }) => [start, end])
    ).toEqual([
      [0, 12],
      [12, 36],
      [36, 60],
      [60, 72]
    ]);
  });
});

describe('the cache of a profile', () => {
  it('computes the profile again only once the bars or the bars in view change', () => {
    const bars = store(hourly(48));
    const { view, reads } = counted(bars);
    const cache = new ProfileCache(settings({}));

    cache.profile(view, 0, 48);
    expect(reads()).toBe(48);
    cache.profile(view, 0, 48);
    expect(reads()).toBe(48);
    cache.profile(view, 10, 48);
    expect(reads()).toBe(48 + 38);

    bars.replaceFrom(47, parseBars([{ ...hourly(48)[47], volume: 500 } as BarInput]));
    cache.profile(view, 10, 48);
    expect(reads()).toBe(48 + 38 * 2);
  });

  it('computes only the last day again as its bars tick', () => {
    const bars = store(hourly(72));
    const { view, reads } = counted(bars);
    const cache = new ProfileCache(settings({ mode: 'session' }));
    const days = () => [...cache.sessions(view, UTC, 0, 72)];

    const before = days();
    expect(reads()).toBe(72);
    bars.replaceFrom(71, parseBars([{ ...hourly(72)[71], volume: 1000 } as BarInput]));
    const after = days();

    expect(reads()).toBe(72 + 24);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]?.profile?.total).toBeCloseTo(
      (before[2]?.profile?.total ?? 0) + 1000 - (hourly(72)[71]?.volume ?? 0)
    );
  });

  it('computes the last day again as a replay reveals its bars, those past the view too', () => {
    const bars = store(hourly(72));
    let revealed = 60;
    // As a replay's view, which a move of its cutoff gives a revision of its own.
    let moves = 0;
    const source = new BarsReader(
      bars,
      () => revealed,
      () => moves
    );
    const cache = new ProfileCache(settings({ mode: 'session' }));
    const totals = () =>
      [...cache.sessions({ source, changes: bars }, UTC, 0, 50)].map((day) => day.profile?.total);
    const volume = (from: number, to: number) =>
      hourly(72)
        .slice(from, to)
        .reduce((total, bar) => total + (bar.volume ?? 0), 0);

    expect(totals()[2]).toBeCloseTo(volume(48, 60));
    revealed = 66;
    moves += 1;
    expect(totals()[2]).toBeCloseTo(volume(48, 66));
    expect(totals()[0]).toBeCloseTo(volume(0, 24));
  });

  it('keeps the profile of the bars in view while bars after them tick', () => {
    const bars = store(hourly(72));
    const { view, reads } = counted(bars);
    const cache = new ProfileCache(settings({}));

    cache.profile(view, 0, 48);
    bars.replaceFrom(71, parseBars([{ ...hourly(72)[71], volume: 1000 } as BarInput]));
    cache.profile(view, 0, 48);

    expect(reads()).toBe(48);
  });

  it('keeps the days still in view as the view moves, and none once the calendar changes', () => {
    const bars = store(hourly(96));
    const { view, reads } = counted(bars);
    const cache = new ProfileCache(settings({ mode: 'session' }));
    const days = (calendar: Calendar, start: number, end: number) =>
      [...cache.sessions(view, calendar, start, end)].length;

    expect(days(UTC, 0, 48)).toBe(2);
    expect(reads()).toBe(48);
    // A day more: only that one is computed.
    expect(days(UTC, 30, 72)).toBe(2);
    expect(reads()).toBe(72);
    expect(days(UTC, 30, 72)).toBe(2);
    expect(reads()).toBe(72);
    expect(days(createCalendar({ timeZone: 'UTC' }), 30, 72)).toBe(2);
    expect(reads()).toBe(72 + 48);
  });
});

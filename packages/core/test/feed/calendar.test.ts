import { describe, expect, it } from 'vitest';
import { createCalendar, type CalendarInput } from '../../src/feed/calendar';
import {
  canBuildTimeframe,
  checkTimeframe,
  formatInterval,
  intervalDuration,
  parseInterval
} from '../../src/feed/interval';

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

describe('intervalDuration', () => {
  it('gives the length of seconds, minutes and hours, and none of calendar units', () => {
    expect(intervalDuration('15s')).toBe(15_000);
    expect(intervalDuration('4h')).toBe(14_400_000);
    expect(intervalDuration({ unit: 'minute', count: 3 })).toBe(180_000);
    expect(intervalDuration('1D')).toBeNull();
    expect(intervalDuration('1M')).toBeNull();
    expect(() => intervalDuration('7x')).toThrow();
  });
});

describe('parseInterval', () => {
  it('reads shorthands and objects', () => {
    expect(parseInterval('15s')).toEqual({ unit: 'second', count: 15 });
    expect(parseInterval('5m')).toEqual({ unit: 'minute', count: 5 });
    expect(parseInterval('4H')).toEqual({ unit: 'hour', count: 4 });
    expect(parseInterval('D')).toEqual({ unit: 'day', count: 1 });
    expect(parseInterval('1w')).toEqual({ unit: 'week', count: 1 });
    expect(parseInterval('3M')).toEqual({ unit: 'month', count: 3 });
    expect(parseInterval({ unit: 'hour', count: 2 })).toEqual({ unit: 'hour', count: 2 });
    expect(formatInterval({ unit: 'day', count: 1 })).toBe('1D');
    expect(formatInterval('60m')).toBe('60m');
  });

  it('rejects anything else', () => {
    expect(() => parseInterval('5x')).toThrow('"5x" is not an interval');
    expect(() => parseInterval('0m')).toThrow('positive integer count');
    expect(() => parseInterval({ unit: 'year', count: 1 } as never)).toThrow('interval.unit');
    expect(() => parseInterval(5 as never)).toThrow('must be a string');
  });

  it('knows which timeframes a source can build', () => {
    const check = (target: string, source: string) => () => {
      checkTimeframe(target, source);
    };

    for (const [target, source] of [
      ['5m', '1m'],
      ['1h', '15m'],
      ['4h', '1h'],
      ['1D', '1m'],
      ['1W', '1D'],
      ['3M', '1M'],
      ['1M', '1D'],
      ['2D', '1D'],
      ['30s', '15s']
    ] as const) {
      expect(check(target, source)).not.toThrow();
    }

    expect(check('1m', '5m')).toThrow('finer than the source');
    expect(check('90s', '1m')).toThrow('90s is not a multiple of 1m');
    expect(check('1D', '7m')).toThrow('7m does not divide a day');
    expect(check('1W', '2D')).toThrow('built from 1D bars');
    expect(check('1M', '1W')).toThrow('do not divide each other');
    expect(check('1h', '1D')).toThrow('finer than the source');
    expect(check('1W', '2D')).toThrow(
      'The timeframe 1W cannot be built from 2D source bars: weeks and months are built from 1D bars.'
    );
    expect(check('5x', '1m')).toThrow('timeframe "5x" is not an interval');

    expect(canBuildTimeframe('4h', '1h')).toBe(true);
    expect(canBuildTimeframe({ unit: 'day', count: 1 }, '15m')).toBe(true);
    expect(canBuildTimeframe('1W', '2D')).toBe(false);
    expect(canBuildTimeframe('7D', '1W')).toBe(false);
  });
});

describe('createCalendar', () => {
  it('buckets fixed and calendar intervals in UTC', () => {
    const calendar = createCalendar({ timeZone: 'UTC' });
    const time = '2024-01-02T09:37:12Z';

    expect(iso(calendar.bucket(time, '5m'))).toBe('2024-01-02T09:35:00.000Z');
    expect(iso(calendar.bucket(time, '1h'))).toBe('2024-01-02T09:00:00.000Z');
    expect(iso(calendar.bucket(time, '4h'))).toBe('2024-01-02T08:00:00.000Z');
    expect(iso(calendar.bucket(time, '1D'))).toBe('2024-01-02T00:00:00.000Z');
    expect(iso(calendar.bucket(time, '2D'))).toBe('2024-01-02T00:00:00.000Z');
    expect(iso(calendar.bucket('2024-01-03T01:00:00Z', '2D'))).toBe('2024-01-02T00:00:00.000Z');
    expect(iso(calendar.bucket(time, '1W'))).toBe('2024-01-01T00:00:00.000Z');
    expect(iso(calendar.bucket(time, '1M'))).toBe('2024-01-01T00:00:00.000Z');
    expect(iso(calendar.bucket('2024-05-15T12:00:00Z', '3M'))).toBe('2024-04-01T00:00:00.000Z');
    expect(iso(calendar.bucket('2024-12-31T23:59:00Z', '12M'))).toBe('2024-01-01T00:00:00.000Z');
  });

  it('starts weeks on the configured weekday', () => {
    const calendar = createCalendar({ timeZone: 'UTC', weekStart: 0 });
    expect(iso(calendar.bucket('2024-01-02T09:00:00Z', '1W'))).toBe('2023-12-31T00:00:00.000Z');
  });

  it('aligns intraday bars to sessions and drops times outside them', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Shanghai',
      sessions: ['09:30-11:30', '13:00-15:00']
    });

    // 10:15, 11:15 and 13:30 Shanghai time.
    expect(iso(calendar.bucket('2024-05-06T02:15:00Z', '1h'))).toBe('2024-05-06T01:30:00.000Z');
    expect(iso(calendar.bucket('2024-05-06T03:15:00Z', '1h'))).toBe('2024-05-06T02:30:00.000Z');
    expect(iso(calendar.bucket('2024-05-06T05:30:00Z', '1h'))).toBe('2024-05-06T05:00:00.000Z');
    expect(calendar.bucket('2024-05-06T04:00:00Z', '1h')).toBeNull();
    // Daily bars are labelled with local midnight of the trading date.
    expect(iso(calendar.bucket('2024-05-06T02:15:00Z', '1D'))).toBe('2024-05-05T16:00:00.000Z');
  });

  it('moves night sessions to the next trading day', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Shanghai',
      sessions: ['21:00-02:30', '09:00-10:15', '10:30-11:30', '13:30-15:00'],
      dayStart: '21:00',
      weekdays: [1, 2, 3, 4, 5]
    });

    // Friday 22:00 belongs to Monday.
    expect(iso(calendar.bucket('2024-05-10T14:00:00Z', '1D'))).toBe('2024-05-12T16:00:00.000Z');
    // Friday 01:00 continues Thursday's night session and belongs to Friday.
    expect(iso(calendar.bucket('2024-05-09T17:00:00Z', '1D'))).toBe('2024-05-09T16:00:00.000Z');
    expect(iso(calendar.bucket('2024-05-09T17:20:00Z', '1h'))).toBe('2024-05-09T17:00:00.000Z');
    // 10:20 falls into the morning break.
    expect(calendar.bucket('2024-05-10T02:20:00Z', '1m')).toBeNull();
  });

  it('follows daylight saving changes', () => {
    const calendar = createCalendar({ timeZone: 'America/New_York' });

    expect(iso(calendar.bucket('2024-03-10T12:00:00Z', '1D'))).toBe('2024-03-10T05:00:00.000Z');
    expect(iso(calendar.bucket('2024-03-11T12:00:00Z', '1D'))).toBe('2024-03-11T04:00:00.000Z');
    expect(iso(calendar.bucket('2024-03-11T13:45:00Z', '1h'))).toBe('2024-03-11T13:00:00.000Z');
  });

  it('counts bars of several days in trading days', () => {
    const day = 86_400_000;
    const monday = Date.UTC(2024, 0, 1);
    const days = Array.from({ length: 28 }, (_, index) => monday + index * day + 12 * 3_600_000);

    for (const weekdays of [
      [1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4],
      [1, 3, 5]
    ]) {
      const calendar = createCalendar({ timeZone: 'UTC', weekdays });
      const trading = days.filter((time) => weekdays.includes(new Date(time).getUTCDay()));

      for (const count of [2, 3]) {
        const groups = new Map<number | null, number[]>();
        trading.forEach((time) => {
          const bucket = calendar.bucket(time, `${count}D`);
          groups.set(bucket, [...(groups.get(bucket) ?? []), time]);
        });
        const [, ...whole] = [...groups.values()].slice(0, -1);

        // Each bar takes that many trading days in a row, dated at the midnight of its first.
        for (const group of whole) {
          expect(group).toHaveLength(count);
          expect(calendar.bucket(group[0] ?? 0, `${count}D`)).toBe(
            (group[0] ?? 0) - 12 * 3_600_000
          );
          expect(trading.indexOf(group.at(-1) ?? 0) - trading.indexOf(group[0] ?? 0)).toBe(
            count - 1
          );
        }
      }
    }

    // The days the market is closed move into the bar of the next trading day, as for 1D.
    const weekdays = createCalendar({ timeZone: 'UTC', weekdays: [1, 2, 3, 4, 5] });
    const saturday = Date.UTC(2024, 0, 6, 12);
    expect(weekdays.bucket(saturday, '2D')).toBe(weekdays.bucket(saturday + 2 * day, '2D'));
  });

  it('lets the bucket hook drop holidays and reuse the built-in result', () => {
    const holiday = Date.UTC(2024, 0, 1);
    const calendar = createCalendar({
      timeZone: 'UTC',
      bucket: (time, _interval, fallback) =>
        time >= holiday && time < holiday + 86_400_000 ? null : fallback(time)
    });

    expect(calendar.bucket('2024-01-01T10:00:00Z', '1h')).toBeNull();
    expect(iso(calendar.bucket('2024-01-02T10:20:00Z', '1h'))).toBe('2024-01-02T10:00:00.000Z');
  });

  it('validates its options and the hook result', () => {
    expect(() => createCalendar({ sessions: ['9:30-11:30'] })).toThrow('"09:30"');
    expect(() => createCalendar({ sessions: ['09:30-11:30', '11:00-12:00'] })).toThrow('overlaps');
    expect(() => createCalendar({ sessions: ['20:00-02:00'] })).toThrow('spans the start');
    expect(() => createCalendar({ weekdays: [] })).toThrow('at least one weekday');
    expect(() => createCalendar({ weekdays: [1, 1] })).toThrow('contains 1 twice');
    expect(() => createCalendar({ timeZone: 'Mars/Base' })).toThrow('not a valid IANA time zone');

    const broken = createCalendar({ timeZone: 'UTC', bucket: () => Number.NaN });
    expect(() => broken.bucket(0, '1m')).toThrow('must return a time or null');
  });
});

describe('calendar ranges', () => {
  const range = (calendar: ReturnType<typeof createCalendar>, time: string, interval: string) => {
    const found = calendar.range(time, interval);
    return found && { bucket: iso(found.bucket), start: iso(found.start), end: iso(found.end) };
  };

  it('give the bar of a time and the run of times that belong to it', () => {
    const calendar = createCalendar({ timeZone: 'UTC' });

    expect(range(calendar, '2024-01-02T09:37:12Z', '15m')).toEqual({
      bucket: '2024-01-02T09:30:00.000Z',
      start: '2024-01-02T09:30:00.000Z',
      end: '2024-01-02T09:45:00.000Z'
    });
    // A bar that does not divide the day ends with it.
    expect(range(calendar, '2024-01-02T22:00:00Z', '5h')).toEqual({
      bucket: '2024-01-02T20:00:00.000Z',
      start: '2024-01-02T20:00:00.000Z',
      end: '2024-01-03T00:00:00.000Z'
    });
    expect(range(calendar, '2024-01-03T12:00:00Z', '1W')).toEqual({
      bucket: '2024-01-01T00:00:00.000Z',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-08T00:00:00.000Z'
    });
    expect(range(calendar, '2024-02-29T12:00:00Z', '3M')).toEqual({
      bucket: '2024-01-01T00:00:00.000Z',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-04-01T00:00:00.000Z'
    });
  });

  it('follow sessions, trading days and weekdays', () => {
    const shanghai = createCalendar({
      timeZone: 'Asia/Shanghai',
      sessions: ['09:30-11:30', '13:00-15:00']
    });

    // 11:15 Shanghai time: the 10:30 hour bar is cut short by the lunch break.
    expect(range(shanghai, '2024-05-06T03:15:00Z', '1h')).toEqual({
      bucket: '2024-05-06T02:30:00.000Z',
      start: '2024-05-06T02:30:00.000Z',
      end: '2024-05-06T03:30:00.000Z'
    });
    // A day bar takes the morning and the afternoon session, each a run.
    expect(range(shanghai, '2024-05-06T05:30:00Z', '1D')).toEqual({
      bucket: '2024-05-05T16:00:00.000Z',
      start: '2024-05-06T05:00:00.000Z',
      end: '2024-05-06T07:00:00.000Z'
    });
    expect(shanghai.range('2024-05-06T04:00:00Z', '1h')).toBeNull();

    // FX: days from 17:00 New York time, Friday evening on to Monday.
    const fx = createCalendar({
      timeZone: 'America/New_York',
      dayStart: '17:00',
      weekdays: [1, 2, 3, 4, 5]
    });
    expect(range(fx, '2024-05-11T12:00:00Z', '1D')).toEqual({
      bucket: '2024-05-13T04:00:00.000Z',
      start: '2024-05-10T21:00:00.000Z',
      end: '2024-05-13T21:00:00.000Z'
    });
  });

  it('agree with bucket() on every time of a run', () => {
    const configs: CalendarInput[] = [
      { timeZone: 'America/New_York', sessions: ['09:30-16:00'], weekdays: [1, 2, 3, 4, 5] },
      { timeZone: 'Europe/Berlin', dayStart: '02:30', weekStart: 0 },
      { timeZone: 'Africa/Cairo', weekdays: [0, 1, 2, 3, 4] },
      {
        timeZone: 'Asia/Shanghai',
        sessions: ['21:00-02:30', '09:00-10:15', '10:30-11:30', '13:30-15:00'],
        dayStart: '21:00',
        weekdays: [1, 2, 3, 4, 5]
      }
    ];
    let seed = 1;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };

    // In a session of every calendar, far from the times checked: asking for it first moves
    // the calendar off any run it knows, so the next time is computed from scratch.
    const away = Date.UTC(2000, 0, 5, 15);

    for (const config of configs) {
      const calendar = createCalendar(config);
      const checker = createCalendar(config);

      for (const interval of ['1m', '45m', '4h', '1D', '2D', '1W', '1M']) {
        const bucket = (time: number) => {
          checker.bucket(away, interval);
          return checker.bucket(time, interval);
        };

        for (let sample = 0; sample < 150; sample += 1) {
          // Around the daylight-saving changes of 2024 and in between.
          const time = Date.UTC(2024, 2, 1) + Math.floor(random() * 240 * 86_400_000);
          const found = calendar.range(time, interval);
          expect(found?.bucket ?? null).toBe(bucket(time));

          if (found) {
            const { start, end } = found;
            expect(start <= time && time < end).toBe(true);

            for (const at of [start, end - 1, start + Math.floor(random() * (end - start))]) {
              expect(bucket(at)).toBe(found.bucket);
            }
          }
        }
      }
    }
  });

  it('hold the time alone near a daylight-saving change and with the bucket hook', () => {
    // Clocks in Cairo went from midnight to 01:00 on 2024-04-26: the day starts at the change.
    const cairo = createCalendar({ timeZone: 'Africa/Cairo' });
    expect(range(cairo, '2024-04-26T08:00:00Z', '1D')).toEqual({
      bucket: '2024-04-25T22:00:00.000Z',
      start: '2024-04-26T08:00:00.000Z',
      end: '2024-04-26T08:00:00.001Z'
    });

    const hooked = createCalendar({
      timeZone: 'UTC',
      bucket: (time, _interval, fallback) => fallback(time)
    });
    expect(range(hooked, '2024-01-02T09:37:00Z', '1h')).toEqual({
      bucket: '2024-01-02T09:00:00.000Z',
      start: '2024-01-02T09:37:00.000Z',
      end: '2024-01-02T09:37:00.001Z'
    });
  });
});

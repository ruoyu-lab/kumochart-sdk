import { describeTime, toTime, type TimeInput } from '../data/time';
import { Clock } from '../format/clock';
import { parseCalendar, type CalendarSpec } from '../options/calendar';
import { createDefaultOptions } from '../options/defaults';
import type { CalendarOptions } from '../options/types';
import { describeValue, fail } from '../utils/errors';
import { deepMerge } from '../utils/merge';
import { checkFields, checkTimeZone, fieldsOf } from '../utils/validate';
import { DAY_MS, fixedMs, parseInterval, type Interval, type IntervalInput } from './interval';

const MINUTE_MS = 60_000;
/** 1970-01-01 was a Thursday. */
const EPOCH_WEEKDAY = 4;
/**
 * A run of times ends at a wall-clock time only where the zone's offset holds this long either
 * side of it: a daylight-saving change closer than that may move times across the boundary.
 */
const STEADY_MS = 3 * 3_600_000;

/** Maps a time to the start of its bucket, or to `null` when the time is dropped. */
export type Bucketer = (time: number) => number | null;

/** A run of times that the calendar puts into one bar, from {@link Calendar.range}. */
export interface CalendarRange {
  /** Start of the bar, as `bucket()` returns it. */
  readonly bucket: number;
  /** The first time of the run. */
  readonly start: number;
  /** The end of the run, excluded. */
  readonly end: number;
}

/** Buckets times into bars of any interval, following a trading calendar. */
export interface Calendar {
  /** Start of the bar of `interval` that `time` belongs to, or `null` when the calendar drops it. */
  bucket(time: TimeInput, interval: IntervalInput): number | null;
  /**
   * The bar of `interval` that `time` belongs to and the run of times around `time` that belong
   * to it too, or `null` when the calendar drops the time. Every time from `start` up to `end`
   * has the same `bucket`, so a caller going through times in order asks again only from `end`
   * on. A bar can take several runs, such as a day bar its morning and afternoon sessions. The
   * run is the millisecond of `time` alone with the `bucket` option, whose results cannot be
   * foreseen, and where a daylight-saving change comes close to a bar boundary.
   */
  range(time: TimeInput, interval: IntervalInput): CalendarRange | null;
}

/** Options of {@link createCalendar}; `timeZone` defaults to the runtime's local zone. */
export type CalendarInput = Partial<CalendarOptions>;

/** A {@link CalendarRange} that bucketers fill in place. */
interface Run {
  bucket: number;
  start: number;
  end: number;
}

/** A session, or a trading day without sessions: bars of fixed intervals divide it. */
interface Segment {
  /** The instant it starts at, which bars of fixed intervals count from. */
  readonly origin: number;
  /** Its start and end, `NaN` close to a daylight-saving change. */
  readonly start: number;
  readonly end: number;
  /** Days since 1970-01-01 of the date its times belong to, before weekdays move it. */
  readonly date: number;
}

function weekday(day: number): number {
  return (((day + EPOCH_WEEKDAY) % 7) + 7) % 7;
}

/** The calendar behind the chart's timeframes and {@link createCalendar}. */
export class CalendarModel implements Calendar {
  private readonly clock: Clock;
  /** Wall-clock time from a date's midnight to where its times start: `dayStart` the day before. */
  private readonly dateOffset: number;
  /**
   * Callers such as indicators ask for one interval bar after bar, so its bucketer is kept, with
   * the run it found last.
   */
  private recent: {
    readonly input: IntervalInput;
    readonly run: Run;
    readonly bucketer: Bucketer;
  } | null = null;
  /** The segment found last, which the next times usually fall into. */
  private latest: Segment | null = null;
  /** The trading day found last for a dated bar, around its sessions. */
  private latestDay: Segment | null = null;
  /** The trading weekdays of a week from a Thursday, as 1970-01-01 was, in days from it. */
  private readonly tradingWeek: readonly number[];

  constructor(
    private readonly spec: CalendarSpec,
    /** The zone it is defined in, such as `UTC`. */
    readonly timeZone: string,
    private readonly path: string
  ) {
    this.clock = new Clock(timeZone);
    this.dateOffset = spec.dayStart === 0 ? 0 : spec.dayStart * MINUTE_MS - DAY_MS;
    this.tradingWeek = [0, 1, 2, 3, 4, 5, 6].filter((day) => spec.weekdays[weekday(day)]);
  }

  bucket(time: TimeInput, interval: IntervalInput): number | null {
    return this.cached(interval).bucketer(toTime(time));
  }

  range(time: TimeInput, interval: IntervalInput): CalendarRange | null {
    const at = toTime(time);
    const { run, bucketer } = this.cached(interval);
    const bucket = bucketer(at);

    if (bucket === null) {
      return null;
    }

    return this.spec.bucket ? { bucket, start: at, end: at + 1 } : { ...run };
  }

  private cached(input: IntervalInput): NonNullable<CalendarModel['recent']> {
    if (this.recent?.input !== input) {
      const run: Run = { bucket: 0, start: 0, end: 0 };
      this.recent = { input, run, bucketer: this.bucketer(parseInterval(input), run) };
    }

    return this.recent;
  }

  /**
   * Buckets times into bars of `interval`, keeping the latest run found in `run` (empty at
   * first); results of the `bucket` option are validated. `dated` buckets bars of days, weeks or
   * months by the trading date of their time wherever in it the time is, outside the sessions
   * too: such bars are dated, at midnight, at the open or at the close, rather than timed.
   */
  bucketer(
    interval: Interval,
    run: Run = { bucket: 0, start: 0, end: 0 },
    dated = false
  ): Bucketer {
    const whole = dated && fixedMs(interval) === null;
    const fallback: Bucketer = (time) =>
      (time >= run.start && time < run.end) || this.locate(time, interval, run, whole)
        ? run.bucket
        : null;
    const hook = this.spec.bucket;

    if (!hook) {
      return fallback;
    }

    return (time) => {
      const result: unknown = hook(time, interval, fallback);

      if (result !== null && (typeof result !== 'number' || !Number.isFinite(result))) {
        fail(
          `${this.path}.bucket must return a time or null, received ${describeValue(result)} for ${describeTime(time)}.`
        );
      }

      return result;
    };
  }

  /**
   * Fills `run` with the bar of `interval` holding `time`; false when the time is dropped. With
   * `whole`, the time is in its trading day around the sessions.
   */
  private locate(time: number, interval: Interval, run: Run, whole: boolean): boolean {
    const segment = whole ? this.day(time) : this.segment(time);

    if (segment === null) {
      return false;
    }

    const ms = fixedMs(interval);
    let { start, end } = segment;

    if (ms !== null) {
      const { origin } = segment;
      run.bucket = origin + Math.floor((time - origin) / ms) * ms;
      start = Number.isNaN(start) ? start : run.bucket;
      end = Math.min(run.bucket + ms, end);
    } else {
      // The bar's trading dates: [first, next).
      const trading = this.trading(segment.date, 1);
      const { count } = interval;
      let first: number;
      let next: number;

      switch (interval.unit) {
        case 'day': {
          // Bars of several days take as many trading dates, in turn from 1970-01-01 on.
          const group = Math.floor(this.tradingDates(trading) / count) * count;
          first = this.tradingDate(group);
          next = this.tradingDate(group + count);
          break;
        }
        case 'week': {
          const week = trading - ((weekday(trading) - this.spec.weekStart + 7) % 7);
          // The first week start on or before 1970-01-01 anchors groups of several weeks.
          const anchor = -((EPOCH_WEEKDAY - this.spec.weekStart + 7) % 7);
          first = anchor + Math.floor((week - anchor) / 7 / count) * count * 7;
          next = first + count * 7;
          break;
        }
        default: {
          const date = new Date(trading * DAY_MS);
          const month =
            Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth()) / count) * count;
          first = Date.UTC(Math.floor(month / 12), month % 12, 1) / DAY_MS;
          next = Date.UTC(Math.floor(month / 12), (month % 12) + count, 1) / DAY_MS;
        }
      }

      run.bucket = this.clock.instant(first * DAY_MS);

      // A session lies within one date. Without sessions, the run takes every date moving into
      // the bar's, such as a weekend into Monday.
      if (this.spec.sessions.length === 0) {
        start = this.movingInto(first);
        end = this.movingInto(next);
      }
    }

    const known = !Number.isNaN(start + end);
    run.start = known ? start : time;
    run.end = known ? end : time + 1;
    return true;
  }

  /** The trading day containing the time, around its sessions. */
  private day(time: number): Segment {
    const latest = this.latestDay;

    if (latest !== null && time >= latest.start && time < latest.end) {
      return latest;
    }

    const wall = time + this.clock.offset(time);
    const date = Math.floor((wall - this.dateOffset) / DAY_MS);
    const start = date * DAY_MS + this.dateOffset;
    this.latestDay = {
      origin: this.clock.instant(start),
      start: this.steady(start),
      end: this.steady(start + DAY_MS),
      date
    };
    return this.latestDay;
  }

  /** The session or trading day containing the time, or `null` outside every session. */
  private segment(time: number): Segment | null {
    const latest = this.latest;

    if (latest !== null && time >= latest.start && time < latest.end) {
      return latest;
    }

    const wall = time + this.clock.offset(time);
    const date = Math.floor((wall - this.dateOffset) / DAY_MS);
    let start = date * DAY_MS + this.dateOffset;
    let end = start + DAY_MS;

    if (this.spec.sessions.length > 0) {
      const session = this.session(wall);

      if (session === null) {
        return null;
      }

      [start, end] = session;
    }

    this.latest = {
      origin: this.clock.instant(start),
      start: this.steady(start),
      end: this.steady(end),
      date
    };
    return this.latest;
  }

  /** Wall-clock start and end of the session containing `wall`, or `null` outside them all. */
  private session(wall: number): [number, number] | null {
    const day = Math.floor(wall / DAY_MS) * DAY_MS;

    for (const { start, end } of this.spec.sessions) {
      // A session crossing midnight began the day before for the times before its end.
      const from = (start - (start > end && wall - day < end * MINUTE_MS ? 1440 : 0)) * MINUTE_MS;
      const to = from + ((end - start + 1440) % 1440) * MINUTE_MS;

      if (wall >= day + from && wall < day + to) {
        return [day + from, day + to];
      }
    }

    return null;
  }

  /** Where the times that move into trading date `date` start: after the trading date before. */
  private movingInto(date: number): number {
    return this.steady((this.trading(date - 1, -1) + 1) * DAY_MS + this.dateOffset);
  }

  /** How many trading dates there are from 1970-01-01 up to `date`, which is excluded. */
  private tradingDates(date: number): number {
    const week = Math.floor(date / 7);
    const day = date - week * 7;
    return (
      week * this.tradingWeek.length + this.tradingWeek.filter((trading) => trading < day).length
    );
  }

  /** The trading date that many trading dates after 1970-01-01, the inverse of tradingDates(). */
  private tradingDate(count: number): number {
    const week = Math.floor(count / this.tradingWeek.length);
    return week * 7 + (this.tradingWeek[count - week * this.tradingWeek.length] ?? Number.NaN);
  }

  /** The first trading date from `date` on, going by `step` days. */
  private trading(date: number, step: 1 | -1): number {
    let trading = date;

    while (!this.spec.weekdays[weekday(trading)]) {
      trading += step;
    }

    return trading;
  }

  /**
   * The instant the wall clock shows `wall`, or `NaN` when the zone's offset changes within
   * {@link STEADY_MS} of it: times there cannot be told apart by their wall-clock time alone.
   */
  private steady(wall: number): number {
    const instant = this.clock.instant(wall);
    const offset = this.clock.offset(instant);
    return instant + offset === wall &&
      this.clock.offset(instant - STEADY_MS) === offset &&
      this.clock.offset(instant + STEADY_MS) === offset
      ? instant
      : Number.NaN;
  }
}

const INPUT_FIELDS = fieldsOf<CalendarInput>({
  timeZone: true,
  sessions: true,
  dayStart: true,
  weekdays: true,
  weekStart: true,
  bucket: true
});

/**
 * Creates the calendar the chart uses to build timeframes, for aligning your own data. Options
 * are those of the chart's `calendar` option; `timeZone` defaults to `UTC`, as there.
 *
 * ```ts
 * const calendar = createCalendar({ timeZone: 'Asia/Shanghai', sessions: ['09:30-11:30', '13:00-15:00'] });
 * calendar.bucket('2024-05-06T02:15:00Z', '1h'); // 09:30 Shanghai time, the bar 10:15 falls in
 * ```
 */
export function createCalendar(input: CalendarInput = {}): Calendar {
  checkFields('calendar', input, INPUT_FIELDS);
  const options = deepMerge<CalendarOptions>(createDefaultOptions().calendar, input);
  const zone = checkTimeZone('calendar.timeZone', options.timeZone);
  const model = new CalendarModel(parseCalendar(options, 'calendar'), zone, 'calendar');
  return {
    bucket: (time, interval) => model.bucket(time, interval),
    range: (time, interval) => model.range(time, interval)
  };
}

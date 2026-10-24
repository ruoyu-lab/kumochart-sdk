import { describeValue, fail } from '../utils/errors';
import { checkArray, checkFunctionOrNull, checkNumber, checkString } from '../utils/validate';
import type { CalendarBucket, CalendarOptions } from './types';

const MINUTES_PER_DAY = 1440;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A trading session in minutes after midnight; `end < start` crosses midnight. */
export interface Session {
  readonly start: number;
  readonly end: number;
}

/** Calendar options parsed into numbers. */
export interface CalendarSpec {
  readonly sessions: readonly Session[];
  /** Minutes after midnight. */
  readonly dayStart: number;
  /** Trading flag per weekday, Sunday first. */
  readonly weekdays: readonly boolean[];
  readonly weekStart: number;
  readonly bucket: CalendarBucket | null;
}

/** Minutes after midnight of an `'HH:MM'` wall-clock time. */
function parseClockTime(path: string, value: unknown): number {
  const match = typeof value === 'string' ? CLOCK_TIME.exec(value) : null;

  if (!match) {
    return fail(`${path} must be a time of day such as "09:30", received ${describeValue(value)}.`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function parseSession(path: string, value: unknown): Session {
  const text = checkString(path, value);
  const [start, end, extra] = text.split('-');

  if (start === undefined || end === undefined || extra !== undefined) {
    fail(`${path} must be a session such as "09:30-11:30", received ${JSON.stringify(text)}.`);
  }

  const session = { start: parseClockTime(path, start), end: parseClockTime(path, end) };

  if (session.start === session.end) {
    fail(`${path} ${JSON.stringify(text)} has no length.`);
  }

  return session;
}

/** Minute ranges of a session within one day; a session crossing midnight has two. */
function ranges(session: Session): Array<[number, number]> {
  return session.start < session.end
    ? [[session.start, session.end]]
    : [
        [session.start, MINUTES_PER_DAY],
        [0, session.end]
      ];
}

/** Whether `minute` lies strictly inside the session. */
function containsInside(session: Session, minute: number): boolean {
  return session.start < session.end
    ? minute > session.start && minute < session.end
    : minute > session.start || minute < session.end;
}

function checkSessions(sessions: readonly Session[], texts: readonly string[], path: string): void {
  sessions.forEach((session, index) => {
    for (let other = 0; other < index; other += 1) {
      const previous = sessions[other];
      const overlaps =
        previous !== undefined &&
        ranges(session).some(([start, end]) =>
          ranges(previous).some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end)
        );

      if (overlaps) {
        fail(
          `${path}.sessions[${index}] ${JSON.stringify(texts[index])} overlaps ${path}.sessions[${other}] ${JSON.stringify(texts[other])}.`
        );
      }
    }
  });
}

/** Validates calendar options (without the time zone) and parses them into numbers. */
export function parseCalendar(
  calendar: Omit<CalendarOptions, 'timeZone'>,
  path: string
): CalendarSpec {
  checkArray(`${path}.sessions`, calendar.sessions);
  const texts = calendar.sessions.map((text, index) =>
    checkString(`${path}.sessions[${index}]`, text)
  );
  const sessions = texts.map((text, index) => parseSession(`${path}.sessions[${index}]`, text));
  checkSessions(sessions, texts, path);
  const dayStart = parseClockTime(`${path}.dayStart`, calendar.dayStart);

  sessions.forEach((session, index) => {
    if (containsInside(session, dayStart)) {
      fail(
        `${path}.sessions[${index}] ${JSON.stringify(texts[index])} spans the start of the trading day (${calendar.dayStart}); set ${path}.dayStart to the time the trading day begins.`
      );
    }
  });

  checkArray(`${path}.weekdays`, calendar.weekdays);

  if (calendar.weekdays.length === 0) {
    fail(`${path}.weekdays must contain at least one weekday.`);
  }

  const weekdays = Array.from({ length: 7 }, () => false);
  calendar.weekdays.forEach((day, index) => {
    const weekday = checkNumber(`${path}.weekdays[${index}]`, day, {
      min: 0,
      max: 6,
      integer: true
    });

    if (weekdays[weekday]) {
      fail(`${path}.weekdays contains ${weekday} twice.`);
    }

    weekdays[weekday] = true;
  });

  const weekStart = checkNumber(`${path}.weekStart`, calendar.weekStart, {
    min: 0,
    max: 6,
    integer: true
  });
  checkFunctionOrNull(`${path}.bucket`, calendar.bucket);

  return { sessions, dayStart, weekdays, weekStart, bucket: calendar.bucket };
}

function sameList(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Whether two calendars bucket times identically. */
export function sameCalendar(left: CalendarOptions, right: CalendarOptions): boolean {
  return (
    left === right ||
    (left.timeZone === right.timeZone &&
      left.dayStart === right.dayStart &&
      left.weekStart === right.weekStart &&
      left.bucket === right.bucket &&
      sameList(left.sessions, right.sessions) &&
      sameList(left.weekdays, right.weekdays))
  );
}

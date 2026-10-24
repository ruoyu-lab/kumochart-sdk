import { describeValue, fail } from '../utils/errors';

export type IntervalUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';

/** A bar resolution, such as 5 minutes or 1 day. */
export interface Interval {
  readonly unit: IntervalUnit;
  /** A positive integer. */
  readonly count: number;
}

/**
 * An {@link Interval} or its shorthand `<count><unit>`: `s` second, `m` minute, `h` hour, `D` day,
 * `W` week, `M` month (`H`, `d` and `w` work too; only `m` and `M` differ by case). The count may
 * be omitted: `'D'` is `'1D'`.
 */
export type IntervalInput = Interval | string;

export const DAY_MS = 86_400_000;

const UNITS: readonly IntervalUnit[] = ['second', 'minute', 'hour', 'day', 'week', 'month'];
const FIXED_MS: Readonly<Partial<Record<IntervalUnit, number>>> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000
};
/** Days in a day, a week and a month, as their nominal lengths count them. */
const NOMINAL_DAYS: Readonly<Partial<Record<IntervalUnit, number>>> = {
  day: 1,
  week: 7,
  month: 30
};
const SYMBOLS: Readonly<Record<string, IntervalUnit>> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  H: 'hour',
  d: 'day',
  D: 'day',
  w: 'week',
  W: 'week',
  M: 'month'
};
const CANONICAL: Readonly<Record<IntervalUnit, string>> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'D',
  week: 'W',
  month: 'M'
};
const SHORTHAND = /^(\d*)([smhHdDwWM])$/;

function create(unit: IntervalUnit, count: number, label: string, input: unknown): Interval {
  if (!Number.isSafeInteger(count) || count < 1) {
    fail(`${label} needs a positive integer count, received ${describeValue(input)}.`);
  }

  return Object.freeze({ unit, count });
}

/**
 * Parses an interval such as `'5m'`, `'4h'`, `'1D'` or `{ unit: 'week', count: 1 }`. Throws a
 * `ChartError` for anything else.
 */
export function parseInterval(input: IntervalInput, label = 'interval'): Interval {
  const value: unknown = input;

  if (typeof value === 'string') {
    const match = SHORTHAND.exec(value);
    const unit = match ? SYMBOLS[match[2] ?? ''] : undefined;

    if (!match || !unit) {
      return fail(
        `${label} ${JSON.stringify(value)} is not an interval; use a count and a unit such as "15s", "5m", "4h", "1D", "1W" or "3M".`
      );
    }

    return create(unit, match[1] ? Number(match[1]) : 1, label, value);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(
      `${label} must be a string such as "5m" or an object { unit, count }, received ${describeValue(value)}.`
    );
  }

  const { unit, count } = value as { unit: unknown; count: unknown };

  if (!UNITS.includes(unit as IntervalUnit)) {
    fail(
      `${label}.unit must be one of ${UNITS.map((item) => `"${item}"`).join(', ')}, received ${describeValue(unit)}.`
    );
  }

  return create(unit as IntervalUnit, count as number, label, count);
}

/** The canonical shorthand of an interval: `15s`, `5m`, `4h`, `1D`, `1W`, `3M`. */
export function formatInterval(interval: IntervalInput): string {
  const { unit, count } = parseInterval(interval);
  return `${count}${CANONICAL[unit]}`;
}

/** Length in milliseconds of a second, minute or hour interval; `null` for calendar units. */
export function fixedMs(interval: Interval): number | null {
  const unit = FIXED_MS[interval.unit];
  return unit === undefined ? null : unit * interval.count;
}

/**
 * The nominal length of an interval in milliseconds, which tells which of two intervals of any
 * units is longer: seconds, minutes and hours as they are, a day as 24 hours, a week as 7 days and
 * a month as 30 days, whatever the trading calendar makes of them.
 */
export function nominalMs(interval: Interval): number {
  return fixedMs(interval) ?? (NOMINAL_DAYS[interval.unit] ?? 0) * DAY_MS * interval.count;
}

/**
 * The length in milliseconds of an interval of seconds, minutes or hours, such as `'15m'`;
 * `null` for days, weeks and months, whose lengths the trading calendar gives.
 */
export function intervalDuration(interval: IntervalInput): number | null {
  return fixedMs(parseInterval(interval));
}

export function sameInterval(left: Interval | null, right: Interval | null): boolean {
  return left === right || (left?.unit === right?.unit && left?.count === right?.count);
}

/** Why `target` bars cannot be built from `source` bars, or `null` when they can. */
function incompatibility(target: Interval, source: Interval): string | null {
  const targetMs = fixedMs(target);
  const sourceMs = fixedMs(source);
  const finer = 'it is finer than the source';

  if (sourceMs !== null) {
    if (targetMs !== null) {
      if (targetMs < sourceMs) {
        return finer;
      }

      return targetMs % sourceMs === 0
        ? null
        : `${formatInterval(target)} is not a multiple of ${formatInterval(source)}`;
    }

    return DAY_MS % sourceMs === 0 ? null : `${formatInterval(source)} does not divide a day`;
  }

  if (targetMs !== null) {
    return finer;
  }

  if (target.unit === source.unit) {
    if (target.count < source.count) {
      return finer;
    }

    return target.count % source.count === 0
      ? null
      : `${formatInterval(target)} is not a multiple of ${formatInterval(source)}`;
  }

  if (source.unit === 'day') {
    return source.count === 1 ? null : 'weeks and months are built from 1D bars';
  }

  return target.unit === 'day' ? finer : 'weeks and months do not divide each other';
}

/**
 * Throws unless bars of `timeframe` can be built from bars of the `source` interval, saying why,
 * as `chart.setTimeframe()` does: `checkTimeframe('1W', '2D')` throws, as weeks are built from
 * 1D bars.
 */
export function checkTimeframe(timeframe: IntervalInput, source: IntervalInput): void {
  const target = parseInterval(timeframe, 'timeframe');
  const from = parseInterval(source);
  const reason = incompatibility(target, from);

  if (reason !== null) {
    fail(
      `The timeframe ${formatInterval(target)} cannot be built from ${formatInterval(from)} source bars: ${reason}.`
    );
  }
}

/**
 * Whether bars of `timeframe` can be built from bars of the `source` interval: a multiple of it,
 * or days, weeks and months from bars that divide a day. `canBuildTimeframe('4h', '1h')` is true.
 */
export function canBuildTimeframe(timeframe: IntervalInput, source: IntervalInput): boolean {
  return incompatibility(parseInterval(timeframe, 'timeframe'), parseInterval(source)) === null;
}

import type { TimeUnit } from '../options/types';
import { Clock } from './clock';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Locale- and time-zone-aware number and date formatting for one chart. */
export class Formatter {
  readonly clock: Clock;
  private readonly numberFormats = new Map<number, Intl.NumberFormat>();
  private readonly compactFormat: Intl.NumberFormat;
  private readonly smallFormat: Intl.NumberFormat;
  private readonly tinyFormat: Intl.NumberFormat;
  private readonly timeFormats: Record<TimeUnit, Intl.DateTimeFormat>;
  private readonly dayFormat: Intl.DateTimeFormat;
  private readonly minuteFormat: Intl.DateTimeFormat;
  private readonly secondFormat: Intl.DateTimeFormat;

  /** The locale it writes in: the one it was given, or the runtime's. */
  readonly locale: string;
  /** The zone it shows times in: the one it was given, or the local one. */
  readonly timeZone: string;
  private readonly given: string | undefined;

  /** Writes in `locale` and shows times in `timeZone`; `null` takes the runtime's and the local one. */
  constructor(locale: string | null, timeZone: string | null) {
    this.given = locale ?? undefined;
    this.clock = new Clock(timeZone);
    this.compactFormat = new Intl.NumberFormat(this.given, {
      notation: 'compact',
      maximumFractionDigits: 2
    });
    this.smallFormat = new Intl.NumberFormat(this.given, { maximumSignificantDigits: 3 });
    this.tinyFormat = new Intl.NumberFormat(this.given, {
      notation: 'scientific',
      maximumSignificantDigits: 3
    });
    const date = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(this.given, { timeZone: timeZone ?? undefined, ...options });
    const zone = date({}).resolvedOptions();
    this.locale = this.compactFormat.resolvedOptions().locale;
    this.timeZone = zone.timeZone;
    const clockTime: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    };

    this.timeFormats = {
      year: date({ year: 'numeric' }),
      month: date({ month: 'short' }),
      day: date({ day: 'numeric' }),
      hour: date(clockTime),
      minute: date(clockTime),
      second: date({ ...clockTime, second: '2-digit' })
    };
    this.dayFormat = date({ year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
    this.minuteFormat = date({ year: 'numeric', month: 'short', day: 'numeric', ...clockTime });
    this.secondFormat = date({
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...clockTime,
      second: '2-digit'
    });
  }

  number(value: number, precision: number): string {
    let format = this.numberFormats.get(precision);

    if (!format) {
      format = new Intl.NumberFormat(this.given, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
      });
      this.numberFormats.set(precision, format);
    }

    return format.format(value);
  }

  /**
   * A value of any size in few characters: `1.25M` and `12.35` from 1 up, three significant
   * digits under it, such as `0.00412`, and in scientific notation under 0.0001, such as
   * `4.12E-10`, so that no value reads as 0 but 0.
   */
  compact(value: number): string {
    const size = Math.abs(value);

    if (size === 0 || size >= 1) {
      return this.compactFormat.format(value);
    }

    return (size < 1e-4 ? this.tinyFormat : this.smallFormat).format(value);
  }

  timeTick(time: number, unit: TimeUnit): string {
    return this.timeFormats[unit].format(time);
  }

  /** Full date label for the crosshair; precision follows the bar interval. */
  timeCrosshair(time: number, interval: number | null): string {
    if (interval !== null && interval >= DAY_MS) {
      return this.dayFormat.format(time);
    }

    if (interval !== null && interval < MINUTE_MS) {
      return this.secondFormat.format(time);
    }

    return this.minuteFormat.format(time);
  }

  /** Countdown such as `42`, `03:05`, `1:02:03` or `2d 03:00:00`, the days written by `days`. */
  duration(milliseconds: number, days: (count: number) => string): string {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const dayCount = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, '0');

    if (dayCount > 0) {
      return `${days(dayCount)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }

    return `${pad(minutes)}:${pad(seconds)}`;
  }
}

/**
 * Number of decimals needed to show `value` exactly, and values that needed `atLeast`, capped at
 * `max`: folded over values, the decimals that show them all.
 */
export function decimalsOf(value: number, atLeast = 0, max = 8): number {
  let precision = atLeast;

  if (!Number.isFinite(value)) {
    return precision;
  }

  while (precision < max) {
    const scaled = value * 10 ** precision;

    if (Math.abs(scaled - Math.round(scaled)) < Math.max(1e-9, Math.abs(scaled) * 1e-12)) {
      break;
    }

    precision += 1;
  }

  return precision;
}

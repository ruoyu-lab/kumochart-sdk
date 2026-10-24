const HOUR_MS = 3_600_000;
/** Slots of the offset cache: a power of two, covering about half a year of hours. */
const SLOTS = 4096;

export interface CalendarFields {
  year: number;
  /** 0-based month. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const part = parts.find((item) => item.type === type);
  return part ? Number(part.value) : 0;
}

/**
 * Converts instants into calendar fields of one time zone. Zone offsets are looked up once per
 * hour and kept in a direct-mapped cache: a hit costs one comparison, so bucketing hundreds of
 * thousands of bars stays fast.
 */
export class Clock {
  private readonly hours = new Float64Array(SLOTS).fill(Number.NaN);
  private readonly offsets = new Float64Array(SLOTS);
  private readonly zoneFormat: Intl.DateTimeFormat | null;

  /** The clock of `timeZone`, or with `null` of the local zone. */
  constructor(readonly timeZone: string | null) {
    this.zoneFormat =
      timeZone === null
        ? null
        : new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
          });
  }

  /** Milliseconds to add to `time` to get the wall-clock time of the zone, read as UTC. */
  offset(time: number): number {
    const format = this.zoneFormat;

    if (!format) {
      return -new Date(time).getTimezoneOffset() * 60_000;
    }

    const hour = Math.floor(time / HOUR_MS);
    const slot = hour & (SLOTS - 1);

    if (this.hours[slot] === hour) {
      return this.offsets[slot] ?? 0;
    }

    const instant = hour * HOUR_MS;
    const parts = format.formatToParts(instant);
    const offset =
      Date.UTC(
        readPart(parts, 'year'),
        readPart(parts, 'month') - 1,
        readPart(parts, 'day'),
        readPart(parts, 'hour'),
        readPart(parts, 'minute'),
        readPart(parts, 'second')
      ) - instant;
    this.hours[slot] = hour;
    this.offsets[slot] = offset;
    return offset;
  }

  /**
   * The instant at which the zone's wall clock shows `wall` (wall-clock milliseconds read as
   * UTC). A wall time skipped by a daylight-saving change resolves to a neighbouring instant.
   */
  instant(wall: number): number {
    const guess = wall - this.offset(wall);
    return wall - this.offset(guess);
  }

  fields(time: number): CalendarFields {
    if (!this.zoneFormat) {
      const date = new Date(time);
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
      };
    }

    const shifted = new Date(time + this.offset(time));

    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth(),
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds()
    };
  }
}

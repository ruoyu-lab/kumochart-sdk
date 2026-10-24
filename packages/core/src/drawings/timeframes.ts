import type { Interval, IntervalUnit } from '../feed/interval';
import type { Resolution } from '../objects/types';
import { fail } from '../utils/errors';
import { checkBoolean, checkNumber, checkObject } from '../utils/validate';
import type { DrawingTimeframes, TimeframeRange } from './types';

const UNITS: readonly IntervalUnit[] = ['second', 'minute', 'hour', 'day', 'week', 'month'];

function checkRange(path: string, range: TimeframeRange): TimeframeRange {
  checkObject(path, range);
  const from = checkNumber(`${path}.from`, range.from, { min: 1, integer: true });
  const to = checkNumber(`${path}.to`, range.to, { min: from, integer: true });
  return { from, to };
}

export function checkTimeframes(timeframes: DrawingTimeframes): DrawingTimeframes {
  checkObject('drawing.timeframes', timeframes);
  const unknown = Object.keys(timeframes).find(
    (key) => key !== 'untimed' && !(UNITS as readonly string[]).includes(key)
  );

  if (unknown !== undefined) {
    fail(
      `drawing.timeframes.${unknown} is not a unit; the units are ${UNITS.join(', ')} and untimed.`
    );
  }

  const result: { -readonly [K in keyof DrawingTimeframes]: DrawingTimeframes[K] } = {};

  for (const unit of UNITS) {
    const range = timeframes[unit];

    if (range !== undefined) {
      result[unit] = checkRange(`drawing.timeframes.${unit}`, range);
    }
  }

  if (timeframes.untimed !== undefined) {
    result.untimed = checkBoolean('drawing.timeframes.untimed', timeframes.untimed);
  }

  return result;
}

/** Whether a drawing that shows on `timeframes` (`null`: on every one) shows at `resolution`. */
export function shownAt(timeframes: DrawingTimeframes | null, resolution: Resolution): boolean {
  if (!timeframes || resolution === null) {
    return true;
  }

  if (resolution === 'untimed') {
    return timeframes.untimed === true;
  }

  const { unit, count } = wholeUnit(resolution);
  const range = timeframes[unit];
  return range !== undefined && count >= range.from && count <= range.to;
}

/** An interval in its largest whole unit up to hours: 60 minutes are an hour, 120 seconds two minutes. */
function wholeUnit(interval: Interval): Interval {
  let { unit, count } = interval;

  if (unit === 'second' && count % 60 === 0) {
    unit = 'minute';
    count /= 60;
  }

  if (unit === 'minute' && count % 60 === 0) {
    unit = 'hour';
    count /= 60;
  }

  return { unit, count };
}

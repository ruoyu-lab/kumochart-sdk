import { describeValue, fail } from '../utils/errors';

/** A point in time: epoch milliseconds, an ISO-8601 string or a `Date`. */
export type TimeInput = number | string | Date;

/** Converts a {@link TimeInput} into epoch milliseconds. Throws on invalid input. */
export function toTime(input: TimeInput, context = 'time'): number {
  let time: number;

  if (typeof input === 'number') {
    time = input;
  } else if (typeof input === 'string') {
    time = Date.parse(input);
  } else if (input instanceof Date) {
    time = input.getTime();
  } else {
    return fail(`${context} must be a number, string or Date, received ${describeValue(input)}.`);
  }

  if (!Number.isFinite(time)) {
    fail(`${context} ${describeValue(input)} is not a valid point in time.`);
  }

  return time;
}

/** An ISO-8601 rendering of epoch milliseconds for error messages. */
export function describeTime(time: number): string {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? String(time) : date.toISOString();
}

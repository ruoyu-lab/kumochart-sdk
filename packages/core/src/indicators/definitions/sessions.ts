import type { Bar } from '../../data/types';
import { createCalendar, type Calendar } from '../../feed/calendar';
import { fail } from '../../utils/errors';
import { checkArray, checkObject, checkString } from '../../utils/validate';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream } from '../types';

/** A trading session whose range {@link sessionsIndicator} draws. */
export interface SessionRange {
  /**
   * Starts the keys of its outputs, `${key}High`, `${key}Low` and `${key}Day` (the trading day
   * of the session, as a time), e.g. `london`.
   */
  key: string;
  /** Names it in the legend, e.g. `London`. */
  label: string;
  /** `'HH:MM-HH:MM'` in `timeZone`; an end before the start crosses midnight. */
  session: string;
  /** IANA zone of the session's times, such as `Europe/London`. */
  timeZone: string;
}

/** The trading hours of Tokyo, London and New York. */
export const DEFAULT_SESSIONS: readonly SessionRange[] = [
  { key: 'tokyo', label: 'Tokyo', session: '09:00-15:00', timeZone: 'Asia/Tokyo' },
  { key: 'london', label: 'London', session: '08:30-16:30', timeZone: 'Europe/London' },
  { key: 'newYork', label: 'New York', session: '09:30-16:00', timeZone: 'America/New_York' }
];

const KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * A calendar whose trading days start with the session and hold only its times: a bar belongs to
 * the session when it has a bucket, and the bars of one session share it.
 */
function sessionCalendar(range: SessionRange, path: string): Calendar {
  checkObject(path, range);

  if (!KEY.test(checkString(`${path}.key`, range.key))) {
    fail(
      `${path}.key must be letters and digits, starting with a letter, received "${range.key}".`
    );
  }

  checkString(`${path}.label`, range.label);
  const session = checkString(`${path}.session`, range.session);
  return createCalendar({
    timeZone: checkString(`${path}.timeZone`, range.timeZone),
    sessions: [session],
    dayStart: session.split('-')[0] ?? ''
  });
}

/**
 * The high and low of each session so far, on the bars that start inside it, and its trading
 * day, which tells the boxes of sessions one right after another apart.
 */
class SessionStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(
    private readonly calendars: readonly Calendar[],
    /** Per session: its current bucket, high and low. */
    private readonly state = new Float64Array(calendars.length * 3).fill(Number.NaN)
  ) {
    this.out = new Float64Array(calendars.length * 3);
  }

  next(bar: Bar): ArrayLike<number> {
    const { state, out } = this;

    this.calendars.forEach((calendar, index) => {
      const bucket = calendar.bucket(bar.time, '1D');
      const slot = index * 3;

      if (bucket === null) {
        state[slot] = Number.NaN;
        out.fill(Number.NaN, slot, slot + 3);
        return;
      }

      if (bucket !== state[slot]) {
        state[slot] = bucket;
        state[slot + 1] = bar.high;
        state[slot + 2] = bar.low;
      }

      state[slot + 1] = Math.max(state[slot + 1] ?? Number.NaN, bar.high);
      state[slot + 2] = Math.min(state[slot + 2] ?? Number.NaN, bar.low);
      out[slot] = state[slot + 1] ?? Number.NaN;
      out[slot + 1] = state[slot + 2] ?? Number.NaN;
      out[slot + 2] = bucket;
    });

    return out;
  }

  clone(): IndicatorStream {
    return new SessionStream(this.calendars, this.state.slice());
  }
}

/**
 * Trading sessions, such as those of Tokyo, London and New York: a box over the bars that start
 * inside each session, from its low to its high. The values on a bar are the session's high and
 * low so far, so the box of the session in progress grows with it; each session follows its own
 * time zone, daylight saving included. `SESSIONS` is the type of {@link DEFAULT_SESSIONS}; give
 * other sessions a type of their own to have both.
 */
export function sessionsIndicator(
  sessions: readonly SessionRange[],
  type = 'SESSIONS'
): IndicatorDefinition<Record<string, never>> {
  checkArray('sessions', sessions);

  if (sessions.length === 0) {
    fail('sessions must contain at least one session.');
  }

  const calendars = sessions.map((range, index) => sessionCalendar(range, `sessions[${index}]`));
  // A box holds its whole session, which reaches past the bars in view when zoomed in: it leaves
  // the price scale alone.
  const outputs = sessions.flatMap(({ key, label }): IndicatorOutput[] => [
    {
      key: `${key}High`,
      label: `${label} H`,
      plot: { kind: 'box', from: `${key}Low`, group: `${key}Day` },
      autoscale: false
    },
    { key: `${key}Low`, label: `${label} L`, plot: { kind: 'hidden' } },
    // A time, read by the boxes only.
    {
      key: `${key}Day`,
      label: `${label} day`,
      plot: { kind: 'hidden' },
      legend: false,
      precision: 0
    }
  ]);
  return {
    type,
    name: 'Sessions',
    pane: 'main',
    precision: 'price',
    params: {},
    outputs: () => outputs,
    create: () => new SessionStream(calendars)
  };
}

/** The sessions of Tokyo, London and New York, as {@link DEFAULT_SESSIONS} holds them. */
export const SESSIONS = /* @__PURE__ */ sessionsIndicator(DEFAULT_SESSIONS);

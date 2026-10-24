import type { Bar } from '../../data/types';
import type { Calendar } from '../../feed/calendar';
import { fixedMs, type Interval } from '../../feed/interval';
import { fail } from '../../utils/errors';
import { SimpleAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream } from '../types';
import { choiceParam, lineOutput, ParallelStream, periodParam, picked } from './shared';

/** Periods of the calendar a `period` parameter picks by value. */
const PERIODS = ['1D', '1W', '1M', '3M', '12M'];

function intervalOf(period: number): string {
  return picked(PERIODS, period, 'period');
}

interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

const DAY = 86_400_000;

/**
 * The bars of the current period of the calendar merged into one, and of the period before.
 * Bars the calendar drops (outside the sessions) count to the period they follow; before the
 * first period they are left out. A period of several years starts with a year divisible by
 * their number, such as every decade.
 */
class PeriodBars {
  /** The current period's bar; `null` before the first one. */
  current: Ohlc | null = null;
  /** The previous period's bar; `null` before the second period. */
  previous: Ohlc | null = null;
  private start = Number.NaN;

  constructor(
    private readonly calendar: Calendar,
    private readonly interval: string,
    private readonly years = 1
  ) {}

  /** Adds a bar; returns whether it opened a new period. */
  push(bar: Bar): boolean {
    const period = this.calendar.bucket(bar.time, this.interval);

    // A year starts within a day of January 1st in UTC, whatever its time zone.
    if (
      period !== null &&
      period !== this.start &&
      (this.years === 1 || new Date(period + 2 * DAY).getUTCFullYear() % this.years === 0)
    ) {
      this.start = period;
      this.previous = this.current;
      this.current = { open: bar.open, high: bar.high, low: bar.low, close: bar.close };
      return true;
    }

    if (this.current) {
      this.current.high = Math.max(this.current.high, bar.high);
      this.current.low = Math.min(this.current.low, bar.low);
      this.current.close = bar.close;
    }

    return false;
  }

  clone(): PeriodBars {
    const copy = new PeriodBars(this.calendar, this.interval, this.years);
    copy.start = this.start;
    copy.current = this.current && { ...this.current };
    copy.previous = this.previous && { ...this.previous };
    return copy;
  }
}

// ─── Pivot points ────────────────────────────────────────────────────────────

/**
 * The levels of each kind of pivot points from the previous period and the current open, in
 * output order: P, R1, S1, R2, S2, …
 */
const PIVOT_KINDS: readonly {
  readonly label: string;
  /** Resistance and support levels beside P. */
  readonly depth: number;
  levels(previous: Ohlc, open: number): number[];
}[] = [
  {
    label: 'Traditional',
    depth: 5,
    levels: ({ high: h, low: l, close: c }) => {
      const p = (h + l + c) / 3;
      return [
        p,
        p * 2 - l,
        p * 2 - h,
        p + (h - l),
        p - (h - l),
        p * 2 + (h - 2 * l),
        p * 2 - (2 * h - l),
        p * 3 + (h - 3 * l),
        p * 3 - (3 * h - l),
        p * 4 + (h - 4 * l),
        p * 4 - (4 * h - l)
      ];
    }
  },
  {
    label: 'Fibonacci',
    depth: 3,
    levels: ({ high: h, low: l, close: c }) => {
      const p = (h + l + c) / 3;
      const range = h - l;
      return [
        p,
        p + 0.382 * range,
        p - 0.382 * range,
        p + 0.618 * range,
        p - 0.618 * range,
        p + range,
        p - range
      ];
    }
  },
  {
    label: 'Woodie',
    depth: 4,
    levels: ({ high: h, low: l }, open) => {
      const p = (h + l + 2 * open) / 4;
      const r3 = h + 2 * (p - l);
      const s3 = l - 2 * (h - p);
      return [
        p,
        2 * p - l,
        2 * p - h,
        p + (h - l),
        p - (h - l),
        r3,
        s3,
        r3 + (h - l),
        s3 - (h - l)
      ];
    }
  },
  {
    label: 'Classic',
    depth: 4,
    levels: ({ high: h, low: l, close: c }) => {
      const p = (h + l + c) / 3;
      const range = h - l;
      return [
        p,
        2 * p - l,
        2 * p - h,
        p + range,
        p - range,
        p + 2 * range,
        p - 2 * range,
        p + 3 * range,
        p - 3 * range
      ];
    }
  },
  {
    label: 'DM',
    depth: 1,
    levels: ({ open: o, high: h, low: l, close: c }) => {
      const x = c === o ? h + l + 2 * c : c > o ? 2 * h + l + c : 2 * l + h + c;
      return [x / 4, x / 2 - l, x / 2 - h];
    }
  },
  {
    label: 'Camarilla',
    depth: 5,
    levels: ({ high: h, low: l, close: c }) => {
      const step = 1.1 * (h - l);
      const r5 = (h / l) * c;
      return [
        (h + l + c) / 3,
        c + step / 12,
        c - step / 12,
        c + step / 6,
        c - step / 6,
        c + step / 4,
        c - step / 4,
        c + step / 2,
        c - step / 2,
        r5,
        c - (r5 - c)
      ];
    }
  }
];

function pivotKind(kind: number): (typeof PIVOT_KINDS)[number] {
  return PIVOT_KINDS[kind] ?? fail(`There are no pivot points of kind ${kind}.`);
}

/** The pivot timeframes by option value, after Auto: the interval and the years it spans. */
const PIVOT_PERIODS: readonly (readonly [string, number])[] = [
  ['1D', 1],
  ['1W', 1],
  ['1M', 1],
  ['3M', 1],
  ['12M', 1],
  ['12M', 2],
  ['12M', 3],
  ['12M', 5],
  ['12M', 10]
];

/**
 * The pivot timeframe Auto picks for bars of an interval: days for bars of 15 minutes or less and
 * for bars without an interval, weeks for other intraday bars, months for bars of up to 6 days
 * and years for longer ones.
 */
function autoPeriod(interval: Interval | null): string {
  if (interval === null) {
    return '1D';
  }

  const length = fixedMs(interval);

  if (length !== null) {
    return length <= 15 * 60_000 ? '1D' : '1W';
  }

  return interval.unit === 'day' && interval.count < 7 ? '1M' : '12M';
}

/** The levels from the previous period, held over the current one. */
class PivotStream implements IndicatorStream {
  constructor(
    private readonly kind: (typeof PIVOT_KINDS)[number],
    private readonly periods: PeriodBars,
    private levels = new Float64Array(1 + kind.depth * 2).fill(Number.NaN)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    if (this.periods.push(bar)) {
      const { previous, current } = this.periods;

      if (previous && current) {
        this.levels = Float64Array.from(this.kind.levels(previous, current.open));
      }
    }

    return this.levels;
  }

  clone(): IndicatorStream {
    // Each period replaces the levels rather than changing them, so copies can share them.
    return new PivotStream(this.kind, this.periods.clone(), this.levels);
  }
}

/**
 * Pivot points of the previous period of the chart's calendar (day, week, month, quarter, one or
 * several years), drawn as a level over the current one: Traditional, Fibonacci, Woodie, Classic,
 * DM or Camarilla. Auto follows the chart's interval: days on bars of 15 minutes or less and on
 * bars without an interval, weeks on other intraday bars, months on daily bars and years on
 * weekly and monthly ones.
 */
export const PIVOTS: IndicatorDefinition<{ kind: number; period: number }> = {
  type: 'PIVOTS',
  name: 'Pivots',
  pane: 'main',
  precision: 'price',
  params: {
    kind: {
      default: 0,
      label: 'Type',
      options: /* @__PURE__ */ PIVOT_KINDS.map(({ label }, value) => ({ value, label }))
    },
    period: choiceParam(
      [
        'Auto',
        'Daily',
        'Weekly',
        'Monthly',
        'Quarterly',
        'Yearly',
        'Biyearly',
        'Triyearly',
        'Quinquennially',
        'Decennially'
      ],
      0,
      'Pivots timeframe'
    )
  },
  outputs: ({ kind }) => {
    // Levels far out, such as R5, would squash the bars: they leave the price scale alone.
    const levels: IndicatorOutput[] = [
      { key: 'p', label: 'P', plot: { kind: 'segments' }, autoscale: false }
    ];

    for (let level = 1; level <= pivotKind(kind).depth; level += 1) {
      levels.push(
        {
          key: `r${level}`,
          label: `R${level}`,
          plot: { kind: 'segments' },
          themeColor: 'down',
          autoscale: false
        },
        {
          key: `s${level}`,
          label: `S${level}`,
          plot: { kind: 'segments' },
          themeColor: 'up',
          autoscale: false
        }
      );
    }

    return levels;
  },
  create: ({ kind, period }, { calendar, interval }) => {
    const [bucket, years] =
      period === 0
        ? [autoPeriod(interval), 1]
        : picked(PIVOT_PERIODS, period - 1, 'pivot timeframe');
    return new PivotStream(pivotKind(kind), new PeriodBars(calendar, bucket, years));
  }
};

// ─── Previous period ─────────────────────────────────────────────────────────

/** The high, low and close of the previous period. */
class PreviousPeriodStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(private readonly periods: PeriodBars) {}

  next(bar: Bar): ArrayLike<number> {
    this.periods.push(bar);
    const previous = this.periods.previous;
    this.out[0] = previous?.high ?? Number.NaN;
    this.out[1] = previous?.low ?? Number.NaN;
    this.out[2] = previous?.close ?? Number.NaN;
    return this.out;
  }

  clone(): IndicatorStream {
    return new PreviousPeriodStream(this.periods.clone());
  }
}

/**
 * The high, low and close of the previous period of the chart's calendar (the previous trading
 * day, week, month, quarter or year), drawn as levels over the current one.
 */
export const PREVHLC: IndicatorDefinition<{ period: number }> = {
  type: 'PREVHLC',
  name: 'Prev HLC',
  pane: 'main',
  precision: 'price',
  params: {
    period: choiceParam(['Day', 'Week', 'Month', 'Quarter', 'Year'], 0, 'Period')
  },
  outputs: () => [
    // The previous year's range can lie far from the price: it leaves the price scale alone.
    { key: 'high', label: 'PH', plot: { kind: 'segments' }, themeColor: 'up', autoscale: false },
    { key: 'low', label: 'PL', plot: { kind: 'segments' }, themeColor: 'down', autoscale: false },
    { key: 'close', label: 'PC', plot: { kind: 'segments', style: 'dashed' }, autoscale: false }
  ],
  create: ({ period }, { calendar }) =>
    new PreviousPeriodStream(new PeriodBars(calendar, intervalOf(period)))
};

// ─── Average range ───────────────────────────────────────────────────────────

/** Average daily range: the simple average of the high-to-low range of the last `period` bars. */
export const ADR: IndicatorDefinition<{ period: number }> = {
  type: 'ADR',
  name: 'ADR',
  pane: 'new',
  precision: 'price',
  params: { period: periodParam(14, 'Length') },
  outputs: () => [lineOutput('ADR')],
  create: ({ period }) =>
    new ParallelStream([new SimpleAverage(period)], (bar) => bar.high - bar.low)
};

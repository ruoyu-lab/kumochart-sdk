import { BarsReader, BarStore } from '../data/bar-store';
import { describeTime } from '../data/time';
import { foldTrades, parseTrades, TradeLog } from '../data/trades';
import type { BarInput, TradeInput } from '../data/types';
import { createBarFeed, identityBucketer, type BarFeed } from '../feed/aggregator';
import { CalendarModel, type Bucketer, type Calendar } from '../feed/calendar';
import {
  canBuildTimeframe,
  checkTimeframe,
  fixedMs,
  formatInterval,
  parseInterval,
  sameInterval,
  type Interval,
  type IntervalInput
} from '../feed/interval';
import {
  createTransformRegistry,
  TimeBars,
  TransformStage,
  type BarTransformInput,
  type BarTransformState,
  type StageInput
} from '../feed/transform';
import type { Resolution } from '../objects/types';
import { parseCalendar, sameCalendar } from '../options/calendar';
import type { ChartOptions } from '../options/types';
import type { SeriesEntry, SeriesStore } from '../series/series-store';
import { fail } from '../utils/errors';
import { checkFields, checkObject, checkOneOf, checkString, fieldsOf } from '../utils/validate';

const TRANSFORM_FIELDS = fieldsOf<BarTransformInput>({ type: true, params: true, input: true });

function createCalendarModel(options: ChartOptions): CalendarModel {
  return new CalendarModel(
    parseCalendar(options.calendar, 'options.calendar'),
    options.calendar.timeZone,
    'options.calendar'
  );
}

/** Whether bars of an interval are dated, as days, weeks and months are, rather than timed. */
function isDated(interval: Interval): boolean {
  return fixedMs(interval) === null;
}

/**
 * Buckets the bars of a source interval into the bars of the calendar. Bars of days, weeks or
 * months go by their trading date, whatever time of it dates them. Bars of fixed intervals must
 * start where the calendar starts one, and a bar it would start elsewhere fails: the bars would
 * move or merge, and trades would fold into other bars than theirs.
 */
function sourceBucketer(calendar: CalendarModel, source: Interval): Bucketer {
  if (isDated(source)) {
    return calendar.bucketer(source, undefined, true);
  }

  const own = calendar.bucketer(source);
  return (time) => {
    const bucket = own(time);

    if (bucket !== null && bucket !== time) {
      fail(
        `The ${formatInterval(source)} bar at ${describeTime(time)} does not start a bar of the trading calendar, which starts it at ${describeTime(bucket)}: set options.calendar as the data times its bars, such as its timeZone (now ${JSON.stringify(calendar.timeZone)}).`
      );
    }

    return bucket;
  };
}

/** The source bars of a source interval in the displayed ones, of the timeframe if any. */
function mainBucketer(calendar: CalendarModel, source: Interval, frame: Interval | null): Bucketer {
  const own = sourceBucketer(calendar, source);

  if (!frame) {
    return own;
  }

  const coarser = calendar.bucketer(frame, undefined, isDated(source));
  return (time) => (own(time) === null ? null : coarser(time));
}

/** The points of series in the displayed bars, as those of the main bars. */
function seriesBucketer(
  calendar: CalendarModel,
  source: Interval,
  frame: Interval | null
): Bucketer {
  return calendar.bucketer(frame ?? source, undefined, isDated(source));
}

const INPUTS = ['bars', 'trades'] as const;

function runAll(commits: ReadonlyArray<() => void>): void {
  commits.forEach((commit) => {
    commit();
  });
}

/**
 * The market data behind the chart: source bars (and the trades folded into them, the latest of
 * which it keeps) at a source interval, displayed in a timeframe through the trading calendar,
 * optionally transformed (e.g. into Renko bricks, from the bars or from the trades). Every write
 * validates the main bars and all series first, then applies them together.
 */
export class MarketData {
  readonly feed: BarFeed;
  readonly transforms = createTransformRegistry();
  /** The displayed bars, read-only. */
  readonly displayed: BarsReader;
  /** The source bars a replay has revealed, read-only. */
  readonly revealed: BarsReader;
  /** Bars of the timeframe, when a transform builds the displayed bars from them. */
  private readonly timeBars = new BarStore();
  /** The latest trades, for transforms built from trades. */
  private readonly trades: TradeLog;
  private stage: TransformStage | null = null;
  /** The time of the latest trade folded in: one older is late. */
  private latestTrade = Number.NEGATIVE_INFINITY;
  private source: Interval | null = null;
  private frame: Interval | null = null;
  private calendar: CalendarModel;

  constructor(
    private readonly bars: BarStore,
    private readonly series: SeriesStore,
    private options: ChartOptions
  ) {
    this.feed = createBarFeed(identityBucketer, bars);
    this.displayed = new BarsReader(bars);
    this.revealed = new BarsReader(
      this.feed.source,
      () => this.feed.revealed(),
      () => this.feed.cutoffMoves()
    );
    this.calendar = createCalendarModel(options);
    this.trades = new TradeLog(options.performance.maxTrades);
  }

  /** Resolution of the source bars, or `null` when they are displayed as given. */
  sourceInterval(): Interval | null {
    return this.source;
  }

  /** The trading calendar, replaced whenever the calendar options change. */
  tradingCalendar(): Calendar {
    return this.calendar;
  }

  /** The displayed timeframe, or `null` for the source resolution. */
  timeframe(): Interval | null {
    return this.frame;
  }

  /** The transform building the displayed bars, or `null` for the bars of the timeframe. */
  transform(): BarTransformState | null {
    if (!this.stage) {
      return null;
    }

    const resolved = this.stage.resolved();
    return {
      type: this.stage.type,
      params: structuredClone(this.stage.params),
      input: this.stage.from,
      resolved: resolved && structuredClone(resolved)
    };
  }

  /** What the transform reports it builds the displayed bars with, or `null`. */
  transformResolved(): Readonly<Record<string, unknown>> | null {
    return this.stage?.resolved() ?? null;
  }

  /**
   * Builds the displayed bars with a transform, or shows the bars of the timeframe with `null`.
   * A transform that fails on the bars, such as with a size far too small for their prices,
   * changes nothing.
   */
  setTransform(input: BarTransformInput | null): void {
    if (input === null) {
      if (this.stage) {
        this.stage = null;
        this.feed.setDisplay(this.bars);
      }

      return;
    }

    const { type, definition, params, from } = this.startTransform(input);
    const source: StageInput = from === 'trades' ? this.trades : new TimeBars(this.timeBars);
    const shown = this.stage;

    if (!shown) {
      this.feed.setDisplay(this.timeBars);
    }

    const stage = new TransformStage(source, from, this.bars, type, definition, params);

    try {
      stage.sync();
    } catch (error) {
      // The bars of the timeframe show again, as they did.
      if (!shown) {
        this.feed.setDisplay(this.bars);
      }

      throw error;
    }

    this.stage = stage;
  }

  /**
   * Throws what `setTransform()` would throw for a transform, changing nothing: it builds the
   * displayed bars from the current ones, aside.
   */
  checkTransform(input: BarTransformInput): void {
    const { type, definition, params, from } = this.startTransform(input);
    const source: StageInput =
      from === 'trades' ? this.trades : new TimeBars(this.stage ? this.timeBars : this.bars);
    new TransformStage(source, from, new BarStore(), type, definition, params).sync();
  }

  /** Validates a transform, its parameters by starting a stream on the bars it would read. */
  private startTransform(input: BarTransformInput) {
    checkFields('transform', input, TRANSFORM_FIELDS);
    const type = checkString('transform.type', input.type);
    const definition = this.transforms.require(type);

    if (input.params !== undefined) {
      checkObject('transform.params', input.params);
    }

    const from =
      input.input === undefined ? 'bars' : checkOneOf('transform.input', input.input, INPUTS);
    const params = { ...input.params };
    definition.create(params, from === 'trades' ? this.trades.view() : this.feed.display, from);
    return { type, definition, params, from };
  }

  /**
   * The price the displayed bars were last built from when a transform that gives up time builds
   * them, such as Renko: the close of the latest bar of the timeframe or the latest trade; `null`
   * otherwise.
   */
  livePrice(): number | null {
    return this.stage && !this.stage.definition.keepsTime ? this.stage.lastClose() : null;
  }

  /**
   * How many of the displayed bars are final: all but the latest, or the bars a transform
   * completed, not the provisional ones it builds from the latest bar of the timeframe.
   */
  settled(): number {
    return this.stage ? this.stage.settled : Math.max(0, this.bars.length - 1);
  }

  /** Whether displayed bars stand for periods of time, which a transform may give up. */
  timeBased(): boolean {
    return this.stage?.definition.keepsTime ?? true;
  }

  /** The resolution of the displayed bars, which drawings show on as their timeframes say. */
  resolution(): Resolution {
    return this.timeBased() ? (this.frame ?? this.source) : 'untimed';
  }

  /** Length of a displayed bar in milliseconds when it is fixed (seconds to hours). */
  barDuration(): number | null {
    if (!this.timeBased()) {
      return null;
    }

    const interval = this.frame ?? this.source;
    return interval ? fixedMs(interval) : null;
  }

  /**
   * When the displayed bar that opens at `time` ends, by the trading calendar: the end of the
   * times it takes, such as 17:00 New York for a day of forex dated at midnight. `null` where
   * the calendar cannot tell, such as for a day of sessions, dated outside them.
   */
  barEnd(time: number): number | null {
    const interval = this.timeBased() ? (this.frame ?? this.source) : null;
    const run = interval ? this.calendar.range(time, interval) : null;
    // A run of the time alone is one the calendar cannot foresee.
    return run && run.end > time + 1 ? run.end : null;
  }

  firstSourceTime(): number | null {
    return this.feed.firstTime();
  }

  /**
   * Follows option changes; returns whether the bars were bucketed again. A calendar the bars
   * cannot be bucketed with throws before anything changed.
   */
  configure(options: ChartOptions): boolean {
    const previous = this.options;
    const recalendar = !sameCalendar(previous.calendar, options.calendar);
    const calendar = recalendar ? createCalendarModel(options) : this.calendar;
    // Bars of a source interval follow the calendar: planned in full before anything changes.
    const source = recalendar ? this.source : null;
    const commits = source ? this.planBuckets(calendar, source, this.frame) : [];
    this.options = options;
    this.trades.setCapacity(options.performance.maxTrades);
    runAll(commits);
    this.calendar = calendar;

    if (source) {
      this.stage?.sync();
    }

    return source !== null;
  }

  set(bars: readonly BarInput[], interval: IntervalInput | undefined): void {
    const source = interval === undefined ? null : parseInterval(interval, 'interval');
    const kept = source && this.frame && canBuildTimeframe(this.frame, source) ? this.frame : null;
    // A timeframe of the source interval is no timeframe, as setTimeframe() has it.
    const frame = source && kept && !sameInterval(kept, source) ? kept : null;
    const series = source ? seriesBucketer(this.calendar, source, frame) : identityBucketer;
    const main = source ? mainBucketer(this.calendar, source, frame) : identityBucketer;
    runAll([this.feed.planSet(bars, main), this.series.planRebucket(series)]);
    this.source = source;
    this.frame = frame;
    this.trades.clear();
    this.latestTrade = Number.NEGATIVE_INFINITY;
    this.stage?.sync();
  }

  update(bars: readonly BarInput[]): void {
    this.feed.planUpdate(bars)();
    this.stage?.sync();
  }

  prepend(bars: readonly BarInput[]): number {
    const { inserted, commit } = this.feed.planPrepend(bars);
    commit();
    this.stage?.sync();
    return inserted;
  }

  /**
   * Folds trades into the source bars; returns how many it kept: not those outside the sessions,
   * nor late ones, older than the latest trade or the last bar, as a stream may deliver them.
   */
  addTrades(inputs: readonly TradeInput[]): number {
    const source =
      this.source ??
      fail('addTrades() needs the source interval: pass it with data.set(bars, { interval }).');
    const store = this.feed.source;
    const { bars, kept, barTimes, latest } = foldTrades(
      parseTrades(inputs),
      store.bar(store.length - 1),
      this.latestTrade,
      this.calendar.bucketer(source),
      sourceBucketer(this.calendar, source)
    );
    this.latestTrade = latest;
    this.trades.append(kept, barTimes);
    this.update(bars);
    return kept.length;
  }

  /**
   * Folds trades into the source points of a series, as {@link addTrades} folds them into the
   * main bars: into its bars, or, for a series of values, into a value per source interval, the
   * price of its last trade. Returns how many it kept.
   */
  addSeriesTrades(entry: SeriesEntry, inputs: readonly TradeInput[]): number {
    const source =
      this.source ??
      fail(
        'series.addTrades() needs the source interval: pass it with data.set(bars, { interval }).'
      );
    const trades = parseTrades(inputs);
    const bucketOf = this.calendar.bucketer(source);
    const barOf = sourceBucketer(this.calendar, source);

    if (entry.source.input === 'ohlc') {
      const { feed } = entry.source;
      const folded = foldTrades(
        trades,
        feed.source.bar(feed.source.length - 1),
        entry.latestTrade,
        bucketOf,
        barOf
      );
      feed.planUpdate(folded.bars)();
      entry.latestTrade = folded.latest;
      return folded.kept.length;
    }

    const { feed } = entry.source;
    const count = feed.source.length;
    // The last value as a bar of its price, which the trades of its interval replace.
    const value = feed.source.value(count - 1);
    const last =
      count === 0
        ? null
        : {
            time: feed.source.time(count - 1),
            open: value,
            high: value,
            low: value,
            close: value,
            volume: 0
          };
    const folded = foldTrades(trades, last, entry.latestTrade, bucketOf, barOf);
    feed.planUpdate(folded.bars.map((bar) => ({ time: bar.time, value: bar.close })))();
    entry.latestTrade = folded.latest;
    return folded.kept.length;
  }

  /** Removes the main bars and shows all data again. */
  clear(): void {
    this.feed.clear();
    this.trades.clear();
    this.latestTrade = Number.NEGATIVE_INFINITY;
    this.setCutoff(Number.POSITIVE_INFINITY);
  }

  setTimeframe(input: IntervalInput | null): void {
    const source =
      this.source ??
      fail('setTimeframe() needs the source interval: pass it with data.set(bars, { interval }).');
    const frame = input === null ? null : parseInterval(input, 'timeframe');

    if (frame) {
      checkTimeframe(frame, source);
    }

    const normalized = frame && sameInterval(frame, source) ? null : frame;
    runAll(this.planBuckets(this.calendar, source, normalized));
    this.frame = normalized;
    this.stage?.sync();
  }

  /**
   * Buckets source bars of the `source` interval into bars of `frame`, a timeframe they build, as
   * the chart builds its own with the trading calendar now.
   */
  bucketerOf(source: Interval, frame: Interval): Bucketer {
    return mainBucketer(this.calendar, source, frame);
  }

  /** Hides source data after `time` (`Infinity` shows all); returns whether the bars changed. */
  setCutoff(time: number): boolean {
    this.series.setCutoff(time);
    this.trades.setCutoff(time);
    const changed = this.feed.setCutoff(time);
    this.stage?.sync();
    return changed;
  }

  /** Plans bucketing the main bars and the series of a source interval anew. */
  private planBuckets(
    calendar: CalendarModel,
    source: Interval,
    frame: Interval | null
  ): ReadonlyArray<() => void> {
    return [
      this.feed.planRebucket(mainBucketer(calendar, source, frame)),
      this.series.planRebucket(seriesBucketer(calendar, source, frame))
    ];
  }
}

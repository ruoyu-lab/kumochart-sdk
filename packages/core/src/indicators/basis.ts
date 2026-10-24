import type { MarketData } from '../chart/market-data';
import type { BarStore } from '../data/bar-store';
import { followBars, identityBucketer, type BarFeed } from '../feed/aggregator';
import type { Calendar } from '../feed/calendar';
import {
  canBuildTimeframe,
  formatInterval,
  nominalMs,
  sameInterval,
  type Interval
} from '../feed/interval';
import type { IndicatorContext } from './types';

/** How many logical indices before the first displayed bar and after the latest show values. */
export interface Reach {
  readonly before: number;
  readonly after: number;
}

/** The bars an indicator is computed on, and which of them each displayed bar shows. */
export interface IndicatorBasis {
  readonly bars: BarStore;
  /** What the calculator knows beyond the bars. */
  context(): IndicatorContext;
  /**
   * The bar shown on logical index `index` of the displayed bars. Either may lie beyond the
   * bars, as the values of outputs shifted past them do.
   */
  barAt(index: number): number;
  /** Where the values of an output shifted by `shift` bars show beyond the displayed bars. */
  reach(shift: number): Reach;
}

/** Indicators computed on the bars of a store, each shown on its own bar: the displayed bars. */
export class BarsBasis implements IndicatorBasis {
  constructor(
    readonly bars: BarStore,
    readonly context: () => IndicatorContext
  ) {}

  barAt(index: number): number {
    return index;
  }

  reach(shift: number): Reach {
    return { before: Math.max(0, -shift), after: Math.max(0, shift) };
  }
}

/** What decided whether the chart's bars show a timeframe, and what it decided. */
interface Decision {
  readonly source: Interval | null;
  readonly shown: Interval | null;
  readonly timed: boolean;
  readonly applies: boolean;
}

/**
 * Indicators computed on bars of a timeframe of their own, built from the chart's source bars
 * with its trading calendar, as the chart builds its timeframe, and up to its replay cutoff.
 *
 * A displayed bar shows the latest bar of the timeframe closed by its end, the time of the next
 * displayed bar: a bar is closed once the bar after it has started by then. So the value changes
 * on the last displayed bar of each period, by time, whether or not the periods nest, across
 * gaps too. The latest displayed bar shows the bar still forming. Past the displayed bars, each
 * bar of the timeframe takes as many logical indices as it takes displayed bars on average.
 */
export class TimeframeBasis implements IndicatorBasis {
  private readonly feed: BarFeed;
  private decision: Decision | null = null;
  /** The calendar and source interval the bars were last bucketed with. */
  private bucketed: { readonly calendar: Calendar; readonly source: Interval } | null = null;
  private sourceRevision = -1;
  /** For each displayed bar but the latest, how many bars had started by its end. */
  private started = new Int32Array(0);
  /** The times of the bars the displayed bars were matched with. */
  private matched = new Float64Array(0);
  private matchedCount = 0;
  private displayedRevision = -1;
  private barsRevision = -1;

  constructor(
    private readonly market: MarketData,
    /** The displayed bars. */
    private readonly displayed: BarStore,
    readonly frame: Interval
  ) {
    // The bucketer of the source interval comes with the first update.
    this.feed = followBars(market.feed.source, identityBucketer);
  }

  get bars(): BarStore {
    return this.feed.display;
  }

  context(): IndicatorContext {
    return { calendar: this.market.tradingCalendar(), interval: this.frame };
  }

  /**
   * Brings the bars, and which of them each displayed bar shows, up to date while the chart's
   * bars show the timeframe; returns whether they do: bars of time, of a timeframe nominally
   * shorter, which their source builds.
   */
  update(): boolean {
    const source = this.source();

    if (source === null) {
      return false;
    }

    this.follow(source);
    this.match();
    return true;
  }

  barAt(index: number): number {
    const latest = this.displayed.length - 1;

    if (index >= latest) {
      return this.bars.length - 1 + Math.ceil((index - latest) / this.ratio());
    }

    if (index >= 0) {
      return (this.started[index] ?? 0) - 2;
    }

    return this.barAt(0) - Math.ceil(-index / this.ratio());
  }

  reach(shift: number): Reach {
    const ratio = this.ratio();
    return {
      before: Math.max(0, (this.barAt(0) - shift) * ratio),
      after: Math.max(0, shift * ratio)
    };
  }

  /** Displayed bars per bar of the timeframe, on average and at least one. */
  private ratio(): number {
    return Math.max(1, Math.round(this.displayed.length / Math.max(1, this.bars.length)));
  }

  /** The source interval the bars are built from while the chart's bars show them, or `null`. */
  private source(): Interval | null {
    const { market, frame } = this;
    const source = market.sourceInterval();
    const shown = market.timeframe() ?? source;
    const timed = market.timeBased();
    const seen = this.decision;

    if (seen?.source !== source || seen.shown !== shown || seen.timed !== timed) {
      this.decision = {
        source,
        shown,
        timed,
        applies:
          source !== null &&
          shown !== null &&
          timed &&
          nominalMs(shown) < nominalMs(frame) &&
          canBuildTimeframe(frame, source)
      };
    }

    return this.decision?.applies ? source : null;
  }

  /** Follows the source bars, the calendar and the cutoff. */
  private follow(source: Interval): void {
    const { market, feed } = this;
    const calendar = market.tradingCalendar();
    const store = market.feed.source;

    if (this.bucketed?.calendar !== calendar || !sameInterval(this.bucketed.source, source)) {
      feed.planRebucket(market.bucketerOf(source, this.frame))();
      this.bucketed = { calendar, source };
    } else {
      const change = store.changesSince(this.sourceRevision);

      if (change) {
        feed.follow(change);
      }
    }

    this.sourceRevision = store.revision;
    feed.setCutoff(market.feed.cutoffTime());
  }

  /**
   * Counts again the bars started by the end of the displayed bars whose count may have changed:
   * from the one before the first displayed bar changed, whose end is its time, and from the
   * first one ending at or after the first time the bars moved at.
   */
  private match(): void {
    const { displayed, bars } = this;
    const shown = displayed.changesSince(this.displayedRevision);
    const built = bars.changesSince(this.barsRevision);
    let from = displayed.length;

    if (shown) {
      from = shown.kind === 'reset' ? 0 : Math.max(0, shown.from - 1);
    }

    if (built) {
      const at = built.kind === 'reset' ? 0 : built.from;
      const moved = built.kind === 'reset' ? Number.NEGATIVE_INFINITY : this.firstMove(at);
      this.keepTimes(at);

      if (moved !== Number.POSITIVE_INFINITY) {
        from = Math.min(from, Math.max(0, displayed.lowerBound(moved) - 1));
      }
    }

    this.displayedRevision = displayed.revision;
    this.barsRevision = bars.revision;
    this.count(from);
  }

  /** The first time where the bars from `from` on differ from those matched; `Infinity` for none. */
  private firstMove(from: number): number {
    const { bars, matched, matchedCount } = this;
    const count = Math.max(bars.length, matchedCount);

    for (let index = from; index < count; index += 1) {
      const before =
        index < matchedCount ? (matched[index] ?? Number.NaN) : Number.POSITIVE_INFINITY;
      const now = index < bars.length ? bars.time(index) : Number.POSITIVE_INFINITY;

      if (before !== now) {
        return Math.min(before, now);
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  /** Keeps the times of the bars from `from` on, which the displayed bars are now matched with. */
  private keepTimes(from: number): void {
    const { bars } = this;

    if (this.matched.length < bars.length) {
      const next = new Float64Array(Math.max(64, bars.length, this.matched.length * 2));
      next.set(this.matched.subarray(0, Math.min(from, this.matchedCount)));
      this.matched = next;
    }

    for (let index = from; index < bars.length; index += 1) {
      this.matched[index] = bars.time(index);
    }

    this.matchedCount = bars.length;
  }

  /** Counts the bars started by the end of each displayed bar from `from` on but the latest. */
  private count(from: number): void {
    const { displayed, bars } = this;
    const latest = displayed.length - 1;

    if (this.started.length < latest) {
      const next = new Int32Array(Math.max(64, latest, this.started.length * 2));
      next.set(this.started.subarray(0, from));
      this.started = next;
    }

    let started = from > 0 ? (this.started[from - 1] ?? 0) : 0;

    for (let index = from; index < latest; index += 1) {
      const end = displayed.time(index + 1);

      while (started < bars.length && bars.time(started) <= end) {
        started += 1;
      }

      this.started[index] = started;
    }
  }
}

/**
 * The bars the indicators of a chart are computed on: the displayed bars, and the bars of each
 * timeframe of theirs, one set shared by the indicators of a timeframe.
 */
export class IndicatorBases {
  readonly displayed: BarsBasis;
  private readonly timeframes = new Map<string, TimeframeBasis>();

  constructor(
    private readonly market: MarketData,
    displayed: BarStore
  ) {
    this.displayed = new BarsBasis(displayed, () => ({
      calendar: market.tradingCalendar(),
      interval: market.timeframe() ?? market.sourceInterval()
    }));
  }

  /**
   * The bars an indicator of `timeframe` is computed on, up to date: those of the timeframe while
   * the chart's bars show it, else the displayed bars, as for `null`.
   */
  of(timeframe: Interval | null): () => IndicatorBasis {
    if (timeframe === null) {
      return () => this.displayed;
    }

    const key = formatInterval(timeframe);
    const basis =
      this.timeframes.get(key) ?? new TimeframeBasis(this.market, this.displayed.bars, timeframe);
    this.timeframes.set(key, basis);
    return () => (basis.update() ? basis : this.displayed);
  }

  /** Lets go of the bars of the timeframes that none of `timeframes` is. */
  keep(timeframes: readonly (Interval | null)[]): void {
    const kept = new Set(timeframes.flatMap((frame) => (frame ? [formatInterval(frame)] : [])));

    for (const key of [...this.timeframes.keys()]) {
      if (!kept.has(key)) {
        this.timeframes.delete(key);
      }
    }
  }
}

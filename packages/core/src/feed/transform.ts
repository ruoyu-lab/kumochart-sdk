import type { BarStore } from '../data/bar-store';
import { describeTime } from '../data/time';
import type { Bar, BarChange, BarsView, TradeSide } from '../data/types';
import { fail } from '../utils/errors';
import { Registry } from '../utils/registry';

/** A running transform: receives the input bars in order and builds the output bars. */
export interface BarTransformStream {
  /**
   * Takes the next input bar; returns the output bars it completed, oldest first. A transform
   * built from the trades gets the side of each trade's taker, `null` when unknown; one built
   * from bars gets `null`.
   */
  next(bar: Bar, side: TradeSide | null): readonly Bar[];
  /** The output bar still forming after the latest input bar, or `null`. */
  current(): Bar | null;
  /** An independent copy, which the chart uses to resume from before the latest input bar. */
  clone(): BarTransformStream;
  /**
   * The parameters the stream builds with, defaults and sizes worked out from the bars filled
   * in, such as `{ box: 2500, reversal: 3 }` for an automatic box; `null` while the bars do not
   * tell them yet. Optional: `transforms.get()` reports them as `resolved`, and a series type
   * drawing the transform's bars reads them, as point & figure reads its box size.
   */
  resolved?(): Readonly<Record<string, unknown>> | null;
}

/**
 * Builds the displayed bars from the bars of the timeframe, such as Heikin-Ashi candles or Renko
 * bricks. Register custom transforms with `chart.transforms.register()`.
 */
export interface BarTransformDefinition<P extends object = Record<string, unknown>> {
  /** The type the transform is set by, such as `renko`. */
  readonly type: string;
  /** Display name, such as `Renko`. */
  readonly name: string;
  /**
   * Whether every input bar becomes one output bar with the same time, like Heikin-Ashi. The
   * chart then keeps the features that rely on the timeframe, such as the bar countdown.
   */
  readonly keepsTime: boolean;
  /**
   * Validates the parameters and starts a stream. `input` holds the bars the stream is about to
   * receive, for statistics such as an automatic box size; `from` says what they are, the bars of
   * the timeframe or the trades. The chart calls it again whenever the input is rebuilt (new
   * data, timeframe, history or replay start); appended and updated bars resume the running
   * stream.
   */
  create(params: P, input: BarsView, from: 'bars' | 'trades'): BarTransformStream;
}

export interface BarTransformInput {
  type: string;
  params?: Record<string, unknown>;
  /**
   * What the transform reads: `bars`, the bars of the timeframe (default), or `trades`, every
   * trade passed to `data.addTrades()` that the chart keeps (`performance.maxTrades`), each as a
   * bar whose open, high, low and close are its price and whose volume is its size.
   */
  input?: 'bars' | 'trades';
}

/** The transform building the displayed bars, as `chart.transforms.get()` reports it. */
export interface BarTransformState extends Required<BarTransformInput> {
  /**
   * The parameters the bars are built with, as the transform reports them: defaults and sizes
   * worked out from the bars filled in, such as `{ reversal: 2500 }` for Kagi lines whose
   * reversal follows the average true range. `null` for transforms that do not report them, and
   * while the bars do not tell them yet.
   */
  resolved: Readonly<Record<string, unknown>> | null;
}

/** What a transform stage reads, by position, oldest first. */
export interface StageInput {
  readonly revision: number;
  /** How the bars changed after `revision`; positions as in `bar()`. */
  changesSince(revision: number): BarChange | null;
  /** Position of the oldest bar kept; older ones were dropped. */
  readonly first: number;
  /** Position after the newest bar. */
  readonly end: number;
  /** The bar at a position from `first` up to `end`, which callers keep to. */
  bar(position: number): Bar;
  /** The side of the taker of the trade at a position, `null` for a bar or when unknown. */
  side(position: number): TradeSide | null;
  /** The bars kept, from the oldest, for `create()`. */
  view(): BarsView;
}

/** The bars of the timeframe as the input of a stage. */
export class TimeBars implements StageInput {
  readonly first = 0;

  constructor(private readonly store: BarStore) {}

  get revision(): number {
    return this.store.revision;
  }

  get end(): number {
    return this.store.length;
  }

  changesSince(revision: number): BarChange | null {
    return this.store.changesSince(revision);
  }

  bar(position: number): Bar {
    return this.store.read(position);
  }
  side(): null {
    return null;
  }

  view(): BarsView {
    return this.store;
  }
}

/** Output bars must be ordered; bars with the same time are spaced by a millisecond. */
function spaced(bars: readonly Bar[], previous: number, type: string): Bar[] {
  const result: Bar[] = [];
  let last = previous;
  let lastRaw = Number.NEGATIVE_INFINITY;

  for (const bar of bars) {
    const finite =
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      Number.isFinite(bar.volume);

    if (!finite) {
      fail(`The "${type}" transform produced a bar with a value that is not a finite number.`);
    }

    if (bar.time < lastRaw) {
      fail(
        `The "${type}" transform produced a bar at ${describeTime(bar.time)} after a bar at ${describeTime(lastRaw)}; times must not decrease.`
      );
    }

    lastRaw = bar.time;
    last = Math.max(bar.time, last + 1);
    result.push(last === bar.time ? bar : { ...bar, time: last });
  }

  return result;
}

/**
 * Keeps `output` built from `input` by a transform. A stream holds the state after every input
 * bar but the last one, which may still change: a tick re-runs only that bar on a copy, and
 * appended bars extend the stream, so indicators and alerts on the output stay incremental.
 * Input bars dropped after they were fed (old trades) leave their output bars as they are.
 */
export class TransformStage {
  private stream: BarTransformStream | null = null;
  /** The stream that built the latest output: a copy fed the last input bar too. */
  private latest: BarTransformStream | null = null;
  /** Position after the input bars fed to the stream: every one but the last. */
  private fed = 0;
  /** Output bars completed by them. */
  private completed = 0;
  private seen = -1;

  constructor(
    private readonly input: StageInput,
    /** What `input` is: the bars of the timeframe or the trades. */
    readonly from: 'bars' | 'trades',
    private readonly output: BarStore,
    readonly type: string,
    readonly definition: BarTransformDefinition,
    readonly params: Record<string, unknown>
  ) {}

  /**
   * How many output bars are final: those the input bars before the latest one completed, not
   * the provisional bars of the latest one, which its next tick builds anew.
   */
  get settled(): number {
    return this.completed;
  }

  /** The close of the latest input bar, or `null` without one. */
  lastClose(): number | null {
    const { first, end } = this.input;
    return end > first ? this.input.bar(end - 1).close : null;
  }

  /** What the stream reports it builds with as of the latest input bar, or `null`. */
  resolved(): Readonly<Record<string, unknown>> | null {
    return this.latest?.resolved?.() ?? null;
  }

  /**
   * Brings the output up to date with the input. A transform that fails, such as on a size far
   * too small for the prices, leaves the output and the stream as they were, to try again.
   */
  sync(): void {
    const change = this.input.changesSince(this.seen);

    if (!change) {
      return;
    }

    if (
      change.kind === 'tail' &&
      this.stream &&
      change.from >= this.fed &&
      this.fed >= this.input.first
    ) {
      this.extend(this.stream);
    } else {
      this.rebuild();
    }

    this.seen = this.input.revision;
  }

  private rebuild(): void {
    const stream = this.definition.create(this.params, this.input.view(), this.from);
    const run = this.feed(stream, this.input.first);
    const bars = spaced(run.bars, Number.NEGATIVE_INFINITY, this.type);
    this.commit(stream, run, 0);
    this.output.assign(bars);
  }

  private extend(current: BarTransformStream): void {
    // Feeding bars moves a stream on: a copy is fed, kept once its bars are good.
    const stream = this.fed < this.input.end - 1 ? current.clone() : current;
    const from = this.completed;
    const run = this.feed(stream, this.fed);
    const previous = from > 0 ? this.output.time(from - 1) : Number.NEGATIVE_INFINITY;
    const bars = spaced(run.bars, previous, this.type);
    this.commit(stream, run, from);
    this.output.replaceFrom(from, bars);
  }

  private commit(stream: BarTransformStream, run: FeedRun, completedBefore: number): void {
    this.stream = stream;
    this.fed = run.fed;
    this.completed = completedBefore + run.completed;
    this.latest = run.latest;
  }

  /**
   * Feeds `stream` the input bars from position `fed` on, except the last: the bars they complete,
   * followed by the provisional bars of the last input bar, fed to a copy.
   */
  private feed(stream: BarTransformStream, fed: number): FeedRun {
    const length = this.input.end;
    const bars: Bar[] = [];
    let position = fed;

    for (; position < length - 1; position += 1) {
      for (const output of stream.next(this.input.bar(position), this.input.side(position))) {
        bars.push(output);
      }
    }

    const completed = bars.length;
    let latest = stream;

    // Without input bars from `fed` on, there is no last one.
    if (length > fed) {
      const copy = stream.clone();
      bars.push(...copy.next(this.input.bar(length - 1), this.input.side(length - 1)));
      const forming = copy.current();
      latest = copy;

      if (forming) {
        bars.push(forming);
      }
    }

    return { bars, fed: position, completed, latest };
  }
}

/** What feeding a stream gave: its bars, how far it was fed, and the stream of the latest bar. */
interface FeedRun {
  readonly bars: readonly Bar[];
  readonly fed: number;
  /** How many of the bars the input bars fed completed; the rest are provisional. */
  readonly completed: number;
  readonly latest: BarTransformStream;
}

/** The transform types of a chart: none until a module or `chart.transforms.register()` adds them. */
export function createTransformRegistry(): Registry<BarTransformDefinition> {
  return new Registry<BarTransformDefinition>(
    'bar transform',
    [],
    'Give it to the chartTypes module, or register it with chart.transforms.register().'
  );
}

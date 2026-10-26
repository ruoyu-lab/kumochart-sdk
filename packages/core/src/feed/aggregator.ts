import { BarStore, parseBars } from '../data/bar-store';
import { shiftStart, withRoom, type Column } from '../data/columns';
import { checkAscending, planTail } from '../data/points';
import { describeTime } from '../data/time';
import type { Bar, BarChange, BarInput, ValuePoint, ValuePointInput } from '../data/types';
import { parseValuePoints, ValueStore } from '../data/value-store';
import { fail } from '../utils/errors';
import type { Bucketer } from './calendar';

/** Every point is a bucket of its own: points are displayed as given. */
export const identityBucketer: Bucketer = (time) => time;

/** Time-sorted storage a feed reads its source from and writes its display to. */
interface TimeStore<P> {
  readonly length: number;
  time(index: number): number;
  lowerBound(time: number): number;
  clear(): void;
  assign(points: readonly P[]): void;
  replaceFrom(from: number, points: readonly P[]): void;
  insertBefore(points: readonly P[]): void;
  /** Replaces the first `count` points with `points`, older than the points after them. */
  replaceFirst(count: number, points: readonly P[]): void;
}

/** How points of one kind are parsed and merged into buckets. */
interface PointKind<Input, P, S> {
  readonly label: string;
  readonly noun: string;
  parse(inputs: readonly Input[], label: string): P[];
  /** Merges the source points `[from, to)` into one point per bucket. */
  aggregate(source: S, buckets: BucketColumn, from: number, to: number): P[];
}

function noop(): void {
  // Nothing to apply.
}

/** Bucket start of every source point; `NaN` marks points the calendar drops. */
class BucketColumn {
  private values: Column = new Float64Array(0);
  private count = 0;

  at(index: number): number {
    return this.values[index] ?? Number.NaN;
  }

  assign(buckets: Column): void {
    this.values = buckets;
    this.count = buckets.length;
  }

  clear(): void {
    this.count = 0;
  }

  /** Keeps the buckets before `from` and writes `buckets` after them. */
  writeFrom(from: number, buckets: Float64Array): void {
    const count = from + buckets.length;
    this.values = withRoom(this.values, from, count);
    this.values.set(buckets, from);
    this.count = count;
  }

  /** Puts `buckets` before the first, in room kept in front of it as the bars keep it. */
  prepend(buckets: Float64Array): void {
    this.values = shiftStart(this.values, this.count, buckets.length);
    this.values.set(buckets);
    this.count += buckets.length;
  }

  /** The last bucket before `index` that is not dropped, or `-Infinity`. */
  lastBefore(index: number): number {
    for (let position = index - 1; position >= 0; position -= 1) {
      const bucket = this.at(position);

      if (!Number.isNaN(bucket)) {
        return bucket;
      }
    }

    return Number.NEGATIVE_INFINITY;
  }

  /** The first bucket that is not dropped, or `Infinity`. */
  first(): number {
    for (let position = 0; position < this.count; position += 1) {
      const bucket = this.at(position);

      if (!Number.isNaN(bucket)) {
        return bucket;
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  /** Walks back from `index` over the points that are dropped or belong to `bucket`. */
  runStart(index: number, bucket: number): number {
    let start = index;

    while (start > 0) {
      const previous = this.at(start - 1);

      if (!Number.isNaN(previous) && previous !== bucket) {
        break;
      }

      start -= 1;
    }

    return start;
  }
}

/**
 * Buckets `count` times, checking that buckets never decrease and stay at or after `floor`.
 * `bucketOf` receives the position and the time.
 */
function bucketTimes(
  count: number,
  timeAt: (index: number) => number,
  bucketOf: (index: number, time: number) => number | null,
  floor: number
): Column {
  const buckets = new Float64Array(count);
  let previous = floor;

  for (let index = 0; index < count; index += 1) {
    const time = timeAt(index);
    const bucket = bucketOf(index, time);

    if (bucket === null) {
      buckets[index] = Number.NaN;
      continue;
    }

    if (bucket < previous) {
      fail(
        `The calendar puts ${describeTime(time)} into the bucket ${describeTime(bucket)}, before the bucket ${describeTime(previous)} of an earlier time; buckets must not decrease with time.`
      );
    }

    buckets[index] = bucket;
    previous = bucket;
  }

  return buckets;
}

/**
 * Source points and the points displayed from them: each displayed point merges the source
 * points of one bucket. Writes validate everything first and return the function that applies
 * them, so several feeds can be changed all or nothing.
 */
export class Feed<Input, P extends { readonly time: number }, S extends TimeStore<P>> {
  private readonly buckets = new BucketColumn();
  /** Source points after this time are hidden (replay). */
  private cutoff = Number.POSITIVE_INFINITY;
  /** Counts the cutoff moves that revealed or hid points. */
  private moves = 0;

  constructor(
    readonly source: S,
    private target: S,
    private readonly kind: PointKind<Input, P, S>,
    /** Buckets the source points from the first one written; replaced by a set or rebucket. */
    private bucketer: Bucketer
  ) {}

  /** Where the displayed points are written. */
  get display(): S {
    return this.target;
  }

  /** Writes the displayed points to `display` from now on, starting with all of them. */
  setDisplay(display: S): void {
    this.target.clear();
    this.target = display;
    this.rebuild();
  }

  /** Replaces the source and buckets it with `bucketer` from now on. */
  planSet(inputs: readonly Input[], bucketer: Bucketer): () => void {
    const points = this.kind.parse(inputs, this.kind.label);
    checkAscending(points, this.kind.label);
    const buckets = bucketTimes(
      points.length,
      (index) => points[index]?.time ?? Number.NaN,
      (_index, time) => bucketer(time),
      Number.NEGATIVE_INFINITY
    );

    return () => {
      this.source.assign(points);
      this.buckets.assign(buckets);
      this.bucketer = bucketer;
      this.rebuild();
    };
  }

  /** Replaces the last source point or appends newer ones; the display changes from its tail. */
  planUpdate(inputs: readonly Input[]): () => void {
    const { label, noun } = this.kind;
    const count = this.source.length;
    const { from, tail } = planTail(
      this.kind.parse(inputs, label),
      count,
      this.source.time(count - 1),
      label,
      noun
    );

    if (tail.length === 0) {
      return noop;
    }

    // A point replacing the last one has its time, and so its bucket.
    const replaced = from < count ? this.buckets.at(from) : Number.NaN;
    const buckets = bucketTimes(
      tail.length,
      (index) => tail[index]?.time ?? Number.NaN,
      (index, time) =>
        index === 0 && from < count
          ? Number.isNaN(replaced)
            ? null
            : replaced
          : this.bucketer(time),
      this.buckets.lastBefore(from)
    );

    return () => {
      this.source.replaceFrom(from, tail);
      this.buckets.writeFrom(from, buckets);

      this.refresh(from, this.limit());
    };
  }

  /** Inserts source points older than the first one; returns how many and how to apply them. */
  planPrepend(inputs: readonly Input[]): { inserted: number; commit: () => void } {
    const points = this.kind.parse(inputs, this.kind.label);
    checkAscending(points, this.kind.label);
    const firstTime = this.source.length ? this.source.time(0) : Number.POSITIVE_INFINITY;
    const older = points.filter((point) => point.time < firstTime);

    if (older.length === 0) {
      return { inserted: 0, commit: noop };
    }

    const buckets = bucketTimes(
      older.length,
      (index) => older[index]?.time ?? Number.NaN,
      (_index, time) => this.bucketer(time),
      Number.NEGATIVE_INFINITY
    );
    const last = buckets.reduce(
      (latest, bucket) => (Number.isNaN(bucket) ? latest : bucket),
      Number.NEGATIVE_INFINITY
    );
    const next = this.buckets.first();

    if (last > next) {
      fail(
        `The calendar puts older points into the bucket ${describeTime(last)}, after the bucket ${describeTime(next)} of a later time; buckets must not decrease with time.`
      );
    }

    return {
      inserted: older.length,
      commit: () => {
        this.source.insertBefore(older);
        this.buckets.prepend(buckets);
        this.showOlder(older.length);
      }
    };
  }

  /** Buckets the whole source with `bucketer`, e.g. for another timeframe or calendar. */
  planRebucket(bucketer: Bucketer): () => void {
    const buckets = bucketTimes(
      this.source.length,
      (index) => this.source.time(index),
      (_index, time) => bucketer(time),
      Number.NEGATIVE_INFINITY
    );

    return () => {
      this.buckets.assign(buckets);
      this.bucketer = bucketer;
      this.rebuild();
    };
  }

  /**
   * Follows a source another feed writes, such as the chart's source bars in buckets of their
   * own: buckets the points that `change` reports anew and refreshes the display from them.
   */
  follow(change: BarChange): void {
    if (change.kind === 'reset') {
      this.planRebucket(this.bucketer)();
      return;
    }

    const { from } = change;
    const buckets = bucketTimes(
      this.source.length - from,
      (index) => this.source.time(from + index),
      (_index, time) => this.bucketer(time),
      this.buckets.lastBefore(from)
    );
    this.buckets.writeFrom(from, buckets);
    this.refresh(from, this.limit());
  }

  /** The time after which source points are hidden; `Infinity` while all show. */
  cutoffTime(): number {
    return this.cutoff;
  }

  /**
   * Hides the source points after `time` (`Infinity` shows all). The display changes from the
   * bucket of the first point shown or hidden; returns whether it changed.
   */
  setCutoff(time: number): boolean {
    const previous = this.limit();
    this.cutoff = time;
    const next = this.limit();

    if (next === previous) {
      return false;
    }

    this.moves += 1;
    return this.refresh(Math.min(previous, next), Math.max(previous, next));
  }

  /**
   * The cutoff that reveals the next source point after `time`, or with `whole`, every source
   * point of the next displayed point (completing the one in progress). `null` at the end.
   */
  nextCutoff(time: number, whole: boolean): number | null {
    const count = this.source.length;
    let index = this.countUpTo(time);

    if (index >= count) {
      return null;
    }

    if (whole) {
      while (index < count - 1 && Number.isNaN(this.buckets.at(index))) {
        index += 1;
      }

      const bucket = this.buckets.at(index);

      while (index < count - 1) {
        const next = this.buckets.at(index + 1);

        if (!Number.isNaN(next) && next !== bucket) {
          break;
        }

        index += 1;
      }
    }

    return this.source.time(index);
  }

  /** Number of source points at or before the cutoff. */
  revealed(): number {
    return this.limit();
  }

  /** How often the cutoff revealed or hid points. */
  cutoffMoves(): number {
    return this.moves;
  }

  /** Time of the first source point, or `null` without points. */
  firstTime(): number | null {
    return this.source.length > 0 ? this.source.time(0) : null;
  }

  clear(): void {
    this.source.clear();
    this.buckets.clear();
    this.display.clear();
  }

  /** Number of source points at or before the cutoff. */
  private limit(): number {
    return this.countUpTo(this.cutoff);
  }

  /** Number of source points at or before `time`. */
  private countUpTo(time: number): number {
    if (time === Number.POSITIVE_INFINITY) {
      return this.source.length;
    }

    let low = 0;
    let high = this.source.length;

    while (low < high) {
      const middle = (low + high) >>> 1;

      if (this.source.time(middle) <= time) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  private rebuild(): void {
    this.display.assign(this.kind.aggregate(this.source, this.buckets, 0, this.limit()));
  }

  /**
   * Shows the `added` source points inserted before the first: aggregated with the source points
   * of the first displayed point, whose bucket they may share, in its place. The points after it
   * stay as they are, so older history costs the points it adds, not every point again. Without a
   * displayed point, as before the cutoff, the display is built anew.
   */
  private showOlder(added: number): void {
    const display = this.display;

    if (display.length === 0) {
      this.rebuild();
      return;
    }

    // A displayed point's time is its bucket, which only its own source points and dropped ones
    // run through: the next bucket starts the points that stay.
    const bucket = display.time(0);
    const limit = this.limit();
    let end = added;

    while (end < limit) {
      const next = this.buckets.at(end);

      if (!Number.isNaN(next) && next !== bucket) {
        break;
      }

      end += 1;
    }

    display.replaceFirst(1, this.kind.aggregate(this.source, this.buckets, 0, end));
  }

  /**
   * Re-aggregates the display after the source points `[from, to)` changed, were revealed or
   * hidden, from the bucket of the first of them that is not dropped. Changes that only touch the
   * last displayed point or append are written as a tail, so indicators and alerts update
   * incrementally; anything else rebuilds the display. Returns whether the display changed.
   */
  private refresh(from: number, to: number): boolean {
    let first = from;

    while (first < to && Number.isNaN(this.buckets.at(first))) {
      first += 1;
    }

    if (first >= to) {
      return false;
    }

    const bucket = this.buckets.at(first);
    const displayFrom = this.display.lowerBound(bucket);
    const points = this.kind.aggregate(
      this.source,
      this.buckets,
      this.buckets.runStart(first, bucket),
      this.limit()
    );
    const length = this.display.length;

    if (displayFrom >= length - 1 && displayFrom + points.length >= length) {
      this.display.replaceFrom(displayFrom, points);
    } else {
      this.rebuild();
    }

    return true;
  }
}

/** OHLCV per bucket: first open, highest high, lowest low, last close, summed volume. */
function aggregateBars(source: BarStore, buckets: BucketColumn, from: number, to: number): Bar[] {
  const bars: Bar[] = [];
  let time = Number.NaN;
  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;
  let volume = 0;

  for (let index = from; index < to; index += 1) {
    const bucket = buckets.at(index);

    if (Number.isNaN(bucket)) {
      continue;
    }

    if (bucket === time) {
      high = Math.max(high, source.high(index));
      low = Math.min(low, source.low(index));
      close = source.close(index);
      volume += source.volume(index);
      continue;
    }

    if (!Number.isNaN(time)) {
      bars.push({ time, open, high, low, close, volume });
    }

    time = bucket;
    open = source.open(index);
    high = source.high(index);
    low = source.low(index);
    close = source.close(index);
    volume = source.volume(index);
  }

  if (!Number.isNaN(time)) {
    bars.push({ time, open, high, low, close, volume });
  }

  return bars;
}

/** The last value of each bucket; a bucket with gaps only is a gap. */
function aggregateValues(
  source: ValueStore,
  buckets: BucketColumn,
  from: number,
  to: number
): ValuePoint[] {
  const points: ValuePoint[] = [];
  let time = Number.NaN;
  let value = Number.NaN;

  for (let index = from; index < to; index += 1) {
    const bucket = buckets.at(index);

    if (Number.isNaN(bucket)) {
      continue;
    }

    if (bucket !== time) {
      if (!Number.isNaN(time)) {
        points.push({ time, value });
      }

      time = bucket;
      value = Number.NaN;
    }

    const next = source.value(index);

    if (!Number.isNaN(next)) {
      value = next;
    }
  }

  if (!Number.isNaN(time)) {
    points.push({ time, value });
  }

  return points;
}

const BAR_POINTS: PointKind<BarInput, Bar, BarStore> = {
  label: 'bars',
  noun: 'bar',
  parse: parseBars,
  aggregate: aggregateBars
};

const VALUE_POINTS: PointKind<ValuePointInput, ValuePoint, ValueStore> = {
  label: 'points',
  noun: 'point',
  parse: parseValuePoints,
  aggregate: aggregateValues
};

export type BarFeed = Feed<BarInput, Bar, BarStore>;
export type ValueFeed = Feed<ValuePointInput, ValuePoint, ValueStore>;

/** A feed of OHLCV bars bucketed by `bucketer` and displayed in `display`. */
export function createBarFeed(bucketer: Bucketer, display = new BarStore()): BarFeed {
  return new Feed(new BarStore(), display, BAR_POINTS, bucketer);
}

/**
 * A feed of the bars of `source`, which another feed writes, bucketed by `bucketer` into a
 * display of its own: it takes their changes with `follow()` and their cutoff with `setCutoff()`.
 */
export function followBars(source: BarStore, bucketer: Bucketer): BarFeed {
  return new Feed(source, new BarStore(), BAR_POINTS, bucketer);
}

/** A feed of value points bucketed by `bucketer`. */
export function createValueFeed(bucketer: Bucketer): ValueFeed {
  return new Feed(new ValueStore(), new ValueStore(), VALUE_POINTS, bucketer);
}

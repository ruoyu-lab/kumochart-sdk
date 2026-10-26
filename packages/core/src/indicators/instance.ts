import type { BarStore } from '../data/bar-store';
import type { Bar, PriceSource } from '../data/types';
import { sameInterval } from '../feed/interval';
import { fail } from '../utils/errors';
import { checkNumber, checkObject } from '../utils/validate';
import type { IndicatorBasis, Reach } from './basis';
import type {
  BarWindow,
  IndicatorContext,
  IndicatorDefinition,
  IndicatorOutput,
  IndicatorStream,
  ParamValues
} from './types';

interface MutableBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const EMPTY_BAR: Bar = { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };

/** Wraps a `lookback`/`compute` definition into a stream over a ring of recent bars. */
class WindowStream implements IndicatorStream, BarWindow {
  private start = 0;
  private size = 0;
  private readonly empty: Float64Array;

  constructor(
    private readonly capacity: number,
    outputCount: number,
    private readonly compute: (window: BarWindow) => ArrayLike<number>,
    /** time, open, high, low, close, volume and price columns. */
    private readonly columns: Float64Array[] = Array.from(
      { length: 7 },
      () => new Float64Array(capacity)
    )
  ) {
    this.empty = new Float64Array(outputCount).fill(Number.NaN);
  }

  get length(): number {
    return this.size;
  }

  bar(index: number): Bar {
    const slot = (this.start + index) % this.capacity;
    const read = (column: number) => this.columns[column]?.[slot] ?? Number.NaN;
    return {
      time: read(0),
      open: read(1),
      high: read(2),
      low: read(3),
      close: read(4),
      volume: read(5)
    };
  }

  price(index: number): number {
    return this.columns[6]?.[(this.start + index) % this.capacity] ?? Number.NaN;
  }

  next(bar: Bar, price: number): ArrayLike<number> {
    const slot = this.size < this.capacity ? (this.start + this.size) % this.capacity : this.start;
    const values = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume, price];
    this.columns.forEach((column, index) => {
      column[slot] = values[index] ?? Number.NaN;
    });

    if (this.size < this.capacity) {
      this.size += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }

    return this.size === this.capacity ? this.compute(this) : this.empty;
  }

  clone(): IndicatorStream {
    const copy = new WindowStream(
      this.capacity,
      this.empty.length,
      this.compute,
      this.columns.map((column) => column.slice())
    );
    copy.start = this.start;
    copy.size = this.size;
    return copy;
  }
}

/**
 * The stream of a definition, its own or one over a window of the latest bars, with parameters
 * checked together with the window they make.
 */
export function createStream(
  definition: IndicatorDefinition,
  params: ParamValues,
  outputCount: number,
  context: IndicatorContext
): IndicatorStream {
  if ('create' in definition) {
    return definition.create(params, context);
  }

  return new WindowStream(definition.lookback(params), outputCount, (window) =>
    definition.compute(window, params, context)
  );
}

/** Merges parameter overrides into the definition defaults and validates them. */
export function resolveParams(
  definition: Pick<IndicatorDefinition, 'params'>,
  overrides: ParamValues | undefined,
  type: string
): ParamValues {
  const params: Record<string, number | readonly number[]> = {};

  if (overrides !== undefined) {
    checkObject('params', overrides);
  }

  for (const key of Object.keys(overrides ?? {})) {
    if (!Object.hasOwn(definition.params, key)) {
      fail(`Indicator "${type}" has no parameter "${key}".`);
    }
  }

  for (const [key, spec] of Object.entries(definition.params)) {
    // Only a parameter left out takes its default: `null` is checked, and fails, as a value.
    const value = overrides?.[key] === undefined ? spec.default : overrides[key];
    const rule = {
      ...(spec.min !== undefined ? { min: spec.min } : {}),
      ...(spec.max !== undefined ? { max: spec.max } : {}),
      ...(spec.integer ? { integer: true } : {})
    };
    const check = (path: string, item: unknown): number => {
      const number = checkNumber(path, item, rule);

      if (spec.options && !spec.options.some((option) => option.value === number)) {
        const names = spec.options.map((option) => `${option.value} (${option.label})`);
        fail(`${path} must be one of ${names.join(', ')}, received ${number}.`);
      }

      return number;
    };

    if (Array.isArray(spec.default)) {
      const least = spec.default.length === 0 ? 0 : 1;

      if (!Array.isArray(value) || value.length < least || value.length > 8) {
        fail(
          `Parameter "${key}" of indicator "${type}" must be a list of ${String(least)} to 8 numbers.`
        );
      }

      (value as readonly number[]).forEach((item, index) => {
        check(`params.${key}[${index}]`, item);
      });
      params[key] = [...(value as readonly number[])];
    } else {
      params[key] = check(`params.${key}`, value);
    }
  }

  return params;
}

/** Another indicator's output an indicator reads, looked up on every sync. */
export type Upstream = () => { readonly series: IndicatorSeries; readonly column: number };

/** Whether two contexts give a calculator the same calendar and interval. */
function sameContext(left: IndicatorContext, right: IndicatorContext | null): boolean {
  return (
    right !== null &&
    left.calendar === right.calendar &&
    sameInterval(left.interval, right.interval)
  );
}

/**
 * Values of one indicator over the bars of its basis, such as the displayed bars, or over another
 * indicator's output, on that one's bars. Recomputes from scratch when the bars (or the upstream
 * indicator, or the basis, or the context) are reset or change before the last bar computed, and
 * otherwise resumes from a checkpoint taken before the last bar, so a tick costs one step.
 */
export class IndicatorSeries {
  private columns: Float64Array[];
  private stream: IndicatorStream | null = null;
  private checkpoint: IndicatorStream | null = null;
  private computedCount = 0;
  private revision = -1;
  private readonly scratch: MutableBar = { ...EMPTY_BAR };
  /** Counts full recomputations, so downstream indicators know to start over. */
  private rebuilds = 0;
  /** Counts the times the values changed, so what is worked out of them knows to again. */
  private changes = 0;
  private upstreamSeen: { series: IndicatorSeries; rebuilds: number } | null = null;
  private contextSeen: IndicatorContext | null = null;
  /** The bars the values were last computed on. */
  private current: IndicatorBasis;

  constructor(
    private readonly definition: IndicatorDefinition,
    private readonly params: ParamValues,
    readonly outputs: readonly IndicatorOutput[],
    private readonly source: PriceSource | Upstream,
    /**
     * The bars it is computed on, up to date, when its source is a price; an indicator reading
     * another is computed on that one's.
     */
    private readonly basis: () => IndicatorBasis
  ) {
    this.columns = outputs.map(() => new Float64Array(0));
    this.current = typeof source === 'function' ? source().series.current : basis();
  }

  /** Brings the values up to date with the bars, the upstream indicator and the context. */
  sync(): void {
    const upstream = typeof this.source === 'function' ? this.source() : null;
    upstream?.series.sync();
    const basis = upstream ? upstream.series.current : this.basis();
    const context = basis.context();
    const rebuilt =
      basis !== this.current ||
      !sameContext(context, this.contextSeen) ||
      (upstream !== null &&
        (upstream.series !== this.upstreamSeen?.series ||
          upstream.series.rebuilds !== this.upstreamSeen.rebuilds));
    const store = basis.bars;
    const change = rebuilt ? { kind: 'reset' as const } : store.changesSince(this.revision);
    this.current = basis;
    this.contextSeen = context;

    if (upstream) {
      this.upstreamSeen = { series: upstream.series, rebuilds: upstream.series.rebuilds };
    }

    if (!change) {
      return;
    }

    const count = store.length;
    this.ensureCapacity(count);

    // The checkpoint was taken before the last bar computed: a change from an earlier bar, such
    // as bricks a transform builds again, starts over.
    if (change.kind === 'reset' || !this.checkpoint || change.from < this.computedCount - 1) {
      this.stream = createStream(this.definition, this.params, this.outputs.length, context);
      this.rebuilds += 1;
      this.run(store, 0, count, upstream);
    } else {
      this.stream = this.checkpoint.clone();
      this.run(store, this.computedCount - 1, count, upstream);
    }

    this.computedCount = count;
    this.revision = store.revision;
    this.changes += 1;
  }

  /** Changes whenever the values do, as of the latest `sync()`. */
  get version(): number {
    return this.changes;
  }

  /** How many bars the values are computed on. */
  get length(): number {
    return this.computedCount;
  }

  /** The bars the values are computed on. */
  get bars(): BarStore {
    return this.current.bars;
  }

  /**
   * The first logical index of the displayed bars that the value of output `column` computed on
   * bar `index` of its bars is drawn on.
   */
  indexOf(column: number, index: number): number {
    return this.current.indexOf(index + this.shift(column));
  }

  /** Value of output `column` computed on bar `index` of its bars; `NaN` when absent. */
  value(column: number, index: number): number {
    // The columns keep stale values past the bars after a reset, e.g. when replay seeks back.
    return index < this.computedCount ? (this.columns[column]?.[index] ?? Number.NaN) : Number.NaN;
  }

  /** Bars from where output `column` is computed to where it is drawn, including its input's. */
  shift(column: number): number {
    const upstream = typeof this.source === 'function' ? this.source() : null;
    const own = this.outputs[column]?.offset ?? 0;
    return upstream ? own + upstream.series.shift(upstream.column) : own;
  }

  /**
   * Reads output `column` by the logical index of the displayed bars it is drawn on, or `back`
   * bars before the bar shown there, as a change is measured from the bar before.
   */
  reader(column: number, back = 0): (index: number) => number {
    const shift = this.shift(column) + back;
    const basis = this.current;
    return (index) => this.value(column, basis.barAt(index) - shift);
  }

  /** Value of output `column` drawn on logical index `index`, which may lie beyond the bars. */
  drawn(column: number, index: number): number {
    return this.reader(column)(index);
  }

  /** Where output `column` is drawn beyond the displayed bars, as far as it is shifted. */
  reach(column: number): Reach {
    return this.current.reach(this.shift(column));
  }

  /**
   * Whether logical index `index` is the first to show its bar of those the values are computed
   * on, as each displayed bar is when they are the displayed bars: where a marker of it goes.
   */
  opens(index: number): boolean {
    return this.current.barAt(index) !== this.current.barAt(index - 1);
  }

  /** Whether the bar shown on logical index `index` closed at or above its open. */
  rises(index: number): boolean {
    const { bars } = this.current;
    const bar = this.current.barAt(index);
    return bar >= 0 && bar < bars.length && bars.close(bar) >= bars.open(bar);
  }

  private run(
    store: BarStore,
    from: number,
    to: number,
    upstream: { readonly series: IndicatorSeries; readonly column: number } | null
  ): void {
    const stream = this.stream;

    if (!stream) {
      return;
    }

    for (let index = from; index < to; index += 1) {
      if (index === to - 1) {
        this.checkpoint = stream.clone();
      }

      const bar = this.readBar(store, index);
      let price: number;

      if (upstream) {
        price = upstream.series.value(upstream.column, index);

        // Bars without an upstream value (e.g. while it warms up) are skipped, not fed as NaN.
        if (Number.isNaN(price)) {
          this.columns.forEach((column) => {
            column[index] = Number.NaN;
          });
          continue;
        }

        bar.open = price;
        bar.high = price;
        bar.low = price;
        bar.close = price;
      } else {
        price = store.price(index, this.source as PriceSource);
      }

      const values = stream.next(bar, price);

      for (let column = 0; column < this.columns.length; column += 1) {
        const target = this.columns[column];

        if (target) {
          target[index] = values[column] ?? Number.NaN;
        }
      }
    }

    if (from >= to) {
      this.checkpoint = null;
    }
  }

  private readBar(store: BarStore, index: number): MutableBar {
    const bar = this.scratch;
    bar.time = store.time(index);
    bar.open = store.open(index);
    bar.high = store.high(index);
    bar.low = store.low(index);
    bar.close = store.close(index);
    bar.volume = store.volume(index);
    return bar;
  }

  private ensureCapacity(count: number): void {
    const current = this.columns[0]?.length ?? 0;

    if (current >= count) {
      return;
    }

    const capacity = Math.max(64, count, current * 2);
    this.columns = this.columns.map((column) => {
      const next = new Float64Array(capacity).fill(Number.NaN);
      next.set(column.subarray(0, Math.min(column.length, count)));
      return next;
    });
  }
}

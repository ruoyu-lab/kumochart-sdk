import type { Bar, BarsView } from '../data/types';
import type { BarTransformStream } from '../feed/transform';
import { fail } from '../utils/errors';
import { checkNumber } from '../utils/validate';

/** The ATR length that sizes Renko bricks, Kagi reversals and point & figure boxes by default. */
export const DEFAULT_ATR_LENGTH = 14;

/**
 * How a Renko brick, a Kagi reversal or a point & figure box is sized: a fixed amount
 * (traditional), a percentage of the last close, or the average true range of the bars.
 */
export type SizeRule =
  | { readonly kind: 'fixed'; readonly size: number }
  | { readonly kind: 'percentage'; readonly percentage: number }
  | { readonly kind: 'atr'; readonly length: number };

/** A rule the bars give the size by. */
type AutomaticRule = Exclude<SizeRule, { kind: 'fixed' }>;

/** The message of a transform built from trades by the average true range, which they lack. */
export function tradesHaveNoRange(type: string, sizes: string): string {
  return `Trades have no true range to size the "${type}" transform by: give ${sizes}.`;
}

/**
 * The size rule of a transform's parameters: `key` for a fixed size, `percentage` for a share
 * of the last close, otherwise the average true range over `atrLength` bars (14), which trades,
 * each a price alone, do not have.
 */
export function sizeRuleOf(
  type: string,
  key: string,
  params: Record<string, unknown>,
  from: 'bars' | 'trades'
): SizeRule {
  const given = [key, 'percentage', 'atrLength'].filter((name) => params[name] !== undefined);

  if (given.length > 1) {
    fail(
      `The "${type}" transform takes one of params.${key}, params.percentage and params.atrLength, received ${given.map((name) => `params.${name}`).join(' and ')}.`
    );
  }

  if (params[key] !== undefined) {
    return {
      kind: 'fixed',
      size: checkNumber(`params.${key}`, params[key], { min: 0, exclusiveMin: true })
    };
  }

  if (params.percentage !== undefined) {
    return {
      kind: 'percentage',
      percentage: checkNumber('params.percentage', params.percentage, {
        min: 0,
        exclusiveMin: true,
        max: 100
      })
    };
  }

  if (from === 'trades') {
    fail(tradesHaveNoRange(type, `params.${key} or params.percentage`));
  }

  const length =
    params.atrLength === undefined
      ? DEFAULT_ATR_LENGTH
      : checkNumber('params.atrLength', params.atrLength, { min: 1, max: 1000, integer: true });
  return { kind: 'atr', length };
}

/**
 * An automatic size rounded to a readable step: to a multiple of half its leading power
 * of ten, so 2137 becomes 2000 and 820 becomes 800, 0.0616 becomes 0.06.
 */
export function roundSize(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  // Whole halves of the power, written out exactly: 14 halves of 0.1 are 0.7.
  return Number(((Math.round((2 * value) / power) * power) / 2).toPrecision(12));
}

/** True range of a bar: its range, widened to the previous close across a gap. */
function trueRange(high: number, low: number, previousClose: number): number {
  return Number.isNaN(previousClose)
    ? high - low
    : Math.max(high, previousClose) - Math.min(low, previousClose);
}

/**
 * Wilder's average of true ranges taking the range of bar `index`: their simple average over the
 * first `length` bars, smoothed by `1 / length` after them.
 */
function nextAverage(average: number, index: number, range: number, length: number): number {
  return index < length
    ? (average * index + range) / (index + 1)
    : (average * (length - 1) + range) / length;
}

/**
 * The average true range at the bar before `end` (the last bar by default): Wilder's moving
 * average of the true ranges, seeded with their simple average over the first `length` bars.
 * Fewer bars than that average the ranges there are; `NaN` without bars.
 */
export function averageTrueRange(input: BarsView, length: number, end = input.length): number {
  let average = 0;

  for (let index = 0; index < end; index += 1) {
    const previousClose = index > 0 ? input.close(index - 1) : Number.NaN;
    const range = trueRange(input.high(index), input.low(index), previousClose);
    average = nextAverage(average, index, range, length);
  }

  return end > 0 ? average : Number.NaN;
}

function percentageSize(percentage: number, close: number): number {
  const size = (Math.abs(close) * percentage) / 100;
  return size > 0 ? roundSize(size) : Number.NaN;
}

/**
 * The size a rule gives the bars a stream is built from: the percentage of the last close, or
 * the average true range at the latest closed bar, leaving out the latest one, which may still
 * be forming. `NaN` while they cannot tell, such as with fewer closed bars than the length.
 */
export function sizeFor(rule: SizeRule, input: BarsView): number {
  switch (rule.kind) {
    case 'fixed':
      return rule.size;
    case 'percentage':
      return input.length > 0
        ? percentageSize(rule.percentage, input.close(input.length - 1))
        : Number.NaN;
    case 'atr': {
      // Sizes by an ATR length of 1 are the true range of the last closed bar.
      const closed = input.length - 1;
      const atr = closed >= rule.length ? averageTrueRange(input, rule.length, closed) : 0;
      return atr > 0 ? roundSize(atr) : Number.NaN;
    }
  }
}

/**
 * A stream whose size the bars it was built from did not tell: it keeps the bars until the
 * closed ones, those before the latest, give the size as `sizeFor()` would for the bars at that
 * moment, the percentage of the latest closed close or the average true range once `length`
 * bars have closed. Then it builds from the first bar on with it; nothing shows until then, and
 * the size stays until the bars are built again. Bricks and boxes go by the prices alone, not by
 * the sides of trades.
 */
class SizedStream implements BarTransformStream {
  constructor(
    private readonly rule: AutomaticRule,
    private readonly build: (size: number) => BarTransformStream,
    private stream: BarTransformStream | null = null,
    /** The bars that came before the size was known. */
    private readonly waiting: Bar[] = [],
    /** Of the closed bars: their average true range and the latest close. */
    private average = 0,
    private close = Number.NaN
  ) {}

  next(bar: Bar): readonly Bar[] {
    if (this.stream) {
      return this.stream.next(bar, null);
    }

    const { rule, waiting } = this;
    const closed = waiting.length;
    const size =
      rule.kind === 'percentage'
        ? percentageSize(rule.percentage, this.close)
        : closed >= rule.length && this.average > 0
          ? roundSize(this.average)
          : Number.NaN;

    if (rule.kind === 'atr') {
      const range = trueRange(bar.high, bar.low, this.close);
      this.average = nextAverage(this.average, closed, range, rule.length);
    }

    this.close = bar.close;
    waiting.push(bar);

    if (Number.isNaN(size)) {
      return [];
    }

    const stream = this.build(size);
    this.stream = stream;
    return waiting.splice(0).flatMap((each) => stream.next(each, null));
  }

  current(): Bar | null {
    return this.stream?.current() ?? null;
  }

  clone(): BarTransformStream {
    return new SizedStream(
      this.rule,
      this.build,
      this.stream?.clone() ?? null,
      [...this.waiting],
      this.average,
      this.close
    );
  }

  resolved(): Readonly<Record<string, unknown>> | null {
    return this.stream?.resolved?.() ?? null;
  }
}

/**
 * The stream `build` makes with the size a rule gives the bars it is built from, `input`; when
 * they do not tell it, such as fewer closed bars than the average true range takes, with the size
 * the bars after them give.
 */
export function sizedStream(
  rule: SizeRule,
  input: BarsView,
  build: (size: number) => BarTransformStream
): BarTransformStream {
  const size = sizeFor(rule, input);

  if (rule.kind === 'fixed' || !Number.isNaN(size)) {
    return build(size);
  }

  return new SizedStream(rule, build);
}

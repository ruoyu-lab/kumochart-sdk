import type { Bar } from '../data/types';
import { fail } from '../utils/errors';
import { checkNumber } from '../utils/validate';
import { DEFAULT_ATR_LENGTH, sizedStream, tradesHaveNoRange } from './box-sizes';
import type { BarTransformDefinition, BarTransformStream } from '../feed/transform';

/** More bars than this from one input bar means the size is far too small for the prices. */
const MAX_BARS_PER_INPUT = 10_000;

/** Fails before a size that is far too small turns one bar into millions. */
export function checkSteps(type: string, size: number, distance: number): void {
  if (distance / size > MAX_BARS_PER_INPUT) {
    fail(
      `The "${type}" size ${size} is too small for these prices: one bar would make more than ${MAX_BARS_PER_INPUT} bars.`
    );
  }
}

/** Rejects parameters a transform does not know. */
export function checkKeys(type: string, params: object, known: readonly string[]): void {
  for (const key of Object.keys(params)) {
    if (!known.includes(key)) {
      fail(`The "${type}" transform has no parameter "${key}".`);
    }
  }
}

// ─── Heikin-Ashi ─────────────────────────────────────────────────────────────

class HeikinAshiStream implements BarTransformStream {
  constructor(
    private previous: Bar | null = null,
    private forming: Bar | null = null
  ) {}

  next(bar: Bar): readonly Bar[] {
    const done = this.forming;
    this.previous = done ?? this.previous;
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = this.previous
      ? (this.previous.open + this.previous.close) / 2
      : (bar.open + bar.close) / 2;
    this.forming = {
      time: bar.time,
      open,
      high: Math.max(bar.high, open, close),
      low: Math.min(bar.low, open, close),
      close,
      volume: bar.volume
    };
    return done ? [done] : [];
  }

  current(): Bar | null {
    return this.forming;
  }

  clone(): BarTransformStream {
    return new HeikinAshiStream(this.previous, this.forming);
  }
}

export const heikinAshiTransform: BarTransformDefinition = {
  type: 'heikin-ashi',
  name: 'Heikin-Ashi',
  keepsTime: true,
  create: (params) => {
    checkKeys('heikin-ashi', params, []);
    return new HeikinAshiStream();
  }
};

// ─── Range bars ──────────────────────────────────────────────────────────────

interface RangeState {
  forming: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null;
}

/**
 * Bars spanning exactly `range` from high to low. Each input bar is walked open, low, high,
 * close when it rose, and open, high, low, close when it fell; a move beyond the range closes the
 * bar at its boundary and opens the next one there.
 */
class RangeStream implements BarTransformStream {
  constructor(
    private readonly range: number,
    private readonly state: RangeState
  ) {}

  next(bar: Bar): readonly Bar[] {
    const state = this.state;
    const range = this.range;
    const done: Bar[] = [];
    const path =
      bar.close >= bar.open
        ? [bar.open, bar.low, bar.high, bar.close]
        : [bar.open, bar.high, bar.low, bar.close];
    const start = (price: number) => ({
      time: bar.time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0
    });

    const reference = state.forming?.open ?? bar.open;
    checkSteps('range', range, Math.max(bar.high - reference, reference - bar.low));

    for (const price of path) {
      let forming = state.forming ?? start(price);

      while (price - forming.low > range) {
        const top = forming.low + range;
        done.push({ ...forming, high: top, close: top });
        forming = start(top);
      }

      while (forming.high - price > range) {
        const bottom = forming.high - range;
        done.push({ ...forming, low: bottom, close: bottom });
        forming = start(bottom);
      }

      forming.high = Math.max(forming.high, price);
      forming.low = Math.min(forming.low, price);
      forming.close = price;
      state.forming = forming;
    }

    if (state.forming) {
      state.forming.volume += bar.volume;
    }

    return done;
  }

  current(): Bar | null {
    return this.state.forming ? { ...this.state.forming } : null;
  }

  clone(): BarTransformStream {
    return new RangeStream(this.range, {
      forming: this.state.forming ? { ...this.state.forming } : null
    });
  }

  resolved(): Readonly<Record<string, unknown>> {
    return { range: this.range };
  }
}

/**
 * Range bars. Parameter: `range`, the high to low of a bar; otherwise the average true range over
 * 14 bars, rounded as the other automatic sizes are.
 */
export const rangeTransform: BarTransformDefinition = {
  type: 'range',
  name: 'Range',
  keepsTime: false,
  create: (params, input, from) => {
    checkKeys('range', params, ['range']);

    if (params.range === undefined && from === 'trades') {
      fail(tradesHaveNoRange('range', 'params.range'));
    }

    return sizedStream(
      params.range === undefined
        ? { kind: 'atr', length: DEFAULT_ATR_LENGTH }
        : {
            kind: 'fixed',
            size: checkNumber('params.range', params.range, { min: Number.MIN_VALUE })
          },
      input,
      (range) => new RangeStream(range, { forming: null })
    );
  }
};

// ─── Line break ──────────────────────────────────────────────────────────────

interface LineBreakState {
  /** The latest lines, up to the number the breaks are measured against, oldest first. */
  lines: { readonly open: number; readonly close: number }[];
  /** The first close, where the first line starts. */
  reference: number;
  /** Time the next line starts, `NaN` until the bar after the last line. */
  time: number;
  volume: number;
}

/**
 * Line break lines on the closes: a rising line when a close
 * passes the highest top of the last `lines` lines, from the top of the last line, and a falling
 * one when it passes their lowest bottom, from its bottom. Other closes draw nothing.
 */
class LineBreakStream implements BarTransformStream {
  constructor(
    private readonly count: number,
    private readonly state: LineBreakState
  ) {}

  next(bar: Bar): readonly Bar[] {
    const state = this.state;

    if (Number.isNaN(state.time)) {
      state.time = bar.time;
    }

    state.volume += bar.volume;

    if (Number.isNaN(state.reference)) {
      state.reference = bar.close;
      return [];
    }

    const tops = state.lines.map((line) => Math.max(line.open, line.close));
    const bottoms = state.lines.map((line) => Math.min(line.open, line.close));
    const top = state.lines.length > 0 ? Math.max(...tops) : state.reference;
    const bottom = state.lines.length > 0 ? Math.min(...bottoms) : state.reference;
    const last = state.lines.length - 1;
    let open: number;

    if (bar.close > top) {
      open = tops[last] ?? state.reference;
    } else if (bar.close < bottom) {
      open = bottoms[last] ?? state.reference;
    } else {
      return [];
    }

    const line: Bar = {
      time: state.time,
      open,
      high: Math.max(open, bar.close),
      low: Math.min(open, bar.close),
      close: bar.close,
      volume: state.volume
    };
    state.lines.push({ open, close: bar.close });

    if (state.lines.length > this.count) {
      state.lines.shift();
    }

    state.time = Number.NaN;
    state.volume = 0;
    return [line];
  }

  current(): Bar | null {
    return null;
  }

  clone(): BarTransformStream {
    return new LineBreakStream(this.count, { ...this.state, lines: [...this.state.lines] });
  }
}

export const lineBreakTransform: BarTransformDefinition = {
  type: 'line-break',
  name: 'Line break',
  keepsTime: false,
  create: (params) => {
    checkKeys('line-break', params, ['lines']);
    const lines =
      params.lines === undefined
        ? 3
        : checkNumber('params.lines', params.lines, { min: 1, max: 100, integer: true });
    return new LineBreakStream(lines, {
      lines: [],
      reference: Number.NaN,
      time: Number.NaN,
      volume: 0
    });
  }
};

// ─── Tick, volume and turnover bars ─────────────────────────────────────────

/** The size parameter of a transform, which has no default: what one bar holds. */
function sizeOf(type: string, key: string, params: Record<string, unknown>, what: string): number {
  checkKeys(type, params, [key]);

  if (params[key] === undefined) {
    fail(`The "${type}" transform needs params.${key}, the ${what} of each bar.`);
  }

  return checkNumber(`params.${key}`, params[key], { min: 0, exclusiveMin: true });
}

/**
 * Merges input bars until they amount to `size` by `measure`: the bar that reaches it completes
 * the bar it belongs to, which takes the first input's time and open, the extremes, the last
 * close and the summed volume. Input bars are not split, so a bar holds at least `size`.
 */
class AmountStream implements BarTransformStream {
  constructor(
    private readonly measure: (bar: Bar) => number,
    private readonly size: number,
    private forming: Bar | null = null,
    private amount = 0
  ) {}

  next(bar: Bar): readonly Bar[] {
    const forming = this.forming;
    const merged: Bar = forming
      ? {
          time: forming.time,
          open: forming.open,
          high: Math.max(forming.high, bar.high),
          low: Math.min(forming.low, bar.low),
          close: bar.close,
          volume: forming.volume + bar.volume
        }
      : bar;
    const amount = this.amount + this.measure(bar);

    // Sums of fractional sizes fall a rounding error short of a whole size.
    if (amount >= this.size * (1 - 1e-9)) {
      this.forming = null;
      this.amount = 0;
      return [merged];
    }

    this.forming = merged;
    this.amount = amount;
    return [];
  }

  current(): Bar | null {
    return this.forming;
  }

  clone(): BarTransformStream {
    return new AmountStream(this.measure, this.size, this.forming, this.amount);
  }
}

/**
 * Tick bars: a bar every `count` trades when built from trades (`input: 'trades'`), or every
 * `count` bars of the timeframe.
 */
export const tickTransform: BarTransformDefinition = {
  type: 'tick',
  name: 'Tick',
  keepsTime: false,
  create: (params) => {
    checkKeys('tick', params, ['count']);

    if (params.count === undefined) {
      fail('The "tick" transform needs params.count, the trades of each bar.');
    }

    const count = checkNumber('params.count', params.count, { min: 1, integer: true });
    return new AmountStream(() => 1, count);
  }
};

/** Volume bars: a bar every `volume` traded. */
export const volumeTransform: BarTransformDefinition = {
  type: 'volume',
  name: 'Volume',
  keepsTime: false,
  create: (params) =>
    new AmountStream((bar) => bar.volume, sizeOf('volume', 'volume', params, 'volume'))
};

/**
 * Turnover (dollar) bars: a bar every `turnover` traded in money, price times size of each
 * trade, or the typical price `(H + L + C) / 3` times the volume of each bar of the timeframe.
 */
export const turnoverTransform: BarTransformDefinition = {
  type: 'turnover',
  name: 'Turnover',
  keepsTime: false,
  create: (params) =>
    new AmountStream(
      (bar) => ((bar.high + bar.low + bar.close) / 3) * bar.volume,
      sizeOf('turnover', 'turnover', params, 'turnover')
    )
};

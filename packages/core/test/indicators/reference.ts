import type { BarInput } from '../../src/data/types';

// Reference calculations over whole arrays, bar by bar, written from the published formulas and
// independent of the streams. `NaN` is a missing value: it spreads through arithmetic, a window
// holding one has no value, and `skippingNaN` gives an average that skips missing values.

export const N = Number.NaN;
const HOUR = 3_600_000;

/** A random walk, the same on every run, whose trends turn many times. */
export function walk(count: number, seed = 7): Required<BarInput>[] {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  let close = 100;

  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = open + (random() - 0.5) * 4;
    return {
      time: Date.UTC(2024, 0, 1) + index * HOUR,
      open,
      high: Math.max(open, close) + random() * 2,
      low: Math.min(open, close) - random() * 2,
      close,
      volume: 100 + Math.round(random() * 900)
    };
  });
}

/** Bars from `[open, high, low, close, volume]` rows, an hour apart. */
export function rows(
  values: readonly (readonly [number, number, number, number, number?])[]
): Required<BarInput>[] {
  return values.map(([open, high, low, close, volume = 100], index) => ({
    time: Date.UTC(2024, 0, 1) + index * HOUR,
    open,
    high,
    low,
    close,
    volume
  }));
}

/** Bars from closes, an hour apart; open, high and low equal the close. */
export function closesOnly(values: readonly number[]): Required<BarInput>[] {
  return rows(values.map((close) => [close, close, close, close]));
}

export function field(
  bars: readonly Required<BarInput>[],
  key: 'open' | 'high' | 'low' | 'close' | 'volume'
): number[] {
  return bars.map((bar) => bar[key]);
}

/** The values of `period` bars up to `index`, or `null` before there are as many. */
function window(values: readonly number[], index: number, period: number): number[] | null {
  return index >= period - 1 ? values.slice(index - period + 1, index + 1) : null;
}

/** `SUM(X, N)`. */
export function sum(values: readonly number[], period: number): number[] {
  return values.map((_, index) => {
    const items = window(values, index, period);
    return items ? items.reduce((total, item) => total + item, 0) : N;
  });
}

/** `MA(X, N)`, the simple moving average. */
export function sma(values: readonly number[], period: number): number[] {
  return sum(values, period).map((total) => total / period);
}

/** The linearly weighted average: weights 1 (oldest) to `period` (newest). */
export function wma(values: readonly number[], period: number): number[] {
  return values.map((_, index) => {
    const items = window(values, index, period);
    return items
      ? items.reduce((total, item, position) => total + item * (position + 1), 0) /
          ((period * (period + 1)) / 2)
      : N;
  });
}

/** `HHV(X, N)`, the highest value. */
export function highest(values: readonly number[], period: number): number[] {
  return values.map((_, index) => {
    const items = window(values, index, period);
    return items ? Math.max(...items) : N;
  });
}

/** `LLV(X, N)`, the lowest value. */
export function lowest(values: readonly number[], period: number): number[] {
  return values.map((_, index) => {
    const items = window(values, index, period);
    return items ? Math.min(...items) : N;
  });
}

/** `REF(X, N)`, the value `N` bars back. */
export function ref(values: readonly number[], back: number): number[] {
  return values.map((_, index) => values[index - back] ?? N);
}

/** `EMA(X, N)` of Chinese charting software: seeded with the first value. */
export function chineseEma(values: readonly number[], period: number): number[] {
  const result: number[] = [];
  values.forEach((value, index) => {
    const previous = result[index - 1] ?? N;
    result.push(
      Number.isNaN(previous) ? value : (2 * value + (period - 1) * previous) / (period + 1)
    );
  });
  return result;
}

/** Wilder's smoothing (RMA): seeded with the SMA of the first `period` values. */
export function rma(values: readonly number[], period: number): number[] {
  const averages = sma(values, period);
  const result: number[] = [];
  values.forEach((value, index) => {
    const previous = result[index - 1] ?? N;
    result.push(
      Number.isNaN(previous) ? (averages[index] ?? N) : value / period + (1 - 1 / period) * previous
    );
  });
  return result;
}

/** The ATR: RMA of the true range, the first bar's being its high minus its low. */
export function atr(bars: readonly Required<BarInput>[], period: number): number[] {
  return rma(trueRanges(bars), period);
}

export function trueRanges(bars: readonly Required<BarInput>[]): number[] {
  return bars.map((bar, index) => {
    const previous = bars[index - 1];
    return previous
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      : bar.high - bar.low;
  });
}

/** `a / b`, `NaN` for `b = 0`. */
export function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? N : numerator / denominator;
}

/** Applies `combine` to the values at each index. */
export function zip(
  columns: readonly (readonly number[])[],
  combine: (...values: number[]) => number
): number[] {
  return (columns[0] ?? []).map((_, index) =>
    combine(...columns.map((column) => column[index] ?? N))
  );
}

/** The EMA, `alpha = 2 / (period + 1)`, seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): number[] {
  const averages = sma(values, period);
  const alpha = 2 / (period + 1);
  const result: number[] = [];
  values.forEach((value, index) => {
    const previous = result[index - 1] ?? N;
    result.push(
      Number.isNaN(previous) ? (averages[index] ?? N) : alpha * value + (1 - alpha) * previous
    );
  });
  return result;
}

/**
 * `average` of the values that are numbers, as if the missing ones were not there: each missing
 * value repeats the result before it.
 */
export function skippingNaN(
  values: readonly number[],
  average: (values: readonly number[]) => number[]
): number[] {
  const results = average(values.filter((value) => !Number.isNaN(value)));
  let next = 0;
  let last = N;
  return values.map((value) => {
    if (!Number.isNaN(value)) {
      last = results[next] ?? N;
      next += 1;
    }

    return last;
  });
}

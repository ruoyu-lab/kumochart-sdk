import { expect } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import type { BarInput } from '../../src/data/types';
import { createBarFeed, identityBucketer } from '../../src/feed/aggregator';
import { createCalendar, type Calendar } from '../../src/feed/calendar';
import { allIndicators } from '../../src/indicators/all';
import { BarsBasis } from '../../src/indicators/basis';
import { IndicatorSeries, resolveParams } from '../../src/indicators/instance';
import type { IndicatorDefinition, ParamValues } from '../../src/indicators/types';

/** A calendar of whole UTC days, as crypto charts use. */
export const UTC_DAYS = createCalendar({ timeZone: 'UTC' });

/** An indicator type of the library. */
export function definitionOf(type: string): IndicatorDefinition {
  const definition = allIndicators.find((candidate) => candidate.type === type);

  if (!definition) {
    throw new Error(`Unknown indicator ${type}.`);
  }

  return definition;
}

/** Computes an indicator over `bars` and returns its columns keyed by output key. */
export function compute(
  type: string,
  bars: readonly BarInput[],
  params?: ParamValues,
  calendar: Calendar = UTC_DAYS
): Record<string, number[]> {
  const store = new BarStore();
  store.set(bars);
  return computeOn(store, type, params, calendar);
}

/** A series over `store` reading the type's default source, as the chart does. */
export function createSeries(
  store: BarStore,
  type: string,
  params?: ParamValues,
  calendar: Calendar = UTC_DAYS
): { series: IndicatorSeries; keys: string[] } {
  const definition = definitionOf(type);
  const resolved = resolveParams(definition, params, type);
  const outputs = definition.outputs(resolved);
  const basis = new BarsBasis(store, () => ({ calendar, interval: null }));
  return {
    series: new IndicatorSeries(
      definition,
      resolved,
      outputs,
      definition.source ?? 'close',
      () => basis
    ),
    keys: outputs.map((output) => output.key)
  };
}

export function read(
  series: IndicatorSeries,
  keys: string[],
  length: number
): Record<string, number[]> {
  series.sync();
  return Object.fromEntries(
    keys.map((key, column) => [
      key,
      Array.from({ length }, (_, index) => series.value(column, index))
    ])
  );
}

export function computeOn(
  store: BarStore,
  type: string,
  params?: ParamValues,
  calendar: Calendar = UTC_DAYS
): Record<string, number[]> {
  const { series, keys } = createSeries(store, type, params, calendar);
  return read(series, keys, store.length);
}

/** Bars from a list of closes; open is the previous close, high/low enclose both. */
export function barsFromCloses(closes: readonly number[], volumes?: readonly number[]): BarInput[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : (closes[index - 1] ?? close);
    return {
      time: Date.UTC(2024, 0, 1) + index * 60_000,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: volumes?.[index] ?? 100 + index
    };
  });
}

/** Bars from `[high, low, close, volume]` rows, a minute apart; the open equals the close. */
export function barsFrom(
  rows: readonly (readonly [number, number, number, number?])[]
): BarInput[] {
  return rows.map(([high, low, close, volume = 100], index) => ({
    time: Date.UTC(2024, 0, 1) + index * 60_000,
    open: close,
    high,
    low,
    close,
    volume
  }));
}

/** Flat bars: every high, low and close is 10. */
export const FLAT = barsFrom([
  [10, 10, 10],
  [10, 10, 10],
  [10, 10, 10]
]);

/** Highs 10, 11, 12, 13 and lows 8, 9, 10, 9. */
export const RANGE = barsFrom([
  [10, 8, 9],
  [11, 9, 10],
  [12, 10, 11],
  [13, 9, 9]
]);

/**
 * Asserts that feeding bars one by one (with intermediate updates of the last bar) yields the same
 * values as computing over the full history at once.
 */
export function incrementalMatchesFull(
  type: string,
  bars: readonly BarInput[],
  params?: ParamValues
): { full: Record<string, number[]>; incremental: Record<string, number[]> } {
  const full = compute(type, bars, params);
  const feed = createBarFeed(identityBucketer);
  const store = feed.display;
  const { series, keys } = createSeries(store, type, params);

  bars.forEach((bar, index) => {
    // Simulate a tick on the forming bar before its final value arrives.
    feed.planUpdate([{ ...bar, close: bar.low, open: bar.low, high: bar.high, low: bar.low }])();
    series.sync();
    feed.planUpdate([bar])();

    if (index % 7 === 0) {
      series.sync();
    }
  });

  return { full, incremental: read(series, keys, store.length) };
}

/** Asserts equal lengths and that each value is `NaN` where expected, or close to the target. */
export function expectClose(actual: number[], expected: number[], digits = 6): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] ?? Number.NaN;

    if (Number.isNaN(target)) {
      expect(value, `index ${index}`).toBeNaN();
    } else {
      expect(value, `index ${index}`).toBeCloseTo(target, digits);
    }
  });
}

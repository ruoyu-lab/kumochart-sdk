import { describe, expect, it } from 'vitest';
import { createTestChart } from '../helpers/chart';
import { compute, expectClose } from './helpers';
import { closesOnly, divide, ema, field, N, rma, rows, sma, walk, wma, zip } from './reference';

const bars = walk(400);
const closes = field(bars, 'close');
const volumes = field(bars, 'volume');

describe('moving averages', () => {
  it('averages MA, EMA and SMMA over 9, 9 and 7 values by default', () => {
    expectClose(compute('MA', bars).ma9 ?? [], sma(closes, 9), 9);
    expectClose(compute('EMA', bars).ema9 ?? [], ema(closes, 9), 9);
    expectClose(compute('SMMA', bars).smma7 ?? [], rma(closes, 7), 9);
    // The EMA starts with the simple average: (10 + 11 + 15) / 3, then α = 1/2.
    const values = compute('EMA', closesOnly([10, 11, 15, 12]), { periods: [3] });
    expectClose(values.ema3 ?? [], [N, N, 12, 12]);
  });

  it('weighs WMA linearly, the newest most', () => {
    // (1 * 10 + 2 * 11 + 3 * 15) / 6 and (1 * 11 + 2 * 15 + 3 * 12) / 6.
    const values = compute('WMA', closesOnly([10, 11, 15, 12]), { periods: [3] });
    expectClose(values.wma3 ?? [], [N, N, 77 / 6, 77 / 6]);
    expectClose(compute('WMA', bars, { periods: [20] }).wma20 ?? [], wma(closes, 20), 9);
  });

  it('computes HMA from weighted averages of half and full length', () => {
    // n = 4: WMA(2) and WMA(4) of 10, 12, 11, 15, 14, then WMA(2) of 2 * WMA(2) - WMA(4).
    // Bar 3: WMA(2) = 41/3, WMA(4) = 127/10 → 2 * 41/3 - 12.7 = 439/30.
    // Bar 4: WMA(2) = 43/3, WMA(4) = 135/10 → 2 * 43/3 - 13.5 = 455/30.
    // HMA on bar 4: (439/30 + 2 * 455/30) / 3.
    const values = compute('HMA', closesOnly([10, 12, 11, 15, 14]), { periods: [4] });
    expectClose(values.hma4 ?? [], [N, N, N, N, (439 / 30 + (2 * 455) / 30) / 3]);

    for (const period of [9, 16, 21]) {
      const raw = zip(
        [wma(closes, Math.floor(period / 2)), wma(closes, period)],
        (half, full) => 2 * half - full
      );
      const expected = wma(raw, Math.floor(Math.sqrt(period)));
      expectClose(compute('HMA', bars, { periods: [period] })[`hma${period}`] ?? [], expected, 9);
    }
  });

  it('adapts KAMA to the efficiency of the move', () => {
    // Period 2, fast 2, slow 30: smoothing between 2/3 and 2/31, squared.
    // Bar 2: the first value is the price, 12.
    // Bar 3: net 0 → (2/31)². Bar 4: moves 1 + 2, net 1 → efficiency 1/3.
    const fastest = 2 / 3;
    const slowest = 2 / 31;
    const first = 12;
    const second = first + slowest ** 2 * (11 - first);
    const third = second + ((fastest - slowest) / 3 + slowest) ** 2 * (13 - second);
    const values = compute('KAMA', closesOnly([10, 11, 12, 11, 13]), { period: 2 });
    expectClose(values.kama ?? [], [N, N, first, second, third]);
    expectClose(compute('KAMA', bars).kama ?? [], referenceKama(closes, 10, 2, 30), 9);
  });

  it('moves KAMA at the slowest speed when the price did not move', () => {
    const values = compute('KAMA', closesOnly([10, 10, 10, 10]), { period: 2 });
    expectClose(values.kama ?? [], [N, N, 10, 10]);
  });

  it('weighs ALMA with a Gaussian near the newest price', () => {
    expectClose(compute('ALMA', bars).alma ?? [], referenceAlma(closes, 9, 0.85, 6), 9);
    expectClose(
      compute('ALMA', bars, { period: 20, offset: 0.5, sigma: 3 }).alma ?? [],
      referenceAlma(closes, 20, 0.5, 3),
      9
    );
  });

  it('weighs VWMA by volume, with no value over a window without volume', () => {
    const expected = zip(
      [
        sma(
          zip([closes, volumes], (close, volume) => close * volume),
          20
        ),
        sma(volumes, 20)
      ],
      divide
    );
    expectClose(compute('VWMA', bars).vwma20 ?? [], expected, 9);
    const flat = rows([
      [10, 10, 10, 10, 0],
      [11, 11, 11, 11, 0]
    ]);
    expectClose(compute('VWMA', flat, { periods: [2] }).vwma2 ?? [], [N, N]);
  });

  it('weighs the VWMA of an oscillator as the VWMA reading it', () => {
    const chart = createTestChart();
    chart.data.set(bars);
    const rsi = chart.indicators.add({ type: 'RSI', params: { maType: 6, maLength: 10 } });
    const vwma = chart.indicators.add({
      type: 'VWMA',
      params: { periods: [10] },
      source: { kind: 'indicator', id: rsi }
    });
    const value = (id: string, column: number) =>
      bars.map((_bar, index) => chart.indicators.valuesAt(id, index)[column]?.value ?? N);

    expect(value(vwma, 0).filter((average) => !Number.isNaN(average)).length).toBeGreaterThan(300);
    expectClose(value(rsi, 1), value(vwma, 0), 9);
  });

  it('averages four moving averages into BBI', () => {
    const expected = zip(
      [sma(closes, 3), sma(closes, 6), sma(closes, 12), sma(closes, 24)],
      (a, b, c, d) => (a + b + c + d) / 4
    );
    expectClose(compute('BBI', bars).bbi ?? [], expected, 9);
  });
});

/** Kaufman's adaptive moving average: efficiency 0 without moves, starting at the price. */
function referenceKama(
  values: readonly number[],
  period: number,
  fast: number,
  slow: number
): number[] {
  const fastest = 2 / (fast + 1);
  const slowest = 2 / (slow + 1);
  const result = values.map(() => N);
  let kama = N;

  for (let index = period; index < values.length; index += 1) {
    let noise = 0;

    for (let back = index - period + 1; back <= index; back += 1) {
      noise += Math.abs((values[back] ?? N) - (values[back - 1] ?? N));
    }

    const value = values[index] ?? N;
    const efficiency = noise === 0 ? 0 : Math.abs(value - (values[index - period] ?? N)) / noise;
    const smoothing = (efficiency * (fastest - slowest) + slowest) ** 2;
    const from = Number.isNaN(kama) ? value : kama;
    kama = from + smoothing * (value - from);
    result[index] = kama;
  }

  return result;
}

/** The Arnaud Legoux moving average, weights summed from the oldest value. */
function referenceAlma(
  values: readonly number[],
  size: number,
  offset: number,
  sigma: number
): number[] {
  const m = offset * (size - 1);
  const s = size / sigma;

  return values.map((_, index) => {
    if (index < size - 1) {
      return N;
    }

    let norm = 0;
    let total = 0;

    for (let i = 0; i < size; i += 1) {
      const weight = Math.exp(-((i - m) ** 2) / (2 * s ** 2));
      norm += weight;
      total += (values[index - (size - i - 1)] ?? N) * weight;
    }

    return total / norm;
  });
}

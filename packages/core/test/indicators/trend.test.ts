import { describe, it } from 'vitest';
import { barsFrom, compute, expectClose } from './helpers';
import {
  atr,
  ema,
  field,
  highest,
  lowest,
  N,
  ref,
  rma,
  rows,
  skippingNaN,
  sma,
  trueRanges,
  walk,
  zip
} from './reference';

const bars = walk(400);
const highs = field(bars, 'high');
const lows = field(bars, 'low');
const closes = field(bars, 'close');

describe('trend indicators', () => {
  it("computes DMI with Wilder's averages seeded with their means", () => {
    // From bar 1: +DM 2, 0, 1; -DM 0, 2, 0; TR 3, 4, 4. RMA(2) from bar 2: TR 3.5, 3.75;
    // +DM 1, 1; -DM 1, 0.5 → +DI 200/7, 80/3; -DI 200/7, 40/3; DX 0, 1/3 → ADX on bar 3 100/6.
    const few = barsFrom([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [12, 8, 11]
    ]);
    const values = compute('DMI', few, { diLength: 2, adxSmoothing: 2 });
    expectClose(values.plus ?? [], [N, N, 200 / 7, 80 / 3]);
    expectClose(values.minus ?? [], [N, N, 200 / 7, 40 / 3]);
    expectClose(values.adx ?? [], [N, N, N, 50 / 3]);
    const expected = referenceDmi(14, 14);
    const computed = compute('DMI', bars);
    expectClose(computed.plus ?? [], expected.plus, 9);
    expectClose(computed.minus ?? [], expected.minus, 9);
    expectClose(computed.adx ?? [], expected.adx, 9);
  });

  it('has no DI over a range that has not moved', () => {
    // TR and the moves are 0 until bar 3, which rises by 1.
    const flat = barsFrom([
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
      [11, 10, 11]
    ]);
    const values = compute('DMI', flat, { diLength: 2, adxSmoothing: 2 });
    expectClose(values.plus ?? [], [N, N, N, 100]);
    expectClose(values.minus ?? [], [N, N, N, 0]);
  });

  it('computes DMA as the difference of two moving averages', () => {
    const dif = zip([sma(closes, 10), sma(closes, 50)], (fast, slow) => fast - slow);
    const values = compute('DMA', bars);
    expectClose(values.dif ?? [], dif, 9);
    expectClose(values.difma ?? [], sma(dif, 10), 9);
  });

  it('computes TRIX as the change of a triple EMA of the logarithm of the price', () => {
    const triple = ema(ema(ema(closes.map(Math.log), 18), 18), 18);
    const trix = zip([triple, ref(triple, 1)], (now, before) => 10000 * (now - before));
    expectClose(compute('TRIX', bars).trix ?? [], trix, 9);
  });

  it('counts Aroon from the latest of equal extremes', () => {
    // Period 2 over 3 bars. Bar 2: highs 10, 12, 12 → the latest 12 is 0 bars back: 100;
    // lows 8, 9, 7 → 0 bars back. Bar 3: highs 12, 12, 11 → 1 back: 50; lows 9, 7, 8 → 50.
    const values = compute(
      'AROON',
      rows([
        [9, 10, 8, 9],
        [11, 12, 9, 11],
        [11, 12, 7, 8],
        [9, 11, 8, 10]
      ]),
      { period: 2 }
    );
    expectClose(values.aroonUp ?? [], [N, N, 100, 50]);
    expectClose(values.aroonDown ?? [], [N, N, 100, 50]);
    const expected = referenceAroon(14);
    const computed = compute('AROON', bars);
    expectClose(computed.aroonUp ?? [], expected.up, 9);
    expectClose(computed.aroonDown ?? [], expected.down, 9);
  });

  it.each([
    [22, 22, 3],
    [10, 14, 1.5]
  ])(
    'hangs the chandelier exit from the extremes of %d bars, %d-bar ATR × %d inward',
    (period, atrPeriod, multiplier) => {
      const range = atr(bars, atrPeriod).map((value) => value * multiplier);
      const values = compute('CHANDELIER', bars, { period, atrPeriod, multiplier });
      expectClose(
        values.longExit ?? [],
        zip([highest(highs, period), range], (high, spread) => high - spread),
        9
      );
      expectClose(
        values.shortExit ?? [],
        zip([lowest(lows, period), range], (low, spread) => low + spread),
        9
      );
    }
  );
});

/** Wilder's directional movement, the averages skipping the first bar, which has no move. */
function referenceDmi(
  diLength: number,
  adxSmoothing: number
): { plus: number[]; minus: number[]; adx: number[] } {
  const up = zip([highs, ref(highs, 1)], (high, before) => high - before);
  const down = zip([ref(lows, 1), lows], (before, low) => before - low);
  const plusMoves = zip([up, down], (rise, fall) =>
    Number.isNaN(rise) ? N : rise > fall && rise > 0 ? rise : 0
  );
  const minusMoves = zip([up, down], (rise, fall) =>
    Number.isNaN(fall) ? N : fall > rise && fall > 0 ? fall : 0
  );
  const smooth = (values: readonly number[], period: number) =>
    skippingNaN(values, (kept) => rma(kept, period));
  const range = smooth([N, ...trueRanges(bars).slice(1)], diLength);
  const plus = zip([smooth(plusMoves, diLength), range], (move, tr) => (100 * move) / tr);
  const minus = zip([smooth(minusMoves, diLength), range], (move, tr) => (100 * move) / tr);
  const dx = zip([plus, minus], (a, b) => Math.abs(a - b) / (a + b === 0 ? 1 : a + b));
  return { plus, minus, adx: smooth(dx, adxSmoothing).map((value) => value * 100) };
}

/** Aroon over `period + 1` bars, counting from the latest of equal extremes. */
function referenceAroon(period: number): { up: number[]; down: number[] } {
  const since = (
    values: readonly number[],
    index: number,
    better: (a: number, b: number) => boolean
  ) => {
    let best = index - period;

    for (let position = best + 1; position <= index; position += 1) {
      if (better(values[position] ?? N, values[best] ?? N)) {
        best = position;
      }
    }

    return index - best;
  };
  const score = (values: readonly number[], better: (a: number, b: number) => boolean) =>
    values.map((_, index) =>
      index < period ? N : (100 * (period - since(values, index, better))) / period
    );
  return {
    up: score(highs, (a, b) => a >= b),
    down: score(lows, (a, b) => a <= b)
  };
}

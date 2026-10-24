import { describe, expect, it } from 'vitest';
import { barsFrom, barsFromCloses, compute, expectClose, FLAT, RANGE } from './helpers';
import {
  closesOnly,
  divide,
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
  sum,
  walk,
  zip
} from './reference';

const bars = walk(400);
const opens = field(bars, 'open');
const highs = field(bars, 'high');
const lows = field(bars, 'low');
const closes = field(bars, 'close');

/** The population standard deviation of the last `period` values. */
function deviation(values: readonly number[], period: number): number[] {
  const means = sma(values, period);
  return values.map((_, index) => {
    const mean = means[index] ?? N;
    const items = values.slice(Math.max(0, index - period + 1), index + 1);
    return items.length < period
      ? N
      : Math.sqrt(items.reduce((total, item) => total + (item - mean) ** 2, 0) / period);
  });
}

describe('momentum indicators', () => {
  describe('MACD', () => {
    it('takes the histogram as MACD minus its signal line, each EMA seeded with its SMA', () => {
      const macd = zip([ema(closes, 12), ema(closes, 26)], (fast, slow) => fast - slow);
      const signal = skippingNaN(macd, (values) => ema(values, 9));
      const values = compute('MACD', bars);
      expectClose(values.macd ?? [], macd, 9);
      expectClose(values.signalLine ?? [], signal, 9);
      expectClose(
        values.histogram ?? [],
        zip([macd, signal], (line, average) => line - average),
        9
      );
      // MACD starts on bar 25, the signal line 8 bars later.
      expect(values.macd?.findIndex((value) => !Number.isNaN(value))).toBe(25);
      expect(values.signalLine?.findIndex((value) => !Number.isNaN(value))).toBe(33);
    });

    it('takes simple averages when picked', () => {
      const macd = zip([sma(closes, 12), sma(closes, 26)], (fast, slow) => fast - slow);
      const signal = skippingNaN(macd, (values) => sma(values, 9));
      const values = compute('MACD', bars, { oscillatorType: 1, signalType: 1 });
      expectClose(values.macd ?? [], macd, 9);
      expectClose(values.signalLine ?? [], signal, 9);
    });
  });

  describe('RSI', () => {
    it("divides Wilder's averages of the gains and the losses, seeded with their means", () => {
      // Δ = +1, -1, +2 from bar 1. The averages start on bar 2 with the means of two changes:
      // gains 0.5 and losses 0.5 → 50. Bar 3: gains 0.5 * 2 + 0.5 * 0.5 = 1.25, losses 0.25
      // → 100 - 100 / 6. Its average over 2 values: (50 + 250/3) / 2.
      const values = compute('RSI', barsFromCloses([10, 11, 10, 12]), {
        period: 2,
        maLength: 2
      });
      expectClose(values.rsi ?? [], [N, N, 50, 250 / 3]);
      expectClose(values.rsiBasedMa ?? [], [N, N, N, 200 / 3]);
    });

    it('is 100 when nothing fell and 0 when nothing rose', () => {
      expectClose(compute('RSI', barsFromCloses([5, 5, 5, 6]), { period: 2 }).rsi ?? [], [
        N,
        N,
        100,
        100
      ]);
      expectClose(compute('RSI', barsFromCloses([6, 5, 5, 4]), { period: 2 }).rsi ?? [], [
        N,
        N,
        0,
        0
      ]);
    });

    it('averages RSI as picked, with Bollinger Bands around the average', () => {
      const rsi = referenceRsi(closes, 14);
      expectClose(compute('RSI', bars).rsiBasedMa ?? [], sma(rsi, 14), 9);
      expect(Object.keys(compute('RSI', bars, { maType: 0 }))).toEqual(['rsi']);
      const average = skippingNaN(rsi, (values) => ema(values, 10));
      expectClose(compute('RSI', bars, { maType: 3, maLength: 10 }).rsiBasedMa ?? [], average, 9);
      const banded = compute('RSI', bars, { maType: 2, bbMult: 1.5 });
      const spread = deviation(rsi, 14).map((value) => value * 1.5);
      expectClose(
        banded.upperBollingerBand ?? [],
        zip([sma(rsi, 14), spread], (a, b) => a + b),
        9
      );
      expectClose(
        banded.lowerBollingerBand ?? [],
        zip([sma(rsi, 14), spread], (a, b) => a - b),
        9
      );
    });
  });

  describe('KDJ', () => {
    it('smooths RSV into K and D starting from the first RSV', () => {
      // RSV = (C - LLV(L, N)) / (HHV(H, N) - LLV(L, N)) * 100, K = SMA(RSV, M1, 1),
      // D = SMA(K, M2, 1), J = 3K - 2D; SMA(X, N, M) starts from the first X.
      // Bar 2: HHV 12, LLV 8, C 11 → RSV 75 = K = D = J.
      // Bar 3: HHV 13, LLV 9, C 9 → RSV 0; K = (0 + 2 * 75) / 3 = 50, D = (50 + 150) / 3.
      const values = compute('KDJ', RANGE, { period: 3, k: 3, d: 3 });
      expectClose(values.k ?? [], [N, N, 75, 50]);
      expectClose(values.d ?? [], [N, N, 75, 200 / 3]);
      expectClose(values.j ?? [], [N, N, 75, 50 / 3]);
    });

    it('counts a flat range as RSV 50', () => {
      const values = compute('KDJ', FLAT, { period: 2, k: 3, d: 3 });
      expectClose(values.k ?? [], [N, 50, 50]);
      expectClose(values.j ?? [], [N, 50, 50]);
    });
  });

  describe('WR', () => {
    it('measures the close down from the highest high, from -100 to 0', () => {
      // Bar 2: 100 * (11 - 12) / (12 - 8) = -25. Bar 3: 100 * (9 - 13) / (13 - 9) = -100.
      const values = compute('WR', RANGE, { periods: [3] });
      expectClose(values.wr3 ?? [], [N, N, -25, -100]);
    });

    it('has no value over a flat range', () => {
      expectClose(compute('WR', FLAT, { periods: [2] }).wr2 ?? [], [N, N, N]);
    });
  });

  describe('CCI', () => {
    const bars = barsFrom([
      [11, 9, 10],
      [13, 11, 12],
      [15, 13, 14],
      [12, 10, 11]
    ]);

    it('scales the distance from the mean typical price by the mean deviation', () => {
      // Typical prices 10, 12, 14, 11.
      // Bar 2: mean 12, mean deviation 4/3 → (14 - 12) / (0.015 * 4/3) = 100.
      // Bar 3: mean 37/3, mean deviation (1/3 + 5/3 + 4/3) / 3 = 10/9 → (-4/3) / (1/60) = -80.
      const values = compute('CCI', bars, { period: 3, maLength: 2 });
      expectClose(values.cci ?? [], [N, N, 100, -80]);
      expectClose(values.cciBasedMa ?? [], [N, N, N, 10]);
    });

    it('is undefined over a flat window', () => {
      expectClose(compute('CCI', FLAT, { period: 2 }).cci ?? [], [N, N, N]);
    });
  });

  describe('ROC', () => {
    it('compares the price with the one `period` bars back', () => {
      // Bar 2: 12 / 10 - 1 = 20%. Bar 3: 30 / 20 - 1 = 50%.
      const values = compute('ROC', barsFromCloses([10, 20, 12, 30]), { period: 2 });
      expectClose(values.roc ?? [], [N, N, 20, 50]);
    });

    it('is undefined against a zero base', () => {
      const values = compute('ROC', barsFromCloses([0, 1, 2]), { period: 1 });
      expectClose(values.roc ?? [], [N, N, 100]);
    });
  });

  it('computes BIAS as the distance from the moving average', () => {
    // Bar 2: MA 11 → 1 / 11. Bar 3: MA 38/3 → (15 - 38/3) / (38/3) = 7/38.
    const values = compute('BIAS', barsFromCloses([10, 11, 12, 15]), { periods: [3] });
    expectClose(values.bias3 ?? [], [N, N, 100 / 11, 700 / 38]);
  });

  it('smooths the stochastic into %K and %D', () => {
    // Length 3: bar 2 closes at 11 in 8..12 → 75; bar 3 at 9 in 9..13 → 0.
    const range = rows([
      [9, 10, 8, 9],
      [10, 11, 9, 10],
      [11, 12, 10, 11],
      [9, 13, 9, 9]
    ]);
    const values = compute('STOCH', range, { period: 3, smoothD: 2 });
    expectClose(values.k ?? [], [N, N, 75, 0]);
    expectClose(values.d ?? [], [N, N, N, 37.5]);
    const raw = zip(
      [closes, lowest(lows, 14), highest(highs, 14)],
      (close, low, high) => divide(close - low, high - low) * 100
    );
    const k = sma(raw, 3);
    const smoothed = compute('STOCH', bars, { smoothK: 3 });
    expectClose(smoothed.k ?? [], k, 9);
    expectClose(smoothed.d ?? [], sma(k, 3), 9);
  });

  it('skips a flat range in the averages of the stochastic', () => {
    // Bar 2 is flat: no stochastic, so %K holds its 100 of bar 1, which %D then averages.
    const range = rows([
      [10, 11, 9, 10],
      [11, 12, 10, 12],
      [12, 12, 12, 12],
      [12, 12, 10, 10]
    ]);
    const values = compute('STOCH', range, { period: 1, smoothD: 2 });
    expectClose(values.k ?? [], [50, 100, 100, 0]);
    expectClose(values.d ?? [], [N, 75, 100, 50]);
  });

  it("takes the stochastic of Wilder's RSI for Stoch RSI", () => {
    const rsi = referenceRsi(closes, 14);
    const stoch = zip(
      [rsi, lowest(rsi, 14), highest(rsi, 14)],
      (value, low, high) => divide(value - low, high - low) * 100
    );
    const k = skippingNaN(stoch, (values) => sma(values, 3));
    const values = compute('STOCHRSI', bars);
    expectClose(values.k ?? [], k, 9);
    expectClose(
      values.d ?? [],
      skippingNaN(k, (values) => sma(values, 3)),
      9
    );
  });

  it('has no Stoch RSI while RSI stays flat', () => {
    // Nothing falls: RSI is 100 on every bar from bar 2, so its range is flat.
    const rising = compute('STOCHRSI', closesOnly([1, 2, 3, 4, 5, 6]), {
      rsiPeriod: 2,
      period: 2,
      smoothK: 1,
      smoothD: 1
    });
    expectClose(rising.k ?? [], [N, N, N, N, N, N]);
    // RSI 100, 0, then 50 and 0: a range again.
    const turning = compute('STOCHRSI', closesOnly([1, 2, 3, 2, 1, 2]), {
      rsiPeriod: 2,
      period: 2,
      smoothK: 1,
      smoothD: 1
    });
    const rsi = referenceRsi([1, 2, 3, 2, 1, 2], 2);
    expectClose(rsi.slice(2), [100, 50, 25, 62.5]);
    expectClose(turning.k ?? [], [N, N, N, 0, 0, 100]);
  });

  it('transforms the price range with Fisher', () => {
    const values = compute('FISHER', bars);
    const expected = referenceFisher(
      zip([highs, lows], (high, low) => (high + low) / 2),
      9
    );
    expectClose(values.fisher ?? [], expected, 9);
    expectClose(values.trigger ?? [], ref(expected, 1), 9);
  });

  it('restarts Fisher after a flat range', () => {
    const flat = closesOnly([10, 10, 10, 11, 12]);
    const values = compute('FISHER', flat, { period: 2 }).fisher ?? [];
    // Bars 1 and 2 have a flat range; bar 3 starts again from 0: 0.66 * (1 - 0.5) = 0.33.
    expectClose(values, [N, N, N, 0.5 * Math.log(1.33 / 0.67), values[4] ?? N]);
    expectClose(values, referenceFisher([10, 10, 10, 11, 12], 2));
  });

  it('computes the momentum as the change over `period` bars', () => {
    const momentum = compute('MTM', bars);
    expectClose(
      momentum.mom ?? [],
      zip([closes, ref(closes, 10)], (now, before) => now - before),
      9
    );
  });

  it('detrends the price by its average of half the length plus one bars back', () => {
    // Length 21 shifts by 11, an even length 20 too, 7 by 4.
    for (const [period, shift] of [
      [21, 11],
      [20, 11],
      [7, 4]
    ] as const) {
      const average = sma(closes, period);
      const detrended = compute('DPO', bars, { period });
      expectClose(
        detrended.dpo ?? [],
        zip([closes, ref(average, shift)], (close, mean) => close - mean),
        9
      );
      // Centered: the price of `shift` bars back against the average, drawn on that bar.
      const centered = compute('DPO', bars, { period, centered: 1 });
      expectClose(
        centered.dpo ?? [],
        zip([ref(closes, shift), average], (close, mean) => close - mean),
        9
      );
    }
  });

  it('counts the rising closes for PSY', () => {
    // Rises from bar 1: up, down, flat, up, up → PSY(3) from bar 3: 1/3, 1/3, 2/3.
    const values = compute('PSY', closesOnly([10, 11, 10, 10, 12, 13]), { period: 3, signal: 2 });
    expectClose(values.psy ?? [], [N, N, N, 100 / 3, 100 / 3, 200 / 3]);
    expectClose(values.psyma ?? [], [N, N, N, N, 100 / 3, 50]);
    const rises = closes.map((close, index) =>
      index === 0 ? N : close > (closes[index - 1] ?? N) ? 1 : 0
    );
    const psy = sum(rises, 12).map((count) => (count / 12) * 100);
    const computed = compute('PSY', bars);
    expectClose(computed.psy ?? [], psy, 9);
    expectClose(computed.psyma ?? [], sma(psy, 6), 9);
  });

  it('computes BR against the previous close and AR against the open', () => {
    const previous = ref(closes, 1);
    const br = zip(
      [
        sum(
          zip([highs, previous], (high, close) => Math.max(0, high - close)),
          26
        ),
        sum(
          zip([previous, lows], (close, low) => Math.max(0, close - low)),
          26
        )
      ],
      (up, down) => divide(up, down) * 100
    );
    const ar = zip(
      [
        sum(
          zip([highs, opens], (high, open) => high - open),
          26
        ),
        sum(
          zip([opens, lows], (open, low) => open - low),
          26
        )
      ],
      (up, down) => divide(up, down) * 100
    );
    const values = compute('BRAR', bars);
    expectClose(values.br ?? [], br, 9);
    expectClose(values.ar ?? [], ar, 9);
  });
});

/** Wilder's RSI: RMAs of the gains and losses; 100 without losses, 0 without gains. */
function referenceRsi(values: readonly number[], period: number): number[] {
  const changes = values.map((value, index) =>
    index === 0 ? N : value - (values[index - 1] ?? N)
  );
  const up = rma(
    changes.slice(1).map((change) => Math.max(change, 0)),
    period
  );
  const down = rma(
    changes.slice(1).map((change) => Math.max(-change, 0)),
    period
  );
  return [
    N,
    ...zip([up, down], (gain, loss) =>
      loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss)
    )
  ];
}

/** Ehlers' Fisher transform of `values` (the median price), a missing value counting as 0. */
function referenceFisher(values: readonly number[], period: number): number[] {
  const high = highest(values, period);
  const low = lowest(values, period);
  const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
  const round = (value: number) => (value > 0.99 ? 0.999 : value < -0.99 ? -0.999 : value);
  let value = N;
  let fisher = N;

  return values.map((price, index) => {
    value = round(
      0.66 * (divide(price - (low[index] ?? N), (high[index] ?? N) - (low[index] ?? N)) - 0.5) +
        0.67 * orZero(value)
    );
    fisher = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * orZero(fisher);
    return fisher;
  });
}

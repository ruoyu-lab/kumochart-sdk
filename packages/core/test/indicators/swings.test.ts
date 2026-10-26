import { describe, expect, it } from 'vitest';
import type { BarInput } from '../../src/data/types';
import { createTestChart } from '../helpers/chart';
import { BTCUSDT } from '../helpers/market';
import { canvasCalls } from '../setup';
import { barsFrom, compute, expectClose } from './helpers';
import { field, N, walk } from './reference';

// Reference implementations written from the published rules over whole arrays, independent of
// the streams.

/**
 * The pivots of `values` by the bar they are known on, `right` bars after their own: above every
 * one of the `right` values after it and at least as high as the `left` values before it (`sign`
 * -1 for lows).
 */
function referencePivots(
  values: readonly number[],
  left: number,
  right: number,
  sign: 1 | -1
): number[] {
  const known = values.map(() => N);

  values.forEach((value, index) => {
    if (index < left || index + right >= values.length) {
      return;
    }

    const before = values.slice(index - left, index);
    const after = values.slice(index + 1, index + right + 1);

    if (
      before.every((other) => sign * other <= sign * value) &&
      after.every((other) => sign * other < sign * value)
    ) {
      known[index + right] = value;
    }
  });

  return known;
}

const DATA: [name: string, bars: readonly Required<BarInput>[]][] = [
  ['a random walk', walk(400)],
  ['BTCUSDT daily', BTCUSDT['1d']],
  ['BTCUSDT hourly', BTCUSDT['1h']]
];

describe('swings', () => {
  describe('PIVOTHL', () => {
    it('finds a high above the bars after it and as high as those before, the latest of equals', () => {
      // Left 1, right 1. Highs 11, 12, 12, 11, 13, 13: bar 1 has an equal high after it; bar 2 is
      // as high as the one before and above the one after; bar 5 has no bar after it yet.
      // Lows 5, 4, 6, 4, 4, 7: bar 1 is below both; bar 4 is the later of two equal lows.
      const bars = barsFrom([
        [11, 5, 5],
        [12, 4, 4],
        [12, 6, 6],
        [11, 4, 4],
        [13, 4, 4],
        [13, 7, 7]
      ]);
      const values = compute('PIVOTHL', bars, {
        highLeft: 1,
        highRight: 1,
        lowLeft: 1,
        lowRight: 1
      });
      // Known one bar after the pivot.
      expectClose(values.pivotHigh ?? [], [N, N, N, 12, N, N]);
      expectClose(values.pivotLow ?? [], [N, N, 4, N, N, 4]);
    });

    it('takes its own lengths on each side for highs and lows', () => {
      // Highs 1, 3, 2, 1, 0: a pivot of left 1, right 3, known on bar 4; lows the mirror image.
      const bars = barsFrom([
        [1, -1, 0],
        [3, -3, 0],
        [2, -2, 0],
        [1, -1, 0],
        [0, 0, 0]
      ]);
      const values = compute('PIVOTHL', bars, {
        highLeft: 1,
        highRight: 3,
        lowLeft: 2,
        lowRight: 2
      });
      expectClose(values.pivotHigh ?? [], [N, N, N, N, 3]);
      // Left 2 needs two bars before bar 1: no pivot.
      expectClose(values.pivotLow ?? [], [N, N, N, N, N]);
    });

    it('is drawn back on the bar of the pivot', () => {
      const chart = createTestChart();
      chart.data.set(walk(120));
      const id = chart.indicators.add({ type: 'PIVOTHL', params: { highRight: 4, lowRight: 6 } });
      const outputs = chart.indicators
        .definition('PIVOTHL')
        ?.outputs(chart.indicators.get(id)?.params ?? {});
      expect(outputs?.map((output) => output.offset)).toEqual([-4, -6]);
    });

    it.each(DATA)('matches the reference on %s', (_name, bars) => {
      for (const [left, right] of [
        [10, 10],
        [3, 7]
      ] as const) {
        const values = compute('PIVOTHL', bars, {
          highLeft: left,
          highRight: right,
          lowLeft: right,
          lowRight: left
        });
        const highs = referencePivots(field(bars, 'high'), left, right, 1);
        const lows = referencePivots(field(bars, 'low'), right, left, -1);
        expectClose(values.pivotHigh ?? [], highs, 9);
        expectClose(values.pivotLow ?? [], lows, 9);
        expect(highs.filter((value) => !Number.isNaN(value)).length).toBeGreaterThan(5);
      }
    });

    it('writes the price of each pivot by its marker, as the legend writes it', () => {
      const bars = BTCUSDT['1d'].slice(0, 120);
      const chart = createTestChart({}, 3000);
      chart.data.set(bars);
      const id = chart.indicators.add({ type: 'PIVOTHL' });
      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      const texts = calls
        .filter((call) => call.name === 'fillText')
        .map((call) => String(call.args[0]));
      const pivots = referencePivots(field(bars, 'high'), 10, 10, 1).flatMap((value, index) =>
        Number.isNaN(value) ? [] : [index - 10]
      );
      expect(pivots.length).toBeGreaterThan(1);

      for (const index of pivots) {
        const value = chart.indicators.valuesAt(id, index).find((each) => each.key === 'pivotHigh');
        expect(value?.value).toBe(bars[index]?.high);
        expect(texts).toContain(value?.text);
      }
    });
  });
});

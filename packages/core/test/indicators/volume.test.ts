import { describe, expect, it } from 'vitest';
import { createBars, MINUTE } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';
import {
  barsFrom,
  barsFromCloses,
  compute,
  expectClose,
  FLAT,
  incrementalMatchesFull
} from './helpers';
import { divide, field, N, rows, sum, walk, zip } from './reference';

const bars = walk(400);
const volumes = field(bars, 'volume');

describe('volume indicators', () => {
  describe('OBV and VR', () => {
    // Bar 1 up (volume 200), bar 2 unchanged (300), bar 3 down (400), bar 4 up (500).
    const bars = barsFromCloses([10, 11, 11, 10, 12], [100, 200, 300, 400, 500]);

    it('accumulates OBV from 0 on the first bar, and averages it if picked', () => {
      expectClose(compute('OBV', bars).onBalanceVolume ?? [], [0, 200, 200, -200, 300]);
      const averaged = compute('OBV', bars, { maType: 1, maLength: 2 });
      expectClose(averaged.obvBasedMa ?? [], [N, 100, 200, 0, 50]);
    });

    it('computes VR as (2 * up + flat) / (2 * down + flat), and its average MAVR', () => {
      // Bar 2: (400 + 300) / 300. Bar 3: 300 / (800 + 300). Bar 4: 1000 / 800.
      const values = compute('VR', bars, { period: 2, signal: 2 });
      expectClose(values.vr ?? [], [N, N, 700 / 3, 300 / 11, 125]);
      expectClose(values.mavr ?? [], [N, N, N, (700 / 3 + 300 / 11) / 2, (300 / 11 + 125) / 2]);
    });

    it('leaves VR undefined without down or unchanged volume', () => {
      expectClose(compute('VR', barsFromCloses([10, 11, 12]), { period: 2 }).vr ?? [], [N, N, N]);
    });
  });

  describe('EMV', () => {
    // H + L = 18, 20, 20, 25; ranges 2, 2, 4, 3; volumes 100, 300, 100, 200.
    const rows: [number, number, number, number][] = [
      [10, 8, 9, 100],
      [11, 9, 10, 300],
      [12, 8, 10, 100],
      [14, 11, 12, 200]
    ];

    it('averages how far the median price moves for the volume traded', () => {
      // Δ median from bar 1: 1, 0, 2.5 → 10000 * Δ * (H - L) / VOL: 200/3, 0, 375.
      const values = compute('EMV', barsFrom(rows), { period: 2 });
      expectClose(values.eom ?? [], [N, N, 100 / 3, 187.5]);
      const divided = compute('EMV', barsFrom(rows), { period: 2, divisor: 1 });
      expectClose(divided.eom ?? [], [N, N, 1 / 300, 0.01875]);
    });

    it('skips the bars without volume', () => {
      // Bar 1 has no volume, so the average of 2 starts with bars 2 and 3.
      const bars = barsFrom(rows.map((row, index) => (index === 1 ? [11, 9, 10, 0] : row)));
      expectClose(compute('EMV', bars, { period: 2 }).eom ?? [], [N, N, N, 187.5]);
    });

    it('shows the tiny values of a cheap coin traded in size, in the legend and on the axis', () => {
      // A coin at 0.1 trading 50 million an hour: values near 1e-10.
      const bars = createBars(120, Date.UTC(2024, 0, 2), 60 * MINUTE).map((bar) => ({
        ...bar,
        open: bar.open / 1000,
        high: bar.high / 1000,
        low: bar.low / 1000,
        close: bar.close / 1000,
        volume: 5e7
      }));
      const chart = createTestChart();
      chart.data.set(bars, { interval: '1h' });
      const id = chart.indicators.add({ type: 'EMV' });
      const shown = chart.indicators.valuesAt(id)[0];
      const value = shown?.value ?? N;

      expect(Math.abs(value)).toBeGreaterThan(1e-12);
      expect(Math.abs(value)).toBeLessThan(1e-8);
      // Three significant digits of it.
      expect(Math.abs(Number(shown?.text) / value - 1)).toBeLessThan(0.01);

      const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.screenshot();
      const tiny = calls
        .filter((call) => call.name === 'fillText')
        .map((call) => String(call.args[0]))
        .filter((text) => /^-?\d(\.\d+)?E-\d+$/.test(text));
      expect(tiny.length).toBeGreaterThan(1);
      expect(new Set(tiny).size).toBe(tiny.length);
    });

    it('carries its value over a bar without volume, also incrementally', () => {
      const bars = createBars(40).map((bar, index) => (index === 20 ? { ...bar, volume: 0 } : bar));
      const { full, incremental } = incrementalMatchesFull('EMV', bars, { period: 3 });
      expect(full.eom?.[20]).toBe(full.eom?.[19]);
      expectClose(incremental.eom ?? [], full.eom ?? [], 9);
    });
  });

  describe('MFI', () => {
    it('compares the positive money flow with the negative one', () => {
      // Typical prices 10, 12, 11, 11, 13 with volumes 100, 100, 200, 300, 100: flows 1000 on
      // both sides on bar 0, which has no change, then +1200, -2200, 0, +1300.
      // Bar 1: 2200 / 1000 → 100 - 100 / 3.2. Bar 2: 1200 / 2200. Bar 3: 0 / 2200 → 0.
      // Bar 4: no negative flow, no value.
      const bars = barsFrom([
        [11, 9, 10, 100],
        [13, 11, 12, 100],
        [12, 10, 11, 200],
        [12, 10, 11, 300],
        [14, 12, 13, 100]
      ]);
      expectClose(compute('MFI', bars, { period: 2 }).mf ?? [], [N, 68.75, 600 / 17, 0, N]);
    });

    it('is undefined while the typical price is flat', () => {
      expectClose(compute('MFI', FLAT, { period: 1 }).mf ?? [], [50, N, N]);
    });
  });

  it('computes CMF from where each close lies in its range', () => {
    // Bar 0 closes at the top (+1 * 100), bar 1 has no range (0), bar 2 a quarter up (-0.5 * 200).
    const values = compute(
      'CMF',
      rows([
        [10, 12, 10, 12, 100],
        [11, 11, 11, 11, 300],
        [11, 12, 8, 9, 200]
      ]),
      { period: 2 }
    );
    expectClose(values.cmf ?? [], [N, 100 / 400, -100 / 500]);
    const flows = bars.map((bar) =>
      bar.high === bar.low
        ? 0
        : ((2 * bar.close - bar.low - bar.high) / (bar.high - bar.low)) * bar.volume
    );
    expectClose(compute('CMF', bars).cmf ?? [], zip([sum(flows, 20), sum(volumes, 20)], divide), 9);
  });
});

import { describe, expect, it } from 'vitest';
import { sizeFor } from '../src/chart-types/box-sizes';
import type { BarsView } from '../src/data/types';
import { Clock } from '../src/format/clock';
import { niceStep } from '../src/utils/math';
import { valueAreaOf } from '../src/volume-profile/profile';
import { MINUTE, T0 } from './helpers/bars';
import { createTestChart } from './helpers/chart';

const bar = (high: number, low: number, close: number) => ({
  time: T0,
  open: close,
  high,
  low,
  close,
  volume: 1
});

describe('edge cases', () => {
  it('sizes boxes by the percentage of the latest closed close', () => {
    const closes = [100, 300];
    const view = { length: 2, close: (index: number) => closes[index] } as unknown as BarsView;
    expect(sizeFor({ kind: 'percentage', percentage: 1 }, view)).toBe(1);
  });

  it('keeps steps that are nice already', () => {
    expect([0.0005, 0.00025, 0.00002, 0.5, 2.5, 20].map(niceStep)).toEqual([
      0.0005, 0.00025, 0.00002, 0.5, 2.5, 20
    ]);
  });

  it('follows offsets changing within an hour of UTC', () => {
    const at = (zone: string, time: number) => new Clock(zone).offset(time) / MINUTE;
    expect(at('Australia/Lord_Howe', Date.UTC(2024, 9, 5, 15, 45))).toBe(660);
    expect(at('Australia/Lord_Howe', Date.UTC(2024, 9, 5, 15, 15))).toBe(630);
    expect(at('Australia/Adelaide', Date.UTC(2024, 9, 5, 16, 45))).toBe(630);
    expect(at('America/St_Johns', Date.UTC(2024, 2, 10, 5, 45))).toBe(-150);
  });

  it('takes every row into a value area of the whole volume', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;

    for (let run = 0; run < 2000; run += 1) {
      const volumes = Array.from({ length: 10 }, random);
      const poc = volumes.indexOf(Math.max(...volumes));
      expect(valueAreaOf(volumes, poc, 1)).toEqual({ low: 0, high: 9 });
    }
  });

  it('tells which pane of a state has no range', () => {
    const chart = createTestChart();
    chart.data.set(
      Array.from({ length: 5 }, (_, index) => ({ ...bar(2, 1, 1.5), time: T0 + index * MINUTE }))
    );
    const state = structuredClone(chart.saveState()) as unknown as {
      panes: Record<string, unknown>[];
    };
    delete state.panes[0]?.range;
    expect(() => {
      chart.loadState(state as never);
    }).toThrow('panes[0].scales[0].range');
  });
});

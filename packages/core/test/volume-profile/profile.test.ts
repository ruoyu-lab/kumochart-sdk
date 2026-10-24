import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import type { BarInput } from '../../src/data/types';
import {
  checkVolumeProfileOptions,
  computeVolumeProfile,
  pointOfControl,
  valueAreaOf,
  volumeProfileGrid
} from '../../src/volume-profile';
import { MINUTE, T0 } from '../helpers/bars';

/** Bars one minute apart from T0. */
function bars(inputs: readonly Omit<BarInput, 'time'>[]): BarInput[] {
  return inputs.map((bar, index) => ({ ...bar, time: T0 + index * MINUTE }));
}

describe('the point of control', () => {
  it('is the row with the most volume', () => {
    expect(pointOfControl([10, 40, 30])).toBe(1);
    expect(pointOfControl(new Float64Array([5]))).toBe(0);
  });

  it('is, of rows with as much, the one nearest the middle, and of two as near the upper one', () => {
    // Rows 0 and 2 are as near the middle, row 1.
    expect(pointOfControl([30, 10, 30])).toBe(2);
    // The middle is row 2.
    expect(pointOfControl([30, 10, 30, 10, 10])).toBe(2);
    // The middle is between rows 2 and 3: row 1 is nearer than row 5.
    expect(pointOfControl([10, 30, 10, 10, 10, 30])).toBe(1);
  });

  it('needs a row', () => {
    expect(() => pointOfControl([])).toThrow('pointOfControl() needs the volume of one row');
  });
});

describe('the value area', () => {
  it('grows from the point of control and stops before a row would take it past the share', () => {
    // 40 of 100; rows 1 and 3 have as much and are as near, so the upper one joins: 65. Row 1
    // would take it to 90, past 70.
    expect(valueAreaOf([10, 25, 40, 25], 2, 0.7)).toEqual({ low: 2, high: 3 });
    // 40, then row 3 (20 of a tie, the upper one): 60; row 1 would make 80.
    expect(valueAreaOf([10, 20, 40, 20, 10], 2, 0.7)).toEqual({ low: 2, high: 3 });
  });

  it('takes the side with more volume, and on a tie the nearer row', () => {
    // 50, row 3 (20 above 10): 70; rows 1 and 4 have 10, row 1 is nearer: 80; row 4 would make 90.
    expect(valueAreaOf([5, 10, 50, 20, 10], 2, 0.9)).toEqual({ low: 1, high: 3 });
    // Only rows above are left.
    expect(valueAreaOf([50, 30, 20], 0, 0.8)).toEqual({ low: 0, high: 1 });
  });

  it('is the point of control alone when it holds the share, and every row with the whole', () => {
    expect(valueAreaOf([10, 80, 10], 1, 0.7)).toEqual({ low: 1, high: 1 });
    expect(valueAreaOf([1, 2, 3], 2, 1)).toEqual({ low: 0, high: 2 });
    expect(valueAreaOf([10, 25, 40, 25], 2)).toEqual({ low: 2, high: 3 });
  });

  it('checks the point of control and the share', () => {
    expect(() => valueAreaOf([1, 2], 2, 0.7)).toThrow('poc must be at most 1, received 2.');
    expect(() => valueAreaOf([1, 2], 0.5, 0.7)).toThrow('poc must be an integer');
    expect(() => valueAreaOf([1, 2], 1, 0)).toThrow('share must be greater than 0, received 0.');
    expect(() => valueAreaOf([1, 2], 1, 1.5)).toThrow('share must be at most 1, received 1.5.');
  });
});

describe('computeVolumeProfile', () => {
  it('spreads each bar evenly over its range, by direction', () => {
    const profile = computeVolumeProfile(
      bars([
        { open: 0, high: 10, low: 0, close: 10, volume: 100 },
        { open: 10, high: 10, low: 5, close: 5, volume: 50 }
      ]),
      0,
      2,
      { rows: 10 }
    );

    expect(profile?.rows).toHaveLength(10);
    expect(profile?.total).toBeCloseTo(150);
    expect(profile?.rows[0]).toEqual({ low: 0, high: 1, up: 10, down: 0 });
    expect(profile?.rows[7]?.up).toBeCloseTo(10);
    expect(profile?.rows[7]?.down).toBeCloseTo(10);
    expect(profile?.rows.reduce((sum, row) => sum + row.down, 0)).toBeCloseTo(50);
  });

  it('finds the point of control and the value area of its rows', () => {
    const input = bars([
      { open: 0, high: 10, low: 0, close: 10, volume: 100 },
      { open: 6, high: 7, low: 6, close: 7, volume: 400 },
      { open: 3, high: 4, low: 3, close: 4, volume: 50 }
    ]);
    const profile = computeVolumeProfile(input, 0, 3, { rows: 10, valueArea: 0.9 });
    const totals = profile?.rows.map((row) => row.up + row.down) ?? [];

    // 410 of 550 at row 6.
    expect(profile?.poc).toBe(6);
    expect(profile?.poc).toBe(pointOfControl(totals));
    // Rows 7 and 5 hold 10 each and are as near: row 7 joins first; then the nearer row of each
    // tie, rows 5, 8 and 4, until row 3, with 60, would take it past 90%.
    expect(profile?.valueArea).toEqual({ low: 4, high: 8 });
    expect(profile?.valueArea).toEqual(valueAreaOf(totals, 6, 0.9));
    expect(computeVolumeProfile(input, 0, 3, { rows: 10 })?.valueArea).toEqual({ low: 6, high: 6 });
  });

  it('puts bars of one price into one row, skips bars without volume, and finds none in none', () => {
    const input = bars([
      { open: 5, high: 5, low: 5, close: 5, volume: 10 },
      { open: 1, high: 9, low: 1, close: 2, volume: 0 }
    ]);
    const profile = computeVolumeProfile(input, 0, 2, { rows: 4 });

    expect(profile?.rows.filter((row) => row.up > 0)).toHaveLength(1);
    expect(profile?.total).toBe(10);
    expect(computeVolumeProfile(input, 1, 2)).toBeNull();
    expect(computeVolumeProfile(input, 2, 2)).toBeNull();
    // The range is clipped to the bars.
    expect(computeVolumeProfile(input, -5, 50)?.total).toBe(10);
    // Rows of some height around the one price.
    const flat = computeVolumeProfile(input, 0, 1);
    expect(flat?.rows[0]?.low).toBeLessThan(5);
    expect(flat?.rows.at(-1)?.high).toBeGreaterThan(5);
  });

  it('reads the bars of a chart or bars of your own, with 24 rows and 70% by default', () => {
    const input = bars(
      Array.from({ length: 30 }, (_, index) => ({
        open: 100 + index,
        high: 102 + index,
        low: 99 + index,
        close: 101 + index,
        volume: 10 + index
      }))
    );
    const store = new BarStore();
    store.set(input);
    const profile = computeVolumeProfile(input, 5, 25);

    expect(profile?.rows).toHaveLength(24);
    expect(computeVolumeProfile(store, 5, 25)).toEqual(profile);
    expect(computeVolumeProfile(input, 5, 25, { valueArea: 0.7 })).toEqual(profile);
  });

  it('checks the bars, the range and the options', () => {
    const input = bars([{ open: 0, high: 1, low: 0, close: 1, volume: 1 }]);

    expect(() =>
      computeVolumeProfile([{ time: T0, open: 2, high: 1, low: 0, close: 1 }], 0, 1)
    ).toThrow('bars[0] is inconsistent');
    expect(() => computeVolumeProfile(input, 0.5, 1)).toThrow('from must be an integer');
    expect(() => computeVolumeProfile(input, 0, Number.NaN)).toThrow('to must be a finite number');
    expect(() => computeVolumeProfile(input, 0, 1, { rows: 0 })).toThrow(
      'options.rows must be at least 1, received 0.'
    );
    expect(() => computeVolumeProfile(input, 0, 1, { rows: 2.5 })).toThrow(
      'options.rows must be an integer'
    );
    expect(() => computeVolumeProfile(input, 0, 1, { rows: 1001 })).toThrow(
      'options.rows must be at most 1000'
    );
    expect(() => computeVolumeProfile(input, 0, 1, { valueArea: 1.5 })).toThrow(
      'options.valueArea must be at most 1'
    );
    expect(() => computeVolumeProfile(input, 0, 1, { row: 3 } as never)).toThrow(
      'options has no field "row"'
    );
  });
});

describe('the grid of a profile', () => {
  it('divides the prices as the profiles of bars do, for profiles of other things', () => {
    const bars: BarInput[] = [
      { time: T0, open: 100, high: 110, low: 90, close: 105, volume: 10 },
      { time: T0 + MINUTE, open: 105, high: 106, low: 98, close: 99, volume: 5 }
    ];
    const profile = computeVolumeProfile(bars, 0, 2, { rows: 4 });

    expect(volumeProfileGrid(90, 110, 4)).toEqual({ bottom: 90, step: 5, count: 4 });
    expect(profile?.rows.map((row) => row.low)).toEqual([90, 95, 100, 105]);
    // Prices all at one get rows around it.
    expect(volumeProfileGrid(100, 100, 2)).toEqual({ bottom: 99.95, step: 0.05, count: 2 });
    expect(volumeProfileGrid(110, 90, 4)).toBeNull();
    expect(() => volumeProfileGrid(90, 110, 0)).toThrow('rows');
  });

  it('takes the rows and the value area as the profiles do, with their defaults', () => {
    expect(checkVolumeProfileOptions({}, 'profile')).toEqual({ rows: 24, valueArea: 0.7 });
    expect(() => checkVolumeProfileOptions({ valueArea: 1.5 }, 'profile')).toThrow(
      'profile.valueArea'
    );
  });
});

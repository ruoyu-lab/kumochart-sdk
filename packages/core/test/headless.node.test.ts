import { describe, expect, it } from 'vitest';
import {
  anchoredVwap,
  computeDrawingLevels,
  drawingLevels,
  fibRetracement,
  rectangle
} from '../src/drawings';
import { canBuildTimeframe, createCalendar, parseBar } from '../src/index';
import {
  checkIndicatorInput,
  computeIndicator,
  createIndicatorCalculator,
  HMA,
  RSI,
  VWAP
} from '../src/indicators';
import { computeVolumeProfile, pointOfControl, valueAreaOf } from '../src/volume-profile';

// Runs in Node, without a DOM: importing the library and its modules and computing indicators and the
// lines of drawings must not need one.

describe('indicators in Node', () => {
  it('has no browser around', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('computes indicators from the entry of the indicators module', () => {
    const bars = Array.from({ length: 60 }, (_, index) => {
      const close = 100 + Math.sin(index / 4) * 5;
      return {
        time: Date.UTC(2024, 0, 1) + index * 3_600_000,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 100
      };
    });
    const calendar = createCalendar({ timeZone: 'UTC' });
    const rsi = computeIndicator(RSI, bars, { params: { period: 14 }, calendar });
    const hma = computeIndicator(HMA, bars, { calendar });

    expect(rsi.rsi?.at(-1)).toBeGreaterThan(0);
    expect(hma.hma9?.at(-1)).toBeGreaterThan(90);
    // The typical price of the first bar, its only volume.
    const [first] = bars;
    expect(first && createIndicatorCalculator(VWAP, { calendar }).next(first)[0]).toBe(100);
  });

  it('checks bars, indicator settings and timeframes, and gives calendar ranges', () => {
    expect(
      parseBar({ time: '2024-01-01T00:00:00Z', open: 1, high: 1, low: 1, close: 1 }).time
    ).toBe(Date.UTC(2024, 0, 1));
    expect(() => {
      checkIndicatorInput(RSI, {
        type: 'RSI',
        params: { period: 0 }
      });
    }).toThrow('params.period must be at least 1, received 0.');
    expect(canBuildTimeframe('1D', '4h')).toBe(true);
    expect(createCalendar({ timeZone: 'UTC' }).range(Date.UTC(2024, 0, 1, 10, 30), '1h')).toEqual({
      bucket: Date.UTC(2024, 0, 1, 10),
      start: Date.UTC(2024, 0, 1, 10),
      end: Date.UTC(2024, 0, 1, 11)
    });
  });

  it('computes the lines of drawings from the entry of the drawings module', () => {
    const bars = Array.from({ length: 30 }, (_, index) => ({
      time: Date.UTC(2024, 0, 1) + index * 3_600_000,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 10
    }));
    const at = (index: number) => Date.UTC(2024, 0, 1) + index * 3_600_000;
    const box = computeDrawingLevels(
      rectangle,
      {
        points: [
          { time: at(5), price: 110 },
          { time: at(20), price: 120 }
        ]
      },
      bars
    );
    const vwap = computeDrawingLevels(anchoredVwap, { points: [{ time: at(10), price: 0 }] }, bars);

    expect(box.top?.slice(4, 7)).toEqual([Number.NaN, 120, 120]);
    expect(box.bottom?.[20]).toBe(110);
    // The typical price of the anchor bar, its only volume so far.
    expect(vwap.vwap?.[10]).toBe(110);
    expect(
      drawingLevels(fibRetracement, {
        points: [
          { time: at(0), price: 100 },
          { time: at(9), price: 200 }
        ]
      }).map((level) => level.key)
    ).toEqual([
      '0',
      '0.236',
      '0.382',
      '0.5',
      '0.618',
      '0.786',
      '1',
      '1.618',
      '2.618',
      '3.618',
      '4.236'
    ]);
    // Without a canvas no color is painted, and any text is taken.
    expect(
      drawingLevels(fibRetracement, {
        points: [
          { time: at(0), price: 100 },
          { time: at(9), price: 200 }
        ],
        style: { color: 'rebeccapurple', levels: [{ value: 0.5, color: 'hsl(0 50% 50%)' }] }
      }).map((level) => level.key)
    ).toEqual(['0.5']);
  });

  it('computes volume profiles from the entry of the volume profiles module', () => {
    const bars = Array.from({ length: 48 }, (_, index) => ({
      time: Date.UTC(2024, 0, 1) + index * 3_600_000,
      open: 100,
      high: 100 + (index % 4),
      low: 100 - (index % 4),
      close: 100 + (index % 2),
      volume: 10
    }));
    const profile = computeVolumeProfile(bars, 0, bars.length, { rows: 7 });

    expect(profile?.total).toBeCloseTo(480);
    // Every bar trades the middle row.
    expect(profile?.poc).toBe(3);
    expect(pointOfControl([30, 10, 30])).toBe(2);
    expect(valueAreaOf([10, 25, 40, 25], 2, 0.7)).toEqual({ low: 2, high: 3 });
  });
});

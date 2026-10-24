import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, BarInput } from '../../src/data/types';
import { averageTrueRange, roundSize } from '../../src/chart-types/box-sizes';
import { kagiSeries, startsYang } from '../../src/chart-types/kagi-series';
import { PointBuffer } from '../../src/series/types';
import { createTestChart } from '../helpers/chart';
import { BTCUSDT } from '../helpers/market';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

/** Bars of these closes, a day apart, with a volume of one each. */
function closes(values: readonly number[]): Bar[] {
  return values.map((close, index) => ({
    time: T0 + index * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1
  }));
}

function chartOf(bars: readonly BarInput[], interval = '1d'): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  chart.data.set(bars, { interval });
  return chart;
}

function kagi(bars: readonly BarInput[], params: Record<string, unknown> = {}): Bar[] {
  const chart = chartOf(bars);
  chart.transforms.set({ type: 'kagi', params });
  return chart.data.toArray();
}

/** The lines after streaming `bars`, each first as a partial bar opened at the last close. */
function streamed(bars: readonly Bar[], params: Record<string, unknown>, interval: string): Bar[] {
  const chart = chartOf(bars.slice(0, 2), interval);
  chart.transforms.set({ type: 'kagi', params });

  for (const bar of bars.slice(2)) {
    chart.data.update({ ...bar, high: bar.open, low: bar.open, close: bar.open, volume: 0 });
    chart.data.update(bar);
  }

  return chart.data.toArray();
}

/**
 * Kagi lines of the closes, written apart from the transform: from the first close, the first line once a close is the reversal
 * amount away; a line goes on with the closes its way and turns when one comes back the reversal
 * amount from its extreme. A line is timed at the bar it starts at and has the volume of the
 * bars after the extreme of the line before up to the one of its own extreme.
 */
function referenceKagi(bars: readonly Bar[], reversal: number): Bar[] {
  const lines: Bar[] = [];
  const reached = (distance: number) => distance >= reversal * (1 - 1e-9);
  const close = (index: number) => bars[index]?.close ?? Number.NaN;
  let start = 0;
  let from = 0;
  let extreme = -1;
  let open = close(0);
  const line = (end: number): Bar => {
    let volume = 0;

    for (let index = from; index <= end; index += 1) {
      volume += bars[index]?.volume ?? 0;
    }

    const last = close(end);
    return {
      time: bars[start]?.time ?? 0,
      open,
      high: Math.max(open, last),
      low: Math.min(open, last),
      close: last,
      volume
    };
  };

  for (let index = 1; index < bars.length; index += 1) {
    if (extreme < 0) {
      extreme = reached(Math.abs(close(index) - open)) ? index : -1;
      continue;
    }

    const rising = close(extreme) > open;

    if (rising ? close(index) > close(extreme) : close(index) < close(extreme)) {
      extreme = index;
    } else if (reached(rising ? close(extreme) - close(index) : close(index) - close(extreme))) {
      lines.push(line(extreme));
      open = close(extreme);
      start = index;
      from = extreme + 1;
      extreme = index;
    }
  }

  return extreme < 0 ? lines : [...lines, line(extreme)];
}

/**
 * Whether each line starts yang, worked forward: a line turns yang where
 * it rises past the last shoulder and yin where it falls past the last waist; the first line is
 * yang when it rises.
 */
function referenceYang(lines: readonly Bar[]): boolean[] {
  let yang = (lines[0]?.close ?? 0) > (lines[0]?.open ?? 0);
  return lines.map((line, index) => {
    const starts = yang;
    const before = lines[index - 2]?.close;

    if (before !== undefined && line.close > line.open && line.close > before) {
      yang = true;
    } else if (before !== undefined && line.close < line.open && line.close < before) {
      yang = false;
    }

    return starts;
  });
}

/** Bars with their volumes rounded, which sums in another order leave a rounding error apart. */
function rounded(bars: readonly Bar[]): Bar[] {
  return bars.map((bar) => ({ ...bar, volume: Number(bar.volume.toPrecision(10)) }));
}

function storeOf(bars: readonly Bar[]): BarStore {
  const store = new BarStore();
  store.assign(bars);
  return store;
}

describe('Kagi lines', () => {
  it('turns at the reversal amount, on an S&P 500 example', () => {
    // A 20-point reversal: rising to 1951.27, the line holds at 1943.89 and 1931.28 and turns
    // at 1931.27, 20 points below; falling to 1900, it turns back up at 1920.
    const lines = kagi(
      closes([1870.85, 1895, 1951.27, 1943.89, 1931.28, 1931.27, 1900, 1919.99, 1920]),
      { reversal: 20 }
    );

    expect(lines.map((line) => [line.open, line.close])).toEqual([
      [1870.85, 1951.27],
      [1951.27, 1900],
      [1900, 1920]
    ]);
    // Each line is timed at the bar it starts at: the first at the first bar.
    expect(lines.map((line) => (line.time - T0) / DAY)).toEqual([0, 5, 8]);
  });

  it('starts the first line once a close is the reversal amount from the first close', () => {
    expect(kagi(closes([100, 99, 101, 102]), { reversal: 3 })).toEqual([]);
    expect(kagi(closes([100, 99, 101, 96]), { reversal: 3 }).map((line) => line.open)).toEqual([
      100
    ]);
  });

  it('gives a line the volume from the bar after the extreme before it to its own', () => {
    const bars = closes([100, 104, 103, 106, 105, 102, 101]).map((bar, index) => ({
      ...bar,
      volume: 10 ** index
    }));
    const [first, second] = kagi(bars, { reversal: 3 });

    // 100 → 106 over bars 0 to 3; the pullback to 105 goes on into the line 102 turns to.
    expect(first?.volume).toBe(1 + 10 + 100 + 1000);
    expect(second?.volume).toBe(10_000 + 100_000 + 1_000_000);
  });

  it.each([
    { interval: '1d', reversal: 2500 },
    { interval: '1h', reversal: 500 },
    { interval: '1h', reversal: 150 }
  ] as const)(
    'keeps every volume in the lines, on BTCUSDT $interval bars by $reversal',
    ({ interval, reversal }) => {
      const bars = BTCUSDT[interval];
      const last = kagi(bars, { reversal }).at(-1);
      // A last close far the last line's way takes in the volume of the bars after its extreme.
      const close = (last?.close ?? 0) * ((last?.close ?? 0) > (last?.open ?? 0) ? 1.5 : 0.5);
      const all = [
        ...bars,
        {
          time: (bars.at(-1)?.time ?? 0) + DAY,
          open: close,
          high: close,
          low: close,
          close,
          volume: 7
        }
      ];
      const sum = (list: readonly Bar[]) => list.reduce((total, bar) => total + bar.volume, 0);

      expect(sum(kagi(all, { reversal }))).toBeCloseTo(sum(all), 6);
    }
  );

  it.each([
    { interval: '1d', params: { reversal: 2500 } },
    { interval: '1d', params: {} },
    { interval: '1d', params: { percentage: 1 } },
    { interval: '1h', params: { reversal: 500 } },
    { interval: '1h', params: { atrLength: 30 } }
  ] as const)(
    'matches a reference on BTCUSDT $interval bars with $params',
    ({ interval, params }) => {
      const bars = BTCUSDT[interval];
      const chart = chartOf(bars, interval);
      chart.transforms.set({ type: 'kagi', params });
      const reversal = chart.transforms.get()?.resolved?.reversal as number;
      const lines = chart.data.toArray();

      expect(lines.length).toBeGreaterThan(20);
      expect(rounded(lines)).toEqual(rounded(referenceKagi(bars, reversal)));
      expect(referenceYang(lines)).toEqual(
        lines.map((_, index) => startsYang(storeOf(lines), index))
      );

      if ('reversal' in params) {
        expect(rounded(streamed(bars, params, interval))).toEqual(rounded(lines));
      }
    }
  );

  it('sizes the reversal from the average true range, or the last close', () => {
    const bars = BTCUSDT['1d'];
    const chart = chartOf(bars);
    chart.transforms.set({ type: 'kagi' });
    // Of the closed bars: the latest one may still be forming.
    const atr = averageTrueRange(storeOf(bars), 14, bars.length - 1);

    expect(chart.transforms.get()).toEqual({
      type: 'kagi',
      params: {},
      input: 'bars',
      resolved: { reversal: roundSize(atr) }
    });
    chart.transforms.set({ type: 'kagi', params: { percentage: 2 } });
    expect(chart.transforms.get()?.resolved).toEqual({
      reversal: roundSize(((bars.at(-1)?.close ?? 0) * 2) / 100)
    });
  });

  it('draws yang thick from where a line passes the last shoulder, yin thin under the last waist', () => {
    // Lines 100 → 110 → 104 → 108 → 102 → 107 → 103 → 112: the fourth falls past the waist at 104,
    // the seventh rises past the shoulder at 107.
    const tops = [100, 110, 104, 108, 102, 107, 103, 112];
    const lines: Bar[] = tops.slice(1).map((close, index) => ({
      time: T0 + index * DAY,
      open: tops[index] ?? 0,
      high: Math.max(tops[index] ?? 0, close),
      low: Math.min(tops[index] ?? 0, close),
      close,
      volume: 1
    }));
    const store = storeOf(lines);
    expect(lines.map((_, index) => startsYang(store, index))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false
    ]);

    const points = new PointBuffer();
    points.reset(lines.length);
    lines.forEach((line, index) => {
      points.pushOhlc(index * 10, line.open, line.high, line.low, line.close, 1, true);
    });
    const strokes: { color: unknown; width: unknown; path: number[][] }[] = [];
    let path: number[][] = [];
    const record = (x: number, y: number) => {
      path.push([x, y]);
    };
    const ctx = {
      lineWidth: 0,
      strokeStyle: '',
      beginPath: () => {
        path = [];
      },
      moveTo: record,
      lineTo: record,
      setLineDash: () => undefined,
      stroke() {
        strokes.push({ color: this.strokeStyle, width: this.lineWidth, path });
      }
    };
    kagiSeries.paint({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      pixelRatio: 1,
      width: 100,
      height: 200,
      barSpacing: 10,
      style: { upColor: 'green', downColor: 'red', upWidth: 2, downWidth: 4 },
      points,
      valueToY: (value) => value,
      bars: store,
      first: 0,
      transform: null
    });

    const [yang, yin] = strokes;
    expect(yang).toMatchObject({ color: 'green', width: 2 });
    expect(yin).toMatchObject({ color: 'red', width: 4 });
    // The fourth line (x 30) is yang from 108 down to the waist at 104, yin below it.
    expect(yang?.path).toContainEqual([30, 104]);
    expect(yin?.path.slice(0, 2)).toEqual([
      [30, 104],
      [30, 102]
    ]);
    // The seventh (x 60) is yin from 103 up to the shoulder at 107, yang above it.
    expect(yin?.path.at(-1)).toEqual([60, 107]);
    expect(yang?.path.slice(-2)).toEqual([
      [60, 107],
      [60, 112]
    ]);
  });

  it('checks its parameters', () => {
    const bars = closes([1, 2, 3]);

    expect(() => kagi(bars, { box: 1 })).toThrow('The "kagi" transform has no parameter "box"');
    expect(() => kagi(bars, { reversal: 1, atrLength: 14 })).toThrow(
      'takes one of params.reversal, params.percentage and params.atrLength'
    );
  });
});

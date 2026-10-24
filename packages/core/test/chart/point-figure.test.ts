import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, BarInput } from '../../src/data/types';
import { averageTrueRange, roundSize } from '../../src/chart-types/box-sizes';
import { pointFigureSeries } from '../../src/chart-types/point-figure-series';
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

function columns(bars: readonly BarInput[], params: Record<string, unknown>): Bar[] {
  const chart = chartOf(bars);
  chart.transforms.set({ type: 'point-figure', params });
  return chart.data.toArray();
}

const levels = (bars: readonly Bar[]) => bars.map((bar) => [bar.open, bar.close]);

/** The columns after streaming `bars`, each first as a partial bar opened at the last close. */
function streamed(bars: readonly Bar[], params: Record<string, unknown>, interval: string): Bar[] {
  const chart = chartOf(bars.slice(0, 2), interval);
  chart.transforms.set({ type: 'point-figure', params });

  for (const bar of bars.slice(2)) {
    chart.data.update({ ...bar, high: bar.open, low: bar.open, close: bar.open, volume: 0 });
    chart.data.update(bar);
  }

  return chart.data.toArray();
}

interface ReferenceColumn {
  rising: boolean;
  /** The levels of its boxes, in the order they were filled. */
  boxes: number[];
  /** The bar it is timed at. */
  time: number;
  /** The bars whose volume it holds: from `from`, after the column before, to its last box. */
  from: number;
  to: number;
}

/**
 * Point & figure columns written apart from the transform, after the usual rules: an X fills
 * the box at or under the price and needs a price a box over the column's top, an O the box at
 * or over it and a price a box under its bottom; a turn needs `reversal` boxes the other way
 * and starts a box from the last; with the highs and lows a rising column reads the high and
 * only then the low. The first column starts from the first open once the price is `reversal`
 * boxes away; with one step back, a column of one box turns within itself.
 */
function referencePointFigure(
  bars: readonly Bar[],
  box: number,
  reversal: number,
  source: 'close' | 'hl' = 'close',
  oneStepBack = false
): Bar[] {
  const exact = (value: number) => Number(value.toPrecision(12));
  const under = (price: number) => exact(Math.floor(price / box + 1e-9) * box);
  const over = (price: number) => exact(Math.ceil(price / box - 1e-9) * box);
  const fill = (from: number, to: number) => {
    const count = Math.round(Math.abs(to - from) / box) + 1;
    return Array.from({ length: count }, (_, at) => exact(from + (to > from ? at : -at) * box));
  };
  const start = bars[0]?.open ?? 0;
  const done: ReferenceColumn[] = [];
  let column: ReferenceColumn | null = null;

  for (const [index, bar] of bars.entries()) {
    const high = source === 'hl' ? bar.high : bar.close;
    const low = source === 'hl' ? bar.low : bar.close;

    if (!column) {
      if (under(high) >= under(start) + reversal * box - box * 1e-9) {
        column = {
          rising: true,
          boxes: fill(under(start), under(high)),
          time: 0,
          from: 0,
          to: index
        };
      } else if (over(low) <= over(start) - reversal * box + box * 1e-9) {
        column = {
          rising: false,
          boxes: fill(over(start), over(low)),
          time: 0,
          from: 0,
          to: index
        };
      }

      continue;
    }

    const last = column.boxes.at(-1) ?? 0;
    const further = column.rising ? under(high) > last : over(low) < last;
    const target = column.rising ? over(low) : under(high);

    if (further) {
      column.boxes.push(...fill(last, column.rising ? under(high) : over(low)).slice(1));
      column.to = index;
    } else if ((column.rising ? last - target : target - last) >= reversal * box - box * 1e-9) {
      const first = exact(column.rising ? last - box : last + box);

      // One step back: the one box stays first in its column and the boxes the other way follow.
      if (oneStepBack && column.boxes.length === 1) {
        column.rising = !column.rising;
        column.boxes = [last, ...fill(first, target)];
        column.to = index;
        continue;
      }

      done.push(column);
      column = {
        rising: !column.rising,
        boxes: fill(first, target),
        time: index,
        from: column.to + 1,
        to: index
      };
    }
  }

  return [...done, ...(column ? [column] : [])].map((each) => {
    const open = each.boxes[0] ?? 0;
    const close = each.boxes.at(-1) ?? 0;
    let volume = 0;

    for (let index = each.from; index <= each.to; index += 1) {
      volume += bars[index]?.volume ?? 0;
    }

    return {
      time: bars[each.time]?.time ?? 0,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: Number(volume.toPrecision(10))
    };
  });
}

/** Bars with their volumes rounded, which sums in another order leave a rounding error apart. */
function rounded(bars: readonly Bar[]): Bar[] {
  return bars.map((bar) => ({ ...bar, volume: Number(bar.volume.toPrecision(10)) }));
}

describe('point & figure columns', () => {
  it('builds a high-low example, a box of 1 and a 3-box reversal', () => {
    // The example starts with O's from 15 down to 13; a first bar at 15.5 starts
    // the same column a box higher. Then, day by day as the example reads them: an O at 12 (the
    // high ignored), an O at 11, no O at 11.95 but a high of 14.10 turns three boxes to X's from
    // 12, an X at 15.99 (the low ignored), and a low of 12 turns to O's from 14.
    const days: [number, number][] = [
      [15.5, 12.9],
      [12.2, 11.7],
      [12.6, 10.9],
      [14.1, 11.95],
      [15.99, 13.8],
      [15.9, 12]
    ];
    const bars: Bar[] = [
      ...closes([15.5]),
      ...days.map(([high, low], index) => ({
        time: T0 + (index + 1) * DAY,
        open: low,
        high,
        low,
        close: high,
        volume: 1
      }))
    ];
    const built = columns(bars, { box: 1, reversal: 3, source: 'hl' });

    expect(levels(built)).toEqual([
      [16, 11],
      [12, 15],
      [14, 12]
    ]);
    expect(built.map((column) => (column.time - T0) / DAY)).toEqual([0, 4, 6]);
  });

  it('turns after the reversal distance, a $1 box times 3', () => {
    expect(levels(columns(closes([10, 13.2, 12, 10.5]), { box: 1 }))).toEqual([[10, 13]]);
    expect(levels(columns(closes([10, 13.2, 12, 10.5, 10]), { box: 1 }))).toEqual([
      [10, 13],
      [12, 10]
    ]);
    // The first column needs the reversal too: 12.9 fills no third box above 10.
    expect(columns(closes([10, 12.9, 9.1]), { box: 1 })).toEqual([]);
  });

  it('turns a one-box column within itself, one step back', () => {
    const bars = closes([10, 12, 11, 12, 13, 12, 11, 12]).map((bar, index) => ({
      ...bar,
      volume: 10 ** index
    }));

    expect(levels(columns(bars, { box: 1, reversal: 1 }))).toEqual([
      [10, 12],
      [11, 11],
      [12, 13],
      [12, 11],
      [12, 12]
    ]);
    const stepped = columns(bars, { box: 1, reversal: 1, oneStepBack: true });
    expect(levels(stepped)).toEqual([
      [10, 12],
      // An O at 11, then X's at 12 and 13 in the same column.
      [11, 13],
      [12, 11],
      [12, 12]
    ]);
    // The turned column keeps the time of its first box, and its volume.
    expect(stepped[1]?.time).toBe(T0 + 2 * DAY);
    expect(stepped[1]?.volume).toBe(100 + 1000 + 10_000);
  });

  it.each([
    { interval: '1d', params: { box: 1000, reversal: 3 } },
    { interval: '1d', params: { box: 500, reversal: 1, oneStepBack: true } },
    { interval: '1h', params: { box: 100, reversal: 3 } },
    { interval: '1h', params: { box: 200, reversal: 2, source: 'hl' } }
  ] as const)(
    'keeps every volume in the columns, on BTCUSDT $interval bars with $params',
    ({ interval, params }) => {
      const bars = BTCUSDT[interval];
      const last = columns(bars, params).at(-1);
      // A last close far the last column's way takes in the volume of the bars after its box.
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

      expect(sum(columns(all, params))).toBeCloseTo(sum(all), 6);
    }
  );

  it.each([
    { interval: '1d', params: { box: 1000, reversal: 3 } },
    { interval: '1d', params: { box: 1000, reversal: 3, source: 'hl' } },
    { interval: '1d', params: { box: 500, reversal: 1, oneStepBack: true } },
    { interval: '1d', params: {} },
    { interval: '1h', params: { box: 100, reversal: 3 } },
    { interval: '1h', params: { box: 200, reversal: 2, source: 'hl' } },
    { interval: '1h', params: { percentage: 0.5, reversal: 1 } }
  ] as const)(
    'matches a reference on BTCUSDT $interval bars with $params',
    ({ interval, params }) => {
      const bars = BTCUSDT[interval];
      const chart = chartOf(bars, interval);
      chart.transforms.set({ type: 'point-figure', params });
      const resolved = chart.transforms.get()?.resolved ?? {};
      const built = chart.data.toArray();

      expect(built.length).toBeGreaterThan(10);
      expect(rounded(built)).toEqual(
        referencePointFigure(
          bars,
          resolved.box as number,
          resolved.reversal as number,
          resolved.source as 'close' | 'hl',
          resolved.oneStepBack as boolean
        )
      );

      if ('box' in params) {
        expect(rounded(streamed(bars, params, interval))).toEqual(rounded(built));
      }
    }
  );

  it('sizes the box from the average true range by default', () => {
    const bars = BTCUSDT['1d'];
    const chart = chartOf(bars);
    chart.transforms.set({ type: 'point-figure' });
    const store = new BarStore();
    store.assign(bars);

    expect(chart.transforms.get()?.resolved).toEqual({
      box: roundSize(averageTrueRange(store, 14, bars.length - 1)),
      reversal: 3,
      source: 'close',
      oneStepBack: false
    });
  });

  it('draws an X or an O in each box, a column turned one step back starting the other way', () => {
    // An X column 10 → 12, a column of an O at 11 and X's at 12 and 13, an O column 12 → 11.
    const built: Bar[] = [
      [10, 12],
      [11, 13],
      [12, 11]
    ].map(([open = 0, close = 0], index) => ({
      time: T0 + index * DAY,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1
    }));
    const store = new BarStore();
    store.assign(built);
    const valueToY = (value: number) => 200 - value * 10;
    const points = new PointBuffer();
    points.reset(built.length);
    built.forEach((bar, index) => {
      points.pushOhlc(
        index * 20,
        valueToY(bar.open),
        valueToY(bar.high),
        valueToY(bar.low),
        valueToY(bar.close),
        1,
        true
      );
    });
    const strokes: { color: unknown; crosses: number[][]; noughts: number[][] }[] = [];
    let crosses: number[][] = [];
    let noughts: number[][] = [];
    const ctx = {
      strokeStyle: '',
      beginPath: () => {
        crosses = [];
        noughts = [];
      },
      moveTo: (x: number, y: number) => {
        crosses.push([x, y]);
      },
      lineTo: () => undefined,
      ellipse: (x: number, y: number) => {
        noughts.push([x, y]);
      },
      setLineDash: () => undefined,
      stroke() {
        strokes.push({ color: this.strokeStyle, crosses, noughts });
      }
    };
    pointFigureSeries.paint({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      pixelRatio: 1,
      width: 100,
      height: 200,
      barSpacing: 20,
      style: { upColor: 'green', downColor: 'red', lineWidth: 1, widthRatio: 1, box: null },
      points,
      valueToY,
      bars: store,
      first: 0,
      transform: { box: 1 }
    });

    const [xs, os] = strokes;
    // Each X starts two strokes at its left edge, at the top and the bottom of its box.
    const crossTops = (xs?.crosses ?? []).filter((_, index) => index % 2 === 0);
    expect(xs?.color).toBe('green');
    expect(crossTops.map(([x = 0, y = 0]) => [Math.round(x + 7.6), Math.round(y - 1.2)])).toEqual([
      [0, 95],
      [0, 85],
      [0, 75],
      [20, 75],
      [20, 65]
    ]);
    expect(os?.color).toBe('red');
    expect(os?.noughts).toEqual([
      [20, 90],
      [40, 80],
      [40, 90]
    ]);
  });

  it('checks its parameters', () => {
    const bars = closes([1, 2, 3]);

    expect(() => columns(bars, { lines: 3 })).toThrow(
      'The "point-figure" transform has no parameter "lines"'
    );
    expect(() => columns(bars, { box: 1, reversal: 0 })).toThrow(
      'params.reversal must be at least 1'
    );
    expect(() => columns(bars, { box: 1, source: 'open' })).toThrow(
      'params.source must be one of "close", "hl"'
    );
  });
});

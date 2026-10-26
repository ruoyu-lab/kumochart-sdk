import type { Bar } from '../../data/types';
import { RingBuffer } from '../primitives';
import type { IndicatorDefinition, IndicatorStream, ParamSpec } from '../types';
import { choiceParam, switchParam } from './shared';

/** Bars on one side of a pivot. */
function sideParam(label: string): ParamSpec {
  return { default: 10, min: 1, max: 500, integer: true, label };
}

/**
 * The value `right` bars back if it is a pivot of the window: above (`sign` 1) or below (-1)
 * every one of the `right` values after it, and at least as high (as low) as the `left` values
 * before it, so of equal values the latest is the pivot; `NaN` otherwise or before the window is
 * full.
 */
function pivotOf(values: RingBuffer, right: number, sign: 1 | -1): number {
  if (!values.full) {
    return Number.NaN;
  }

  const pivot = values.fromEnd(right);

  for (let back = 0; back < values.length; back += 1) {
    const value = sign * values.fromEnd(back);

    if (back < right ? value >= sign * pivot : back > right && value > sign * pivot) {
      return Number.NaN;
    }
  }

  return pivot;
}

class PivotStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly highRight: number,
    private readonly lowRight: number,
    private readonly highs: RingBuffer,
    private readonly lows: RingBuffer
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    this.out[0] = pivotOf(this.highs, this.highRight, 1);
    this.out[1] = pivotOf(this.lows, this.lowRight, -1);
    return this.out;
  }

  clone(): IndicatorStream {
    return new PivotStream(this.highRight, this.lowRight, this.highs.clone(), this.lows.clone());
  }
}

/**
 * Pivot points high low: a high above the `highRight` highs after it and at least as high as the
 * `highLeft` highs before it, marked over its bar with its price, and a low below the `lowRight`
 * lows after it and at least as low as the `lowLeft` before it, marked under its bar. A pivot is
 * known `right` bars later, and drawn back on its bar.
 */
export const PIVOTHL: IndicatorDefinition<{
  highLeft: number;
  highRight: number;
  lowLeft: number;
  lowRight: number;
}> = {
  type: 'PIVOTHL',
  name: 'Pivots HL',
  pane: 'main',
  precision: 'price',
  params: {
    highLeft: sideParam('Pivot High Left'),
    highRight: sideParam('Pivot High Right'),
    lowLeft: sideParam('Pivot Low Left'),
    lowRight: sideParam('Pivot Low Right')
  },
  outputs: ({ highRight, lowRight }) => [
    {
      key: 'pivotHigh',
      label: 'Pivot High',
      plot: { kind: 'marker', shape: 'triangle-down', size: 4, value: true },
      themeColor: 'up',
      offset: -highRight
    },
    {
      key: 'pivotLow',
      label: 'Pivot Low',
      plot: { kind: 'marker', shape: 'triangle-up', size: 4, value: true },
      themeColor: 'down',
      offset: -lowRight
    }
  ],
  create: ({ highLeft, highRight, lowLeft, lowRight }) =>
    new PivotStream(
      highRight,
      lowRight,
      new RingBuffer(highLeft + highRight + 1),
      new RingBuffer(lowLeft + lowRight + 1)
    )
};

/**
 * The value `half` bars back if it is a swing of the window of `2 * half + 1` values: higher
 * (`sign` 1) or lower (-1) than every one of the `half` values before it, and at least as high (as
 * low) as the `half` values after it; `NaN` otherwise or before the window is full.
 */
function swingOf(values: RingBuffer, half: number, sign: 1 | -1): number {
  if (!values.full) {
    return Number.NaN;
  }

  const swing = values.fromEnd(half);

  for (let back = 0; back < values.length; back += 1) {
    const value = sign * values.fromEnd(back);

    if (back < half ? value > sign * swing : back > half && value >= sign * swing) {
      return Number.NaN;
    }
  }

  return swing;
}

/** Bars on each side of a swing for `depth` pivot legs: half of them, at least two. */
function swingHalf(depth: number): number {
  return Math.max(2, Math.floor(depth / 2));
}

/** The last pivot: whether it is a high, and its price (`NaN` before the first). */
interface ZigzagState {
  high: boolean;
  price: number;
}

/**
 * Swings of the highs and of the lows, `half` bars on each side, known `half` bars after their
 * bar. A swing on the side of the last pivot replaces it when beyond it; one of the other side
 * becomes a pivot when it is `deviation` percent beyond the last; the first swing is the first
 * pivot. On one bar the high swing comes first. Each bar gives the swings it takes as pivots, and
 * where the line goes on to from the last pivot: the bar's low after a high, its high after a low.
 */
class ZigzagStream implements IndicatorStream {
  private readonly out = new Float64Array(3);
  private state: ZigzagState = { high: false, price: Number.NaN };

  constructor(
    private readonly deviation: number,
    private readonly half: number,
    private readonly highs: RingBuffer,
    private readonly lows: RingBuffer
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    const high = swingOf(this.highs, this.half, 1);
    const low = swingOf(this.lows, this.half, -1);
    this.out[1] = this.takes(true, high) ? high : Number.NaN;
    this.out[2] = this.takes(false, low) ? low : Number.NaN;
    const { high: afterHigh, price } = this.state;
    this.out[0] = Number.isNaN(price) ? Number.NaN : afterHigh ? bar.low : bar.high;
    return this.out;
  }

  /** Whether a swing becomes the last pivot. */
  private takes(high: boolean, price: number): boolean {
    if (Number.isNaN(price)) {
      return false;
    }

    const last = this.state;
    const change = (100 * (price - last.price)) / Math.abs(last.price);
    const beyond = Number.isNaN(last.price)
      ? true
      : last.high === high
        ? (high ? price - last.price : last.price - price) > 0
        : (high ? change : -change) >= this.deviation;

    if (beyond) {
      this.state = { high, price };
    }

    return beyond;
  }

  clone(): IndicatorStream {
    const copy = new ZigzagStream(this.deviation, this.half, this.highs.clone(), this.lows.clone());
    // Each pivot replaces the state rather than changing it, so copies can share it.
    copy.state = this.state;
    return copy;
  }
}

/** The parameters of the zigzag. */
export type ZigzagParams = {
  deviation: number;
  depth: number;
  extend: number;
  showPrice: number;
  showVolume: number;
  showChange: number;
  changeMode: number;
};

/**
 * Zig zag: a line through the swings of the price. A swing is a high higher than the `depth / 2`
 * highs before it (at least two, rounded down) and at least as high as as many after it, or such a
 * low, so it is known that many bars later. A swing on the side of the last pivot replaces it when
 * beyond it, and one of the other side is the next pivot when it is `deviation` percent or more
 * from the last; on one bar the high comes first. The line goes on from the last pivot to the
 * latest bar's low after a high or its high after a low. Each pivot can be labeled with its price,
 * its change from the pivot before, as a price or in percent, and the volume since it.
 *
 * Its outputs are what each bar knew: `high` and `low` give the swings the bar took as pivots,
 * drawn back on their bars, and `zigZag` the low or high the line would go on to on it. Of
 * consecutive `high` values (or `low` values), only the last is still a pivot.
 */
export const ZIGZAG: IndicatorDefinition<ZigzagParams> = {
  type: 'ZIGZAG',
  name: 'Zig Zag',
  pane: 'main',
  precision: 'price',
  params: {
    deviation: { default: 5, min: 0.00001, max: 100, label: 'Price deviation for reversals (%)' },
    depth: { default: 10, min: 2, max: 1000, integer: true, label: 'Pivot legs' },
    extend: switchParam(true, 'Extend to last bar', false),
    showPrice: switchParam(true, 'Display reversal price', false),
    showVolume: switchParam(true, 'Display cumulative volume', false),
    showChange: switchParam(true, 'Display reversal price change', false),
    changeMode: choiceParam(['Absolute', 'Percent'], 0, 'Price change', false)
  },
  outputs: ({ depth, extend, showPrice, showVolume, showChange, changeMode }) => {
    const back = -swingHalf(depth);
    return [
      {
        key: 'zigZag',
        label: 'Zig Zag',
        plot: {
          kind: 'zigzag',
          high: 'high',
          low: 'low',
          extend: extend === 1,
          labels: {
            price: showPrice === 1,
            change: showChange === 1 ? (changeMode === 1 ? 'percent' : 'absolute') : null,
            volume: showVolume === 1
          }
        },
        legend: false
      },
      { key: 'high', label: 'Pivot High', plot: { kind: 'hidden' }, offset: back, legend: false },
      { key: 'low', label: 'Pivot Low', plot: { kind: 'hidden' }, offset: back, legend: false }
    ];
  },
  create: ({ deviation, depth }) => {
    const half = swingHalf(depth);
    return new ZigzagStream(
      deviation,
      half,
      new RingBuffer(2 * half + 1),
      new RingBuffer(2 * half + 1)
    );
  }
};

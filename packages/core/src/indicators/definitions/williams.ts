import type { Bar } from '../../data/types';
import { RingBuffer, SeededAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { namedLine, ParallelStream, periodParam } from './shared';

/** Bars an Alligator line is drawn ahead by. */
function shiftParam(value: number, label: string) {
  return { default: value, min: 0, max: 500, integer: true, label };
}

/**
 * Bill Williams' Alligator: smoothed moving averages of the median price `(H + L) / 2`, seeded
 * with their simple average, the jaw drawn 8 bars ahead, the teeth 5 and the lips 3.
 */
export const ALLIGATOR: IndicatorDefinition<{
  jaw: number;
  teeth: number;
  lips: number;
  jawShift: number;
  teethShift: number;
  lipsShift: number;
}> = {
  type: 'ALLIGATOR',
  name: 'Alligator',
  pane: 'main',
  source: 'hl2',
  precision: 'price',
  params: {
    jaw: periodParam(13, 'Jaw Length'),
    teeth: periodParam(8, 'Teeth Length'),
    lips: periodParam(5, 'Lips Length'),
    jawShift: shiftParam(8, 'Jaw Offset'),
    teethShift: shiftParam(5, 'Teeth Offset'),
    lipsShift: shiftParam(3, 'Lips Offset')
  },
  outputs: ({ jawShift, teethShift, lipsShift }) => [
    { ...namedLine('jaw', 'Jaw'), offset: jawShift },
    { ...namedLine('teeth', 'Teeth'), offset: teethShift },
    { ...namedLine('lips', 'Lips'), offset: lipsShift }
  ],
  create: ({ jaw, teeth, lips }) =>
    new ParallelStream(
      [jaw, teeth, lips].map((period) => SeededAverage.rma(period)),
      (_bar, price) => price
    )
};

/** Equal values allowed just before a fractal. */
const MAX_EQUAL = 4;

/**
 * Whether the value `period` bars back is a fractal: above (`sign` 1) or below (-1) the
 * `period` values after it, and the `period` values before it, which may follow up to four
 * values that equal it.
 */
function isFractal(values: RingBuffer, period: number, sign: 1 | -1): boolean {
  const center = sign * values.fromEnd(period);

  for (let back = 0; back < period; back += 1) {
    if (!(sign * values.fromEnd(back) < center)) {
      return false;
    }
  }

  for (let equal = 0; equal <= MAX_EQUAL; equal += 1) {
    let holds = true;

    for (let step = 1; step <= equal + period && holds; step += 1) {
      const value = sign * values.fromEnd(period + step);
      holds = step <= equal ? value <= center : value < center;
    }

    if (holds) {
      return true;
    }
  }

  return false;
}

class FractalStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly period: number,
    private readonly highs = new RingBuffer(2 * period + MAX_EQUAL + 1),
    private readonly lows = new RingBuffer(2 * period + MAX_EQUAL + 1)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    const { period } = this;
    this.out[0] = isFractal(this.lows, period, -1) ? this.lows.fromEnd(period) : Number.NaN;
    this.out[1] = isFractal(this.highs, period, 1) ? this.highs.fromEnd(period) : Number.NaN;
    return this.out;
  }

  clone(): IndicatorStream {
    return new FractalStream(this.period, this.highs.clone(), this.lows.clone());
  }
}

/**
 * Bill Williams' fractals: a low below the `period` lows on either side, marked under its bar,
 * and a high above the highs on either side, marked over it; before the fractal up to four
 * values may equal it. A fractal is known `period` bars later, and drawn back on its bar.
 */
export const FRACTALS: IndicatorDefinition<{ period: number }> = {
  type: 'FRACTALS',
  name: 'Fractals',
  pane: 'main',
  precision: 'price',
  params: { period: { default: 2, min: 2, max: 50, integer: true, label: 'Periods' } },
  outputs: ({ period }) => [
    {
      key: 'downFractal',
      label: 'Down fractal',
      plot: { kind: 'marker', shape: 'triangle-up', size: 4 },
      themeColor: 'down',
      offset: -period
    },
    {
      key: 'upFractal',
      label: 'Up fractal',
      plot: { kind: 'marker', shape: 'triangle-down', size: 4 },
      themeColor: 'up',
      offset: -period
    }
  ],
  create: ({ period }) => new FractalStream(period)
};

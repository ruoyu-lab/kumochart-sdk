import type { Bar } from '../../data/types';
import { RingBuffer } from '../primitives';
import type { IndicatorDefinition, IndicatorStream, ParamSpec } from '../types';

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

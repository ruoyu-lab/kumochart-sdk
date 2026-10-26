import type { Bar } from '../../data/types';
import { MovingSum, Previous } from '../primitives';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { namedLine, ratio } from './shared';
import { TrueRangeStep } from './volatility';

/** The upward and downward vortex movements and the true range, each summed over the period. */
class VortexStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly highs: Previous,
    private readonly lows: Previous,
    private readonly ranges: TrueRangeStep,
    private readonly upward: MovingSum,
    private readonly downward: MovingSum,
    private readonly range: MovingSum
  ) {}

  static of(period: number): VortexStream {
    return new VortexStream(
      new Previous(),
      new Previous(),
      new TrueRangeStep(),
      new MovingSum(period),
      new MovingSum(period),
      new MovingSum(period)
    );
  }

  next(bar: Bar): ArrayLike<number> {
    // NaN on the first bar, which keeps the sums undefined until it leaves their window.
    const upward = this.upward.next(Math.abs(bar.high - this.lows.next(bar.low)));
    const downward = this.downward.next(Math.abs(bar.low - this.highs.next(bar.high)));
    const range = this.range.next(this.ranges.next(bar));
    this.out[0] = ratio(upward, range);
    this.out[1] = ratio(downward, range);
    return this.out;
  }

  clone(): IndicatorStream {
    return new VortexStream(
      this.highs.clone(),
      this.lows.clone(),
      this.ranges.clone(),
      this.upward.clone(),
      this.downward.clone(),
      this.range.clone()
    );
  }
}

/**
 * Vortex indicator: `VI+ = SUM(|H - L'|, N) / SUM(TR, N)` and `VI- = SUM(|L - H'|, N) / SUM(TR, N)`
 * against the previous bar's low `L'` and high `H'`, the true range of the first bar being its
 * high minus its low. Both start on bar `N`, the first with `N` previous bars; undefined over a
 * window without range.
 */
export const VORTEX: IndicatorDefinition<{ period: number }> = {
  type: 'VORTEX',
  name: 'VI',
  pane: 'new',
  precision: 4,
  params: { period: { default: 14, min: 2, max: 2000, integer: true, label: 'Length' } },
  outputs: () => [namedLine('viPlus', 'VI +'), namedLine('viMinus', 'VI -')],
  create: ({ period }) => VortexStream.of(period)
};

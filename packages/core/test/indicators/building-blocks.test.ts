import { describe, expect, it } from 'vitest';
import type { Bar } from '../../src/data/types';
import {
  BOLL,
  computeIndicator,
  createIndicatorCalculator,
  DC,
  movingAverage,
  Previous,
  RingBuffer,
  RollingExtremes,
  StandardDeviation,
  type BarStep,
  type IndicatorDefinition,
  type IndicatorStream
} from '../../src/indicators';
import { expectClose } from './helpers';
import { ema, field, highest, lowest, N, rma, sma, walk, wma } from './reference';

const bars = walk(300);
const closes = field(bars, 'close');

/** An EMA with bands of `width` deviations, as an author writes it of the building blocks. */
class EmaBandStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly width: number,
    private readonly average: BarStep,
    private readonly deviation: StandardDeviation
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const middle = this.average.next(price, bar);
    const spread = this.deviation.next(price) * this.width;
    this.out[0] = middle;
    this.out[1] = middle + spread;
    this.out[2] = middle - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    return new EmaBandStream(this.width, this.average.clone(), this.deviation.clone());
  }
}

const EMA_BAND: IndicatorDefinition<{ period: number; width: number }> = {
  type: 'EMA_BAND',
  name: 'EMA band',
  pane: 'main',
  precision: 'price',
  params: { period: { default: 20, min: 1, integer: true }, width: { default: 2, min: 0 } },
  outputs: () => [
    { key: 'basis', label: 'Basis', plot: { kind: 'line' } },
    { key: 'upper', label: 'Upper', plot: { kind: 'line' } },
    { key: 'lower', label: 'Lower', plot: { kind: 'line' } }
  ],
  fills: () => [{ from: 'upper', to: 'lower' }],
  create: ({ period, width }) =>
    new EmaBandStream(width, movingAverage('ema', period), new StandardDeviation(period))
};

describe('the building blocks of indicators', () => {
  it('compute what the indicators of the SDK built of them compute', () => {
    const band = computeIndicator(EMA_BAND, bars);
    // Bollinger Bands on an EMA basis are built of the same blocks.
    const boll = computeIndicator(BOLL, bars, { params: { maType: 1 } });

    expect(band).toEqual(boll);
    expectClose(band.basis ?? [], ema(closes, 20), 9);
  });

  it('average as the averages to pick from do, and keep their state apart in clones', () => {
    const averages = (['sma', 'ema', 'rma', 'wma'] as const).map((kind) => movingAverage(kind, 5));
    const values = closes.map((close, index) =>
      averages.map((average) => average.next(close, bars[index] as Bar))
    );
    const column = (at: number) => values.map((row) => row[at] ?? N);

    expectClose(column(0), sma(closes, 5), 9);
    expectClose(column(1), ema(closes, 5), 9);
    expectClose(column(2), rma(closes, 5), 9);
    expectClose(column(3), wma(closes, 5), 9);

    const average = movingAverage('ema', 3);
    [1, 2, 3].forEach((value) => average.next(value, bars[0] as Bar));
    const copy = average.clone();
    expect(average.next(10, bars[0] as Bar)).not.toBe(copy.next(4, bars[0] as Bar));
    expect(copy.next(5, bars[0] as Bar)).toBeCloseTo(4, 9);
  });

  it('keep a window of the latest values, its extremes and the value before', () => {
    const window = new RingBuffer(3);
    [4, 8, 6, 2].forEach((value) => window.push(value));
    expect([window.length, window.full, window.at(0), window.fromEnd(0)]).toEqual([3, true, 8, 2]);
    expect([window.max(), window.min(), window.sum()]).toEqual([8, 2, 16]);

    const extremes = new RollingExtremes(10);
    const highs: number[] = [];
    const lows: number[] = [];
    bars.forEach((bar) => {
      extremes.push(bar.high, bar.low);
      highs.push(extremes.highest());
      lows.push(extremes.lowest());
    });
    expectClose(highs, highest(field(bars, 'high'), 10), 9);
    expectClose(lows, lowest(field(bars, 'low'), 10), 9);
    expect(computeIndicator(DC, bars, { params: { period: 10 } }).upper).toEqual(highs);

    const previous = new Previous();
    expect([previous.next(1), previous.next(2), previous.clone().next(3)]).toEqual([N, 1, 2]);
  });

  it('fail on a kind or a length they cannot take', () => {
    expect(() => movingAverage('hma' as never, 5)).toThrow(
      'kind must be one of "sma", "ema", "rma", "wma", "vwma", received "hma".'
    );
    expect(() => movingAverage('ema', 2.5)).toThrow('period must be an integer, received 2.5.');
    expect(() => new RingBuffer(0)).toThrow('capacity must be at least 1, received 0.');
    expect(() => new StandardDeviation(-1)).toThrow('period must be at least 1, received -1.');
    expect(() => new RollingExtremes(0)).toThrow('period must be at least 1, received 0.');
  });

  it('stream bar by bar, ticks of the latest bar included, as a chart computes them', () => {
    const calculator = createIndicatorCalculator(EMA_BAND);
    const full = computeIndicator(EMA_BAND, bars);

    bars.forEach((bar, index) => {
      // A tick that does not hold, then the bar from the state before it.
      const before = calculator.clone();
      before.next({ ...bar, close: bar.low });
      expect(calculator.next(bar)[1], `bar ${index}`).toEqual(full.upper?.[index]);
    });
  });
});

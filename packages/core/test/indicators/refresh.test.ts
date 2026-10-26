import { describe, expect, it } from 'vitest';
import type { Bar } from '../../src/data/types';
import type { IndicatorDefinition, IndicatorStream } from '../../src/indicators/types';
import type { Chart } from '../helpers/chart';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';

const BARS = 40;

/**
 * An indicator reading data besides the bars, as one fetching funding rates does: the running sum
 * of `data`'s value at each bar's time, 0 where it has none. It counts the bars it computes.
 */
function external(data: Map<number, number>, computed: { bars: number }): IndicatorDefinition {
  class SumStream implements IndicatorStream {
    private readonly out = new Float64Array(1);

    constructor(private sum = 0) {}

    next(bar: Bar): ArrayLike<number> {
      computed.bars += 1;
      this.sum += data.get(bar.time) ?? 0;
      this.out[0] = this.sum;
      return this.out;
    }

    clone(): IndicatorStream {
      return new SumStream(this.sum);
    }
  }

  return {
    type: 'EXTERNAL',
    name: 'External',
    pane: 'new',
    params: {},
    precision: 2,
    outputs: () => [{ key: 'sum', label: 'Sum', plot: { kind: 'line' } }],
    create: () => new SumStream()
  };
}

/** One output of an indicator at every bar. */
function valuesOf(chart: Chart, id: string, key: string): number[] {
  return Array.from(
    { length: chart.data.length },
    (_, index) =>
      chart.indicators.valuesAt(id, index).find((value) => value.key === key)?.value ?? Number.NaN
  );
}

/** The running sums of `data` at the bars, as a calculator computing them all again gives. */
function sums(data: Map<number, number>): number[] {
  let sum = 0;
  return createBars(BARS).map((bar) => {
    sum += data.get(Number(bar.time)) ?? 0;
    return sum;
  });
}

function setUp() {
  const data = new Map<number, number>();
  const computed = { bars: 0 };
  const chart = createTestChart();
  chart.indicators.register(external(data, computed));
  chart.data.set(createBars(BARS));
  const id = chart.indicators.add({ type: 'EXTERNAL' });
  const ma = chart.indicators.add({
    type: 'MA',
    params: { periods: [3] },
    source: { kind: 'indicator', id },
    pane: chart.indicators.get(id)?.pane ?? 'new'
  });
  valuesOf(chart, id, 'sum');
  computed.bars = 0;
  return { chart, data, computed, id, ma };
}

describe('refreshing an indicator that reads data besides the bars', () => {
  it('computes the whole indicator again from an earlier bar, those reading it too', () => {
    const { chart, data, computed, id, ma } = setUp();
    data.set(T0 + 5 * MINUTE, 10);
    // The chart cannot tell that the data changed: the values stay until it is told.
    expect(valuesOf(chart, id, 'sum').every((value) => value === 0)).toBe(true);
    expect(computed.bars).toBe(0);

    chart.indicators.refresh(id, T0 + 5 * MINUTE + 30_000);

    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(BARS);
    valuesOf(chart, ma, 'ma3')
      .slice(4, 9)
      .forEach((value, index) => {
        expect(value).toBeCloseTo([0, 10 / 3, 20 / 3, 10, 10][index] ?? Number.NaN, 9);
      });
  });

  it('computes the latest bar alone again from it, as for a tick', () => {
    const { chart, data, computed, id, ma } = setUp();
    const latest = T0 + (BARS - 1) * MINUTE;
    data.set(latest, 6);

    chart.indicators.refresh(id, latest);

    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(1);
    // The average reading it follows its latest value.
    expect(chart.indicators.valuesAt(ma).find((value) => value.key === 'ma3')?.value).toBeCloseTo(
      2,
      9
    );

    data.set(latest, 9);
    chart.indicators.refresh(id, latest + 59_000);
    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(2);
    expect(chart.indicators.valuesAt(ma).find((value) => value.key === 'ma3')?.value).toBeCloseTo(
      3,
      9
    );
  });

  it('computes everything again without a time, and from the earliest of several asked for', () => {
    const { chart, data, computed, id } = setUp();
    data.set(T0, 1);
    chart.indicators.refresh(id);
    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(BARS);

    computed.bars = 0;
    data.set(T0 + 2 * MINUTE, 2);
    data.set(T0 + (BARS - 1) * MINUTE, 3);
    chart.indicators.refresh(id, T0 + (BARS - 1) * MINUTE);
    chart.indicators.refresh(id, T0 + 2 * MINUTE);
    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(BARS);
  });

  it('computes from the first bar a time before the bars asks for', () => {
    const { chart, data, computed, id } = setUp();
    data.set(T0 + MINUTE, 4);
    chart.indicators.refresh(id, T0 - 60 * MINUTE);
    expect(valuesOf(chart, id, 'sum')).toEqual(sums(data));
    expect(computed.bars).toBe(BARS);
  });

  it('fails for an unknown indicator and a time that is no number', () => {
    const { chart, id } = setUp();
    expect(() => {
      chart.indicators.refresh('nothing');
    }).toThrow('Unknown indicator "nothing".');
    expect(() => {
      chart.indicators.refresh(id, Number.NaN);
    }).toThrow('refresh() from must be a finite number');
  });
});

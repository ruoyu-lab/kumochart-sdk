import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/feed/calendar';
import { allIndicators } from '../../src/indicators/all';
import { MACD } from '../../src/indicators';
import { computeIndicator, createIndicatorCalculator } from '../../src/indicators/headless';
import { checkIndicatorInput } from '../../src/indicators/input';
import type {
  IndicatorDefinition,
  IndicatorInput,
  IndicatorStream
} from '../../src/indicators/types';
import { createTestChart } from '../helpers/chart';
import { definitionOf, expectClose } from './helpers';
import { N, walk } from './reference';

const bars = walk(300);

function fail(): never {
  throw new Error('No such bar.');
}
const TYPES = allIndicators.map((definition) => definition.type);

describe('indicators without a chart', () => {
  it('names every type of the library once', () => {
    expect(new Set(TYPES).size).toBe(TYPES.length);
    expect(definitionOf('MACD')).toBe(MACD);
  });

  it.each(TYPES)('computes %s exactly as a chart shows it', (type) => {
    const chart = createTestChart({ calendar: { timeZone: 'Asia/Shanghai' } });
    chart.data.set(bars);
    const id = chart.indicators.add({ type });
    const headless = computeIndicator(definitionOf(type), bars, {
      calendar: createCalendar({ timeZone: 'Asia/Shanghai' })
    });
    const definition = definitionOf(type);
    const outputs = definition.outputs(chart.indicators.get(id)?.params ?? {});

    bars.forEach((_bar, index) => {
      const shown = chart.indicators.valuesAt(id, index);
      outputs.forEach((output, column) => {
        const computed = headless[output.key]?.[index - (output.offset ?? 0)] ?? N;
        const value = shown[column]?.value ?? null;
        expect(value === null ? N : value, `${output.key} on bar ${index}`).toEqual(computed);
      });
    });
  });

  it('streams bar by bar, and clones keep their own state', () => {
    const macd = createIndicatorCalculator(definitionOf('MACD'), { params: { fast: 8 } });
    expect(macd.outputs.map((output) => output.key)).toEqual(['histogram', 'macd', 'signalLine']);
    expect(macd.params).toEqual({ fast: 8, slow: 26, signal: 9, oscillatorType: 0, signalType: 0 });
    expect(macd.levels).toEqual([0]);
    const full = computeIndicator(definitionOf('MACD'), bars, { params: { fast: 8 } });

    bars.slice(0, 100).forEach((bar) => macd.next(bar));
    const checkpoint = macd.clone();
    const bar = bars[100] ?? fail();
    // A tick that does not hold, then the real bar from the checkpoint.
    expect(macd.next({ ...bar, close: bar.low })[1]).not.toBe(full.macd?.[100]);
    expect(checkpoint.next(bar)).toEqual([
      full.histogram?.[100],
      full.macd?.[100],
      full.signalLine?.[100]
    ]);
    expect(macd.next(bars[101] ?? fail())[1]).not.toBe(full.macd?.[101]);
  });

  it('reads the source and the trading calendar it is given', () => {
    const high = computeIndicator(definitionOf('MA'), bars, {
      params: { periods: [3] },
      source: 'high'
    });
    const expected = bars.map((_bar, index) =>
      index < 2 ? N : bars.slice(index - 2, index + 1).reduce((sum, bar) => sum + bar.high, 0) / 3
    );
    expectClose(high.ma3 ?? [], expected, 9);
    expect(createIndicatorCalculator(definitionOf('VWAP')).source).toBe('hlc3');

    // Restarting at midnight UTC or at midnight in Shanghai gives other values.
    const utc = computeIndicator(definitionOf('VWAP'), bars, {
      calendar: createCalendar({ timeZone: 'UTC' })
    });
    const shanghai = computeIndicator(definitionOf('VWAP'), bars, {
      calendar: createCalendar({ timeZone: 'Asia/Shanghai' })
    });
    expect(utc.vwap).not.toEqual(shanghai.vwap);
  });

  it('computes custom definitions, windowed or streaming', () => {
    const momentum: IndicatorDefinition<{ period: number }> = {
      type: 'MOM',
      name: 'MOM',
      pane: 'new',
      precision: 2,
      params: { period: { default: 2, min: 1, integer: true } },
      outputs: () => [{ key: 'mom', label: 'MOM', plot: { kind: 'line' } }],
      lookback: ({ period }) => period + 1,
      compute: (window) => [window.price(window.length - 1) - window.price(0)]
    };
    const values = computeIndicator(momentum, bars.slice(0, 4));
    expectClose(values.mom ?? [], [
      N,
      N,
      (bars[2]?.close ?? N) - (bars[0]?.close ?? N),
      (bars[3]?.close ?? N) - (bars[1]?.close ?? N)
    ]);

    let count = 0;
    const counter: IndicatorDefinition = {
      type: 'COUNT',
      name: 'COUNT',
      pane: 'new',
      precision: 0,
      params: {},
      outputs: () => [{ key: 'count', label: 'COUNT', plot: { kind: 'line' } }],
      create: () => {
        const stream: IndicatorStream = {
          next: () => [++count],
          clone: () => stream
        };
        return stream;
      }
    };
    expect(computeIndicator(counter, bars.slice(0, 3)).count).toEqual([1, 2, 3]);
  });

  it('rejects what a chart would reject', () => {
    expect(() =>
      createIndicatorCalculator(definitionOf('RSI'), { params: { periods: 3 } })
    ).toThrow('Indicator "RSI" has no parameter "periods".');
    expect(() =>
      createIndicatorCalculator(definitionOf('MA'), { params: { periods: [0] } })
    ).toThrow('params.periods[0] must be at least 1, received 0.');
    expect(() =>
      createIndicatorCalculator(definitionOf('MA'), { source: 'median' as never })
    ).toThrow('options.source must be one of');
    expect(() =>
      createIndicatorCalculator({
        type: 'X',
        name: 'X',
        pane: 'side'
      } as unknown as IndicatorDefinition)
    ).toThrow('An indicator definition needs create(), or lookback() and compute().');
    expect(() =>
      createIndicatorCalculator(definitionOf('MA')).next({ time: 0, open: 1 } as never)
    ).toThrow('bar.high must be a finite number, received undefined.');
    expect(() => computeIndicator(definitionOf('MA'), [{ ...bars[0], low: 200 }] as never)).toThrow(
      'bars[0] is inconsistent'
    );
    // The bars of a chart follow one another in time.
    expect(() => computeIndicator(definitionOf('VWAP'), [bars[1], bars[0]] as never)).toThrow(
      'bars must be sorted by strictly ascending time: bars[1]'
    );
  });

  it('computes from the values of another indicator as a chart does, its warm-up skipped', () => {
    const chart = createTestChart();
    chart.data.set(bars);
    const rsi = chart.indicators.add({ type: 'RSI' });
    const ema = chart.indicators.add({
      type: 'EMA',
      params: { periods: [5] },
      source: { kind: 'indicator', id: rsi, key: 'rsi' }
    });
    const upstream = createIndicatorCalculator(definitionOf('RSI'));
    const calculator = createIndicatorCalculator(definitionOf('EMA'), { params: { periods: [5] } });

    bars.forEach((bar, index) => {
      const [value = N] = upstream.next(bar);
      const [computed = N] = calculator.nextOf(bar, value);
      const shown = chart.indicators.valuesAt(ema, index)[0]?.value ?? null;
      expect(shown === null ? N : shown, `bar ${String(index)}`).toEqual(computed);
    });

    const next = createIndicatorCalculator(definitionOf('EMA'));
    expect(() => next.nextOf(bars[0] ?? fail(), Number.POSITIVE_INFINITY)).toThrow(
      'value must be a finite number, received Infinity.'
    );
    next.nextOf(bars[1] ?? fail(), N);
    // A bar skipped is still a bar that came.
    expect(() => next.nextOf(bars[1] ?? fail(), 50)).toThrow(
      'must be after the time of the last bar'
    );
  });

  it.each(TYPES)(
    'computes %s from the values of another indicator exactly as a chart does',
    (type) => {
      const calendar = { timeZone: 'Asia/Shanghai' };
      const chart = createTestChart({ calendar });
      chart.data.set(bars);
      const rsi = chart.indicators.add({ type: 'RSI' });
      const id = chart.indicators.add({ type, source: { kind: 'indicator', id: rsi } });
      const options = { calendar: createCalendar(calendar) };
      const upstream = createIndicatorCalculator(definitionOf('RSI'), options);
      const calculator = createIndicatorCalculator(definitionOf(type), options);
      const computed = bars.map((bar) => calculator.nextOf(bar, upstream.next(bar)[0] ?? N));

      calculator.outputs.forEach((output, column) => {
        const offset = output.offset ?? 0;
        bars.forEach((_bar, index) => {
          const value = chart.indicators.valuesAt(id, index + offset)[column]?.value ?? null;
          expect(value === null ? N : value, `${output.key} on bar ${index}`).toEqual(
            computed[index]?.[column]
          );
        });
      });
    }
  );

  it('takes the next bar only after the last one, as a chart does', () => {
    const calculator = createIndicatorCalculator(definitionOf('MA'), { params: { periods: [2] } });
    const first = bars[0] ?? fail();
    const second = bars[1] ?? fail();
    calculator.next(second);
    const checkpoint = calculator.clone();

    expect(() => calculator.next(first)).toThrow(
      `bar.time (${String(first.time)}) must be after the time of the last bar (${String(second.time)}).`
    );
    // The same bar again would be counted twice; a clone tries it the other way.
    expect(() => calculator.next(second)).toThrow('must be after the time of the last bar');
    expect(() => checkpoint.next(second)).toThrow('must be after the time of the last bar');
    // A bar that failed changes nothing.
    expect(calculator.next(bars[2] ?? fail())).toEqual(checkpoint.next(bars[2] ?? fail()));
  });
});

describe('checking indicators without a chart', () => {
  const definition = definitionOf;

  it('throws what chart.indicators.add() throws', () => {
    const chart = createTestChart();
    const inputs: IndicatorInput[] = [
      { type: 'RSI', params: { periods: [3] } },
      { type: 'MA', params: { periods: [0] } },
      { type: 'MA', params: { periods: 5 } },
      { type: 'MA', params: { periods: [5, 5] } },
      { type: 'VWAP', params: { anchor: 9 } },
      { type: 'MA', source: 'median' as never },
      { type: 'MA', source: { kind: 'indicator', id: 7 } as never },
      { type: 'MA', colors: { ma99: '#f00' } },
      { type: 'MA', styles: { ma5: { lineWidth: 20 } } },
      { type: 'RSI', levels: [30, Number.NaN] },
      { type: 'MA', visible: 'yes' as never },
      { type: 'MA', scale: '' }
    ];

    for (const input of inputs) {
      const thrown = (() => {
        try {
          chart.indicators.add(input);
        } catch (error) {
          return (error as Error).message;
        }

        return null;
      })();

      expect(thrown, JSON.stringify(input)).not.toBeNull();
      expect(() => {
        checkIndicatorInput(definition(input.type), input);
      }).toThrow(thrown ?? '');
    }

    expect(chart.indicators.list()).toHaveLength(0);
  });

  it('passes what the chart takes, and leaves what needs a chart to it', () => {
    expect(() => {
      checkIndicatorInput(definition('MA'), {
        type: 'MA',
        params: { periods: [7, 30] },
        source: 'hl2',
        colors: { ma7: '#f59e0b' },
        styles: { ma30: { lineWidth: 2, lineStyle: 'dashed' } },
        visible: false
      });
    }).not.toThrow();
    // The indicator a source reads is on a chart.
    expect(() => {
      checkIndicatorInput(definition('EMA'), {
        type: 'EMA',
        source: { kind: 'indicator', id: 'rsi', key: 'rsi14' }
      });
    }).not.toThrow();
  });

  it("checks against any type's parameters and outputs", () => {
    const rows = {
      type: 'PROFILE',
      params: { rows: { default: 24, min: 4, max: 200, integer: true } },
      outputs: () => [{ key: 'up', label: 'Up', plot: { kind: 'columns', from: 0 } } as const]
    };

    expect(() => {
      checkIndicatorInput(rows, { type: 'PROFILE', params: { rows: 2 } });
    }).toThrow('params.rows must be at least 4, received 2.');
    expect(() => {
      checkIndicatorInput(rows, { type: 'PROFILE', colors: { down: '#000' } });
    }).toThrow('Indicator "PROFILE" has no output "down" for colors.');
    expect(() => {
      checkIndicatorInput(rows, { type: 'VOLUME' });
    }).toThrow('indicator.type is "VOLUME", but the definition is of "PROFILE".');
  });
});

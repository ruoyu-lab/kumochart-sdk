import { describe, expect, it } from 'vitest';
import { MA } from '../../src/indicators';
import { computeIndicator } from '../../src/indicators/headless';
import { checkIndicatorInput } from '../../src/indicators/input';
import { indicators } from '../../src/indicators/module';
import type { IndicatorDefinition } from '../../src/indicators/types';
import { chartWithBars } from '../helpers/chart';

/** A windowed type reading `bars` bars, the latest close. */
const WINDOW: IndicatorDefinition<{ bars: number }> = {
  type: 'WINDOW',
  name: 'Window',
  pane: 'new',
  precision: 2,
  params: { bars: { default: 2, min: 0, max: 10 } },
  outputs: () => [{ key: 'close', label: 'CLOSE', plot: { kind: 'line' } }],
  lookback: ({ bars }) => bars,
  compute: (window) => [window.bar(window.length - 1).close]
};

describe('indicator input', () => {
  it('fails on a window of no whole number of bars when the indicator is added or changed', () => {
    const chart = chartWithBars(30);
    chart.indicators.register(WINDOW);

    expect(() => chart.indicators.add({ type: 'WINDOW', params: { bars: 0 } })).toThrow(
      'lookback() of "WINDOW" must be at least 1, received 0.'
    );
    expect(() => {
      checkIndicatorInput(WINDOW, { type: 'WINDOW', params: { bars: 1.5 } });
    }).toThrow('lookback() of "WINDOW" must be an integer, received 1.5.');
    expect(chart.indicators.list()).toHaveLength(0);

    const id = chart.indicators.add({ type: 'WINDOW' });
    expect(() => {
      chart.indicators.update(id, { params: { bars: 0 } });
    }).toThrow('lookback() of "WINDOW" must be at least 1, received 0.');
    expect(chart.indicators.get(id)?.params).toEqual({ bars: 2 });
    expect(chart.indicators.valuesAt(id)[0]?.value).toBe(chart.data.toArray()[29]?.close);
  });

  it('fails on what is no indicator, no change or no parameters, and on unknown parameters', () => {
    const chart = chartWithBars(30);

    expect(() => chart.indicators.add(null as never)).toThrow(
      'indicator must be an object, received null.'
    );
    expect(() => chart.indicators.add({ type: 'MA', params: 5 as never })).toThrow(
      'params must be an object, received 5.'
    );
    // Names an object has from its prototype are no parameters either.
    expect(() => chart.indicators.add({ type: 'MA', params: { toString: 5 } })).toThrow(
      'Indicator "MA" has no parameter "toString".'
    );
    expect(() => {
      checkIndicatorInput(WINDOW, { type: 'WINDOW', params: [3] as never });
    }).toThrow('params must be an object, received an array.');
    expect(chart.indicators.list()).toHaveLength(0);

    const id = chart.indicators.add({ type: 'MA', params: { periods: [5] } });
    expect(() => {
      chart.indicators.update(id, null as never);
    }).toThrow('patch must be an object, received null.');
    expect(() => {
      chart.indicators.update(id, { params: null as never });
    }).toThrow('params must be an object, received null.');
    expect(chart.indicators.get(id)?.params).toEqual({ periods: [5] });
  });

  it('fails on parameters set to null instead of taking their defaults', () => {
    const chart = chartWithBars(30);

    expect(() => chart.indicators.add({ type: 'MA', params: { periods: null as never } })).toThrow(
      'Parameter "periods" of indicator "MA" must be a list of'
    );
    expect(() => chart.indicators.add({ type: 'CCI', params: { period: null as never } })).toThrow(
      'params.period must be a finite number, received null.'
    );
    expect(() => {
      checkIndicatorInput(WINDOW, { type: 'WINDOW', params: { bars: null as never } });
    }).toThrow('params.bars must be a finite number, received null.');
    expect(() => computeIndicator(MA, [], { params: { periods: null as never } })).toThrow(
      'Parameter "periods" of indicator "MA" must be a list of'
    );
    expect(chart.indicators.list()).toHaveLength(0);

    const id = chart.indicators.add({ type: 'CCI', params: { period: 10 } });
    expect(() => {
      chart.indicators.update(id, { params: { period: null as never } });
    }).toThrow('params.period must be a finite number, received null.');
    expect(chart.indicators.get(id)?.params).toMatchObject({ period: 10 });
  });

  it('fails on definitions that are no objects, and on plots it cannot draw', () => {
    const chart = chartWithBars(30);
    const drawing = (plot: unknown) =>
      ({
        ...WINDOW,
        type: 'PLOT',
        outputs: () => [{ key: 'close', label: 'CLOSE', plot }]
      }) as unknown as IndicatorDefinition;

    expect(() => {
      chart.indicators.register(null as never);
    }).toThrow('indicator definition must be an object, received null.');
    expect(() => indicators([5 as never])).toThrow(
      'indicator definition must be an object, received 5.'
    );
    expect(() => indicators(MA as never)).toThrow('indicators() must be an array');

    // A misspelt plot would draw nothing.
    for (const [plot, message] of [
      [undefined, 'output "close" of "PLOT": plot must be an object, received undefined.'],
      [{ kind: 'lines' }, 'output "close" of "PLOT": kind must be one of "line", "segments"'],
      [
        { kind: 'histogram', colorBy: 'up' },
        'output "close" of "PLOT": colorBy must be one of "sign", "change", "bar"'
      ],
      [{ kind: 'segments', style: 'wavy' }, 'output "close" of "PLOT": style must be one of'],
      [
        { kind: 'line', width: 20 },
        'output "close" of "PLOT": width must be at most 10, received 20.'
      ],
      [
        { kind: 'box', from: 'close', group: 'day' },
        'The boxes of output "close" of "PLOT" are told apart by "day", which is no output.'
      ]
    ] as const) {
      expect(() => computeIndicator(drawing(plot), []), JSON.stringify(plot)).toThrow(message);
    }
  });

  it('numbers ids by type, without giving one twice or for an indicator that failed', () => {
    const chart = chartWithBars(30);

    expect(chart.indicators.add({ type: 'MA' })).toBe('ma-1');
    expect(() => chart.indicators.add({ type: 'RSI', params: { period: 0 } })).toThrow(
      'params.period must be at least 1, received 0.'
    );
    expect(() => chart.indicators.add({ type: 'RSI', scale: '' })).toThrow(
      'indicator.scale must be a non-empty string'
    );
    expect(chart.indicators.add({ type: 'RSI' })).toBe('rsi-1');
    expect(chart.indicators.add({ type: 'MA' })).toBe('ma-2');
    chart.indicators.remove('rsi-1');
    expect(chart.indicators.add({ type: 'RSI' })).toBe('rsi-2');
  });

  it('fails on definitions it could not draw when they are registered', () => {
    const chart = chartWithBars(30);
    const register = (patch: object) => () => {
      chart.indicators.register({ ...WINDOW, ...patch });
    };

    // Each would be registered and added, and then fail every frame or valuesAt().
    expect(register({ precision: -1 })).toThrow(
      'definition.precision must be at least 0, received -1.'
    );
    expect(register({ precision: 'percent' })).toThrow(
      'definition.precision must be one of "price", "volume", received "percent".'
    );
    expect(register({ levels: [30, 70] })).toThrow(
      'definition.levels must be a function of the parameters.'
    );
    expect(register({ name: undefined })).toThrow(
      'definition.name must be a non-empty string, received undefined.'
    );
    expect(register({ params: undefined })).toThrow(
      'definition.params must be an object, received undefined.'
    );
    expect(register({ range: { min: 0 } })).toThrow(
      'definition.range.max must be a finite number, received undefined.'
    );
    expect(chart.indicators.types()).not.toContain('WINDOW');
  });

  it('checks a definition with a chart as without one', () => {
    const chart = chartWithBars(30);
    const both = (patch: object, message: string) => {
      const definition = { ...WINDOW, ...patch } as unknown as IndicatorDefinition;
      expect(() => {
        chart.indicators.register(definition);
      }, message).toThrow(message);
      expect(() => computeIndicator(definition, []), message).toThrow(message);
    };

    both({ type: undefined }, 'definition.type must be a non-empty string, received undefined.');
    both(
      { source: 'typical' },
      'definition.source must be one of "open", "high", "low", "close", "hl2", "hlc3", "ohlc4", received "typical".'
    );
    both({ compute: [1] }, 'definition.compute must be a function.');
    both({ lookback: 2 }, 'definition.lookback must be a function.');
    both({ create: 'stream' }, 'definition.create must be a function.');
    both({ fills: [] }, 'definition.fills must be a function of the parameters.');
    expect(chart.indicators.types()).not.toContain('WINDOW');
  });

  it('fails on a shade between outputs the parameters do not make', () => {
    const chart = chartWithBars(30);
    // Shades the band of an upper and a lower line, misspelt.
    const BAND: IndicatorDefinition<{ width: number }> = {
      type: 'BAND',
      name: 'Band',
      pane: 'main',
      precision: 2,
      params: { width: { default: 0, min: 0 } },
      outputs: ({ width }) => [
        { key: 'close', label: 'CLOSE', plot: { kind: 'line' } },
        ...(width > 0
          ? ([
              { key: 'upper', label: 'UPPER', plot: { kind: 'line' } },
              { key: 'lower', label: 'LOWER', plot: { kind: 'line' } }
            ] as const)
          : [])
      ],
      fills: ({ width }) => (width > 0 ? [{ from: 'upper', to: 'lowr' }] : []),
      lookback: () => 1,
      compute: (window) => {
        const { close } = window.bar(0);
        return [close, close + 1, close - 1];
      }
    };
    const message =
      'definition.fills[0] of "BAND" shades from "upper" to "lowr", which is no output.';
    chart.indicators.register(BAND);

    expect(chart.indicators.add({ type: 'BAND' })).toBe('band-1');
    expect(() => chart.indicators.add({ type: 'BAND', params: { width: 1 } })).toThrow(message);
    expect(() => {
      chart.indicators.update('band-1', { params: { width: 1 } });
    }).toThrow(message);
    expect(() => computeIndicator(BAND, [], { params: { width: 1 } })).toThrow(message);
    expect(() => {
      checkIndicatorInput(BAND, { type: 'BAND', params: { width: 1 } });
    }).toThrow(message);
    expect(() =>
      computeIndicator(
        { ...BAND, fills: () => [{ from: 'close', to: 'close', colorBy: 'up' as 'higher' }] },
        []
      )
    ).toThrow('definition.fills[0].colorBy must be one of "from", "higher", received "up".');
  });
});

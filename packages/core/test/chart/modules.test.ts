import { describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts';
import { chartTypes, renko } from '../../src/chart-types';
import { allModules } from '../../src/all';
import { createModule } from '../../src/chart/modules';
import { lineSeries } from '../../src/series/lines';
import { drawings, trendLine } from '../../src/drawings';
import { indicators, MA, RSI } from '../../src/indicators';
import { markers, orders } from '../../src/trading';
import { createBars } from '../helpers/bars';
import { createModularChart, testContainer } from '../helpers/chart';
import { createChart } from '../../src/chart/create-chart';

describe('modules', () => {
  it('add their namespaces to a chart, and a chart without them has none', () => {
    const core = createModularChart({});
    const chart = createModularChart({ modules: [indicators([MA]), orders()] });

    expect(core.modules()).toEqual([]);
    expect('indicators' in core).toBe(false);
    expect('drawings' in core).toBe(false);
    expect(chart.modules()).toEqual(['indicators', 'orders']);
    expect(chart.indicators.types()).toEqual(['MA']);
    expect(chart.orders.list()).toEqual([]);
    expect('markers' in chart).toBe(false);
  });

  it('are given once each, and only modules are', () => {
    expect(() => createModularChart({ modules: [orders(), orders()] })).toThrow(
      'The orders module is given twice.'
    );
    expect(() => createModularChart({ modules: [{ name: 'fake' }] })).toThrow(
      'options.modules[0] is not a module'
    );
    expect(() => createModularChart({ modules: 'all' as never })).toThrow(
      'options.modules must be an array of modules'
    );
    expect(() => indicators([MA, MA])).toThrow('given the indicator type "MA" twice');
    expect(() => chartTypes([renko, renko])).toThrow('given the transform "renko" twice');
    expect(() => chartTypes([{ transform: { type: 'broken' } as never }])).toThrow(
      'transform definition name'
    );
    expect(() => chartTypes([{ series: { type: 'broken' } as never }])).toThrow('definition.input');
  });

  it('bring their options, which a chart without them rejects', () => {
    const chart = createModularChart({
      modules: [drawings([trendLine])],
      drawings: { magnet: 'strong' }
    });

    expect(chart.options().drawings).toEqual(expect.objectContaining({ magnet: 'strong' }));
    expect(() => {
      chart.applyOptions({ drawings: { magnet: 'sticky' as 'off' } });
    }).toThrow(/options.drawings.magnet must be one of/);
    expect(() =>
      createModularChart({ drawings: { magnet: 'strong' } } as unknown as Parameters<
        typeof createModularChart
      >[0])
    ).toThrow('The chart has no option "drawings"');
  });

  it('keep their part of the saved state, which a chart without them rejects', () => {
    const chart = createModularChart({ modules: [indicators([MA, RSI])] });
    chart.data.set(createBars(50));
    chart.indicators.add({ id: 'rsi', type: 'RSI' });
    const state = chart.saveState();
    const core = createModularChart({});

    expect(state.indicators.map((indicator) => indicator.id)).toEqual(['rsi']);
    expect('indicators' in core.saveState()).toBe(false);
    expect(() => {
      core.loadState(state);
    }).toThrow('The state has "indicators", which no module of the chart keeps.');

    // A state without the part gives the module nothing to show.
    const withoutIndicators = Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== 'indicators')
    ) as typeof state;
    chart.loadState({ ...withoutIndicators, panes: state.panes.slice(0, 1) });
    expect(chart.indicators.list()).toEqual([]);
  });

  it('give the values alerts and bar colors read, which a chart without them lacks', () => {
    const chart = createModularChart({ modules: [alerts()] });
    chart.data.set(createBars(50));

    expect(() => {
      chart.alerts.add({
        id: 'a',
        source: { kind: 'indicator', id: 'ma' },
        trigger: 'cross',
        value: 100
      });
    }).toThrow('the chart has no indicator values; load the module of its indicators');
    expect(() => {
      chart.applyOptions({
        mainSeries: { barColor: ({ indicator }) => (indicator('ma') > 0 ? '#fff' : null) }
      });
      chart.screenshot();
    }).toThrow('the chart has no indicator values');
  });

  it('keep what reads a value from losing it', () => {
    const chart = createModularChart({ modules: [indicators([MA]), alerts()] });
    chart.data.set(createBars(50));
    chart.indicators.add({ id: 'ma', type: 'MA', params: { periods: [5] } });
    chart.series.add({ id: 'cmp', type: 'line' });
    chart.alerts.set([
      { id: 'on-ma', source: { kind: 'indicator', id: 'ma' }, trigger: 'cross', value: 100 },
      {
        id: 'on-key',
        source: { kind: 'indicator', id: 'ma', key: 'ma5' },
        trigger: 'cross',
        value: 100
      },
      { id: 'on-series', source: { kind: 'series', id: 'cmp' }, trigger: 'cross', value: 100 }
    ]);

    expect(() => {
      chart.indicators.remove('ma');
    }).toThrow('"ma" is read by the alerts "on-ma", "on-key"; remove them first.');
    expect(() => {
      chart.indicators.update('ma', { params: { periods: [10] } });
    }).toThrow('Indicator "ma" would no longer produce "ma5" (read by alert "on-key").');
    expect(() => {
      chart.series.remove('cmp');
    }).toThrow('"cmp" is read by alert "on-series"; remove it first.');

    chart.alerts.remove('on-key');
    // The first output, whatever its key, survives new parameters.
    chart.indicators.update('ma', { params: { periods: [10] } });
    expect(chart.indicators.get('ma')?.params).toEqual({ periods: [10] });
  });

  it('select only the objects of the modules the chart has', () => {
    const chart = createModularChart({ modules: [orders(), markers()] });
    chart.data.set(createBars(10));
    chart.orders.add({ id: 'o', side: 'buy', price: 100 });
    chart.select({ kind: 'order', id: 'o' });

    expect(chart.selection()).toEqual({ kind: 'order', id: 'o' });
    expect(() => {
      chart.select({ kind: 'drawing', id: 'd' });
    }).toThrow('selection.kind must be one of');
  });

  it('of applications register their types before the options use them', () => {
    const dots = createModule({
      name: 'dots',
      install: (chart) => {
        chart.series.register({ ...lineSeries, type: 'dots' });
        return { dots: { count: () => chart.data.length } };
      }
    });
    const chart = createModularChart({ modules: [dots], mainSeries: { type: 'dots' as never } });
    chart.data.set(createBars(5));

    expect(chart.modules()).toEqual(['dots']);
    expect(chart.options().mainSeries.type).toBe('dots');
    expect(chart.dots.count()).toBe(5);
  });

  it('of applications add no namespace the chart has, and leave nothing behind when they fail', () => {
    const clash = createModule({ name: 'clash', install: () => ({ data: {} }) });
    const container = testContainer();

    expect(() => createChart(container, { modules: [clash] })).toThrow(
      'The clash module adds chart.data, which the chart has already.'
    );
    expect(container.childElementCount).toBe(0);
    expect(() => createModule({ name: '', install: () => undefined })).toThrow(
      'needs the name of the module'
    );
    expect(() => createModule({ name: 'x', install: 1 as never })).toThrow(
      'needs an install() function'
    );
  });

  it('of applications add options of their own, which they read and follow', () => {
    const changes: Array<[string, string]> = [];
    const stamp = createModule<{
      readonly api: { readonly stamp: { text(): string } };
      readonly options: { readonly stamp: { readonly text: string } };
    }>({
      name: 'stamp',
      options: {
        key: 'stamp',
        defaults: () => ({ text: 'A' }),
        validate: (section, label) => {
          if (section.text.length > 3) {
            throw new Error(`${label}.text is too long.`);
          }
        }
      },
      install: (chart, context) => {
        chart.on('optionsChange', ({ options, previous }) => {
          const now = (options as unknown as { stamp: { text: string } }).stamp.text;
          const before = (previous as unknown as { stamp: { text: string } }).stamp.text;
          changes.push([before, now]);
        });
        return { stamp: { text: () => context.options().text } };
      }
    });
    const chart = createModularChart({ modules: [stamp], stamp: { text: 'B' } });

    expect(chart.stamp.text()).toBe('B');
    chart.applyOptions({ stamp: { text: 'C' } });
    expect(chart.stamp.text()).toBe('C');
    expect(() => {
      chart.applyOptions({ stamp: { text: 'DDDD' } });
    }).toThrow('options.stamp.text is too long.');
    expect(chart.options().stamp.text).toBe('C');
    expect(changes).toEqual([['B', 'C']]);
  });

  it('of applications emit events of their own, as the chart does', () => {
    const pings = createModule<{
      readonly api: { readonly pings: { ping(count: number): void } };
      readonly events: { readonly ping: { readonly count: number } };
    }>({
      name: 'pings',
      install: (_chart, context) => ({
        pings: {
          ping: (count) => {
            context.emit('ping', { count });
          }
        }
      })
    });
    const chart = createModularChart({ modules: [pings] });
    const heard: number[] = [];
    chart.on('ping', ({ count }) => {
      heard.push(count);
    });
    chart.pings.ping(2);

    expect(heard).toEqual([2]);
  });

  it('of applications keep a part of the state, loaded whole or not at all', () => {
    let notes: string[] = [];
    const notebook = createModule<{
      readonly api: { readonly notes: { add(note: string): void; list(): string[] } };
      readonly state: { readonly notes?: readonly string[] };
    }>({
      name: 'notebook',
      install: (_chart, context) => {
        context.keepState({
          key: 'notes',
          save: () => [...notes],
          read: (saved, label) => {
            if (!Array.isArray(saved) || saved.some((note) => typeof note !== 'string')) {
              throw new Error(`${label} must be a list of notes.`);
            }

            return saved as string[];
          },
          load: (state) => {
            notes = state ? [...state] : [];
          }
        });
        return {
          notes: {
            add: (note) => {
              notes.push(note);
            },
            list: () => [...notes]
          }
        };
      }
    });
    const chart = createModularChart({ modules: [notebook] });
    chart.notes.add('first');
    const saved = chart.saveState();

    expect(saved.notes).toEqual(['first']);
    chart.notes.add('second');
    const view = chart.saveState().view;
    expect(() => {
      chart.loadState({ ...saved, notes: [1] });
    }).toThrow('state.notes must be a list of notes.');
    expect(chart.notes.list()).toEqual(['first', 'second']);
    expect(chart.saveState().view).toEqual(view);
    chart.loadState(saved);
    expect(chart.notes.list()).toEqual(['first']);
    const without = structuredClone(saved);
    Reflect.deleteProperty(without, 'notes');
    chart.loadState(without);
    expect(chart.notes.list()).toEqual([]);
  });

  it('of applications keep no part the chart or another module keeps, nor read options they lack', () => {
    const keeping = (name: string, key: string) =>
      createModule<{ readonly state: Readonly<Record<string, boolean>> }>({
        name,
        install: (_chart, context) => {
          context.keepState({ key, save: () => true, read: () => true, load: () => undefined });
        }
      });
    const reading = createModule({
      name: 'reading',
      install: (_chart, context) => {
        context.options();
      }
    });

    expect(() => createModularChart({ modules: [keeping('views', 'view')] })).toThrow(
      'The views module keeps "view" of the state, which the chart keeps already.'
    );
    expect(() =>
      createModularChart({ modules: [keeping('one', 'notes'), keeping('two', 'notes')] })
    ).toThrow('The two module keeps "notes" of the state');
    expect(() => createModularChart({ modules: [reading] })).toThrow(
      'The reading module has no options.'
    );
  });

  it('are all in allModules', () => {
    expect(createModularChart({ modules: allModules() }).modules()).toEqual([
      'indicators',
      'drawings',
      'chartTypes',
      'alerts',
      'orders',
      'markers',
      'replay',
      'volumeProfiles',
      'watermark'
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { ChartError } from '../../src/utils/errors';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, type Chart } from '../helpers/chart';

/** What every collection of the chart offers, its inputs and items as loose as they all are. */
interface Members {
  set(inputs: readonly object[]): void;
  add(input: object): string;
  update(id: string, patch: object): void;
  remove(id: string): void;
  clear(): void;
  get(id: string): { readonly id: string } | null;
  list(): Array<{ readonly id: string }>;
}

interface Case {
  readonly name: string;
  /** What the chart numbers the ids of the input with, as `prefix-1`. */
  readonly prefix: string;
  readonly members: (chart: Chart) => Members;
  /** A valid input without an id. */
  readonly input: object;
  readonly invalid: object;
}

const cases: readonly Case[] = [
  {
    name: 'orders',
    prefix: 'order',
    members: (chart) => chart.orders,
    input: { side: 'buy', price: 100 },
    invalid: { side: 'buy', price: Number.NaN }
  },
  {
    name: 'markers',
    prefix: 'marker',
    members: (chart) => chart.markers,
    input: { time: T0 + 10 * MINUTE, position: 'above', shape: 'circle' },
    invalid: { time: T0 + 10 * MINUTE, position: 'nowhere', shape: 'circle' }
  },
  {
    name: 'alerts',
    prefix: 'alert',
    members: (chart) => chart.alerts,
    input: { trigger: 'cross', value: 100 },
    invalid: { trigger: 'cross', value: [90, 110] }
  },
  {
    name: 'drawings',
    prefix: 'trend-line',
    members: (chart) => chart.drawings,
    input: {
      type: 'trend-line',
      points: [
        { time: T0 + 10 * MINUTE, price: 100 },
        { time: T0 + 20 * MINUTE, price: 110 }
      ]
    },
    invalid: { type: 'trend-line', points: [] }
  },
  {
    name: 'indicators',
    prefix: 'ma',
    members: (chart) => chart.indicators,
    input: { type: 'MA' },
    invalid: { type: 'MISSING' }
  },
  {
    name: 'series',
    prefix: 'line',
    members: (chart) => chart.series,
    input: { type: 'line' },
    invalid: { type: 'missing' }
  },
  {
    name: 'volume profiles',
    prefix: 'volume-profile',
    members: (chart) => chart.volumeProfiles,
    input: { mode: 'visible' },
    invalid: { mode: 'nowhere' }
  }
];

const ids = (collection: Members) => collection.list().map((item) => item.id);

describe.each(cases)('$name', ({ prefix, members, input, invalid }) => {
  it('numbers what is added without an id and keeps an id given', () => {
    const collection = members(chartWithBars());

    expect(collection.add(input)).toBe(`${prefix}-1`);
    expect(collection.add({ ...input, id: 'mine' })).toBe('mine');
    expect(collection.add(input)).toBe(`${prefix}-2`);
    expect(collection.get('mine')?.id).toBe('mine');
    expect(collection.get('missing')).toBeNull();
    expect(ids(collection)).toEqual([`${prefix}-1`, 'mine', `${prefix}-2`]);
  });

  it('never numbers an id twice', () => {
    const collection = members(chartWithBars());
    collection.add({ ...input, id: `${prefix}-4` });
    collection.remove(`${prefix}-4`);

    expect(collection.add(input)).toBe(`${prefix}-5`);

    collection.set([input, { ...input, id: `${prefix}-7` }]);

    expect(ids(collection)).toEqual([`${prefix}-8`, `${prefix}-7`]);
  });

  it('sets every item at once, and nothing for an invalid input', () => {
    const collection = members(chartWithBars());
    collection.add(input);
    collection.set([
      { ...input, id: 'a' },
      { ...input, id: 'b' }
    ]);

    expect(ids(collection)).toEqual(['a', 'b']);
    expect(() => {
      collection.set([input, invalid]);
    }).toThrow(ChartError);
    expect(() => {
      collection.set([
        { ...input, id: 'c' },
        { ...input, id: 'c' }
      ]);
    }).toThrow(ChartError);
    expect(ids(collection)).toEqual(['a', 'b']);
    expect(collection.add(input)).toBe(`${prefix}-2`);
  });

  it('clears every item', () => {
    const collection = members(chartWithBars());
    collection.add(input);
    collection.add(input);
    collection.clear();

    expect(collection.list()).toEqual([]);
  });

  it('throws for an unknown id', () => {
    const collection = members(chartWithBars());

    expect(() => {
      collection.update('missing', {});
    }).toThrow(ChartError);
    expect(() => {
      collection.remove('missing');
    }).toThrow(ChartError);
  });
});

describe('panes', () => {
  it('numbers what is added without an id and keeps an id given', () => {
    const chart = chartWithBars();

    expect(chart.panes.add({ height: 100 })).toBe('pane-1');
    expect(chart.panes.add({ id: 'mine' })).toBe('mine');
    expect(chart.panes.add({})).toBe('pane-2');
    expect(chart.panes.get('missing')).toBeNull();
    expect(chart.panes.list().map((pane) => pane.id)).toEqual(['main', 'pane-1', 'mine', 'pane-2']);
  });

  it('never numbers an id twice, after a loaded state too', () => {
    const chart = chartWithBars();
    chart.panes.add({ id: 'pane-4' });
    chart.panes.remove('pane-4');

    expect(chart.panes.add({})).toBe('pane-5');

    const other = chartWithBars();
    other.loadState(chart.saveState());

    expect(other.panes.add({})).toBe('pane-6');
  });

  it('throws for an unknown id, and for the main pane', () => {
    const chart = chartWithBars();

    expect(() => {
      chart.panes.update('missing', {});
    }).toThrow(ChartError);
    expect(() => {
      chart.panes.remove('missing');
    }).toThrow(ChartError);
    expect(() => {
      chart.panes.remove('main');
    }).toThrow('The main pane cannot be removed.');
  });
});

describe('indicators and series set at once', () => {
  it('read an indicator before them', () => {
    const chart = chartWithBars();
    chart.indicators.set([
      { id: 'ma', type: 'MA' },
      { type: 'MA', source: { kind: 'indicator', id: 'ma' } }
    ]);

    expect(chart.indicators.list().map((indicator) => indicator.source)).toEqual([
      'close',
      { kind: 'indicator', id: 'ma' }
    ]);
  });

  it('get panes of their own, those of the ones gone go', () => {
    const chart = chartWithBars();
    chart.indicators.add({ type: 'RSI' });
    chart.series.add({ type: 'line', pane: 'new' });
    chart.indicators.set([{ type: 'RSI' }, { type: 'MA', pane: 'rsi-1' }]);
    chart.series.set([{ id: 'line-1', type: 'line', pane: 'new', data: [{ time: T0, value: 1 }] }]);

    expect(chart.panes.list().map((pane) => pane.id)).toEqual(['main', 'rsi-1', 'rsi-2', 'line-1']);
    expect(chart.indicators.list().map((indicator) => indicator.pane)).toEqual(['rsi-2', 'rsi-1']);
    expect(chart.series.list().map((series) => series.pane)).toEqual(['line-1']);

    chart.indicators.clear();
    chart.series.clear();

    expect(chart.panes.list().map((pane) => pane.id)).toEqual(['main']);
  });

  it('must keep what an alert reads', () => {
    const chart = chartWithBars();
    chart.indicators.add({ id: 'rsi', type: 'RSI' });
    chart.series.add({ id: 'eth', type: 'line', data: [{ time: T0, value: 1 }] });
    chart.alerts.add({ source: { kind: 'indicator', id: 'rsi' }, trigger: 'cross', value: 50 });
    chart.alerts.add({ source: { kind: 'series', id: 'eth' }, trigger: 'cross', value: 1 });

    expect(() => {
      chart.indicators.clear();
    }).toThrow('unknown indicator "rsi"');
    expect(() => {
      chart.series.set([{ id: 'btc', type: 'line' }]);
    }).toThrow('unknown series "eth"');
    expect(chart.indicators.list().map((indicator) => indicator.id)).toEqual(['rsi']);
    expect(chart.series.list().map((series) => series.id)).toEqual(['eth']);

    chart.indicators.set([{ id: 'rsi', type: 'RSI', params: { period: 7 } }]);
    chart.series.set([{ id: 'eth', type: 'area' }]);

    expect(chart.indicators.get('rsi')?.params).toMatchObject({ period: 7 });
    expect(chart.series.get('eth')?.type).toBe('area');
  });
});

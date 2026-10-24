import { describe, expect, it } from 'vitest';
import type { ChartState } from '../../src/chart/state';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars } from '../helpers/chart';

describe('saveState / loadState', () => {
  it('restores the layout on another chart', () => {
    const source = chartWithBars(300);
    source.applyOptions({ mainSeries: { type: 'line' } });
    const macd = source.indicators.add({ type: 'MACD', params: { fast: 8 } });
    source.panes.update(macd, { height: 150 });
    source.priceScale().setMode('log');
    source.timeScale.scrollToIndex(120, 'center');
    source.drawings.add({
      type: 'horizontal-line',
      points: [{ time: T0 + 100 * MINUTE, price: 150 }]
    });
    const state = source.saveState();

    const target = chartWithBars(300);
    target.loadState(state);

    expect(target.saveState()).toEqual(state);
    expect(target.indicators.get(macd)?.params).toEqual({
      fast: 8,
      slow: 26,
      signal: 9,
      oscillatorType: 0,
      signalType: 0
    });
    expect(target.priceScale().mode()).toBe('log');
    expect(target.timeScale.visibleRange()).toEqual(source.timeScale.visibleRange());
    expect(target.options().mainSeries.type).toBe('line');
  });

  it('keeps the transform building the bars', () => {
    const source = chartWithBars(300);
    source.transforms.set({ type: 'renko', params: { box: 2 } });
    const state = source.saveState();

    expect(state.transform).toEqual({ type: 'renko', params: { box: 2 }, input: 'bars' });

    const target = chartWithBars(300);
    target.loadState(state);

    expect(target.transforms.get()).toMatchObject({ type: 'renko', params: { box: 2 } });
    expect(target.data.toArray()).toEqual(source.data.toArray());

    target.loadState({ ...state, transform: null });
    expect(target.transforms.get()).toBeNull();
  });

  it('leaves the transform as it is for a state without one', () => {
    const chart = chartWithBars(300);
    chart.transforms.set({ type: 'heikin-ashi' });
    const state: ChartState = { ...chart.saveState() };
    delete (state as { transform?: unknown }).transform;

    chart.loadState(state);

    expect(chart.transforms.get()?.type).toBe('heikin-ashi');
  });

  it('rejects a transform it cannot build and changes nothing', () => {
    const chart = chartWithBars(300);
    chart.indicators.add({ type: 'RSI' });
    const before = chart.saveState();

    expect(() => {
      chart.loadState({
        ...before,
        indicators: [],
        transform: { type: 'renko', params: { box: -1 } }
      });
    }).toThrow();
    expect(() => {
      chart.loadState({ ...before, transform: { type: 'nope' } });
    }).toThrow('nope');
    expect(chart.saveState()).toEqual(before);
  });

  it('survives JSON serialization', () => {
    const chart = chartWithBars(100);
    chart.indicators.add({ type: 'BOLL' });
    const state = JSON.parse(JSON.stringify(chart.saveState())) as ChartState;

    expect(() => {
      chart.loadState(state);
    }).not.toThrow();
  });

  it('rejects an invalid state and leaves the chart unchanged', () => {
    const chart = chartWithBars(100);
    chart.indicators.add({ type: 'RSI' });
    const before = chart.saveState();
    const broken = {
      ...before,
      indicators: [...before.indicators, { ...before.indicators[0]!, id: 'x', type: 'NOPE' }]
    };

    expect(() => {
      chart.loadState(broken);
    }).toThrow('Unknown indicator type "NOPE"');
    expect(chart.saveState()).toEqual(before);
    expect(() => {
      chart.loadState({ ...before, version: 2 as 1 });
    }).toThrow('version 1');
  });

  it('keeps series and alerts that the state does not own', () => {
    const chart = chartWithBars(100);
    chart.series.add({
      id: 'cmp',
      type: 'line',
      data: createBars(100).map((bar) => ({ time: bar.time, value: bar.close }))
    });
    chart.alerts.add({ id: 'a', trigger: 'cross', value: 120 });
    chart.loadState(chart.saveState());

    expect(chart.series.get('cmp')).not.toBeNull();
    expect(chart.alerts.get('a')).not.toBeNull();
  });

  it('restores a manual range together with the scale mode it was set in', () => {
    const source = chartWithBars(300);
    source.priceScale().setMode('log');
    source.priceScale().setRange({ min: 120, max: 200 });
    const state = JSON.parse(JSON.stringify(source.saveState())) as ChartState;

    const target = chartWithBars(300);
    target.loadState(state);
    const range = target.priceScale().range();

    expect(target.priceScale().mode()).toBe('log');
    expect(target.priceScale().isAutoScale()).toBe(false);
    expect(range?.min).toBeCloseTo(120, 6);
    expect(range?.max).toBeCloseTo(200, 6);
  });

  it('rejects a state that is not an object', () => {
    const chart = chartWithBars(10);

    expect(() => {
      chart.loadState(null as unknown as ChartState);
    }).toThrow('state must be an object, received null');
  });

  it('names what a state is missing', () => {
    const chart = chartWithBars(10);
    const { mainSeries, panes, view, ...rest } = chart.saveState();
    const missing = (state: object) => () => {
      chart.loadState(state as ChartState);
    };

    expect(missing({ ...rest, panes, view })).toThrow('state.mainSeries must be an object');
    expect(missing({ ...rest, mainSeries, view })).toThrow('state.panes must be an array');
    expect(missing({ ...rest, mainSeries, panes })).toThrow('state.view must be an object');
    expect(missing({ ...rest, mainSeries, view, panes: [...panes, null] })).toThrow(
      'state.panes[1] must be an object'
    );
  });
});

import { describe, expect, it } from 'vitest';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars } from '../helpers/chart';

/** A trend line, with the id given or one the chart numbers. */
const line = (id?: string) => ({
  ...(id === undefined ? {} : { id }),
  type: 'trend-line',
  points: [
    { time: T0 + 10 * MINUTE, price: 100 },
    { time: T0 + 20 * MINUTE, price: 110 }
  ]
});

describe('generated ids', () => {
  it('never name a new drawing as one gone, after drawings were set', () => {
    const chart = chartWithBars();
    chart.drawings.set([line('trend-line-1'), line('trend-line-2')]);
    chart.drawings.remove('trend-line-2');

    expect(chart.drawings.add(line())).toBe('trend-line-3');
  });

  it('never name a drawing set without an id as one gone', () => {
    const chart = chartWithBars();
    chart.drawings.add(line());
    chart.drawings.remove('trend-line-1');
    chart.drawings.set([line()]);

    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual(['trend-line-2']);
  });

  it('number what a list brings without ids after the ids it gives', () => {
    const chart = chartWithBars();
    chart.drawings.set([line(), line('trend-line-1')]);

    expect(chart.drawings.list().map((drawing) => drawing.id)).toEqual([
      'trend-line-2',
      'trend-line-1'
    ]);
  });

  it('take no number for what fails to be added', () => {
    const chart = chartWithBars();

    expect(() => chart.drawings.add({ ...line(), points: [] })).toThrow('needs 2 points');
    expect(() => chart.series.add({ type: 'line', data: [{ time: T0 } as never] })).toThrow(
      'needs { time, value } points'
    );
    expect(chart.drawings.add(line())).toBe('trend-line-1');
    expect(chart.series.add({ type: 'line' })).toBe('line-1');
  });

  it('go on after the ids of a loaded state', () => {
    const chart = chartWithBars();
    chart.drawings.add(line());
    chart.indicators.add({ type: 'RSI', pane: 'new' });
    chart.volumeProfiles.add({ mode: 'visible' });
    const saved = chart.saveState();
    const other = chartWithBars();
    other.loadState({
      ...saved,
      drawings: [line('trend-line-5')],
      volumeProfiles: [{ id: 'volume-profile-4', mode: 'session' }]
    });
    other.drawings.remove('trend-line-5');
    other.volumeProfiles.remove('volume-profile-4');

    expect(other.drawings.add(line())).toBe('trend-line-6');
    expect(other.volumeProfiles.add({ mode: 'visible' })).toBe('volume-profile-5');
    expect(other.indicators.add({ type: 'RSI', pane: 'new' })).toBe('rsi-2');
  });

  it('go on after ids given to what is added', () => {
    const chart = chartWithBars();
    chart.indicators.add({ id: 'ma-9', type: 'MA' });
    chart.indicators.remove('ma-9');
    chart.series.add({ id: 'line-3', type: 'line' });
    chart.series.remove('line-3');

    expect(chart.indicators.add({ type: 'MA' })).toBe('ma-10');
    expect(chart.series.add({ type: 'line' })).toBe('line-4');
  });
});

import { describe, expect, it } from 'vitest';
import { checkColor } from '../../src';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';

/** A color misspelled, which no canvas paints. */
const BAD = 'reed';

describe('colors', () => {
  it('are checked as the options take them, naming the field', () => {
    const chart = createTestChart();
    const up = chart.options().theme.up;

    expect(() => {
      chart.applyOptions({ theme: { up: BAD } });
    }).toThrow('options.theme.up must be a CSS color, not "reed".');
    expect(() => {
      chart.applyOptions({ theme: { palette: ['#123456', BAD] } });
    }).toThrow('options.theme.palette[1] must be a CSS color');
    expect(() => {
      chart.applyOptions({ latestPrice: { color: BAD } });
    }).toThrow('options.latestPrice.color must be a CSS color');
    expect(() => {
      chart.applyOptions({ panes: { separatorColor: BAD } });
    }).toThrow('options.panes.separatorColor must be a CSS color');
    expect(() => {
      chart.applyOptions({ mainSeries: { styles: { candles: { upColor: BAD } } } });
    }).toThrow('options.mainSeries.styles.candles.upColor must be a CSS color');
    expect(chart.options().theme.up).toBe(up);
  });

  it('take hex, rgb() and rgba()', () => {
    const chart = createTestChart();
    chart.applyOptions({
      theme: { up: '#0a0', down: 'rgb(200, 0, 0)', accent: 'rgba(0, 0, 255, 0.5)', grid: '#1234' }
    });

    expect(chart.options().theme).toMatchObject({ up: '#0a0', down: 'rgb(200, 0, 0)' });
  });

  it('are checked as what the chart draws takes them, before it draws them', () => {
    const chart = chartWithBars();
    const points = [
      { time: T0 + 10 * MINUTE, price: 100 },
      { time: T0 + 20 * MINUTE, price: 110 }
    ];
    const cases: Array<[() => unknown, string]> = [
      [
        () => chart.drawings.add({ type: 'trend-line', points, style: { color: BAD } }),
        'style.color'
      ],
      [
        () =>
          chart.drawings.add({
            type: 'fib-retracement',
            points,
            style: { levels: [{ value: 0.5, color: BAD }] }
          }),
        'levels[0].color'
      ],
      [() => chart.indicators.add({ type: 'RSI', colors: { rsi: BAD } }), 'colors'],
      [() => chart.series.add({ type: 'line', style: { color: BAD } }), 'series.style.color'],
      [() => chart.volumeProfiles.add({ mode: 'visible', upColor: BAD }), 'upColor'],
      [
        () => {
          chart.orders.add({ id: 'order', price: 100, side: 'buy', color: BAD });
        },
        'color'
      ],
      [
        () => {
          chart.markers.add({
            id: 'marker',
            time: T0,
            position: 'above',
            shape: 'circle',
            color: BAD
          });
        },
        'color'
      ],
      [
        () => {
          chart.alerts.add({ id: 'alert', trigger: 'cross', value: 100, color: BAD });
        },
        'color'
      ]
    ];

    for (const [add, field] of cases) {
      expect(add).toThrow(field);
      expect(add).toThrow('must be a CSS color, not "reed".');
    }

    expect(chart.drawings.list()).toEqual([]);
    expect(chart.indicators.list()).toEqual([]);
    expect(chart.series.list()).toEqual([]);
    expect(chart.volumeProfiles.list()).toEqual([]);
    expect(chart.orders.list()).toEqual([]);
    expect(chart.markers.list()).toEqual([]);
    expect(chart.alerts.list()).toEqual([]);
  });

  it('are checked for an application as the chart checks them', () => {
    expect(checkColor('panel.color', '#2962ff')).toBe('#2962ff');
    expect(() => checkColor('panel.color', BAD)).toThrow(
      'panel.color must be a CSS color, not "reed".'
    );
  });
});

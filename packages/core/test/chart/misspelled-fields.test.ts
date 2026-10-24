import { describe, expect, it } from 'vitest';
import { createChart } from '../../src';
import { trendLine } from '../../src/drawings';
import { drawingLevels } from '../../src/drawings/headless';
import { createCalendar } from '../../src/feed/calendar';
import { RSI } from '../../src/indicators';
import { checkIndicatorInput } from '../../src/indicators/input';
import { createIndicatorCalculator } from '../../src/indicators/headless';
import { computeVolumeProfile, fixedRangeVolumeProfile } from '../../src/volume-profile';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart, testContainer } from '../helpers/chart';

/** Passes an input with a misspelled field, as code without types would. */
function misspelled(input: object): never {
  return input as never;
}

describe('misspelled fields', () => {
  it('rejects a field an indicator, its patch, styles or source lacks', () => {
    const chart = chartWithBars();
    const id = chart.indicators.add({ type: 'RSI' });

    expect(() => chart.indicators.add(misspelled({ type: 'RSI', parmas: { period: 7 } }))).toThrow(
      'indicator has no field "parmas"'
    );
    expect(() => {
      chart.indicators.update(id, misspelled({ visibel: false }));
    }).toThrow('patch has no field "visibel"');
    expect(() => {
      chart.indicators.update(id, { styles: { rsi: misspelled({ linewidth: 2 }) } });
    }).toThrow('styles.rsi has no field "linewidth"');
    expect(() =>
      chart.indicators.add({ type: 'RSI', source: misspelled({ kind: 'indicator', ID: id }) })
    ).toThrow('indicator.source has no field "ID"');
    expect(() => {
      checkIndicatorInput(RSI, misspelled({ type: 'RSI', level: [30] }));
    }).toThrow('indicator has no field "level"');
  });

  it('rejects a field a series, its patch or its type’s style lacks', () => {
    const chart = chartWithBars();
    const id = chart.series.add({ type: 'line' });

    expect(() => chart.series.add(misspelled({ type: 'line', colour: '#f00' }))).toThrow(
      'series has no field "colour"'
    );
    expect(() => {
      chart.series.update(id, misspelled({ titel: 'BTC' }));
    }).toThrow('series patch has no field "titel"');
    expect(() => {
      chart.series.update(id, { style: { colour: '#f00' } });
    }).toThrow('series.style has no field "colour"');
    expect(chart.series.list()).toHaveLength(1);
  });

  it('rejects a field a pane, its patch or the margins of a scale lack', () => {
    const chart = chartWithBars();
    chart.panes.add({ id: 'lower' });

    expect(() => {
      chart.panes.add(misspelled({ id: 'other', hieght: 100 }));
    }).toThrow('pane has no field "hieght"');
    expect(() => {
      chart.panes.update('lower', misspelled({ id: 'renamed' }));
    }).toThrow('pane patch has no field "id"');
    expect(() => {
      chart.priceScale().setMargins(misspelled({ top: 0.1, botom: 0.1 }));
    }).toThrow('margins has no field "botom"');
  });

  it('rejects a field an order, a marker, an alert, a button or a value source lacks', () => {
    const chart = chartWithBars();

    expect(() => {
      chart.orders.set([misspelled({ id: 'o', price: 100, side: 'buy', qty: 1 })]);
    }).toThrow('orders[0] has no field "qty"');
    expect(() => {
      chart.orders.add({
        id: 'o',
        price: 100,
        side: 'buy',
        buttons: [misspelled({ id: 'x', txt: '✕' })]
      });
    }).toThrow('order.buttons[0] has no field "txt"');
    expect(() => {
      chart.markers.add(
        misspelled({ id: 'm', time: T0, position: 'above', shape: 'circle', colour: '#f00' })
      );
    }).toThrow('marker has no field "colour"');
    expect(() => {
      chart.alerts.add(misspelled({ id: 'a', trigger: 'above', value: 100, frequncy: 'once' }));
    }).toThrow('alert has no field "frequncy"');
    expect(() => {
      chart.alerts.add({
        id: 'a',
        trigger: 'above',
        value: 100,
        source: misspelled({ kind: 'price', feild: 'high' })
      });
    }).toThrow('alert.source has no field "feild"');
  });

  it('rejects a field the options of data, transforms, replay or the crosshair lack', () => {
    const chart = createTestChart();

    expect(() => {
      chart.data.set([], misspelled({ intervel: '1m' }));
    }).toThrow('data.set() options has no field "intervel"');
    chart.data.set([{ time: T0, open: 1, high: 2, low: 0.5, close: 1.5 }], { interval: '1m' });
    expect(() => {
      chart.transforms.set(misspelled({ type: 'heikin-ashi', parms: {} }));
    }).toThrow('transform has no field "parms"');
    expect(() => {
      chart.replay.configure(misspelled({ sped: 2 }));
    }).toThrow('replay settings has no field "sped"');
    expect(() => {
      chart.crosshair.set(misspelled({ time: T0 + MINUTE, value: 1 }));
    }).toThrow('crosshair position has no field "value"');
  });

  it('rejects a field a section of the chart options lacks', () => {
    expect(() => createChart(testContainer(), { crosshair: misspelled({ mdoe: 'free' }) })).toThrow(
      'options.crosshair has no field "mdoe"'
    );

    const chart = createTestChart();

    expect(() => {
      chart.applyOptions({ theme: misspelled({ backgroud: '#000' }) });
    }).toThrow('options.theme has no field "backgroud"');
    expect(() => {
      chart.applyOptions({ priceScale: { margins: misspelled({ topp: 0.1 }) } });
    }).toThrow('options.priceScale.margins has no field "topp"');
    expect(() => {
      chart.applyOptions({ drawings: misspelled({ magent: 'weak' }) });
    }).toThrow('options.drawings has no field "magent"');
  });

  it('rejects a field a volume profile, its patch or the options of its drawing type lack', () => {
    const chart = chartWithBars();
    const id = chart.volumeProfiles.add({ mode: 'visible' });

    expect(() => chart.volumeProfiles.add(misspelled({ mode: 'session', row: 12 }))).toThrow(
      'volumeProfile has no field "row"'
    );
    expect(() => {
      chart.volumeProfiles.update(id, misspelled({ visibel: false }));
    }).toThrow('volumeProfile patch has no field "visibel"');
    expect(() => {
      chart.volumeProfiles.update(id, misspelled({ id: 'other' }));
    }).toThrow('volumeProfile patch has no field "id"');
    expect(() => fixedRangeVolumeProfile(misspelled({ widht: 0.5 }))).toThrow(
      'fixedRangeVolumeProfile() options has no field "widht"'
    );
    expect(chart.volumeProfiles.list()).toHaveLength(1);
  });

  it('rejects a field the options of code without a chart lack', () => {
    expect(() => createCalendar(misspelled({ timezone: 'UTC' }))).toThrow(
      'calendar has no field "timezone"'
    );
    expect(() => createIndicatorCalculator(RSI, misspelled({ param: { period: 7 } }))).toThrow(
      'options has no field "param"'
    );
    expect(() =>
      drawingLevels(
        trendLine,
        {
          points: [
            { time: T0, price: 1 },
            { time: T0 + MINUTE, price: 2 }
          ]
        },
        undefined,
        misspelled({ scael: 'log' })
      )
    ).toThrow('options has no field "scael"');
    expect(() => computeVolumeProfile([], 0, 0, misspelled({ value: 0.7 }))).toThrow(
      'options has no field "value"'
    );
  });
});

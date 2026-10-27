import { describe, expect, it } from 'vitest';
import { createAlertEngine } from '../src/alert-engine';
import type { AlertTriggerEvent } from '../src/alerts';
import { trendLine } from '../src/drawings';
import { RSI } from '../src/indicators';

// Runs in Node, without a DOM, as a server evaluates alerts: importing the alerts and evaluating
// them on the price, an indicator and the line of a drawing must not need one.

const MINUTE = 60_000;
const T0 = Date.UTC(2024, 0, 2, 9, 30);

describe('alerts evaluated in Node', () => {
  it('has no browser around', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('builds the timeframe from trades and fires on the price, an indicator and a drawing', () => {
    const engine = createAlertEngine({ indicators: [RSI], drawings: [trendLine] });
    const heard: AlertTriggerEvent[] = [];
    engine.on('alertTrigger', (event) => heard.push(event));
    // Three hours of minutes, falling from 120 to 100: enough for the RSI of the bars of 5m.
    engine.data.set(
      Array.from({ length: 180 }, (_, index) => {
        const close = 120 - index / 9;
        return { time: T0 + index * MINUTE, open: close, high: close, low: close, close };
      }),
      { interval: '1m' }
    );
    engine.data.setTimeframe('5m');
    expect(engine.data.length).toBe(36);
    engine.indicators.add({ id: 'rsi', type: 'RSI' });
    engine.drawings.add({
      id: 'line',
      type: 'trend-line',
      points: [
        { time: T0, price: 110 },
        { time: T0 + 240 * MINUTE, price: 110 }
      ]
    });
    engine.alerts.set([
      { id: 'price', trigger: 'cross-up', value: 105 },
      { id: 'rsi', source: { kind: 'indicator', id: 'rsi' }, trigger: 'cross-up', value: 50 },
      { id: 'line', trigger: 'cross-up', value: { kind: 'drawing', id: 'line' } }
    ]);

    // Trades lift the price past 105 and the line, into the bar of 12:30.
    const at = T0 + 180 * MINUTE;
    expect(engine.data.addTrades([{ time: at + 1000, price: 106, size: 1 }])).toBe(1);
    expect(heard.map((event) => event.id)).toEqual(['price']);
    engine.data.addTrades([{ time: at + 2000, price: 125, size: 1 }]);

    expect(heard.map((event) => event.id)).toEqual(['price', 'rsi', 'line']);
    expect(heard[0]).toMatchObject({ time: at, value: 106, threshold: 105, replay: false });
    expect(heard[2]).toMatchObject({ time: at, value: 125 });
    expect(engine.data.length).toBe(37);
    expect(engine.indicators.valuesAt('rsi')[0]?.value).toBeGreaterThan(50);
  });
});

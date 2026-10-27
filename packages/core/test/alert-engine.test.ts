import { describe, expect, it } from 'vitest';
import { createAlertEngine, type AlertEngine } from '../src/alert-engine';
import type { AlertFrequency, AlertInput, AlertTriggerEvent } from '../src/alerts/types';
import type { Bar, TradeInput, ValueSource } from '../src/data/types';
import { allDrawings } from '../src/drawings';
import type { DrawingInput } from '../src/drawings/types';
import { allIndicators } from '../src/indicators';
import { MINUTE, T0 } from './helpers/bars';
import { createTestChart, type Chart } from './helpers/chart';

/** Numbers that look random and are the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bars of a minute walking from 100, starting at `start`. */
function walk(next: () => number, count: number, start: number, from = 100): Bar[] {
  let close = from;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = Math.max(1, open + (next() - 0.5) * 2);
    return {
      time: start + index * MINUTE,
      open,
      high: Math.max(open, close) + next() * 0.5,
      low: Math.min(open, close) - next() * 0.5,
      close,
      volume: 10 + Math.round(next() * 100)
    };
  });
}

const FREQUENCIES: readonly AlertFrequency[] = [
  'once',
  'once-per-bar',
  'once-per-bar-close',
  'every-time'
];

/** Alerts of every trigger and frequency on the price, an indicator and the lines of drawings. */
function alertsOf(target: AlertEngine | Chart, level: number): AlertInput[] {
  const lines = (id: string) => target.drawings.levels(id);
  const [top, bottom] = lines('box');
  const [base, parallel] = lines('channel');
  const watched: ReadonlyArray<{ source: ValueSource; value: number | ValueSource }> = [
    { source: { kind: 'price' }, value: level },
    { source: { kind: 'price', field: 'high' }, value: level + 0.5 },
    { source: { kind: 'indicator', id: 'rsi' }, value: 50 },
    { source: { kind: 'price' }, value: { kind: 'indicator', id: 'ma' } },
    { source: { kind: 'price' }, value: { kind: 'drawing', id: 'trend' } },
    { source: { kind: 'price' }, value: { kind: 'drawing', id: 'flat' } }
  ];
  const channels: ReadonlyArray<AlertInput['value']> = [
    [level - 1, level + 1],
    [
      { kind: 'drawing', id: 'box', ...(top === undefined ? {} : { level: top }) },
      { kind: 'drawing', id: 'box', ...(bottom === undefined ? {} : { level: bottom }) }
    ],
    [
      { kind: 'drawing', id: 'channel', ...(base === undefined ? {} : { level: base }) },
      { kind: 'drawing', id: 'channel', ...(parallel === undefined ? {} : { level: parallel }) }
    ],
    [
      { kind: 'indicator', id: 'boll', key: 'upper' },
      { kind: 'indicator', id: 'boll', key: 'lower' }
    ]
  ];
  const inputs: AlertInput[] = [];

  for (const frequency of FREQUENCIES) {
    for (const { source, value } of watched) {
      for (const trigger of ['cross', 'cross-up', 'cross-down', 'above', 'below'] as const) {
        inputs.push({ id: `a${String(inputs.length)}`, source, trigger, value, frequency });
      }
    }

    for (const value of channels) {
      for (const trigger of [
        'enter-channel',
        'exit-channel',
        'inside-channel',
        'outside-channel'
      ] as const) {
        inputs.push({ id: `a${String(inputs.length)}`, trigger, value, frequency });
      }
    }
  }

  return inputs;
}

/** The drawings the alerts watch, around the latest of `bars`. */
function drawingsOf(bars: readonly Bar[]): DrawingInput[] {
  const at = (back: number) => bars[bars.length - back] as Bar;
  const price = at(1).close;
  return [
    {
      id: 'trend',
      type: 'trend-line',
      points: [
        { time: at(120).time, price: price - 3 },
        { time: at(20).time, price: price + 1 }
      ]
    },
    { id: 'flat', type: 'horizontal-line', points: [{ time: at(10).time, price: price + 0.7 }] },
    {
      id: 'box',
      type: 'rectangle',
      points: [
        { time: at(60).time, price: price + 2 },
        { time: at(1).time, price: price - 2 }
      ]
    },
    {
      id: 'channel',
      type: 'parallel-channel',
      points: [
        { time: at(90).time, price: price - 2 },
        { time: at(30).time, price: price + 1 },
        { time: at(90).time, price: price + 1 }
      ]
    }
  ];
}

/** Does the same to a chart and to an engine; returns what each fired. */
function race(seed: number, timeframe: string | null) {
  const next = random(seed);
  const history = walk(next, 600, T0);
  const chart = createTestChart();
  const engine = createAlertEngine({ indicators: allIndicators, drawings: allDrawings });
  const targets = [chart, engine] as const;
  const fired: [AlertTriggerEvent[], AlertTriggerEvent[]] = [[], []];
  chart.on('alertTrigger', (event) => fired[0].push(event));
  engine.on('alertTrigger', (event) => fired[1].push(event));
  const both = (act: (target: AlertEngine | Chart) => void) => {
    targets.forEach(act);
  };

  both((target) => {
    target.data.set(history, { interval: '1m' });
    target.data.setTimeframe(timeframe);
    target.indicators.add({ id: 'rsi', type: 'RSI' });
    target.indicators.add({ id: 'ma', type: 'MA', params: { periods: [9] } });
    target.indicators.add({ id: 'boll', type: 'BOLL' });
    target.drawings.set(drawingsOf(history));
  });
  const level = (history[history.length - 1] as Bar).close;
  const inputs = alertsOf(engine, level);
  expect(alertsOf(chart, level)).toEqual(inputs);
  both((target) => {
    target.alerts.set(inputs);
  });

  let time = (history[history.length - 1] as Bar).time + 1000;
  let price = level;
  let oldest = history[0] as Bar;

  for (let step = 0; step < 1500; step += 1) {
    const roll = next();

    if (roll < 0.9) {
      // A trade a few seconds after the one before, a few cents off.
      time += 1000 + Math.round(next() * 9000);
      price = Math.max(1, price + (next() - 0.5) * 0.6);
      const trade: TradeInput = {
        time,
        price,
        size: 1 + next(),
        side: next() < 0.5 ? 'buy' : 'sell'
      };
      both((target) => target.data.addTrades(trade));
    } else if (roll < 0.95) {
      // The latest bar corrected, as a feed sends it again.
      const last = engine.data.source.length - 1;
      const bar = {
        time: engine.data.source.time(last),
        open: engine.data.source.open(last),
        high: Math.max(engine.data.source.high(last), price + 0.2),
        low: Math.min(engine.data.source.low(last), price - 0.2),
        close: price,
        volume: engine.data.source.volume(last) + 1
      };
      both((target) => {
        target.data.update(bar);
      });
    } else if (roll < 0.97) {
      // Older history, as scrolling back loads it.
      const older = walk(next, 50, oldest.time - 50 * MINUTE, oldest.open);
      oldest = older[0] as Bar;
      const inserted = engine.data.prepend(older);
      expect(chart.data.prepend(older)).toBe(inserted);
    } else if (roll < 0.98) {
      // A drawing moved, which no alert takes for a crossing.
      const moved = drawingsOf(engine.data.toArray()).map((drawing) => ({
        ...drawing,
        points: drawing.points.map((point) => ({ ...point, price: point.price + next() - 0.5 }))
      }));
      both((target) => {
        target.drawings.set(moved);
      });
    } else if (roll < 0.99) {
      // Alerts that fired once armed again.
      for (const alert of engine.alerts.list()) {
        if (alert.status === 'triggered') {
          both((target) => {
            target.alerts.rearm(alert.id);
          });
        }
      }
    } else {
      // A level moved, and an alert turned off and on.
      const id = `a${String(Math.floor(next() * inputs.length))}`;
      const value = price + (next() - 0.5) * 2;
      both((target) => {
        if (typeof target.alerts.get(id)?.value === 'number') {
          target.alerts.update(id, { value });
        }

        target.alerts.update(id, { enabled: false });
        target.alerts.update(id, { enabled: true });
      });
    }
  }

  return { chart, engine, fired };
}

describe('an alert engine', () => {
  it('fires exactly as a chart with the same bars, indicators and drawings, on the timeframe', () => {
    const { chart, engine, fired } = race(7, '5m');
    const [onChart, onEngine] = fired;

    // Enough of every kind to tell: the price, the indicator and each drawing.
    expect(onChart.length).toBeGreaterThan(500);
    expect(new Set(onChart.map((event) => event.trigger)).size).toBe(9);
    expect(onEngine).toEqual(onChart);
    expect(engine.alerts.list()).toEqual(chart.alerts.list());
    expect(engine.data.toArray()).toEqual(chart.data.toArray());
    expect(engine.indicators.valuesAt('boll')).toEqual(
      chart.indicators.valuesAt('boll').map(({ key, value }) => ({ key, value }))
    );
  });

  it('fires exactly as a chart on the source bars, without a timeframe', () => {
    const { fired } = race(11, null);
    expect(fired[0].length).toBeGreaterThan(500);
    expect(fired[1]).toEqual(fired[0]);
  });

  it('builds the timeframe by the trading calendar, as the chart does', () => {
    const next = random(3);
    const bars = walk(next, 300, Date.UTC(2024, 0, 2, 13, 0));
    const calendar = { timeZone: 'America/New_York', sessions: ['09:30-16:00'] };
    const chart = createTestChart({ calendar });
    const engine = createAlertEngine({ calendar });
    chart.data.set(bars, { interval: '1m' });
    engine.data.set(bars, { interval: '1m' });
    chart.data.setTimeframe('1h');
    engine.data.setTimeframe('1h');
    expect(engine.data.toArray()).toEqual(chart.data.toArray());

    // Another calendar builds them again.
    chart.applyOptions({ calendar: { timeZone: 'UTC', sessions: [] } });
    engine.setCalendar({ timeZone: 'UTC', sessions: [] });
    expect(engine.data.toArray()).toEqual(chart.data.toArray());
    const late = Date.UTC(2024, 0, 2, 22, 15);
    expect(engine.data.calendar().bucket(late, '1h')).toBe(Date.UTC(2024, 0, 2, 22));
    expect(engine.data.calendar().bucket(late, '1h')).toBe(
      chart.data.calendar().bucket(late, '1h')
    );
  });

  it('checks what alerts read, and keeps an indicator they read', () => {
    const engine = createAlertEngine({ indicators: allIndicators, drawings: allDrawings });
    engine.data.set(walk(random(5), 50, T0), { interval: '1m' });

    expect(() =>
      engine.alerts.add({ source: { kind: 'indicator', id: 'rsi' }, trigger: 'above', value: 70 })
    ).toThrow(/unknown indicator "rsi"/);
    engine.indicators.add({ id: 'rsi', type: 'RSI' });
    const id = engine.alerts.add({
      source: { kind: 'indicator', id: 'rsi' },
      trigger: 'above',
      value: 70
    });
    expect(() => {
      engine.indicators.remove('rsi');
    }).toThrow(/read by alert/);
    engine.alerts.remove(id);
    engine.indicators.remove('rsi');
    expect(engine.indicators.list()).toEqual([]);

    expect(() => engine.drawings.add({ type: 'no-such', points: [] })).toThrow(/drawing type/);
    expect(() => createAlertEngine({ indicators: allIndicators, nonsense: true } as never)).toThrow(
      /nonsense/
    );
    expect(() => engine.on('nonsense' as never, () => undefined)).toThrow(/event/);
  });

  it('reports nothing once destroyed, nor to a listener that stopped', () => {
    const engine = createAlertEngine();
    engine.data.set([{ time: T0, open: 100, high: 100, low: 100, close: 100 }]);
    engine.alerts.add({ trigger: 'cross-up', value: 105 });
    const heard: AlertTriggerEvent[] = [];
    const stop = engine.on('alertTrigger', (event) => heard.push(event));
    engine.data.update({ time: T0, open: 100, high: 106, low: 100, close: 106 });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      value: 106,
      threshold: 105,
      trigger: 'cross-up',
      replay: false
    });

    stop();
    engine.data.update({ time: T0, open: 100, high: 106, low: 100, close: 100 });
    engine.data.update({ time: T0, open: 100, high: 107, low: 100, close: 107 });
    expect(heard).toHaveLength(1);

    engine.on('alertTrigger', (event) => heard.push(event));
    engine.destroy();
    engine.data.update({ time: T0, open: 100, high: 107, low: 100, close: 100 });
    engine.data.update({ time: T0, open: 100, high: 108, low: 100, close: 108 });
    expect(heard).toHaveLength(1);
  });
});

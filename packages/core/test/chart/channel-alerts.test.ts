import { describe, expect, it } from 'vitest';
import type { AlertFrequency, AlertTrigger, AlertTriggerEvent } from '../../src/alerts/types';
import type { BarInput } from '../../src/data/types';
import type { DrawingInput } from '../../src/drawings/types';
import { createTestChart } from '../helpers/chart';
import { btcusdtHours } from '../helpers/market';

const BARS = btcusdtHours();
/** Bars loaded before the alerts watch; the rest arrive one by one. */
const LOADED = 20;
const time = (index: number) => BARS[index]?.time ?? Number.NaN;

type ChannelTrigger = Extract<
  AlertTrigger,
  'enter-channel' | 'exit-channel' | 'inside-channel' | 'outside-channel'
>;
const CHANNEL_TRIGGERS: readonly ChannelTrigger[] = [
  'enter-channel',
  'exit-channel',
  'inside-channel',
  'outside-channel'
];

/** One evaluation: a price of a bar, as a tick or its close. */
interface Tick {
  readonly bar: number;
  readonly price: number;
}

/**
 * The evaluations the channel conditions fire on, written apart from the alerts: inside and
 * outside are strictly between the bounds or beyond one, at the evaluation alone; entering is
 * being inside after not being inside at the evaluation before (outside or on a bound, with the
 * bounds of then), and exiting being outside after not being outside, so that a price leaping
 * over the whole channel neither enters nor exits it. A bound is `NaN` where the drawing does not
 * reach, which meets nothing. `once-per-bar` keeps the first of each bar, `once` the first.
 */
function referenceFires(
  trigger: ChannelTrigger,
  ticks: readonly Tick[],
  bounds: (bar: number) => readonly [number, number],
  frequency: AlertFrequency = 'every-time'
): number[] {
  const fired: number[] = [];
  const inside = (price: number, lower: number, upper: number) => price > lower && price < upper;
  const outside = (price: number, lower: number, upper: number) => price < lower || price > upper;

  for (let at = 1; at < ticks.length; at += 1) {
    const tick = ticks[at] as Tick;
    const before = ticks[at - 1] as Tick;
    const [lower, upper] = bounds(tick.bar);
    const [lowerBefore, upperBefore] = bounds(before.bar);
    const price = tick.price;
    const known = [lowerBefore, upperBefore].every(Number.isFinite);
    const meets = {
      'inside-channel': inside(price, lower, upper),
      'outside-channel': outside(price, lower, upper),
      'enter-channel':
        known && inside(price, lower, upper) && !inside(before.price, lowerBefore, upperBefore),
      'exit-channel':
        known && outside(price, lower, upper) && !outside(before.price, lowerBefore, upperBefore)
    }[trigger];

    const again = frequency === 'once-per-bar' && fired.at(-1) === tick.bar;

    if (meets && !again && !(frequency === 'once' && fired.length > 0)) {
      fired.push(tick.bar);
    }
  }

  return fired;
}

/** The closes from bar `from` on, one evaluation each: from the last loaded bar by default. */
function closes(from = LOADED - 1): Tick[] {
  return BARS.slice(from).map((bar, index) => ({ bar: from + index, price: bar.close }));
}

/**
 * The prices of each bar as they come, from the last loaded bar's close on: the open, then the
 * extreme against the bar's direction, the other extreme, and the close.
 */
function ticksOf(bar: BarInput): number[] {
  return bar.close >= bar.open
    ? [bar.open, bar.low, bar.high, bar.close]
    : [bar.open, bar.high, bar.low, bar.close];
}

function ticks(): Tick[] {
  return [
    { bar: LOADED - 1, price: BARS[LOADED - 1]?.close ?? Number.NaN },
    ...BARS.slice(LOADED).flatMap((bar, index) =>
      ticksOf(bar).map((price) => ({ bar: LOADED + index, price }))
    )
  ];
}

/** The bars an alert fires on as the chart takes the bars, whole or tick by tick. */
function chartFires(
  drawing: DrawingInput,
  value: readonly [string, string],
  trigger: ChannelTrigger,
  frequency: AlertFrequency,
  feed: 'closes' | 'ticks'
): AlertTriggerEvent[] {
  const chart = createTestChart();
  chart.data.set(BARS.slice(0, LOADED));
  chart.drawings.add(drawing);
  chart.alerts.add({
    id: 'channel',
    trigger,
    value: [
      { kind: 'drawing', id: 'channel', level: value[0] },
      { kind: 'drawing', id: 'channel', level: value[1] }
    ],
    frequency
  });
  const fired: AlertTriggerEvent[] = [];
  chart.on('alertTrigger', (event) => fired.push(event));

  for (const bar of BARS.slice(LOADED)) {
    if (feed === 'closes') {
      chart.data.update(bar);
      continue;
    }

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;

    for (const price of ticksOf(bar)) {
      high = Math.max(high, price);
      low = Math.min(low, price);
      chart.data.update({ ...bar, high, low, close: price });
    }
  }

  chart.destroy();
  return fired;
}

const barOf = (event: AlertTriggerEvent) => BARS.findIndex((bar) => bar.time === event.time);

/** Bybit BTCUSDT, 22 to 29 September 2026: the range the price held after the drop. */
const RECTANGLE: DrawingInput = {
  id: 'channel',
  type: 'rectangle',
  points: [
    { time: time(60), price: 83_800 },
    { time: time(200), price: 84_600 }
  ]
};
const rectangleBounds = (bar: number): [number, number] =>
  bar >= 60 && bar <= 200 ? [83_800, 84_600] : [Number.NaN, Number.NaN];

/** A falling channel: its base from 86,400 at bar 20 to 83,000 at bar 220, its parallel 1,300 under. */
const CHANNEL: DrawingInput = {
  id: 'channel',
  type: 'parallel-channel',
  points: [
    { time: time(20), price: 86_400 },
    { time: time(220), price: 83_000 },
    { time: time(20), price: 85_100 }
  ]
};
const channelBounds = (bar: number): [number, number] => {
  if (bar < 20 || bar > 220) {
    return [Number.NaN, Number.NaN];
  }

  const base = 86_400 + ((83_000 - 86_400) * (bar - 20)) / 200;
  return [base - 1_300, base];
};

/**
 * A retracement of the rise from the low of bar 2 to the high of bar 18, extended to the right:
 * its 0.382 and 0.618 levels, a range commonly watched.
 */
const low = BARS[2]?.low ?? Number.NaN;
const high = BARS[18]?.high ?? Number.NaN;
const FIBONACCI: DrawingInput = {
  id: 'channel',
  type: 'fib-retracement',
  points: [
    { time: time(2), price: low },
    { time: time(18), price: high }
  ],
  style: { extendRight: true }
};
const fibonacciBounds = (bar: number): [number, number] =>
  bar >= 2 ? [high + (low - high) * 0.618, high + (low - high) * 0.382] : [Number.NaN, Number.NaN];

const CASES = [
  { name: 'a rectangle', drawing: RECTANGLE, lines: ['top', 'bottom'], bounds: rectangleBounds },
  {
    name: 'a parallel channel',
    drawing: CHANNEL,
    lines: ['parallel', 'base'],
    bounds: channelBounds
  },
  {
    name: 'two Fibonacci levels',
    drawing: FIBONACCI,
    lines: ['0.382', '0.618'],
    bounds: fibonacciBounds
  }
] as const;

describe('channel alerts on real bars, against the reference', () => {
  for (const { name, drawing, lines, bounds } of CASES) {
    it(`fires bar by bar as the reference on the closes, on ${name}`, () => {
      for (const trigger of CHANNEL_TRIGGERS) {
        const expected = referenceFires(trigger, closes(), bounds);
        const fired = chartFires(drawing, lines, trigger, 'every-time', 'closes').map(barOf);

        expect(fired, trigger).toEqual(expected);
        expect(expected.length, trigger).toBeGreaterThan(8);
      }
    });

    it(`fires on the ticks within the bars as often as each frequency lets it, on ${name}`, () => {
      for (const trigger of CHANNEL_TRIGGERS) {
        for (const frequency of ['every-time', 'once-per-bar', 'once'] as const) {
          const expected = referenceFires(trigger, ticks(), bounds, frequency);
          const fired = chartFires(drawing, lines, trigger, frequency, 'ticks').map(barOf);

          expect(fired, `${trigger} ${frequency}`).toEqual(expected);
        }

        // Once per bar close sees the closes only, each bar once the next begins: the last
        // loaded bar too, against the one before, and the latest bar not yet.
        const closed = referenceFires(trigger, closes(LOADED - 2), bounds).filter(
          (bar) => bar < BARS.length - 1
        );
        const fired = chartFires(drawing, lines, trigger, 'once-per-bar-close', 'ticks');
        expect(fired.map(barOf), `${trigger} once-per-bar-close`).toEqual(closed);
      }
    });
  }

  it('fires where the price goes through a bound, reporting that bound', () => {
    const fired = (trigger: ChannelTrigger) =>
      chartFires(RECTANGLE, ['top', 'bottom'], trigger, 'every-time', 'closes').slice(0, 2);

    // Bar 60 closes at 85,766.5, above the box; bar 61 at 84,504.1, inside: in through the top.
    expect(fired('enter-channel')).toEqual([
      expect.objectContaining({ time: time(61), value: 84_504.1, threshold: 84_600 }),
      expect.objectContaining({ time: time(84), threshold: 83_800 })
    ]);
    expect(fired('exit-channel')[0]).toMatchObject({ time: time(79), threshold: 83_800 });
    // Outside: the bound beyond which it is; inside: the nearest.
    expect(fired('outside-channel')[0]).toMatchObject({ time: time(60), threshold: 84_600 });
    expect(fired('inside-channel')[0]).toMatchObject({ time: time(61), threshold: 84_600 });
  });
});

describe('channel alerts', () => {
  const bar = (index: number, close: number): BarInput => ({
    time: Date.UTC(2026, 0, 5) + index * 60_000,
    open: close,
    high: close,
    low: close,
    close
  });

  it('take two bounds of any kind, in either order, and only for channel triggers', () => {
    const chart = createTestChart();
    chart.data.set([100, 100, 100].map((close, index) => bar(index, close)));
    const fired: AlertTriggerEvent[] = [];
    chart.on('alertTrigger', (event) => fired.push(event));
    const ma = chart.indicators.add({ type: 'MA', params: { periods: [3] } });
    chart.alerts.add({
      id: 'band',
      trigger: 'enter-channel',
      value: [110, { kind: 'indicator', id: ma, key: 'ma3' }],
      frequency: 'every-time'
    });

    // On the average of 100 before, then above it (101.67) and under 110: in.
    chart.data.update(bar(3, 105));
    expect(fired).toEqual([expect.objectContaining({ value: 105 })]);
    expect(fired[0]?.threshold).toBeCloseTo(101.67, 2);

    expect(() => {
      chart.alerts.add({ id: 'one', trigger: 'inside-channel', value: 100 });
    }).toThrow(`alert.value of a "inside-channel" alert must be a channel's two bounds.`);
    expect(() => {
      chart.alerts.add({ id: 'two', trigger: 'cross', value: [100, 110] });
    }).toThrow('alert.value of a "cross" alert must be one value.');
    expect(() => {
      chart.alerts.add({
        id: 'three',
        trigger: 'exit-channel',
        value: [100, 110, 120] as unknown as [number, number]
      });
    }).toThrow(`alert.value of a "exit-channel" alert must be a channel's two bounds.`);
    expect(() => {
      chart.alerts.add({
        id: 'line',
        trigger: 'exit-channel',
        value: [100, { kind: 'drawing', id: 'missing' }]
      });
    }).toThrow(/alert.value\[1\]: unknown drawing "missing"/);
    // An indicator a channel reads cannot go.
    expect(() => {
      chart.indicators.remove(ma);
    }).toThrow(/band/);
  });

  it('never fire because a drawing moved, and draw no line', () => {
    const chart = createTestChart();
    chart.data.set([100, 100, 100].map((close, index) => bar(index, close)));
    const fired: AlertTriggerEvent[] = [];
    chart.on('alertTrigger', (event) => fired.push(event));
    chart.drawings.add({
      id: 'box',
      type: 'rectangle',
      points: [
        { time: bar(0, 0).time, price: 102 },
        { time: bar(20, 0).time, price: 104 }
      ]
    });
    chart.alerts.add({
      id: 'box',
      trigger: 'enter-channel',
      value: [
        { kind: 'drawing', id: 'box', level: 'top' },
        { kind: 'drawing', id: 'box', level: 'bottom' }
      ],
      frequency: 'every-time'
    });

    // The box moves over the price, which then stays put.
    chart.drawings.update('box', {
      points: [
        { time: bar(0, 0).time, price: 99 },
        { time: bar(20, 0).time, price: 101 }
      ]
    });
    chart.data.update(bar(3, 100));
    expect(fired).toHaveLength(0);

    chart.data.update(bar(4, 102));
    chart.data.update(bar(5, 100.5));
    expect(fired).toHaveLength(1);
    expect(chart.alerts.get('box')?.value).toEqual([
      { kind: 'drawing', id: 'box', level: 'top' },
      { kind: 'drawing', id: 'box', level: 'bottom' }
    ]);
  });

  it('neither enter nor exit a channel the price leaps over', () => {
    const chart = createTestChart();
    chart.data.set([95, 95].map((close, index) => bar(index, close)));
    const fired: AlertTriggerEvent[] = [];
    chart.on('alertTrigger', (event) => fired.push(event));

    for (const trigger of ['enter-channel', 'exit-channel'] as const) {
      chart.alerts.add({ id: trigger, trigger, value: [100, 110], frequency: 'every-time' });
    }

    // Up over it, down under it, then into it from below and out of it at the top.
    [115, 95, 100, 105, 110, 115].forEach((close, index) => {
      chart.data.update(bar(2 + index, close));
    });
    expect(fired.map(({ id, value }) => [id, value])).toEqual([
      ['enter-channel', 105],
      ['exit-channel', 115]
    ]);
  });

  it('watch the edges of price ranges as of rectangles', () => {
    const chart = createTestChart();
    chart.data.set([100, 100, 100].map((close, index) => bar(index, close)));
    chart.drawings.add({
      id: 'range',
      type: 'price-range',
      points: [
        { time: bar(0, 0).time, price: 104 },
        { time: bar(20, 0).time, price: 98 }
      ]
    });

    expect(chart.drawings.levels('range')).toEqual(['top', 'bottom']);
    const fired: AlertTriggerEvent[] = [];
    chart.on('alertTrigger', (event) => fired.push(event));
    chart.alerts.add({
      id: 'out',
      trigger: 'exit-channel',
      value: [
        { kind: 'drawing', id: 'range', level: 'top' },
        { kind: 'drawing', id: 'range', level: 'bottom' }
      ]
    });
    chart.data.update(bar(3, 97));
    expect(fired).toEqual([expect.objectContaining({ threshold: 98 })]);
  });
});

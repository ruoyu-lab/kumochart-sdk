# Alerts

<!-- code-prelude
import type { ValueSource } from '@kumochart-sdk/core';
declare const maId: string, lineId: string, ethId: string, trendLineId: string, macdId: string, rectId: string;
declare const alertsFromServer: import('@kumochart-sdk/core/alerts').AlertInput[];
declare function notify(message: string): void;
declare function saveAlert(id: string, patch: { value: number }): void;
-->

The alerts module watches the price, an indicator or a drawing, and emits `alertTrigger` when a condition is met. An alert at a fixed level shows as a line on the chart that users can drag.

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { alerts } from '@kumochart-sdk/core/alerts';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { modules: [alerts()] });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const last = chart.data.last()!;
chart.alerts.add({ id: 'above', trigger: 'cross-up', value: last.close * 1.01, label: 'Breakout' });
chart.alerts.add({
  id: 'below',
  trigger: 'cross-down',
  value: last.close * 0.99,
  label: 'Breakdown'
});
```

## Adding

```ts
chart.alerts.add({
  id: 'btc-100k', // your id of the alert; the chart numbers one without it
  trigger: 'cross-up', // the condition
  value: 100000, // the level
  frequency: 'once', // how often it fires
  label: '100k' // the text on its line
});
```

The `id` is usually the alert's id in your application or on your server; without one the chart numbers it, `alert-1` on. `add()` returns the alert's id.

```ts
chart.alerts.update('btc-100k', { value: 105000 });
chart.alerts.remove('btc-100k');
chart.alerts.set(alertsFromServer); // replaces every alert
chart.alerts.clear(); // removes every alert
chart.alerts.list();
chart.alerts.get('btc-100k'); // with its status: 'active', 'triggered' or 'disabled'
```

## Conditions

| `trigger`         | Fires when the value           |
| ----------------- | ------------------------------ |
| `cross-up`        | crosses up through the other   |
| `cross-down`      | crosses down through the other |
| `cross`           | crosses it either way          |
| `above`           | is above it                    |
| `below`           | is below it                    |
| `enter-channel`   | enters the channel             |
| `exit-channel`    | leaves the channel             |
| `inside-channel`  | is inside the channel          |
| `outside-channel` | is outside the channel         |

Crossing, entering and leaving compare with the evaluation before: below then, above now, is a crossing; outside the channel (or on a bound) then, inside now, is entering it, and leaving is the other way round. Leaping from one side of the channel to the other, such as from 95 to 115 over a channel from 100 to 110, neither enters nor leaves it. Above, below, inside and outside look at the evaluation alone.

## What to watch

`source` is the watched value, the main series' close by default. It can be:

```ts
const sources: ValueSource[] = [
  { kind: 'price', field: 'high' }, // a price of the main series
  { kind: 'indicator', id: maId, key: 'ma20' }, // a line of an indicator; without key, its first
  { kind: 'drawing', id: lineId }, // a drawing, where it is at each bar; without level, its first line
  { kind: 'series', id: ethId } // an added series
];
```

`value` is what it is compared with: a fixed level, another value, or the two bounds of a channel:

```ts
// The price crosses up through a trend line
chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: trendLineId } });

// MACD crosses up through its signal line
chart.alerts.add({
  id: 'b',
  source: { kind: 'indicator', id: macdId, key: 'macd' },
  trigger: 'cross-up',
  value: { kind: 'indicator', id: macdId, key: 'signalLine' }
});

// The price leaves a rectangle
chart.alerts.add({
  id: 'c',
  trigger: 'exit-channel',
  value: [
    { kind: 'drawing', id: rectId, level: 'top' },
    { kind: 'drawing', id: rectId, level: 'bottom' }
  ]
});
```

Watching indicators needs the indicators module, watching drawings the drawings module. `chart.drawings.levels(id)` lists the lines of a drawing that can be watched. An indicator or a drawing an alert watches cannot be removed before the alert: the error names the alerts that use it.

## How often

| `frequency`          | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `once` (default)     | Fires once, then its status is `triggered` until `rearm()`  |
| `once-per-bar`       | At most once a bar, on the update that meets the condition  |
| `once-per-bar-close` | Closes only: each bar is evaluated when the next one starts |
| `every-time`         | On every update that meets the condition                    |

```ts
chart.alerts.rearm('btc-100k');
chart.alerts.update('btc-100k', { enabled: false }); // paused
```

## When it fires

```ts
chart.on('alertTrigger', ({ id, time, value, threshold, replay }) => {
  if (replay) return; // fired while replaying history: usually nothing to notify
  notify(`${id}: ${value} crossed ${threshold}`);
});
```

`time` is the bar that met the condition, `value` the watched value, `threshold` the level at that bar (for channels, the bound it went through).

## Dragging on the chart

An alert at a fixed level shows as a line users can drag. Dragging emits `alertDrag`; the alert follows, and keeps the level where the user lets go:

```ts
chart.on('alertDrag', ({ id, phase, price }) => {
  if (phase === 'end') saveAlert(id, { value: price });
});
```

How the line looks:

```ts
chart.alerts.add({
  id: 'x',
  trigger: 'cross',
  value: 98000,
  color: '#e3a33b', // the theme's alert color by default
  lineStyle: 'dashed',
  draggable: true, // whether it can be dragged
  visible: true, // whether its line shows
  buttons: [{ id: 'remove', text: '✕' }] // buttons on its label; a click emits buttonClick
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'alert' && buttonId === 'remove') chart.alerts.remove(id);
});
```

## Alerts while the page is closed

Alerts on the chart work while the page is open. To evaluate them on a server, use the functions that need no chart: `computeIndicator()` for indicators (see [Indicators](indicators.md)) and `computeDrawingLevels()` for drawings (see [Drawings](drawings.md#the-lines-of-a-drawing)). Both run in Node.js and compute the same values as the chart.

# Getting started

<!-- code-prelude
declare const socket: WebSocket;
declare const trade: { time: number; price: number; size: number };
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

## Install

```bash
npm install @kumochart-sdk/core
```

With Vue or React, add the package of its components too: see [Vue](vue.md) and [React](react.md).

## A first chart

The chart fills its container and follows its size, so the container needs a height:

```html
<div id="chart" style="height: 480px"></div>
```

Create the chart and give it bars:

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars());
```

A bar is an object:

```ts
const bar = {
  time: 1767225600000, // epoch milliseconds, or an ISO string or a Date
  open: 87512.3,
  high: 87650,
  low: 87480.1,
  close: 87601.5,
  volume: 132.4 // optional, 0 by default
};
```

Bars go from the oldest to the newest, each at a time of its own.

## Timeframes

Tell the chart how long its bars are and it builds longer ones in the browser, without asking your server again:

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

`setTimeframe(null)` shows the bars as given again. How to write intervals, trading sessions and time zones: [Timeframes and calendars](timeframes.md).

## Indicators and drawings

Indicators and drawings are modules, given when the chart is created:

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD]), drawings([trendLine, horizontalLine])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'MA' }); // on the main pane
chart.indicators.add({ type: 'MACD' }); // in a pane of its own

// Let the user draw a trend line: two clicks
chart.drawings.startTool('trend-line');
```

Load only the few you use and only those end up in your bundle; or load a whole module, see [Modules](modules.md).

## Real time

Push new bars with `update()`: a bar at the time of the last one replaces it, a later one is appended:

```ts
socket.onmessage = (message) => {
  const bar = JSON.parse(message.data);
  chart.data.update(bar);
};
```

If you receive trades, give them to the chart as they are: it folds them into the current bar and starts the next one when its time comes. This needs the `interval` of the bars:

```ts
chart.data.addTrades({ time: trade.time, price: trade.price, size: trade.size });
```

## Loading history

When the user scrolls back near the first bar, the chart emits `loadMore`; add the older bars in front with `prepend()`:

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` is the time of the current first bar. Once older bars are in, scrolling back further emits it again.

## Without a bundler

Include one script and every module is in the global `KumoChart`:

```html
<div id="chart" style="height: 480px"></div>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules()
  });
  chart.data.set(bars);
</script>
```

The script holds every feature, about 112 kB gzipped. The words of the indicators in Chinese, Japanese and Korean (see [Indicators](indicators.md#languages)) are in a script of their own, about 6 kB, to add when you want them, as the global `KumoChartIndicatorTexts`:

```html
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart-indicator-texts.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules({
      indicators: { texts: [KumoChartIndicatorTexts.indicatorTexts] }
    }),
    locale: 'zh-CN'
  });
</script>
```

## Destroying

Call `destroy()` when the chart leaves the page: it removes its element and releases every listener and timer.

```ts
chart.destroy();
```

Once destroyed, the chart throws for any call, a read as well as a change; calling `destroy()` again does nothing.

## Next

- [Modules](modules.md): which feature is in which module, and loading what you need.
- [Data](data.md): bars, trades and timeframes in detail.
- [Appearance](appearance.md): themes, colors, scales and the crosshair.

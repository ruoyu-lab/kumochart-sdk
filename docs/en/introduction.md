# Introduction

KumoChart is an open-source SDK for trading charts: the core holds the bars and the scales, and indicators, drawings, alerts and replay load when you need them.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, RSI]), drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'EMA' });
chart.indicators.add({ type: 'RSI' });
```

## What it does

The core comes with:

- 11 series types: candles, hollow candles, OHLC bars, high-low bars, line, step line, line with markers, area, baseline, HLC area and columns.
- Panes: the main pane and any number below it, each with as many price scales as it needs, in normal, logarithmic, percent or indexed mode.
- Crosshair, legend, zoom and pan, by mouse, trackpad, touch and keyboard.
- Timeframes: give it 1-minute bars and it builds 5-minute, hourly, daily or any other bars in the browser, following trading sessions and a time zone.
- Real time: trades fold into the latest bar, and older bars load as the user scrolls back.
- Save and restore: the layout, indicators and drawings of a chart in one object.

The modules add:

| Module           | What is in it                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Indicators       | 50 of them, from moving averages, MACD and RSI to Ichimoku, VWAP and SuperTrend                            |
| Drawings         | 38 tools: trend lines, channels, Fibonacci, Gann, patterns, long and short positions and more              |
| Chart types      | Heikin-Ashi, Renko, range bars, line break, Kagi, point & figure, and bars by trades or volume             |
| Alerts           | When the price or an indicator crosses a level, another line or a channel; levels can be dragged           |
| Orders and fills | Order lines the user can drag, and markers for fills on the bars                                           |
| Replay           | Plays the bars back one by one from a moment in the past                                                   |
| Volume profiles  | The volume traded at each price: of the bars in view, of each trading day, or of a span the user marks out |

There are components for [Vue](vue.md) and [React](react.md).

Whatever is missing you can add yourself: [indicators](custom-indicators.md), [drawings](custom-drawings.md), [series types](custom-series.md), or [paint](plugins.md) straight on the canvas.

## The core and the modules

`createChart()` gives a chart with the core alone. The features you use go in as modules, each whole or only the parts you pick:

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(container, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});
```

What you leave out stays out of your bundle. The core is about 44 kB minified and gzipped, everything about 103 kB. See [Modules](modules.md).

## Browsers

Chrome and Edge 99 or later, Firefox 112 or later, Safari 16 or later (iOS included).

The chart needs a browser. Computing indicators, the lines of drawings and volume profiles does not: they run on their own in Node.js too, for example to evaluate alerts on a server.

## License

Apache-2.0, free in commercial products too. If you use KumoChart in a website or an app, please credit it where your users can see it, such as in the footer or on the about page, with a link to [kumochart.com](https://kumochart.com), for example "Charts by KumoChart". The chart itself shows no logo.

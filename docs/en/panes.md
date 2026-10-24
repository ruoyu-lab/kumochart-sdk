# Panes

A chart is a stack of panes: the main pane at the top (its id is `main`) and the panes below it. Each pane has its own price scales; they share the time axis at the bottom.

## Panes below the main one

Most of them come from indicators: oscillators such as MACD and RSI default to `pane: 'new'`, open a pane of their own when added, and the pane goes when its last indicator does.

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, MACD, RSI, VOL } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MACD, RSI, VOL])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'VOL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

You can create a pane yourself and put indicators or series in it:

```ts
chart.panes.add({ id: 'oscillators', title: 'Oscillators', height: 160 });
chart.indicators.add({ type: 'RSI', pane: 'oscillators' });
chart.indicators.add({ type: 'STOCH', pane: 'oscillators' });
```

Panes you create stay until you remove them. Without an `id` the chart numbers the pane, `pane-1` on, and `add()` returns it.

```ts
chart.panes.list(); // every pane from the top, the main pane first
chart.panes.update('oscillators', { height: 200 });
chart.panes.move('oscillators', 1); // right under the main pane
chart.panes.remove('oscillators'); // remove its indicators and series first; its drawings go with it
```

The main pane takes the remaining height, so setting its height does nothing. When the heights do not fit, the other panes shrink in proportion, and no pane, the main one included, gets lower than `minHeight`. The user resizes panes by dragging the separators between them: the separator follows the pointer and the other panes stay as they are, a shrunk pane keeping the height it has now. Once they let go, each pane whose height changed emits `paneResize`. The options:

```ts
chart.applyOptions({
  panes: {
    defaultHeight: 120, // the height of a new pane
    minHeight: 40, // the least a pane shrinks to while resizing
    separatorHeight: 5, // the height of the strip that can be dragged
    separatorWidth: 2 // the width of the line drawn along it; 0 draws none
  }
});
```

## Price scales

Each pane has a price scale on the right. `chart.priceScale()` gives a scale of a pane:

```ts
const scale = chart.priceScale(); // the right scale of the main pane
const rsiScale = chart.priceScale('oscillators');
```

<!-- code-prelude
declare const scale: import('@kumochart-sdk/core').PriceScaleApi;
declare const time: number;
declare const ethBars: import('@kumochart-sdk/core').BarInput[], latestEthBar: import('@kumochart-sdk/core').BarInput;
declare const ethTrades: import('@kumochart-sdk/core').TradeInput[];
-->

### Logarithmic, percent, indexed

```ts
scale.setMode('log'); // logarithmic
scale.setMode('percent'); // the change from the first bar in view
scale.setMode('indexed'); // the first bar in view as 100
scale.setMode('normal');
```

Percent and indexed modes measure from the first bar in view, so the base moves as the user scrolls. When the data does not suit a mode (such as negative values on a logarithmic scale), the scale draws in normal mode meanwhile, and `mode()` still returns the mode you set.

### Range

A scale fits the bars and indicators in view by default. Dragging the axis, or setting a range, turns that off:

```ts
scale.setRange({ min: 80000, max: 95000 });
scale.isAutoScale(); // false
scale.autoScale(); // fits again; so does double-clicking the axis
scale.setInverted(true); // upside down
```

### Coordinates

To place HTML elements over the chart, convert between prices, times and pixels:

```ts
scale.priceToY(90000); // y from the chart's top left corner
scale.yToPrice(120);
chart.timeScale.timeToX(time);
chart.timeScale.xToTime(300);
```

`chart.layout()` gives where each part of the chart is.

## Several scales in a pane

A pane can have several scales: `right` (the default), `left`, or any name you give. On `left`, an axis shows on the left; any other name is an overlay scale without an axis, which fits its own values apart from the others. While only `left` has something on it in a pane, the right axis always shows the left scale, and drawings are placed on it; dragging or double-clicking the right axis, or setting the range of `right` in code, changes the left scale. Dragging the plot up and down moves the scales scaled by hand.

The usual case is volume at the bottom of the main pane:

```ts
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 }); // the lowest 20 %
```

## Overlaid series

Data beside the main series goes on the chart with `chart.series`, such as another symbol to compare, or a line you computed:

```ts
const eth = chart.series.add({
  type: 'line',
  pane: 'main',
  scale: 'compare', // a scale of its own, so prices far apart still overlay
  title: 'ETH',
  data: ethBars // bars as the main series takes them, or { time, value } points
});

chart.series.updateData(eth, latestEthBar); // real time
chart.series.addTrades(eth, ethTrades); // or trades as they come
chart.series.update(eth, { style: { color: '#c084fc' } });
chart.series.remove(eth);
chart.series.set([{ type: 'line', title: 'ETH', data: ethBars }]); // replaces every series
chart.series.clear(); // removes every series
```

An added series is placed by time, lined up with the main series' bars at the same times. Trades fold as into the main bars: into the bars of a series of bars, such as candles, and into a value per source interval, the price of its last trade, for a line, an area or another series of values.

To compare changes only, put both on the same scale in percent mode; each is measured from its first value in view:

```ts
chart.series.add({ type: 'line', title: 'ETH', data: ethBars });
chart.priceScale().setMode('percent');
```

`type` is any of the core's 11 series types (see [Appearance](appearance.md#the-main-series)) or one you registered (see [Custom series](custom-series.md)). `pane: 'new'` gives it a pane of its own.

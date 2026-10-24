# Data

<!-- code-prelude
declare const bar: import('@kumochart-sdk/core').BarInput, bar1: import('@kumochart-sdk/core').BarInput, bar2: import('@kumochart-sdk/core').BarInput;
declare const time: number;
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

The bars of the main series go in and out through `chart.data`. What you write is the **source data**; what you read are the **displayed bars**: the source as built into the timeframe, transformed and clipped by a replay.

## Bars

```ts
interface BarInput {
  time: number | string | Date; // epoch milliseconds, an ISO 8601 string or a Date
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // 0 by default
}
```

The chart checks every bar: prices are finite numbers, `high` and `low` enclose `open` and `close`, the volume is not negative, and times go from the oldest to the newest without repeating. Otherwise it throws a `ChartError` that says which bar is wrong and how, and the chart stays as it was.

The chart copies what you pass: changing your array later does not change the chart, and the chart never changes yours.

## Setting bars

```ts
chart.data.set(bars);
```

For another symbol, call `set()` again: it replaces every bar.

When the bars have a fixed interval, pass it too:

```ts
chart.data.set(bars, { interval: '1m' });
```

With the interval the chart can build longer timeframes in the browser and fold trades into bars. See [Timeframes and calendars](timeframes.md).

## Real time

```ts
chart.data.update(bar);
chart.data.update([bar1, bar2]); // several at once
```

A bar at the time of the last one replaces it, a later one is appended, an earlier one throws (history goes in with `set()` or `prepend()`).

While the user looks at the latest bar, the chart moves along as new bars come in; while they look back at history, it stays where it is.

## Trades

If you receive trades, give them to the chart as they are: it folds them into the current bar and starts the next one when its time comes.

```ts
chart.data.addTrades({ time: 1767225600123, price: 87601.5, size: 0.02 });
chart.data.addTrades(trades); // a batch, in order of time
```

`size` is the quantity traded, added to the bar's volume, 0 by default. `side` is the side of the taker: `buy` for a trade that took an offer, `sell` for one that took a bid; leave it out when unknown. Transforms built from the trades receive it (see [A bar transform](custom-series.md#a-bar-transform)). This needs the `interval` given to `set()`. Late trades are skipped: those before the last bar or before the latest trade given, as a stream may deliver after it reconnects. With trading sessions set, trades outside them are skipped too. `addTrades()` returns how many were applied.

Bars built from trades, such as tick bars (see [Chart types](chart-types.md)), need the trades themselves: the chart keeps the latest ones, as many as `performance.maxTrades`, 100,000 by default.

## Loading history

When the user scrolls back near the first bar, the chart emits `loadMore`:

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` is the time of the current first bar. `prepend()` adds older bars in front, ignores those overlapping the bars there, and returns how many it added. Once the first bar has changed, scrolling back further emits `loadMore` again; when nothing was added, it comes again only after the user scrolls away and back.

How many bars may remain before it fires is `timeScale.loadMoreThreshold`, 20 by default.

## Clearing

```ts
chart.data.clear();
```

Removes every bar and ends a running replay. The interval and the timeframe stay.

## Reading

```ts
chart.data.length; // how many bars are displayed
chart.data.at(0); // the first, or null
chart.data.last(); // the last
chart.data.indexOf(time); // the index of the bar at a time, or -1
chart.data.toArray(); // a copy of them all
```

The `time` of a bar read back is always epoch milliseconds.

To go through many bars, use `chart.data.bars`, which reads by column without copying:

```ts
const { bars } = chart.data;
let highest = -Infinity;

for (let i = 0; i < bars.length; i += 1) {
  highest = Math.max(highest, bars.high(i));
}
```

`chart.data.source` is the same view of the source bars, at their interval (up to the current bar while replaying).

## When bars change

Any change of the displayed bars (set, updated, prepended, another timeframe, a replay) emits `barsChange`:

```ts
chart.on('barsChange', ({ change }) => {
  if (change.kind === 'tail') {
    // only the bars from change.from on changed or were appended
  } else {
    // 'reset': any bar may have changed
  }
});
```

When you compute something from the bars, it tells you what to compute again.

## Other data

Data beside the main series, such as another symbol to compare or a line you computed, goes on the chart with `chart.series`; see [Panes](panes.md#overlaid-series).

# Chart types

The core draws 11 series types (candles, line, area and the others, see [Appearance](appearance.md#the-main-series)). The chart types module adds:

| Type           | Export          | What it is                                                                   |
| -------------- | --------------- | ---------------------------------------------------------------------------- |
| Heikin-Ashi    | `heikinAshi`    | Each bar averaged with the one before, for smoother trends                   |
| Renko          | `renko`         | A brick each time the price moves a box, whatever the time                   |
| Range bars     | `rangeBars`     | Each bar spans a fixed range from high to low                                |
| Line break     | `lineBreak`     | A new line only when a close breaks the last few lines                       |
| Kagi           | `kagi`          | Lines that turn when the closes come back far enough; thick or thin by trend |
| Point & figure | `pointFigure`   | X's rising and O's falling, a new column after enough boxes back             |
| Tick bars      | `tickBars`      | A bar every so many trades                                                   |
| Volume bars    | `volumeBars`    | A bar every so much volume                                                   |
| Turnover bars  | `turnoverBars`  | A bar every so much money traded                                             |
| Volume candles | `volumeCandles` | Candles as wide as their volume                                              |

```ts live height=400
import { createChart } from '@kumochart-sdk/core';
import { chartTypes, renko } from '@kumochart-sdk/core/chart-types';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [chartTypes([renko])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.transforms.set({ type: 'renko' }); // the box follows the average true range of 14 bars
```

## Two kinds

Chart types work in one of two ways:

- **New bars**: Heikin-Ashi, Renko, range, line break, tick, volume and turnover bars are turned on with `chart.transforms.set()`, which builds new bars from those of the timeframe and shows them.
- **Another drawing**: volume candles are a series type, set with `mainSeries.type`; the bars stay as they are.

Kagi and point & figure take both: their bars, drawn their own way.

```ts
// Renko
chart.transforms.set({ type: 'renko', params: { box: 500 } });

// Kagi: build Kagi lines, and draw them as such
chart.batch(() => {
  chart.transforms.set({ type: 'kagi' });
  chart.applyOptions({ mainSeries: { type: 'kagi' } });
});

// Volume candles
chart.applyOptions({ mainSeries: { type: 'volume-candles' } });

// Back to plain bars
chart.transforms.set(null);
chart.applyOptions({ mainSeries: { type: 'candles' } });
```

The bars built are the chart's displayed bars: indicators compute on them, and `chart.data.toArray()` returns them. The source data stays as it is, and comes back when the transform goes.

## Parameters

| Type           | `type`         | Parameters                                                                                                                                                                     |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Heikin-Ashi    | `heikin-ashi`  | none                                                                                                                                                                           |
| Renko          | `renko`        | `box`, a fixed size, or `percentage` of the last price, or else the average true range over `atrLength` bars (14); `source`, `close` (default) or `ohlc`; `wicks` (default on) |
| Range bars     | `range`        | `range`, the high to low of a bar; or else the average true range over 14 bars                                                                                                 |
| Line break     | `line-break`   | `lines`, how many lines a close must break (3)                                                                                                                                 |
| Kagi           | `kagi`         | `reversal`, a fixed amount, or `percentage`, or else the average true range over `atrLength` bars                                                                              |
| Point & figure | `point-figure` | `box`, `percentage` or `atrLength` for the box size; `reversal`, the boxes a turn takes (3); `source`, `close` or `hl`; `oneStepBack`, letting a one-box column turn           |
| Tick bars      | `tick`         | `count`, trades per bar (required)                                                                                                                                             |
| Volume bars    | `volume`       | `volume` per bar (required)                                                                                                                                                    |
| Turnover bars  | `turnover`     | `turnover` per bar (required)                                                                                                                                                  |

### Automatic sizes

Without a fixed size, the chart sizes these bars by the latest closed bars when it builds them: the average true range of `atrLength` bars (14 by default) up to the latest closed bar (the latest bar, still forming, is left out), or the percentage of the latest price, rounded to a readable step (2137 becomes 2000).

The bars streaming in after do not change the size until the bars are built again: setting the transform, `data.set()`, a new timeframe, loading history (`data.prepend()`) and starting a replay build them again, sized by the latest closed bars then. Loading history leaves the latest bars as they were, so the size usually stays.

While fewer than `atrLength` bars have closed and give no size, nothing is drawn; once enough have, the size of the closed bars at that moment is kept and everything is drawn from the first bar on. By a percentage from no bars at all, the size waits for the first bar to close and takes its close.

Built from trades (see below), a trade is a single price with no true range: give a fixed size or `percentage`, and `range` for range bars, or the transform throws.

Sizes worked out automatically can be read back, to show them in your UI (`resolved` is `null` until the bars give them):

```ts
chart.transforms.get();
// { type: 'renko', params: {}, input: 'bars', resolved: { box: 500, ... } }
```

## From trades

Tick, volume and turnover bars are built from the bars of the timeframe by default, never splitting a bar. To build them from each trade, set `input: 'trades'` and give the chart the trades:

```ts
chart.transforms.set({ type: 'tick', params: { count: 100 }, input: 'trades' });
chart.data.addTrades(trades);
```

The chart keeps the latest trades for these bars, as many as `performance.maxTrades` (100,000 by default). This needs the `interval` of the bars; see [Data](data.md#trades).

## Saving

`saveState()` keeps the bar transform and how the main series is drawn, and restoring a layout sets them again. See [Save and restore](state.md).

To make a transform or a series type of your own, see [Custom series](custom-series.md).

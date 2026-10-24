# Modules

<!-- code-prelude
declare const myIndicator: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
-->

The core holds what every chart needs: the bars and the basic series types, scales, panes, crosshair, legend, zoom and pan, timeframes, and saving and restoring. Every other feature is a module, loaded when you use it; what you do not load stays out of your bundle.

## Loading modules

Put the modules in `modules` when you create the chart:

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { alerts } from '@kumochart-sdk/core/alerts';

const chart = createChart(container, {
  modules: [indicators(allIndicators), drawings(allDrawings), alerts()]
});

chart.indicators.add({ type: 'RSI' });
chart.drawings.startTool('fib-retracement');
chart.alerts.add({ id: 'btc-100k', trigger: 'cross-up', value: 100000 });
```

A module adds its API to the chart (such as `chart.indicators`), along with its options and events. Modules are given when the chart is created; they cannot be added or removed later.

## The modules

| Module          | Entry                                | Loading                     | Adds to the chart                    |
| --------------- | ------------------------------------ | --------------------------- | ------------------------------------ |
| Indicators      | `@kumochart-sdk/core/indicators`     | `indicators(allIndicators)` | `chart.indicators`                   |
| Drawings        | `@kumochart-sdk/core/drawings`       | `drawings(allDrawings)`     | `chart.drawings`                     |
| Chart types     | `@kumochart-sdk/core/chart-types`    | `chartTypes(allChartTypes)` | the main series can show these types |
| Alerts          | `@kumochart-sdk/core/alerts`         | `alerts()`                  | `chart.alerts`                       |
| Orders          | `@kumochart-sdk/core/trading`        | `orders()`                  | `chart.orders`                       |
| Markers         | `@kumochart-sdk/core/trading`        | `markers()`                 | `chart.markers`                      |
| Replay          | `@kumochart-sdk/core/replay`         | `replay()`                  | `chart.replay`                       |
| Volume profiles | `@kumochart-sdk/core/volume-profile` | `volumeProfiles()`          | `chart.volumeProfiles`               |
| Watermark       | `@kumochart-sdk/core/watermark`      | `watermark()`               | the `watermark` option               |
| Everything      | `@kumochart-sdk/core/all`            | `allModules()`              | all of the above                     |

The entry of volume profiles has a drawing type too, the fixed range volume profile `fixedRangeVolumeProfile()`, given to the drawings module; see [Volume profile](volume-profile.md#fixed-range).

## Whole, or the parts you pick

Indicators, drawings and chart types hold many types each. Load them all, or give only those you use:

```ts
import { indicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine, fibRetracement } from '@kumochart-sdk/core/drawings';
import { chartTypes, heikinAshi, renko } from '@kumochart-sdk/core/chart-types';

const chart = createChart(container, {
  modules: [
    indicators([MA, MACD, RSI]),
    drawings([trendLine, horizontalLine, fibRetracement]),
    chartTypes([heikinAshi, renko])
  ]
});
```

Only those end up in your bundle. What each module holds: [Indicators](indicators.md), [Drawings](drawings.md), [Chart types](chart-types.md).

## Sizes

Minified and gzipped, the core included:

| Loaded                                | Size    |
| ------------------------------------- | ------- |
| The core alone                        | ~44 kB  |
| The core + MA, MACD, RSI              | ~54 kB  |
| The core + every indicator            | ~63 kB  |
| The core + trend and horizontal lines | ~57 kB  |
| The core + every drawing              | ~69 kB  |
| The core + every chart type           | ~49 kB  |
| The core + alerts                     | ~49 kB  |
| The core + orders and markers         | ~47 kB  |
| The core + replay                     | ~45 kB  |
| The core + volume profiles            | ~47 kB  |
| Everything                            | ~103 kB |

The modules share the core's code, so together they weigh less than the differences above added up.

## Adding types later

Modules are given at creation, but the types in them can come and go at any time, such as an indicator of your own:

```ts
chart.indicators.register(myIndicator);
chart.indicators.add({ type: myIndicator.type });

chart.indicators.types(); // the indicator types the chart has now
chart.indicators.unregister(myIndicator.type);
```

Drawings (`chart.drawings`), bar transforms (`chart.transforms`) and series types (`chart.series`) have the same `register()`, `unregister()` and `types()`. A type still in use on the chart cannot be removed: the error says what uses it.

To bring your own types along when the chart is created, or to add a whole feature of your own, see [Custom modules](custom-modules.md).

## Loading everything

When size does not matter, or to try things out, load everything:

```ts
import { createChart } from '@kumochart-sdk/core';
import { allModules } from '@kumochart-sdk/core/all';

const chart = createChart(container, { modules: allModules() });
```

`kumochart.iife.js`, the script for pages without a bundler, holds everything too; see [Getting started](getting-started.md#without-a-bundler).

## In TypeScript

The chart's type follows its modules: `chart.indicators` is typed only on a chart with the indicators module, and using it on one without fails to compile.

To name the type of such a chart elsewhere, give `Chart` the types of its modules:

```ts
import { createChart, type Chart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const modules = [indicators(allIndicators), drawings(allDrawings)] as const;

export type MyChart = Chart<typeof modules>;

export function mountChart(container: HTMLElement): MyChart {
  return createChart(container, { modules });
}
```

A chart with every module is a `Chart<AllModules>` (`AllModules` comes from `@kumochart-sdk/core/all`). `Chart` alone is a chart without modules, which every chart is.

## Saved states and modules

`chart.saveState()` keeps a part for each module, such as the indicators and the drawings. Restoring needs the same modules: a state with drawings on a chart without the drawings module makes `loadState()` throw, and the chart stays as it was. See [Save and restore](state.md).

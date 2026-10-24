# 模块

<!-- code-prelude
declare const myIndicator: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
-->

核心只放每个图表都要用的东西：K 线和基础图形、坐标、窗格、十字线、图例、缩放平移、周期合成、保存和恢复。其它功能都是模块，用到才载入，没载入的不会打包进你的代码。

## 载入模块

建图时把模块放进 `modules`：

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

载入一个模块，图表上就多出它的接口（比如 `chart.indicators`），以及它的选项和事件。模块只能在建图时给，建好以后不能再加或去掉。

## 有哪些模块

| 模块       | 入口                                 | 载入                        | 图表上多出             |
| ---------- | ------------------------------------ | --------------------------- | ---------------------- |
| 指标       | `@kumochart-sdk/core/indicators`     | `indicators(allIndicators)` | `chart.indicators`     |
| 画线       | `@kumochart-sdk/core/drawings`       | `drawings(allDrawings)`     | `chart.drawings`       |
| 图表类型   | `@kumochart-sdk/core/chart-types`    | `chartTypes(allChartTypes)` | 主图可以切到这些类型   |
| 提醒       | `@kumochart-sdk/core/alerts`         | `alerts()`                  | `chart.alerts`         |
| 委托单线   | `@kumochart-sdk/core/trading`        | `orders()`                  | `chart.orders`         |
| 成交标记   | `@kumochart-sdk/core/trading`        | `markers()`                 | `chart.markers`        |
| 回放       | `@kumochart-sdk/core/replay`         | `replay()`                  | `chart.replay`         |
| 成交量分布 | `@kumochart-sdk/core/volume-profile` | `volumeProfiles()`          | `chart.volumeProfiles` |
| 水印       | `@kumochart-sdk/core/watermark`      | `watermark()`               | 选项 `watermark`       |
| 全部       | `@kumochart-sdk/core/all`            | `allModules()`              | 以上全部               |

成交量分布的入口里还有一种画线，固定范围成交量分布 `fixedRangeVolumeProfile()`，放进画线模块里用，见[成交量分布](volume-profile.md#固定范围)。

## 整块载入，或者只挑几项

指标、画线、图表类型这三个模块里有很多种，可以全部载入，也可以只给要用的几种：

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

只有给了的几种会打包进来。每个模块里有哪些，见[指标](indicators.md)、[画线](drawings.md)、[图表类型](chart-types.md)。

## 体积

压缩并 gzip 之后，包括核心在内：

| 载入的内容                | 大小      |
| ------------------------- | --------- |
| 只有核心                  | 约 44 kB  |
| 核心 + MA、MACD、RSI      | 约 54 kB  |
| 核心 + 全部指标           | 约 63 kB  |
| 核心 + 趋势线和水平线     | 约 57 kB  |
| 核心 + 全部画线           | 约 69 kB  |
| 核心 + 全部图表类型       | 约 49 kB  |
| 核心 + 提醒               | 约 49 kB  |
| 核心 + 委托单线和成交标记 | 约 47 kB  |
| 核心 + 回放               | 约 45 kB  |
| 核心 + 成交量分布         | 约 47 kB  |
| 全部                      | 约 103 kB |

各模块共用核心里的代码，所以一起载入时比上面的差值加起来小。

## 建好以后再加类型

模块只能在建图时给，但模块里的类型可以随时加减。比如自己写的指标：

```ts
chart.indicators.register(myIndicator);
chart.indicators.add({ type: myIndicator.type });

chart.indicators.types(); // 现在能用的指标类型
chart.indicators.unregister(myIndicator.type);
```

画线（`chart.drawings`）、K 线变换（`chart.transforms`）和图形（`chart.series`）也是同样的 `register()`、`unregister()`、`types()`。图表上还在用的类型不能去掉，会报错并告诉你是谁在用。

想在建图时就带上自己的类型，或者给图表加一整块自己的功能，见[自定义模块](custom-modules.md)。

## 全部载入

不在乎体积，或者先试试看，就全部载入：

```ts
import { createChart } from '@kumochart-sdk/core';
import { allModules } from '@kumochart-sdk/core/all';

const chart = createChart(container, { modules: allModules() });
```

不用打包工具时引入的 `kumochart.iife.js` 也是全部载入的，见[快速开始](getting-started.md#不用打包工具)。

## 在 TypeScript 里

图表的类型跟着它的模块走：载入了指标模块，`chart.indicators` 才有类型；没载入就用，编译时就会报错。

要在别处写这个图表的类型，用 `Chart` 加上模块的类型：

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

全部载入的图表是 `Chart<AllModules>`（`AllModules` 从 `@kumochart-sdk/core/all` 导入）。只写 `Chart` 就是没有任何模块的图表，每个图表都能当它用。

## 保存的状态和模块

`chart.saveState()` 存下的状态里有各个模块的部分，比如指标和画线。恢复时图表要有同样的模块：状态里有画线，而图表没有画线模块，`loadState()` 会报错，图表保持原样。见[保存和恢复](state.md)。

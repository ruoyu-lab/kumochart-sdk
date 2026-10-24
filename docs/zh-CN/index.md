# KumoChart

开源的交易图表 SDK：核心只有 K 线和坐标，指标、画线、提醒、回放按需加载。

```ts live height=460 collapsed
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, VOL, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, VOL, MACD]), drawings(allDrawings)],
  latestPrice: { countdown: true }
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });
chart.indicators.add({ type: 'MACD' });
```

```bash
npm install @kumochart-sdk/core
```

## 从这里开始

- [快速开始](getting-started.md)：安装，画出第一个图表，接上实时数据。
- [模块](modules.md)：指标、画线、提醒、回放怎么按需载入。
- [数据](data.md)和[周期和交易日历](timeframes.md)：K 线、逐笔成交，浏览器里合成任意周期。
- [指标](indicators.md)、[画线](drawings.md)：50 种指标，38 种画线工具。
- [Vue](vue.md)、[React](react.md)：组件和组合函数。
- [API 参考](../api.md)：每个函数、每个选项。

Apache-2.0 许可，源码在 [GitHub](https://github.com/ruoyu-lab/kumochart-sdk)。

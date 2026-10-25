# KumoChart

[English](README.md) · 简体中文

开源的交易图表 SDK：核心只有 K 线和坐标，指标、画线、提醒、回放按需加载。

- **核心小**：K 线、坐标、多窗格、十字线、图例、缩放平移、周期合成，gzip 后约 44 kB。
- **按需加载**：50 种指标、51 种画线、10 种图表类型、提醒、委托单线、回放、成交量分布，每个模块可以整块载入，也可以只挑几项。
- **实时**：K 线和逐笔成交实时推进来；给 1 分钟 K 线，浏览器里合成任意周期，支持交易时段和时区。
- **能扩展**：自定义指标、画线、图形、K 线变换和插件，和内置的一样好用。
- **Vue 和 React** 组件，TypeScript 类型完整，没有其它依赖。

## 安装

```bash
npm install @kumochart-sdk/core
```

## 用法

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});

chart.data.set(bars, { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'MACD' });
chart.drawings.startTool('trend-line');
```

## 文档

[docs.kumochart.com](https://docs.kumochart.com/zh-CN/)

## 许可

[Apache-2.0](LICENSE)。在网站或应用里用了 KumoChart 的话，请照 [NOTICE](NOTICE) 说的，在用户看得到的地方注明并链接到 [kumochart.com](https://kumochart.com)。

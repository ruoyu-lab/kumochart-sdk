# 介绍

KumoChart 是开源的交易图表 SDK：核心只有 K 线和坐标，指标、画线、提醒、回放按需加载。

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

## 能做什么

核心自带：

- 11 种基础图形：蜡烛、空心蜡烛、美国线、高低线、折线、阶梯线、带点折线、面积、基线、HLC 面积、柱状。
- 多个窗格：主图和任意多个副图，每个窗格可以有多个价格坐标，支持对数、百分比和指数化坐标。
- 十字线、图例、缩放和平移，鼠标、触控板、触屏和键盘都能操作。
- 周期合成：给 1 分钟 K 线，浏览器里合成 5 分钟、1 小时、日线等任意周期；可以设交易时段和时区。
- 逐笔成交实时合进 K 线，历史 K 线向左滚动时按需加载。
- 保存和恢复：图表的布局、指标、画线一次存下来，一次恢复。

模块里有：

| 模块               | 内容                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 指标               | 50 种，从均线、MACD、RSI 到一目均衡表、VWAP、SuperTrend                         |
| 画线               | 38 种，趋势线、通道、斐波那契、江恩、形态、多空仓位等                           |
| 图表类型           | 平均 K 线、砖形、范围 K 线、新价线、卡吉、点数图，按成交笔数或成交量生成的 K 线 |
| 提醒               | 价格或指标穿过某个价位、另一条线或一个通道时提醒，价位线可以在图上拖动          |
| 委托单线和成交标记 | 在图上显示和拖动委托单，在 K 线上标出成交                                       |
| 回放               | 从历史上某一根 K 线开始逐根播放                                                 |
| 成交量分布         | 每个价位成交了多少：屏幕上的 K 线、每个交易日，或者用户框出的一段时间           |

另外有 [Vue](vue.md) 和 [React](react.md) 组件。

不够用的地方都可以自己扩展：[自定义指标](custom-indicators.md)、[画线](custom-drawings.md)、[图形](custom-series.md)，或者直接在画布上[绘制](plugins.md)。

## 核心和模块

`createChart()` 建出来的图表只有核心。要用的功能作为模块传进去，每个模块可以整块载入，也可以只挑几项：

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(container, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});
```

没有载入的部分不会打包进你的代码。核心压缩后约 44 kB（gzip），全部载入约 103 kB。详见[模块](modules.md)。

## 浏览器支持

Chrome、Edge 99 以上，Firefox 112 以上，Safari 16 以上（包括 iOS）。

图表需要浏览器。指标、画线和成交量分布的数值计算不需要，可以在 Node.js 里单独用，比如在服务器上算指标、判断提醒。

## 许可

Apache-2.0，可以免费用在商业产品里。在网站或应用里用了 KumoChart 的话，请在用户看得到的地方（比如页脚或「关于」页）注明，并链接到 [kumochart.com](https://kumochart.com)，比如写「图表由 KumoChart 提供」。图表上不显示任何标志。

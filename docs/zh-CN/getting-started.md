# 快速开始

<!-- code-prelude
declare const socket: WebSocket;
declare const trade: { time: number; price: number; size: number };
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

## 安装

```bash
npm install @kumochart-sdk/core
```

用 Vue 或 React 的话，再装对应的组件包，见 [Vue](vue.md)、[React](react.md)。

## 第一个图表

图表会铺满它的容器，并跟着容器的大小变化，所以容器要有高度：

```html
<div id="chart" style="height: 480px"></div>
```

建图，放进 K 线：

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars());
```

每根 K 线是一个对象：

```ts
const bar = {
  time: 1767225600000, // 毫秒时间戳，也可以是 ISO 字符串或 Date
  open: 87512.3,
  high: 87650,
  low: 87480.1,
  close: 87601.5,
  volume: 132.4 // 可以不给，默认 0
};
```

K 线要按时间从早到晚排好，时间不能重复。

## 切换周期

告诉图表 K 线是几分钟的，它就能在浏览器里合成更大的周期，不用再向服务器要一份：

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

`setTimeframe(null)` 回到原始周期。周期的写法、交易时段和时区见[周期和交易日历](timeframes.md)。

## 加上指标和画线

指标和画线在模块里，建图时传进去：

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

chart.indicators.add({ type: 'MA' }); // 画在主图上
chart.indicators.add({ type: 'MACD' }); // 自己开一个副图

// 让用户在图上画一条趋势线：点两下
chart.drawings.startTool('trend-line');
```

只载入用到的几种，打包出来的代码就只有这几种。也可以整块载入，见[模块](modules.md)。

## 实时更新

新的 K 线用 `update()` 推进来：时间和最后一根相同就替换它，比它晚就接在后面：

```ts
socket.onmessage = (message) => {
  const bar = JSON.parse(message.data);
  chart.data.update(bar);
};
```

如果拿到的是逐笔成交，直接交给图表，它会合进当前这根 K 线，到点了自己开新的一根。这需要 `data.set()` 时给了 K 线的 `interval`：

```ts
chart.data.addTrades({ time: trade.time, price: trade.price, size: trade.size });
```

## 加载更多历史

用户往左拖到快没有 K 线时，图表发出 `loadMore` 事件，把更早的 K 线用 `prepend()` 加到前面：

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` 是现在第一根 K 线的时间。加进去之后第一根变了，用户再往左拖，就会再发一次。

## 不用打包工具

直接在页面里引入一个脚本，所有模块都在全局的 `KumoChart` 里：

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

这个脚本包含全部功能，gzip 后约 112 kB。指标名字的中文、日文、韩文（见[指标](indicators.md#多语言)）另放在一个约 6 kB 的脚本里，要用再引入，它在全局的 `KumoChartIndicatorTexts` 里：

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

## 销毁

图表从页面上拿掉时调用 `destroy()`，它会移除自己的元素，解除所有监听和计时器：

```ts
chart.destroy();
```

销毁以后再调用图表上的任何方法都会报错，读取也一样；再调用一次 `destroy()` 没有影响。

## 接下来

- [模块](modules.md)：哪些功能在哪个模块，怎么按需载入。
- [数据](data.md)：K 线、逐笔成交、周期合成的细节。
- [外观](appearance.md)：主题、颜色、坐标轴、十字线。

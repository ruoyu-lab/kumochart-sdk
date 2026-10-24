# 窗格

图表从上到下分成几个窗格：最上面是主图（id 是 `main`），下面是副图。每个窗格有自己的价格坐标，共用底部的时间轴。

## 副图

最常见的副图是指标自己开的：MACD、RSI 这类指标默认 `pane: 'new'`，加上时自动开一个副图，最后一个占用它的指标去掉时副图也跟着去掉。

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

也可以自己建窗格，再把指标或图形放进去：

```ts
chart.panes.add({ id: 'oscillators', title: '震荡指标', height: 160 });
chart.indicators.add({ type: 'RSI', pane: 'oscillators' });
chart.indicators.add({ type: 'STOCH', pane: 'oscillators' });
```

自己建的窗格不会自动去掉。`id` 不给的话图表从 `pane-1` 起编号，`add()` 返回它。

```ts
chart.panes.list(); // 从上到下的全部窗格，主图在最前
chart.panes.update('oscillators', { height: 200 });
chart.panes.move('oscillators', 1); // 移到主图下面第一个
chart.panes.remove('oscillators'); // 要先去掉里面的指标和图形，里面的画线一起删掉
```

主图占剩下的高度，设它的高度没有用。高度放不下时，其他窗格按比例变矮，每个窗格（主图也一样）不矮于 `minHeight`。用户可以拖动窗格之间的分隔线调整高度：分隔线跟着鼠标走，别的窗格不动，被压矮的窗格就记下现在的高度。拖完，每个高度变了的窗格各发出一个 `paneResize`。相关的选项：

```ts
chart.applyOptions({
  panes: {
    defaultHeight: 120, // 新窗格的高度
    minHeight: 40, // 拖动时最小能到多矮
    separatorHeight: 5, // 分隔线能拖的那一条有多高
    separatorWidth: 2 // 画出来的线有多粗，0 不画
  }
});
```

## 价格坐标

每个窗格默认有一个右侧的价格坐标。`chart.priceScale()` 拿到某个窗格的某个坐标：

```ts
const scale = chart.priceScale(); // 主图的右侧坐标
const rsiScale = chart.priceScale('oscillators');
```

<!-- code-prelude
declare const scale: import('@kumochart-sdk/core').PriceScaleApi;
declare const time: number;
declare const ethBars: import('@kumochart-sdk/core').BarInput[], latestEthBar: import('@kumochart-sdk/core').BarInput;
declare const ethTrades: import('@kumochart-sdk/core').TradeInput[];
-->

### 对数、百分比、指数化

```ts
scale.setMode('log'); // 对数
scale.setMode('percent'); // 相对屏幕上第一根的涨跌幅
scale.setMode('indexed'); // 以屏幕上第一根为 100
scale.setMode('normal');
```

百分比和指数化都以当前看得见的第一根为基准，左右拖动时基准跟着变。数据不适合这种模式时（比如对数坐标遇到负数），坐标会暂时按普通模式画，`mode()` 仍然返回你设的模式。

### 缩放范围

坐标默认自动缩放，让看得见的 K 线和指标正好放下。用户拖动坐标轴、或者你设了范围，自动缩放就关了：

```ts
scale.setRange({ min: 80000, max: 95000 });
scale.isAutoScale(); // false
scale.autoScale(); // 恢复自动缩放；用户双击坐标轴也是这个效果
scale.setInverted(true); // 上下翻转
```

### 坐标换算

自己在图上叠加 HTML 元素时，用它们在价格和像素之间换算：

```ts
scale.priceToY(90000); // 相对图表左上角的 y
scale.yToPrice(120);
chart.timeScale.timeToX(time);
chart.timeScale.xToTime(300);
```

整张图表各部分的位置用 `chart.layout()` 拿。

## 一个窗格里的多个坐标

一个窗格里可以有几个坐标：`right`（默认）、`left`，或者你起的任何名字。放在 `left` 上会在左边出现一根坐标轴；其它名字是没有坐标轴的叠加坐标，自己缩放，互不影响。窗格里只有 `left` 上有东西时，右边的坐标轴始终和左边一样，画线也按它放；拖动、双击右边的坐标轴，或者用代码改 `right` 的范围，改的都是左边那个。在图上上下拖动时，移动的是手动缩放过的坐标。

最常见的用法是把成交量放在主图底部：

```ts
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 }); // 只占下面 20%
```

## 叠加图形

主图之外的数据用 `chart.series` 叠加，比如对比另一个品种、自己算好的一条线：

```ts
const eth = chart.series.add({
  type: 'line',
  pane: 'main',
  scale: 'compare', // 自己的坐标，价格差得再多也能叠在一起看
  title: 'ETH',
  data: ethBars // 和主图一样的 K 线，或者 { time, value } 这样的点
});

chart.series.updateData(eth, latestEthBar); // 实时更新
chart.series.addTrades(eth, ethTrades); // 或者直接给逐笔成交
chart.series.update(eth, { style: { color: '#c084fc' } });
chart.series.remove(eth);
chart.series.set([{ type: 'line', title: 'ETH', data: ethBars }]); // 整批替换
chart.series.clear(); // 全部去掉
```

叠加的图形按时间放在横轴上，和主图同一时间的 K 线对齐。逐笔成交和主图一样合成：蜡烛这类 K 线图形合进它的 K 线，线、面积这类数值图形每个源周期取最后一笔的价格。

只想比较涨跌幅的话，把两个都放在同一个坐标上，再把坐标设成百分比，各自从屏幕上第一根算起：

```ts
chart.series.add({ type: 'line', title: 'ETH', data: ethBars });
chart.priceScale().setMode('percent');
```

`type` 可以是核心的 11 种图形中的任何一种（见[外观](appearance.md#主图)），也可以是你注册的类型（见[自定义图形](custom-series.md)）。`pane: 'new'` 会给它单独开一个窗格。

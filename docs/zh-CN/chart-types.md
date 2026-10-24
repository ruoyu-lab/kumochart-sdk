# 图表类型

核心自带 11 种图形（蜡烛、折线、面积等，见[外观](appearance.md#主图)）。图表类型模块再加上这些：

| 类型                     | 写法            | 怎么来的                                   |
| ------------------------ | --------------- | ------------------------------------------ |
| 平均 K 线（Heikin-Ashi） | `heikinAshi`    | 每根由它和前一根平均出来，趋势更平滑       |
| 砖形图（Renko）          | `renko`         | 价格每走一格画一块砖，不管时间             |
| 范围 K 线                | `rangeBars`     | 每根的最高到最低正好是固定的幅度           |
| 新价线（Line break）     | `lineBreak`     | 收盘价突破前几根的最高或最低才画新的一根   |
| 卡吉图（Kagi）           | `kagi`          | 收盘价反向走够一定幅度才转折，粗细表示多空 |
| 点数图（Point & figure） | `pointFigure`   | 上涨画 X、下跌画 O，反向走够几格才换列     |
| 等笔 K 线                | `tickBars`      | 每若干笔成交一根                           |
| 等量 K 线                | `volumeBars`    | 每成交若干数量一根                         |
| 等额 K 线                | `turnoverBars`  | 每成交若干金额一根                         |
| 量价蜡烛                 | `volumeCandles` | 蜡烛的宽度跟着成交量变                     |

```ts live height=400
import { createChart } from '@kumochart-sdk/core';
import { chartTypes, renko } from '@kumochart-sdk/core/chart-types';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [chartTypes([renko])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.transforms.set({ type: 'renko' }); // 砖的大小默认按 14 根的平均真实波幅自动定
```

## 两种图表类型

图表类型分两种做法：

- **重新生成 K 线**：平均 K 线、砖形、范围、新价线、等笔、等量、等额，用 `chart.transforms.set()` 打开，用当前周期的 K 线生成一组新的 K 线来显示。
- **换一种画法**：量价蜡烛，用 `mainSeries.type` 切换，K 线还是原来的。

卡吉图和点数图两样都要：先生成，再换画法。

```ts
// 砖形图
chart.transforms.set({ type: 'renko', params: { box: 500 } });

// 卡吉图：生成卡吉线，再用卡吉的画法画
chart.batch(() => {
  chart.transforms.set({ type: 'kagi' });
  chart.applyOptions({ mainSeries: { type: 'kagi' } });
});

// 量价蜡烛
chart.applyOptions({ mainSeries: { type: 'volume-candles' } });

// 回到普通的 K 线
chart.transforms.set(null);
chart.applyOptions({ mainSeries: { type: 'candles' } });
```

生成出来的 K 线就是图表"显示的 K 线"：指标按它们计算，`chart.data.toArray()` 读到的也是它们。原始数据不变，关掉就回来了。

## 参数

| 类型      | `type`         | 参数                                                                                                                                                                  |
| --------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 平均 K 线 | `heikin-ashi`  | 无                                                                                                                                                                    |
| 砖形图    | `renko`        | `box` 固定砖高，或 `percentage` 最新价的百分比，都不给就按 `atrLength`（默认 14）根的平均真实波幅；`source` 用 `close`（默认）或 `ohlc`；`wicks` 是否画影线（默认是） |
| 范围 K 线 | `range`        | `range` 每根的幅度，不给就按 14 根的平均真实波幅                                                                                                                      |
| 新价线    | `line-break`   | `lines` 突破前几根（默认 3）                                                                                                                                          |
| 卡吉图    | `kagi`         | `reversal` 固定转折幅度，或 `percentage`，都不给就按 `atrLength` 根的平均真实波幅                                                                                     |
| 点数图    | `point-figure` | `box` 或 `percentage` 或 `atrLength` 定格子大小；`reversal` 反向几格换列（默认 3）；`source` 用 `close` 或 `hl`；`oneStepBack` 允许一格的列反向                       |
| 等笔 K 线 | `tick`         | `count` 每根几笔（必填）                                                                                                                                              |
| 等量 K 线 | `volume`       | `volume` 每根多少成交量（必填）                                                                                                                                       |
| 等额 K 线 | `turnover`     | `turnover` 每根多少成交额（必填）                                                                                                                                     |

### 自动的大小

不给固定的大小时，图表在生成这些 K 线的时候按最近已收盘的 K 线定大小：平均真实波幅就是到最近一根已收盘 K 线为止、`atrLength` 根（默认 14 根）的平均真实波幅（最新那根还在走，不算），百分比就是最新价的百分比，再取整到好读的数（比如 2137 取成 2000）。

之后实时推进来的 K 线不会改变大小，直到下一次重新生成：设置变换、`data.set()`、换周期、往前加载历史（`data.prepend()`）、开始回放都会重新生成，按那时最近已收盘的 K 线重新算。往前加载历史时最近的 K 线没变，大小一般也不会变。

已收盘的 K 线还不够 `atrLength` 根、算不出大小时，先什么都不画；够了，就按那一刻已收盘的 K 线定下大小，从第一根开始画出来。按百分比、从没有 K 线开始时，等第一根收盘，按它的收盘价算。

用逐笔成交生成（见下面）时，一笔成交只有一个价格，没有真实波幅：要给固定的大小或 `percentage`，范围 K 线要给 `range`，不给会报错。

自动算出来的大小可以读回来，用来在界面上显示（还算不出来时 `resolved` 是 `null`）：

```ts
chart.transforms.get();
// { type: 'renko', params: {}, input: 'bars', resolved: { box: 500, ... } }
```

## 用逐笔成交生成

等笔、等量、等额 K 线默认用当前周期的 K 线合成，一根 K 线不会被拆开。要按真正的每一笔来，设 `input: 'trades'`，再把成交交给图表：

```ts
chart.transforms.set({ type: 'tick', params: { count: 100 }, input: 'trades' });
chart.data.addTrades(trades);
```

图表会保留最近的成交来生成这些 K 线，保留多少由 `performance.maxTrades` 决定（默认 10 万笔）。这时需要 `data.set()` 时给了 K 线的 `interval`，见[数据](data.md#逐笔成交)。

## 保存

`saveState()` 会存下 K 线变换和主图的画法，恢复布局时一起设回去，见[保存和恢复](state.md)。

自己做一种 K 线变换或一种画法，见[自定义图形](custom-series.md)。

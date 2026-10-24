# 提醒

<!-- code-prelude
import type { ValueSource } from '@kumochart-sdk/core';
declare const maId: string, lineId: string, ethId: string, trendLineId: string, macdId: string, rectId: string;
declare const alertsFromServer: import('@kumochart-sdk/core/alerts').AlertInput[];
declare function notify(message: string): void;
declare function saveAlert(id: string, patch: { value: number }): void;
-->

提醒模块盯着价格、指标或画线，满足条件时发出 `alertTrigger`。固定价位的提醒在图上显示成一条线，用户可以拖动。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { alerts } from '@kumochart-sdk/core/alerts';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { modules: [alerts()] });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const last = chart.data.last()!;
chart.alerts.add({ id: 'above', trigger: 'cross-up', value: last.close * 1.01, label: '突破' });
chart.alerts.add({ id: 'below', trigger: 'cross-down', value: last.close * 0.99, label: '跌破' });
```

## 添加

```ts
chart.alerts.add({
  id: 'btc-100k', // 你的提醒 id，不给的话图表编一个
  trigger: 'cross-up', // 条件
  value: 100000, // 价位
  frequency: 'once', // 触发几次
  label: '10 万' // 线上的文字
});
```

`id` 通常就是你的应用或服务器里这条提醒的 id；不给的话图表从 `alert-1` 起编号。`add()` 返回这条提醒的 id。

```ts
chart.alerts.update('btc-100k', { value: 105000 });
chart.alerts.remove('btc-100k');
chart.alerts.set(alertsFromServer); // 整批替换
chart.alerts.clear(); // 全部去掉
chart.alerts.list();
chart.alerts.get('btc-100k'); // 带上 status：'active'、'triggered'、'disabled'
```

## 条件

| `trigger`         | 什么时候触发 |
| ----------------- | ------------ |
| `cross-up`        | 从下往上穿过 |
| `cross-down`      | 从上往下穿过 |
| `cross`           | 任意方向穿过 |
| `above`           | 在上方       |
| `below`           | 在下方       |
| `enter-channel`   | 进入通道     |
| `exit-channel`    | 离开通道     |
| `inside-channel`  | 在通道里     |
| `outside-channel` | 在通道外     |

穿过、进出是和上一次比较：上一次在下面、这一次在上面才算穿过；上一次在通道外（或正好在边上）、这一次在通道里才算进入，离开反过来。一次从通道一边跳到另一边，比如通道 100 到 110，上一次 95、这一次 115，既不算进入也不算离开。在上方、在下方、在通道里外只看这一次。

## 盯什么

`source` 是被盯着的值，默认是主图的收盘价。可以是：

```ts
const sources: ValueSource[] = [
  { kind: 'price', field: 'high' }, // 主图的某个价格
  { kind: 'indicator', id: maId, key: 'ma20' }, // 某个指标的某条线，key 不给就是第一条
  { kind: 'drawing', id: lineId }, // 一条画线（在每根 K 线上的位置），level 不给就是第一条线
  { kind: 'series', id: ethId } // 叠加的图形
];
```

`value` 是和它比较的东西：一个固定价位，或者另一个值，或者通道的两条边：

```ts
// 价格向上穿过一条趋势线
chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: trendLineId } });

// MACD 金叉：MACD 线向上穿过信号线
chart.alerts.add({
  id: 'b',
  source: { kind: 'indicator', id: macdId, key: 'macd' },
  trigger: 'cross-up',
  value: { kind: 'indicator', id: macdId, key: 'signalLine' }
});

// 价格离开一个矩形
chart.alerts.add({
  id: 'c',
  trigger: 'exit-channel',
  value: [
    { kind: 'drawing', id: rectId, level: 'top' },
    { kind: 'drawing', id: rectId, level: 'bottom' }
  ]
});
```

盯指标要载入指标模块，盯画线要载入画线模块。一条画线有哪些线可以盯，用 `chart.drawings.levels(id)` 查。被提醒盯着的指标或画线不能删，要先删提醒，否则会报错并告诉你是哪几条提醒在用。

## 触发几次

| `frequency`          | 意思                                                   |
| -------------------- | ------------------------------------------------------ |
| `once`（默认）       | 触发一次就停，状态变成 `triggered`，`rearm()` 重新打开 |
| `once-per-bar`       | 每根 K 线最多一次，满足条件的那一笔就触发              |
| `once-per-bar-close` | 只看收盘，下一根开始时判断上一根                       |
| `every-time`         | 每次更新满足条件都触发                                 |

```ts
chart.alerts.rearm('btc-100k');
chart.alerts.update('btc-100k', { enabled: false }); // 暂停
```

## 触发了

```ts
chart.on('alertTrigger', ({ id, time, value, threshold, replay }) => {
  if (replay) return; // 回放历史时触发的，通常不用通知
  notify(`${id}：${value} 穿过了 ${threshold}`);
});
```

`time` 是满足条件的那根 K 线，`value` 是被盯的值，`threshold` 是当时的价位（盯通道时是穿过的那条边）。

## 在图上拖动

固定价位的提醒显示成一条线，用户可以拖。拖动时发出 `alertDrag`，提醒跟着变，松手时留在新的价位：

```ts
chart.on('alertDrag', ({ id, phase, price }) => {
  if (phase === 'end') saveAlert(id, { value: price });
});
```

线的样子：

```ts
chart.alerts.add({
  id: 'x',
  trigger: 'cross',
  value: 98000,
  color: '#e3a33b', // 默认用主题的 alert 颜色
  lineStyle: 'dashed',
  draggable: true, // 能不能拖
  visible: true, // 显不显示线
  buttons: [{ id: 'remove', text: '✕' }] // 标签上的按钮，点击发出 buttonClick
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'alert' && buttonId === 'remove') chart.alerts.remove(id);
});
```

## 页面关了也要提醒

图表里的提醒只在页面开着时工作。要在服务器上判断，用不需要图表的计算函数：指标用 `computeIndicator()`（见[指标](indicators.md)），画线用 `computeDrawingLevels()`（见[画线](drawings.md#画线上的价位)），都能在 Node.js 里运行，算出来的值和图表上的一样。

# 委托单线和成交标记

<!-- code-prelude
declare const order: { id: string };
declare const fill: { id: string; time: number; price: number };
declare const openOrders: import('@kumochart-sdk/core/trading').OrderInput[];
declare const exchange: {
  modifyOrder(id: string, price: number): Promise<void>;
  cancelOrder(id: string): void;
};
-->

交易界面常用的两样：把挂着的委托单画成一条可以拖动的价格线，在 K 线上标出买卖成交。它们是两个模块，都在 `@kumochart-sdk/core/trading` 里，可以只载入其中一个。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { orders, markers } from '@kumochart-sdk/core/trading';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [orders(), markers()]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const bars = chart.data.toArray();
const last = bars.at(-1)!;
chart.orders.add({
  id: 'o1',
  side: 'buy',
  price: last.close * 0.99,
  label: 'LIMIT',
  quantity: 0.5
});
chart.orders.add({ id: 'o2', side: 'sell', price: last.close * 1.015, label: 'TP', quantity: 0.5 });

const entry = bars.at(-40)!;
chart.markers.add({ id: 'f1', time: entry.time, position: 'below', shape: 'arrow-up', text: '买' });
```

## 委托单线

```ts
import { orders } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [orders()] });

chart.orders.add({
  id: order.id, // 通常就是交易所或券商的委托单号
  side: 'buy', // 'buy' 或 'sell'，决定默认颜色
  price: 95000,
  label: 'LIMIT', // 标签文字，默认 BUY / SELL
  quantity: 0.25 // 显示在标签后面
});

chart.orders.update(order.id, { price: 94800 });
chart.orders.remove(order.id);
chart.orders.set(openOrders); // 用最新的挂单整批替换
```

`id` 不给的话图表从 `order-1` 起编号，`add()` 返回它；`clear()` 去掉全部委托单。

委托单的状态以交易所为准：最简单的做法是每次收到挂单变化，都用 `set()` 把全部挂单设一遍。

### 拖动改单

用户可以上下拖动委托单线。拖的时候线跟着走，松手时留在新的价格，并按阶段发出 `orderDrag`：

```ts
chart.on('orderDrag', async ({ id, phase, price, initialPrice }) => {
  if (phase !== 'end') return;

  try {
    await exchange.modifyOrder(id, price);
  } catch {
    chart.orders.update(id, { price: initialPrice }); // 改单失败，放回原来的价格
  }
});
```

拖动中按 Esc 会取消，线回到原位，发出 `phase: 'cancel'`。不想让某条单被拖动，设 `draggable: false`。

### 标签上的按钮

```ts
chart.orders.add({
  id: order.id,
  side: 'sell',
  price: 98000,
  buttons: [{ id: 'cancel', text: '✕' }]
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'order' && buttonId === 'cancel') exchange.cancelOrder(id);
});
```

按钮可以是文字（`text`），也可以是图标（`icon`，24 × 24 的 SVG 路径）。

## 成交标记

```ts
import { markers } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [markers()] });

chart.markers.add({
  id: fill.id,
  time: fill.time, // 标在这个时间所在的那根 K 线上
  position: 'below', // 'above' 最高价上方、'below' 最低价下方、'price' 在某个价格上
  shape: 'arrow-up',
  text: '买 0.25'
});
```

形状有 `arrow-up`、`arrow-down`、`triangle-up`、`triangle-down`、`circle`、`square`。颜色默认向上的用主题的 `buy`，向下的用 `sell`，圆和方块用文字颜色；也可以用 `color` 自己指定，`size` 改大小（默认 8 像素）。

标在具体价格上：

```ts
chart.markers.add({
  id: 'f2',
  time: fill.time,
  position: 'price',
  price: fill.price,
  shape: 'circle'
});
```

同样有 `update()`、`remove()`、`set()`、`clear()`、`list()`、`get()`；`id` 不给的话从 `marker-1` 起编号。

比最后一根 K 线还晚、已经过了它那个周期的标记先不画，等它那根 K 线来了再画在上面；砖形图这类不按时间的 K 线，比最后一根晚的标记都画在最后一根上。标记再多也只处理看得见的那些，几万个回测成交也不会拖慢拖动和缩放。

## 选中

委托单线和成交标记都能被点中，点中时发出 `selectionChange`，`selection.kind` 是 `'order'` 或 `'marker'`，见[交互](interaction.md#选中对象)。

委托单、成交标记不在 `saveState()` 里，它们属于你的交易数据，每次从交易所拿。

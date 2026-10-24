# 数据

<!-- code-prelude
declare const bar: import('@kumochart-sdk/core').BarInput, bar1: import('@kumochart-sdk/core').BarInput, bar2: import('@kumochart-sdk/core').BarInput;
declare const time: number;
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

主图的 K 线都通过 `chart.data` 读写。写进去的是**原始数据**；读出来的是**显示的 K 线**，也就是合成周期、K 线变换、回放之后的样子。

## K 线的格式

```ts
interface BarInput {
  time: number | string | Date; // 毫秒时间戳、ISO 8601 字符串或 Date
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // 默认 0
}
```

图表会检查每根 K 线：价格必须是有限的数字，`high` 和 `low` 要把 `open`、`close` 包在中间，成交量不能是负数，时间要从早到晚、不能重复。不对的话抛出 `ChartError`，信息里写明是第几根、哪里不对，图表保持原样。

传进去的数组图表会复制一份，之后你改它不影响图表，图表也不会改它。

## 整批设置

```ts
chart.data.set(bars);
```

换品种时再调一次 `set()` 就行，原来的 K 线全部换掉。

如果 K 线是固定周期的，最好同时告诉图表周期：

```ts
chart.data.set(bars, { interval: '1m' });
```

给了周期，图表才能在浏览器里合成更大的周期、把逐笔成交合进 K 线。见[周期和交易日历](timeframes.md)。

## 实时更新

```ts
chart.data.update(bar);
chart.data.update([bar1, bar2]); // 一次推好几根
```

时间和最后一根相同就替换它，比它晚就接在后面，比它早就报错（历史 K 线用 `set()` 或 `prepend()`）。

用户正看着最新的 K 线时，新 K 线进来图表会跟着往前走；用户往回翻看历史时，图表不动。

## 逐笔成交

拿到的是逐笔成交，就直接交给图表，它会合进当前这根 K 线，到了下一根的时间自己开新的一根：

```ts
chart.data.addTrades({ time: 1767225600123, price: 87601.5, size: 0.02 });
chart.data.addTrades(trades); // 一次给一批，按时间排好
```

`size` 是成交数量，加到 K 线的成交量上，默认 0。`side` 是主动成交的一方：`buy` 主动买入（吃掉卖单），`sell` 主动卖出，不知道就不写；按成交生成 K 线的变换会拿到它（见[自己写一种 K 线变换](custom-series.md#自己写一种-k-线变换)）。这需要 `set()` 时给了 `interval`。迟到的成交会被跳过：比最后一根 K 线还早、或者比已经给过的最新一笔还早，比如断线重连后补发的。设了交易时段的话，时段外的成交也会被跳过。`addTrades()` 返回实际用上的笔数。

按成交笔数、成交量生成的 K 线（见[图表类型](chart-types.md)）要用到成交本身，图表会保留最近的一部分，数量由 `performance.maxTrades` 决定，默认 10 万笔。

## 加载更多历史

用户往左拖到快没有 K 线时，图表发出 `loadMore` 事件：

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` 是现在第一根 K 线的时间。`prepend()` 把更早的 K 线加到前面，和已有的重叠的部分会被忽略，返回实际加了几根。加完第一根变了，用户再往左拖就会再发一次；什么也没加，就要等用户拖开再拖回来才会再发。

还剩多少根时发出，由 `timeScale.loadMoreThreshold` 决定，默认 20 根。

## 清空

```ts
chart.data.clear();
```

K 线全部移除，正在进行的回放也会结束。周期设置保留。

## 读取

```ts
chart.data.length; // 显示的 K 线有几根
chart.data.at(0); // 第一根，没有就是 null
chart.data.last(); // 最后一根
chart.data.indexOf(time); // 某个时间的那一根在第几个，没有就是 -1
chart.data.toArray(); // 全部复制成数组
```

读出来的 K 线 `time` 一律是毫秒时间戳。

要遍历很多根的话，用 `chart.data.bars`，它按列直接读，不复制：

```ts
const { bars } = chart.data;
let highest = -Infinity;

for (let i = 0; i < bars.length; i += 1) {
  highest = Math.max(highest, bars.high(i));
}
```

`chart.data.source` 是同样的视图，读的是原始周期的 K 线（回放时只到当前那一根）。

## K 线变了

显示的 K 线有任何变化（设置、更新、加载历史、切换周期、回放）都会发出 `barsChange`：

```ts
chart.on('barsChange', ({ change }) => {
  if (change.kind === 'tail') {
    // 只有第 change.from 根之后变了，或者接上了新的
  } else {
    // 'reset'：哪一根都可能变了
  }
});
```

自己根据 K 线算东西的时候，可以靠它只重算变了的那部分。

## 叠加其它数据

主图以外的数据，比如对比的另一个品种、自己算好的一条线，用 `chart.series` 叠加上去，见[窗格](panes.md#叠加图形)。

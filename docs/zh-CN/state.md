# 保存和恢复

用户在图表上加的指标、画的线、调过的窗格，可以一次存下来，下次打开时一次恢复。

```ts
// 存
const state = chart.saveState();
localStorage.setItem('layout', JSON.stringify(state));

// 恢复
const saved = localStorage.getItem('layout');
if (saved) chart.loadState(JSON.parse(saved));
```

<!-- code-prelude
declare const saved: import('@kumochart-sdk/core').ChartState;
declare const drawingsBySymbol: Record<string, import('@kumochart-sdk/core/drawings').Drawing[]>;
declare const symbol: string, next: string;
declare function barsOf(symbol: string): import('@kumochart-sdk/core').BarInput[];
-->

`saveState()` 返回的是普通对象，可以直接转成 JSON，存在浏览器里或者你的服务器上。

## 存了什么

- 主图的图形类型和画哪个价格（`mainSeries.type`、`mainSeries.source`）。
- K 线变换，比如平均 K 线、砖形图和它们的参数（`transform`）。
- 视图：K 线的宽度和离最新一根有多远。
- 窗格：有哪些、顺序、高度、标题，每个价格坐标的模式（对数、百分比等）、是否翻转、手动设的范围和上下留白。
- 各个模块自己的部分：指标模块存全部指标和它们的参数、样式；画线模块存全部画线；成交量分布模块存全部分布。

**没有**存的是属于你的应用的东西：K 线数据、周期、叠加的图形、委托单、成交标记、提醒。它们由应用自己管理，恢复布局后再设回去。

## 恢复

`loadState()` 要么全部恢复，要么什么都不改：状态里有任何一处不对，比如版本不认识、用了图表没有的指标类型、画线放在不存在的窗格里，它会报错，图表保持原来的样子。

```ts
try {
  chart.loadState(saved);
} catch (error) {
  console.warn('布局恢复失败，用默认布局', error);
}
```

恢复时图表要有同样的模块。状态里有画线，而图表没有画线模块，也会报错。

先设数据还是先恢复布局都可以，指标会跟着数据重新算。通常是建图、设数据、再恢复布局。

## 不同品种用不同的画线

画线是按时间和价格定位的，同一个品种换周期还能对上，换品种就对不上了。想让每个品种有自己的画线，又共用一套指标和窗格，就把画线单独存：

```ts
// 换品种前，存下这个品种的画线
drawingsBySymbol[symbol] = chart.drawings.list();

// 换到新品种
chart.data.set(barsOf(next), { interval: '1m' });
chart.drawings.set(drawingsBySymbol[next] ?? []);
```

`drawings.set()` 会替换全部画线，并清空撤销记录。

## 版本

状态里有 `version`，现在是 `1`。以后状态的格式变了，版本号会跟着变；`loadState()` 遇到不认识的版本会报错。

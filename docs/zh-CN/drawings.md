# 画线

<!-- code-prelude
declare const drawingToolbar: { release(type: string): void };
-->

画线模块有 38 种画线工具，用户可以在图上画，你也可以用代码画。画线按时间和价格定位，换周期、缩放、拖动都跟着 K 线走。

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

// 用最近 120 根里的最高点和最低点画一组斐波那契回撤
const bars = chart.data.toArray().slice(-120);
const high = bars.reduce((a, b) => (b.high > a.high ? b : a));
const low = bars.reduce((a, b) => (b.low < a.low ? b : a));
chart.drawings.add({
  type: 'fib-retracement',
  points: [
    { time: low.time, price: low.low },
    { time: high.time, price: high.high }
  ]
});

// 再让用户自己画一条趋势线：点两下
chart.drawings.startTool('trend-line');
```

## 载入

```ts
import {
  drawings,
  allDrawings,
  trendLine,
  horizontalLine,
  fibRetracement
} from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings(allDrawings)] }); // 全部
createChart(container, { modules: [drawings([trendLine, horizontalLine, fibRetracement])] }); // 只要这几种
```

## 让用户画

```ts
chart.drawings.startTool('rectangle');
```

用户按顺序点下每个锚点就画好了，工具随之结束；按 Esc 或右键取消。画好时先发出 `drawingsChange`（`reason: 'create'`），再发出 `toolEnd`：

```ts
chart.on('toolEnd', ({ type, completed }) => {
  drawingToolbar.release(type); // 比如让工具栏上的按钮弹起来
});
```

点在画不出东西的地方不算，工具接着等下一下：比如锚定 VWAP 点在最后一根 K 线右边，回归通道两次点在同一根 K 线上。

触屏上手指按着时锚点跟着手指走，放大镜里看得清，抬起时才落下。

工具的选项：

```ts
chart.drawings.startTool('horizontal-line', {
  style: { color: '#e8b04a', lineStyle: 'dashed' }, // 这次画的样式
  continuous: true // 画完一条不结束，接着画下一条
});

chart.drawings.activeTool(); // 正在用的工具，没有是 null
chart.drawings.cancelTool(); // 用代码结束，不发 toolEnd
```

想让每种工具记住用户上次选的样式，用 `setToolStyle()`，之后用户画的这种线都带这个样式：

```ts
chart.drawings.setToolStyle('trend-line', { color: '#5b9cf0', lineWidth: 2 });
```

### 吸附

画线时锚点可以吸到 K 线的开高低收上：

```ts
chart.applyOptions({ drawings: { magnet: 'weak' } }); // 'off'（默认）、'weak' 靠近时吸、'strong' 总是吸
```

画的时候按住 Ctrl/⌘ 临时反过来。

## 全部类型

| 分组     | 类型（锚点数）                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 线       | `trend-line` 趋势线（2）、`ray` 射线（2）、`extended-line` 延长线（2）、`arrow` 箭头（2）、`trend-angle` 趋势角度（2）、`horizontal-line` 水平线（1）、`horizontal-ray` 水平射线（1）、`vertical-line` 垂直线（1）、`cross-line` 十字线（1） |
| 通道     | `parallel-channel` 平行通道（3）、`regression-trend` 回归趋势（2）、`pitchfork` 安德鲁音叉（3）                                                                                                                                              |
| 斐波那契 | `fib-retracement` 回撤（2）、`fib-extension` 扩展（3）、`fib-channel` 通道（3）、`fib-time-zone` 时间周期（2）、`fib-speed-fan` 速度阻力扇（2）                                                                                              |
| 江恩     | `gann-box` 江恩箱（2）                                                                                                                                                                                                                       |
| 形状     | `rectangle` 矩形（2）、`circle` 圆（2）、`ellipse` 椭圆（3）、`triangle` 三角形（3）、`path` 折线（双击结束）、`brush` 画笔（按住拖动）                                                                                                      |
| 形态     | `xabcd-pattern` XABCD（5）、`head-and-shoulders` 头肩（7）、`elliott-impulse` 艾略特推动浪（6）、`elliott-correction` 艾略特调整浪（4）                                                                                                      |
| 测量     | `price-range` 价格区间（2）、`date-range` 时间区间（2）、`date-price-range` 时间价格区间（2）、`long-position` 多头仓位（3）、`short-position` 空头仓位（3）、`anchored-vwap` 锚定 VWAP（1）                                                 |
| 文字标注 | `text` 文字（1）、`callout` 标注（2）、`price-label` 价格标签（1）、`flag-mark` 旗标（1）                                                                                                                                                    |

导入时的名字是类型名的驼峰写法：`trend-line` 是 `trendLine`，`fib-retracement` 是 `fibRetracement`。

多空仓位按真实行情判断有没有打到止盈止损、算盈亏：在平均 K 线、砖形图这类由原始 K 线合成的图上，以及看大周期时，用的都是原始 K 线（回放时是已经放出来的部分）。锚定 VWAP、回归通道按图上显示的 K 线计算。

## 用代码画

```ts
const id = chart.drawings.add({
  type: 'trend-line',
  points: [
    { time: '2026-05-01T08:00:00Z', price: 94200 },
    { time: '2026-05-03T16:00:00Z', price: 96800 }
  ],
  style: { color: '#ef5d5d', lineWidth: 2, extendRight: true }
});

chart.drawings.update(id, { style: { lineStyle: 'dashed' } }); // 样式合并到原来的上面
chart.drawings.remove(id);
chart.drawings.clear(); // 全部删掉

chart.drawings.list(); // 全部画线
chart.drawings.get(id);
chart.drawings.duplicate(id); // 复制一份放在右边几根，和粘贴一样
```

<!-- code-prelude
declare const id: string;
declare const savedDrawings: import('@kumochart-sdk/core/drawings').DrawingInput[];
declare const drawing: import('@kumochart-sdk/core/drawings').Drawing;
declare function showToolbar(x: number, y: number): void;
declare function hideToolbar(): void;
-->

`points` 的数量要和类型的锚点数一致。不在主图上的画线给 `pane`，比如画在 RSI 副图上的水平线。

锚定 VWAP、回归通道、多空仓位和固定范围成交量分布用主图的 K 线计算，只能画在主图上，给别的 `pane` 会报错。

整批替换用 `set()`，它会清空撤销记录，适合加载保存的画线：

```ts
chart.drawings.set(savedDrawings);
```

从别处拿到的画线，先用 `validate()` 检查，不对会抛出和 `set()` 一样的错误，但不会加到图上。

## 样式

| 样式                                      | 说明                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `color`、`lineWidth`、`lineStyle`         | 线的颜色、粗细、线型                                                       |
| `fill`、`fillColor`                       | 矩形、通道这类封闭图形是否填充、填充色（带透明度）；不填充时点里面选不中它 |
| `textColor`、`fontSize`、`bold`、`italic` | 文字                                                                       |
| `textAlign`、`textPosition`               | 文字沿线左中右，在线的上面、线上、下面                                     |
| `extendLeft`、`extendRight`               | 线延长到图的左右边缘                                                       |
| `startArrow`、`endArrow`                  | 两端的箭头                                                                 |
| `levels`、`timeLevels`                    | 斐波那契、江恩这类工具的各条线：比例、颜色、显示与否                       |
| `source`                                  | 回归通道、锚定 VWAP 用 K 线的哪个价格计算                                  |
| `degree`                                  | 艾略特波浪的级别，决定浪的标号写法                                         |

不是每种画线都用到全部样式。做设置面板时，用 `fields(type)` 拿到这种画线有哪些样式可以改，用 `defaultStyle(type)` 拿到没设时的默认值：

```ts
chart.drawings.fields('fib-retracement'); // ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', ...]
chart.drawings.defaultStyle('fib-retracement').levels; // 默认的各条线
```

`levels` 是整个数组替换的，改一条线要把整组都给出来：

```ts
const levels = chart.drawings
  .defaultStyle('fib-retracement')
  .levels.map((level) => (level.value === 0.5 ? { ...level, color: '#ef5d5d' } : level));
chart.drawings.update(id, { style: { levels } });
```

用户在设置面板上拖滑块、连续输入时，每次改动都 `update()` 会产生很多步撤销。给同一次编辑一个相同的 `merge` 键，它们会合成一步：

```ts
chart.drawings.update(id, { style: { lineWidth: 3 } }, { merge: 'lineWidth-7' });
```

## 文字

`text`、`callout` 这类画线有文字。用户双击它就能直接在图上编辑；用代码打开编辑框：

```ts
chart.drawings.editText(id);
chart.drawings.update(id, { text: '突破' });
```

画线自己画在图上的字，比如多空仓位里的"盈亏比"，按图表的 `locale` 显示中文、英文、日文或韩文。要换掉某些字，用 `drawings.texts`。

## 锁定、隐藏、只在某些周期显示

```ts
chart.drawings.update(id, { locked: true }); // 能选中、能删除，不能拖动，也不能双击改文字
chart.drawings.update(id, { visible: false }); // 隐藏
chart.drawings.update(id, {
  // 只在 1 到 59 分钟、1 到 4 小时的周期上显示
  timeframes: { minute: { from: 1, to: 59 }, hour: { from: 1, to: 4 } }
});
chart.drawings.update(id, { timeframes: null }); // 所有周期都显示
```

要一下子隐藏所有画线（比如工具栏上的「隐藏画线」），用选项，不用逐条改：画线本身不变，也不会多出撤销步骤。

```ts
chart.applyOptions({ drawings: { visible: false } }); // true 恢复，每条照旧按自己的 visible 显示
```

隐藏期间工具不显示预览，也不放下画线，按下拖动照常平移图表；恢复显示后接着画。

`timeframes` 里没列的单位就不显示；砖形、按成交笔数这类不按时间的 K 线用 `untimed: true`。

## 撤销和重做

用户画、拖、删，以及你调用的 `add()`、`update()`、`remove()`，都会记进撤销记录：

```ts
chart.drawings.undo();
chart.drawings.redo();
chart.drawings.canUndo(); // 用来决定撤销按钮能不能点
```

键盘上是 Ctrl/⌘ + Z 和 Ctrl/⌘ + Shift + Z。用户按键撤销、重做时发出 `drawingsChange`（`reason: 'undo'`、`'redo'`）；你调用 `undo()`、`redo()` 不发。

不要撤销功能时关掉记录，按键和 `undo()` 都不再起作用：

```ts
chart.applyOptions({ drawings: { history: false } });
```

## 选中后显示工具栏

用户选中一条画线时，你可能想在它旁边显示一个小工具栏（改颜色、删除）。`bounds(id)` 给出这条画线在图表里占的范围，延伸出去的线和标签也算在内：

```ts
chart.on('selectionChange', ({ selection }) => {
  if (selection?.kind === 'drawing') {
    const box = chart.drawings.bounds(selection.id); // { x, y, width, height }，看不见时是 null
    if (box) showToolbar(box.x + box.width / 2, box.y);
  } else {
    hideToolbar();
  }
});
```

画线随视图移动，位置会变，可以在 `visibleRangeChange` 时再取一次。

## 画线上的价位

`levels(id)` 列出一条画线里能被提醒盯住的线，比如矩形的 `top` 和 `bottom`、斐波那契的各条线。设提醒时用，见[提醒](alerts.md)。

在某个比例或标准差上的线，名字就是这个数，和图上的标签一样：斐波那契、江恩的 `0.618`，回归通道的 `2`、`-2` 和基准线 `0`，锚定 VWAP 的 `vwap` 和 `1`、`-1`。

不需要图表也能算出画线的各条价位，比如在服务器上判断价格有没有碰到用户画的斐波那契线：

```ts
import { computeDrawingLevels, fibRetracement } from '@kumochart-sdk/core/drawings';

const lines = computeDrawingLevels(fibRetracement, { points: drawing.points }, bars);
// { '0': [...], '0.236': [...], ... }：每条线在每根 K 线上的价格
```

它只依赖传进去的数据，Node.js 里也能用。

## 保存

`chart.saveState()` 会存下全部画线，见[保存和恢复](state.md)。每个品种单独存画线的写法也在那一篇。

自己做一种画线，见[自定义画线](custom-drawings.md)。

# 交互

<!-- code-prelude
declare const left: import('@kumochart-sdk/core').Chart, right: import('@kumochart-sdk/core').Chart;
declare const time: number, id: string;
declare function showQuote(bar: import('@kumochart-sdk/core').Bar): void;
declare function openDrawingSettings(id: string): void;
declare function openMenu(x: number, y: number, event: import('@kumochart-sdk/core').ChartPointerEvent): void;
-->

图表自带鼠标、触控板、触屏和键盘的操作，不用写代码。这一篇讲有哪些操作、怎么关掉，以及怎么用代码移动视图、控制十字线、选中对象。

## 鼠标和触控板

| 操作                         | 效果                              |
| ---------------------------- | --------------------------------- |
| 按住拖动                     | 左右移动；松手时有惯性            |
| 滚轮上下                     | 缩放                              |
| 触控板左右滑、Shift + 滚轮   | 左右移动                          |
| 触控板双指捏合               | 缩放                              |
| 拖动时间轴                   | 改变 K 线的宽度                   |
| 拖动价格轴、在价格轴上滚滚轮 | 缩放价格                          |
| 双击价格轴                   | 恢复自动缩放                      |
| 双击时间轴                   | 恢复默认的 K 线宽度，回到最新一根 |
| 拖动窗格之间的分隔线         | 调整窗格高度                      |

缩放时哪根 K 线不动只有一条规则：正在跟随最新一根时（它在视图里），最新一根不动，缩放完继续跟随；否则用滚轮、触控板、手指捏合、拖动时间轴缩放时，鼠标（两指中间、按下的地方）下面那根不动，用键盘和 `timeScale.zoomIn()`、`zoomOut()` 缩放时，中间那根不动。

## 触屏

| 操作     | 效果                                             |
| -------- | ------------------------------------------------ |
| 单指拖动 | 左右移动                                         |
| 双指捏合 | 按两指左右的距离缩放                             |
| 长按     | 进入十字线模式，手指移动时十字线跟着走，松手退出 |

画线、拖动对象时，手指上方会出现一个放大镜，看清手指下面的位置。

## 键盘

图表获得焦点（点一下）之后：

| 按键                           | 效果                          |
| ------------------------------ | ----------------------------- |
| ← →                            | 左右移动，按住 Shift 移动半屏 |
| ↑ 或 +、↓ 或 -                 | 放大、缩小                    |
| End                            | 回到最新一根                  |
| Esc                            | 取消正在画的线、取消选中      |
| Delete、Backspace              | 删除选中的对象                |
| Ctrl/⌘ + Z                     | 撤销                          |
| Ctrl/⌘ + Shift + Z、Ctrl/⌘ + Y | 重做                          |
| Ctrl/⌘ + C、Ctrl/⌘ + V         | 复制、粘贴选中的画线          |

删除、撤销、复制这些由各个模块处理，比如画线模块管画线的撤销。按键没做任何事时（比如没有可撤销的、没有选中的），图表不拦着它，页面自己的快捷键照常用；带 Ctrl/⌘ 或 Alt 的其他按键（比如 Ctrl + - 缩放网页、Alt + ← 后退）也留给浏览器。

## 关掉某些操作

```ts
chart.applyOptions({
  interaction: {
    pan: true, // 拖动移动
    wheelZoom: true, // 滚轮和触控板缩放
    pinchZoom: true, // 触屏双指缩放
    axisScale: true, // 拖动、双击坐标轴
    kineticScroll: true, // 松手后的惯性
    keyboard: true, // 键盘操作
    longPressMs: 300, // 长按多久进入十字线模式
    touchMagnifier: true, // 触屏放大镜
    hitTolerance: 6 // 离对象多近算点中，CSS 像素
  }
});
```

做一张不能动的小图，比如列表里的缩略图，把 `pan`、`wheelZoom`、`pinchZoom`、`axisScale`、`keyboard` 都关掉。

## 用代码移动视图

`chart.timeScale` 控制横向的视图：

```ts
chart.timeScale.scrollToRealTime(); // 回到最新一根
chart.timeScale.fitContent(); // 所有 K 线放进一屏
chart.timeScale.setVisibleRange({ from: '2026-05-01', to: '2026-05-08' });
chart.timeScale.scrollToTime(time, 'center'); // 把某个时间移到中间
chart.timeScale.zoomIn();
chart.timeScale.setBarSpacing(12); // 每根 K 线 12 像素宽
chart.timeScale.reset(); // 恢复默认宽度，回到最新一根

chart.timeScale.visibleRange(); // 看得见的第一根和最后一根的时间
chart.timeScale.isFollowing(); // 最新一根在不在视图里
```

视图变化时发出 `visibleRangeChange`：

```ts
chart.on('visibleRangeChange', ({ range }) => {
  if (range) console.log(new Date(range.from), new Date(range.to));
});
```

## 十字线

鼠标在图上时十字线跟着走，同时发出 `crosshairMove`，里面有鼠标所在的时间、价格和那根 K 线。鼠标不动、但它下面的 K 线变了（键盘或惯性滚动、实时更新改了那根）时也会发出：

```ts
chart.on('crosshairMove', (event) => {
  if (event.visible && event.bar) {
    showQuote(event.bar); // 比如在页面上别处显示这根 K 线的数据
  }
});
```

不用鼠标也可以把十字线放到某个时间，比如让几张图表的十字线同步：

```ts
left.on('crosshairMove', (event) => {
  if (event.visible && event.time !== null) {
    right.crosshair.set({ time: event.time });
  } else {
    right.crosshair.set(null);
  }
});
```

`crosshair.set(null)` 把它藏起来。`crosshair.get()` 返回十字线现在的位置，隐藏时是 `null`。

## 选中对象

画线、委托单线、提醒线、成交标记都可以点中。点中时发出 `selectionChange`：

```ts
chart.on('selectionChange', ({ selection }) => {
  // { kind: 'drawing', id: 'xxx' } 这样，点空白处是 null
  if (selection?.kind === 'drawing') openDrawingSettings(selection.id);
});

chart.select({ kind: 'drawing', id }); // 用代码选中
chart.selection(); // 现在选中的
chart.select(null); // 取消选中
```

`selectionChange` 只在用户点击时发出，代码调用 `select()` 不发。

## 点击和右键菜单

`click`、`doubleClick`、`contextMenu` 告诉你点在哪里、点中了什么：

```ts
chart.on('contextMenu', (event) => {
  // event.area：'plot'、'price-axis'、'time-axis'、'separator'、'outside'
  // event.paneId、event.time、event.price：点的位置
  // event.target：点中的对象，比如 { kind: 'drawing', id, part: 'line' }，没有就是 null
  openMenu(event.x, event.y, event);
});
```

监听了 `contextMenu`，图表上就不再弹出浏览器自己的右键菜单。正在画线时右键会取消画线，不发这个事件。

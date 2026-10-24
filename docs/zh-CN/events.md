# 事件

<!-- code-prelude
declare function modifyOrder(id: string, price: number): void;
-->

用 `chart.on()` 监听，它返回一个取消监听的函数：

```ts
const off = chart.on('crosshairMove', (event) => {
  /* ... */
});

off(); // 不再监听
```

图表销毁时所有监听自动解除。

## 什么时候发出

大部分事件只在**用户操作**时发出，你自己调用 API 做的改动不会再通知你。比如用户画了一条线会发出 `drawingsChange`，你调用 `chart.drawings.add()` 不会。这样把事件里的改动存到服务器、再从服务器设回图表时，不会来回触发。

例外的是 `barsChange`、`visibleRangeChange`、`typesChange`、`optionsChange`：它们说的是图表现在的样子，不管是谁改的都会发出。

每个 API 调用发出的事件都在调用返回前、调用做完之后才派发，读取也一样：比如 `visibleRange()` 顺带算出了新的视图范围，`visibleRangeChange` 在它算完之后才发出，监听里再改图表也不影响它返回的值。

几个 API 调用想一起生效、事件只发一次，用 `batch()`：

```ts
chart.batch(() => {
  chart.data.set(bars, { interval: '1m' });
  chart.data.setTimeframe('1h');
  chart.timeScale.scrollToRealTime();
});
```

## 核心的事件

| 事件                 | 什么时候                                      | 详见                                       |
| -------------------- | --------------------------------------------- | ------------------------------------------ |
| `crosshairMove`      | 鼠标在图上移动、离开                          | [交互](interaction.md#十字线)              |
| `visibleRangeChange` | 看得见的范围变了                              | [交互](interaction.md#用代码移动视图)      |
| `loadMore`           | 快拖到最早的 K 线了                           | [数据](data.md#加载更多历史)               |
| `barsChange`         | 显示的 K 线变了                               | [数据](data.md#k-线变了)                   |
| `click`              | 单击                                          | [交互](interaction.md#点击和右键菜单)      |
| `doubleClick`        | 双击                                          | 同上                                       |
| `contextMenu`        | 右键；监听了就不弹浏览器的菜单                | 同上                                       |
| `selectionChange`    | 用户点选或取消选中对象                        | [交互](interaction.md#选中对象)            |
| `paneResize`         | 用户拖完窗格分隔线                            | [窗格](panes.md)                           |
| `legendButtonClick`  | 点了图例上的按钮                              | [外观](appearance.md#图例)                 |
| `buttonClick`        | 点了委托单、提醒标签上的按钮                  | [委托单线和成交标记](trading.md)           |
| `typesChange`        | 注册或去掉了图形、K 线变换、指标、画线的类型  | [模块](modules.md#建好以后再加类型)        |
| `optionsChange`      | 设置了选项（`applyOptions()`、`loadState()`） | [自定义模块](custom-modules.md#跟着选项变) |

## 模块的事件

载入模块后才有：

| 事件             | 模块     | 什么时候                                   |
| ---------------- | -------- | ------------------------------------------ |
| `drawingsChange` | 画线     | 用户新建、修改、删除了画线，或者撤销、重做 |
| `toolEnd`        | 画线     | 用户画完了一条线，或者按 Esc、右键取消了   |
| `orderDrag`      | 委托单线 | 用户拖动委托单线                           |
| `alertDrag`      | 提醒     | 用户拖动提醒线                             |
| `alertTrigger`   | 提醒     | 提醒触发了                                 |
| `replay`         | 回放     | 回放往前走了一根，或者放到了最后           |

拖动的事件按阶段发出：`start`、`move`、`end`，按 Esc 取消时是 `cancel`，里面有拖动前的价格和现在的价格：

```ts
chart.on('orderDrag', ({ id, phase, price, initialPrice }) => {
  if (phase === 'end') {
    modifyOrder(id, price); // 松手时才去改单
  }
});
```

## 在 TypeScript 里

事件名和事件内容都有类型，跟着图表的模块走：没有载入画线模块，`chart.on('drawingsChange', ...)` 编译时就会报错。

要把所有事件都转出去，比如给别的框架写组件，`@kumochart-sdk/core/all` 里的 `ALL_EVENTS` 是核心和所有模块的事件名，`AllEventMap` 是它们的类型。

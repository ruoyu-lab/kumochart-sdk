# 自定义画线

<!-- code-prelude
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
declare const zoneId: string;
-->

自己做的画线工具和内置的一样：用户可以画、拖动、选中、撤销，能存进布局，也能被提醒盯着。

一种画线要告诉图表三件事：有几个锚点、怎么画（`paint`）、鼠标在哪里算点中它（`hitTest`）。下面做一个"价格区间带"：两个锚点定出上下两条价格线，从第一个锚点一直延伸到图的右边。

```ts live height=400
import { createChart, withAlpha } from '@kumochart-sdk/core';
import {
  drawings,
  type Anchors,
  type DrawingTypeDefinition,
  type Positions
} from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const priceZone: DrawingTypeDefinition<Anchors<2>> = {
  type: 'price-zone',
  points: 2,
  // 设置面板里能改的样式
  fields: ['color', 'fillColor', 'lineWidth', 'lineStyle'],
  defaultStyle: (theme) => ({ color: theme.accent, fillColor: withAlpha(theme.accent, 0.12) }),

  paint: ({ ctx, geometry, selected }) => {
    const { box } = zone(geometry.points);
    const { style, width } = geometry;
    ctx.fillStyle = style.fillColor;
    ctx.fillRect(box.left, box.top, width - box.left, box.bottom - box.top);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = selected ? style.lineWidth + 1 : style.lineWidth;
    ctx.beginPath();
    ctx.moveTo(box.left, box.top);
    ctx.lineTo(width, box.top);
    ctx.moveTo(box.left, box.bottom);
    ctx.lineTo(width, box.bottom);
    ctx.stroke();
  },

  hitTest: (geometry, point, tolerance) => {
    const { box } = zone(geometry.points);
    if (point.x < box.left - tolerance) return null;
    const edge = Math.min(Math.abs(point.y - box.top), Math.abs(point.y - box.bottom));
    if (edge <= tolerance) return { part: 'line', distance: edge };
    if (point.y > box.top && point.y < box.bottom) return { part: 'body', distance: 0 };
    return null;
  }
};

/** 两个锚点围出来的范围，像素坐标 */
function zone([a, b]: Positions<Anchors<2>>) {
  return {
    box: { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
  };
}

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings([priceZone])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.drawings.startTool('price-zone'); // 在图上点两下试试
```

## 坐标

`paint` 和 `hitTest` 拿到的 `geometry` 里：

- `points`：锚点的像素坐标，相对于窗格的绘图区左上角，按放下的顺序。
- `anchors`：锚点的时间和价格。
- `width`、`height`：绘图区的大小。
- `style`：这条画线最终的样式（默认值加上它自己的）。
- `valueToY`、`yToValue`、`timeToX`：价格、时间和像素之间换算，画额外的线时用。
- `bars`：显示的 K 线，比如要找锚点之后的最高价。
- `formatValue`：按坐标轴的格式显示价格，画标签时用。
- `theme`、`textFont`、`measureText`：画文字时用。

按锚点数写上类型，比如 `DrawingTypeDefinition<Anchors<2>>`，`points` 和 `anchors` 就正好是两个，取出来不用判断有没有：图表保证给的锚点数和 `points` 一致。

`paint` 的 `ctx` 已经裁剪到绘图区、坐标已经平移好，直接按 CSS 像素画就行，高分屏的缩放图表已经处理了。`hovered`、`selected` 告诉你鼠标是否在它上面、是否选中，可以画得醒目一点。

## 点中

`hitTest` 返回 `null` 表示没点中；点中时返回 `part`（`line` 线上、`body` 里面）和距离。画线叠在一起，或者和委托单线、提醒线叠在一起时，点在线上的比点在里面的优先；同样点在线上（或同样在里面）的，离得近的优先，一样近时在上面的（后画的）优先。只在真正画出来的地方返回 `body`：没有填充的形状，里面不算点中，按下拖动的是图表。`tolerance` 是图表的 `interaction.hitTolerance`，默认 6 像素。

控制点（拖动改变形状的小圆点）由图表处理：默认每个锚点一个，拖动就移动那个锚点。要不一样的控制点，写 `handles()` 和 `moveHandle()`。`moveHandle()` 的第四个参数 `space` 把时间和价格换成画图用的位置（K 线序号、坐标刻度上的值），在这个空间里算，对数坐标下、K 线有缺口时控制点也正好落在指针下；第五个参数是这条画线的样式。控制点的 `id` 就是锚点序号（`'0'`、`'1'`……）时可以不写 `moveHandle()`，拖动就移动那个锚点；`id` 不是锚点序号又没写 `moveHandle()`，控制点一显示就报错。

## 更多选项

| 选项                  | 作用                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `points: 0`           | 锚点数不固定，双击或按 Enter 结束，比如折线                                                                                                 |
| `freehand`            | 按住拖动画出来，比如画笔（要配合 `points: 0`）                                                                                              |
| `place`、`complete()` | 用户只放前几个锚点，其余由你算出来，比如按目标价对称出止损价；`complete()` 要给出 `points` 个锚点，不然这一下放不下并报错                   |
| `mainPane`            | 用主图的 K 线计算（比如读 `geometry.bars`），只能画在主图上                                                                                 |
| `paintBelow()`        | 画在 K 线下面的部分，比如仓位的盈亏区域                                                                                                     |
| `editableText`        | 放下后、双击时打开文字编辑框                                                                                                                |
| `axisMarks()`         | 选中时在坐标轴上高亮哪些价格和时间，第二个参数是样式                                                                                        |
| `bounds()`            | 画线占的范围，延伸出去的线和标签也算在内，`chart.drawings.bounds()` 返回它；什么都没画时返回 `null`，用户在那里也放不下它。不写就按控制点算 |
| `levels()`            | 哪些线可以被提醒盯着                                                                                                                        |

写了 `bounds()` 的画线，范围完全在画面外时图表不画它，指针不在附近时也不对它做点中测试，所以 `bounds()` 要包住画出来的和能点中的一切。没写的每次都画、都测。

## 让提醒能盯着它

```ts no-check
levels: ([a, b]) => {
  const top = Math.max(a.price, b.price);
  const bottom = Math.min(a.price, b.price);
  const time = Math.min(a.time, b.time);
  return [
    // 两个点时间相同，就是一条水平线；extend: 'end' 一直延伸到右边
    { key: 'top', from: { time, price: top }, to: { time, price: top }, extend: 'end' },
    { key: 'bottom', from: { time, price: bottom }, to: { time, price: bottom }, extend: 'end' }
  ];
};
```

之后就能设"价格进入这个区间带"的提醒：

```ts
chart.alerts.add({
  id: 'zone',
  trigger: 'enter-channel',
  value: [
    { kind: 'drawing', id: zoneId, level: 'top' },
    { kind: 'drawing', id: zoneId, level: 'bottom' }
  ]
});
```

## 用上它

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings([...allDrawings, priceZone])] });

// 或者建好以后
chart.drawings.register(priceZone);
```

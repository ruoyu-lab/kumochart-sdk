# 插件绘制

<!-- code-prelude
declare const plugin: import('@kumochart-sdk/core').ChartPlugin;
-->

图表没有的东西，可以用插件直接画在画布上：水印、背景色块、自己算的标注。插件跟着图表一起重绘，缩放、拖动时不会错位。

```ts live height=360
import { createChart, withAlpha, type ChartPlugin } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

/** 主图正中的水印 */
function watermark(text: string): ChartPlugin {
  return {
    name: 'watermark',
    paint: ({ ctx, layer, pane, theme, font }) => {
      if (layer !== 'below' || pane.id !== 'main') return;
      ctx.font = `600 40px ${font.family}`;
      ctx.fillStyle = withAlpha(theme.text, 0.07);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };
}

const chart = createChart(document.getElementById('chart')!);
chart.plugins.add(watermark('BTCUSDT · 1h'));

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

## 怎么画

图表每次重绘时，对每个窗格调用两次 `paint`：

- `layer: 'below'`：在网格之后、K 线之前，画背景类的东西。
- `layer: 'above'`：在 K 线之后、画线和委托单线之前，画标注类的东西。

`ctx` 已经裁剪到这个窗格的绘图区、平移到它的左上角，按 CSS 像素画，高分屏的缩放已经处理好。

`paint` 拿到的上下文里有：

| 字段                              | 用途                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `pane`                            | 窗格的 id、宽高，`valueToY`、`yToValue` 价格和像素换算，`formatValue` 按坐标轴格式显示价格 |
| `bars`                            | 显示的 K 线，按列读                                                                        |
| `visible`                         | 看得见的第一根和最后一根的下标，没有 K 线时是 `null`                                       |
| `indexToX`、`xToIndex`、`timeToX` | 下标、时间和横坐标换算                                                                     |
| `barSpacing`                      | 每根 K 线占多宽                                                                            |
| `theme`、`font`                   | 当前主题和字体，配色跟着主题走                                                             |
| `source`、`cutoff`                | 原始周期的 K 线；回放时 `cutoff` 之后的不要画                                              |

只画看得见的部分，K 线再多也不会卡：

```ts
import { withAlpha, type ChartPlugin } from '@kumochart-sdk/core';

const highlightBigBars: ChartPlugin = {
  name: 'big-bars',
  paint: ({ ctx, layer, pane, bars, visible, indexToX, barSpacing, theme }) => {
    if (layer !== 'below' || pane.id !== 'main' || !visible) return;
    ctx.fillStyle = withAlpha(theme.accent, 0.08);
    for (let i = visible.from; i <= visible.to; i += 1) {
      if (bars.high(i) - bars.low(i) > 500) {
        ctx.fillRect(indexToX(i) - barSpacing / 2, 0, barSpacing, pane.height);
      }
    }
  }
};
```

## 状态和重绘

插件自己的设置变了，要让图表重画一次。`attach` 时拿到 `host`，调用 `host.repaint()`：

```ts
import type { ChartPlugin } from '@kumochart-sdk/core';

function watermark(initial: string) {
  let text = initial;
  let repaint = () => {};

  const plugin: ChartPlugin = {
    name: 'watermark',
    attach: (host) => {
      repaint = host.repaint;
    },
    paint: ({ ctx, layer, pane }) => {
      if (layer === 'below' && pane.id === 'main')
        ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };

  return {
    plugin,
    setText(next: string) {
      text = next;
      repaint();
    }
  };
}
```

`host.chart` 是图表本身，插件可以用它的全部接口，比如注册类型、监听事件。插件去掉或图表销毁时调用 `detach`，在这里解除自己的监听。

```ts
chart.plugins.add(plugin);
chart.plugins.list(); // 按绘制顺序列出插件
chart.plugins.remove('watermark');
```

## 画布还是 HTML

要能点击、能输入的东西，比如浮在图上的按钮、输入框，用 HTML 元素叠在图表上更合适：用 `chart.layout()` 拿到各个窗格的位置，用 `priceScale().priceToY()`、`timeScale.timeToX()` 换算坐标，在 `visibleRangeChange` 时更新位置。只需要看的东西用插件画在画布上，性能更好，截图时也会带上。

插件可以和自己的指标、画线类型打包成一个模块，见[自定义模块](custom-modules.md)。

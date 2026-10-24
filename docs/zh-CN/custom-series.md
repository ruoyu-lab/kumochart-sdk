# 自定义图形

<!-- code-prelude
interface DotsStyle {
  color: string;
  radius: number;
}
-->

图表怎么显示 K 线分两步：先决定显示哪些 K 线（K 线变换，比如砖形图把 K 线换成砖），再决定怎么画（图形，比如蜡烛、折线）。两步都可以自己写。

## 自己写一种画法

下面这种图形在每根 K 线的收盘价上画一个点：

```ts live height=360
import { createChart, type SeriesTypeDefinition } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

interface DotsStyle {
  color: string;
  radius: number;
}

const dots: SeriesTypeDefinition<DotsStyle> = {
  type: 'dots',
  input: 'value', // 每根一个值；'ohlc' 则拿到开高低收
  defaultStyle: (_theme, color) => ({ color, radius: 2 }),
  paint: ({ ctx, points, style }) => {
    ctx.fillStyle = style.color;
    for (let i = 0; i < points.count; i += 1) {
      const y = points.value(i);
      if (Number.isNaN(y)) continue; // 没有值的地方
      ctx.beginPath();
      ctx.arc(points.x(i), y, style.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const chart = createChart(document.getElementById('chart')!);
chart.series.register(dots);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.series.add({
  type: 'dots',
  data: chart.data.toArray().map((bar) => ({ time: bar.time, value: bar.close }))
});
```

`paint` 只会拿到看得见的那些点，坐标已经换算好：

- `points.x(i)`：第 i 个点的横坐标（K 线中心）。
- `input: 'value'` 时 `points.value(i)` 是纵坐标；`input: 'ohlc'` 时用 `points.open(i)`、`high(i)`、`low(i)`、`close(i)`，`points.isUp(i)` 是不是涨。
- `points.color(i)`：主图 `barColor` 给这一根定的颜色，没有是 `null`。
- `barSpacing`：每根 K 线占多宽，用来定柱子、蜡烛的宽度。
- `valueToY`：画额外的东西，比如一条基准线。

`ctx` 已经裁剪到绘图区、平移好，按 CSS 像素画。

`defaultStyle(theme, color)` 给出完整的默认样式：`color` 是图表分给这个图形的颜色（叠加图形按主题的 palette 依次分配），用户给的样式会合并在它上面。价格坐标除了数据还要容纳别的值时（比如柱子的起点），写 `extraExtents(style)` 返回这些值。

### 作为主图

注册过的图形也可以给主图用：

```ts
chart.applyOptions({ mainSeries: { type: 'dots' } });
```

在 TypeScript 里，主图的类型要是图表认识的名字，用声明合并告诉它：

```ts
declare module '@kumochart-sdk/core' {
  interface SeriesStyleMap {
    dots: DotsStyle;
  }
}
```

这样 `mainSeries.type: 'dots'` 和 `mainSeries.styles.dots` 都有类型检查。

## 自己写一种 K 线变换

K 线变换拿到当前周期的 K 线，一根一根地生成新的 K 线。下面这个把每 N 根合成一根：

```ts
import type { Bar, BarTransformDefinition, BarTransformStream } from '@kumochart-sdk/core';

class MergeStream implements BarTransformStream {
  constructor(
    private readonly size: number,
    private forming: Bar | null = null,
    private count = 0
  ) {}

  next(bar: Bar): readonly Bar[] {
    const f = this.forming;
    this.forming = f
      ? {
          time: f.time,
          open: f.open,
          high: Math.max(f.high, bar.high),
          low: Math.min(f.low, bar.low),
          close: bar.close,
          volume: f.volume + bar.volume
        }
      : { ...bar };
    this.count += 1;

    if (this.count < this.size) return []; // 还没凑够，没有完成的 K 线
    const done = this.forming;
    this.forming = null;
    this.count = 0;
    return [done];
  }

  current(): Bar | null {
    return this.forming; // 还在形成中的那根，画在最后
  }

  clone(): BarTransformStream {
    return new MergeStream(this.size, this.forming, this.count);
  }
}

export const mergeBars: BarTransformDefinition<{ size?: number }> = {
  type: 'merge',
  name: 'Merge',
  keepsTime: false,
  create: ({ size = 3 }) => {
    if (!Number.isInteger(size) || size < 1)
      throw new Error('merge: size must be a positive integer');
    return new MergeStream(size);
  }
};

chart.transforms.register(mergeBars);
chart.transforms.set({ type: 'merge', params: { size: 5 } });
```

几点规则：

- `next(bar, side)` 返回这根输入完成了的 K 线（可以是零根、一根或几根），按时间顺序。按逐笔成交生成时，`side` 是这笔成交主动的一方（`buy`、`sell`，不知道是 `null`）；按 K 线生成时是 `null`。用不到可以不写这个参数。
- `current()` 返回还没完成、正在形成的那根，没有就是 `null`。
- `clone()` 要复制全部状态。最新一根实时更新时，图表从更新前的副本重新算。
- `keepsTime`：每根输入正好变成一根时间相同的输出（像平均 K 线）就写 `true`，图表会保留倒计时这些依赖周期的功能；否则 `false`。
- `create(params, input, from)` 的 `input` 是即将输入的全部 K 线，可以用来算自动的大小（比如按平均真实波幅定砖高）；`from` 说明它们是什么：`'bars'` 当前周期的 K 线，或者 `'trades'` 逐笔成交。参数不对就抛出错误，`transforms.set()` 会把错误交给调用的人。

把自动算出来的参数报告出来，`chart.transforms.get().resolved` 就能读到，界面上可以显示；还算不出来时返回 `null`。在计算器上加一个方法：

```ts no-check
class MergeStream implements BarTransformStream {
  // ……上面那些方法

  resolved(): Readonly<Record<string, unknown>> {
    return { size: this.size };
  }
}
```

## 两样一起用

像卡吉图那样，生成的 K 线要用专门的画法：分别注册变换和图形，再一起打开。

```ts
chart.batch(() => {
  chart.transforms.set({ type: 'merge', params: { size: 5 } });
  chart.applyOptions({ mainSeries: { type: 'dots' } });
});
```

图形的 `paint` 里，`transform` 是变换报告的参数（`resolved`），可以用来画格子大小这类东西。

想在建图时就带上这些类型，或者打包给别的项目用，见[自定义模块](custom-modules.md)。

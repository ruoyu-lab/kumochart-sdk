# 自定义指标

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition<{ period: number }>;
-->

自己写的指标和内置的一样：能加到图上、显示在图例里、被提醒盯着、存进布局，也能在没有图表的地方计算。

## 最简单的写法

告诉图表每个值要往回看几根（`lookback`），再给一个函数用这几根算出值（`compute`）：

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, type IndicatorDefinition } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

/** 价格偏离均线的百分比 */
const DEVIATION: IndicatorDefinition<{ period: number }> = {
  type: 'DEVIATION',
  name: '均线偏离',
  pane: 'new', // 自己开一个副图；'main' 画在主图上
  precision: 2,
  params: { period: { default: 20, min: 2, max: 500, integer: true, label: '周期' } },
  outputs: () => [{ key: 'dev', label: '偏离%', plot: { kind: 'histogram', colorBy: 'sign' } }],
  levels: () => [0],
  lookback: ({ period }) => period,
  compute: (window) => {
    let sum = 0;
    for (let i = 0; i < window.length; i += 1) sum += window.price(i);
    const average = sum / window.length;
    const latest = window.price(window.length - 1);
    return [((latest - average) / average) * 100];
  }
};

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([DEVIATION])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.indicators.add({ type: 'DEVIATION' });
```

`window` 是最近的 `lookback` 根 K 线，从旧到新；`window.price(i)` 是指标设定的价格（默认收盘价），`window.bar(i)` 是整根 K 线。K 线还不够 `lookback` 根时不会调用，那几根没有值。

`compute` 返回一个数组，每个输出一个值；没有值的地方返回 `NaN`。

## 用上它

建图时和内置的放在一起：

```ts
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators([...allIndicators, DEVIATION])] });
```

或者建好以后再注册：

```ts
chart.indicators.register(DEVIATION);
chart.indicators.add({ type: 'DEVIATION', params: { period: 50 } });
```

## 逐根计算

`compute` 每根都把整个窗口重算一遍，周期长了会慢；有的指标还要记住很久以前的状态，比如 EMA。这时改写 `create`，返回一个逐根往前算的计算器：

```ts
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

/** 连续上涨或下跌了几根：涨为正，跌为负 */
class StreakStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private previous = Number.NaN,
    private streak = 0
  ) {}

  next(_bar: unknown, price: number): ArrayLike<number> {
    if (price > this.previous) this.streak = this.streak > 0 ? this.streak + 1 : 1;
    else if (price < this.previous) this.streak = this.streak < 0 ? this.streak - 1 : -1;
    else this.streak = 0;
    this.previous = price;
    this.out[0] = this.streak;
    return this.out;
  }

  clone(): IndicatorStream {
    return new StreakStream(this.previous, this.streak);
  }
}

export const STREAK: IndicatorDefinition<Record<string, never>> = {
  type: 'STREAK',
  name: '连涨连跌',
  pane: 'new',
  precision: 0,
  params: {},
  outputs: () => [{ key: 'streak', label: 'STREAK', plot: { kind: 'histogram', colorBy: 'sign' } }],
  create: () => new StreakStream()
};
```

两条规则：

- `next(bar, price)` 每根调用一次，按时间顺序。`bar` 对象会被复用，不要存它的引用，要用就把数字取出来。
- `clone()` 要复制全部状态。最新一根 K 线实时更新时，图表会从更新之前的副本重新算这一根，所以副本必须和原来的互不影响。

## 用内置的积木

EMA、标准差这些常用的计算不用自己重写。`@kumochart-sdk/core/indicators` 导出了 SDK 自己的指标用的几块积木，每块都能 `clone()`：

| 积木                          | 算什么                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `movingAverage(kind, period)` | 移动平均：`'sma'`、`'ema'`、`'rma'`、`'wma'`、`'vwma'`，和内置指标选的均线一样 |
| `StandardDeviation`           | 最近 `period` 个值的标准差                                                     |
| `RollingExtremes`             | 最近 `period` 根 K 线的最高价和最低价                                          |
| `RingBuffer`                  | 最近 `capacity` 个值，能取最大、最小、求和                                     |
| `Previous`                    | 上一个值                                                                       |

比如 EMA 上下加减几倍标准差的通道：

```ts
import type { Bar } from '@kumochart-sdk/core';
import {
  movingAverage,
  StandardDeviation,
  type BarStep,
  type IndicatorDefinition,
  type IndicatorStream
} from '@kumochart-sdk/core/indicators';

class EmaBandStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly width: number,
    private readonly average: BarStep,
    private readonly deviation: StandardDeviation
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const middle = this.average.next(price, bar); // K 线是给成交量加权的均线用的
    const spread = this.deviation.next(price) * this.width;
    this.out[0] = middle;
    this.out[1] = middle + spread;
    this.out[2] = middle - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    // 每块积木复制它自己的状态
    return new EmaBandStream(this.width, this.average.clone(), this.deviation.clone());
  }
}

export const EMA_BAND: IndicatorDefinition<{ period: number; width: number }> = {
  type: 'EMA_BAND',
  name: 'EMA 通道',
  pane: 'main',
  precision: 'price',
  params: {
    period: { default: 20, min: 2, max: 500, integer: true, label: '周期' },
    width: { default: 2, min: 0.1, max: 10, label: '倍数' }
  },
  outputs: () => [
    { key: 'basis', label: 'EMA', plot: { kind: 'line' } },
    { key: 'upper', label: '上轨', plot: { kind: 'line' } },
    { key: 'lower', label: '下轨', plot: { kind: 'line' } }
  ],
  fills: () => [{ from: 'upper', to: 'lower' }],
  create: ({ period, width }) =>
    new EmaBandStream(width, movingAverage('ema', period), new StandardDeviation(period))
};
```

均线和标准差在攒够 `period` 个值之前给 `NaN`；遇到 `NaN` 会跳过，值保持不变。`clone()` 里把每块积木各自 `clone()` 一下，计算器就复制全了。

## 输出画成什么

每个输出的 `plot`：

| `kind`      | 画法                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `line`      | 折线，`style` 可以是 `solid`、`dashed`、`dotted`，`width` 是线宽（像素，0.5 到 10，默认 1.25） |
| `segments`  | 值不变的一段画一条横线，比如每天的枢轴点；`style`、`width` 同 `line`                           |
| `histogram` | 从 0 开始的柱子，按正负（`sign`）、涨跌（`change`）或 K 线方向（`bar`）上色                    |
| `columns`   | 从另一个输出（或一个固定值）到这个值的柱子                                                     |
| `box`       | 从另一个输出到这个值的方框，比如交易时段的高低区间                                             |
| `marker`    | 在有值的 K 线上画一个形状或文字，比如金叉处的箭头                                              |
| `hidden`    | 不画，只在图例里显示、给提醒用                                                                 |

输出的其它设置：

```ts
import type { IndicatorOutput } from '@kumochart-sdk/core/indicators';

const upper: IndicatorOutput = {
  key: 'upper',
  label: 'Upper',
  plot: { kind: 'line' },
  color: '#5b9cf0', // 不给就按主题的 palette 依次取
  themeColor: 'up', // 或者用主题的涨跌色
  offset: 26, // 往右挪 26 根画，比如一目均衡表的先行带
  legend: false, // 不在图例里显示
  precision: 4, // 这个输出单独的小数位
  autoscale: false // 不参与价格坐标的自动缩放
};
```

两条线之间填色，在定义里写 `fills`，比如布林带的上下轨之间：`fills: () => [{ from: 'upper', to: 'lower' }]`。它和 `outputs` 一样按参数给，所以可以只在参数打开了上下轨时才填色；填色用到的输出这组参数没有，加指标时会报错，不会悄悄不画。

## 参数

```ts
import type { ParamSpec } from '@kumochart-sdk/core/indicators';

const params = {
  period: { default: 14, min: 1, max: 500, integer: true, label: '周期' },
  periods: { default: [5, 10, 20], min: 1, integer: true }, // 一组数字，比如多条均线
  anchor: {
    default: 1,
    // 只能取这几个值，界面上显示成下拉框
    options: [
      { value: 1, label: '日' },
      { value: 2, label: '周' }
    ]
  }
} satisfies Record<string, ParamSpec>;
```

参数都是数字或数字数组。用户给的参数会按这里的范围检查，超出范围的会报错。

## 跟着交易日算

需要按交易日、周、月重新开始的指标，比如每天重新算的 VWAP，用第二个参数里的交易日历：

```ts
import type { Bar, Calendar } from '@kumochart-sdk/core';
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

class DayHighStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly calendar: Calendar,
    private day: number | null = null,
    private high = Number.NaN
  ) {}

  next(bar: Bar): ArrayLike<number> {
    // 这根 K 线属于哪个交易日，时段外的时间是 null
    const day = this.calendar.bucket(bar.time, '1D');
    this.high = day === this.day ? Math.max(this.high, bar.high) : bar.high;
    this.day = day;
    this.out[0] = this.high;
    return this.out;
  }

  clone(): IndicatorStream {
    return new DayHighStream(this.calendar, this.day, this.high);
  }
}

const DAY_HIGH: IndicatorDefinition<Record<string, never>> = {
  type: 'DAY_HIGH',
  name: '当日最高',
  pane: 'main',
  precision: 'price',
  params: {},
  outputs: () => [{ key: 'high', label: 'DH', plot: { kind: 'segments' } }],
  create: (_params, { calendar }) => new DayHighStream(calendar)
};
```

日历就是图表的 `calendar` 选项，用户改了交易时段，指标会重新算。第二个参数里还有 `interval`，是 K 线的周期：图表合成了周期就是合成的周期，`data.set()` 没给周期时是 `null`。

## 不用图表也能算

```ts
import { computeIndicator } from '@kumochart-sdk/core/indicators';

const { dev } = computeIndicator(DEVIATION, bars, { params: { period: 50 } });
// dev[i] 是第 i 根 K 线上的值，和图表上算出来的一样
```

逐根推进用 `createIndicatorCalculator()`，适合在服务器上跟着实时数据算、判断提醒。这些都能在 Node.js 里运行。

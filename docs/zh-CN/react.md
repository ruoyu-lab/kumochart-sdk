# React

```bash
npm install @kumochart-sdk/core @kumochart-sdk/react
```

需要 React 18.3 或 19。有两种用法：`KumoChart` 组件，把数据、周期这些写成属性；`useKumoChart` 钩子，直接拿到图表对象自己操作。

## 组件

```tsx
import { KumoChart } from '@kumochart-sdk/react';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

// 放在组件外面，保证每次渲染是同一个
const modules = [indicators([MA, MACD])] as const;
const options = { locale: 'zh-CN' };

export function PriceChart({ bars, timeframe }: { bars: BarInput[]; timeframe: string }) {
  return (
    <div style={{ height: 480 }}>
      <KumoChart
        modules={modules}
        options={options}
        data={bars}
        interval="1m"
        timeframe={timeframe}
        onReady={(chart) => {
          (chart as Chart<typeof modules>).indicators.add({ type: 'MACD' });
        }}
        onCrosshairMove={(event) => console.log(event)}
      />
    </div>
  );
}
```

<!-- code-prelude
declare const modules: readonly import('@kumochart-sdk/core').ChartModule[];
-->

组件默认铺满父元素（`width: 100%; height: 100%`），父元素要有高度；也可以用 `style`、`className` 自己定。

| 属性        | 作用                                                          |
| ----------- | ------------------------------------------------------------- |
| `modules`   | 图表的模块，**只在建图时读一次**，之后改它没有效果            |
| `options`   | 图表选项，传进一个新对象就 `applyOptions()`（包括模块的选项） |
| `data`      | K 线，传进一个新数组就整批替换                                |
| `interval`  | `data` 的周期，比如 `'1m'`；切换周期、合并逐笔成交都要它      |
| `timeframe` | 显示的周期，`null` 显示原始周期                               |
| `transform` | K 线变换，比如 `{ type: 'renko' }`，`null` 关掉               |
| `orders`    | 委托单，需要 `orders()` 模块                                  |
| `markers`   | 成交标记，需要 `markers()` 模块                               |
| `alerts`    | 提醒，需要 `alerts()` 模块                                    |

图表和模块的每个事件都有对应的 `on*` 属性：`onCrosshairMove`、`onOrderDrag`、`onDrawingsChange`……；`onReady` 在图表建好、上面的属性都设好之后给你图表对象。

属性按引用比较，和 React 的 state 一样：每次渲染都写一个新的 `options={{ ... }}`，图表就每次都重新应用一遍选项。把不变的对象放在组件外面，或者用 `useMemo`。

`data` 是整批替换的，不适合实时更新。实时数据在 `onReady` 拿到图表后用 `chart.data.update()` 推。

`ref` 也能拿到图表：

```tsx
import { useRef } from 'react';
import { KumoChart } from '@kumochart-sdk/react';
import type { Chart } from '@kumochart-sdk/core';

const chartRef = useRef<Chart | null>(null);

<KumoChart ref={chartRef} modules={modules} />;
// chartRef.current 是图表对象，建好前是 null
```

## 钩子

需要完全自己控制，或者想要带模块类型的图表对象，用 `useKumoChart`：

```tsx
import { useEffect } from 'react';
import { useKumoChart } from '@kumochart-sdk/react';
import type { BarInput } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const chartOptions = { modules: [indicators(allIndicators)] };

export function PriceChart({ bars }: { bars: BarInput[] }) {
  const [ref, chart] = useKumoChart(chartOptions);

  useEffect(() => {
    chart?.data.set(bars, { interval: '1m' });
  }, [chart, bars]);

  return (
    <>
      <button onClick={() => chart?.indicators.add({ type: 'RSI' })}>RSI</button>
      <div ref={ref} style={{ height: 480 }} />
    </>
  );
}
```

`ref` 给要放图表的元素，元素出现时建图，消失时销毁；`chart` 在那之前是 `null`。除了 `modules`，传进新的选项对象会自动应用，所以选项对象要保持稳定。

## 注意

- `modules` 只在建图时用。要换模块，就换一个组件实例（比如换一个 `key`）。
- 服务器端渲染时图表只在浏览器里建，服务器上只输出一个空的 `div`。

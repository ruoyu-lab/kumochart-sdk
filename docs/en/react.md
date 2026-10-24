# React

```bash
npm install @kumochart-sdk/core @kumochart-sdk/react
```

For React 18.3 or 19. Two ways to use it: the `KumoChart` component, with the data, timeframe and the rest as props; or the `useKumoChart` hook, which gives you the chart to drive yourself.

## The component

```tsx
import { KumoChart } from '@kumochart-sdk/react';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

// Outside the component, so that every render passes the same objects
const modules = [indicators([MA, MACD])] as const;
const options = { locale: 'en-US' };

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

The component fills its parent (`width: 100%; height: 100%`), which needs a height; `style` and `className` set others.

| Prop        | What it does                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `modules`   | The chart's modules, **read once, when the chart is created**                                         |
| `options`   | The chart's options, applied with `applyOptions()` when a new object comes (those of the modules too) |
| `data`      | The bars; a new array replaces them all                                                               |
| `interval`  | The interval of `data`, such as `'1m'`, for timeframes and trades                                     |
| `timeframe` | The displayed timeframe; `null` shows the source interval                                             |
| `transform` | A bar transform, such as `{ type: 'renko' }`; `null` turns it off                                     |
| `orders`    | Orders, with the `orders()` module                                                                    |
| `markers`   | Fill markers, with the `markers()` module                                                             |
| `alerts`    | Alerts, with the `alerts()` module                                                                    |

Every event of the chart and its modules has an `on*` prop: `onCrosshairMove`, `onOrderDrag`, `onDrawingsChange`…; `onReady` gives you the chart once it is created and the props above are applied.

Props compare by reference, as React state does: a new `options={{ ... }}` on every render applies the options on every render. Keep objects that do not change outside the component, or in `useMemo`.

`data` replaces every bar, which does not suit real-time data: push real-time bars with `chart.data.update()` on the chart `onReady` gives you.

A ref gives the chart too:

```tsx
import { useRef } from 'react';
import { KumoChart } from '@kumochart-sdk/react';
import type { Chart } from '@kumochart-sdk/core';

const chartRef = useRef<Chart | null>(null);

<KumoChart ref={chartRef} modules={modules} />;
// chartRef.current is the chart, null until it is created
```

## The hook

For full control, or a chart typed after its modules, use `useKumoChart`:

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

`ref` goes to the element for the chart: the chart is created when the element appears and destroyed when it goes, and `chart` is `null` before. All options but `modules` are applied when a new object comes, so keep the object stable.

## Notes

- `modules` are used when the chart is created. For other modules, use another instance of the component (give it another `key`, for example).
- With server-side rendering the chart is created in the browser only; on the server it renders an empty `div`.

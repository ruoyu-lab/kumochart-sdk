# Vue

```bash
npm install @kumochart-sdk/core @kumochart-sdk/vue
```

For Vue 3.5 or later. Two ways to use it: the `KumoChart` component, with the data, timeframe and the rest as props; or the `useKumoChart` composable, which gives you the chart to drive yourself.

## The component

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

const modules = [indicators([MA, MACD])] as const;
const bars = ref<BarInput[]>([]);
const timeframe = ref('15m');

fetch('/api/bars')
  .then((response) => response.json())
  .then((list: BarInput[]) => {
    bars.value = list;
  });

function onReady(chart: Chart) {
  const typed = chart as Chart<typeof modules>;
  typed.indicators.add({ type: 'MACD' });
}
</script>

<template>
  <div style="height: 480px">
    <KumoChart
      :modules="modules"
      :options="{ locale: 'en-US' }"
      :data="bars"
      interval="1m"
      :timeframe="timeframe"
      @ready="onReady"
      @crosshair-move="(event) => console.log(event)"
    />
  </div>
</template>
```

The component fills its parent, which needs a height.

| Prop        | What it does                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------- |
| `modules`   | The chart's modules, **read once, when the chart is created**                                |
| `options`   | The chart's options, applied with `applyOptions()` as they change (those of the modules too) |
| `data`      | The bars; another array replaces them all                                                    |
| `interval`  | The interval of `data`, such as `'1m'`, for timeframes and trades                            |
| `timeframe` | The displayed timeframe; `null` shows the source interval                                    |
| `transform` | A bar transform, such as `{ type: 'renko' }`; `null` turns it off                            |
| `orders`    | Orders, with the `orders()` module                                                           |
| `markers`   | Fill markers, with the `markers()` module                                                    |
| `alerts`    | Alerts, with the `alerts()` module                                                           |

Every event of the chart and its modules is emitted as such (`@crosshair-move`, `@order-drag`, `@drawings-change`…), and `@ready` gives you the chart once it is created and the props above are applied.

`data` replaces every bar, which does not suit real-time data: a new array for each bar sets them all again. Push real-time bars with `chart.data.update()` on the chart `@ready` gives you.

A template ref gives the chart too:

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const modules = [indicators(allIndicators)];
const view = useTemplateRef<InstanceType<typeof KumoChart>>('view');
// view.value?.chart is the chart, null until it is created
</script>

<template>
  <KumoChart ref="view" :modules="modules" />
</template>
```

## The composable

For full control, or a chart typed after its modules, use `useKumoChart`:

```vue
<script setup lang="ts">
import { useTemplateRef, watch } from 'vue';
import { useKumoChart } from '@kumochart-sdk/vue';
import { darkTheme, lightTheme, type BarInput } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const props = defineProps<{ bars: BarInput[]; dark: boolean }>();

const container = useTemplateRef<HTMLDivElement>('container');
const chart = useKumoChart(container, () => ({
  modules: [indicators(allIndicators)],
  theme: props.dark ? darkTheme : lightTheme // applied as it changes
}));

watch([chart, () => props.bars], ([instance, bars]) => {
  instance?.data.set(bars, { interval: '1m' });
});

function addRsi() {
  chart.value?.indicators.add({ type: 'RSI' }); // typed
}
</script>

<template>
  <div ref="container" style="height: 480px"></div>
</template>
```

`chart` is a `ShallowRef`: the chart is created once the component is mounted, `null` before, and destroyed on unmount. The options can be an object, a ref or a function; all but `modules` are applied as they change.

## Notes

- Keep the chart out of `reactive()` and deep `ref()`s, whose proxies slow it down; `useKumoChart` already returns a `shallowRef`.
- `modules` are used when the chart is created. For other modules, use another instance of the component (give it another `key`, for example).
- With server-side rendering the chart is created in the browser only; on the server the component renders an empty `div`.

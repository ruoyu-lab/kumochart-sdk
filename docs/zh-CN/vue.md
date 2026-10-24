# Vue

```bash
npm install @kumochart-sdk/core @kumochart-sdk/vue
```

需要 Vue 3.5 以上。有两种用法：`KumoChart` 组件，把数据、周期这些写成属性；`useKumoChart` 组合函数，直接拿到图表对象自己操作。

## 组件

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
      :options="{ locale: 'zh-CN' }"
      :data="bars"
      interval="1m"
      :timeframe="timeframe"
      @ready="onReady"
      @crosshair-move="(event) => console.log(event)"
    />
  </div>
</template>
```

组件铺满它的父元素，父元素要有高度。

| 属性        | 作用                                                     |
| ----------- | -------------------------------------------------------- |
| `modules`   | 图表的模块，**只在建图时读一次**，之后改它没有效果       |
| `options`   | 图表选项，变了就 `applyOptions()`（包括模块的选项）      |
| `data`      | K 线，换一个数组就整批替换                               |
| `interval`  | `data` 的周期，比如 `'1m'`；切换周期、合并逐笔成交都要它 |
| `timeframe` | 显示的周期，`null` 显示原始周期                          |
| `transform` | K 线变换，比如 `{ type: 'renko' }`，`null` 关掉          |
| `orders`    | 委托单，需要 `orders()` 模块                             |
| `markers`   | 成交标记，需要 `markers()` 模块                          |
| `alerts`    | 提醒，需要 `alerts()` 模块                               |

图表和模块的所有事件都能用 `@事件名` 监听（`@crosshair-move`、`@order-drag`、`@drawings-change`……），另外 `@ready` 在图表建好、上面的属性都设好之后给你图表对象。

`data` 是整批替换的，不适合实时更新：每来一根就换一个数组会把全部 K 线重设一遍。实时数据在 `@ready` 拿到图表后用 `chart.data.update()` 推。

用 `ref` 也能拿到图表：

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const modules = [indicators(allIndicators)];
const view = useTemplateRef<InstanceType<typeof KumoChart>>('view');
// view.value?.chart 是图表对象，建好前是 null
</script>

<template>
  <KumoChart ref="view" :modules="modules" />
</template>
```

## 组合函数

需要完全自己控制，或者想要带模块类型的图表对象，用 `useKumoChart`：

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
  theme: props.dark ? darkTheme : lightTheme // 变了会自动 applyOptions
}));

watch([chart, () => props.bars], ([instance, bars]) => {
  instance?.data.set(bars, { interval: '1m' });
});

function addRsi() {
  chart.value?.indicators.add({ type: 'RSI' }); // 有类型
}
</script>

<template>
  <div ref="container" style="height: 480px"></div>
</template>
```

`chart` 是一个 `ShallowRef`：组件挂载后建图，在那之前是 `null`；卸载时自动销毁。选项可以是对象、`ref` 或者函数，除了 `modules`，其它选项变了都会自动应用。

## 注意

- 图表对象不要放进 `reactive()` 或深层的 `ref()`，Vue 的代理会让它变慢，`useKumoChart` 返回的已经是 `shallowRef`。
- `modules` 只在建图时用。要换模块，就换一个组件实例（比如给组件换一个 `key`）。
- 服务器端渲染时图表只在浏览器里建，组件在服务器上只输出一个空的 `div`。

# @kumo-charts/vue

The `KumoChart` component and the `useKumoChart` composable for Vue 3, around [`@kumo-charts/core`](https://www.npmjs.com/package/@kumo-charts/core).

```bash
npm install @kumo-charts/core @kumo-charts/vue
```

```vue
<script setup lang="ts">
import { KumoChart } from '@kumo-charts/vue';
import { indicators, MACD } from '@kumo-charts/core/indicators';

const modules = [indicators([MACD])];
defineProps<{ bars: { time: number; open: number; high: number; low: number; close: number }[] }>();
</script>

<template>
  <div style="height: 480px">
    <KumoChart :modules="modules" :data="bars" interval="1m" timeframe="15m" />
  </div>
</template>
```

Documentation: [docs.kumochart.com/en/vue](https://docs.kumochart.com/en/vue/) · [中文](https://docs.kumochart.com/zh-CN/vue/)

Apache-2.0 License. If you use KumoChart in a website or an app, please credit it with a link to [kumochart.com](https://kumochart.com), as NOTICE asks.

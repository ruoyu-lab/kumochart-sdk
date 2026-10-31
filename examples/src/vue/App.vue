<script setup lang="ts">
import { lightTheme, type BarInput, type Chart, type PriceDragEvent } from '@kumo-charts/core';
import { indicators, MA, MACD } from '@kumo-charts/core/indicators';
import { orders as ordersModule, type OrderInput } from '@kumo-charts/core/trading';
import { KumoChart } from '@kumo-charts/vue';
import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { sampleBars, streamTrades } from '../data';

const TIMEFRAMES = ['1m', '5m', '15m', '1h'] as const;
const MODULES = [indicators([MA, MACD]), ordersModule()] as const;

const bars = shallowRef<BarInput[]>(sampleBars(3000));
const timeframe = ref<string>('15m');
const lastClose = bars.value[bars.value.length - 1]?.close ?? 0;
const orders = ref<OrderInput[]>([
  { id: 'buy', side: 'buy', price: Math.round(lastClose * 0.995), label: 'LIMIT', quantity: 1 }
]);
let stop: (() => void) | null = null;

function onReady(instance: Chart): void {
  const chart = instance as Chart<typeof MODULES>;
  chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20] } });
  chart.indicators.add({ type: 'MACD' });
  stop = streamTrades((trades) => chart.data.addTrades(trades));
}

/** The order keeps the price the user dragged it to. */
function onOrderDrag({ id, phase, price }: PriceDragEvent): void {
  if (phase === 'end') {
    orders.value = orders.value.map((order) => (order.id === id ? { ...order, price } : order));
  }
}

onBeforeUnmount(() => {
  stop?.();
});
</script>

<template>
  <header>
    <strong>KumoChart · Vue 3</strong>
    <button
      v-for="item in TIMEFRAMES"
      :key="item"
      type="button"
      :class="{ active: timeframe === item }"
      @click="timeframe = item"
    >
      {{ item }}
    </button>
  </header>
  <main class="chart">
    <KumoChart
      :modules="MODULES"
      :data="bars"
      interval="1m"
      :timeframe="timeframe"
      :orders="orders"
      :options="{ theme: lightTheme, latestPrice: { countdown: true } }"
      @ready="onReady"
      @order-drag="onOrderDrag"
    />
  </main>
</template>

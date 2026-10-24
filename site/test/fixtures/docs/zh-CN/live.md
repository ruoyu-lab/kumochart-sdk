# 可操作的图表

下面的图表能拖动、缩放，也能用鼠标滚轮。数据是币安 BTCUSDT 一个月的 1 分钟 K 线，图表自己合成 15 分钟线。

## 周期合成

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, VOL } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, VOL])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'MA', params: { periods: [20, 60] } });
chart.indicators.add({ type: 'VOL' });
```

## 按成交生成 K 线

每 50 笔成交合成一根 K 线。

```ts live height=320 collapsed
import { createChart } from '@kumochart-sdk/core';
import { chartTypes, tickBars } from '@kumochart-sdk/core/chart-types';
import { loadBars, loadTrades } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [chartTypes([tickBars])]
});

const bars = await loadBars();
chart.data.set(bars.slice(-120), { interval: '1m' });
chart.data.addTrades(await loadTrades());
chart.transforms.set({ type: 'tick', params: { count: 50 }, input: 'trades' });
```

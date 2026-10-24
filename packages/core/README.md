# @kumochart-sdk/core

An open-source SDK for trading charts: the core holds the bars and the scales, and indicators, drawings, alerts and replay load when you need them.

```bash
npm install @kumochart-sdk/core
```

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD])]
});

chart.data.set(bars, { interval: '1m' });
chart.indicators.add({ type: 'MACD' });
```

Documentation: [docs.kumochart.com](https://docs.kumochart.com/en/) · [中文文档](https://docs.kumochart.com/zh-CN/)

Apache-2.0 License. If you use KumoChart in a website or an app, please credit it with a link to [kumochart.com](https://kumochart.com), as NOTICE asks.

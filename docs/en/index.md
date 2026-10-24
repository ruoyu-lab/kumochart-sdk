# KumoChart

An open-source SDK for trading charts: the core holds the bars and the scales, and indicators, drawings, alerts and replay load when you need them.

```ts live height=460 collapsed
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, VOL, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, VOL, MACD]), drawings(allDrawings)],
  latestPrice: { countdown: true }
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });
chart.indicators.add({ type: 'MACD' });
```

```bash
npm install @kumochart-sdk/core
```

## Where to start

- [Getting started](getting-started.md): install it, draw a first chart, connect real-time data.
- [Modules](modules.md): loading indicators, drawings, alerts and replay as you need them.
- [Data](data.md) and [Timeframes and calendars](timeframes.md): bars, trades, and any timeframe built in the browser.
- [Indicators](indicators.md) and [Drawings](drawings.md): 50 indicators, 38 drawing tools.
- [Vue](vue.md) and [React](react.md): components and composables.
- [API reference](../api.md): every function and option.

Apache-2.0 licensed; the source is on [GitHub](https://github.com/ruoyu-lab/kumochart-sdk).

# KumoChart

English · [简体中文](README.zh-CN.md)

An open-source SDK for trading charts: the core holds the bars and the scales, and indicators, drawings, alerts and replay load when you need them.

- **A small core**: bars, scales, panes, crosshair, legend, zoom and pan, and timeframes, about 44 kB gzipped.
- **Modules as you need them**: 63 indicators, 51 drawing tools, 10 chart types, alerts, order lines, replay and volume profiles, each whole or only the parts you pick.
- **Real time**: bars and trades stream in; give it 1-minute bars and it builds any timeframe in the browser, following trading sessions and time zones.
- **Extensible**: indicators, drawings, series types, bar transforms and plugins of your own work like the built-in ones.
- **Vue and React** components, complete TypeScript types, no dependencies.

## Install

```bash
npm install @kumochart-sdk/core
```

## Use

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});

chart.data.set(bars, { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'MACD' });
chart.drawings.startTool('trend-line');
```

## Documentation

[docs.kumochart.com](https://docs.kumochart.com/en/)

## License

[Apache-2.0](LICENSE). If you use KumoChart in a website or an app, please credit it with a link to [kumochart.com](https://kumochart.com), as [NOTICE](NOTICE) asks.

# KumoChart

オープンソースのトレーディングチャート SDK です。コアにはローソク足とスケールだけが入っていて、インジケーター、描画、アラート、リプレイは必要なときに読み込みます。

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

## まずはここから

- [クイックスタート](getting-started.md)：インストールして最初のチャートを描き、リアルタイムデータにつなぎます。
- [モジュール](modules.md)：インジケーター、描画、アラート、リプレイを必要な分だけ読み込む方法。
- [データ](data.md)と[時間足と取引カレンダー](timeframes.md)：ローソク足と約定（ティック）、ブラウザ上で任意の時間足を合成する方法。
- [インジケーター](indicators.md)、[描画ツール](drawings.md)：50 種類のインジケーターと 38 種類の描画ツール。
- [Vue](vue.md)、[React](react.md)：コンポーネントとコンポーザブル。
- [API リファレンス](../api.md)：すべての関数とオプション。

Apache-2.0 ライセンスで、ソースコードは [GitHub](https://github.com/ruoyu-lab/kumochart-sdk) にあります。

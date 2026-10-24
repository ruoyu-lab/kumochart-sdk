# クイックスタート

<!-- code-prelude
declare const socket: WebSocket;
declare const trade: { time: number; price: number; size: number };
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

## インストール

```bash
npm install @kumochart-sdk/core
```

Vue や React を使う場合は、対応するコンポーネントのパッケージもインストールします。[Vue](vue.md)、[React](react.md) を参照してください。

## 最初のチャート

チャートはコンテナいっぱいに広がり、コンテナのサイズが変わると追従します。そのため、コンテナには高さが必要です。

```html
<div id="chart" style="height: 480px"></div>
```

チャートを作成して、ローソク足を入れます。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars());
```

ローソク足は 1 本ごとに 1 つのオブジェクトです。

```ts
const bar = {
  time: 1767225600000, // ミリ秒のタイムスタンプ。ISO 文字列や Date でもかまいません
  open: 87512.3,
  high: 87650,
  low: 87480.1,
  close: 87601.5,
  volume: 132.4 // 省略可能。デフォルトは 0
};
```

ローソク足は時間の古い順に並べ、同じ時間が重複しないようにします。

## 時間足を切り替える

ローソク足が何分足なのかを伝えておけば、チャートはより長い時間足をブラウザ上で合成できます。サーバーに別のデータを要求する必要はありません。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

`setTimeframe(null)` で元の時間足に戻ります。時間足の書き方、取引セッション、タイムゾーンについては[時間足と取引カレンダー](timeframes.md)を参照してください。

## インジケーターと描画を追加する

インジケーターと描画はモジュールに入っているので、チャートの作成時に渡します。

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD]), drawings([trendLine, horizontalLine])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'MA' }); // メインペインに表示
chart.indicators.add({ type: 'MACD' }); // 専用のサブペインを開く

// ユーザーがチャート上にトレンドラインを引けるようにする：2 回クリック
chart.drawings.startTool('trend-line');
```

使う種類だけを読み込めば、バンドルされるコードもその種類だけになります。丸ごと読み込むこともできます。[モジュール](modules.md)を参照してください。

## リアルタイム更新

新しいローソク足は `update()` で送ります。時間が最後の足と同じならその足を置き換え、それより新しければ後ろに追加します。

```ts
socket.onmessage = (message) => {
  const bar = JSON.parse(message.data);
  chart.data.update(bar);
};
```

受け取るのが約定（ティック）なら、そのままチャートに渡します。チャートが現在の足に反映し、時間になると自動で新しい足を始めます。これには、`data.set()` でローソク足の `interval` を指定しておく必要があります。

```ts
chart.data.addTrades({ time: trade.time, price: trade.price, size: trade.size });
```

## 過去のデータを読み込む

ユーザーが左へドラッグしてローソク足が残り少なくなると、チャートは `loadMore` イベントを発行します。それより古いローソク足を `prepend()` で先頭に追加します。

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` は現在の最初の足の時間です。追加すると最初の足が変わるので、ユーザーがさらに左へドラッグすると、もう一度発行されます。

## バンドラーを使わない場合

ページにスクリプトを 1 つ読み込むだけで、すべてのモジュールがグローバルの `KumoChart` に入ります。

```html
<div id="chart" style="height: 480px"></div>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules()
  });
  chart.data.set(bars);
</script>
```

このスクリプトにはすべての機能が入っていて、gzip 後で約 112 kB です。インジケーター名の中国語・日本語・韓国語（[インジケーター](indicators.md#多言語)を参照）は約 6 kB の別のスクリプトに入っていて、必要なときだけ読み込みます。グローバルの `KumoChartIndicatorTexts` に入ります。

```html
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart-indicator-texts.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules({
      indicators: { texts: [KumoChartIndicatorTexts.indicatorTexts] }
    }),
    locale: 'zh-CN'
  });
</script>
```

## 破棄

チャートをページから取り除くときは `destroy()` を呼びます。チャートは自分の要素を削除し、すべてのリスナーとタイマーを解除します。

```ts
chart.destroy();
```

破棄したあとは、チャートのどのメソッドを呼んでもエラーになります（読み取りも同じです）。もう一度 `destroy()` を呼んでも何も起きません。

## 次に読む

- [モジュール](modules.md)：どの機能がどのモジュールにあるか、必要な分だけ読み込む方法。
- [データ](data.md)：ローソク足、約定（ティック）、時間足の合成の詳細。
- [外観](appearance.md)：テーマ、色、軸、クロスヘア。

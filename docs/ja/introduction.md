# 紹介

KumoChart はオープンソースのトレーディングチャート SDK です。コアにはローソク足とスケールだけが入っていて、インジケーター、描画、アラート、リプレイは必要なときに読み込みます。

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, RSI]), drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'EMA' });
chart.indicators.add({ type: 'RSI' });
```

## できること

コアに含まれるもの：

- 11 種類の基本シリーズ：ローソク足、中空ローソク足、バー、ハイロー、ライン、ステップライン、マーカー付きライン、エリア、ベースライン、HLC エリア、棒グラフ。
- 複数のペイン：メインペインと任意の数のサブペイン。ペインごとに複数の価格スケールを置け、対数、パーセント、100 基準のスケールにも対応します。
- クロスヘア、凡例、ズームとスクロール。マウス、トラックパッド、タッチスクリーン、キーボードで操作できます。
- 時間足の合成：1 分足を渡せば、5 分足、1 時間足、日足など任意の時間足をブラウザ上で合成します。取引セッションとタイムゾーンも設定できます。
- 約定（ティック）をリアルタイムでローソク足に反映し、左へスクロールしたときは過去のローソク足を必要に応じて読み込みます。
- 保存と復元：チャートのレイアウト、インジケーター、描画をまとめて保存し、まとめて復元します。

モジュールに含まれるもの：

| モジュール               | 内容                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| インジケーター           | 50 種類。移動平均線、MACD、RSI から一目均衡表、VWAP、SuperTrend まで                                     |
| 描画                     | 38 種類。トレンドライン、チャネル、フィボナッチ、ギャン、パターン、ロング・ショートポジションなど        |
| チャートタイプ           | 平均足、練行足、レンジバー、新値足、カギ足、ポイント＆フィギュア、約定数や出来高ごとに作る足             |
| アラート                 | 価格やインジケーターが指定の価格、別のライン、チャネルを抜けたときに通知。価格ラインはドラッグで動かせる |
| 注文ラインと約定マーカー | 注文をチャート上に表示してドラッグで動かし、ローソク足の上に約定を表示                                   |
| リプレイ                 | 過去のある足から 1 本ずつ再生                                                                            |
| 価格帯別出来高           | 価格ごとの出来高。画面に表示されている足、取引日ごと、またはユーザーが囲んだ期間                         |

ほかに [Vue](vue.md) と [React](react.md) のコンポーネントもあります。

足りないところは自分で拡張できます：[カスタムインジケーター](custom-indicators.md)、[描画ツール](custom-drawings.md)、[シリーズ](custom-series.md)を作ったり、キャンバスに直接[描いたり](plugins.md)できます。

## コアとモジュール

`createChart()` で作ったチャートにはコアしかありません。使いたい機能はモジュールとして渡します。モジュールは丸ごと読み込むことも、いくつかだけ選ぶこともできます。

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(container, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});
```

読み込まなかった部分はバンドルに含まれません。コアは gzip 圧縮後で約 44 kB、すべて読み込むと約 103 kB です。詳しくは[モジュール](modules.md)を参照してください。

## 対応ブラウザ

Chrome と Edge は 99 以上、Firefox は 112 以上、Safari は 16 以上（iOS を含む）です。

チャートの表示にはブラウザが必要です。インジケーター、描画、価格帯別出来高の数値計算には不要なので、Node.js で単独で使えます。たとえばサーバーでインジケーターを計算したり、アラートを判定したりできます。

## ライセンス

Apache-2.0 ライセンスで、商用製品にも無料で使えます。Web サイトやアプリで KumoChart を使う場合は、フッターや「概要」ページなどユーザーの目に触れる場所に、[kumochart.com](https://kumochart.com) へのリンク付きで記載してください（例：「Charts by KumoChart」）。チャート自体にはロゴを表示しません。

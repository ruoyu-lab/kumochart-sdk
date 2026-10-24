# ペイン

チャートは上から下へいくつかのペインに分かれます。いちばん上がメインペイン（id は `main`）で、その下がサブペインです。各ペインはそれぞれ価格スケールを持ち、下部の時間軸は共有します。

## サブペイン

最もよくあるのは、インジケーターが自分で開くサブペインです。MACD や RSI のようなインジケーターはデフォルトで `pane: 'new'` なので、追加すると自動でサブペインが開き、そこを使う最後のインジケーターを削除するとサブペインも一緒に消えます。

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, MACD, RSI, VOL } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MACD, RSI, VOL])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'VOL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

ペインを自分で作って、そこにインジケーターやシリーズを入れることもできます。

```ts
chart.panes.add({ id: 'oscillators', title: 'オシレーター', height: 160 });
chart.indicators.add({ type: 'RSI', pane: 'oscillators' });
chart.indicators.add({ type: 'STOCH', pane: 'oscillators' });
```

自分で作ったペインは自動では消えません。`id` を省略すると、チャートが `pane-1` から番号を振り、`add()` がそれを返します。

```ts
chart.panes.list(); // 上から順にすべてのペイン。メインペインが先頭
chart.panes.update('oscillators', { height: 200 });
chart.panes.move('oscillators', 1); // メインペインのすぐ下に移動
chart.panes.remove('oscillators'); // 先に中のインジケーターとシリーズを外す必要がある。中の描画は一緒に削除される
```

メインペインは残りの高さを使うので、高さを設定しても効果はありません。高さが収まらないときは、ほかのペインが比率に応じて低くなり、どのペインも（メインペインも）`minHeight` より低くなりません。ユーザーはペインの間の区切り線をドラッグして高さを調整できます。区切り線はポインターについて動き、ほかのペインは動きません。縮められていたペインは今の高さを自分の高さとして保ちます。ドラッグが終わると、高さが変わったペインごとに `paneResize` が発行されます。関連するオプションは次のとおりです。

```ts
chart.applyOptions({
  panes: {
    defaultHeight: 120, // 新しいペインの高さ
    minHeight: 40, // ドラッグで縮められる最小の高さ
    separatorHeight: 5, // 区切り線のうちドラッグできる部分の高さ
    separatorWidth: 2 // 描かれる線の太さ。0 なら描かない
  }
});
```

## 価格スケール

各ペインには、デフォルトで右側の価格スケールが 1 つあります。`chart.priceScale()` で、あるペインのあるスケールを取得します。

```ts
const scale = chart.priceScale(); // メインペインの右側のスケール
const rsiScale = chart.priceScale('oscillators');
```

<!-- code-prelude
declare const scale: import('@kumochart-sdk/core').PriceScaleApi;
declare const time: number;
declare const ethBars: import('@kumochart-sdk/core').BarInput[], latestEthBar: import('@kumochart-sdk/core').BarInput;
declare const ethTrades: import('@kumochart-sdk/core').TradeInput[];
-->

### 対数、パーセント、100 基準

```ts
scale.setMode('log'); // 対数
scale.setMode('percent'); // 画面上の最初の足からの騰落率
scale.setMode('indexed'); // 画面上の最初の足を 100 とする
scale.setMode('normal');
```

パーセントと 100 基準は、どちらも現在見えている最初の足を基準にするので、左右にドラッグすると基準も変わります。データがそのモードに合わないとき（たとえば対数スケールで負の値があるとき）は、スケールは一時的に通常モードで描かれますが、`mode()` は設定したモードを返します。

### スケールの範囲

スケールはデフォルトで自動スケールになり、見えているローソク足とインジケーターがちょうど収まるようにします。ユーザーが軸をドラッグしたり、コードで範囲を設定したりすると、自動スケールはオフになります。

```ts
scale.setRange({ min: 80000, max: 95000 });
scale.isAutoScale(); // false
scale.autoScale(); // 自動スケールに戻す。ユーザーが軸をダブルクリックしても同じ
scale.setInverted(true); // 上下を反転
```

### 座標の変換

チャートの上に HTML 要素を自分で重ねるときは、これらを使って価格とピクセルを変換します。

```ts
scale.priceToY(90000); // チャートの左上を基準にした y
scale.yToPrice(120);
chart.timeScale.timeToX(time);
chart.timeScale.xToTime(300);
```

チャート全体の各部分の位置は `chart.layout()` で取得できます。

## 1 つのペインに複数のスケール

1 つのペインに複数のスケールを置けます。`right`（デフォルト）、`left`、または自分で付けた任意の名前です。`left` に置くと左側に軸が現れます。それ以外の名前は軸のない重ね合わせ用のスケールで、それぞれ独立して拡大縮小し、互いに影響しません。ペインで `left` にだけ何かが置かれているあいだ、右側の軸は常に左のスケールと同じになり、描画もそれに沿って置かれます。右側の軸をドラッグやダブルクリックしたり、コードで `right` の範囲を変えたりすると、変わるのは左のスケールです。チャートを上下にドラッグすると、手動で拡大縮小したスケールが動きます。

最もよくある使い方は、出来高をメインペインの下部に置くことです。

```ts
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 }); // 下の 20% だけを使う
```

## シリーズを重ねる

メインのローソク足以外のデータは `chart.series` で重ねて表示します。たとえば比較用の別の銘柄や、自分で計算したラインです。

```ts
const eth = chart.series.add({
  type: 'line',
  pane: 'main',
  scale: 'compare', // 専用のスケール。価格が大きく違っても重ねて見られる
  title: 'ETH',
  data: ethBars // メインと同じ形式のローソク足、または { time, value } の点
});

chart.series.updateData(eth, latestEthBar); // リアルタイム更新
chart.series.addTrades(eth, ethTrades); // または約定をそのまま渡す
chart.series.update(eth, { style: { color: '#c084fc' } });
chart.series.remove(eth);
chart.series.set([{ type: 'line', title: 'ETH', data: ethBars }]); // まとめて置き換える
chart.series.clear(); // すべて削除
```

重ねたシリーズは時間に従って横軸に並び、メインの同じ時間の足とそろいます。約定はメインの足と同じようにまとめられます。ローソク足のような足の図形ならその足に、ラインやエリアのような値の図形なら元の周期ごとに最後の約定価格になります。

騰落率だけを比べたい場合は、両方を同じスケールに置き、そのスケールをパーセントにします。それぞれ画面上の最初の足から計算されます。

```ts
chart.series.add({ type: 'line', title: 'ETH', data: ethBars });
chart.priceScale().setMode('percent');
```

`type` にはコアの 11 種類のシリーズのどれでも指定でき（[外観](appearance.md#メインシリーズ)を参照）、自分で登録したタイプも使えます（[カスタムシリーズ](custom-series.md)を参照）。`pane: 'new'` を指定すると、専用のペインを開きます。

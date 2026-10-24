# プラグインで描く

<!-- code-prelude
declare const plugin: import('@kumochart-sdk/core').ChartPlugin;
-->

チャートにないものは、プラグインでキャンバスに直接描けます。ウォーターマーク、背景の色帯、自分で計算した注釈などです。プラグインはチャートと一緒に再描画されるので、ズームやドラッグをしても位置がずれません。

```ts live height=360
import { createChart, withAlpha, type ChartPlugin } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

/** メインペイン中央のウォーターマーク */
function watermark(text: string): ChartPlugin {
  return {
    name: 'watermark',
    paint: ({ ctx, layer, pane, theme, font }) => {
      if (layer !== 'below' || pane.id !== 'main') return;
      ctx.font = `600 40px ${font.family}`;
      ctx.fillStyle = withAlpha(theme.text, 0.07);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };
}

const chart = createChart(document.getElementById('chart')!);
chart.plugins.add(watermark('BTCUSDT · 1h'));

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

## 描き方

チャートは再描画のたびに、ペインごとに `paint` を 2 回呼びます。

- `layer: 'below'`：グリッドのあと、ローソク足の前。背景のようなものを描く。
- `layer: 'above'`：ローソク足のあと、描画と注文ラインの前。注釈のようなものを描く。

`ctx` はすでにそのペインのプロット領域にクリップされ、その左上に平行移動済みなので、CSS ピクセルで描きます。高解像度ディスプレイのスケーリングは処理済みです。

`paint` が受け取るコンテキストには、次のものが入っています。

| フィールド                        | 用途                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pane`                            | ペインの id と幅・高さ。`valueToY`、`yToValue` で価格とピクセルを換算し、`formatValue` で価格を軸と同じ書式で表示する |
| `bars`                            | 表示されている足。列ごとに読む                                                                                        |
| `visible`                         | 見えている最初と最後の足のインデックス。足がないときは `null`                                                         |
| `indexToX`、`xToIndex`、`timeToX` | インデックス・時間と横座標の換算                                                                                      |
| `barSpacing`                      | 1 本の足が占める幅                                                                                                    |
| `theme`、`font`                   | 現在のテーマとフォント。配色をテーマに合わせられる                                                                    |
| `source`、`cutoff`                | 元の時間足のローソク足。リプレイ中は `cutoff` より後を描かないこと                                                    |

見えている部分だけを描けば、足がどれだけ多くても重くなりません。

```ts
import { withAlpha, type ChartPlugin } from '@kumochart-sdk/core';

const highlightBigBars: ChartPlugin = {
  name: 'big-bars',
  paint: ({ ctx, layer, pane, bars, visible, indexToX, barSpacing, theme }) => {
    if (layer !== 'below' || pane.id !== 'main' || !visible) return;
    ctx.fillStyle = withAlpha(theme.accent, 0.08);
    for (let i = visible.from; i <= visible.to; i += 1) {
      if (bars.high(i) - bars.low(i) > 500) {
        ctx.fillRect(indexToX(i) - barSpacing / 2, 0, barSpacing, pane.height);
      }
    }
  }
};
```

## 状態と再描画

プラグイン自身の設定が変わったら、チャートに再描画させる必要があります。`attach` のときに `host` を受け取り、`host.repaint()` を呼びます。

```ts
import type { ChartPlugin } from '@kumochart-sdk/core';

function watermark(initial: string) {
  let text = initial;
  let repaint = () => {};

  const plugin: ChartPlugin = {
    name: 'watermark',
    attach: (host) => {
      repaint = host.repaint;
    },
    paint: ({ ctx, layer, pane }) => {
      if (layer === 'below' && pane.id === 'main')
        ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };

  return {
    plugin,
    setText(next: string) {
      text = next;
      repaint();
    }
  };
}
```

`host.chart` はチャートそのもので、プラグインはそのすべての API を使えます。たとえばタイプを登録したり、イベントを監視したりできます。プラグインが外されたときやチャートが破棄されたときには `detach` が呼ばれるので、そこで自分のリスナーを解除します。

```ts
chart.plugins.add(plugin);
chart.plugins.list(); // 描く順にプラグインを返す
chart.plugins.remove('watermark');
```

## キャンバスか HTML か

クリックや入力ができるもの、たとえばチャートの上に浮かぶボタンや入力欄は、HTML 要素をチャートに重ねるほうが向いています。`chart.layout()` で各ペインの位置を取得し、`priceScale().priceToY()`、`timeScale.timeToX()` で座標を換算し、`visibleRangeChange` のときに位置を更新します。見るだけのものはプラグインでキャンバスに描くほうが性能がよく、スクリーンショットにも含まれます。

プラグインは、独自のインジケーターや描画のタイプと一緒に 1 つのモジュールにまとめられます。[カスタムモジュール](custom-modules.md)を参照してください。

# 外観

<!-- code-prelude
import { darkTheme } from '@kumochart-sdk/core';
declare const EYE_ICON: string, CLOSE_ICON: string;
-->

チャートの見た目はすべてオプションで決まります。作成時に渡し、あとから `applyOptions()` でいつでも変更できます。

```ts
const chart = createChart(container, {
  theme: darkTheme,
  grid: { vertical: false },
  latestPrice: { countdown: true }
});

chart.applyOptions({ crosshair: { mode: 'magnet' } });
chart.options(); // 現在のすべてのオプション
```

`applyOptions()` は渡した項目だけを変更し、ほかはそのままにします。配列と関数は丸ごと置き換えます。オプション名を間違えたり値が正しくなかったりするとエラーになり、チャートはそのままです。

設定していないオプションは `null` です（`locale`、`timeZone`、`legend.rows`、`panes.separatorColor` など）。一度設定したものをデフォルトに戻すには、`chart.applyOptions({ locale: null })` のように `null` を設定し直します。`texts` の各単語や `mainSeries.styles` の各チャートタイプのスタイルも同じです。

## テーマ

ライトの `lightTheme`（デフォルト）とダークの `darkTheme` が組み込まれています。ダークにするには `theme: darkTheme` を渡します。

```ts live height=320
import { createChart, darkTheme } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { theme: darkTheme });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
```

テーマは色のセットです。ローソク足、インジケーター、描画で個別に色を設定していないところは、すべてここから色を取ります。組み込みテーマをもとに、いくつかの項目を変えるだけで済みます。

```ts
import { lightTheme } from '@kumochart-sdk/core';

// 上昇を赤、下落を緑にする
const theme = {
  ...lightTheme,
  up: '#ef5d5d',
  down: '#2fb57e',
  volumeUp: 'rgba(239, 93, 93, 0.4)',
  volumeDown: 'rgba(47, 181, 126, 0.4)'
};

createChart(container, { theme });
```

| 色                         | 使われる場所                                     |
| -------------------------- | ------------------------------------------------ |
| `background`               | 背景                                             |
| `text`、`textMuted`        | 軸や凡例の文字、補助的な文字                     |
| `grid`、`border`           | グリッド線、ペインの区切り線                     |
| `crosshair`                | クロスヘア                                       |
| `crosshairLabelBackground` | 軸上のクロスヘアのラベルの背景色                 |
| `crosshairLabelText`       | ラベルの文字                                     |
| `up`、`down`               | 上昇・下落の足と数値                             |
| `volumeUp`、`volumeDown`   | 上昇・下落の出来高バー                           |
| `accent`                   | 選択中のオブジェクト、ドラッグするハンドル       |
| `palette`                  | インジケーター、描画、重ねたシリーズが順に使う色 |
| `buy`、`sell`              | 買い注文・売り注文と約定マーカー                 |
| `alert`                    | アラートライン                                   |

`withAlpha(color, 0.3)` で色に透明度を付けられます。配色を考えるときに便利です。

色は `#26a69a`、`rgb(38 166 154)`、`rgba(38, 166, 154, 0.5)`、`teal` など、CSS のどの書き方でも指定できます。渡した時点でチェックされ、テーマ、スタイル、インジケーター、描画、アラートなどの色を書き間違えると、描画のときではなくその場でフィールド名付きのエラーになります。チャートなしの計算（Node.js など）では色を描かないため、文字列かどうかだけをチェックします。アプリ独自の設定の色をチャートと同じようにチェックするには、`checkColor(フィールド名, 値)` を使います。

## メインシリーズ

メインシリーズはデフォルトでローソク足です。コアには 11 種類のシリーズがあり、次のようにタイプを切り替えます。

```ts
chart.applyOptions({ mainSeries: { type: 'line' } });
```

| タイプ           | 見た目             |
| ---------------- | ------------------ |
| `candles`        | ローソク足         |
| `hollow-candles` | 中空ローソク足     |
| `ohlc`           | バー               |
| `high-low`       | ハイロー           |
| `line`           | ライン             |
| `step-line`      | ステップライン     |
| `line-markers`   | マーカー付きライン |
| `area`           | エリア             |
| `baseline`       | ベースライン       |
| `hlc-area`       | HLC エリア         |
| `columns`        | 棒グラフ           |

ラインのように 1 つの価格だけを描くシリーズでは、どの価格を描くかを `mainSeries.source` で決めます。`open`、`high`、`low`、`close`（デフォルト）、`hl2`、`hlc3`、`ohlc4` のいずれかです。

スタイルはシリーズごとに別々に保存されるので、タイプを切り替えてもそれぞれのスタイルは保たれます。

```ts
chart.applyOptions({
  mainSeries: {
    styles: {
      candles: { upColor: '#ffffff', border: true, bodyRatio: 0.7 },
      line: { color: '#5aa9fa', lineWidth: 2 }
    }
  }
});
```

設定していないスタイルはテーマから取られ、テーマを変えると一緒に変わります。各シリーズにどんなスタイルがあるかは [API リファレンス](../api.md#SeriesStyleMap)を参照してください。

特定の足にだけ色を付けたいとき、たとえば出来高が急増した足を目立たせたいときは、`mainSeries.barColor` を使います。

```ts
chart.applyOptions({
  mainSeries: {
    barColor: ({ bar }) => (bar.volume > 500 ? '#e8b04a' : null) // null なら元の色
  }
});
```

## グリッドとクロスヘア

```ts
chart.applyOptions({
  grid: { vertical: false, horizontal: true, style: 'dashed' },
  crosshair: {
    mode: 'magnet', // 横線を終値に吸着させる。'free' はマウスに追従
    labels: true, // 軸に時間と価格を表示
    style: 'dashed'
  }
});
```

線の種類はどれも `'solid'`、`'dashed'`、`'dotted'` の 3 つです。

## 軸

```ts
chart.applyOptions({
  priceScale: {
    margins: { top: 0.1, bottom: 0.08 }, // 自動スケール時に上下に空ける余白。ペインの高さに対する比率
    precision: 2, // 価格の小数点以下の桁数。デフォルトの 'auto' はデータから推定
    minWidth: 48 // 軸の最小幅。ラベルが長くなると自動で広がる
  },
  timeScale: {
    barSpacing: 8, // 最初の状態での足 1 本あたりの幅
    minBarSpacing: 0.5,
    maxBarSpacing: 60,
    rightOffset: 60 // 最新の足の右側に空ける幅
  }
});
```

`margins` と各スケールの `setMargins()` は同じルールです。上下それぞれ 0 以上、合計 0.9 以下で、データのために少なくともペインの高さの 10 分の 1 を残します。

幅や高さはすべて CSS ピクセルです。

### 表示形式を自分で決める

価格と時間の文字列は自分で書けます。

```ts
chart.applyOptions({
  priceScale: {
    formatter: (value, { precision }) => `$${value.toFixed(precision)}`
  },
  timeScale: {
    formatter: (time, { kind, unit }) => {
      const date = new Date(time);
      if (kind === 'crosshair') return date.toLocaleString('ja-JP');
      return unit === 'day'
        ? `${date.getMonth() + 1}月${date.getDate()}日`
        : date.toTimeString().slice(0, 5);
    }
  }
});
```

時間の `kind` は `axis`（軸の目盛り）か `crosshair`（クロスヘアのラベル）です。`unit` は目盛りがどの単位の区切りに当たるかで、年、月、日、時、分、秒のいずれかです。指定しなければ、`locale` と `timeZone` に従って自動でフォーマットします。フォーマット関数が受け取る `locale` と `timeZone` は実際に使われているものです。設定していなければ、ブラウザの言語とローカルのタイムゾーンになります。

## 現在値

右側の価格軸に表示される現在値のラベルと水平線です。

```ts
chart.applyOptions({
  latestPrice: {
    line: true,
    label: true,
    countdown: true, // ラベルの下に、この足が確定するまでの残り時間を表示
    style: 'dotted',
    color: null // null なら最新の足の上昇・下落に合わせて色が変わる
  }
});
```

カウントダウンは足が一定の期間を表すときだけ表示されます。リプレイ中やレンコなどでは表示されません。最新の足がすでに確定しているとき（データが止まった、市場が閉まっているなど）も表示されず、新しい足が来ると再び数え始めます。

## 凡例

凡例は各ペインの左上にあり、マウスの位置にある足（または最新の足）の四本値とインジケーターの値を表示します。インジケーターの行は名前とパラメーター、続いて各ラインの値を表示します。ラインが 1 本だけのインジケーター（RSI や期間 1 つの MA など）は名前でどのラインか分かるので、値の前にライン名を付けません。

```ts
chart.applyOptions({
  legend: {
    visible: true,
    // 各行にマウスを重ねたときに表示するボタン
    buttons: (item) =>
      item.kind === 'indicator'
        ? [
            { id: 'hide', icon: EYE_ICON },
            { id: 'remove', icon: CLOSE_ICON }
          ]
        : []
  }
});

chart.on('legendButtonClick', ({ item, buttonId }) => {
  if (buttonId === 'remove') chart.indicators.remove(item.id);
  if (buttonId === 'hide') chart.indicators.update(item.id, { visible: false });
});
```

ボタンの `icon` は 24 × 24 の SVG パス（`<path d="...">` の中の文字列）で、どのアイコンライブラリにもあります。

デフォルトでは、表示中のインジケーターと重ねたシリーズだけが並びます。非表示のものも並べたい場合（グレーで表示され、また表示に戻しやすくなります）は、`rows` を使います。

```ts
chart.applyOptions({ legend: { rows: () => true } });
```

## ウォーターマーク

メインペインの中央に、銘柄や時間足など 1〜2 行の大きな文字を表示できます。ローソク足の下に薄く描くので、邪魔になりません。ウォーターマークモジュールを使い、文字はオプションで設定します。

```ts
import { createChart } from '@kumochart-sdk/core';
import { watermark } from '@kumochart-sdk/core/watermark';

const chart = createChart(container, {
  modules: [watermark()],
  watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
});

chart.applyOptions({ watermark: { lines: [{ text: 'ETHUSDT' }, { text: '4h', size: 20 }] } });
```

`lines` は上から順に並び、`size` は文字の大きさ（デフォルト 40）です。`color` を指定しなければ、テーマの文字色を薄くして使います。銘柄や時間足を切り替えるときは、`applyOptions()` で `lines` をまとめて置き換えます。

## 言語と文字

```ts
createChart(container, {
  locale: 'ja-JP', // 数値と日付の形式。デフォルトはブラウザに従う
  texts: {
    legendOpen: '始',
    legendHigh: '高',
    legendLow: '安',
    legendClose: '終',
    legendVolume: '出来高',
    days: (count) => `${count}日` // カウントダウンに表示する日数
  }
});
```

チャートがキャンバスに描く文字は、デフォルトでは `O H L C V` のようにどの言語でも通じる表記です。必要なら `texts` で置き換えます。

## フォント

```ts
chart.applyOptions({ font: { family: 'Inter, sans-serif', size: 12 } });
```

## スクリーンショット

```ts
const canvas = chart.screenshot();
canvas.toBlob((blob) => {
  /* ダウンロードまたはアップロード */
});
```

`screenshot()` は、チャート全体を描いた canvas を返します。すべてのペインと軸が含まれます。

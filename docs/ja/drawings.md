# 描画ツール

<!-- code-prelude
declare const drawingToolbar: { release(type: string): void };
-->

描画モジュールには 38 種類の描画ツールがあり、ユーザーがチャート上で描くことも、コードから描くこともできます。描画は時間と価格で位置が決まるので、時間足を切り替えても、ズームやドラッグをしても、ローソク足に合わせて動きます。

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

// 直近 120 本の最高値と最安値でフィボナッチ・リトレースメントを描く
const bars = chart.data.toArray().slice(-120);
const high = bars.reduce((a, b) => (b.high > a.high ? b : a));
const low = bars.reduce((a, b) => (b.low < a.low ? b : a));
chart.drawings.add({
  type: 'fib-retracement',
  points: [
    { time: low.time, price: low.low },
    { time: high.time, price: high.high }
  ]
});

// さらにユーザーにトレンドラインを描いてもらう：2 回クリックする
chart.drawings.startTool('trend-line');
```

## 読み込み

```ts
import {
  drawings,
  allDrawings,
  trendLine,
  horizontalLine,
  fibRetracement
} from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings(allDrawings)] }); // すべて
createChart(container, { modules: [drawings([trendLine, horizontalLine, fibRetracement])] }); // この数種類だけ
```

## ユーザーに描いてもらう

```ts
chart.drawings.startTool('rectangle');
```

ユーザーが各アンカーを順にクリックすると描画が完成し、ツールはそこで終わります。Esc キーか右クリックでキャンセルできます。完成すると、まず `drawingsChange`（`reason: 'create'`）が発生し、続いて `toolEnd` が発生します。

```ts
chart.on('toolEnd', ({ type, completed }) => {
  drawingToolbar.release(type); // たとえばツールバーのボタンを元の状態に戻す
});
```

何も描けない場所でのクリックは数えず、ツールは次のクリックを待ちます。たとえば最後のローソク足より右に置いたアンカー VWAP や、始まりと同じ足で終わる回帰トレンドです。

タッチ画面では、指で押しているあいだアンカーが指についてきて（ルーペで確認できます）、指を離したところに置かれます。

ツールのオプションは次のとおりです。

```ts
chart.drawings.startTool('horizontal-line', {
  style: { color: '#e8b04a', lineStyle: 'dashed' }, // 今回描くもののスタイル
  continuous: true // 1 本描き終えてもツールを終えず、続けて次を描く
});

chart.drawings.activeTool(); // 使用中のツール。なければ null
chart.drawings.cancelTool(); // コードから終了する。toolEnd は発生しない
```

ツールごとにユーザーが前回選んだスタイルを覚えさせたいときは `setToolStyle()` を使います。以降ユーザーが描くそのタイプの描画には、このスタイルが付きます。

```ts
chart.drawings.setToolStyle('trend-line', { color: '#5b9cf0', lineWidth: 2 });
```

### マグネット

描画中、アンカーをローソク足の四本値（始値・高値・安値・終値）に吸着させることができます。

```ts
chart.applyOptions({ drawings: { magnet: 'weak' } }); // 'off'（デフォルト）、'weak' 近づいたときに吸着、'strong' 常に吸着
```

描いている最中に Ctrl/⌘ を押し続けると、一時的にこの設定が反転します。

## すべてのタイプ

| グループ       | タイプ（アンカー数）                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ライン         | `trend-line` トレンドライン（2）、`ray` レイ（2）、`extended-line` 延長線（2）、`arrow` 矢印（2）、`trend-angle` トレンド角度（2）、`horizontal-line` 水平線（1）、`horizontal-ray` 水平レイ（1）、`vertical-line` 垂直線（1）、`cross-line` 十字線（1） |
| チャネル       | `parallel-channel` 平行チャネル（3）、`regression-trend` 回帰トレンド（2）、`pitchfork` アンドリューズ・ピッチフォーク（3）                                                                                                                              |
| フィボナッチ   | `fib-retracement` リトレースメント（2）、`fib-extension` エクステンション（3）、`fib-channel` チャネル（3）、`fib-time-zone` タイムゾーン（2）、`fib-speed-fan` スピード・レジスタンス・ファン（2）                                                      |
| ギャン         | `gann-box` ギャン・ボックス（2）                                                                                                                                                                                                                         |
| 図形           | `rectangle` 長方形（2）、`circle` 円（2）、`ellipse` 楕円（3）、`triangle` 三角形（3）、`path` パス（ダブルクリックで終了）、`brush` ブラシ（押したままドラッグ）                                                                                        |
| パターン       | `xabcd-pattern` XABCD（5）、`head-and-shoulders` ヘッド・アンド・ショルダー（7）、`elliott-impulse` エリオット推進波（6）、`elliott-correction` エリオット修正波（4）                                                                                    |
| 計測           | `price-range` 価格範囲（2）、`date-range` 日付範囲（2）、`date-price-range` 日付と価格の範囲（2）、`long-position` ロングポジション（3）、`short-position` ショートポジション（3）、`anchored-vwap` アンカー VWAP（1）                                   |
| テキスト・注釈 | `text` テキスト（1）、`callout` 吹き出し（2）、`price-label` 価格ラベル（1）、`flag-mark` 旗マーク（1）                                                                                                                                                  |

インポートするときの名前は、タイプ名をキャメルケースにしたものです。`trend-line` は `trendLine`、`fib-retracement` は `fibRetracement` になります。

ロング・ショートポジションは、利確・損切りに届いたかどうかと損益を実際の値動きで判断します。平均足や練行足のように元の足から作るチャートや、長い時間足で見ているときも、元の足（リプレイ中はすでに表示された分）を使います。アンカー VWAP と回帰トレンドは、チャートに表示されている足で計算します。

## コードで描く

```ts
const id = chart.drawings.add({
  type: 'trend-line',
  points: [
    { time: '2026-05-01T08:00:00Z', price: 94200 },
    { time: '2026-05-03T16:00:00Z', price: 96800 }
  ],
  style: { color: '#ef5d5d', lineWidth: 2, extendRight: true }
});

chart.drawings.update(id, { style: { lineStyle: 'dashed' } }); // スタイルは元のスタイルにマージされる
chart.drawings.remove(id);
chart.drawings.clear(); // すべて削除

chart.drawings.list(); // すべての描画
chart.drawings.get(id);
chart.drawings.duplicate(id); // 数本右に複製を置く。貼り付けと同じ
```

<!-- code-prelude
declare const id: string;
declare const savedDrawings: import('@kumochart-sdk/core/drawings').DrawingInput[];
declare const drawing: import('@kumochart-sdk/core/drawings').Drawing;
declare function showToolbar(x: number, y: number): void;
declare function hideToolbar(): void;
-->

`points` の数はタイプのアンカー数と一致させてください。メインペイン以外に置く描画には `pane` を指定します。たとえば RSI のペインに描く水平線です。

アンカー VWAP、回帰トレンド、ロング・ショートポジション、固定範囲出来高プロファイルはメインペインのローソク足から計算するため、メインペインにしか置けません。ほかの `pane` を指定するとエラーになります。

まとめて置き換えるには `set()` を使います。元に戻す履歴がクリアされるので、保存しておいた描画を読み込むのに向いています。

```ts
chart.drawings.set(savedDrawings);
```

ほかから受け取った描画は、先に `validate()` でチェックしてください。正しくなければ `set()` と同じエラーを投げますが、チャートには追加しません。

## スタイル

| スタイル                                  | 説明                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `color`、`lineWidth`、`lineStyle`         | 線の色、太さ、種類                                                                                                                         |
| `fill`、`fillColor`                       | 長方形やチャネルのような閉じた図形を塗りつぶすかどうかと、塗りつぶしの色（透明度を含む）。塗りつぶさないと内側をクリックしても選択されない |
| `textColor`、`fontSize`、`bold`、`italic` | テキスト                                                                                                                                   |
| `textAlign`、`textPosition`               | テキストを線に沿って左・中央・右のどこに置くか、線の上・線上・線の下のどこに置くか                                                         |
| `extendLeft`、`extendRight`               | 線をチャートの左右の端まで延長する                                                                                                         |
| `startArrow`、`endArrow`                  | 両端の矢印                                                                                                                                 |
| `levels`、`timeLevels`                    | フィボナッチやギャンのようなツールの各ライン：比率、色、表示するかどうか                                                                   |
| `source`                                  | 回帰チャネルやアンカー VWAP がローソク足のどの価格で計算するか                                                                             |
| `degree`                                  | エリオット波動のディグリー。波のラベルの書き方が決まる                                                                                     |

すべての描画がすべてのスタイルを使うわけではありません。設定画面を作るときは、`fields(type)` でそのタイプの変更できるスタイルを取得し、`defaultStyle(type)` で未設定のときのデフォルト値を取得します。

```ts
chart.drawings.fields('fib-retracement'); // ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', ...]
chart.drawings.defaultStyle('fib-retracement').levels; // デフォルトの各ライン
```

`levels` は配列ごと置き換わるので、1 本のラインを変えるときもセット全体を渡します。

```ts
const levels = chart.drawings
  .defaultStyle('fib-retracement')
  .levels.map((level) => (level.value === 0.5 ? { ...level, color: '#ef5d5d' } : level));
chart.drawings.update(id, { style: { levels } });
```

ユーザーが設定画面でスライダーをドラッグしたり、続けて入力したりするとき、変更のたびに `update()` を呼ぶと、元に戻す操作が何ステップにも分かれてしまいます。1 回の編集に同じ `merge` キーを渡すと、1 ステップにまとまります。

```ts
chart.drawings.update(id, { style: { lineWidth: 3 } }, { merge: 'lineWidth-7' });
```

## テキスト

`text` や `callout` のような描画にはテキストがあります。ユーザーはダブルクリックすれば、チャート上で直接編集できます。コードから編集ボックスを開くには次のようにします。

```ts
chart.drawings.editText(id);
chart.drawings.update(id, { text: 'ブレイクアウト' });
```

描画がチャートに自分で描く文字、たとえばロング・ショートポジションの「RR比」は、チャートの `locale` に従って中国語、英語、日本語、韓国語で表示されます。一部の文字を差し替えるには `drawings.texts` を使います。

## ロック・非表示・特定の時間足だけで表示

```ts
chart.drawings.update(id, { locked: true }); // 選択と削除はできるが、ドラッグもダブルクリックでのテキスト編集もできない
chart.drawings.update(id, { visible: false }); // 非表示
chart.drawings.update(id, {
  // 1〜59 分と 1〜4 時間の時間足でだけ表示
  timeframes: { minute: { from: 1, to: 59 }, hour: { from: 1, to: 4 } }
});
chart.drawings.update(id, { timeframes: null }); // すべての時間足で表示
```

ツールバーの「描画を非表示」のように、すべての描画をまとめて隠すときは、1 本ずつ変えずにオプションを使います。描画そのものは変わらず、元に戻す履歴も増えません。

```ts
chart.applyOptions({ drawings: { visible: false } }); // true で元に戻り、各描画は自分の visible に従って表示
```

非表示のあいだ、ツールはプレビューを表示せず、描画も置きません。ドラッグするとチャートはいつもどおりスクロールします。表示を戻すと続きを描けます。

`timeframes` に書かなかった単位では表示されません。練行足や約定回数で作る足のように、時間に依らないローソク足には `untimed: true` を使います。

## 元に戻す・やり直す

ユーザーが描く、ドラッグする、削除するといった操作も、あなたが呼んだ `add()`、`update()`、`remove()` も、元に戻す履歴に記録されます。

```ts
chart.drawings.undo();
chart.drawings.redo();
chart.drawings.canUndo(); // 元に戻すボタンを押せるかどうかの判定に使う
```

キーボードでは Ctrl/⌘ + Z と Ctrl/⌘ + Shift + Z です。ユーザーがキー操作で元に戻す・やり直すと `drawingsChange`（`reason: 'undo'`、`'redo'`）が発生します。コードから `undo()`、`redo()` を呼んだときは発生しません。

元に戻す機能を使わないときは履歴を切ります。キー操作も `undo()` も効かなくなります。

```ts
chart.applyOptions({ drawings: { history: false } });
```

## 選択時にツールバーを表示する

ユーザーが描画を選択したとき、そのそばに小さなツールバー（色の変更、削除）を表示したいことがあります。`bounds(id)` は、その描画がチャート内で占める範囲を、アンカーの外に伸びる線やラベルも含めて返します。

```ts
chart.on('selectionChange', ({ selection }) => {
  if (selection?.kind === 'drawing') {
    const box = chart.drawings.bounds(selection.id); // { x, y, width, height }。見えないときは null
    if (box) showToolbar(box.x + box.width / 2, box.y);
  } else {
    hideToolbar();
  }
});
```

描画はビューと一緒に動いて位置が変わるので、`visibleRangeChange` のときに取り直してください。

## 描画上の価格

`levels(id)` は、1 つの描画の中でアラートが監視できるラインを一覧にします。たとえば長方形の `top` と `bottom`、フィボナッチの各ラインです。アラートを設定するときに使います。[アラート](alerts.md)を参照してください。

比率や標準偏差の倍数にあるラインは、チャート上のラベルと同じくその数が名前になります。フィボナッチやギャンの `0.618`、回帰トレンドの `2`、`-2` と基準線の `0`、アンカー VWAP の `vwap` と `1`、`-1` です。

チャートがなくても描画の各価格ラインを計算できます。たとえばサーバーで、ユーザーが描いたフィボナッチのラインに価格が届いたかどうかを判定できます。

```ts
import { computeDrawingLevels, fibRetracement } from '@kumochart-sdk/core/drawings';

const lines = computeDrawingLevels(fibRetracement, { points: drawing.points }, bars);
// { '0': [...], '0.236': [...], ... }：各ラインの、各足での価格
```

渡したデータだけに依存するので、Node.js でも使えます。

## 保存

`chart.saveState()` はすべての描画を保存します。[保存と復元](state.md)を参照してください。銘柄ごとに描画を別々に保存する書き方も、そのページにあります。

独自の描画ツールを作るには、[カスタム描画ツール](custom-drawings.md)を参照してください。

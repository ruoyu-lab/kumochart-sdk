# データ

<!-- code-prelude
declare const bar: import('@kumochart-sdk/core').BarInput, bar1: import('@kumochart-sdk/core').BarInput, bar2: import('@kumochart-sdk/core').BarInput;
declare const time: number;
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

メインペインのローソク足は、すべて `chart.data` で読み書きします。書き込むのは**元データ**で、読み出すのは**表示されるローソク足**、つまり時間足の合成、ローソク足の変換、リプレイを経たあとの足です。

## ローソク足の形式

```ts
interface BarInput {
  time: number | string | Date; // ミリ秒のタイムスタンプ、ISO 8601 文字列、または Date
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // デフォルトは 0
}
```

チャートは足を 1 本ずつチェックします。価格は有限の数値であること、`high` と `low` が `open` と `close` を挟んでいること、出来高が負でないこと、時間が古い順に並び重複しないこと。条件を満たさない足があると `ChartError` を投げ、何本目のどこがおかしいかをメッセージで示します。チャートはそのままです。

渡した配列はチャートがコピーします。あとで配列を変更してもチャートには影響せず、チャートが配列を書き換えることもありません。

## まとめて設定する

```ts
chart.data.set(bars);
```

銘柄を切り替えるときも、もう一度 `set()` を呼ぶだけです。元のローソク足はすべて置き換わります。

ローソク足が決まった時間足なら、時間足も一緒にチャートに伝えておくのがおすすめです。

```ts
chart.data.set(bars, { interval: '1m' });
```

時間足を指定しておくと、チャートはより長い時間足をブラウザ上で合成したり、約定（ティック）をローソク足に反映したりできます。[時間足と取引カレンダー](timeframes.md)を参照してください。

## リアルタイム更新

```ts
chart.data.update(bar);
chart.data.update([bar1, bar2]); // 複数本をまとめて送る
```

時間が最後の足と同じならその足を置き換え、それより新しければ後ろに追加し、古ければエラーになります（過去のローソク足には `set()` か `prepend()` を使います）。

ユーザーが最新の足を見ているときは、新しい足が来るとチャートも一緒に進みます。ユーザーが過去にさかのぼって見ているときは、チャートは動きません。

## 約定（ティック）

受け取るのが約定（ティック）なら、そのままチャートに渡します。チャートが現在の足に反映し、次の足の時間になると自動で新しい足を始めます。

```ts
chart.data.addTrades({ time: 1767225600123, price: 87601.5, size: 0.02 });
chart.data.addTrades(trades); // まとめて渡す。時間順に並べておく
```

`size` は約定数量で、足の出来高に加算されます。デフォルトは 0 です。これには `set()` で `interval` を指定しておく必要があります。遅れて届いた約定はスキップされます。最後の足より前のもの、またはすでに渡した最新の約定より前のもので、たとえば再接続のあとに届いたものです。取引セッションを設定している場合、セッション外の約定もスキップされます。`addTrades()` は実際に使われた約定の件数を返します。`side` は成行で約定した側です。`buy` は成行買い（売り注文を取った）、`sell` は成行売りで、分からなければ省略します。約定から足を作る変換はこれを受け取ります（[ローソク足の変換を自分で書く](custom-series.md#ローソク足の変換を自分で書く)を参照）。

約定数や出来高ごとに作る足（[チャートタイプ](chart-types.md)を参照）は約定そのものを使うので、チャートは直近の約定を一定数保持します。保持する数は `performance.maxTrades` で決まり、デフォルトは 10 万件です。

## 過去のデータを読み込む

ユーザーが左へドラッグしてローソク足が残り少なくなると、チャートは `loadMore` イベントを発行します。

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before` は現在の最初の足の時間です。`prepend()` は古いローソク足を先頭に追加します。既存の足と重なる部分は無視され、実際に追加した本数が返ります。追加して最初の足が変われば、ユーザーがさらに左へドラッグしたときにもう一度発行されます。何も追加されなかった場合は、ユーザーがいったん離れてからまたドラッグして戻ってくるまで発行されません。

残り何本で発行するかは `timeScale.loadMoreThreshold` で決まり、デフォルトは 20 本です。

## クリア

```ts
chart.data.clear();
```

ローソク足をすべて削除し、進行中のリプレイも終了します。時間足の設定は残ります。

## 読み取り

```ts
chart.data.length; // 表示されるローソク足の本数
chart.data.at(0); // 最初の足。なければ null
chart.data.last(); // 最後の足
chart.data.indexOf(time); // その時間の足が何番目か。なければ -1
chart.data.toArray(); // すべてを配列にコピー
```

読み出したローソク足の `time` は、常にミリ秒のタイムスタンプです。

多くの足を順に処理するなら、`chart.data.bars` を使います。列ごとに直接読むので、コピーは発生しません。

```ts
const { bars } = chart.data;
let highest = -Infinity;

for (let i = 0; i < bars.length; i += 1) {
  highest = Math.max(highest, bars.high(i));
}
```

`chart.data.source` は同じ形のビューで、元の時間足のローソク足を読みます（リプレイ中は現在の足まで）。

## ローソク足が変わったとき

表示されるローソク足に何か変化があると（設定、更新、過去データの読み込み、時間足の切り替え、リプレイ）、`barsChange` が発行されます。

```ts
chart.on('barsChange', ({ change }) => {
  if (change.kind === 'tail') {
    // change.from 本目より後ろだけが変わったか、新しい足が追加された
  } else {
    // 'reset'：どの足も変わった可能性がある
  }
});
```

ローソク足をもとに自分で何かを計算するときは、これを使って変わった部分だけを計算し直せます。

## ほかのデータを重ねる

メインのローソク足以外のデータ、たとえば比較用の別の銘柄や、自分で計算したラインは、`chart.series` で重ねて表示します。[ペイン](panes.md#シリーズを重ねる)を参照してください。

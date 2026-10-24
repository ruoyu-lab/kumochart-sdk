# 注文ラインと約定マーカー

<!-- code-prelude
declare const order: { id: string };
declare const fill: { id: string; time: number; price: number };
declare const openOrders: import('@kumochart-sdk/core/trading').OrderInput[];
declare const exchange: {
  modifyOrder(id: string, price: number): Promise<void>;
  cancelOrder(id: string): void;
};
-->

トレード画面でよく使う 2 つの機能です。出している注文をドラッグできる価格ラインとして描くことと、ローソク足の上に売買の約定を表示することです。この 2 つは別々のモジュールで、どちらも `@kumochart-sdk/core/trading` に入っており、片方だけを読み込むこともできます。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { orders, markers } from '@kumochart-sdk/core/trading';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [orders(), markers()]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const bars = chart.data.toArray();
const last = bars.at(-1)!;
chart.orders.add({
  id: 'o1',
  side: 'buy',
  price: last.close * 0.99,
  label: 'LIMIT',
  quantity: 0.5
});
chart.orders.add({ id: 'o2', side: 'sell', price: last.close * 1.015, label: 'TP', quantity: 0.5 });

const entry = bars.at(-40)!;
chart.markers.add({ id: 'f1', time: entry.time, position: 'below', shape: 'arrow-up', text: '買' });
```

## 注文ライン

```ts
import { orders } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [orders()] });

chart.orders.add({
  id: order.id, // ふつうは取引所や証券会社の注文番号
  side: 'buy', // 'buy' または 'sell'。デフォルトの色が決まる
  price: 95000,
  label: 'LIMIT', // ラベルの文字。デフォルトは BUY / SELL
  quantity: 0.25 // ラベルの後ろに表示
});

chart.orders.update(order.id, { price: 94800 });
chart.orders.remove(order.id);
chart.orders.set(openOrders); // 最新の未約定注文でまとめて置き換える
```

`id` を省略すると、チャートが `order-1` から番号を振り、`add()` がそれを返します。`clear()` はすべての注文を削除します。

注文の状態は取引所の情報を正とします。いちばん簡単なのは、未約定注文に変化があるたびに `set()` ですべての注文を設定し直す方法です。

### ドラッグで注文を変更する

ユーザーは注文ラインを上下にドラッグできます。ドラッグ中はラインが追従し、離すと新しい価格にとどまり、段階ごとに `orderDrag` が発行されます。

```ts
chart.on('orderDrag', async ({ id, phase, price, initialPrice }) => {
  if (phase !== 'end') return;

  try {
    await exchange.modifyOrder(id, price);
  } catch {
    chart.orders.update(id, { price: initialPrice }); // 注文の変更に失敗したので、元の価格に戻す
  }
});
```

ドラッグ中に Esc を押すと取り消され、ラインは元の位置に戻り、`phase: 'cancel'` が発行されます。特定の注文をドラッグさせたくないときは `draggable: false` を設定します。

### ラベルのボタン

```ts
chart.orders.add({
  id: order.id,
  side: 'sell',
  price: 98000,
  buttons: [{ id: 'cancel', text: '✕' }]
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'order' && buttonId === 'cancel') exchange.cancelOrder(id);
});
```

ボタンは文字（`text`）でも、アイコン（`icon`、24 × 24 の SVG パス）でもかまいません。

## 約定マーカー

```ts
import { markers } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [markers()] });

chart.markers.add({
  id: fill.id,
  time: fill.time, // この時間を含む足に表示する
  position: 'below', // 'above' は高値の上、'below' は安値の下、'price' は指定した価格の位置
  shape: 'arrow-up',
  text: '買 0.25'
});
```

形は `arrow-up`、`arrow-down`、`triangle-up`、`triangle-down`、`circle`、`square` があります。デフォルトの色は、上向きならテーマの `buy`、下向きなら `sell`、円と四角は文字の色です。`color` で色を指定したり、`size` で大きさを変えたりもできます（デフォルトは 8 ピクセル）。

特定の価格に表示する場合は、次のようにします。

```ts
chart.markers.add({
  id: 'f2',
  time: fill.time,
  position: 'price',
  price: fill.price,
  shape: 'circle'
});
```

こちらにも `update()`、`remove()`、`set()`、`clear()`、`list()`、`get()` があります。`id` を省略すると `marker-1` から番号が振られます。

最後の足よりも後で、その足の期間も過ぎたマーカーは、その時刻の足が来るまで描かず、来たらその足に描きます。練行足のように時間に沿わない足では、最後の足より後のマーカーはすべて最後の足に描きます。処理するのは見えているマーカーだけなので、バックテストの約定が何万件あってもスクロールやズームは遅くなりません。

## 選択

注文ラインも約定マーカーもクリックで選択でき、選択すると `selectionChange` が発行されます。`selection.kind` は `'order'` か `'marker'` です。[操作](interaction.md#オブジェクトの選択)を参照してください。

注文と約定マーカーは `saveState()` に含まれません。これらはトレードのデータなので、毎回取引所から取得します。

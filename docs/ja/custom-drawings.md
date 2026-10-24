# カスタム描画ツール

<!-- code-prelude
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
declare const zoneId: string;
-->

独自の描画ツールも、組み込みのものと同じように扱えます。ユーザーが描き、ドラッグし、選択し、元に戻すことができ、レイアウトに保存でき、アラートで監視することもできます。

描画のタイプは、チャートに 3 つのことを伝えます。アンカーがいくつあるか、どう描くか（`paint`）、ポインターがどこにあればそれに当たったとみなすか（`hitTest`）です。ここでは「価格ゾーン」を作ります。2 つのアンカーで上下 2 本の価格ラインを決め、1 つ目のアンカーからチャートの右端まで伸ばします。

```ts live height=400
import { createChart, withAlpha } from '@kumochart-sdk/core';
import {
  drawings,
  type Anchors,
  type DrawingTypeDefinition,
  type Positions
} from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const priceZone: DrawingTypeDefinition<Anchors<2>> = {
  type: 'price-zone',
  points: 2,
  // 設定画面で変更できるスタイル
  fields: ['color', 'fillColor', 'lineWidth', 'lineStyle'],
  defaultStyle: (theme) => ({ color: theme.accent, fillColor: withAlpha(theme.accent, 0.12) }),

  paint: ({ ctx, geometry, selected }) => {
    const { box } = zone(geometry.points);
    const { style, width } = geometry;
    ctx.fillStyle = style.fillColor;
    ctx.fillRect(box.left, box.top, width - box.left, box.bottom - box.top);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = selected ? style.lineWidth + 1 : style.lineWidth;
    ctx.beginPath();
    ctx.moveTo(box.left, box.top);
    ctx.lineTo(width, box.top);
    ctx.moveTo(box.left, box.bottom);
    ctx.lineTo(width, box.bottom);
    ctx.stroke();
  },

  hitTest: (geometry, point, tolerance) => {
    const { box } = zone(geometry.points);
    if (point.x < box.left - tolerance) return null;
    const edge = Math.min(Math.abs(point.y - box.top), Math.abs(point.y - box.bottom));
    if (edge <= tolerance) return { part: 'line', distance: edge };
    if (point.y > box.top && point.y < box.bottom) return { part: 'body', distance: 0 };
    return null;
  }
};

/** 2 つのアンカーで囲まれた範囲（ピクセル座標） */
function zone([a, b]: Positions<Anchors<2>>) {
  return {
    box: { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
  };
}

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings([priceZone])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.drawings.startTool('price-zone'); // チャートを 2 回クリックしてみる
```

## 座標

`paint` と `hitTest` が受け取る `geometry` には、次のものが入っています。

- `points`：アンカーのピクセル座標。ペインのプロット領域の左上を基準とし、置かれた順に並ぶ。
- `anchors`：アンカーの時間と価格。
- `width`、`height`：プロット領域のサイズ。
- `style`：この描画の最終的なスタイル（デフォルト値に描画自身のスタイルを重ねたもの）。
- `valueToY`、`yToValue`、`timeToX`：価格・時間とピクセルの間の換算。追加のラインを描くときに使う。
- `bars`：表示されている足。たとえばアンカー以降の最高値を探すときに使う。
- `formatValue`：価格を軸と同じ書式で表示する。ラベルを描くときに使う。
- `theme`、`textFont`、`measureText`：テキストを描くときに使う。

`DrawingTypeDefinition<Anchors<2>>` のようにアンカーの数で型を書くと、`points` と `anchors` はちょうど 2 つの組になり、あるかどうかを確かめずに取り出せます。チャートは `points` と同じ数のアンカーを渡します。

`paint` の `ctx` はすでにプロット領域にクリップされ、座標も平行移動済みなので、そのまま CSS ピクセルで描けば大丈夫です。高解像度ディスプレイのスケーリングはチャートが処理します。`hovered` と `selected` は、ポインターがその上にあるか、選択されているかを表すので、目立つように描き分けるのに使えます。

## 当たり判定

`hitTest` は当たらなければ `null` を返し、当たったときは `part`（`line` は線上、`body` は内側）と距離を返します。描画どうし、あるいは注文ラインやアラートのラインと重なっているときは、線上に当たったものが内側に当たったものより優先されます。同じく線上（または内側）に当たったものの中では近いものが、同じ距離なら上にある（後から描いた）ものが優先されます。`body` は実際に面を描いているところでだけ返してください。塗りつぶしのない図形の内側は当たりにならず、そこでドラッグするとチャートがスクロールします。`tolerance` はチャートの `interaction.hitTolerance` で、デフォルトは 6 ピクセルです。

ハンドル（ドラッグして形を変える小さな点）はチャートが処理します。デフォルトではアンカーごとに 1 つあり、ドラッグするとそのアンカーが動きます。別のハンドルが必要なときは `handles()` と `moveHandle()` を書きます。`moveHandle()` の 4 番目の引数 `space` は、時間と価格を描くときの位置（足の番号、軸の目盛り上の値）に変換します。この空間で計算すれば、対数軸でも、足の間に欠けがあっても、ハンドルがちょうどポインターの下に来ます。5 番目の引数はその描画のスタイルです。ハンドルの `id` がアンカーの番号（`'0'`、`'1'`…）なら `moveHandle()` は省略でき、ドラッグするとそのアンカーが動きます。`id` がアンカーの番号ではないのに `moveHandle()` がないと、ハンドルが表示された時点でエラーになります。

## その他のオプション

| オプション            | 働き                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `points: 0`           | アンカー数が決まっていない。ダブルクリックか Enter で終了する。パスなど                                                                                                                                             |
| `freehand`            | 押したままドラッグして描く。ブラシなど（`points: 0` と組み合わせる）                                                                                                                                                |
| `place`、`complete()` | ユーザーが置くのは最初のいくつかのアンカーだけで、残りはあなたが計算する。目標価格から対称に損切り価格を出すなど。`complete()` は `points` 個のアンカーを返すこと。そうでないとそのクリックでは置けず、エラーになる |
| `mainPane`            | メインペインのローソク足から計算する（`geometry.bars` を読むなど）。メインペインにだけ置ける                                                                                                                        |
| `paintBelow()`        | ローソク足の下に描く部分。ポジションの損益エリアなど                                                                                                                                                                |
| `editableText`        | 置いた直後とダブルクリックしたときに、テキスト編集ボックスを開く                                                                                                                                                    |
| `axisMarks()`         | 選択中に軸上で強調表示する価格と時間。2 番目の引数はスタイル                                                                                                                                                        |
| `bounds()`            | 描画が占める範囲（アンカーの外に伸びる線やラベルを含む）。`chart.drawings.bounds()` はこれを返す。何も描かないときは `null` で、ユーザーもそこには置けない。省略するとハンドルを囲む範囲                            |
| `levels()`            | アラートが監視できるライン                                                                                                                                                                                          |

`bounds()` を書いた描画は、その範囲が画面の外に完全に出ているときは描かれず、ポインターが近くにないときは当たり判定もされません。そのため `bounds()` には描くものと当たるものをすべて含めてください。書かない描画はいつも描かれ、判定されます。

## アラートで監視できるようにする

```ts no-check
levels: ([a, b]) => {
  const top = Math.max(a.price, b.price);
  const bottom = Math.min(a.price, b.price);
  const time = Math.min(a.time, b.time);
  return [
    // 2 点の時間が同じなら水平線になる。extend: 'end' で右端まで伸ばす
    { key: 'top', from: { time, price: top }, to: { time, price: top }, extend: 'end' },
    { key: 'bottom', from: { time, price: bottom }, to: { time, price: bottom }, extend: 'end' }
  ];
};
```

これで「価格がこのゾーンに入った」というアラートを設定できます。

```ts
chart.alerts.add({
  id: 'zone',
  trigger: 'enter-channel',
  value: [
    { kind: 'drawing', id: zoneId, level: 'top' },
    { kind: 'drawing', id: zoneId, level: 'bottom' }
  ]
});
```

## 使う

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings([...allDrawings, priceZone])] });

// または作成したあとで
chart.drawings.register(priceZone);
```

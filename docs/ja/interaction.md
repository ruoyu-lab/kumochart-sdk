# 操作

<!-- code-prelude
declare const left: import('@kumochart-sdk/core').Chart, right: import('@kumochart-sdk/core').Chart;
declare const time: number, id: string;
declare function showQuote(bar: import('@kumochart-sdk/core').Bar): void;
declare function openDrawingSettings(id: string): void;
declare function openMenu(x: number, y: number, event: import('@kumochart-sdk/core').ChartPointerEvent): void;
-->

チャートにはマウス、トラックパッド、タッチスクリーン、キーボードでの操作が組み込まれていて、コードを書く必要はありません。このページでは、どんな操作があるか、それをオフにする方法、そしてコードで表示を動かしたり、クロスヘアを操作したり、オブジェクトを選択したりする方法を説明します。

## マウスとトラックパッド

| 操作                                             | 効果                                     |
| ------------------------------------------------ | ---------------------------------------- |
| ドラッグ                                         | 左右に移動。離すと慣性で動く             |
| ホイールを上下                                   | ズーム                                   |
| トラックパッドで左右にスワイプ、Shift + ホイール | 左右に移動                               |
| トラックパッドでピンチ                           | ズーム                                   |
| 時間軸をドラッグ                                 | 足の幅を変える                           |
| 価格軸をドラッグ、価格軸の上でホイール           | 価格方向に拡大縮小                       |
| 価格軸をダブルクリック                           | 自動スケールに戻す                       |
| 時間軸をダブルクリック                           | 足の幅をデフォルトに戻し、最新の足へ移動 |
| ペインの区切り線をドラッグ                       | ペインの高さを調整                       |

ズームしたときにどの足が動かないかは 1 つのルールで決まります。最新の足を追従しているとき（最新の足が表示範囲にあるとき）は最新の足が動かず、ズーム後も追従を続けます。そうでなければ、ホイール、トラックパッド、ピンチ、時間軸のドラッグでズームするとマウスの下（2 本の指の中間、押した位置）の足が動かず、キーボードや `timeScale.zoomIn()`、`zoomOut()` でズームすると中央の足が動きません。

## タッチスクリーン

| 操作             | 効果                                                               |
| ---------------- | ------------------------------------------------------------------ |
| 1 本指でドラッグ | 左右に移動                                                         |
| 2 本指でピンチ   | 2 本の指の左右の間隔に合わせてズーム                               |
| 長押し           | クロスヘアモードに入る。指を動かすとクロスヘアが追従し、離すと終了 |

描画したりオブジェクトをドラッグしたりするときは、指の上に拡大鏡が表示され、指の下の位置がよく見えるようになります。

## キーボード

チャートにフォーカスがある（一度クリックした）状態で使えます。

| キー                           | 効果                                         |
| ------------------------------ | -------------------------------------------- |
| ← →                            | 左右に移動。Shift を押しながらだと半画面ずつ |
| ↑ または +、↓ または -         | ズームイン、ズームアウト                     |
| End                            | 最新の足へ移動                               |
| Esc                            | 描画中のラインを取り消す、選択を解除する     |
| Delete、Backspace              | 選択中のオブジェクトを削除                   |
| Ctrl/⌘ + Z                     | 元に戻す                                     |
| Ctrl/⌘ + Shift + Z、Ctrl/⌘ + Y | やり直す                                     |
| Ctrl/⌘ + C、Ctrl/⌘ + V         | 選択中の描画をコピー、貼り付け               |

削除、元に戻す、コピーなどは各モジュールが処理します。たとえば描画を元に戻すのは描画モジュールの役割です。キーが何もしないとき（元に戻すものがない、何も選択していないなど）、チャートはそのキーを横取りしないので、ページ自身のショートカットがそのまま使えます。Ctrl/⌘ や Alt を伴うほかのキー（Ctrl + - でページを拡大縮小、Alt + ← で戻るなど）もブラウザに任せます。

## 一部の操作をオフにする

```ts
chart.applyOptions({
  interaction: {
    pan: true, // ドラッグで移動
    wheelZoom: true, // ホイールとトラックパッドでのズーム
    pinchZoom: true, // タッチスクリーンでのピンチズーム
    axisScale: true, // 軸のドラッグとダブルクリック
    kineticScroll: true, // 離したあとの慣性
    keyboard: true, // キーボード操作
    longPressMs: 300, // クロスヘアモードに入るまでの長押しの時間
    touchMagnifier: true, // タッチスクリーンの拡大鏡
    hitTolerance: 6 // オブジェクトにどこまで近ければクリックしたとみなすか。CSS ピクセル
  }
});
```

動かせない小さなチャート、たとえば一覧に並べるサムネイルを作るなら、`pan`、`wheelZoom`、`pinchZoom`、`axisScale`、`keyboard` をすべてオフにします。

## コードで表示を動かす

横方向の表示は `chart.timeScale` で操作します。

```ts
chart.timeScale.scrollToRealTime(); // 最新の足へ移動
chart.timeScale.fitContent(); // すべての足を 1 画面に収める
chart.timeScale.setVisibleRange({ from: '2026-05-01', to: '2026-05-08' });
chart.timeScale.scrollToTime(time, 'center'); // ある時間を中央に移動
chart.timeScale.zoomIn();
chart.timeScale.setBarSpacing(12); // 足 1 本の幅を 12 ピクセルにする
chart.timeScale.reset(); // 幅をデフォルトに戻し、最新の足へ移動

chart.timeScale.visibleRange(); // 見えている最初の足と最後の足の時間
chart.timeScale.isFollowing(); // 最新の足が表示範囲に入っているか
```

表示が変わると `visibleRangeChange` が発行されます。

```ts
chart.on('visibleRangeChange', ({ range }) => {
  if (range) console.log(new Date(range.from), new Date(range.to));
});
```

## クロスヘア

マウスがチャート上にあるとクロスヘアが追従し、同時に `crosshairMove` が発行されます。イベントには、マウスの位置の時間、価格、その足が含まれます。マウスが止まっていても、その下の足が変わったとき（キーボードや慣性でスクロールしたとき、リアルタイム更新でその足が変わったとき）にも発行されます。

```ts
chart.on('crosshairMove', (event) => {
  if (event.visible && event.bar) {
    showQuote(event.bar); // たとえばページの別の場所にこの足のデータを表示する
  }
});
```

マウスを使わずに、クロスヘアをある時間に置くこともできます。たとえば複数のチャートのクロスヘアを同期させる場合です。

```ts
left.on('crosshairMove', (event) => {
  if (event.visible && event.time !== null) {
    right.crosshair.set({ time: event.time });
  } else {
    right.crosshair.set(null);
  }
});
```

`crosshair.set(null)` で非表示にします。`crosshair.get()` は現在のクロスヘアの位置を返します。非表示のときは `null` です。

## オブジェクトの選択

描画、注文ライン、アラートライン、約定マーカーは、どれもクリックで選択できます。選択すると `selectionChange` が発行されます。

```ts
chart.on('selectionChange', ({ selection }) => {
  // { kind: 'drawing', id: 'xxx' } のような形。何もない所をクリックすると null
  if (selection?.kind === 'drawing') openDrawingSettings(selection.id);
});

chart.select({ kind: 'drawing', id }); // コードで選択
chart.selection(); // 現在選択中のもの
chart.select(null); // 選択を解除
```

`selectionChange` はユーザーがクリックしたときだけ発行されます。コードで `select()` を呼んだときは発行されません。

## クリックと右クリックメニュー

`click`、`doubleClick`、`contextMenu` で、どこをクリックしたか、何をクリックしたかがわかります。

```ts
chart.on('contextMenu', (event) => {
  // event.area：'plot'、'price-axis'、'time-axis'、'separator'、'outside'
  // event.paneId、event.time、event.price：クリックした位置
  // event.target：クリックしたオブジェクト。たとえば { kind: 'drawing', id, part: 'line' }。なければ null
  openMenu(event.x, event.y, event);
});
```

`contextMenu` を監視していると、チャート上ではブラウザ標準の右クリックメニューが出なくなります。描画中に右クリックすると描画が取り消され、このイベントは発行されません。

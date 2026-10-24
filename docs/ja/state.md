# 保存と復元

ユーザーがチャートに追加したインジケーター、引いたライン、調整したペインは、まとめて保存しておき、次に開いたときにまとめて復元できます。

```ts
// 保存
const state = chart.saveState();
localStorage.setItem('layout', JSON.stringify(state));

// 復元
const saved = localStorage.getItem('layout');
if (saved) chart.loadState(JSON.parse(saved));
```

<!-- code-prelude
declare const saved: import('@kumochart-sdk/core').ChartState;
declare const drawingsBySymbol: Record<string, import('@kumochart-sdk/core/drawings').Drawing[]>;
declare const symbol: string, next: string;
declare function barsOf(symbol: string): import('@kumochart-sdk/core').BarInput[];
-->

`saveState()` が返すのはふつうのオブジェクトなので、そのまま JSON に変換して、ブラウザやサーバーに保存できます。

## 保存されるもの

- メインシリーズのタイプと、どの価格を描くか（`mainSeries.type`、`mainSeries.source`）。
- ローソク足の変換。たとえば平均足や練行足と、そのパラメーター（`transform`）。
- 表示：足の幅と、最新の足からどれだけ離れているか。
- ペイン：どのペインがあるか、その順序、高さ、タイトル。各価格スケールのモード（対数、パーセントなど）、反転しているかどうか、手動で設定した範囲と上下の余白。
- 各モジュール独自の部分：インジケーターモジュールはすべてのインジケーターとそのパラメーター、スタイルを、描画モジュールはすべての描画を、価格帯別出来高モジュールはすべてのプロファイルを保存します。

保存**されない**のは、アプリケーション側のものです。ローソク足のデータ、時間足、重ねたシリーズ、注文、約定マーカー、アラートは、アプリケーションが自分で管理し、レイアウトを復元したあとに設定し直します。

## 復元

`loadState()` は、すべてを復元するか、何も変えないかのどちらかです。状態のどこか 1 か所でもおかしければ、たとえば知らないバージョンだったり、チャートにないインジケーターの種類を使っていたり、存在しないペインに描画が置かれていたりすると、エラーになり、チャートは元のままです。

```ts
try {
  chart.loadState(saved);
} catch (error) {
  console.warn('レイアウトを復元できなかったため、デフォルトのレイアウトを使います', error);
}
```

復元するときは、チャートに同じモジュールが必要です。状態に描画が含まれているのに、チャートに描画モジュールがない場合もエラーになります。

データの設定とレイアウトの復元は、どちらを先にしてもかまいません。インジケーターはデータに合わせて計算し直されます。ふつうは、チャートを作成し、データを設定してから、レイアウトを復元します。

## 銘柄ごとに別の描画を使う

描画は時間と価格で位置が決まるので、同じ銘柄なら時間足を変えても位置は合いますが、銘柄を変えると合わなくなります。銘柄ごとに描画を持ちつつ、インジケーターとペインは共通にしたい場合は、描画を別に保存します。

```ts
// 銘柄を切り替える前に、この銘柄の描画を保存する
drawingsBySymbol[symbol] = chart.drawings.list();

// 新しい銘柄に切り替える
chart.data.set(barsOf(next), { interval: '1m' });
chart.drawings.set(drawingsBySymbol[next] ?? []);
```

`drawings.set()` はすべての描画を置き換え、元に戻す履歴もクリアします。

## バージョン

状態には `version` があり、現在は `1` です。今後状態の形式が変わると、バージョン番号も変わります。`loadState()` は知らないバージョンを受け取るとエラーになります。

# アラート

<!-- code-prelude
import type { ValueSource } from '@kumochart-sdk/core';
declare const maId: string, lineId: string, ethId: string, trendLineId: string, macdId: string, rectId: string;
declare const alertsFromServer: import('@kumochart-sdk/core/alerts').AlertInput[];
declare function notify(message: string): void;
declare function saveAlert(id: string, patch: { value: number }): void;
-->

アラートモジュールは価格、インジケーター、描画を監視し、条件を満たすと `alertTrigger` を発生させます。固定の価格に置いたアラートはチャート上に 1 本のラインとして表示され、ユーザーがドラッグできます。

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { alerts } from '@kumochart-sdk/core/alerts';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { modules: [alerts()] });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const last = chart.data.last()!;
chart.alerts.add({ id: 'above', trigger: 'cross-up', value: last.close * 1.01, label: '上抜け' });
chart.alerts.add({ id: 'below', trigger: 'cross-down', value: last.close * 0.99, label: '下抜け' });
```

## 追加

```ts
chart.alerts.add({
  id: 'btc-100k', // あなたのアラートの id。省略するとチャートが番号を振る
  trigger: 'cross-up', // 条件
  value: 100000, // 価格
  frequency: 'once', // 何回発動するか
  label: '10 万' // ラインに表示するテキスト
});
```

`id` はふつう、アプリやサーバーでそのアラートに使っている id をそのまま使います。省略すると、チャートが `alert-1` から番号を振ります。`add()` はアラートの id を返します。

```ts
chart.alerts.update('btc-100k', { value: 105000 });
chart.alerts.remove('btc-100k');
chart.alerts.set(alertsFromServer); // まとめて置き換える
chart.alerts.clear(); // すべて削除
chart.alerts.list();
chart.alerts.get('btc-100k'); // status 付き：'active'、'triggered'、'disabled'
```

## 条件

| `trigger`         | 発動するとき                 |
| ----------------- | ---------------------------- |
| `cross-up`        | 下から上へ交差したとき       |
| `cross-down`      | 上から下へ交差したとき       |
| `cross`           | どちらかの方向に交差したとき |
| `above`           | 上にあるとき                 |
| `below`           | 下にあるとき                 |
| `enter-channel`   | チャネルに入ったとき         |
| `exit-channel`    | チャネルから出たとき         |
| `inside-channel`  | チャネルの内側にあるとき     |
| `outside-channel` | チャネルの外側にあるとき     |

交差と出入りは、前回の判定と比べます。前回は下にあり、今回は上にあるときに、はじめて交差とみなします。前回はチャネルの外（またはちょうど境界上）にあり、今回は内側にあるときが入ったとき、その逆が出たときです。チャネルを一度に飛び越えたとき、たとえば 100 から 110 のチャネルで前回 95、今回 115 のときは、入ったとも出たともみなしません。上にある・下にある・チャネルの内側にある・外側にある、は今回の判定だけを見ます。

## 監視する対象

`source` は監視する値で、デフォルトはメインシリーズの終値です。次のものを指定できます。

```ts
const sources: ValueSource[] = [
  { kind: 'price', field: 'high' }, // メインシリーズのいずれかの価格
  { kind: 'indicator', id: maId, key: 'ma20' }, // インジケーターのいずれかのライン。key を省くと最初のライン
  { kind: 'drawing', id: lineId }, // 描画（各足での位置）。level を省くと最初のライン
  { kind: 'series', id: ethId } // 追加したシリーズ
];
```

`value` は比較の相手です。固定の価格、別の値、チャネルの 2 本の境界のいずれかを指定します。

```ts
// 価格がトレンドラインを上抜ける
chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: trendLineId } });

// MACD のゴールデンクロス：MACD ラインがシグナルラインを上抜ける
chart.alerts.add({
  id: 'b',
  source: { kind: 'indicator', id: macdId, key: 'macd' },
  trigger: 'cross-up',
  value: { kind: 'indicator', id: macdId, key: 'signalLine' }
});

// 価格が長方形から出る
chart.alerts.add({
  id: 'c',
  trigger: 'exit-channel',
  value: [
    { kind: 'drawing', id: rectId, level: 'top' },
    { kind: 'drawing', id: rectId, level: 'bottom' }
  ]
});
```

インジケーターを監視するにはインジケーターモジュールを、描画を監視するには描画モジュールを読み込む必要があります。描画のどのラインを監視できるかは `chart.drawings.levels(id)` で調べられます。アラートが監視しているインジケーターや描画は削除できないので、先にアラートを削除してください。そうしないとエラーになり、どのアラートが使っているかが示されます。

## 発動の回数

| `frequency`          | 意味                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `once`（デフォルト） | 1 回発動したら止まり、状態が `triggered` になる。`rearm()` で再び有効にする |
| `once-per-bar`       | 1 本の足につき最大 1 回。条件を満たしたその更新で発動する                   |
| `once-per-bar-close` | 終値だけを見る。次の足が始まったときに 1 本前の足を判定する                 |
| `every-time`         | 更新のたびに、条件を満たしていれば発動する                                  |

```ts
chart.alerts.rearm('btc-100k');
chart.alerts.update('btc-100k', { enabled: false }); // 一時停止
```

## 発動したとき

```ts
chart.on('alertTrigger', ({ id, time, value, threshold, replay }) => {
  if (replay) return; // 履歴をリプレイしているときに発動したもの。ふつうは通知しなくてよい
  notify(`${id}：${value} が ${threshold} を交差しました`);
});
```

`time` は条件を満たした足、`value` は監視している値、`threshold` はその時点の価格です（チャネルを監視しているときは、交差した境界の価格）。

## チャート上でドラッグする

固定の価格に置いたアラートはラインとして表示され、ユーザーがドラッグできます。ドラッグ中は `alertDrag` が発生してアラートも一緒に動き、手を離した位置の価格にとどまります。

```ts
chart.on('alertDrag', ({ id, phase, price }) => {
  if (phase === 'end') saveAlert(id, { value: price });
});
```

ラインの見た目は次のように設定します。

```ts
chart.alerts.add({
  id: 'x',
  trigger: 'cross',
  value: 98000,
  color: '#e3a33b', // デフォルトはテーマの alert の色
  lineStyle: 'dashed',
  draggable: true, // ドラッグできるかどうか
  visible: true, // ラインを表示するかどうか
  buttons: [{ id: 'remove', text: '✕' }] // ラベル上のボタン。クリックすると buttonClick が発生する
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'alert' && buttonId === 'remove') chart.alerts.remove(id);
});
```

## ページを閉じていてもアラートを受け取る

チャート内のアラートは、ページを開いている間だけ動作します。サーバーで判定するには、チャートを必要としない計算関数を使います。インジケーターには `computeIndicator()`（[インジケーター](indicators.md)を参照）、描画には `computeDrawingLevels()`（[描画ツール](drawings.md#描画上の価格)を参照）を使います。どちらも Node.js で動き、計算結果はチャート上の値と同じです。

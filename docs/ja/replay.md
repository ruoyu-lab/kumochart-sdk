# リプレイ

<!-- code-prelude
declare const time: number;
declare const progress: { update(time: number): void };
declare function showMessage(text: string): void;
-->

リプレイは、チャートを過去のある時点まで戻し、それより後の足をいったん隠してから 1 本ずつ表示していく機能です。チャートを読む練習や、トレードの振り返りに使います。

```ts live height=380
import { createChart } from '@kumochart-sdk/core';
import { replay } from '@kumochart-sdk/core/replay';
import { indicators, EMA } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [replay(), indicators([EMA])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'EMA' });

// 300 本前から始めて、毎秒 4 本ずつ再生する
const start = chart.data.at(chart.data.length - 300)!;
chart.replay.start(start.time, { speed: 4 });
chart.replay.play();
```

## 操作

```ts
chart.replay.start('2026-05-01T00:00:00Z'); // この時間まで戻し、それより後をすべて隠す
chart.replay.play(); // 自動再生
chart.replay.pause();
chart.replay.step(); // 1 ステップ進める。実際に進んだステップ数を返す
chart.replay.step(10);
chart.replay.seek(time); // ある時間へジャンプ。前にも後ろにも移動できる
chart.replay.stop(); // リプレイを終了し、すべてのデータを表示

chart.replay.state(); // { time, playing, ended, speed, step }。リプレイ中でなければ null
```

設定は `start()` のときに渡します。途中で `configure()` を使って変えることもできます。

```ts
chart.replay.configure({
  speed: 2, // 1 秒あたりのステップ数
  step: 'bar' // 1 ステップで進む量
});
```

`step` は 2 種類あります。

- `bar`（デフォルト）：1 ステップで表示中の足を 1 本進めます。1 時間足を見ているなら、1 ステップは 1 時間です。
- `source`：1 ステップで元の時間足の足を 1 本進めます。1 時間足を見ていて元データが 1 分足なら、その 1 時間の足が 1 分ずつ伸びていく様子を見られます。

## リプレイ中のチャートの動き

- 表示される足、`chart.data` で読めるもの、インジケーターの計算は、すべて現在のリプレイ位置までです。「未来」は見えません。
- 時間足やチャートタイプを切り替えても、リプレイの位置は変わりません。
- リアルタイムデータはふだんどおり入ってきますが、いったん隠され、リプレイがそこまで進んだときに表示されます。
- アラートはふだんどおり判定され、発動したときの `alertTrigger` には `replay: true` が付くので区別できます。
- `chart.data.clear()` を呼ぶとリプレイは終了します。

## イベント

自動再生で 1 ステップ進んだとき、または最後まで達したときに `replay` が発行されます。

```ts
chart.on('replay', ({ state, reason }) => {
  progress.update(state.time);
  if (reason === 'end') showMessage('最新まで再生しました');
});
```

最後まで達すると自動で一時停止し、`state.ended` が `true` になります。`step()` や `seek()` などを自分で呼んだときは、このイベントは発行されません。

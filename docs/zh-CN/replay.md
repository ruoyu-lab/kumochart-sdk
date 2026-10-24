# 回放

<!-- code-prelude
declare const time: number;
declare const progress: { update(time: number): void };
declare function showMessage(text: string): void;
-->

回放把图表退回到历史上的某一刻，之后的 K 线先藏起来，再一根一根放出来，用来练习看盘、复盘交易。

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

// 从 300 根之前开始，每秒放 4 根
const start = chart.data.at(chart.data.length - 300)!;
chart.replay.start(start.time, { speed: 4 });
chart.replay.play();
```

## 控制

```ts
chart.replay.start('2026-05-01T00:00:00Z'); // 退回到这个时间，这之后的都藏起来
chart.replay.play(); // 自动播放
chart.replay.pause();
chart.replay.step(); // 往前走一步，返回实际走了几步
chart.replay.step(10);
chart.replay.seek(time); // 跳到某个时间，往前往后都行
chart.replay.stop(); // 结束回放，显示全部数据

chart.replay.state(); // { time, playing, ended, speed, step }，没在回放时是 null
```

设置在 `start()` 时给，也可以中途用 `configure()` 改：

```ts
chart.replay.configure({
  speed: 2, // 每秒走几步
  step: 'bar' // 一步走多少
});
```

`step` 有两种：

- `bar`（默认）：一步走完一根显示的 K 线。看 1 小时线时一步就是一小时。
- `source`：一步走一根原始周期的 K 线。看 1 小时线、原始数据是 1 分钟时，能看到这一小时的 K 线一分钟一分钟长出来。

## 回放时图表怎么表现

- 显示的 K 线、`chart.data` 读到的、指标算的，都只到当前回放的位置，看不到"未来"。
- 切换周期、切换图表类型，回放的位置不变。
- 实时数据照常进来，只是先藏着，回放走到时才显示。
- 提醒照常判断，触发时 `alertTrigger` 带 `replay: true`，方便你区分。
- `chart.data.clear()` 会结束回放。

## 事件

自动播放走了一步、或者走到了最后，都会发出 `replay`：

```ts
chart.on('replay', ({ state, reason }) => {
  progress.update(state.time);
  if (reason === 'end') showMessage('已经放到最新');
});
```

放到最后会自动暂停，`state.ended` 为 `true`。你调用 `step()`、`seek()` 这些不会发出这个事件。

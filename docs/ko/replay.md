# 리플레이

<!-- code-prelude
declare const time: number;
declare const progress: { update(time: number): void };
declare function showMessage(text: string): void;
-->

리플레이는 차트를 과거의 어느 시점으로 되돌려 그 이후의 봉을 숨겨 두었다가, 한 봉씩 다시 보여 줍니다. 차트 보는 연습이나 매매 복기에 씁니다.

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

// 300봉 전부터 시작해 초당 4봉씩 재생
const start = chart.data.at(chart.data.length - 300)!;
chart.replay.start(start.time, { speed: 4 });
chart.replay.play();
```

## 제어

```ts
chart.replay.start('2026-05-01T00:00:00Z'); // 이 시간으로 되돌리고, 그 이후는 모두 숨깁니다
chart.replay.play(); // 자동 재생
chart.replay.pause();
chart.replay.step(); // 한 단계 앞으로. 실제로 나아간 단계 수를 반환
chart.replay.step(10);
chart.replay.seek(time); // 특정 시간으로 이동. 앞으로든 뒤로든 됩니다
chart.replay.stop(); // 리플레이를 끝내고 모든 데이터를 표시

chart.replay.state(); // { time, playing, ended, speed, step }. 리플레이 중이 아니면 null
```

설정은 `start()`할 때 넘기며, 도중에 `configure()`로 바꿀 수도 있습니다:

```ts
chart.replay.configure({
  speed: 2, // 초당 몇 단계
  step: 'bar' // 한 단계에 얼마나 나아갈지
});
```

`step`은 두 가지입니다:

- `bar`(기본값): 한 단계에 표시되는 봉 하나만큼 나아갑니다. 1시간봉을 보고 있으면 한 단계가 1시간입니다.
- `source`: 한 단계에 원본 주기의 봉 하나만큼 나아갑니다. 1시간봉을 보는데 원본 데이터가 1분봉이라면, 그 1시간 봉이 1분씩 자라나는 모습을 볼 수 있습니다.

## 리플레이 중 차트의 동작

- 표시되는 봉, `chart.data`로 읽는 값, 지표 계산은 모두 현재 리플레이 위치까지만이며, "미래"는 보이지 않습니다.
- 주기나 차트 유형을 바꿔도 리플레이 위치는 그대로입니다.
- 실시간 데이터는 평소처럼 들어오지만 일단 숨겨 두었다가, 리플레이가 그 지점에 도달하면 표시합니다.
- 알림은 평소처럼 판단하며, 트리거되면 `alertTrigger`에 `replay: true`가 붙어 있어 구분할 수 있습니다.
- `chart.data.clear()`를 호출하면 리플레이가 끝납니다.

## 이벤트

자동 재생이 한 단계 나아가거나 끝에 도달하면 `replay`가 발생합니다:

```ts
chart.on('replay', ({ state, reason }) => {
  progress.update(state.time);
  if (reason === 'end') showMessage('최신 봉까지 재생했습니다');
});
```

끝에 도달하면 자동으로 일시정지되며, `state.ended`가 `true`가 됩니다. `step()`, `seek()` 등을 직접 호출할 때는 이 이벤트가 발생하지 않습니다.

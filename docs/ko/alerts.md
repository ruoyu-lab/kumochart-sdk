# 알림

<!-- code-prelude
import type { ValueSource } from '@kumochart-sdk/core';
declare const maId: string, lineId: string, ethId: string, trendLineId: string, macdId: string, rectId: string;
declare const alertsFromServer: import('@kumochart-sdk/core/alerts').AlertInput[];
declare function notify(message: string): void;
declare function saveAlert(id: string, patch: { value: number }): void;
-->

알림 모듈은 가격, 지표, 그리기를 감시하다가 조건이 충족되면 `alertTrigger`를 발생시킵니다. 고정된 가격의 알림은 차트에 선으로 표시되며, 사용자가 드래그할 수 있습니다.

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { alerts } from '@kumochart-sdk/core/alerts';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { modules: [alerts()] });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const last = chart.data.last()!;
chart.alerts.add({ id: 'above', trigger: 'cross-up', value: last.close * 1.01, label: '돌파' });
chart.alerts.add({ id: 'below', trigger: 'cross-down', value: last.close * 0.99, label: '이탈' });
```

## 추가

```ts
chart.alerts.add({
  id: 'btc-100k', // 이 알림의 id, 생략하면 차트가 번호를 매김
  trigger: 'cross-up', // 조건
  value: 100000, // 가격
  frequency: 'once', // 트리거 횟수
  label: '10만' // 선에 표시할 텍스트
});
```

`id`는 보통 애플리케이션이나 서버에서 쓰는 그 알림의 id를 그대로 씁니다. 생략하면 차트가 `alert-1`부터 번호를 매깁니다. `add()`는 알림의 id를 반환합니다.

```ts
chart.alerts.update('btc-100k', { value: 105000 });
chart.alerts.remove('btc-100k');
chart.alerts.set(alertsFromServer); // 한꺼번에 교체
chart.alerts.clear(); // 모두 제거
chart.alerts.list();
chart.alerts.get('btc-100k'); // status 포함: 'active', 'triggered', 'disabled'
```

## 조건

| `trigger`         | 트리거 시점          |
| ----------------- | -------------------- |
| `cross-up`        | 아래에서 위로 교차   |
| `cross-down`      | 위에서 아래로 교차   |
| `cross`           | 어느 방향으로든 교차 |
| `above`           | 위에 있음            |
| `below`           | 아래에 있음          |
| `enter-channel`   | 채널에 진입          |
| `exit-channel`    | 채널에서 이탈        |
| `inside-channel`  | 채널 안에 있음       |
| `outside-channel` | 채널 밖에 있음       |

교차와 진입·이탈은 직전 판단과 비교합니다. 직전에는 아래에 있었고 이번에는 위에 있어야 교차로 봅니다. 직전에는 채널 밖(또는 정확히 경계 위)에 있었고 이번에는 안에 있으면 진입, 그 반대면 이탈입니다. 채널을 한 번에 건너뛰면, 예를 들어 100~110 채널에서 직전 95, 이번 115이면 진입도 이탈도 아닙니다. 위·아래, 채널 안·밖은 이번 판단만 봅니다.

## 감시 대상

`source`는 감시할 값이며, 기본값은 메인 시리즈의 종가입니다. 다음과 같은 값을 쓸 수 있습니다.

```ts
const sources: ValueSource[] = [
  { kind: 'price', field: 'high' }, // 메인 시리즈의 가격 중 하나
  { kind: 'indicator', id: maId, key: 'ma20' }, // 지표의 선 하나, key를 생략하면 첫 번째 선
  { kind: 'drawing', id: lineId }, // 그리기 하나(각 봉에서의 위치), level을 생략하면 첫 번째 선
  { kind: 'series', id: ethId } // 겹쳐 놓은 시리즈
];
```

`value`는 비교할 대상입니다. 고정된 가격, 다른 값, 또는 채널의 두 경계를 쓸 수 있습니다.

```ts
// 가격이 추세선을 상향 교차
chart.alerts.add({ id: 'a', trigger: 'cross-up', value: { kind: 'drawing', id: trendLineId } });

// MACD 골든크로스: MACD 선이 시그널선을 상향 교차
chart.alerts.add({
  id: 'b',
  source: { kind: 'indicator', id: macdId, key: 'macd' },
  trigger: 'cross-up',
  value: { kind: 'indicator', id: macdId, key: 'signalLine' }
});

// 가격이 사각형을 벗어남
chart.alerts.add({
  id: 'c',
  trigger: 'exit-channel',
  value: [
    { kind: 'drawing', id: rectId, level: 'top' },
    { kind: 'drawing', id: rectId, level: 'bottom' }
  ]
});
```

지표를 감시하려면 지표 모듈을, 그리기를 감시하려면 그리기 모듈을 불러와야 합니다. 그리기에서 감시할 수 있는 선은 `chart.drawings.levels(id)`로 조회합니다. 알림이 감시하고 있는 지표나 그리기는 삭제할 수 없으므로 먼저 알림을 삭제해야 합니다. 그렇지 않으면 오류가 발생하며, 어떤 알림이 사용 중인지 알려 줍니다.

## 트리거 횟수

| `frequency`          | 의미                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `once`(기본값)       | 한 번 트리거되면 멈추고 상태가 `triggered`가 됨, `rearm()`으로 다시 켬 |
| `once-per-bar`       | 봉마다 최대 한 번, 조건을 충족한 업데이트에서 바로 트리거              |
| `once-per-bar-close` | 마감만 봄, 다음 봉이 시작될 때 직전 봉을 판단                          |
| `every-time`         | 업데이트마다 조건을 충족하면 매번 트리거                               |

```ts
chart.alerts.rearm('btc-100k');
chart.alerts.update('btc-100k', { enabled: false }); // 일시정지
```

## 트리거되었을 때

```ts
chart.on('alertTrigger', ({ id, time, value, threshold, replay }) => {
  if (replay) return; // 리플레이로 과거를 재생하다 트리거된 것이므로 보통 알릴 필요 없음
  notify(`${id}: ${value}이(가) ${threshold}을(를) 교차했습니다`);
});
```

`time`은 조건을 충족한 봉, `value`는 감시한 값, `threshold`는 그때의 가격입니다(채널을 감시할 때는 통과한 경계).

## 차트에서 드래그하기

고정된 가격의 알림은 선으로 표시되며 사용자가 드래그할 수 있습니다. 드래그하는 동안 `alertDrag`가 발생하고 알림도 함께 바뀌며, 손을 떼면 새 가격에 머뭅니다.

```ts
chart.on('alertDrag', ({ id, phase, price }) => {
  if (phase === 'end') saveAlert(id, { value: price });
});
```

선의 모양은 다음과 같이 정합니다.

```ts
chart.alerts.add({
  id: 'x',
  trigger: 'cross',
  value: 98000,
  color: '#e3a33b', // 기본값은 테마의 alert 색상
  lineStyle: 'dashed',
  draggable: true, // 드래그 가능 여부
  visible: true, // 선 표시 여부
  buttons: [{ id: 'remove', text: '✕' }] // 라벨의 버튼, 클릭하면 buttonClick 발생
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'alert' && buttonId === 'remove') chart.alerts.remove(id);
});
```

## 페이지를 닫아도 알림 받기

차트의 알림은 페이지가 열려 있는 동안에만 동작합니다. 서버에서 판단하려면 차트가 필요 없는 계산 함수를 쓰세요. 지표에는 `computeIndicator()`([지표](indicators.md) 참고), 그리기에는 `computeDrawingLevels()`([그리기 도구](drawings.md#그리기의-가격선) 참고)를 씁니다. 둘 다 Node.js에서 실행되며, 계산 결과는 차트와 같습니다.

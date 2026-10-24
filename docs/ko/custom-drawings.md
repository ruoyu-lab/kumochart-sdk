# 사용자 정의 그리기 도구

<!-- code-prelude
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
declare const zoneId: string;
-->

직접 만든 그리기 도구도 내장 도구와 똑같이 동작합니다. 사용자가 그리고, 드래그하고, 선택하고, 실행 취소할 수 있으며, 레이아웃에 저장되고 알림으로 감시할 수도 있습니다.

그리기 유형은 차트에 세 가지를 알려 줘야 합니다. 앵커가 몇 개인지, 어떻게 그리는지(`paint`), 마우스가 어디에 있을 때 이것을 클릭한 것으로 볼지(`hitTest`)입니다. 아래에서는 '가격대 밴드'를 만듭니다. 앵커 두 개로 위아래 가격선 두 개를 정하고, 이 선들은 첫 번째 앵커에서 차트 오른쪽 끝까지 이어집니다.

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
  // 설정 패널에서 바꿀 수 있는 스타일
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

/** 두 앵커가 둘러싼 범위, 픽셀 좌표 */
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
chart.drawings.startTool('price-zone'); // 차트를 두 번 클릭해 보세요
```

## 좌표

`paint`와 `hitTest`가 받는 `geometry`에는 다음이 들어 있습니다.

- `points`: 앵커의 픽셀 좌표. 창의 플롯 영역 왼쪽 위를 기준으로 하며, 놓은 순서대로입니다.
- `anchors`: 앵커의 시간과 가격.
- `width`, `height`: 플롯 영역의 크기.
- `style`: 이 그리기의 최종 스타일(기본값 위에 자체 스타일을 더한 것).
- `valueToY`, `yToValue`, `timeToX`: 가격·시간과 픽셀 사이의 변환. 추가로 선을 그릴 때 씁니다.
- `bars`: 표시되는 봉. 예를 들어 앵커 이후의 최고가를 찾을 때 씁니다.
- `formatValue`: 가격을 축의 형식대로 표시. 라벨을 그릴 때 씁니다.
- `theme`, `textFont`, `measureText`: 텍스트를 그릴 때 씁니다.

`DrawingTypeDefinition<Anchors<2>>`처럼 앵커 수로 타입을 쓰면 `points`와 `anchors`는 정확히 두 개짜리가 되어, 있는지 확인하지 않고 꺼내 쓸 수 있습니다. 차트는 `points`와 같은 수의 앵커를 넘겨 줍니다.

`paint`의 `ctx`는 이미 플롯 영역으로 잘려 있고 좌표도 옮겨져 있으므로 CSS 픽셀 단위로 바로 그리면 됩니다. 고해상도 화면의 배율은 차트가 처리합니다. `hovered`, `selected`는 마우스가 그 위에 있는지, 선택되었는지를 알려 주므로 이때 더 눈에 띄게 그릴 수 있습니다.

## 클릭 판정

`hitTest`가 `null`을 반환하면 클릭되지 않은 것이고, 클릭되었으면 `part`(`line`은 선 위, `body`는 안쪽)와 거리를 반환합니다. 그리기끼리, 또는 주문선이나 알림선과 겹쳐 있을 때는 선 위를 클릭한 것이 안쪽을 클릭한 것보다 우선합니다. 똑같이 선 위(또는 안쪽)를 클릭한 것 중에서는 가까운 것이, 거리가 같으면 위에 있는 것(나중에 그린 것)이 우선합니다. `body`는 실제로 면을 그린 곳에서만 반환하세요. 채우기가 없는 도형의 안쪽은 클릭되지 않고, 거기서 드래그하면 차트가 이동합니다. `tolerance`는 차트의 `interaction.hitTolerance`이며 기본값은 6픽셀입니다.

핸들(드래그해서 모양을 바꾸는 작은 점)은 차트가 처리합니다. 기본적으로 앵커마다 하나씩 있고, 드래그하면 그 앵커가 움직입니다. 다른 핸들이 필요하면 `handles()`와 `moveHandle()`을 작성합니다. `moveHandle()`의 네 번째 인자 `space`는 시간과 가격을 그리기에 쓰는 위치(봉 번호, 축 눈금상의 값)로 바꿔 줍니다. 이 공간에서 계산하면 로그 축에서도, 봉 사이에 공백이 있어도 핸들이 정확히 포인터 아래에 놓입니다. 다섯 번째 인자는 그 그리기의 스타일입니다. 핸들의 `id`가 앵커 번호(`'0'`, `'1'`, …)라면 `moveHandle()`을 생략할 수 있고, 드래그하면 그 앵커가 움직입니다. `id`가 앵커 번호가 아닌데 `moveHandle()`이 없으면 핸들이 표시되는 즉시 오류가 납니다.

## 추가 옵션

| 옵션                  | 역할                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `points: 0`           | 앵커 수가 정해져 있지 않음, 더블클릭이나 Enter로 끝냄, 예: 경로                                                                                                                                   |
| `freehand`            | 누른 채 드래그해서 그림, 예: 브러시(`points: 0`과 함께 사용)                                                                                                                                      |
| `place`, `complete()` | 사용자는 앞의 몇 개 앵커만 놓고 나머지는 직접 계산, 예: 목표가를 대칭으로 뒤집어 손절가 계산. `complete()`는 `points`개의 앵커를 돌려줘야 하며, 그렇지 않으면 그 클릭으로는 놓이지 않고 오류가 남 |
| `mainPane`            | 메인 창의 봉으로 계산함(`geometry.bars`를 읽는 등). 메인 창에만 놓을 수 있음                                                                                                                      |
| `paintBelow()`        | 봉 아래에 그리는 부분, 예: 포지션의 손익 영역                                                                                                                                                     |
| `editableText`        | 놓은 직후와 더블클릭할 때 텍스트 편집 상자를 엶                                                                                                                                                   |
| `axisMarks()`         | 선택되었을 때 축에서 강조할 가격과 시간. 두 번째 인자는 스타일                                                                                                                                    |
| `bounds()`            | 그리기가 차지하는 범위(앵커 밖으로 뻗은 선과 라벨 포함), `chart.drawings.bounds()`가 이것을 반환. 아무것도 그리지 않으면 `null`이고, 사용자도 거기에는 놓을 수 없음. 생략하면 핸들을 둘러싼 범위  |
| `levels()`            | 알림이 감시할 수 있는 선                                                                                                                                                                          |

`bounds()`를 쓴 그리기는 그 범위가 화면 밖에 완전히 있으면 그려지지 않고, 포인터가 근처에 없으면 클릭 판정도 하지 않습니다. 그래서 `bounds()`는 그리는 것과 클릭될 수 있는 것을 모두 담아야 합니다. 쓰지 않은 그리기는 항상 그리고 판정합니다.

## 알림으로 감시할 수 있게 하기

```ts no-check
levels: ([a, b]) => {
  const top = Math.max(a.price, b.price);
  const bottom = Math.min(a.price, b.price);
  const time = Math.min(a.time, b.time);
  return [
    // 두 점의 시간이 같으면 수평선 하나, extend: 'end'는 오른쪽 끝까지 연장
    { key: 'top', from: { time, price: top }, to: { time, price: top }, extend: 'end' },
    { key: 'bottom', from: { time, price: bottom }, to: { time, price: bottom }, extend: 'end' }
  ];
};
```

그러면 '가격이 이 가격대 밴드에 진입'하는 알림을 설정할 수 있습니다.

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

## 사용하기

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings([...allDrawings, priceZone])] });

// 또는 차트를 만든 뒤에
chart.drawings.register(priceZone);
```

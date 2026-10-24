# 그리기 도구

<!-- code-prelude
declare const drawingToolbar: { release(type: string): void };
-->

그리기 모듈에는 38가지 그리기 도구가 있습니다. 사용자가 차트 위에 직접 그릴 수도 있고, 코드로 그릴 수도 있습니다. 그리기는 시간과 가격으로 위치가 정해지므로 주기를 바꾸거나 확대/축소하거나 드래그해도 봉을 따라 움직입니다.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

// 최근 120개 봉의 최고점과 최저점으로 피보나치 되돌림 그리기
const bars = chart.data.toArray().slice(-120);
const high = bars.reduce((a, b) => (b.high > a.high ? b : a));
const low = bars.reduce((a, b) => (b.low < a.low ? b : a));
chart.drawings.add({
  type: 'fib-retracement',
  points: [
    { time: low.time, price: low.low },
    { time: high.time, price: high.high }
  ]
});

// 이어서 사용자가 직접 추세선을 그리게 함: 두 번 클릭
chart.drawings.startTool('trend-line');
```

## 불러오기

```ts
import {
  drawings,
  allDrawings,
  trendLine,
  horizontalLine,
  fibRetracement
} from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings(allDrawings)] }); // 전부
createChart(container, { modules: [drawings([trendLine, horizontalLine, fibRetracement])] }); // 이것들만
```

## 사용자가 그리게 하기

```ts
chart.drawings.startTool('rectangle');
```

사용자가 앵커를 순서대로 클릭하면 그리기가 완성되고 도구도 함께 끝납니다. Esc를 누르거나 우클릭하면 취소됩니다. 완성되면 먼저 `drawingsChange`(`reason: 'create'`)가 발생하고, 이어서 `toolEnd`가 발생합니다.

```ts
chart.on('toolEnd', ({ type, completed }) => {
  drawingToolbar.release(type); // 예: 툴바의 버튼을 눌리지 않은 상태로 되돌림
});
```

그릴 것이 없는 곳을 클릭하면 무시되고 도구는 다음 클릭을 기다립니다. 마지막 봉 오른쪽에 둔 앵커 VWAP나 시작한 봉에서 끝나는 회귀 추세가 그렇습니다.

터치스크린에서는 손가락으로 누르고 있는 동안 앵커가 손가락을 따라오고(돋보기로 확인할 수 있습니다), 손가락을 뗀 곳에 놓입니다.

도구에는 다음 옵션이 있습니다.

```ts
chart.drawings.startTool('horizontal-line', {
  style: { color: '#e8b04a', lineStyle: 'dashed' }, // 이번에 그릴 스타일
  continuous: true // 하나를 그린 뒤에도 끝나지 않고 다음 것을 이어서 그림
});

chart.drawings.activeTool(); // 사용 중인 도구, 없으면 null
chart.drawings.cancelTool(); // 코드로 종료, toolEnd는 발생하지 않음
```

도구마다 사용자가 마지막으로 고른 스타일을 기억하게 하려면 `setToolStyle()`을 씁니다. 그 뒤로 사용자가 그리는 해당 유형의 그리기에는 모두 이 스타일이 적용됩니다.

```ts
chart.drawings.setToolStyle('trend-line', { color: '#5b9cf0', lineWidth: 2 });
```

### 자석

그릴 때 앵커를 봉의 시가·고가·저가·종가에 붙일 수 있습니다.

```ts
chart.applyOptions({ drawings: { magnet: 'weak' } }); // 'off'(기본값), 'weak' 가까이 가면 붙음, 'strong' 항상 붙음
```

그리는 동안 Ctrl/⌘를 누르고 있으면 일시적으로 반대로 동작합니다.

## 전체 유형

| 그룹           | 유형(앵커 수)                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 선             | `trend-line` 추세선(2), `ray` 레이(2), `extended-line` 연장선(2), `arrow` 화살표(2), `trend-angle` 추세 각도(2), `horizontal-line` 수평선(1), `horizontal-ray` 수평 레이(1), `vertical-line` 수직선(1), `cross-line` 교차선(1) |
| 채널           | `parallel-channel` 평행 채널(3), `regression-trend` 회귀 추세(2), `pitchfork` 피치포크(3)                                                                                                                                      |
| 피보나치       | `fib-retracement` 되돌림(2), `fib-extension` 확장(3), `fib-channel` 채널(3), `fib-time-zone` 타임존(2), `fib-speed-fan` 스피드 저항 팬(2)                                                                                      |
| 간             | `gann-box` 간 박스(2)                                                                                                                                                                                                          |
| 도형           | `rectangle` 사각형(2), `circle` 원(2), `ellipse` 타원(3), `triangle` 삼각형(3), `path` 경로(더블클릭으로 끝냄), `brush` 브러시(누른 채 드래그)                                                                                 |
| 패턴           | `xabcd-pattern` XABCD(5), `head-and-shoulders` 헤드 앤 숄더(7), `elliott-impulse` 엘리엇 충격파(6), `elliott-correction` 엘리엇 조정파(4)                                                                                      |
| 측정           | `price-range` 가격 범위(2), `date-range` 날짜 범위(2), `date-price-range` 날짜 및 가격 범위(2), `long-position` 롱 포지션(3), `short-position` 숏 포지션(3), `anchored-vwap` 앵커드 VWAP(1)                                    |
| 텍스트 및 메모 | `text` 텍스트(1), `callout` 말풍선(2), `price-label` 가격 라벨(1), `flag-mark` 플래그 마크(1)                                                                                                                                  |

가져올 때의 이름은 유형 이름을 카멜 표기법으로 쓴 것입니다. `trend-line`은 `trendLine`, `fib-retracement`는 `fibRetracement`입니다.

롱·숏 포지션은 익절·손절에 닿았는지와 손익을 실제 가격으로 판단합니다. 하이킨아시나 렌코처럼 원래 봉으로 만든 차트나 긴 시간 단위로 볼 때도 원래 봉(리플레이 중에는 이미 공개된 부분)을 씁니다. 앵커 VWAP과 회귀 추세는 차트에 표시된 봉으로 계산합니다.

## 코드로 그리기

```ts
const id = chart.drawings.add({
  type: 'trend-line',
  points: [
    { time: '2026-05-01T08:00:00Z', price: 94200 },
    { time: '2026-05-03T16:00:00Z', price: 96800 }
  ],
  style: { color: '#ef5d5d', lineWidth: 2, extendRight: true }
});

chart.drawings.update(id, { style: { lineStyle: 'dashed' } }); // 스타일은 기존 스타일 위에 병합
chart.drawings.remove(id);
chart.drawings.clear(); // 전부 삭제

chart.drawings.list(); // 모든 그리기
chart.drawings.get(id);
chart.drawings.duplicate(id); // 몇 봉 오른쪽에 복제, 붙여넣기와 같음
```

<!-- code-prelude
declare const id: string;
declare const savedDrawings: import('@kumochart-sdk/core/drawings').DrawingInput[];
declare const drawing: import('@kumochart-sdk/core/drawings').Drawing;
declare function showToolbar(x: number, y: number): void;
declare function hideToolbar(): void;
-->

`points`의 개수는 유형의 앵커 수와 같아야 합니다. 메인 창이 아닌 곳에 그릴 때는 `pane`을 지정합니다. RSI 창에 그리는 수평선이 그런 예입니다.

앵커 VWAP, 회귀 추세, 롱·숏 포지션, 고정 범위 거래량 프로필은 메인 창의 봉으로 계산하므로 메인 창에만 놓을 수 있습니다. 다른 `pane`을 지정하면 오류가 납니다.

한꺼번에 바꾸려면 `set()`을 씁니다. 실행 취소 기록을 비우므로 저장해 둔 그리기를 불러올 때 알맞습니다.

```ts
chart.drawings.set(savedDrawings);
```

다른 곳에서 받은 그리기는 먼저 `validate()`로 검사하세요. 잘못되었으면 `set()`과 같은 오류를 던지지만, 차트에 추가하지는 않습니다.

## 스타일

| 스타일                                    | 설명                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `color`, `lineWidth`, `lineStyle`         | 선의 색상, 굵기, 선 스타일                                                                                       |
| `fill`, `fillColor`                       | 사각형, 채널처럼 닫힌 도형을 채울지 여부와 채우기 색상(투명도 포함). 채우지 않으면 안쪽을 클릭해도 선택되지 않음 |
| `textColor`, `fontSize`, `bold`, `italic` | 텍스트                                                                                                           |
| `textAlign`, `textPosition`               | 텍스트를 선을 따라 왼쪽·가운데·오른쪽 중 어디에, 선의 위쪽·선과 겹친 위치·아래쪽 중 어디에 둘지                  |
| `extendLeft`, `extendRight`               | 선을 차트의 왼쪽·오른쪽 끝까지 연장                                                                              |
| `startArrow`, `endArrow`                  | 양 끝의 화살표                                                                                                   |
| `levels`, `timeLevels`                    | 피보나치, 간 같은 도구의 각 레벨 선: 비율, 색상, 표시 여부                                                       |
| `source`                                  | 회귀 채널, 앵커드 VWAP이 봉의 어느 가격으로 계산할지                                                             |
| `degree`                                  | 엘리엇 파동의 등급, 파동 번호의 표기 방식을 결정                                                                 |

모든 그리기가 모든 스타일을 쓰는 것은 아닙니다. 설정 패널을 만들 때는 `fields(type)`으로 그 그리기에서 바꿀 수 있는 스타일을, `defaultStyle(type)`으로 설정하지 않았을 때의 기본값을 얻습니다.

```ts
chart.drawings.fields('fib-retracement'); // ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', ...]
chart.drawings.defaultStyle('fib-retracement').levels; // 기본 레벨 선
```

`levels`는 배열 전체가 바뀌므로, 선 하나만 바꾸더라도 전체 배열을 줘야 합니다.

```ts
const levels = chart.drawings
  .defaultStyle('fib-retracement')
  .levels.map((level) => (level.value === 0.5 ? { ...level, color: '#ef5d5d' } : level));
chart.drawings.update(id, { style: { levels } });
```

사용자가 설정 패널에서 슬라이더를 드래그하거나 연속으로 입력할 때 변경마다 `update()`를 호출하면 실행 취소 단계가 많이 생깁니다. 같은 편집에 같은 `merge` 키를 주면 하나의 단계로 합쳐집니다.

```ts
chart.drawings.update(id, { style: { lineWidth: 3 } }, { merge: 'lineWidth-7' });
```

## 텍스트

`text`, `callout` 같은 그리기에는 텍스트가 있습니다. 사용자는 더블클릭해서 차트 위에서 바로 편집할 수 있고, 코드로 편집 상자를 열 수도 있습니다.

```ts
chart.drawings.editText(id);
chart.drawings.update(id, { text: '돌파' });
```

그리기가 차트에 직접 그리는 글자(예: 롱·숏 포지션의 '손익비')는 차트의 `locale`에 따라 중국어, 영어, 일본어, 한국어로 표시됩니다. 일부 글자를 바꾸려면 `drawings.texts`를 씁니다.

## 잠금, 숨기기, 일부 주기에서만 표시

```ts
chart.drawings.update(id, { locked: true }); // 선택과 삭제는 되지만 드래그할 수 없고, 더블클릭으로 텍스트를 바꿀 수도 없음
chart.drawings.update(id, { visible: false }); // 숨기기
chart.drawings.update(id, {
  // 1~59분, 1~4시간 주기에서만 표시
  timeframes: { minute: { from: 1, to: 59 }, hour: { from: 1, to: 4 } }
});
chart.drawings.update(id, { timeframes: null }); // 모든 주기에서 표시
```

툴바의 "그리기 숨기기"처럼 모든 그리기를 한꺼번에 숨길 때는 하나씩 바꾸지 말고 옵션을 씁니다. 그리기 자체는 그대로이고, 실행 취소 기록도 늘지 않습니다.

```ts
chart.applyOptions({ drawings: { visible: false } }); // true로 되돌리면 각 그리기는 자기 visible대로 표시
```

숨겨져 있는 동안 도구는 미리보기를 보여 주지 않고 그리기를 놓지도 않으며, 드래그하면 차트가 평소처럼 이동합니다. 다시 표시하면 이어서 그릴 수 있습니다.

`timeframes`에 없는 단위에서는 표시되지 않습니다. 렌코나 체결 건수 기준 봉처럼 시간 기반이 아닌 봉에는 `untimed: true`를 씁니다.

## 실행 취소와 다시 실행

사용자가 그리고, 드래그하고, 삭제한 것과 코드에서 호출한 `add()`, `update()`, `remove()`는 모두 실행 취소 기록에 남습니다.

```ts
chart.drawings.undo();
chart.drawings.redo();
chart.drawings.canUndo(); // 실행 취소 버튼을 누를 수 있게 할지 정할 때 사용
```

키보드로는 Ctrl/⌘ + Z와 Ctrl/⌘ + Shift + Z입니다. 사용자가 키로 실행 취소·다시 실행을 하면 `drawingsChange`(`reason: 'undo'`, `'redo'`)가 발생하고, 코드에서 `undo()`, `redo()`를 호출하면 발생하지 않습니다.

실행 취소 기능을 쓰지 않을 때는 기록을 끕니다. 그러면 키 조작도 `undo()`도 동작하지 않습니다.

```ts
chart.applyOptions({ drawings: { history: false } });
```

## 선택하면 툴바 표시하기

사용자가 그리기를 선택했을 때 그 옆에 작은 툴바(색상 변경, 삭제)를 띄우고 싶을 수 있습니다. `bounds(id)`는 그 그리기가 차트에서 차지하는 범위를 앵커 밖으로 뻗은 선과 라벨까지 포함해 알려 줍니다.

```ts
chart.on('selectionChange', ({ selection }) => {
  if (selection?.kind === 'drawing') {
    const box = chart.drawings.bounds(selection.id); // { x, y, width, height }, 보이지 않으면 null
    if (box) showToolbar(box.x + box.width / 2, box.y);
  } else {
    hideToolbar();
  }
});
```

그리기는 화면과 함께 움직여 위치가 바뀌므로, `visibleRangeChange`가 발생할 때 다시 가져오면 됩니다.

## 그리기의 가격선

`levels(id)`는 그리기 안에서 알림이 감시할 수 있는 선을 나열합니다. 사각형의 `top`과 `bottom`, 피보나치의 각 레벨 선이 그 예입니다. 알림을 설정할 때 쓰며, 자세한 내용은 [알림](alerts.md)을 참고하세요.

비율이나 표준편차 배수에 있는 선은 차트의 라벨과 같이 그 숫자가 이름이 됩니다. 피보나치와 갠의 `0.618`, 회귀 추세의 `2`, `-2`와 기준선 `0`, 앵커 VWAP의 `vwap`과 `1`, `-1`입니다.

차트 없이도 그리기의 각 가격선을 계산할 수 있습니다. 예를 들어 서버에서 가격이 사용자가 그린 피보나치 선에 닿았는지 판단할 수 있습니다.

```ts
import { computeDrawingLevels, fibRetracement } from '@kumochart-sdk/core/drawings';

const lines = computeDrawingLevels(fibRetracement, { points: drawing.points }, bars);
// { '0': [...], '0.236': [...], ... }: 각 선의 봉별 가격
```

넘겨준 데이터에만 의존하므로 Node.js에서도 쓸 수 있습니다.

## 저장

`chart.saveState()`는 모든 그리기를 저장합니다. [저장과 복원](state.md)을 참고하세요. 종목마다 그리기를 따로 저장하는 방법도 그 문서에 있습니다.

그리기 도구를 직접 만들려면 [사용자 정의 그리기 도구](custom-drawings.md)를 참고하세요.

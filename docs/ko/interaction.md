# 조작

<!-- code-prelude
declare const left: import('@kumochart-sdk/core').Chart, right: import('@kumochart-sdk/core').Chart;
declare const time: number, id: string;
declare function showQuote(bar: import('@kumochart-sdk/core').Bar): void;
declare function openDrawingSettings(id: string): void;
declare function openMenu(x: number, y: number, event: import('@kumochart-sdk/core').ChartPointerEvent): void;
-->

차트에는 마우스, 트랙패드, 터치스크린, 키보드 조작이 기본으로 들어 있어 코드를 쓸 필요가 없습니다. 이 페이지에서는 어떤 조작이 있고 어떻게 끄는지, 그리고 코드로 뷰를 움직이고 십자선을 제어하고 객체를 선택하는 방법을 다룹니다.

## 마우스와 트랙패드

| 조작                               | 효과                                     |
| ---------------------------------- | ---------------------------------------- |
| 누른 채 드래그                     | 좌우 이동. 손을 떼면 관성이 있습니다     |
| 휠 위아래                          | 확대/축소                                |
| 트랙패드 좌우 스와이프, Shift + 휠 | 좌우 이동                                |
| 트랙패드 두 손가락 핀치            | 확대/축소                                |
| 시간 축 드래그                     | 봉 너비 변경                             |
| 가격 축 드래그, 가격 축에서 휠     | 가격 확대/축소                           |
| 가격 축 더블클릭                   | 자동 스케일 복원                         |
| 시간 축 더블클릭                   | 기본 봉 너비로 되돌리고 최신 봉으로 이동 |
| 창 사이의 구분선 드래그            | 창 높이 조절                             |

확대/축소할 때 어느 봉이 고정되는지는 한 가지 규칙으로 정해집니다. 최신 봉을 따라가는 중이면(최신 봉이 보이는 범위에 있으면) 최신 봉이 고정되고, 확대/축소한 뒤에도 계속 따라갑니다. 그렇지 않으면 휠, 트랙패드, 핀치, 시간축 드래그로 확대/축소할 때는 마우스 아래(두 손가락의 가운데, 누른 위치)의 봉이 고정되고, 키보드나 `timeScale.zoomIn()`, `zoomOut()`으로 확대/축소할 때는 가운데 봉이 고정됩니다.

## 터치스크린

| 조작             | 효과                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| 한 손가락 드래그 | 좌우 이동                                                                          |
| 두 손가락 핀치   | 두 손가락의 좌우 간격에 따라 확대/축소                                             |
| 길게 누르기      | 십자선 모드로 들어가며, 손가락을 움직이면 십자선이 따라오고 손을 떼면 빠져나옵니다 |

그리기를 하거나 객체를 드래그할 때는 손가락 위쪽에 돋보기가 나타나 손가락 아래의 위치를 잘 볼 수 있습니다.

## 키보드

차트에 포커스가 있을 때(한 번 클릭한 뒤):

| 키                             | 효과                                            |
| ------------------------------ | ----------------------------------------------- |
| ← →                            | 좌우 이동. Shift를 누르고 있으면 반 화면씩 이동 |
| ↑ 또는 +, ↓ 또는 -             | 확대, 축소                                      |
| End                            | 최신 봉으로 이동                                |
| Esc                            | 그리고 있던 선 취소, 선택 해제                  |
| Delete, Backspace              | 선택한 객체 삭제                                |
| Ctrl/⌘ + Z                     | 실행 취소                                       |
| Ctrl/⌘ + Shift + Z, Ctrl/⌘ + Y | 다시 실행                                       |
| Ctrl/⌘ + C, Ctrl/⌘ + V         | 선택한 그리기 복사, 붙여넣기                    |

삭제, 실행 취소, 복사 같은 동작은 각 모듈이 처리합니다. 예를 들어 그리기의 실행 취소는 그리기 모듈이 맡습니다. 키가 아무 일도 하지 않을 때(취소할 것이 없거나 선택한 것이 없을 때)는 차트가 키를 가로채지 않으므로 페이지 자체의 단축키를 그대로 쓸 수 있습니다. Ctrl/⌘ 또는 Alt와 함께 누르는 다른 키(Ctrl + -로 페이지 확대·축소, Alt + ←로 뒤로 가기 등)도 브라우저에 맡깁니다.

## 일부 조작 끄기

```ts
chart.applyOptions({
  interaction: {
    pan: true, // 드래그로 이동
    wheelZoom: true, // 휠과 트랙패드로 확대/축소
    pinchZoom: true, // 터치스크린 두 손가락 확대/축소
    axisScale: true, // 축 드래그, 더블클릭
    kineticScroll: true, // 손을 뗀 뒤의 관성
    keyboard: true, // 키보드 조작
    longPressMs: 300, // 얼마나 길게 누르면 십자선 모드로 들어가는지
    touchMagnifier: true, // 터치스크린 돋보기
    hitTolerance: 6 // 객체에서 얼마나 가까우면 클릭한 것으로 칠지. CSS 픽셀
  }
});
```

목록의 썸네일처럼 움직이지 않는 작은 차트를 만들려면 `pan`, `wheelZoom`, `pinchZoom`, `axisScale`, `keyboard`를 모두 끄세요.

## 코드로 뷰 이동하기

`chart.timeScale`이 가로 방향의 뷰를 제어합니다:

```ts
chart.timeScale.scrollToRealTime(); // 최신 봉으로 이동
chart.timeScale.fitContent(); // 모든 봉을 한 화면에
chart.timeScale.setVisibleRange({ from: '2026-05-01', to: '2026-05-08' });
chart.timeScale.scrollToTime(time, 'center'); // 특정 시간을 가운데로
chart.timeScale.zoomIn();
chart.timeScale.setBarSpacing(12); // 봉 하나를 12픽셀 너비로
chart.timeScale.reset(); // 기본 너비로 되돌리고 최신 봉으로 이동

chart.timeScale.visibleRange(); // 보이는 첫 봉과 마지막 봉의 시간
chart.timeScale.isFollowing(); // 최신 봉이 뷰 안에 있는지
```

뷰가 바뀌면 `visibleRangeChange`가 발생합니다:

```ts
chart.on('visibleRangeChange', ({ range }) => {
  if (range) console.log(new Date(range.from), new Date(range.to));
});
```

## 십자선

마우스가 차트 위에 있으면 십자선이 따라다니고, 동시에 `crosshairMove`가 발생합니다. 이벤트에는 마우스 위치의 시간, 가격, 그 봉이 들어 있습니다. 마우스가 멈춰 있어도 그 아래 봉이 바뀌면(키보드나 관성으로 스크롤되거나 실시간 업데이트로 그 봉이 바뀌면) 발생합니다:

```ts
chart.on('crosshairMove', (event) => {
  if (event.visible && event.bar) {
    showQuote(event.bar); // 예를 들어 페이지의 다른 곳에 이 봉의 데이터를 표시
  }
});
```

마우스 없이도 십자선을 특정 시간에 둘 수 있습니다. 예를 들어 여러 차트의 십자선을 동기화할 때:

```ts
left.on('crosshairMove', (event) => {
  if (event.visible && event.time !== null) {
    right.crosshair.set({ time: event.time });
  } else {
    right.crosshair.set(null);
  }
});
```

`crosshair.set(null)`로 숨깁니다. `crosshair.get()`은 십자선의 현재 위치를 반환하며, 숨겨져 있으면 `null`입니다.

## 객체 선택

그리기, 주문선, 알림선, 체결 표시는 모두 클릭해서 선택할 수 있습니다. 선택되면 `selectionChange`가 발생합니다:

```ts
chart.on('selectionChange', ({ selection }) => {
  // { kind: 'drawing', id: 'xxx' } 같은 형태. 빈 곳을 클릭하면 null
  if (selection?.kind === 'drawing') openDrawingSettings(selection.id);
});

chart.select({ kind: 'drawing', id }); // 코드로 선택
chart.selection(); // 현재 선택된 것
chart.select(null); // 선택 해제
```

`selectionChange`는 사용자가 클릭할 때만 발생하며, 코드에서 `select()`를 호출하면 발생하지 않습니다.

## 클릭과 우클릭 메뉴

`click`, `doubleClick`, `contextMenu`는 어디를 클릭했는지, 무엇을 클릭했는지 알려 줍니다:

```ts
chart.on('contextMenu', (event) => {
  // event.area: 'plot', 'price-axis', 'time-axis', 'separator', 'outside'
  // event.paneId, event.time, event.price: 클릭한 위치
  // event.target: 클릭한 객체. 예: { kind: 'drawing', id, part: 'line' }. 없으면 null
  openMenu(event.x, event.y, event);
});
```

`contextMenu`를 구독하면 차트에서 브라우저 기본 우클릭 메뉴가 더 이상 뜨지 않습니다. 그리기 중에 우클릭하면 그리기가 취소되며, 이 이벤트는 발생하지 않습니다.

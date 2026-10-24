# 이벤트

<!-- code-prelude
declare function modifyOrder(id: string, price: number): void;
-->

`chart.on()`으로 구독합니다. 이 함수는 구독을 해제하는 함수를 반환합니다:

```ts
const off = chart.on('crosshairMove', (event) => {
  /* ... */
});

off(); // 구독 해제
```

차트를 제거하면 모든 구독이 자동으로 해제됩니다.

## 발생 시점

대부분의 이벤트는 **사용자가 조작할 때**만 발생하며, API를 직접 호출해서 바꾼 내용은 다시 알려 주지 않습니다. 예를 들어 사용자가 선을 그리면 `drawingsChange`가 발생하지만, `chart.drawings.add()`를 호출하면 발생하지 않습니다. 덕분에 이벤트로 받은 변경을 서버에 저장하고 다시 서버에서 차트로 설정할 때, 이벤트가 오가며 계속 발생하는 일이 없습니다.

예외는 `barsChange`, `visibleRangeChange`, `typesChange`, `optionsChange`입니다. 이 이벤트들은 차트의 현재 상태를 알려 주므로 누가 바꿨든 발생합니다.

API 호출의 이벤트는 호출이 할 일을 마친 뒤, 반환하기 전에 보내집니다. 읽기도 마찬가지입니다. 예를 들어 `visibleRange()`가 새 보이는 범위를 계산하면 `visibleRangeChange`는 계산이 끝난 뒤에 보내지므로, 리스너에서 차트를 바꿔도 반환값은 달라지지 않습니다.

여러 API 호출을 한꺼번에 적용하고 이벤트는 한 번만 보내려면 `batch()`를 씁니다:

```ts
chart.batch(() => {
  chart.data.set(bars, { interval: '1m' });
  chart.data.setTimeframe('1h');
  chart.timeScale.scrollToRealTime();
});
```

## 코어 이벤트

| 이벤트               | 발생 시점                                                 | 자세히                                                   |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `crosshairMove`      | 마우스가 차트 위에서 움직이거나 벗어날 때                 | [조작](interaction.md#십자선)                            |
| `visibleRangeChange` | 보이는 범위가 바뀌었을 때                                 | [조작](interaction.md#코드로-뷰-이동하기)                |
| `loadMore`           | 가장 오래된 봉 근처까지 드래그했을 때                     | [데이터](data.md#과거-데이터-더-불러오기)                |
| `barsChange`         | 표시되는 봉이 바뀌었을 때                                 | [데이터](data.md#봉이-바뀔-때)                           |
| `click`              | 클릭                                                      | [조작](interaction.md#클릭과-우클릭-메뉴)                |
| `doubleClick`        | 더블클릭                                                  | 위와 같음                                                |
| `contextMenu`        | 우클릭. 구독하면 브라우저 메뉴가 뜨지 않음                | 위와 같음                                                |
| `selectionChange`    | 사용자가 객체를 선택하거나 선택을 해제했을 때             | [조작](interaction.md#객체-선택)                         |
| `paneResize`         | 사용자가 창 구분선 드래그를 마쳤을 때                     | [창](panes.md)                                           |
| `legendButtonClick`  | 범례의 버튼을 눌렀을 때                                   | [외관](appearance.md#범례)                               |
| `buttonClick`        | 주문이나 알림 라벨의 버튼을 눌렀을 때                     | [주문선과 체결 표시](trading.md)                         |
| `typesChange`        | 시리즈, 봉 변환, 지표, 그리기의 유형을 등록하거나 뺐을 때 | [모듈](modules.md#만든-뒤에-유형-추가하기)               |
| `optionsChange`      | 옵션을 설정했을 때(`applyOptions()`, `loadState()`)       | [사용자 정의 모듈](custom-modules.md#옵션-변화-따라가기) |

## 모듈 이벤트

모듈을 불러온 뒤에만 있습니다:

| 이벤트           | 모듈     | 발생 시점                                                                         |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `drawingsChange` | 그리기   | 사용자가 그리기를 새로 만들거나 수정·삭제했을 때, 또는 실행 취소·다시 실행했을 때 |
| `toolEnd`        | 그리기   | 사용자가 선을 다 그렸을 때, 또는 Esc나 우클릭으로 취소했을 때                     |
| `orderDrag`      | 주문선   | 사용자가 주문선을 드래그할 때                                                     |
| `alertDrag`      | 알림     | 사용자가 알림선을 드래그할 때                                                     |
| `alertTrigger`   | 알림     | 알림이 트리거되었을 때                                                            |
| `replay`         | 리플레이 | 리플레이가 한 봉 나아갔을 때, 또는 끝까지 재생했을 때                             |

드래그 이벤트는 단계별로 발생합니다: `start`, `move`, `end`, 그리고 Esc로 취소하면 `cancel`. 이벤트에는 드래그하기 전의 가격과 현재 가격이 들어 있습니다:

```ts
chart.on('orderDrag', ({ id, phase, price, initialPrice }) => {
  if (phase === 'end') {
    modifyOrder(id, price); // 손을 뗐을 때만 주문을 수정
  }
});
```

## TypeScript에서

이벤트 이름과 이벤트 내용에는 모두 타입이 있으며, 차트의 모듈을 따라갑니다. 그리기 모듈을 불러오지 않았다면 `chart.on('drawingsChange', ...)`는 컴파일할 때 오류가 납니다.

다른 프레임워크용 컴포넌트처럼 모든 이벤트를 전달하려면, `@kumochart-sdk/core/all`의 `ALL_EVENTS`가 코어와 모든 모듈의 이벤트 이름이고 `AllEventMap`이 그 타입입니다.

# 주문선과 체결 표시

<!-- code-prelude
declare const order: { id: string };
declare const fill: { id: string; time: number; price: number };
declare const openOrders: import('@kumochart-sdk/core/trading').OrderInput[];
declare const exchange: {
  modifyOrder(id: string, price: number): Promise<void>;
  cancelOrder(id: string): void;
};
-->

트레이딩 화면에서 자주 쓰는 두 가지입니다. 대기 중인 주문을 드래그할 수 있는 가격선으로 그리고, 봉 위에 매수·매도 체결을 표시합니다. 두 개의 모듈이며 모두 `@kumochart-sdk/core/trading`에 들어 있고, 그중 하나만 불러올 수도 있습니다.

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { orders, markers } from '@kumochart-sdk/core/trading';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [orders(), markers()]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const bars = chart.data.toArray();
const last = bars.at(-1)!;
chart.orders.add({
  id: 'o1',
  side: 'buy',
  price: last.close * 0.99,
  label: 'LIMIT',
  quantity: 0.5
});
chart.orders.add({ id: 'o2', side: 'sell', price: last.close * 1.015, label: 'TP', quantity: 0.5 });

const entry = bars.at(-40)!;
chart.markers.add({
  id: 'f1',
  time: entry.time,
  position: 'below',
  shape: 'arrow-up',
  text: '매수'
});
```

## 주문선

```ts
import { orders } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [orders()] });

chart.orders.add({
  id: order.id, // 보통 거래소나 증권사의 주문 번호
  side: 'buy', // 'buy' 또는 'sell'. 기본 색을 결정합니다
  price: 95000,
  label: 'LIMIT', // 라벨 글자. 기본값은 BUY / SELL
  quantity: 0.25 // 라벨 뒤에 표시
});

chart.orders.update(order.id, { price: 94800 });
chart.orders.remove(order.id);
chart.orders.set(openOrders); // 최신 미체결 주문으로 한꺼번에 교체
```

`id`를 생략하면 차트가 `order-1`부터 번호를 매기고 `add()`가 그 id를 반환합니다. `clear()`는 모든 주문을 제거합니다.

주문 상태는 거래소가 기준입니다. 가장 간단한 방법은 미체결 주문에 변화가 생길 때마다 `set()`으로 전체 미체결 주문을 다시 설정하는 것입니다.

### 드래그해서 주문 수정

사용자는 주문선을 위아래로 드래그할 수 있습니다. 드래그하는 동안 선이 따라 움직이고, 손을 떼면 새 가격에 머무르며, 단계별로 `orderDrag`가 발생합니다:

```ts
chart.on('orderDrag', async ({ id, phase, price, initialPrice }) => {
  if (phase !== 'end') return;

  try {
    await exchange.modifyOrder(id, price);
  } catch {
    chart.orders.update(id, { price: initialPrice }); // 주문 수정에 실패하면 원래 가격으로 되돌립니다
  }
});
```

드래그 중에 Esc를 누르면 취소되어 선이 원래 자리로 돌아가고, `phase: 'cancel'`이 발생합니다. 어떤 주문을 드래그하지 못하게 하려면 `draggable: false`를 설정하세요.

### 라벨의 버튼

```ts
chart.orders.add({
  id: order.id,
  side: 'sell',
  price: 98000,
  buttons: [{ id: 'cancel', text: '✕' }]
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'order' && buttonId === 'cancel') exchange.cancelOrder(id);
});
```

버튼은 글자(`text`)일 수도 있고, 아이콘(`icon`, 24 × 24 SVG 경로)일 수도 있습니다.

## 체결 표시

```ts
import { markers } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [markers()] });

chart.markers.add({
  id: fill.id,
  time: fill.time, // 이 시간이 속한 봉에 표시
  position: 'below', // 'above'는 고가 위, 'below'는 저가 아래, 'price'는 특정 가격 위치
  shape: 'arrow-up',
  text: '매수 0.25'
});
```

모양은 `arrow-up`, `arrow-down`, `triangle-up`, `triangle-down`, `circle`, `square`가 있습니다. 색은 기본적으로 위를 향한 모양은 테마의 `buy`, 아래를 향한 모양은 `sell`, 원과 사각형은 글자 색을 씁니다. `color`로 직접 지정할 수도 있고, `size`로 크기를 바꿀 수 있습니다(기본값 8픽셀).

특정 가격에 표시하기:

```ts
chart.markers.add({
  id: 'f2',
  time: fill.time,
  position: 'price',
  price: fill.price,
  shape: 'circle'
});
```

마찬가지로 `update()`, `remove()`, `set()`, `clear()`, `list()`, `get()`이 있습니다. `id`를 생략하면 `marker-1`부터 번호를 매깁니다.

마지막 봉보다 늦고 그 봉의 주기도 지난 표시는 그 시각의 봉이 올 때까지 그리지 않고, 봉이 오면 그 위에 그립니다. 렌코처럼 시간을 따르지 않는 봉에서는 마지막 봉보다 늦은 표시를 모두 마지막 봉에 그립니다. 보이는 표시만 처리하므로 백테스트 체결이 수만 개여도 스크롤과 확대·축소가 느려지지 않습니다.

## 선택

주문선과 체결 표시는 모두 클릭해서 선택할 수 있습니다. 선택되면 `selectionChange`가 발생하며, `selection.kind`는 `'order'` 또는 `'marker'`입니다. [조작](interaction.md#객체-선택)을 참고하세요.

주문과 체결 표시는 `saveState()`에 들어가지 않습니다. 이들은 여러분의 거래 데이터이므로 매번 거래소에서 받아 옵니다.

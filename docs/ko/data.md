# 데이터

<!-- code-prelude
declare const bar: import('@kumochart-sdk/core').BarInput, bar1: import('@kumochart-sdk/core').BarInput, bar2: import('@kumochart-sdk/core').BarInput;
declare const time: number;
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

메인 창의 봉은 모두 `chart.data`로 읽고 씁니다. 써 넣는 것은 **원본 데이터**이고, 읽어 오는 것은 **표시되는 봉**, 즉 주기 합성, 봉 변환, 리플레이를 거친 결과입니다.

## 봉 형식

```ts
interface BarInput {
  time: number | string | Date; // 밀리초 타임스탬프, ISO 8601 문자열 또는 Date
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // 기본값 0
}
```

차트는 봉을 하나하나 검사합니다. 가격은 유한한 숫자여야 하고, `high`와 `low`가 `open`, `close`를 사이에 두어야 하며, 거래량은 음수일 수 없고, 시간은 오래된 것부터 순서대로이면서 중복이 없어야 합니다. 맞지 않으면 `ChartError`를 던지는데, 메시지에 몇 번째 봉의 어디가 잘못됐는지 적혀 있고 차트는 그대로 유지됩니다.

넘긴 배열은 차트가 복사해 두므로, 나중에 배열을 바꿔도 차트에 영향이 없고 차트도 그 배열을 바꾸지 않습니다.

## 한꺼번에 설정하기

```ts
chart.data.set(bars);
```

종목을 바꿀 때도 `set()`을 다시 호출하면 됩니다. 기존 봉은 모두 교체됩니다.

봉이 일정한 주기라면 주기도 함께 알려 주는 것이 좋습니다:

```ts
chart.data.set(bars, { interval: '1m' });
```

주기를 알려 줘야 차트가 브라우저에서 더 긴 주기를 만들고, 체결을 봉에 합칠 수 있습니다. [주기와 거래 캘린더](timeframes.md)를 참고하세요.

## 실시간 업데이트

```ts
chart.data.update(bar);
chart.data.update([bar1, bar2]); // 여러 개를 한 번에 밀어 넣기
```

시간이 마지막 봉과 같으면 그 봉을 바꾸고, 더 늦으면 뒤에 붙이며, 더 이르면 오류가 납니다(과거 봉은 `set()`이나 `prepend()`로 넣습니다).

사용자가 최신 봉을 보고 있으면 새 봉이 들어올 때 차트가 따라 움직이고, 과거를 거슬러 보고 있으면 차트가 움직이지 않습니다.

## 체결(틱)

체결 데이터를 받는다면 그대로 차트에 넘기세요. 차트가 현재 봉에 합치고, 다음 봉의 시간이 되면 알아서 새 봉을 엽니다:

```ts
chart.data.addTrades({ time: 1767225600123, price: 87601.5, size: 0.02 });
chart.data.addTrades(trades); // 한 번에 여러 건. 시간순으로 정렬해서
```

`size`는 체결 수량이며 봉의 거래량에 더해집니다. 기본값은 0입니다. 이렇게 하려면 `set()`할 때 `interval`을 지정해야 합니다. 늦게 도착한 체결은 건너뜁니다. 마지막 봉보다 이전이거나 이미 준 최신 체결보다 이전인 것으로, 예를 들어 재연결 뒤에 도착한 것입니다. 거래 세션을 설정했다면 세션 밖의 체결도 건너뜁니다. `addTrades()`는 실제로 반영된 체결 건수를 반환합니다. `side`는 시장가로 체결한 쪽입니다. `buy`는 시장가 매수(매도 주문을 받음), `sell`은 시장가 매도이며, 모르면 생략합니다. 체결로 봉을 만드는 변환이 이 값을 받습니다([봉 변환 직접 작성하기](custom-series.md#봉-변환-직접-작성하기) 참고).

체결 수나 거래량으로 만드는 봉([차트 유형](chart-types.md) 참고)은 체결 자체가 필요하므로, 차트가 최근 체결의 일부를 보관합니다. 보관하는 개수는 `performance.maxTrades`로 정하며, 기본값은 10만 건입니다.

## 과거 데이터 더 불러오기

사용자가 왼쪽으로 드래그해 봉이 거의 남지 않으면 차트가 `loadMore` 이벤트를 보냅니다:

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before`는 현재 첫 번째 봉의 시간입니다. `prepend()`는 더 이전의 봉을 앞에 붙이는데, 이미 있는 봉과 겹치는 부분은 무시하고 실제로 붙인 봉의 개수를 반환합니다. 붙이고 나면 첫 번째 봉이 바뀌므로 사용자가 다시 왼쪽으로 드래그하면 이벤트가 또 발생합니다. 아무것도 붙이지 않았다면, 사용자가 드래그해서 벗어났다가 다시 돌아와야 다시 발생합니다.

봉이 몇 개 남았을 때 이벤트를 보낼지는 `timeScale.loadMoreThreshold`로 정하며, 기본값은 20개입니다.

## 비우기

```ts
chart.data.clear();
```

봉을 모두 지우고, 진행 중인 리플레이도 끝냅니다. 주기 설정은 유지됩니다.

## 읽기

```ts
chart.data.length; // 표시되는 봉의 개수
chart.data.at(0); // 첫 번째 봉. 없으면 null
chart.data.last(); // 마지막 봉
chart.data.indexOf(time); // 해당 시간의 봉이 몇 번째인지. 없으면 -1
chart.data.toArray(); // 전부 배열로 복사
```

읽어 온 봉의 `time`은 항상 밀리초 타임스탬프입니다.

봉을 많이 순회해야 한다면 `chart.data.bars`를 쓰세요. 열 단위로 바로 읽으며 복사하지 않습니다:

```ts
const { bars } = chart.data;
let highest = -Infinity;

for (let i = 0; i < bars.length; i += 1) {
  highest = Math.max(highest, bars.high(i));
}
```

`chart.data.source`도 같은 형태의 뷰이며, 원본 주기의 봉을 읽습니다(리플레이 중에는 현재 봉까지만).

## 봉이 바뀔 때

표시되는 봉에 어떤 변화가 생기든(설정, 업데이트, 과거 데이터 불러오기, 주기 변경, 리플레이) `barsChange`가 발생합니다:

```ts
chart.on('barsChange', ({ change }) => {
  if (change.kind === 'tail') {
    // change.from번째 봉 이후만 바뀌었거나, 새 봉이 이어 붙었습니다
  } else {
    // 'reset': 어느 봉이든 바뀌었을 수 있습니다
  }
});
```

봉을 바탕으로 직접 무언가를 계산할 때, 이 이벤트를 이용하면 바뀐 부분만 다시 계산할 수 있습니다.

## 다른 데이터 겹치기

메인 창 이외의 데이터, 예를 들어 비교할 다른 종목이나 직접 계산한 선은 `chart.series`로 겹쳐 그립니다. [창](panes.md#시리즈-겹치기)을 참고하세요.

# 창

차트는 위에서 아래로 여러 창으로 나뉩니다. 맨 위가 메인 창(id는 `main`)이고, 그 아래가 보조 창입니다. 창마다 자기 가격 스케일이 있고, 아래쪽의 시간 축은 함께 씁니다.

## 보조 창

가장 흔한 보조 창은 지표가 직접 여는 창입니다. MACD, RSI 같은 지표는 기본값이 `pane: 'new'`라서, 추가하면 보조 창을 자동으로 하나 열고, 그 창을 쓰는 마지막 지표를 빼면 보조 창도 함께 사라집니다.

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, MACD, RSI, VOL } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MACD, RSI, VOL])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'VOL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

창을 직접 만들고 지표나 시리즈를 넣을 수도 있습니다:

```ts
chart.panes.add({ id: 'oscillators', title: '오실레이터', height: 160 });
chart.indicators.add({ type: 'RSI', pane: 'oscillators' });
chart.indicators.add({ type: 'STOCH', pane: 'oscillators' });
```

직접 만든 창은 자동으로 사라지지 않습니다. `id`를 생략하면 차트가 `pane-1`부터 번호를 매기고 `add()`가 그 id를 반환합니다.

```ts
chart.panes.list(); // 위에서 아래로 모든 창. 메인 창이 맨 앞
chart.panes.update('oscillators', { height: 200 });
chart.panes.move('oscillators', 1); // 메인 창 바로 아래로 이동
chart.panes.remove('oscillators'); // 안에 있는 지표와 시리즈를 먼저 빼야 하며, 안의 그리기는 함께 삭제됩니다
```

메인 창은 남은 높이를 모두 차지하므로 높이를 설정해도 소용이 없습니다. 높이가 다 들어가지 않으면 다른 창들이 비율대로 낮아지고, 어떤 창도(메인 창도) `minHeight`보다 낮아지지 않습니다. 사용자는 창 사이의 구분선을 드래그해 높이를 조절할 수 있습니다. 구분선은 포인터를 따라 움직이고 다른 창은 그대로이며, 줄어들어 있던 창은 지금 높이를 자기 높이로 갖습니다. 드래그가 끝나면 높이가 바뀐 창마다 `paneResize`가 발생합니다. 관련 옵션:

```ts
chart.applyOptions({
  panes: {
    defaultHeight: 120, // 새 창의 높이
    minHeight: 40, // 드래그로 줄일 수 있는 최소 높이
    separatorHeight: 5, // 구분선에서 드래그할 수 있는 영역의 높이
    separatorWidth: 2 // 그려지는 선의 굵기. 0이면 그리지 않음
  }
});
```

## 가격 스케일

창마다 기본으로 오른쪽 가격 스케일이 하나 있습니다. `chart.priceScale()`로 어떤 창의 어떤 스케일을 가져옵니다:

```ts
const scale = chart.priceScale(); // 메인 창의 오른쪽 스케일
const rsiScale = chart.priceScale('oscillators');
```

<!-- code-prelude
declare const scale: import('@kumochart-sdk/core').PriceScaleApi;
declare const time: number;
declare const ethBars: import('@kumochart-sdk/core').BarInput[], latestEthBar: import('@kumochart-sdk/core').BarInput;
declare const ethTrades: import('@kumochart-sdk/core').TradeInput[];
-->

### 로그, 퍼센트, 100 기준

```ts
scale.setMode('log'); // 로그
scale.setMode('percent'); // 화면의 첫 봉 대비 등락률
scale.setMode('indexed'); // 화면의 첫 봉을 100으로
scale.setMode('normal');
```

퍼센트와 100 기준은 모두 지금 보이는 첫 봉을 기준으로 하므로, 좌우로 드래그하면 기준도 바뀝니다. 데이터가 그 모드에 맞지 않을 때(예: 로그 스케일에 음수가 있을 때)는 스케일을 잠시 일반 모드로 그리지만, `mode()`는 여전히 설정한 모드를 반환합니다.

### 스케일 범위

스케일은 기본적으로 자동 스케일이어서, 보이는 봉과 지표가 딱 맞게 들어갑니다. 사용자가 축을 드래그하거나 직접 범위를 설정하면 자동 스케일이 꺼집니다:

```ts
scale.setRange({ min: 80000, max: 95000 });
scale.isAutoScale(); // false
scale.autoScale(); // 자동 스케일 복원. 사용자가 축을 더블클릭해도 같습니다
scale.setInverted(true); // 위아래 뒤집기
```

### 좌표 변환

차트 위에 HTML 요소를 직접 겹칠 때는 이 함수들로 가격과 픽셀을 변환합니다:

```ts
scale.priceToY(90000); // 차트 왼쪽 위 기준의 y
scale.yToPrice(120);
chart.timeScale.timeToX(time);
chart.timeScale.xToTime(300);
```

차트 각 부분의 위치는 `chart.layout()`으로 가져옵니다.

## 한 창 안의 여러 스케일

한 창에 스케일을 여러 개 둘 수 있습니다: `right`(기본값), `left`, 또는 직접 붙인 아무 이름. `left`에 두면 왼쪽에 축이 생기고, 그 밖의 이름은 축이 없는 오버레이 스케일로 각자 따로 스케일되며 서로 영향을 주지 않습니다. 창에서 `left`에만 무언가 있는 동안 오른쪽 축은 늘 왼쪽 스케일과 같고, 그리기도 그에 맞춰 놓입니다. 오른쪽 축을 드래그하거나 더블클릭하거나 코드로 `right`의 범위를 바꾸면 왼쪽 스케일이 바뀝니다. 차트를 위아래로 드래그하면 손으로 스케일을 바꾼 스케일이 움직입니다.

가장 흔한 용도는 거래량을 메인 창 아래쪽에 두는 것입니다:

```ts
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 }); // 아래쪽 20%만 차지
```

## 시리즈 겹치기

메인 창 이외의 데이터는 `chart.series`로 겹쳐 그립니다. 예를 들어 다른 종목과 비교하거나 직접 계산한 선을 그릴 때입니다:

```ts
const eth = chart.series.add({
  type: 'line',
  pane: 'main',
  scale: 'compare', // 자기 스케일을 쓰므로 가격 차이가 아무리 커도 겹쳐 볼 수 있습니다
  title: 'ETH',
  data: ethBars // 메인 창과 같은 봉, 또는 { time, value } 형태의 점
});

chart.series.updateData(eth, latestEthBar); // 실시간 업데이트
chart.series.addTrades(eth, ethTrades); // 또는 체결을 그대로 넘김
chart.series.update(eth, { style: { color: '#c084fc' } });
chart.series.remove(eth);
chart.series.set([{ type: 'line', title: 'ETH', data: ethBars }]); // 한꺼번에 교체
chart.series.clear(); // 모두 제거
```

겹친 시리즈는 시간에 따라 가로축에 놓이며, 메인 창에서 같은 시간의 봉과 맞춰집니다. 체결은 메인 봉과 같은 방식으로 합쳐집니다. 캔들 같은 봉 그래프는 그 봉에, 선이나 영역 같은 값 그래프는 원본 주기마다 마지막 체결가로 들어갑니다.

등락률만 비교하고 싶다면 둘 다 같은 스케일에 두고 스케일을 퍼센트로 설정하세요. 각자 화면의 첫 봉부터 계산합니다:

```ts
chart.series.add({ type: 'line', title: 'ETH', data: ethBars });
chart.priceScale().setMode('percent');
```

`type`은 코어의 11가지 시리즈 중 어느 것이든 될 수 있고([외관](appearance.md#메인-시리즈) 참고), 직접 등록한 유형일 수도 있습니다([사용자 정의 시리즈](custom-series.md) 참고). `pane: 'new'`로 하면 따로 창을 하나 열어 줍니다.

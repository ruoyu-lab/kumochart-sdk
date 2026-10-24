# 빠른 시작

<!-- code-prelude
declare const socket: WebSocket;
declare const trade: { time: number; price: number; size: number };
declare function fetchBars(range: { endTime: number }): Promise<import('@kumochart-sdk/core').BarInput[]>;
-->

## 설치

```bash
npm install @kumochart-sdk/core
```

Vue나 React를 쓴다면 해당 컴포넌트 패키지도 설치하세요. [Vue](vue.md), [React](react.md)를 참고하세요.

## 첫 번째 차트

차트는 컨테이너를 가득 채우고 컨테이너의 크기가 바뀌면 따라서 바뀝니다. 그래서 컨테이너에 높이가 있어야 합니다:

```html
<div id="chart" style="height: 480px"></div>
```

차트를 만들고 봉을 넣습니다:

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars());
```

봉 하나는 객체 하나입니다:

```ts
const bar = {
  time: 1767225600000, // 밀리초 타임스탬프. ISO 문자열이나 Date도 됩니다
  open: 87512.3,
  high: 87650,
  low: 87480.1,
  close: 87601.5,
  volume: 132.4 // 생략할 수 있으며 기본값은 0
};
```

봉은 오래된 것부터 최신 순으로 정렬해야 하고, 시간이 중복되면 안 됩니다.

## 주기 바꾸기

봉이 몇 분봉인지 알려 주면, 서버에 다시 요청하지 않고도 브라우저에서 더 긴 주기를 만들어 냅니다:

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

`setTimeframe(null)`을 호출하면 원래 주기로 돌아갑니다. 주기 표기법, 거래 세션, 시간대는 [주기와 거래 캘린더](timeframes.md)를 참고하세요.

## 지표와 그리기 추가하기

지표와 그리기는 모듈에 들어 있으며, 차트를 만들 때 넘깁니다:

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([MA, MACD]), drawings([trendLine, horizontalLine])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'MA' }); // 메인 창에 그립니다
chart.indicators.add({ type: 'MACD' }); // 보조 창을 하나 새로 엽니다

// 사용자가 차트에 추세선을 그리게 합니다: 두 번 클릭
chart.drawings.startTool('trend-line');
```

쓰는 몇 가지만 불러오면 번들에도 그것만 들어갑니다. 통째로 불러올 수도 있습니다. [모듈](modules.md)을 참고하세요.

## 실시간 업데이트

새 봉은 `update()`로 밀어 넣습니다. 시간이 마지막 봉과 같으면 그 봉을 바꾸고, 더 늦으면 뒤에 붙입니다:

```ts
socket.onmessage = (message) => {
  const bar = JSON.parse(message.data);
  chart.data.update(bar);
};
```

체결 데이터를 받는다면 그대로 차트에 넘기면 됩니다. 차트가 현재 봉에 합치고, 시간이 되면 알아서 새 봉을 엽니다. 이렇게 하려면 `data.set()`에서 봉의 `interval`을 지정해 두어야 합니다:

```ts
chart.data.addTrades({ time: trade.time, price: trade.price, size: trade.size });
```

## 과거 데이터 더 불러오기

사용자가 왼쪽으로 드래그해 봉이 거의 남지 않으면 차트가 `loadMore` 이벤트를 보냅니다. 더 이전의 봉을 `prepend()`로 앞에 붙이세요:

```ts
chart.on('loadMore', async ({ before }) => {
  const older = await fetchBars({ endTime: before - 1 });
  chart.data.prepend(older);
});
```

`before`는 현재 첫 번째 봉의 시간입니다. 봉을 붙이면 첫 번째 봉이 바뀌므로, 사용자가 다시 왼쪽으로 드래그하면 이벤트가 또 발생합니다.

## 번들러 없이 쓰기

페이지에 스크립트 하나만 넣으면 모든 모듈이 전역 `KumoChart`에 들어 있습니다:

```html
<div id="chart" style="height: 480px"></div>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules()
  });
  chart.data.set(bars);
</script>
```

이 스크립트에는 모든 기능이 들어 있으며, gzip 후 약 112 kB입니다. 지표 이름의 중국어, 일본어, 한국어 번역([지표](indicators.md#다국어) 참고)은 약 6 kB의 별도 스크립트에 있어 필요할 때만 불러오며, 전역 `KumoChartIndicatorTexts`에 들어갑니다.

```html
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kumochart-sdk/core/dist/kumochart-indicator-texts.iife.js"></script>
<script>
  const chart = KumoChart.createChart(document.getElementById('chart'), {
    modules: KumoChart.allModules({
      indicators: { texts: [KumoChartIndicatorTexts.indicatorTexts] }
    }),
    locale: 'zh-CN'
  });
</script>
```

## 제거

차트를 페이지에서 뺄 때는 `destroy()`를 호출하세요. 차트가 만든 요소를 지우고, 모든 리스너와 타이머를 해제합니다:

```ts
chart.destroy();
```

파기한 뒤에는 차트의 어떤 메서드를 호출해도 오류가 납니다(읽기도 마찬가지입니다). `destroy()`를 다시 호출해도 아무 일도 일어나지 않습니다.

## 다음 단계

- [모듈](modules.md): 어떤 기능이 어느 모듈에 있는지, 필요한 것만 불러오는 방법.
- [데이터](data.md): 봉, 체결, 주기 합성의 자세한 내용.
- [외관](appearance.md): 테마, 색상, 축, 십자선.

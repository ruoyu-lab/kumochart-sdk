# KumoChart

오픈 소스 트레이딩 차트 SDK입니다. 코어에는 봉과 스케일만 들어 있고, 지표, 그리기, 알림, 리플레이는 필요할 때 불러옵니다.

```ts live height=460 collapsed
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, VOL, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, VOL, MACD]), drawings(allDrawings)],
  latestPrice: { countdown: true }
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });
chart.indicators.add({ type: 'MACD' });
```

```bash
npm install @kumochart-sdk/core
```

## 여기서 시작하기

- [빠른 시작](getting-started.md): 설치하고, 첫 차트를 그리고, 실시간 데이터를 연결합니다.
- [모듈](modules.md): 지표, 그리기, 알림, 리플레이를 필요한 것만 불러오는 방법.
- [데이터](data.md)와 [주기와 거래 캘린더](timeframes.md): 봉과 체결, 그리고 브라우저에서 원하는 주기를 만드는 방법.
- [지표](indicators.md), [그리기 도구](drawings.md): 지표 50가지, 그리기 도구 38가지.
- [Vue](vue.md), [React](react.md): 컴포넌트와 컴포저블.
- [API 레퍼런스](../api.md): 모든 함수와 모든 옵션.

Apache-2.0 라이선스이며, 소스 코드는 [GitHub](https://github.com/ruoyu-lab/kumochart-sdk)에 있습니다.

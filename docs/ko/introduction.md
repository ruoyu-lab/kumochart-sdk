# 소개

KumoChart는 오픈 소스 트레이딩 차트 SDK입니다. 코어에는 봉과 스케일만 들어 있고, 지표, 그리기, 알림, 리플레이는 필요할 때 불러옵니다.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, EMA, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([EMA, RSI]), drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'EMA' });
chart.indicators.add({ type: 'RSI' });
```

## 할 수 있는 일

코어에 기본으로 들어 있는 것:

- 기본 시리즈 11가지: 캔들, 할로우캔들, OHLC 바, 하이-로우, 라인, 스텝 라인, 마커가 있는 라인, 영역, 베이스라인, HLC 영역, 컬럼.
- 여러 개의 창: 메인 창과 원하는 만큼의 보조 창을 둘 수 있습니다. 창마다 가격 스케일을 여러 개 둘 수 있고, 로그, 퍼센트, 100 기준 스케일을 지원합니다.
- 십자선, 범례, 확대/축소와 스크롤. 마우스, 트랙패드, 터치스크린, 키보드로 모두 조작할 수 있습니다.
- 주기 합성: 1분봉을 주면 브라우저에서 5분봉, 1시간봉, 일봉 등 원하는 주기를 만듭니다. 거래 세션과 시간대도 설정할 수 있습니다.
- 체결을 실시간으로 봉에 합치고, 과거 봉은 왼쪽으로 스크롤할 때 필요한 만큼 불러옵니다.
- 저장과 복원: 차트의 레이아웃, 지표, 그리기를 한 번에 저장하고 한 번에 복원합니다.

모듈에 들어 있는 것:

| 모듈               | 내용                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| 지표               | 50가지. 이동평균, MACD, RSI부터 일목균형표, VWAP, SuperTrend까지                                       |
| 그리기 도구        | 38가지. 추세선, 채널, 피보나치, 간, 패턴, 롱·숏 포지션 등                                              |
| 차트 유형          | 하이킨 아시, 렌코, 레인지, 라인브레이크, 카기, 포인트앤피겨, 그리고 체결 수나 거래량으로 만드는 봉     |
| 알림               | 가격이나 지표가 어떤 가격, 다른 선, 채널을 지나갈 때 알림. 알림 가격선은 차트에서 드래그할 수 있습니다 |
| 주문선과 체결 표시 | 차트에 주문을 표시하고 드래그하며, 봉 위에 체결을 표시                                                 |
| 리플레이           | 과거의 어느 봉부터 한 봉씩 재생                                                                        |
| 매물대             | 가격별 거래량. 화면에 보이는 봉, 거래일마다, 또는 사용자가 지정한 기간                                 |

[Vue](vue.md)와 [React](react.md) 컴포넌트도 있습니다.

부족한 부분은 직접 확장할 수 있습니다. [사용자 정의 지표](custom-indicators.md), [그리기 도구](custom-drawings.md), [시리즈](custom-series.md)를 만들거나, 캔버스에 바로 [그릴](plugins.md) 수도 있습니다.

## 코어와 모듈

`createChart()`로 만든 차트에는 코어만 있습니다. 쓰려는 기능은 모듈로 넘기며, 모듈마다 통째로 불러올 수도 있고 몇 가지만 골라 불러올 수도 있습니다:

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const chart = createChart(container, {
  modules: [indicators([MA, MACD]), drawings(allDrawings)]
});
```

불러오지 않은 부분은 번들에 포함되지 않습니다. 코어는 압축 후 약 44 kB(gzip)이고, 전부 불러오면 약 103 kB입니다. 자세한 내용은 [모듈](modules.md)을 참고하세요.

## 브라우저 지원

Chrome, Edge 99 이상, Firefox 112 이상, Safari 16 이상(iOS 포함).

차트를 그리려면 브라우저가 필요합니다. 지표, 그리기, 매물대의 수치 계산은 브라우저가 없어도 되므로 Node.js에서 따로 쓸 수 있습니다. 예를 들어 서버에서 지표를 계산하거나 알림 조건을 판단할 수 있습니다.

## 라이선스

Apache-2.0 라이선스이며, 상용 제품에도 무료로 쓸 수 있습니다. 웹사이트나 앱에서 KumoChart를 쓴다면 바닥글이나 소개 페이지처럼 사용자가 볼 수 있는 곳에 [kumochart.com](https://kumochart.com) 링크와 함께 표시해 주세요(예: "Charts by KumoChart"). 차트 자체에는 로고를 표시하지 않습니다.

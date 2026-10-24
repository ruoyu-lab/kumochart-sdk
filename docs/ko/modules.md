# 모듈

<!-- code-prelude
declare const myIndicator: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
-->

코어에는 모든 차트에 필요한 것만 들어 있습니다: 봉과 기본 시리즈, 스케일, 창, 십자선, 범례, 확대/축소와 스크롤, 주기 합성, 저장과 복원. 나머지 기능은 모두 모듈이며 쓸 때만 불러옵니다. 불러오지 않은 모듈은 번들에 포함되지 않습니다.

## 모듈 불러오기

차트를 만들 때 모듈을 `modules`에 넣습니다:

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { alerts } from '@kumochart-sdk/core/alerts';

const chart = createChart(container, {
  modules: [indicators(allIndicators), drawings(allDrawings), alerts()]
});

chart.indicators.add({ type: 'RSI' });
chart.drawings.startTool('fib-retracement');
chart.alerts.add({ id: 'btc-100k', trigger: 'cross-up', value: 100000 });
```

모듈을 불러오면 차트에 그 모듈의 API(예: `chart.indicators`)와 옵션, 이벤트가 추가됩니다. 모듈은 차트를 만들 때만 넘길 수 있고, 만든 뒤에는 추가하거나 뺄 수 없습니다.

## 모듈 목록

| 모듈      | 진입점                               | 불러오기                    | 차트에 추가되는 것                 |
| --------- | ------------------------------------ | --------------------------- | ---------------------------------- |
| 지표      | `@kumochart-sdk/core/indicators`     | `indicators(allIndicators)` | `chart.indicators`                 |
| 그리기    | `@kumochart-sdk/core/drawings`       | `drawings(allDrawings)`     | `chart.drawings`                   |
| 차트 유형 | `@kumochart-sdk/core/chart-types`    | `chartTypes(allChartTypes)` | 메인 창을 이 유형들로 바꿀 수 있음 |
| 알림      | `@kumochart-sdk/core/alerts`         | `alerts()`                  | `chart.alerts`                     |
| 주문선    | `@kumochart-sdk/core/trading`        | `orders()`                  | `chart.orders`                     |
| 체결 표시 | `@kumochart-sdk/core/trading`        | `markers()`                 | `chart.markers`                    |
| 리플레이  | `@kumochart-sdk/core/replay`         | `replay()`                  | `chart.replay`                     |
| 매물대    | `@kumochart-sdk/core/volume-profile` | `volumeProfiles()`          | `chart.volumeProfiles`             |
| 워터마크  | `@kumochart-sdk/core/watermark`      | `watermark()`               | `watermark` 옵션                   |
| 전체      | `@kumochart-sdk/core/all`            | `allModules()`              | 위의 모든 것                       |

매물대의 진입점에는 그리기 도구도 하나 있습니다. 고정 범위 매물대 `fixedRangeVolumeProfile()`이며, 그리기 모듈에 넘겨 씁니다. [매물대](volume-profile.md#고정-범위)를 참고하세요.

## 통째로, 또는 골라서 불러오기

지표, 그리기, 차트 유형 이 세 모듈에는 여러 종류가 들어 있습니다. 전부 불러와도 되고, 쓸 것만 골라 넘겨도 됩니다:

```ts
import { indicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine, fibRetracement } from '@kumochart-sdk/core/drawings';
import { chartTypes, heikinAshi, renko } from '@kumochart-sdk/core/chart-types';

const chart = createChart(container, {
  modules: [
    indicators([MA, MACD, RSI]),
    drawings([trendLine, horizontalLine, fibRetracement]),
    chartTypes([heikinAshi, renko])
  ]
});
```

넘긴 것만 번들에 들어갑니다. 모듈마다 무엇이 들어 있는지는 [지표](indicators.md), [그리기 도구](drawings.md), [차트 유형](chart-types.md)을 참고하세요.

## 크기

압축하고 gzip한 크기이며, 코어를 포함합니다:

| 불러온 내용               | 크기      |
| ------------------------- | --------- |
| 코어만                    | 약 44 kB  |
| 코어 + MA, MACD, RSI      | 약 54 kB  |
| 코어 + 모든 지표          | 약 63 kB  |
| 코어 + 추세선과 수평선    | 약 57 kB  |
| 코어 + 모든 그리기 도구   | 약 69 kB  |
| 코어 + 모든 차트 유형     | 약 49 kB  |
| 코어 + 알림               | 약 49 kB  |
| 코어 + 주문선과 체결 표시 | 약 47 kB  |
| 코어 + 리플레이           | 약 45 kB  |
| 코어 + 매물대             | 약 47 kB  |
| 전체                      | 약 103 kB |

모듈들은 코어의 코드를 함께 쓰므로, 같이 불러오면 위의 차이를 단순히 더한 것보다 작습니다.

## 만든 뒤에 유형 추가하기

모듈은 차트를 만들 때만 넘길 수 있지만, 모듈 안의 유형은 언제든 추가하고 뺄 수 있습니다. 예를 들어 직접 만든 지표는 이렇게 합니다:

```ts
chart.indicators.register(myIndicator);
chart.indicators.add({ type: myIndicator.type });

chart.indicators.types(); // 지금 쓸 수 있는 지표 유형
chart.indicators.unregister(myIndicator.type);
```

그리기(`chart.drawings`), 봉 변환(`chart.transforms`), 시리즈(`chart.series`)에도 똑같이 `register()`, `unregister()`, `types()`가 있습니다. 차트에서 아직 쓰고 있는 유형은 뺄 수 없으며, 빼려고 하면 오류가 나고 어디서 쓰고 있는지 알려 줍니다.

차트를 만들 때부터 직접 만든 유형을 넣고 싶거나 차트에 기능을 통째로 추가하고 싶다면 [사용자 정의 모듈](custom-modules.md)을 참고하세요.

## 전부 불러오기

크기가 상관없거나 일단 써 보고 싶다면 전부 불러오세요:

```ts
import { createChart } from '@kumochart-sdk/core';
import { allModules } from '@kumochart-sdk/core/all';

const chart = createChart(container, { modules: allModules() });
```

번들러 없이 쓸 때 넣는 `kumochart.iife.js`도 전부 불러온 상태입니다. [빠른 시작](getting-started.md#번들러-없이-쓰기)을 참고하세요.

## TypeScript에서

차트의 타입은 모듈을 따라갑니다. 지표 모듈을 불러와야 `chart.indicators`에 타입이 생기고, 불러오지 않고 쓰면 컴파일할 때 오류가 납니다.

이런 차트의 타입을 다른 곳에서 쓰려면 `Chart`에 모듈의 타입을 붙입니다:

```ts
import { createChart, type Chart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const modules = [indicators(allIndicators), drawings(allDrawings)] as const;

export type MyChart = Chart<typeof modules>;

export function mountChart(container: HTMLElement): MyChart {
  return createChart(container, { modules });
}
```

전부 불러온 차트는 `Chart<AllModules>`입니다(`AllModules`는 `@kumochart-sdk/core/all`에서 가져옵니다). `Chart`만 쓰면 모듈이 하나도 없는 차트이며, 어떤 차트든 이 타입으로 다룰 수 있습니다.

## 저장된 상태와 모듈

`chart.saveState()`로 저장한 상태에는 지표, 그리기처럼 모듈별 부분이 들어 있습니다. 복원할 때는 차트에 같은 모듈이 있어야 합니다. 상태에 그리기가 있는데 차트에 그리기 모듈이 없으면 `loadState()`가 오류를 내고, 차트는 그대로 유지됩니다. [저장과 복원](state.md)을 참고하세요.

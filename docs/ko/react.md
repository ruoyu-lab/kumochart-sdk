# React

```bash
npm install @kumochart-sdk/core @kumochart-sdk/react
```

React 18.3 또는 19가 필요합니다. 쓰는 방법은 두 가지입니다. 데이터, 주기 같은 것을 속성으로 넘기는 `KumoChart` 컴포넌트와, 차트 객체를 직접 받아 다루는 `useKumoChart` 훅입니다.

## 컴포넌트

```tsx
import { KumoChart } from '@kumochart-sdk/react';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

// 컴포넌트 밖에 두어, 렌더링할 때마다 같은 객체가 되게 합니다
const modules = [indicators([MA, MACD])] as const;
const options = { locale: 'ko-KR' };

export function PriceChart({ bars, timeframe }: { bars: BarInput[]; timeframe: string }) {
  return (
    <div style={{ height: 480 }}>
      <KumoChart
        modules={modules}
        options={options}
        data={bars}
        interval="1m"
        timeframe={timeframe}
        onReady={(chart) => {
          (chart as Chart<typeof modules>).indicators.add({ type: 'MACD' });
        }}
        onCrosshairMove={(event) => console.log(event)}
      />
    </div>
  );
}
```

<!-- code-prelude
declare const modules: readonly import('@kumochart-sdk/core').ChartModule[];
-->

컴포넌트는 기본적으로 부모 요소를 가득 채우므로(`width: 100%; height: 100%`) 부모 요소에 높이가 있어야 합니다. `style`, `className`으로 직접 정할 수도 있습니다.

| 속성        | 역할                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| `modules`   | 차트의 모듈. **차트를 만들 때 한 번만 읽으며**, 이후에 바꿔도 효과가 없습니다 |
| `options`   | 차트 옵션. 새 객체를 넘기면 `applyOptions()`합니다(모듈의 옵션 포함)          |
| `data`      | 봉. 새 배열을 넘기면 한꺼번에 교체합니다                                      |
| `interval`  | `data`의 주기. 예: `'1m'`. 주기 변경과 체결 합치기에 필요합니다               |
| `timeframe` | 표시 주기. `null`이면 원본 주기를 표시                                        |
| `transform` | 봉 변환. 예: `{ type: 'renko' }`. `null`이면 끕니다                           |
| `orders`    | 주문. `orders()` 모듈이 필요합니다                                            |
| `markers`   | 체결 표시. `markers()` 모듈이 필요합니다                                      |
| `alerts`    | 알림. `alerts()` 모듈이 필요합니다                                            |

차트와 모듈의 이벤트마다 대응하는 `on*` 속성이 있습니다: `onCrosshairMove`, `onOrderDrag`, `onDrawingsChange`… `onReady`는 차트가 만들어지고 위의 속성이 모두 설정된 뒤에 차트 객체를 넘겨줍니다.

속성은 React의 state처럼 참조로 비교합니다. 렌더링할 때마다 `options={{ ... }}`를 새로 쓰면 차트가 매번 옵션을 다시 적용합니다. 바뀌지 않는 객체는 컴포넌트 밖에 두거나 `useMemo`를 쓰세요.

`data`는 한꺼번에 교체되므로 실시간 업데이트에는 맞지 않습니다. 실시간 데이터는 `onReady`로 차트를 받은 뒤 `chart.data.update()`로 밀어 넣으세요.

`ref`로도 차트를 받을 수 있습니다:

```tsx
import { useRef } from 'react';
import { KumoChart } from '@kumochart-sdk/react';
import type { Chart } from '@kumochart-sdk/core';

const chartRef = useRef<Chart | null>(null);

<KumoChart ref={chartRef} modules={modules} />;
// chartRef.current는 차트 객체이며, 만들어지기 전에는 null
```

## 훅

완전히 직접 제어하고 싶거나 모듈 타입이 붙은 차트 객체가 필요하면 `useKumoChart`를 씁니다:

```tsx
import { useEffect } from 'react';
import { useKumoChart } from '@kumochart-sdk/react';
import type { BarInput } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const chartOptions = { modules: [indicators(allIndicators)] };

export function PriceChart({ bars }: { bars: BarInput[] }) {
  const [ref, chart] = useKumoChart(chartOptions);

  useEffect(() => {
    chart?.data.set(bars, { interval: '1m' });
  }, [chart, bars]);

  return (
    <>
      <button onClick={() => chart?.indicators.add({ type: 'RSI' })}>RSI</button>
      <div ref={ref} style={{ height: 480 }} />
    </>
  );
}
```

`ref`는 차트를 넣을 요소에 지정합니다. 요소가 나타나면 차트를 만들고, 사라지면 제거합니다. 그 전까지 `chart`는 `null`입니다. `modules`를 제외하면 새 옵션 객체를 넘길 때 자동으로 적용되므로, 옵션 객체는 바뀌지 않게 유지해야 합니다.

## 주의

- `modules`는 차트를 만들 때만 씁니다. 모듈을 바꾸려면 컴포넌트 인스턴스를 바꾸세요(예: `key`를 바꾸기).
- 서버 사이드 렌더링에서는 차트를 브라우저에서만 만들며, 서버에서는 빈 `div` 하나만 출력합니다.

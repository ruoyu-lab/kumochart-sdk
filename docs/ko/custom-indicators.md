# 사용자 정의 지표

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition<{ period: number }>;
-->

직접 만든 지표도 내장 지표와 똑같이 동작합니다. 차트에 추가하고, 범례에 표시하고, 알림으로 감시하고, 레이아웃에 저장할 수 있으며, 차트가 없는 곳에서도 계산할 수 있습니다.

## 가장 간단한 작성법

값 하나를 계산할 때 몇 개 봉을 거슬러 볼지(`lookback`) 차트에 알려 주고, 그 봉들로 값을 계산하는 함수(`compute`)를 줍니다.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, type IndicatorDefinition } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

/** 가격이 이동평균에서 벗어난 정도(%) */
const DEVIATION: IndicatorDefinition<{ period: number }> = {
  type: 'DEVIATION',
  name: '이동평균 이격',
  pane: 'new', // 별도 창을 엶, 'main'이면 메인 창에 그림
  precision: 2,
  params: { period: { default: 20, min: 2, max: 500, integer: true, label: '기간' } },
  outputs: () => [{ key: 'dev', label: '이격%', plot: { kind: 'histogram', colorBy: 'sign' } }],
  levels: () => [0],
  lookback: ({ period }) => period,
  compute: (window) => {
    let sum = 0;
    for (let i = 0; i < window.length; i += 1) sum += window.price(i);
    const average = sum / window.length;
    const latest = window.price(window.length - 1);
    return [((latest - average) / average) * 100];
  }
};

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([DEVIATION])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.indicators.add({ type: 'DEVIATION' });
```

`window`는 최근 `lookback`개의 봉이며, 오래된 것부터 최신 순입니다. `window.price(i)`는 지표에 설정된 가격(기본값은 종가)이고, `window.bar(i)`는 봉 전체입니다. 봉이 아직 `lookback`개에 못 미치면 `compute`가 호출되지 않으며, 그 봉들에는 값이 없습니다.

`compute`는 출력마다 값을 하나씩 담은 배열을 반환합니다. 값이 없는 곳에서는 `NaN`을 반환합니다.

## 사용하기

차트를 만들 때 내장 지표와 함께 넘깁니다.

```ts
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators([...allIndicators, DEVIATION])] });
```

또는 차트를 만든 뒤에 등록합니다.

```ts
chart.indicators.register(DEVIATION);
chart.indicators.add({ type: 'DEVIATION', params: { period: 50 } });
```

## 봉 단위로 계산하기

`compute`는 봉마다 `window` 전체를 다시 계산하므로 기간이 길면 느려집니다. 또 EMA처럼 아주 오래전의 상태를 기억해야 하는 지표도 있습니다. 이럴 때는 대신 `create`를 작성해, 봉 하나씩 앞으로 계산해 나가는 계산기를 반환합니다.

```ts
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

/** 연속으로 몇 봉 상승 또는 하락했는지: 상승은 양수, 하락은 음수 */
class StreakStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private previous = Number.NaN,
    private streak = 0
  ) {}

  next(_bar: unknown, price: number): ArrayLike<number> {
    if (price > this.previous) this.streak = this.streak > 0 ? this.streak + 1 : 1;
    else if (price < this.previous) this.streak = this.streak < 0 ? this.streak - 1 : -1;
    else this.streak = 0;
    this.previous = price;
    this.out[0] = this.streak;
    return this.out;
  }

  clone(): IndicatorStream {
    return new StreakStream(this.previous, this.streak);
  }
}

export const STREAK: IndicatorDefinition<Record<string, never>> = {
  type: 'STREAK',
  name: '연속 상승·하락',
  pane: 'new',
  precision: 0,
  params: {},
  outputs: () => [{ key: 'streak', label: 'STREAK', plot: { kind: 'histogram', colorBy: 'sign' } }],
  create: () => new StreakStream()
};
```

두 가지 규칙이 있습니다.

- `next(bar, price)`는 봉마다 한 번, 시간 순서대로 호출됩니다. `bar` 객체는 재사용되므로 참조를 저장하지 말고, 필요한 숫자만 꺼내 두세요.
- `clone()`은 모든 상태를 복사해야 합니다. 최신 봉이 실시간으로 업데이트되면 차트는 업데이트 이전의 복사본에서 그 봉을 다시 계산하므로, 복사본과 원본은 서로 영향을 주지 않아야 합니다.

## SDK의 블록으로 만들기

EMA나 표준편차 같은 흔한 계산은 직접 다시 작성할 필요가 없습니다. `@kumochart-sdk/core/indicators`는 SDK 자체 지표가 쓰는 블록을 내보내며, 모두 `clone()`할 수 있습니다.

| 블록                          | 계산하는 것                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `movingAverage(kind, period)` | 이동평균: `'sma'`, `'ema'`, `'rma'`, `'wma'`, `'vwma'`. 내장 지표가 고르는 평균과 같음 |
| `StandardDeviation`           | 최근 `period`개 값의 표준편차                                                          |
| `RollingExtremes`             | 최근 `period`개 봉의 최고가와 최저가                                                   |
| `RingBuffer`                  | 최근 `capacity`개 값. 최댓값, 최솟값, 합계도 구할 수 있음                              |
| `Previous`                    | 바로 앞의 값                                                                           |

예를 들어 EMA 위아래로 표준편차의 몇 배를 더하고 뺀 밴드입니다.

```ts
import type { Bar } from '@kumochart-sdk/core';
import {
  movingAverage,
  StandardDeviation,
  type BarStep,
  type IndicatorDefinition,
  type IndicatorStream
} from '@kumochart-sdk/core/indicators';

class EmaBandStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly width: number,
    private readonly average: BarStep,
    private readonly deviation: StandardDeviation
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const middle = this.average.next(price, bar); // 봉은 거래량 가중 평균이 거래량을 읽기 위한 것
    const spread = this.deviation.next(price) * this.width;
    this.out[0] = middle;
    this.out[1] = middle + spread;
    this.out[2] = middle - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    // 블록마다 자기 상태를 복사
    return new EmaBandStream(this.width, this.average.clone(), this.deviation.clone());
  }
}

export const EMA_BAND: IndicatorDefinition<{ period: number; width: number }> = {
  type: 'EMA_BAND',
  name: 'EMA 밴드',
  pane: 'main',
  precision: 'price',
  params: {
    period: { default: 20, min: 2, max: 500, integer: true, label: '기간' },
    width: { default: 2, min: 0.1, max: 10, label: '배수' }
  },
  outputs: () => [
    { key: 'basis', label: 'EMA', plot: { kind: 'line' } },
    { key: 'upper', label: '상단', plot: { kind: 'line' } },
    { key: 'lower', label: '하단', plot: { kind: 'line' } }
  ],
  fills: () => [{ from: 'upper', to: 'lower' }],
  create: ({ period, width }) =>
    new EmaBandStream(width, movingAverage('ema', period), new StandardDeviation(period))
};
```

평균과 표준편차는 값이 `period`개 모이기 전까지 `NaN`이고, `NaN`은 건너뛰며 값은 그대로 둡니다. `clone()`에서 블록마다 `clone()`하면 계산기 전체가 복사됩니다.

## 출력을 그리는 방식

각 출력의 `plot`으로 정합니다.

| `kind`      | 그리는 방식                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `line`      | 선, `style`은 `solid`, `dashed`, `dotted` 중 하나, `width`는 선 두께(픽셀, 0.5~10, 기본 1.25)     |
| `segments`  | 값이 같은 구간마다 가로선 하나를 그림, 예: 날마다의 피벗 포인트; `style`, `width`는 `line`과 같음 |
| `histogram` | 0에서 시작하는 막대, 부호(`sign`), 등락(`change`), 봉 방향(`bar`)에 따라 색을 칠함                |
| `columns`   | 다른 출력(또는 고정값)에서 이 값까지의 막대                                                       |
| `box`       | 다른 출력에서 이 값까지의 상자, 예: 거래 세션의 고가·저가 구간                                    |
| `marker`    | 값이 있는 봉에 도형이나 텍스트를 그림, 예: 골든크로스 지점의 화살표                               |
| `hidden`    | 그리지 않음, 범례에만 표시하고 알림에 사용                                                        |

출력에는 다음 설정도 있습니다.

```ts
import type { IndicatorOutput } from '@kumochart-sdk/core/indicators';

const upper: IndicatorOutput = {
  key: 'upper',
  label: 'Upper',
  plot: { kind: 'line' },
  color: '#5b9cf0', // 없으면 테마의 palette에서 차례로 가져옴
  themeColor: 'up', // 또는 테마의 상승·하락 색상 사용
  offset: 26, // 26봉 오른쪽으로 옮겨 그림, 예: 일목균형표의 선행스팬
  legend: false, // 범례에 표시하지 않음
  precision: 4, // 이 출력만의 소수점 자릿수
  autoscale: false // 가격 축의 자동 스케일에서 제외
};
```

두 선 사이를 채우려면 정의에 `fills`를 씁니다. 예를 들어 볼린저 밴드의 상단과 하단 사이는 `fills: () => [{ from: 'upper', to: 'lower' }]`입니다. `outputs`처럼 매개변수에 따라 돌려주므로, 매개변수로 밴드를 켰을 때만 채울 수도 있습니다. 채우기에 쓰는 출력이 그 매개변수로는 나오지 않으면 지표를 추가할 때 오류가 나고, 조용히 그리지 않는 일은 없습니다.

## 매개변수

```ts
import type { ParamSpec } from '@kumochart-sdk/core/indicators';

const params = {
  period: { default: 14, min: 1, max: 500, integer: true, label: '기간' },
  periods: { default: [5, 10, 20], min: 1, integer: true }, // 숫자 여러 개, 예: 여러 개의 이동평균선
  anchor: {
    default: 1,
    // 이 값들 중 하나만 가능, 화면에는 드롭다운으로 표시
    options: [
      { value: 1, label: '일' },
      { value: 2, label: '주' }
    ]
  }
} satisfies Record<string, ParamSpec>;
```

매개변수는 모두 숫자나 숫자 배열입니다. 사용자가 준 매개변수는 여기 적은 범위로 검사하며, 범위를 벗어나면 오류가 납니다.

## 거래일 기준으로 계산하기

매일 새로 계산하는 VWAP처럼 거래일, 주, 월마다 다시 시작해야 하는 지표는 두 번째 인자로 받는 거래 캘린더를 씁니다.

```ts
import type { Bar, Calendar } from '@kumochart-sdk/core';
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

class DayHighStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly calendar: Calendar,
    private day: number | null = null,
    private high = Number.NaN
  ) {}

  next(bar: Bar): ArrayLike<number> {
    // 이 봉이 속한 거래일, 거래 세션 밖의 시간이면 null
    const day = this.calendar.bucket(bar.time, '1D');
    this.high = day === this.day ? Math.max(this.high, bar.high) : bar.high;
    this.day = day;
    this.out[0] = this.high;
    return this.out;
  }

  clone(): IndicatorStream {
    return new DayHighStream(this.calendar, this.day, this.high);
  }
}

const DAY_HIGH: IndicatorDefinition<Record<string, never>> = {
  type: 'DAY_HIGH',
  name: '당일 고가',
  pane: 'main',
  precision: 'price',
  params: {},
  outputs: () => [{ key: 'high', label: 'DH', plot: { kind: 'segments' } }],
  create: (_params, { calendar }) => new DayHighStream(calendar)
};
```

이 캘린더는 차트의 `calendar` 옵션이며, 사용자가 거래 세션을 바꾸면 지표도 다시 계산됩니다. 두 번째 인자에는 봉의 주기 `interval`도 있습니다. 차트가 보여 주는 주기이며, `data.set()`에 주기를 주지 않은 봉에서는 `null`입니다.

## 차트 없이 계산하기

```ts
import { computeIndicator } from '@kumochart-sdk/core/indicators';

const { dev } = computeIndicator(DEVIATION, bars, { params: { period: 50 } });
// dev[i]는 i번째 봉의 값으로, 차트에서 계산한 값과 같음
```

봉 하나씩 진행하려면 `createIndicatorCalculator()`를 씁니다. 서버에서 실시간 데이터를 따라 계산하고 알림을 판단할 때 알맞습니다. 모두 Node.js에서 실행할 수 있습니다.

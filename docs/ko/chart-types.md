# 차트 유형

코어에는 11가지 시리즈 유형(캔들, 라인, 영역 등, [외관](appearance.md#메인-시리즈) 참고)이 기본으로 들어 있습니다. 차트 유형 모듈은 여기에 다음을 더합니다.

| 유형                         | 가져올 이름     | 만드는 방식                                                                       |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------- |
| 하이킨 아시(Heikin-Ashi)     | `heikinAshi`    | 각 봉을 자신과 직전 봉의 평균으로 만들어 추세가 더 매끄러움                       |
| 렌코(Renko)                  | `renko`         | 가격이 한 칸 움직일 때마다 벽돌 하나를 그림, 시간과는 무관                        |
| 레인지 바                    | `rangeBars`     | 각 봉의 고가에서 저가까지가 정확히 고정된 폭                                      |
| 라인브레이크(Line break)     | `lineBreak`     | 종가가 직전 몇 개 봉의 최고가나 최저가를 돌파해야 새 봉을 그림                    |
| 카기(Kagi)                   | `kagi`          | 종가가 반대 방향으로 일정 폭 이상 움직여야 꺾이고, 선의 굵기로 강세·약세를 나타냄 |
| 포인트앤피겨(Point & figure) | `pointFigure`   | 상승은 X, 하락은 O로 그리고, 반대로 몇 칸 이상 움직여야 열을 바꿈                 |
| 틱 바                        | `tickBars`      | 일정한 체결 건수마다 봉 하나                                                      |
| 거래량 바                    | `volumeBars`    | 일정한 거래량마다 봉 하나                                                         |
| 거래대금 바                  | `turnoverBars`  | 일정한 거래대금마다 봉 하나                                                       |
| 볼륨 캔들                    | `volumeCandles` | 캔들의 너비가 거래량에 따라 달라짐                                                |

```ts live height=400
import { createChart } from '@kumochart-sdk/core';
import { chartTypes, renko } from '@kumochart-sdk/core/chart-types';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [chartTypes([renko])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.transforms.set({ type: 'renko' }); // 벽돌 크기는 기본적으로 14개 봉의 평균 실제 범위로 자동 결정
```

## 두 가지 차트 유형

차트 유형은 두 가지 방식으로 동작합니다.

- **봉을 새로 만들기**: 하이킨 아시, 렌코, 레인지 바, 라인브레이크, 틱 바, 거래량 바, 거래대금 바는 `chart.transforms.set()`으로 켭니다. 현재 주기의 봉으로 새 봉을 만들어 표시합니다.
- **그리는 방식 바꾸기**: 볼륨 캔들은 `mainSeries.type`으로 전환하며, 봉은 원래 그대로입니다.

카기와 포인트앤피겨는 둘 다 필요합니다. 먼저 봉을 만들고, 그다음 그리는 방식을 바꿉니다.

```ts
// 렌코
chart.transforms.set({ type: 'renko', params: { box: 500 } });

// 카기: 카기 선을 만들고 카기 방식으로 그림
chart.batch(() => {
  chart.transforms.set({ type: 'kagi' });
  chart.applyOptions({ mainSeries: { type: 'kagi' } });
});

// 볼륨 캔들
chart.applyOptions({ mainSeries: { type: 'volume-candles' } });

// 일반 봉으로 돌아가기
chart.transforms.set(null);
chart.applyOptions({ mainSeries: { type: 'candles' } });
```

만들어진 봉이 곧 차트의 '표시되는 봉'입니다. 지표도 이 봉으로 계산하고, `chart.data.toArray()`가 돌려주는 것도 이 봉입니다. 원본 데이터는 바뀌지 않으며, 변환을 끄면 원래대로 돌아옵니다.

## 매개변수

| 유형         | `type`         | 매개변수                                                                                                                                                                                                            |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 하이킨 아시  | `heikin-ashi`  | 없음                                                                                                                                                                                                                |
| 렌코         | `renko`        | `box`는 고정된 벽돌 높이, `percentage`는 최근 가격 대비 비율이며, 둘 다 없으면 `atrLength`(기본 14)개 봉의 평균 실제 범위를 씀; `source`는 `close`(기본값) 또는 `ohlc`; `wicks`는 꼬리를 그릴지 여부(기본값은 그림) |
| 레인지 바    | `range`        | `range`는 봉마다의 폭이며, 없으면 14개 봉의 평균 실제 범위를 씀                                                                                                                                                     |
| 라인브레이크 | `line-break`   | `lines`는 직전 몇 개 봉을 돌파해야 하는지(기본 3)                                                                                                                                                                   |
| 카기         | `kagi`         | `reversal`은 고정된 반전 폭, 또는 `percentage`이며, 둘 다 없으면 `atrLength`개 봉의 평균 실제 범위를 씀                                                                                                             |
| 포인트앤피겨 | `point-figure` | `box`, `percentage`, `atrLength` 중 하나로 박스 크기를 정함; `reversal`은 반대로 몇 칸 움직이면 열을 바꿀지(기본 3); `source`는 `close` 또는 `hl`; `oneStepBack`은 1칸짜리 열의 반전을 허용                         |
| 틱 바        | `tick`         | `count`는 봉당 체결 건수(필수)                                                                                                                                                                                      |
| 거래량 바    | `volume`       | `volume`은 봉당 거래량(필수)                                                                                                                                                                                        |
| 거래대금 바  | `turnover`     | `turnover`는 봉당 거래대금(필수)                                                                                                                                                                                    |

### 자동 크기

고정 크기를 주지 않으면 차트는 이 봉들을 만들 때 가장 최근에 마감된 봉들로 크기를 정합니다. 평균 실제 범위라면 마지막으로 마감된 봉까지 `atrLength`개(기본 14개) 봉의 평균 실제 범위(아직 진행 중인 최신 봉은 빼고), 비율이라면 최신 가격의 비율이며, 읽기 좋은 수로 반올림합니다(2137은 2000).

그 뒤 실시간으로 들어오는 봉은 다음에 다시 만들 때까지 크기를 바꾸지 않습니다. 변환 설정, `data.set()`, 주기 변경, 과거 데이터 불러오기(`data.prepend()`), 리플레이 시작 때 다시 만들고, 그때의 최근 마감 봉으로 다시 계산합니다. 과거 데이터를 불러와도 최근 봉은 그대로라서 크기는 보통 바뀌지 않습니다.

마감된 봉이 `atrLength`개보다 적어 크기를 정할 수 없을 때는 아무것도 그리지 않습니다. 충분해지면 그 시점의 마감된 봉으로 크기를 정해 고정하고 첫 봉부터 그립니다. 비율로, 봉이 하나도 없는 상태에서 시작하면 첫 봉이 마감되기를 기다려 그 종가로 계산합니다.

체결로 만들 때(아래 참고)는 체결 하나가 가격 하나뿐이라 실제 범위가 없습니다. 고정 크기나 `percentage`를, 레인지 바라면 `range`를 주어야 하며, 주지 않으면 오류가 납니다.

자동으로 계산된 크기는 다시 읽어 와서 화면에 표시할 수 있습니다(아직 정해지지 않았으면 `resolved`는 `null`입니다).

```ts
chart.transforms.get();
// { type: 'renko', params: {}, input: 'bars', resolved: { box: 500, ... } }
```

## 체결(틱) 데이터로 만들기

틱 바, 거래량 바, 거래대금 바는 기본적으로 현재 주기의 봉을 합쳐서 만들며, 봉 하나가 쪼개지지는 않습니다. 실제 체결 하나하나를 기준으로 만들려면 `input: 'trades'`를 지정하고 체결 데이터를 차트에 넘깁니다.

```ts
chart.transforms.set({ type: 'tick', params: { count: 100 }, input: 'trades' });
chart.data.addTrades(trades);
```

차트는 이 봉들을 만들기 위해 최근 체결을 보관하며, 보관하는 양은 `performance.maxTrades`(기본 10만 건)로 정해집니다. 이때는 `data.set()`에서 봉의 `interval`을 지정해 두어야 합니다. [데이터](data.md#체결틱)를 참고하세요.

## 저장

`saveState()`는 봉 변환과 메인 시리즈를 그리는 방식을 저장하고, 레이아웃을 복원할 때 함께 되돌려 놓습니다. [저장과 복원](state.md)을 참고하세요.

봉 변환이나 그리는 방식을 직접 만들려면 [사용자 정의 시리즈](custom-series.md)를 참고하세요.

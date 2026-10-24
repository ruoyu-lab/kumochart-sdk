# 지표

지표 모듈에는 이동평균선, MACD, RSI부터 일목균형표, VWAP까지 50가지 지표가 있습니다. 세계적으로 널리 쓰이는 지표는 계산 방법과 기본 매개변수가 일반적으로 통용되는 것과 같고, KDJ, BIAS처럼 중국 시장에서 흔히 쓰는 지표는 중국에서 널리 쓰는 소프트웨어의 공식을 따릅니다.

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'BOLL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

## 불러오기

```ts
import { indicators, allIndicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators(allIndicators)] }); // 전부
createChart(container, { modules: [indicators([MA, MACD, RSI])] }); // 이것들만
```

## 추가

```ts
const id = chart.indicators.add({ type: 'RSI' });
```

<!-- code-prelude
declare const id: string;
declare const userInput: import('@kumochart-sdk/core/indicators').IndicatorInput;
-->

`add()`는 지표의 id를 돌려줍니다. 직접 준 `id`이거나, 차트가 종류별로 매긴 번호(예: `rsi-1`)입니다. 적지 않은 설정은 그 지표의 기본값을 쓰므로, 바꾸고 싶은 것만 적으면 됩니다.

```ts
chart.indicators.add({
  type: 'MA',
  params: { periods: [20, 60, 120] }, // 매개변수
  source: 'hlc3', // 계산에 쓸 가격, 기본값은 종가
  pane: 'main', // 그릴 창: 'main', 'new'(새 창), 또는 기존 창의 id
  scale: 'right', // 창의 어느 가격 축을 쓸지
  colors: { ma20: '#e8b04a' }, // 출력별 색상
  styles: { ma120: { lineWidth: 2, lineStyle: 'dashed' } }, // 출력별 선 굵기, 선 스타일, 또는 숨기기
  levels: [], // 기준선(예: RSI의 70, 30), []이면 그리지 않음
  visible: true
});
```

이동평균선처럼 메인 창에 겹쳐 그리는 지표는 기본값이 `pane: 'main'`이고, MACD, RSI 같은 지표는 기본적으로 별도의 창을 엽니다. [창](panes.md)을 참고하세요.

## 변경과 삭제

```ts
chart.indicators.update(id, { params: { period: 21 } });
chart.indicators.update(id, { colors: { rsi: null } }); // null이면 기본 색상으로 복원
chart.indicators.update(id, { levels: null }); // 기본 기준선으로 복원
chart.indicators.update(id, { visible: false }); // 숨기기
chart.indicators.update(id, { pane: 'new' }); // 별도 창으로 이동, 'main'이면 메인 창으로 복귀

chart.indicators.remove(id);
chart.indicators.list(); // 모든 지표
chart.indicators.get(id);
chart.indicators.set([{ type: 'MA' }, { type: 'RSI' }]); // 한꺼번에 교체
chart.indicators.clear(); // 모두 제거
```

[알림](alerts.md)이 감시하고 있는 지표는 바로 삭제할 수 없습니다. 먼저 알림을 삭제해야 합니다. `set()`으로 교체하거나 `clear()`로 비울 때도 마찬가지입니다.

## 값 읽기

```ts
chart.indicators.valuesAt(id); // 최신 봉의 값
chart.indicators.valuesAt(id, 120); // 120번째 봉의 값
// [{ key: 'rsi', label: 'RSI', value: 63.2, text: '63.20', color: '#…' }, …]
```

범례에 표시되는 값과 같습니다. `text`는 지표의 소수점 자릿수에 맞춰 형식화한 문자열이고, `color`는 그 선의 색상입니다. 어떤 봉에서 그 선에 값이 없으면(예: RSI에 필요한 봉이 아직 모이지 않았을 때) `value`는 `null`입니다.

## 지표로 계산하는 지표

`source`에는 다른 지표의 선을 지정할 수도 있습니다. 예를 들어 RSI의 EMA는 이렇게 만듭니다.

```ts
const rsiId = chart.indicators.add({ type: 'RSI' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: rsiId, key: 'rsi' },
  pane: rsiId // RSI와 같은 창에 그림
});
```

`key`를 생략하면 그 지표의 첫 번째 선을 씁니다. 다른 지표가 사용하고 있는 지표는 먼저 삭제할 수 없습니다.

## 다른 주기로 계산하기

`timeframe`을 지정하면 지표를 차트보다 긴 주기로 계산합니다. 예를 들어 5분 차트에 1시간 이동평균선을 표시할 수 있습니다.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('5m');

chart.indicators.add({ type: 'MA', params: { periods: [20] }, timeframe: '1h' }); // 1시간 봉 20개 이동평균
chart.indicators.add({ type: 'MA', params: { periods: [20] } }); // 5분 봉 20개 이동평균
```

지표가 쓰는 1시간 봉은 차트의 원본 봉으로 거래 캘린더에 따라 만들며, [주기 바꾸기](timeframes.md#주기-바꾸기)에서 만드는 봉과 같습니다. 실시간 데이터, 앞쪽으로 불러온 과거 데이터, 캘린더 변경, [리플레이](replay.md)도 따라갑니다. 같은 주기의 지표들은 봉 한 벌을 함께 씁니다.

**큰 주기의 마감을 기다림**: 차트의 각 봉에 표시되는 값은 그 봉이 끝날 때까지 마감된 마지막 1시간 봉의 값입니다. 1시간 봉은 다음 1시간 봉이 시작되어야 마감되므로, 값은 매시간 마지막 5분 봉에서 바뀌고 계단 모양으로 그려집니다. 그래서 과거의 어느 봉도 그때 아직 없던 데이터를 쓰지 않습니다. 최신 봉만 예외로, 아직 마감되지 않은 1시간 봉의 값을 실시간으로 표시합니다. 봉은 다음 봉이 시작될 때 끝나는 것으로 보므로, 주기가 나누어떨어지지 않을 때(3분 차트의 5분 지표)나 주말과 휴장을 사이에 둘 때도 같은 규칙입니다.

**계산할 수 없으면 차트의 봉으로 계산**: 차트의 주기가 지표의 주기보다 짧지 않을 때(일봉 차트의 1시간 지표 등), 원본 봉으로 그 주기를 만들 수 없을 때([만들 수 있는 주기](timeframes.md#만들-수-있는-주기) 참고), 또는 시간에 따르지 않는 봉을 표시할 때(렌코 등, [차트 유형](chart-types.md) 참고)는 `timeframe`을 지정하지 않은 것처럼 차트의 봉으로 계산합니다. 오류가 나지도, 사라지지도 않으며, 계산할 수 있게 되면 자기 주기로 돌아갑니다. 하이킨아시처럼 봉 하나씩 바꾸는 변환은 영향이 없습니다. 길이를 비교할 때 초, 분, 시간은 실제 길이로, 하루는 24시간, 한 주는 7일, 한 달은 30일로 셉니다.

`offset`은 지표 자신의 주기의 봉 수만큼 옮깁니다. 예를 들어 1시간 일목균형표의 선행스팬은 1시간 봉 26개만큼 오른쪽에 그려집니다. 같은 큰 주기 봉의 마커는 한 번만 그립니다. 범례에는 매개변수 뒤에 주기를 씁니다(`MA 20 1h`). [저장한 상태](state.md)에도 들어갑니다.

```ts
chart.indicators.get(id)?.timeframe; // '1h'. 지정하지 않았으면 null
chart.indicators.update(id, { timeframe: '4h' }); // 4시간으로 바꾸기
chart.indicators.update(id, { timeframe: null }); // 차트의 봉으로 되돌리기
```

다른 지표로 계산하는 지표는 그 지표의 주기로, 그 값으로 계산하며 표시 규칙도 같습니다.

```ts
const hourlyRsi = chart.indicators.add({ type: 'RSI', timeframe: '1h' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: hourlyRsi }, // 이것도 1시간으로 계산
  pane: hourlyRsi
});
```

여기에 다른 `timeframe`을 주면 오류가 납니다. [차트 없이 계산하기](#차트-없이-계산하기)의 `computeIndicator()`는 그대로입니다. 받은 봉의 주기로 계산합니다.

## 설정 패널 만들기

지표에 어떤 매개변수가 있고 각 매개변수의 범위가 어떤지는 정의에서 읽습니다.

```ts
const definition = chart.indicators.definition('RSI');
definition?.params; // { period: { default: 14, min: 1, max: 2000, integer: true, label: 'RSI Length' }, … }
```

`options`가 있는 매개변수는 그 값들 중 하나만 가질 수 있으므로(예: 이동평균 유형) 화면에서는 드롭다운으로 만듭니다. 사용자가 입력한 설정은 먼저 `checkIndicatorInput()`으로 검사하세요. 잘못된 값이 있으면 `add()`와 같은 오류를 던집니다.

```ts
import { checkIndicatorInput } from '@kumochart-sdk/core/indicators';

checkIndicatorInput(chart.indicators.definition('RSI')!, userInput);
```

## 다국어

지표의 정의는 이름과 라벨을 영어로 씁니다. 범례와 `valuesAt()`가 차트의 `locale`에 따라 중국어, 일본어, 한국어로 표시되게 하려면 SDK에 들어 있는 번역 `indicatorTexts`를 모듈에 넘기세요.

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

createChart(container, {
  modules: [indicators(allIndicators, { texts: [indicatorTexts] })],
  locale: 'zh-CN'
});
```

넘기지 않으면 영어로만 표시되며, `indicatorTexts`도 번들에 들어가지 않습니다. `MA`, `RSI` 같은 약어는 어느 언어에서나 같으므로 번역하지 않습니다.

설정 패널을 만들 때는 `chart.indicators.title(type)`이 지표의 전체 이름을, `chart.indicators.label(text)`가 정의의 라벨(선, 매개변수, 선택지의 이름)을 차트의 언어로 돌려줍니다.

```ts
chart.indicators.title('BOLL'); // '布林带'
chart.indicators.label('Period'); // '周期'
```

번역은 언어별로, 다시 영어 원문별로 쓰며, 나중에 넘긴 것이 앞의 것을 덮어씁니다. 직접 만든 지표를 다국어로 하거나 몇몇 단어를 바꾸고 싶다면 하나를 더 넘기세요. 숫자로 끝나는 라벨(예: `Upper Band #2`)에 자체 번역이 없으면 `Upper Band #{n}`의 번역에서 `{n}`을 그 숫자로 바꿔 씁니다.

```ts
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

indicators(allIndicators, {
  texts: [indicatorTexts, { zh: { labels: { Upper: '上沿' } } }]
});
```

차트가 없을 때(차트보다 먼저 설정 패널을 여는 경우 등)는 `indicatorLanguage(texts, locale)`가 같은 규칙으로 `title()`과 `label()`을 돌려줍니다.

## 내장 지표

아래 표의 '출력'은 각 선의 key로, 값을 읽거나 색상을 지정하거나 [알림](alerts.md)을 설정할 때 씁니다. 이동평균선처럼 기간을 한 번에 여러 개 줄 수 있는 지표는 출력 key에 기간이 붙습니다(예: `ma20`).

### 이동평균선

| 유형        | 이름                       | 기본 매개변수                     | 출력                   |
| ----------- | -------------------------- | --------------------------------- | ---------------------- |
| `MA`        | 단순 이동평균선            | 기간 9                            | `ma9`                  |
| `EMA`       | 지수 이동평균선            | 기간 9                            | `ema9`                 |
| `SMMA`      | 평활 이동평균선            | 기간 7                            | `smma7`                |
| `WMA`       | 가중 이동평균선            | 기간 9                            | `wma9`                 |
| `HMA`       | 헐 이동평균선              | 기간 9                            | `hma9`                 |
| `VWMA`      | 거래량 가중 이동평균선     | 기간 20                           | `vwma20`               |
| `ALMA`      | 아르노 르구 이동평균선     | 9, 오프셋 0.85, σ 6               | `alma`                 |
| `KAMA`      | 카우프만 적응형 이동평균선 | 10, 단기 2, 장기 30               | `kama`                 |
| `ALLIGATOR` | 앨리게이터                 | 13, 8, 5, 오른쪽으로 8, 5, 3 이동 | `jaw`, `teeth`, `lips` |
| `BBI`       | 불 앤 베어 지수(중국식)    | 3, 6, 12, 24                      | `bbi`                  |

### 채널

| 유형       | 이름               | 기본 매개변수                           | 출력                                                                        |
| ---------- | ------------------ | --------------------------------------- | --------------------------------------------------------------------------- |
| `BOLL`     | 볼린저 밴드        | 20, SMA, 표준편차 2배                   | `basis`, `upper`, `lower`                                                   |
| `KC`       | 켈트너 채널        | 20, EMA, ATR(10) 2배                    | `upper`, `basis`, `lower`                                                   |
| `DC`       | 돈치안 채널        | 20                                      | `basis`, `upper`, `lower`                                                   |
| `ICHIMOKU` | 일목균형표         | 9, 26, 52, 이동 26                      | `conversionLine`, `baseLine`, `laggingSpan`, `leadingSpanA`, `leadingSpanB` |
| `VWAP`     | 거래량 가중 평균가 | 거래일마다 새로 계산, 표준편차 1배 밴드 | `vwap`, `upperBand1`, `lowerBand1`                                          |

### 추세와 손절

| 유형         | 이름            | 기본 매개변수      | 출력                       |
| ------------ | --------------- | ------------------ | -------------------------- |
| `SAR`        | 파라볼릭 SAR    | 0.02, 0.02, 0.2    | `parabolicSar`             |
| `SUPERTREND` | 슈퍼트렌드      | 10, ATR 3배        | `upTrend`, `downTrend`     |
| `CHANDELIER` | 샹들리에 엑시트 | 22, ATR 22, 3배    | `longExit`, `shortExit`    |
| `DMI`        | 방향성 지수     | ADX 평활 14, DI 14 | `adx`, `plus`, `minus`     |
| `AROON`      | 아룬            | 14                 | `aroonUp`, `aroonDown`     |
| `FRACTALS`   | 윌리엄스 프랙탈 | 2                  | `downFractal`, `upFractal` |

### 오실레이터

| 유형       | 이름                      | 기본 매개변수                     | 출력                              |
| ---------- | ------------------------- | --------------------------------- | --------------------------------- |
| `MACD`     | 이동평균 수렴·확산        | 12, 26, 9                         | `macd`, `signalLine`, `histogram` |
| `RSI`      | 상대강도지수              | 14, 14 SMA 이동평균 포함          | `rsi`, `rsiBasedMa`               |
| `STOCH`    | 스토캐스틱                | 14, %K 평활 1, %D 평활 3          | `k`, `d`                          |
| `STOCHRSI` | 스토캐스틱 RSI            | %K 3, %D 3, RSI 14, 스토캐스틱 14 | `k`, `d`                          |
| `CCI`      | 상품 채널 지수            | 20(hlc3), 14 SMA 이동평균 포함    | `cci`, `cciBasedMa`               |
| `WR`       | 윌리엄스 %R               | 14                                | `wr14`                            |
| `ROC`      | 변화율                    | 9                                 | `roc`                             |
| `MTM`      | 모멘텀                    | 10                                | `mom`                             |
| `TRIX`     | 삼중 지수 평활            | 18                                | `trix`                            |
| `DPO`      | 추세 제거 가격 오실레이터 | 21                                | `dpo`                             |
| `FISHER`   | 피셔 변환                 | 9(hl2)                            | `fisher`, `trigger`               |
| `KDJ`      | 스토캐스틱 KDJ(중국식)    | 9, 3, 3                           | `k`, `d`, `j`                     |
| `BIAS`     | 이격도(중국식)            | 6, 12, 24                         | `bias6`, `bias12`, `bias24`       |
| `PSY`      | 심리도(중국식)            | 12, 6                             | `psy`, `psyma`                    |
| `BRAR`     | 인기·의지 지표(중국식)    | 26                                | `br`, `ar`                        |
| `DMA`      | 이동평균 차이(중국식)     | 10, 50, 10                        | `dif`, `difma`                    |

### 거래량

| 유형  | 이름                | 기본 매개변수  | 출력              |
| ----- | ------------------- | -------------- | ----------------- |
| `VOL` | 거래량              | 이동평균 없음  | `volume`          |
| `OBV` | 온밸런스 볼륨       | 이동평균 없음  | `onBalanceVolume` |
| `MFI` | 자금흐름지수        | 14             | `mf`              |
| `CMF` | 차이킨 자금흐름     | 20             | `cmf`             |
| `EMV` | 이즈 오브 무브먼트  | 14, 제수 10000 | `eom`             |
| `VR`  | 거래량 비율(중국식) | 26, 6          | `vr`, `mavr`      |

### 변동성

| 유형   | 이름             | 기본 매개변수 | 출력   |
| ------ | ---------------- | ------------- | ------ |
| `ATR`  | 평균 실제 범위   | 14, RMA       | `atr`  |
| `STD`  | 표준편차         | 20            | `std`  |
| `CHOP` | 초피니스 지수    | 14            | `chop` |
| `ADR`  | 평균 일일 변동폭 | 14            | `adr`  |

### 기간과 거래 세션

| 유형       | 이름                     | 기본 매개변수                           | 출력                                        |
| ---------- | ------------------------ | --------------------------------------- | ------------------------------------------- |
| `PIVOTS`   | 피벗 포인트              | 전통 방식, 기간은 차트에 맞춰 자동 선택 | `p`, `r1`, `s1` … `r5`, `s5`                |
| `PREVHLC`  | 이전 기간 고가·저가·종가 | 일                                      | `high`, `low`, `close`                      |
| `SESSIONS` | 거래 세션                | 도쿄, 런던, 뉴욕                        | `tokyoHigh`, `londonHigh`, `newYorkHigh` 등 |

피벗 포인트의 기간은 기본으로 차트의 주기를 따라 고릅니다. 15분봉 이하는 일, 그 밖의 분·시간봉은 주, 일봉은 월, 주봉·월봉은 연입니다. `data.set()`에 `interval`을 주지 않았으면 일입니다.

각 지표의 전체 매개변수와 출력은 `chart.indicators.definition(type)`으로 조회하거나 [API 레퍼런스](../api.md#indicators)에서 확인하세요.

## 중국에서 널리 쓰는 소프트웨어와 다른 점

중국에서 널리 쓰는 소프트웨어에 익숙하다면 다음 몇 가지에 주의하세요.

- **MACD**: 히스토그램은 MACD 선에서 시그널선을 뺀 값이며, 2를 곱하지 않습니다. 세 선의 이름은 `macd`, `signalLine`, `histogram`입니다.
- **RSI**: 기본은 14 한 줄이고 기준선은 70과 30이며, 14 이동평균선이 함께 붙습니다. 평활은 Wilder 방식이고, 처음 14개는 단순 평균으로 시작합니다.
- **WR**: -100에서 0 사이의 값이며, 0이 가장 높은 쪽입니다.
- **이동평균선**: MA와 EMA는 기본이 9 한 줄입니다. 여러 줄이 필요하면 `periods: [5, 10, 20, 30]`처럼 줍니다. EMA의 첫 값은 처음 몇 봉의 단순 평균입니다.
- **거래량**: 기본적으로 이동평균선이 없습니다. 필요하면 `periods: [5, 10]`을 줍니다.

KDJ, BIAS, BRAR, PSY, DMA, VR, BBI는 중국 시장에서 흔히 쓰는 지표로, 계산 방법이 중국에서 널리 쓰는 소프트웨어와 같습니다.

## 차트 없이 계산하기

```ts
import { computeIndicator, RSI } from '@kumochart-sdk/core/indicators';

const { rsi } = computeIndicator(RSI, bars);
// rsi[i]는 i번째 봉의 값으로, 차트에서 계산한 값과 같음
```

실시간 데이터를 따라 봉 하나씩 계산하려면 `createIndicatorCalculator()`를 씁니다. 둘 다 넘겨준 데이터에만 의존하므로 Node.js에서도 쓸 수 있습니다. 예를 들어 서버에서 알림 조건을 판단할 수 있습니다. VWAP나 피벗 포인트처럼 거래일이나 주기를 따라 계산하는 지표는 차트의 거래 캘린더와 주기도 넘겨야 차트와 같은 값이 나옵니다: `{ calendar, interval: '15m' }`.

한 지표를 다른 지표로 계산할 때(예: RSI의 EMA)는 `nextOf(bar, value)`로 그 봉에서의 다른 지표 값을 넘깁니다. 차트에서 `source`에 다른 지표를 지정했을 때와 같은 값이 나옵니다.

```ts
import { createIndicatorCalculator, EMA, RSI } from '@kumochart-sdk/core/indicators';

const rsi = createIndicatorCalculator(RSI);
const ema = createIndicatorCalculator(EMA, { params: { periods: [5] } });

for (const bar of bars) {
  const [value] = rsi.next(bar);
  const [smoothed] = ema.nextOf(bar, value); // RSI에 아직 값이 없는 봉(NaN)은 차트와 마찬가지로 건너뜁니다
}
```

지표를 직접 만들려면 [사용자 정의 지표](custom-indicators.md)를 참고하세요.

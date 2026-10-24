# 외관

<!-- code-prelude
import { darkTheme } from '@kumochart-sdk/core';
declare const EYE_ICON: string, CLOSE_ICON: string;
-->

차트의 모양은 모두 옵션으로 정합니다. 차트를 만들 때 넘기고, 이후에는 언제든 `applyOptions()`로 바꿀 수 있습니다.

```ts
const chart = createChart(container, {
  theme: darkTheme,
  grid: { vertical: false },
  latestPrice: { countdown: true }
});

chart.applyOptions({ crosshair: { mode: 'magnet' } });
chart.options(); // 현재의 전체 옵션
```

`applyOptions()`는 넘긴 항목만 바꾸고 나머지는 그대로 둡니다. 배열과 함수는 통째로 교체됩니다. 옵션 이름을 잘못 쓰거나 값이 맞지 않으면 오류가 나고, 차트는 그대로 유지됩니다.

설정하지 않은 옵션은 `null`입니다(`locale`, `timeZone`, `legend.rows`, `panes.separatorColor` 등). 한 번 설정한 것을 기본값으로 되돌리려면 `chart.applyOptions({ locale: null })`처럼 다시 `null`로 설정하면 됩니다. `texts`의 각 단어와 `mainSeries.styles`의 차트 유형별 스타일도 마찬가지입니다.

## 테마

밝은 테마 `lightTheme`(기본값)와 어두운 테마 `darkTheme`가 내장되어 있습니다. 어두운 테마를 쓰려면 `theme: darkTheme`을 넘깁니다:

```ts live height=320
import { createChart, darkTheme } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { theme: darkTheme });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
```

테마는 색상의 묶음이며, 봉, 지표, 그리기에서 색을 따로 정하지 않은 부분은 모두 테마에서 가져옵니다. 내장 테마에서 몇 가지만 바꿔 쓰면 됩니다:

```ts
import { lightTheme } from '@kumochart-sdk/core';

// 상승은 빨간색, 하락은 초록색
const theme = {
  ...lightTheme,
  up: '#ef5d5d',
  down: '#2fb57e',
  volumeUp: 'rgba(239, 93, 93, 0.4)',
  volumeDown: 'rgba(47, 181, 126, 0.4)'
};

createChart(container, { theme });
```

| 색상                       | 쓰이는 곳                                  |
| -------------------------- | ------------------------------------------ |
| `background`               | 배경                                       |
| `text`, `textMuted`        | 축과 범례의 글자, 보조 글자                |
| `grid`, `border`           | 격자선, 창 사이의 구분선                   |
| `crosshair`                | 십자선                                     |
| `crosshairLabelBackground` | 축에 표시되는 십자선 라벨의 배경색         |
| `crosshairLabelText`       | 라벨의 글자                                |
| `up`, `down`               | 상승·하락 봉과 수치                        |
| `volumeUp`, `volumeDown`   | 상승·하락 거래량 막대                      |
| `accent`                   | 선택된 객체, 드래그 중인 조절점            |
| `palette`                  | 지표, 그리기, 겹친 시리즈가 차례로 쓰는 색 |
| `buy`, `sell`              | 매수·매도 주문과 체결 표시                 |
| `alert`                    | 알림선                                     |

`withAlpha(color, 0.3)`으로 색에 투명도를 줄 수 있어 배색할 때 유용합니다.

색은 `#26a69a`, `rgb(38 166 154)`, `rgba(38, 166, 154, 0.5)`, `teal`처럼 CSS의 어떤 표기로도 쓸 수 있습니다. 넘기는 순간 검사하므로 테마, 스타일, 지표, 그리기, 알림 등의 색을 잘못 쓰면 그릴 때가 아니라 그 자리에서 필드 이름과 함께 오류가 납니다. 차트 없이 계산할 때(Node.js 등)는 색을 그리지 않으므로 문자열인지만 검사합니다. 애플리케이션 자체 설정의 색을 차트와 같은 방식으로 검사하려면 `checkColor(필드 이름, 값)`을 쓰세요.

## 메인 시리즈

메인 시리즈는 기본적으로 캔들로 그립니다. 코어에는 시리즈 유형이 11가지 있으며, 유형은 이렇게 바꿉니다:

```ts
chart.applyOptions({ mainSeries: { type: 'line' } });
```

| 유형             | 모양             |
| ---------------- | ---------------- |
| `candles`        | 캔들             |
| `hollow-candles` | 할로우캔들       |
| `ohlc`           | OHLC 바          |
| `high-low`       | 하이-로우        |
| `line`           | 라인             |
| `step-line`      | 스텝 라인        |
| `line-markers`   | 마커가 있는 라인 |
| `area`           | 영역             |
| `baseline`       | 베이스라인       |
| `hlc-area`       | HLC 영역         |
| `columns`        | 컬럼             |

라인처럼 가격 하나만 그리는 시리즈는 어떤 가격을 그릴지 `mainSeries.source`로 정합니다: `open`, `high`, `low`, `close`(기본값), `hl2`, `hlc3`, `ohlc4`.

시리즈 유형마다 스타일을 따로 저장하므로, 유형을 바꿔도 각자의 스타일이 유지됩니다:

```ts
chart.applyOptions({
  mainSeries: {
    styles: {
      candles: { upColor: '#ffffff', border: true, bodyRatio: 0.7 },
      line: { color: '#5aa9fa', lineWidth: 2 }
    }
  }
});
```

설정하지 않은 스타일은 테마에서 가져오며, 테마를 바꾸면 함께 바뀝니다. 유형별 스타일 항목은 [API 레퍼런스](../api.md#SeriesStyleMap)를 참고하세요.

특정 봉에만 색을 따로 입히려면, 예를 들어 거래량이 급증한 봉을 표시하려면 `mainSeries.barColor`를 씁니다:

```ts
chart.applyOptions({
  mainSeries: {
    barColor: ({ bar }) => (bar.volume > 500 ? '#e8b04a' : null) // null이면 원래 색
  }
});
```

## 격자와 십자선

```ts
chart.applyOptions({
  grid: { vertical: false, horizontal: true, style: 'dashed' },
  crosshair: {
    mode: 'magnet', // 가로선이 종가에 붙습니다. 'free'는 마우스를 따라갑니다
    labels: true, // 축에 시간과 가격을 표시
    style: 'dashed'
  }
});
```

선 스타일은 `'solid'`, `'dashed'`, `'dotted'` 세 가지입니다.

## 축

```ts
chart.applyOptions({
  priceScale: {
    margins: { top: 0.1, bottom: 0.08 }, // 자동 스케일 때 위아래에 남기는 여백. 창 높이에 대한 비율
    precision: 2, // 가격의 소수 자릿수. 기본값 'auto'는 데이터에서 추론
    minWidth: 48 // 축의 최소 너비. 라벨이 길면 알아서 넓어집니다
  },
  timeScale: {
    barSpacing: 8, // 처음에 봉 하나가 차지하는 너비
    minBarSpacing: 0.5,
    maxBarSpacing: 60,
    rightOffset: 60 // 최신 봉 오른쪽에 남기는 너비
  }
});
```

`margins`와 각 스케일의 `setMargins()`는 같은 규칙을 따릅니다. 위아래 각각 0 이상, 합쳐서 0.9 이하로, 데이터를 위해 창 높이의 최소 10분의 1을 남깁니다.

너비와 높이는 모두 CSS 픽셀 단위입니다.

### 직접 포맷하기

가격과 시간의 글자는 직접 정할 수 있습니다:

```ts
chart.applyOptions({
  priceScale: {
    formatter: (value, { precision }) => `$${value.toFixed(precision)}`
  },
  timeScale: {
    formatter: (time, { kind, unit }) => {
      const date = new Date(time);
      if (kind === 'crosshair') return date.toLocaleString('ko-KR');
      return unit === 'day'
        ? `${date.getMonth() + 1}월 ${date.getDate()}일`
        : date.toTimeString().slice(0, 5);
    }
  }
});
```

시간의 `kind`는 `axis`(축의 눈금) 또는 `crosshair`(십자선 라벨)이고, `unit`은 눈금이 년, 월, 일, 시, 분, 초 중 어느 단위에 걸리는지를 나타냅니다. 직접 정하지 않으면 `locale`과 `timeZone`에 따라 자동으로 포맷합니다. 포맷 함수가 받는 `locale`과 `timeZone`은 실제로 쓰이는 값입니다. 설정하지 않았다면 브라우저의 언어와 로컬 시간대입니다.

## 현재가

오른쪽 축에 표시되는 현재가 라벨과 그 가로선:

```ts
chart.applyOptions({
  latestPrice: {
    line: true,
    label: true,
    countdown: true, // 라벨 아래에 이 봉이 마감까지 남은 시간을 표시
    style: 'dotted',
    color: null // null이면 최신 봉의 상승·하락에 따라 색이 바뀝니다
  }
});
```

카운트다운은 봉이 일정한 기간을 나타낼 때만 표시됩니다. 리플레이 중이거나 렌코 같은 차트에서는 표시되지 않습니다. 최신 봉이 이미 마감됐을 때(데이터가 멈췄거나 장이 닫혔을 때)도 표시되지 않고, 새 봉이 오면 다시 셉니다.

## 범례

범례는 각 창의 왼쪽 위에 있으며, 마우스가 가리키는 봉(또는 최신 봉)의 시가·고가·저가·종가와 지표 값을 보여 줍니다. 지표 줄은 이름과 매개변수, 이어서 각 선의 값을 보여 줍니다. 선이 하나뿐인 지표(RSI, 기간이 하나인 MA 등)는 이름으로 어느 선인지 알 수 있으므로 값 앞에 선 이름을 붙이지 않습니다.

```ts
chart.applyOptions({
  legend: {
    visible: true,
    // 마우스를 올린 행에 표시할 버튼
    buttons: (item) =>
      item.kind === 'indicator'
        ? [
            { id: 'hide', icon: EYE_ICON },
            { id: 'remove', icon: CLOSE_ICON }
          ]
        : []
  }
});

chart.on('legendButtonClick', ({ item, buttonId }) => {
  if (buttonId === 'remove') chart.indicators.remove(item.id);
  if (buttonId === 'hide') chart.indicators.update(item.id, { visible: false });
});
```

버튼의 `icon`은 24 × 24 SVG 경로(`<path d="...">` 안의 문자열)이며, 아이콘 라이브러리라면 어디서든 구할 수 있습니다.

기본적으로 보이는 지표와 겹친 시리즈만 나열합니다. 숨긴 것도 나열하려면(흐리게 표시되어 다시 켜기 편합니다) `rows`를 씁니다:

```ts
chart.applyOptions({ legend: { rows: () => true } });
```

## 워터마크

메인 창 한가운데에 종목과 주기처럼 큰 글자를 한두 줄 표시할 수 있습니다. 봉 아래에 옅게 그리므로 보는 데 방해가 되지 않습니다. 워터마크 모듈을 쓰고, 글자는 옵션으로 설정합니다.

```ts
import { createChart } from '@kumochart-sdk/core';
import { watermark } from '@kumochart-sdk/core/watermark';

const chart = createChart(container, {
  modules: [watermark()],
  watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
});

chart.applyOptions({ watermark: { lines: [{ text: 'ETHUSDT' }, { text: '4h', size: 20 }] } });
```

`lines`는 위에서부터 차례로 놓이며, `size`는 글자 크기(기본값 40)입니다. `color`를 지정하지 않으면 테마의 글자색을 옅게 해서 씁니다. 종목이나 주기를 바꿀 때는 `applyOptions()`로 `lines`를 통째로 바꿉니다.

## 언어와 글자

```ts
createChart(container, {
  locale: 'ko-KR', // 숫자와 날짜의 형식. 기본값은 브라우저를 따릅니다
  texts: {
    legendOpen: '시',
    legendHigh: '고',
    legendLow: '저',
    legendClose: '종',
    legendVolume: '거래량',
    days: (count) => `${count}일` // 카운트다운에 표시되는 일수
  }
});
```

차트가 캔버스에 그리는 글자는 기본적으로 `O H L C V`처럼 어느 언어에서나 통하는 표기이며, 필요하면 `texts`로 바꿉니다.

## 글꼴

```ts
chart.applyOptions({ font: { family: 'Inter, sans-serif', size: 12 } });
```

## 스크린샷

```ts
const canvas = chart.screenshot();
canvas.toBlob((blob) => {
  /* 다운로드하거나 업로드 */
});
```

`screenshot()`은 모든 창과 축을 포함해 차트 전체를 그린 canvas를 반환합니다.

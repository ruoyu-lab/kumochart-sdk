# 주기와 거래 캘린더

차트에 1분봉을 주면 브라우저에서 5분봉, 4시간봉, 일봉, 주봉 같은 주기를 만들 수 있어서, 주기를 바꿀 때 서버에 데이터를 다시 요청하지 않아도 됩니다. 어떻게 만들지는 거래 캘린더를 따릅니다. 하루가 몇 시에 시작하는지, 거래 세션이 어떻게 되는지, 어느 요일에 거래하는지 같은 것입니다.

## 주기 표기법

숫자 뒤에 단위를 붙입니다:

| 단위 | 의미 | 예             |
| ---- | ---- | -------------- |
| `s`  | 초   | `'15s'`        |
| `m`  | 분   | `'1m'`, `'5m'` |
| `h`  | 시간 | `'1h'`, `'4h'` |
| `D`  | 일   | `'1D'`         |
| `W`  | 주   | `'1W'`         |
| `M`  | 월   | `'1M'`, `'3M'` |

분 `m`과 월 `M`만 대소문자로 구분하고, 나머지는 대소문자를 가리지 않습니다(`'4H'`, `'1d'`). 숫자가 1이면 생략할 수 있어서 `'D'`는 `'1D'`와 같습니다. 객체로도 쓸 수 있습니다: `{ unit: 'hour', count: 4 }`.

## 주기 바꾸기

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('4h');
```

`set()`할 때 준 `interval`이 원본 주기이고, `setTimeframe()`으로 정하는 것이 표시 주기입니다. `setTimeframe(null)`은 원본 주기로 돌아갑니다:

```ts
chart.data.sourceInterval(); // { unit: 'minute', count: 1 }
chart.data.timeframe(); // { unit: 'hour', count: 4 }. 원본 주기일 때는 null
```

만들어진 봉의 시간은 그 주기의 시작이고, 시가는 첫 봉의 시가, 고가와 저가는 모든 봉 중 가장 높은 값과 가장 낮은 값, 종가는 마지막 봉의 종가, 거래량은 모두 더한 값입니다. 최신 봉은 실시간 데이터와 함께 업데이트됩니다.

며칠에 한 봉인 주기(`'2D'` 등)는 거래일로 셉니다. 한 봉은 정확히 그만큼의 연속된 거래일(캘린더의 `weekdays`)이고, 거래가 없는 날은 세지 않으며, 시간은 그중 첫 거래일입니다. 1970년 1월 1일부터 차례로 나누므로 같은 캘린더면 언제나 같은 묶음이 됩니다.

지표도 차트보다 긴 주기로 계산할 수 있습니다. 예를 들어 5분 차트에 1시간 이동평균선을 표시할 수 있습니다. [지표](indicators.md#다른-주기로-계산하기)를 참고하세요.

## 만들 수 있는 주기

- 초, 분, 시간: 원본 주기의 정수배여야 합니다. 예를 들어 1분으로 3분이나 1시간은 만들 수 있지만 90초는 만들 수 없습니다.
- 일: 원본 주기가 하루를 나누어떨어지게 해야 합니다. 1분, 15분, 4시간은 되지만 7분은 안 됩니다.
- 주, 월: 하루를 나누어떨어지게 하는 주기나 1일로 만듭니다. 2일로는 만들 수 없습니다.
- 원본 주기보다 짧은 주기는 만들 수 없습니다.

만들 수 없는 주기라면 `setTimeframe()`이 오류를 내고 이유를 알려 줍니다. 주기 메뉴를 만들 때는 `canBuildTimeframe()`으로 어떤 주기를 고를 수 있는지 먼저 확인할 수 있습니다:

```ts
import { canBuildTimeframe } from '@kumochart-sdk/core';

canBuildTimeframe('4h', '1h'); // true
canBuildTimeframe('1W', '2D'); // false
```

초, 분, 시간 주기는 길이가 정해져 있어 `intervalDuration()`이 그 밀리초를 돌려줍니다. 일, 주, 월의 길이는 거래 달력이 정하므로 `null`을 돌려줍니다.

```ts
import { intervalDuration } from '@kumochart-sdk/core';

intervalDuration('15m'); // 900000
intervalDuration('1D'); // null
```

## 시간대

시간대 설정은 두 가지입니다:

- `timeZone`: 축과 십자선의 시간을 어느 시간대로 표시할지. 설정하지 않으면 사용자 컴퓨터의 로컬 시간대입니다.
- `calendar.timeZone`: 봉의 일봉과 주봉을 어느 시간대 기준으로 나눌지, 그리고 시간봉이 몇 시부터 시작할지. 기본값은 `UTC`입니다.

암호화폐 거래소의 봉은 UTC 기준으로 나뉘고 일봉은 UTC 0시에 시작하므로 기본값 그대로 맞습니다. 표시되는 시간은 그대로 사용자의 로컬 시간입니다. 주식이나 선물처럼 거래소 시간으로 봉을 주는 경우에는 거래소의 시간대를 설정하세요.

```ts
createChart(container, {
  timeZone: 'Asia/Shanghai', // 시간을 베이징 시간으로 표시
  calendar: { timeZone: 'America/New_York' } // 미국 주식: 일봉은 뉴욕 0시에 시작
});
```

캘린더는 데이터와 맞아야 합니다. 분봉과 시간봉은 캘린더 봉의 시작에 시간이 있어야 합니다. 예를 들어 UTC 정시에 시작하는 시간봉을 30분 차이 나는 인도 시간 캘린더에 주면, `set()`이 오류를 내며 무엇을 설정해야 하는지 알려 줍니다. 봉을 몰래 다른 시간으로 옮기지 않습니다. 일봉, 주봉, 월봉은 거래일로 정해지므로 시간이 그날 0시든 시가나 종가 시각이든 상관없습니다.

시간대는 IANA 이름으로 씁니다. 예: `Asia/Shanghai`, `America/New_York`, `UTC`.

## 거래 세션

24시간 거래하는 시장이라면 설정하지 않아도 됩니다. 거래 시간이 정해진 시장은 `calendar`에 적어 줍니다:

| 옵션        | 의미                                                                                                                  | 기본값          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------- |
| `sessions`  | 하루 중 거래 세션. `'HH:MM-HH:MM'` 형식이며, 끝이 시작보다 이르면 자정을 넘기는 세션입니다. 세션 밖의 시간은 버립니다 | `[]`(하루 종일) |
| `dayStart`  | 거래일이 시작하는 시각. 이 시각 이후는 다음 거래일로 칩니다                                                           | `'00:00'`       |
| `weekdays`  | 거래일인 요일. 0은 일요일                                                                                             | 매일            |
| `weekStart` | 주봉이 시작하는 요일. 0은 일요일                                                                                      | `1`(월요일)     |

몇 가지 예:

```ts
// 중국 A주: 오전, 오후 두 세션, 월요일부터 금요일까지
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    weekdays: [1, 2, 3, 4, 5]
  }
});

// 야간 거래가 있는 중국 선물: 밤 9시에 시작하는 야간 세션은 다음 거래일로 치고, 금요일 야간 세션은 월요일로 칩니다
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['21:00-02:30', '09:00-10:15', '10:30-11:30', '13:30-15:00'],
    dayStart: '21:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});

// 외환: 뉴욕 시간 오후 5시에 날짜가 바뀝니다
createChart(container, {
  calendar: {
    timeZone: 'America/New_York',
    dayStart: '17:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});
```

거래 세션이 있으면 시간봉은 각 세션의 시작부터 셉니다. 예를 들어 A주의 1시간봉은 9:30, 10:30, 13:00, 14:00에 시작합니다.

## 공휴일과 특수 규칙

공휴일 휴장이나 특정일의 조기 마감처럼 고정된 규칙으로 표현할 수 없는 경우에는 `calendar.bucket`으로 각 시간이 어느 봉에 속할지 직접 정합니다:

```ts
const holidays = new Set(['2026-10-01', '2026-10-02']);

createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    bucket: (time, interval, fallback) => {
      const date = new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
      return holidays.has(date) ? null : fallback(time);
    }
  }
});
```

봉의 시작 시간을 반환하고, `null`을 반환하면 그 시간을 버립니다. `fallback`은 다른 캘린더 설정으로 계산한 결과입니다. 반환하는 시간은 입력 시간이 흐르는 동안 거꾸로 가면 안 됩니다.

## 이 캘린더를 직접 쓰기

직접 작성한 코드에서 차트와 같은 규칙으로 시간을 맞춰야 할 때, 예를 들어 서버에서 봉을 만들거나 어떤 시간이 어느 봉에 속하는지 판단할 때는 `createCalendar()`를 씁니다:

```ts
import { createCalendar } from '@kumochart-sdk/core';

const calendar = createCalendar({
  timeZone: 'Asia/Shanghai',
  sessions: ['09:30-11:30', '13:00-15:00']
});

calendar.bucket('2026-05-06T02:15:00Z', '1h'); // 베이징 시간 10:15는 9:30에 시작하는 봉에 속하므로 9:30의 타임스탬프를 반환합니다
```

차트 없이도 동작하며, Node.js에서도 쓸 수 있습니다.

차트가 있을 때는 `chart.data.calendar()`가 차트가 쓰는 캘린더(`calendar` 옵션에 차트의 시간대를 더한 것)입니다. 예를 들어 플러그인에서 봉을 거래일별로 묶을 때 씁니다. 옵션이 바뀌면 새것으로 바뀌므로, 쓸 때마다 가져오세요.

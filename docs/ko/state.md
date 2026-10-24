# 저장과 복원

사용자가 차트에 추가한 지표, 그린 선, 조정한 창을 한 번에 저장해 두었다가, 다음에 열 때 한 번에 복원할 수 있습니다.

```ts
// 저장
const state = chart.saveState();
localStorage.setItem('layout', JSON.stringify(state));

// 복원
const saved = localStorage.getItem('layout');
if (saved) chart.loadState(JSON.parse(saved));
```

<!-- code-prelude
declare const saved: import('@kumochart-sdk/core').ChartState;
declare const drawingsBySymbol: Record<string, import('@kumochart-sdk/core/drawings').Drawing[]>;
declare const symbol: string, next: string;
declare function barsOf(symbol: string): import('@kumochart-sdk/core').BarInput[];
-->

`saveState()`는 일반 객체를 반환하므로 그대로 JSON으로 바꿔 브라우저나 서버에 저장할 수 있습니다.

## 저장되는 것

- 메인 시리즈의 유형과 어떤 가격을 그리는지(`mainSeries.type`, `mainSeries.source`).
- 하이킨 아시, 렌코 같은 봉 변환과 그 파라미터(`transform`).
- 뷰: 봉의 너비와, 최신 봉에서 얼마나 떨어져 있는지.
- 창: 어떤 창이 있는지, 순서, 높이, 제목, 그리고 가격 스케일마다의 모드(로그, 퍼센트 등), 뒤집기 여부, 직접 설정한 범위와 위아래 여백.
- 각 모듈의 부분: 지표 모듈은 모든 지표와 그 파라미터, 스타일을 저장하고, 그리기 모듈은 모든 그리기를, 매물대 모듈은 모든 프로필을 저장합니다.

애플리케이션에 속하는 것은 저장하지 **않습니다**: 봉 데이터, 주기, 겹친 시리즈, 주문, 체결 표시, 알림. 이들은 애플리케이션이 직접 관리하며, 레이아웃을 복원한 뒤 다시 설정합니다.

## 복원

`loadState()`는 전부 복원하거나, 아무것도 바꾸지 않거나 둘 중 하나입니다. 상태 중 한 군데라도 잘못되면, 예를 들어 알 수 없는 버전이거나, 차트에 없는 지표 유형을 쓰거나, 존재하지 않는 창에 그리기가 있으면 오류를 내고 차트는 원래 모습을 유지합니다.

```ts
try {
  chart.loadState(saved);
} catch (error) {
  console.warn('레이아웃 복원에 실패해 기본 레이아웃을 사용합니다', error);
}
```

복원할 때는 차트에 같은 모듈이 있어야 합니다. 상태에 그리기가 있는데 차트에 그리기 모듈이 없어도 오류가 납니다.

데이터를 먼저 설정하든 레이아웃을 먼저 복원하든 상관없으며, 지표는 데이터에 맞춰 다시 계산됩니다. 보통은 차트를 만들고, 데이터를 설정한 뒤, 레이아웃을 복원합니다.

## 종목마다 다른 그리기

그리기는 시간과 가격으로 위치를 정하므로, 같은 종목에서 주기를 바꾸면 그대로 맞지만 종목을 바꾸면 맞지 않습니다. 종목마다 자기 그리기를 두면서 지표와 창은 한 벌로 함께 쓰려면 그리기를 따로 저장하세요:

```ts
// 종목을 바꾸기 전에 이 종목의 그리기를 저장
drawingsBySymbol[symbol] = chart.drawings.list();

// 새 종목으로 전환
chart.data.set(barsOf(next), { interval: '1m' });
chart.drawings.set(drawingsBySymbol[next] ?? []);
```

`drawings.set()`은 모든 그리기를 교체하고, 실행 취소 기록을 비웁니다.

## 버전

상태에는 `version`이 있으며 현재는 `1`입니다. 앞으로 상태의 형식이 바뀌면 버전 번호도 바뀌고, `loadState()`는 알 수 없는 버전을 만나면 오류를 냅니다.

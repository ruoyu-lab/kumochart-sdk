# 매물대

<!-- code-prelude
declare function showPointOfControl(price: number): void;
-->

매물대는 거래량을 가격별로 펼쳐 보여 줍니다. 한 행이 하나의 가격대이고, 막대가 길수록 그 가격대에서 많이 거래된 것입니다. 거래량이 가장 많은 행이 POC(Point of Control)이며 선으로 표시합니다. 그 주변에서 합쳐 거래량의 70%를 차지하는 행들이 가치 영역이며 더 진한 색으로 그립니다.

`@kumochart-sdk/core/volume-profile`에 있으며 세 가지가 있습니다. 화면에 보이는 봉의 프로필, 거래일마다 하나씩인 프로필, 그리고 사용자가 기간을 직접 지정해 그리는 고정 범위 매물대(그리기 도구의 하나)입니다.

```ts live height=400
import { createChart } from '@kumochart-sdk/core';
import { drawings } from '@kumochart-sdk/core/drawings';
import { volumeProfiles, fixedRangeVolumeProfile } from '@kumochart-sdk/core/volume-profile';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [volumeProfiles(), drawings([fixedRangeVolumeProfile()])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

// 화면에 보이는 봉의 프로필을 오른쪽 가장자리에. 스크롤하거나 확대/축소하면 따라 바뀝니다
chart.volumeProfiles.add({ mode: 'visible' });

// 그리고 사용자가 기간을 지정하게 합니다: 두 번 클릭
chart.drawings.startTool('fixed-range-volume-profile');
```

## 보이는 범위와 거래일

```ts
import { volumeProfiles } from '@kumochart-sdk/core/volume-profile';

createChart(container, { modules: [volumeProfiles()] });

const id = chart.volumeProfiles.add({ mode: 'visible' }); // id를 반환
chart.volumeProfiles.add({ mode: 'session' }); // 거래일마다 하나. 위의 것과 함께 표시할 수 있습니다

chart.volumeProfiles.update(id, { rows: 48, placement: 'left' });
chart.volumeProfiles.get(id); // { id, mode, rows, valueArea, width, placement, ... }
chart.volumeProfiles.list(); // 전부, 추가한 순서대로
chart.volumeProfiles.remove(id);
chart.volumeProfiles.set([{ mode: 'session' }]); // 한꺼번에 교체
chart.volumeProfiles.clear(); // 모두 제거
```

| 옵션        | 기본값                      | 설명                                                                                                                                  |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`      | 필수                        | `visible`: 화면에 보이는 봉의 프로필 하나를 플롯 영역의 한쪽 가장자리를 따라 그림. `session`: 거래일마다 하나씩, 그날의 시작부터 그림 |
| `rows`      | 24                          | 가격을 몇 행으로 나눌지. 1부터 1000까지                                                                                               |
| `valueArea` | 0.7                         | 가치 영역이 전체 거래량에서 차지하는 비율                                                                                             |
| `width`     | 0.25 / 0.7                  | 가장 긴 행의 길이. 플롯 영역 너비(`visible`) 또는 그날 너비(`session`)에 대한 비율                                                    |
| `placement` | `right`                     | `visible` 프로필이 어느 쪽 가장자리에서 자라는지. `left` 또는 `right`                                                                 |
| `upColor`   | 테마의 `up`                 | 종가가 시가 이상인 봉의 거래량                                                                                                        |
| `downColor` | 테마의 `down`               | 종가가 시가보다 낮은 봉의 거래량                                                                                                      |
| `pocColor`  | 테마 `palette`의 첫 번째 색 | POC 선                                                                                                                                |
| `visible`   | `true`                      | 표시 여부                                                                                                                             |
| `id`        | 자동 생성                   | `volume-profile-1` 같은 id. 삭제된 것과 겹치지 않습니다                                                                               |

`get()`과 `list()`가 반환하는 `width`와 세 가지 색은 지정하지 않았으면 `null`이며, 기본값을 쓴다는 뜻입니다. 그래서 `update()`로 `mode`를 바꾸면 지정하지 않은 `width`도 새 모드의 기본값으로 바뀝니다.

프로필은 메인 창의 봉 아래에 그려지며 가격 스케일의 범위에는 영향을 주지 않습니다. 거래일은 차트의 `calendar` 옵션을 따라 일봉과 똑같이 나뉩니다. 야간 세션은 다음 거래일로 치고, 거래 세션 밖의 봉은 바로 앞 거래일로 칩니다. [주기와 거래 캘린더](timeframes.md)를 참고하세요.

### 원본 데이터로 계산합니다

프로필은 표시되는 봉이 아니라 **원본 데이터**로 계산합니다. 1분봉 데이터로 일봉을 볼 때, 하루의 거래량이 일봉 전체에 고르게 펴지지 않고 실제로 거래된 가격에 놓입니다. 원본 데이터가 촘촘할수록 프로필이 정확해집니다.

리플레이 중에는 이미 보여 준 봉만 셉니다. 계산한 프로필은 캐시되어, 데이터나 화면에 보이는 봉이 바뀔 때만 다시 계산합니다. 거래일별 프로필을 좌우로 스크롤해도 화면에 남아 있는 날은 다시 계산하지 않습니다.

`chart.saveState()`는 모든 프로필을 저장하고 `loadState()`로 복원합니다. [저장과 복원](state.md)을 참고하세요.

## 고정 범위

고정 범위 매물대는 그리기 도구의 하나입니다. 사용자가 두 번 클릭해 시작과 끝 시간을 정하면, 그 사이 봉들의 프로필이 틀 안에 그려집니다. 틀의 높이는 그 봉들의 고가와 저가로 정해집니다. 다른 그리기처럼 드래그, 너비 변경, 복제, 되돌리기를 할 수 있고, 그리기와 함께 저장됩니다.

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { fixedRangeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

createChart(container, {
  modules: [drawings([...allDrawings, fixedRangeVolumeProfile({ rows: 32 })])]
});

chart.drawings.startTool('fixed-range-volume-profile');
```

`fixedRangeVolumeProfile()`의 옵션은 이 유형의 그리기 모두에 적용됩니다. `rows`, `valueArea`, `width`(가장 긴 행이 틀 너비에서 차지하는 비율, 기본값 0.6), `upColor`, `downColor`, `pocColor`입니다. 그리기마다의 스타일은 `color` 하나뿐이며 틀의 색입니다. `allModules()`에는 이 그리기 도구가 이미 들어 있습니다.

이것도 원본 데이터로 계산하고, 리플레이 중에는 이미 보여 준 봉만 셉니다. 리플레이가 아직 그 구간에 이르지 않았을 때처럼 틀 안에 거래량이 없으면, 틀은 두 앵커의 가격으로 그려져 그대로 선택하고 드래그할 수 있습니다.

## 차트 없이 계산하기

`computeVolumeProfile(bars, from, to, options)`는 이 모두의 바탕이 되는 계산이며 따로 쓸 수 있습니다. 예를 들어 직접 만든 패널에 POC 가격을 보여 주거나 Node.js에서 계산할 수 있습니다. `bars`에는 차트의 `chart.data.source`나 `chart.data.bars`도, 직접 가진 봉 배열도 넘길 수 있고, `from`과 `to`는 그 안의 인덱스입니다(`to`는 포함하지 않음).

```ts
import { computeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

const { source } = chart.data;
const from = source.lowerBound(Date.now() - 86_400_000); // 최근 하루
const profile = computeVolumeProfile(source, from, source.length, { rows: 50 });

if (profile) {
  const poc = profile.rows[profile.poc]!;
  showPointOfControl((poc.low + poc.high) / 2);
}
```

결과는 다음과 같습니다.

```ts
interface VolumeProfileData {
  rows: { low: number; high: number; up: number; down: number }[]; // 최저가부터 위로
  total: number; // 전체 거래량
  poc: number; // POC 행의 인덱스
  valueArea: { low: number; high: number }; // 가치 영역의 첫 행과 마지막 행의 인덱스
}
```

각 봉의 거래량은 저가부터 고가까지의 범위에 고르게 나뉩니다. 종가가 시가 이상인 봉은 `up`에, 아니면 `down`에 들어갑니다. 봉에 거래량이 없으면 `null`을 반환합니다.

### POC와 가치 영역

- POC: 거래량이 가장 많은 행입니다. 같은 행이 여럿이면 가운데에 가장 가까운 행을, 똑같이 가까우면 위쪽 행을 고릅니다.
- 가치 영역: POC에서 시작해 가치 영역 바로 위의 행과 바로 아래의 행을 비교하고, 거래량이 많은 쪽을 더합니다. 같으면 POC에 가까운 쪽을, 똑같이 가까우면 위쪽을 더합니다. 어떤 행을 더하면 `valueArea`를 넘게 될 때 멈추므로, 가치 영역의 거래량은 이 비율을 넘지 않습니다.

이 두 규칙도 따로 쓸 수 있습니다. 각 행의 거래량을 최저가부터 위로 순서대로 넘깁니다.

```ts
import { pointOfControl, valueAreaOf } from '@kumochart-sdk/core/volume-profile';

const volumes = [10, 25, 40, 25];
const poc = pointOfControl(volumes); // 2
valueAreaOf(volumes, poc, 0.7); // { low: 2, high: 3 }: 40 + 25 = 65, 한 행을 더하면 90으로 70을 넘습니다
```

체결처럼 다른 것의 프로파일을 직접 계산하면서 차트의 프로파일과 맞추고 싶다면 같은 방식으로 나눕니다. `volumeProfileGrid(low, high, rows)`는 `low`부터 `high`까지의 행(가장 낮은 행의 `bottom`, 각 행의 높이 `step`, 행 수 `count`)을 돌려주며, `computeVolumeProfile`이 봉의 가격을 나누는 방식과 똑같습니다. `checkVolumeProfileOptions(options, label)`은 같은 규칙으로 `rows`와 `valueArea`를 검사하고 기본값을 채웁니다.

```ts
import { checkVolumeProfileOptions, volumeProfileGrid } from '@kumochart-sdk/core/volume-profile';

const { rows } = checkVolumeProfileOptions({ rows: 4 }, 'options');
volumeProfileGrid(90, 110, rows); // { bottom: 90, step: 5, count: 4 }
```

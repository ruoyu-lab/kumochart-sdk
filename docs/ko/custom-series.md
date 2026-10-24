# 사용자 정의 시리즈

<!-- code-prelude
interface DotsStyle {
  color: string;
  radius: number;
}
-->

차트는 두 단계로 봉을 표시합니다. 먼저 어떤 봉을 표시할지 정하고(봉 변환, 예: 렌코는 봉을 벽돌로 바꿈), 그다음 어떻게 그릴지 정합니다(시리즈 유형, 예: 캔들, 라인). 두 단계 모두 직접 작성할 수 있습니다.

## 그리는 방식 직접 작성하기

아래 시리즈 유형은 봉마다 종가 위치에 점을 하나 찍습니다.

```ts live height=360
import { createChart, type SeriesTypeDefinition } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

interface DotsStyle {
  color: string;
  radius: number;
}

const dots: SeriesTypeDefinition<DotsStyle> = {
  type: 'dots',
  input: 'value', // 봉마다 값 하나, 'ohlc'이면 시가·고가·저가·종가를 받음
  defaultStyle: (_theme, color) => ({ color, radius: 2 }),
  paint: ({ ctx, points, style }) => {
    ctx.fillStyle = style.color;
    for (let i = 0; i < points.count; i += 1) {
      const y = points.value(i);
      if (Number.isNaN(y)) continue; // 값이 없는 곳
      ctx.beginPath();
      ctx.arc(points.x(i), y, style.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const chart = createChart(document.getElementById('chart')!);
chart.series.register(dots);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.series.add({
  type: 'dots',
  data: chart.data.toArray().map((bar) => ({ time: bar.time, value: bar.close }))
});
```

`paint`는 화면에 보이는 점만 받으며, 좌표는 이미 변환되어 있습니다.

- `points.x(i)`: i번째 점의 가로 좌표(봉의 중심).
- `input: 'value'`일 때 `points.value(i)`는 세로 좌표입니다. `input: 'ohlc'`일 때는 `points.open(i)`, `high(i)`, `low(i)`, `close(i)`를 쓰고, `points.isUp(i)`는 상승 여부입니다.
- `points.color(i)`: 메인 시리즈의 `barColor`가 이 봉에 지정한 색상, 없으면 `null`.
- `barSpacing`: 봉 하나가 차지하는 너비. 막대나 캔들의 너비를 정할 때 씁니다.
- `valueToY`: 기준선처럼 추가 요소를 그릴 때 씁니다.

`ctx`는 이미 플롯 영역으로 잘려 있고 좌표도 옮겨져 있으므로 CSS 픽셀 단위로 그립니다.

`defaultStyle(theme, color)`는 완전한 기본 스타일을 반환합니다. `color`는 차트가 이 시리즈에 배정한 색상이며(겹쳐 놓은 시리즈에는 테마의 palette에서 차례로 배정), 사용자가 준 스타일이 그 위에 병합됩니다. 가격 축이 데이터 외에 다른 값(예: 막대의 시작점)도 담아야 한다면 `extraExtents(style)`에서 그 값들을 반환합니다.

### 메인 시리즈에 쓰기

등록한 시리즈 유형은 메인 시리즈에도 쓸 수 있습니다.

```ts
chart.applyOptions({ mainSeries: { type: 'dots' } });
```

TypeScript에서는 메인 시리즈의 유형이 차트가 아는 이름이어야 하므로, 선언 병합으로 알려 줍니다.

```ts
declare module '@kumochart-sdk/core' {
  interface SeriesStyleMap {
    dots: DotsStyle;
  }
}
```

이렇게 하면 `mainSeries.type: 'dots'`와 `mainSeries.styles.dots` 모두 타입 검사를 받습니다.

## 봉 변환 직접 작성하기

봉 변환은 현재 주기의 봉을 받아 하나씩 새 봉을 만듭니다. 아래 변환은 N개 봉마다 하나로 합칩니다.

```ts
import type { Bar, BarTransformDefinition, BarTransformStream } from '@kumochart-sdk/core';

class MergeStream implements BarTransformStream {
  constructor(
    private readonly size: number,
    private forming: Bar | null = null,
    private count = 0
  ) {}

  next(bar: Bar): readonly Bar[] {
    const f = this.forming;
    this.forming = f
      ? {
          time: f.time,
          open: f.open,
          high: Math.max(f.high, bar.high),
          low: Math.min(f.low, bar.low),
          close: bar.close,
          volume: f.volume + bar.volume
        }
      : { ...bar };
    this.count += 1;

    if (this.count < this.size) return []; // 아직 다 모이지 않아 완성된 봉이 없음
    const done = this.forming;
    this.forming = null;
    this.count = 0;
    return [done];
  }

  current(): Bar | null {
    return this.forming; // 아직 형성 중인 봉, 맨 끝에 그림
  }

  clone(): BarTransformStream {
    return new MergeStream(this.size, this.forming, this.count);
  }
}

export const mergeBars: BarTransformDefinition<{ size?: number }> = {
  type: 'merge',
  name: 'Merge',
  keepsTime: false,
  create: ({ size = 3 }) => {
    if (!Number.isInteger(size) || size < 1)
      throw new Error('merge: size must be a positive integer');
    return new MergeStream(size);
  }
};

chart.transforms.register(mergeBars);
chart.transforms.set({ type: 'merge', params: { size: 5 } });
```

몇 가지 규칙이 있습니다.

- `next(bar, side)`는 이 입력으로 완성된 봉(0개, 1개 또는 여러 개)을 시간 순서대로 반환합니다. 체결로 만들 때 `side`는 그 체결의 시장가 쪽(`buy`, `sell`, 모르면 `null`)이며, 봉으로 만들 때는 `null`입니다. 쓰지 않는다면 이 인자는 생략해도 됩니다.
- `current()`는 아직 완성되지 않고 형성 중인 봉을 반환하며, 없으면 `null`입니다.
- `clone()`은 모든 상태를 복사해야 합니다. 최신 봉이 실시간으로 업데이트되면 차트는 업데이트 이전의 복사본에서 다시 계산합니다.
- `keepsTime`: 입력 봉 하나가 정확히 시간이 같은 출력 봉 하나가 될 때(하이킨 아시처럼) `true`로 지정하면, 차트는 카운트다운처럼 주기에 의존하는 기능을 유지합니다. 그렇지 않으면 `false`입니다.
- `create(params, input, from)`의 `input`은 곧 입력될 모든 봉으로, 자동 크기를 계산할 때 쓸 수 있습니다(예: 평균 실제 범위로 벽돌 높이 결정). `from`은 그것이 무엇인지 알려 주며, `'bars'`는 현재 주기의 봉, `'trades'`는 체결 하나하나입니다. 매개변수가 잘못되었으면 오류를 던지세요. `transforms.set()`이 그 오류를 호출한 쪽에 전달합니다.

자동으로 계산한 매개변수를 보고하면 `chart.transforms.get().resolved`로 읽을 수 있어 화면에 표시할 수 있습니다. 아직 정해지지 않았으면 `null`을 반환합니다. 계산기에 메서드를 하나 추가합니다.

```ts no-check
class MergeStream implements BarTransformStream {
  // ……위의 메서드들

  resolved(): Readonly<Record<string, unknown>> {
    return { size: this.size };
  }
}
```

## 둘을 함께 쓰기

카기처럼 만들어진 봉을 전용 방식으로 그려야 할 때는 변환과 시리즈 유형을 각각 등록한 뒤 함께 켭니다.

```ts
chart.batch(() => {
  chart.transforms.set({ type: 'merge', params: { size: 5 } });
  chart.applyOptions({ mainSeries: { type: 'dots' } });
});
```

시리즈 유형의 `paint`에서 `transform`은 변환이 보고한 매개변수(`resolved`)이며, 박스 크기 같은 것을 그릴 때 쓸 수 있습니다.

차트를 만들 때부터 이 유형들을 포함하거나, 다른 프로젝트에서 쓰도록 패키지로 묶으려면 [사용자 정의 모듈](custom-modules.md)을 참고하세요.

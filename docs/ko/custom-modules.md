# 사용자 정의 모듈

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
-->

직접 만든 지표, 그리기, 시리즈는 해당 모듈에 바로 넘기는 것이 가장 간단합니다(`indicators([...allIndicators, MY_INDICATOR])`). 여러 가지를 하나로 묶고 싶을 때, 예를 들어 직접 만든 지표 몇 개와 플러그인 하나를 묶고 차트에 자체 API까지 더하고 싶다면 모듈로 만드세요. SDK의 모듈과 마찬가지로 차트를 만들 때 넘기면 됩니다.

## 모듈 작성하기

`createModule({ name, install })`: `install`은 차트가 만들어지고 SDK의 모듈이 모두 설치된 뒤에 실행되며, 차트 자체를 받습니다. 반환한 객체는 차트의 새 API가 됩니다.

```ts
import { createChart, createModule, withAlpha } from '@kumochart-sdk/core';

/** 메인 창에서 강조하는 가격 구간, 언제든 바꿀 수 있음 */
export function band() {
  return createModule({
    name: 'band',
    install: (chart) => {
      let range: { from: number; to: number } | null = null;
      let repaint = () => {};

      chart.plugins.add({
        name: 'band',
        attach: (host) => {
          repaint = host.repaint;
        },
        paint: ({ ctx, layer, pane, theme }) => {
          if (layer !== 'below' || pane.id !== 'main' || !range) return;
          const top = pane.valueToY(Math.max(range.from, range.to));
          const bottom = pane.valueToY(Math.min(range.from, range.to));
          ctx.fillStyle = withAlpha(theme.accent, 0.12);
          ctx.fillRect(0, top, pane.width, bottom - top);
        }
      });

      return {
        band: {
          set(from: number, to: number) {
            range = { from, to };
            repaint();
          },
          clear() {
            range = null;
            repaint();
          }
        }
      };
    }
  });
}

const chart = createChart(container, { modules: [band()] });
chart.band.set(62_000, 64_000); // 타입 지원
```

`{ band: ... }`를 반환하면 차트에 `chart.band`가 생기고, TypeScript도 이를 인식합니다. 새 API의 이름은 차트에 이미 있는 이름(예: `data`, `indicators`)과 겹치면 안 되며, 겹치면 차트를 만들 때 오류가 납니다. 새 API가 필요 없으면 `install`에서 아무것도 반환하지 않으면 됩니다.

## 자체 유형 포함하기

모듈에서 지표나 그리기 같은 유형을 등록하려면 차트에 해당 모듈이 있어야 합니다. `install`이 받는 `chart`에는 코어의 타입만 있으므로, 어떤 모듈의 API를 쓸 때는 그 모듈이 있는 차트로 타입을 지정합니다.

```ts
import { createModule, type Chart } from '@kumochart-sdk/core';
import { indicators, allIndicators, type IndicatorsModule } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings, type DrawingsModule } from '@kumochart-sdk/core/drawings';

export const myToolkit = createModule({
  name: 'my-toolkit',
  install: (chart) => {
    if (!chart.modules().includes('indicators') || !chart.modules().includes('drawings')) {
      throw new Error('my-toolkit needs the indicators and drawings modules.');
    }

    const typed = chart as Chart<[IndicatorsModule, DrawingsModule]>;
    typed.indicators.register(DEVIATION);
    typed.drawings.register(priceZone);
  }
});

createChart(container, {
  modules: [indicators(allIndicators), drawings(allDrawings), myToolkit]
});
```

`install`은 차트가 옵션을 적용하기 전에 실행되므로, 차트를 만들 때의 옵션에서 모듈이 등록한 유형을 바로 쓸 수 있습니다. 예를 들어 메인 시리즈에 사용자 정의 시리즈 유형을 곧바로 쓸 수 있습니다.

```ts no-check
createChart(container, {
  modules: [myToolkit],
  mainSeries: { type: 'dots' } // 'dots'는 myToolkit이 등록
});
```

## 옵션, 이벤트, 레이아웃

모듈은 SDK의 모듈처럼 차트 옵션에 자체 섹션을 더하고, 자체 이벤트를 발생시키고, `saveState()`가 저장하는 레이아웃에 자체 내용을 저장할 수 있습니다. 이를 쓰려면 모듈이 더하는 것을 타입으로 적어 `createModule`의 타입 매개변수로 넘깁니다.

```ts
import { createChart, createModule } from '@kumochart-sdk/core';

interface Range {
  from: number;
  to: number;
}

interface BandTypes {
  /** 차트의 새 API */
  api: { band: { set(range: Range | null): void } };
  /** 옵션의 한 섹션: options.band */
  options: { band: { opacity: number } };
  /** 모듈의 이벤트 */
  events: { bandChange: { range: Range | null } };
  /** 저장되는 레이아웃의 일부: saveState().band */
  state: { band?: Range };
}

export const band = createModule<BandTypes>({
  name: 'band',
  options: {
    key: 'band',
    defaults: () => ({ opacity: 0.12 }),
    validate: (section, label) => {
      if (section.opacity < 0 || section.opacity > 1) {
        throw new Error(`${label}.opacity must be between 0 and 1.`);
      }
    }
  },
  install: (chart, context) => {
    let range: Range | null = null;

    const set = (next: Range | null) => {
      range = next;
      context.emit('bandChange', { range });
    };

    context.keepState({
      key: 'band',
      save: () => range ?? { from: Number.NaN, to: Number.NaN },
      read: (saved, label) => {
        const value = saved as Partial<Range> | null;

        if (typeof value?.from !== 'number' || typeof value.to !== 'number') {
          throw new Error(`${label} must have from and to.`);
        }

        return { from: value.from, to: value.to };
      },
      load: (state) => {
        range = state && Number.isFinite(state.from) ? state : null;
      }
    });

    chart.plugins.add({
      name: 'band',
      paint: ({ ctx, layer, pane }) => {
        if (layer !== 'below' || pane.id !== 'main' || !range) return;
        const top = pane.valueToY(Math.max(range.from, range.to));
        const bottom = pane.valueToY(Math.min(range.from, range.to));
        ctx.fillStyle = `rgba(41, 98, 255, ${context.options().opacity})`;
        ctx.fillRect(0, top, pane.width, bottom - top);
      }
    });

    return { band: { set } };
  }
});

const chart = createChart(container, { modules: [band], band: { opacity: 0.2 } });
chart.on('bandChange', ({ range }) => console.log(range));
chart.band.set({ from: 62_000, to: 64_000 });
chart.applyOptions({ band: { opacity: 0.3 } });
```

### 옵션

`options`의 `key`는 차트 옵션에서 이 섹션의 이름입니다. 차트를 만들 때와 `applyOptions()`로 넘긴 이 섹션은 `defaults()` 위에 병합된 뒤 `validate()`로 검사되며, `validate()`가 오류를 던지면 그 설정은 아무것도 바꾸지 않습니다. 모듈은 `context.options()`로 이 섹션의 현재 값을 읽고, `chart.options()`에도 들어 있습니다. `options`를 선언하지 않은 모듈이 `context.options()`를 호출하면 오류가 납니다.

### 이벤트

`context.emit(이름, 이벤트)`로 모듈의 이벤트를 발생시키면 차트의 `chart.on()`으로 받을 수 있고, SDK의 이벤트처럼 타입이 지정됩니다. API 호출 안에서 발생시킨 이벤트는 차트의 이벤트와 마찬가지로 호출이 끝난 뒤에 전달됩니다.

### 옵션 변화 따라가기

차트는 옵션을 설정할 때마다(`applyOptions()`, 그리고 `loadState()`가 메인 시리즈의 유형을 설정할 때) `optionsChange`를 발생시키며, 설정 후의 `options`와 설정 전의 `previous`를 함께 넘깁니다. 모듈은 관심 있는 항목을 비교하면 바뀌었는지 알 수 있습니다. 예를 들어 메인 시리즈의 유형이 바뀌었을 때:

```ts
chart.on('optionsChange', ({ options, previous }) => {
  if (options.mainSeries.type !== previous.mainSeries.type) {
    // 메인 시리즈의 유형이 바뀜
  }
});
```

### 레이아웃에 저장하기

`context.keepState()`를 쓰면 `saveState()`가 `save()`의 결과를 `key` 아래에 저장합니다. `loadState()`는 먼저 `read()`로 이 부분을 검사하고(오류를 던지면 불러오기 전체가 실패하며 차트는 아무것도 바뀌지 않습니다), 모든 부분이 통과한 뒤에 `load()`를 호출합니다. 불러오는 레이아웃에 이 부분이 없으면(이 모듈을 넣기 전에 저장한 것 등) `load()`는 `null`을 받습니다. `key`는 차트가 직접 저장하는 것(`view`, `panes` 등)이나 다른 모듈의 것과 겹치면 안 됩니다.

## 실행 순서

- SDK의 모듈이 먼저 설치되고, 그다음 `modules`에 적힌 순서대로 각 사용자 정의 모듈의 `install`이 실행됩니다.
- `install`에서 던진 오류는 `createChart()`를 실패시키며, 만들다 만 차트는 정리됩니다.
- 모듈 이름은 한 차트 안에서 중복될 수 없습니다. `chart.modules()`는 모든 모듈의 이름을 나열합니다.

## 패키지로 배포하기

모듈은 평범한 함수일 뿐이므로 직접 만든 npm 패키지에 넣을 수 있습니다. `@kumochart-sdk/core`를 `peerDependencies`에 적어 두면, 사용하는 쪽은 SDK를 한 벌만 설치하고 여러분의 모듈과 그쪽의 차트가 그것을 함께 씁니다.

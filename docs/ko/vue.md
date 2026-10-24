# Vue

```bash
npm install @kumochart-sdk/core @kumochart-sdk/vue
```

Vue 3.5 이상이 필요합니다. 사용 방법은 두 가지입니다. 데이터, 주기 등을 props로 넘기는 `KumoChart` 컴포넌트와, 차트 객체를 직접 받아 다루는 `useKumoChart` 컴포저블입니다.

## 컴포넌트

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

const modules = [indicators([MA, MACD])] as const;
const bars = ref<BarInput[]>([]);
const timeframe = ref('15m');

fetch('/api/bars')
  .then((response) => response.json())
  .then((list: BarInput[]) => {
    bars.value = list;
  });

function onReady(chart: Chart) {
  const typed = chart as Chart<typeof modules>;
  typed.indicators.add({ type: 'MACD' });
}
</script>

<template>
  <div style="height: 480px">
    <KumoChart
      :modules="modules"
      :options="{ locale: 'ko-KR' }"
      :data="bars"
      interval="1m"
      :timeframe="timeframe"
      @ready="onReady"
      @crosshair-move="(event) => console.log(event)"
    />
  </div>
</template>
```

컴포넌트는 부모 요소를 가득 채우므로, 부모 요소에 높이가 있어야 합니다.

| prop        | 역할                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `modules`   | 차트의 모듈. **차트를 만들 때 한 번만 읽으며**, 이후에 바꿔도 효과가 없음 |
| `options`   | 차트 옵션, 바뀌면 `applyOptions()`로 적용(모듈의 옵션 포함)               |
| `data`      | 봉, 다른 배열로 바꾸면 한꺼번에 교체                                      |
| `interval`  | `data`의 주기(예: `'1m'`), 주기 전환과 체결 합치기에 필요                 |
| `timeframe` | 표시할 주기, `null`이면 원래 주기를 표시                                  |
| `transform` | 봉 변환(예: `{ type: 'renko' }`), `null`이면 끔                           |
| `orders`    | 주문, `orders()` 모듈이 필요                                              |
| `markers`   | 체결 표시, `markers()` 모듈이 필요                                        |
| `alerts`    | 알림, `alerts()` 모듈이 필요                                              |

차트와 모듈의 모든 이벤트는 `@이벤트명`으로 구독할 수 있습니다(`@crosshair-move`, `@order-drag`, `@drawings-change`…). 또 `@ready`는 차트가 만들어지고 위의 props가 모두 적용된 뒤 차트 객체를 넘겨줍니다.

`data`는 한꺼번에 교체되므로 실시간 업데이트에는 맞지 않습니다. 봉이 하나 올 때마다 배열을 바꾸면 모든 봉을 다시 설정하게 됩니다. 실시간 데이터는 `@ready`에서 받은 차트에 `chart.data.update()`로 넣으세요.

`ref`로도 차트를 얻을 수 있습니다.

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const modules = [indicators(allIndicators)];
const view = useTemplateRef<InstanceType<typeof KumoChart>>('view');
// view.value?.chart가 차트 객체, 만들어지기 전에는 null
</script>

<template>
  <KumoChart ref="view" :modules="modules" />
</template>
```

## 컴포저블

완전히 직접 제어해야 하거나, 모듈의 타입이 반영된 차트 객체가 필요하면 `useKumoChart`를 씁니다.

```vue
<script setup lang="ts">
import { useTemplateRef, watch } from 'vue';
import { useKumoChart } from '@kumochart-sdk/vue';
import { darkTheme, lightTheme, type BarInput } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const props = defineProps<{ bars: BarInput[]; dark: boolean }>();

const container = useTemplateRef<HTMLDivElement>('container');
const chart = useKumoChart(container, () => ({
  modules: [indicators(allIndicators)],
  theme: props.dark ? darkTheme : lightTheme // 바뀌면 자동으로 applyOptions
}));

watch([chart, () => props.bars], ([instance, bars]) => {
  instance?.data.set(bars, { interval: '1m' });
});

function addRsi() {
  chart.value?.indicators.add({ type: 'RSI' }); // 타입이 지정됨
}
</script>

<template>
  <div ref="container" style="height: 480px"></div>
</template>
```

`chart`는 `ShallowRef`입니다. 컴포넌트가 마운트된 뒤 차트가 만들어지며, 그 전에는 `null`입니다. 언마운트되면 자동으로 파기됩니다. 옵션은 객체, `ref`, 함수 중 무엇이든 될 수 있으며, `modules`를 제외한 옵션은 바뀌면 자동으로 적용됩니다.

## 주의

- 차트 객체를 `reactive()`나 깊은 `ref()`에 넣지 마세요. Vue의 프록시 때문에 느려집니다. `useKumoChart`가 반환하는 것은 이미 `shallowRef`입니다.
- `modules`는 차트를 만들 때만 씁니다. 모듈을 바꾸려면 컴포넌트 인스턴스를 바꾸세요(예: 컴포넌트에 다른 `key`를 주기).
- 서버 사이드 렌더링에서는 차트가 브라우저에서만 만들어지고, 서버에서는 컴포넌트가 빈 `div` 하나만 출력합니다.

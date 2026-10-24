# Vue

```bash
npm install @kumochart-sdk/core @kumochart-sdk/vue
```

Vue 3.5 以上が必要です。使い方は 2 通りあります。データや時間足などを props として書く `KumoChart` コンポーネントと、チャートオブジェクトを直接受け取って自分で操作する `useKumoChart` コンポーザブルです。

## コンポーネント

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
      :options="{ locale: 'ja-JP' }"
      :data="bars"
      interval="1m"
      :timeframe="timeframe"
      @ready="onReady"
      @crosshair-move="(event) => console.log(event)"
    />
  </div>
</template>
```

コンポーネントは親要素いっぱいに広がるので、親要素には高さが必要です。

| プロパティ  | 働き                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `modules`   | チャートのモジュール。**チャートの作成時に 1 回だけ読む**ので、あとで変えても効果はない |
| `options`   | チャートのオプション。変わると `applyOptions()` する（モジュールのオプションも含む）    |
| `data`      | ローソク足。別の配列に替えると、まとめて置き換える                                      |
| `interval`  | `data` の時間足。たとえば `'1m'`。時間足の切り替えにも、約定（ティック）の合成にも必要  |
| `timeframe` | 表示する時間足。`null` なら元の時間足を表示する                                         |
| `transform` | ローソク足の変換。たとえば `{ type: 'renko' }`。`null` でオフにする                     |
| `orders`    | 注文。`orders()` モジュールが必要                                                       |
| `markers`   | 約定マーカー。`markers()` モジュールが必要                                              |
| `alerts`    | アラート。`alerts()` モジュールが必要                                                   |

チャートとモジュールのすべてのイベントは `@イベント名` で監視できます（`@crosshair-move`、`@order-drag`、`@drawings-change`……）。さらに `@ready` は、チャートが作られて上のプロパティがすべて設定されたあとに、チャートオブジェクトを渡します。

`data` はまとめて置き換えるものなので、リアルタイムの更新には向きません。足が 1 本来るたびに配列を替えると、すべての足を設定し直すことになります。リアルタイムデータは、`@ready` でチャートを受け取ったあと `chart.data.update()` で送ります。

`ref` でもチャートを取得できます。

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { KumoChart } from '@kumochart-sdk/vue';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const modules = [indicators(allIndicators)];
const view = useTemplateRef<InstanceType<typeof KumoChart>>('view');
// view.value?.chart がチャートオブジェクト。作成されるまでは null
</script>

<template>
  <KumoChart ref="view" :modules="modules" />
</template>
```

## コンポーザブル

完全に自分で制御したいときや、モジュールの型が付いたチャートオブジェクトがほしいときは `useKumoChart` を使います。

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
  theme: props.dark ? darkTheme : lightTheme // 変わると自動で applyOptions される
}));

watch([chart, () => props.bars], ([instance, bars]) => {
  instance?.data.set(bars, { interval: '1m' });
});

function addRsi() {
  chart.value?.indicators.add({ type: 'RSI' }); // 型が付く
}
</script>

<template>
  <div ref="container" style="height: 480px"></div>
</template>
```

`chart` は `ShallowRef` です。コンポーネントがマウントされたあとにチャートが作られ、それまでは `null` です。アンマウント時には自動で破棄されます。オプションはオブジェクト、`ref`、関数のどれでもよく、`modules` 以外のオプションは変わると自動で適用されます。

## 注意

- チャートオブジェクトを `reactive()` や深い `ref()` に入れないでください。Vue のプロキシで遅くなります。`useKumoChart` が返すのはすでに `shallowRef` です。
- `modules` はチャートの作成時にだけ使われます。モジュールを替えるには、コンポーネントのインスタンスを替えます（たとえばコンポーネントに別の `key` を付けます）。
- サーバーサイドレンダリングでは、チャートはブラウザーでだけ作られます。サーバーでは、コンポーネントは空の `div` を 1 つ出力するだけです。

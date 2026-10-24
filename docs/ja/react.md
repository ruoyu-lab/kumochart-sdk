# React

```bash
npm install @kumochart-sdk/core @kumochart-sdk/react
```

React 18.3 または 19 が必要です。使い方は 2 通りあります。データや時間足などをプロパティとして書く `KumoChart` コンポーネントと、チャートオブジェクトを直接受け取って自分で操作する `useKumoChart` フックです。

## コンポーネント

```tsx
import { KumoChart } from '@kumochart-sdk/react';
import { indicators, MA, MACD } from '@kumochart-sdk/core/indicators';
import type { BarInput, Chart } from '@kumochart-sdk/core';

// コンポーネントの外に置き、レンダリングのたびに同じオブジェクトになるようにする
const modules = [indicators([MA, MACD])] as const;
const options = { locale: 'ja-JP' };

export function PriceChart({ bars, timeframe }: { bars: BarInput[]; timeframe: string }) {
  return (
    <div style={{ height: 480 }}>
      <KumoChart
        modules={modules}
        options={options}
        data={bars}
        interval="1m"
        timeframe={timeframe}
        onReady={(chart) => {
          (chart as Chart<typeof modules>).indicators.add({ type: 'MACD' });
        }}
        onCrosshairMove={(event) => console.log(event)}
      />
    </div>
  );
}
```

<!-- code-prelude
declare const modules: readonly import('@kumochart-sdk/core').ChartModule[];
-->

コンポーネントはデフォルトで親要素いっぱいに広がる（`width: 100%; height: 100%`）ので、親要素には高さが必要です。`style` や `className` で自分で指定することもできます。

| プロパティ  | 役割                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `modules`   | チャートのモジュール。**作成時に 1 度だけ読まれ**、あとで変えても効果はない                              |
| `options`   | チャートのオプション。新しいオブジェクトを渡すと `applyOptions()` される（モジュールのオプションも含む） |
| `data`      | ローソク足。新しい配列を渡すとまとめて置き換える                                                         |
| `interval`  | `data` の時間足。たとえば `'1m'`。時間足の切り替えにも約定（ティック）の反映にも必要                     |
| `timeframe` | 表示する時間足。`null` なら元の時間足を表示                                                              |
| `transform` | ローソク足の変換。たとえば `{ type: 'renko' }`。`null` でオフ                                            |
| `orders`    | 注文。`orders()` モジュールが必要                                                                        |
| `markers`   | 約定マーカー。`markers()` モジュールが必要                                                               |
| `alerts`    | アラート。`alerts()` モジュールが必要                                                                    |

チャートとモジュールのすべてのイベントには、対応する `on*` プロパティがあります（`onCrosshairMove`、`onOrderDrag`、`onDrawingsChange`……）。`onReady` は、チャートが作成され、上記のプロパティがすべて設定されたあとに、チャートオブジェクトを渡します。

プロパティは React の state と同じく参照で比較されます。レンダリングのたびに新しい `options={{ ... }}` を書くと、チャートは毎回オプションを適用し直します。変わらないオブジェクトはコンポーネントの外に置くか、`useMemo` を使います。

`data` はまとめて置き換えるものなので、リアルタイム更新には向きません。リアルタイムデータは、`onReady` でチャートを受け取ってから `chart.data.update()` で送ります。

`ref` でもチャートを取得できます。

```tsx
import { useRef } from 'react';
import { KumoChart } from '@kumochart-sdk/react';
import type { Chart } from '@kumochart-sdk/core';

const chartRef = useRef<Chart | null>(null);

<KumoChart ref={chartRef} modules={modules} />;
// chartRef.current がチャートオブジェクト。作成前は null
```

## フック

すべてを自分で制御したいときや、モジュールの型が付いたチャートオブジェクトが欲しいときは、`useKumoChart` を使います。

```tsx
import { useEffect } from 'react';
import { useKumoChart } from '@kumochart-sdk/react';
import type { BarInput } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

const chartOptions = { modules: [indicators(allIndicators)] };

export function PriceChart({ bars }: { bars: BarInput[] }) {
  const [ref, chart] = useKumoChart(chartOptions);

  useEffect(() => {
    chart?.data.set(bars, { interval: '1m' });
  }, [chart, bars]);

  return (
    <>
      <button onClick={() => chart?.indicators.add({ type: 'RSI' })}>RSI</button>
      <div ref={ref} style={{ height: 480 }} />
    </>
  );
}
```

`ref` はチャートを置く要素に渡します。要素が現れるとチャートを作成し、消えると破棄します。それまで `chart` は `null` です。`modules` 以外は、新しいオプションオブジェクトを渡すと自動で適用されるので、オプションオブジェクトは同じものを使い続けるようにします。

## 注意点

- `modules` はチャートの作成時にしか使われません。モジュールを変えたいときは、コンポーネントのインスタンスを作り直します（たとえば `key` を変える）。
- サーバーサイドレンダリングでは、チャートはブラウザでだけ作成され、サーバーは空の `div` だけを出力します。

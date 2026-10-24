# モジュール

<!-- code-prelude
declare const myIndicator: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
-->

コアには、どのチャートでも使うものだけが入っています。ローソク足と基本のシリーズ、スケール、ペイン、クロスヘア、凡例、ズームとスクロール、時間足の合成、保存と復元です。それ以外の機能はすべてモジュールで、使うときだけ読み込みます。読み込まなかったものはバンドルに含まれません。

## モジュールを読み込む

チャートの作成時に、モジュールを `modules` に入れます。

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { alerts } from '@kumochart-sdk/core/alerts';

const chart = createChart(container, {
  modules: [indicators(allIndicators), drawings(allDrawings), alerts()]
});

chart.indicators.add({ type: 'RSI' });
chart.drawings.startTool('fib-retracement');
chart.alerts.add({ id: 'btc-100k', trigger: 'cross-up', value: 100000 });
```

モジュールを 1 つ読み込むと、そのモジュールのインターフェース（たとえば `chart.indicators`）と、オプションやイベントがチャートに加わります。モジュールを渡せるのはチャートの作成時だけで、作成後に追加したり外したりはできません。

## モジュールの一覧

| モジュール       | エントリーポイント                   | 読み込み方                  | チャートに加わるもの                         |
| ---------------- | ------------------------------------ | --------------------------- | -------------------------------------------- |
| インジケーター   | `@kumochart-sdk/core/indicators`     | `indicators(allIndicators)` | `chart.indicators`                           |
| 描画             | `@kumochart-sdk/core/drawings`       | `drawings(allDrawings)`     | `chart.drawings`                             |
| チャートタイプ   | `@kumochart-sdk/core/chart-types`    | `chartTypes(allChartTypes)` | メインペインをこれらのタイプに切り替えられる |
| アラート         | `@kumochart-sdk/core/alerts`         | `alerts()`                  | `chart.alerts`                               |
| 注文ライン       | `@kumochart-sdk/core/trading`        | `orders()`                  | `chart.orders`                               |
| 約定マーカー     | `@kumochart-sdk/core/trading`        | `markers()`                 | `chart.markers`                              |
| リプレイ         | `@kumochart-sdk/core/replay`         | `replay()`                  | `chart.replay`                               |
| 価格帯別出来高   | `@kumochart-sdk/core/volume-profile` | `volumeProfiles()`          | `chart.volumeProfiles`                       |
| ウォーターマーク | `@kumochart-sdk/core/watermark`      | `watermark()`               | `watermark` オプション                       |
| すべて           | `@kumochart-sdk/core/all`            | `allModules()`              | 上記のすべて                                 |

価格帯別出来高のエントリーポイントには描画ツールも 1 つあります。固定範囲の価格帯別出来高 `fixedRangeVolumeProfile()` で、描画モジュールに渡して使います。[価格帯別出来高](volume-profile.md#固定範囲)を参照してください。

## 丸ごと読み込むか、いくつか選ぶか

インジケーター、描画、チャートタイプの 3 つのモジュールには多くの種類が入っています。すべてを読み込むことも、使う種類だけを渡すこともできます。

```ts
import { indicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';
import { drawings, trendLine, horizontalLine, fibRetracement } from '@kumochart-sdk/core/drawings';
import { chartTypes, heikinAshi, renko } from '@kumochart-sdk/core/chart-types';

const chart = createChart(container, {
  modules: [
    indicators([MA, MACD, RSI]),
    drawings([trendLine, horizontalLine, fibRetracement]),
    chartTypes([heikinAshi, renko])
  ]
});
```

バンドルに含まれるのは渡した種類だけです。各モジュールにどんな種類があるかは、[インジケーター](indicators.md)、[描画ツール](drawings.md)、[チャートタイプ](chart-types.md)を参照してください。

## サイズ

minify と gzip 後の、コアを含めたサイズです。

| 読み込む内容                    | サイズ    |
| ------------------------------- | --------- |
| コアのみ                        | 約 44 kB  |
| コア + MA、MACD、RSI            | 約 54 kB  |
| コア + すべてのインジケーター   | 約 63 kB  |
| コア + トレンドラインと水平線   | 約 57 kB  |
| コア + すべての描画ツール       | 約 69 kB  |
| コア + すべてのチャートタイプ   | 約 49 kB  |
| コア + アラート                 | 約 49 kB  |
| コア + 注文ラインと約定マーカー | 約 47 kB  |
| コア + リプレイ                 | 約 45 kB  |
| コア + 価格帯別出来高           | 約 47 kB  |
| すべて                          | 約 103 kB |

各モジュールはコアのコードを共有しているので、まとめて読み込んだときのサイズは、上の表の差分を足し合わせたものより小さくなります。

## 作成後に種類を追加する

モジュールを渡せるのはチャートの作成時だけですが、モジュールの中の種類はいつでも追加・削除できます。たとえば自作のインジケーターなら、次のようにします。

```ts
chart.indicators.register(myIndicator);
chart.indicators.add({ type: myIndicator.type });

chart.indicators.types(); // いま使えるインジケーターの種類
chart.indicators.unregister(myIndicator.type);
```

描画（`chart.drawings`）、ローソク足の変換（`chart.transforms`）、シリーズ（`chart.series`）にも、同じ `register()`、`unregister()`、`types()` があります。チャート上で使用中の種類は削除できません。削除しようとするとエラーになり、どこで使われているかが示されます。

作成時から自作の種類を含めておきたい場合や、チャートに独自の機能をひとまとまり追加したい場合は、[カスタムモジュール](custom-modules.md)を参照してください。

## すべて読み込む

サイズを気にしない場合や、まず試してみたい場合は、すべて読み込みます。

```ts
import { createChart } from '@kumochart-sdk/core';
import { allModules } from '@kumochart-sdk/core/all';

const chart = createChart(container, { modules: allModules() });
```

バンドラーを使わないときに読み込む `kumochart.iife.js` も、すべてを読み込んだものです。[クイックスタート](getting-started.md#バンドラーを使わない場合)を参照してください。

## TypeScript では

チャートの型はモジュールに連動します。インジケーターモジュールを読み込んだときだけ `chart.indicators` に型が付き、読み込まずに使うとコンパイル時にエラーになります。

このチャートの型を別の場所で書くときは、`Chart` にモジュールの型を渡します。

```ts
import { createChart, type Chart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';

const modules = [indicators(allIndicators), drawings(allDrawings)] as const;

export type MyChart = Chart<typeof modules>;

export function mountChart(container: HTMLElement): MyChart {
  return createChart(container, { modules });
}
```

すべてを読み込んだチャートは `Chart<AllModules>` です（`AllModules` は `@kumochart-sdk/core/all` からインポートします）。`Chart` とだけ書くと、モジュールを持たないチャートの型になります。どのチャートもこの型として扱えます。

## 保存した状態とモジュール

`chart.saveState()` で保存した状態には、インジケーターや描画など各モジュールの部分も含まれます。復元するときは、チャートに同じモジュールが必要です。状態に描画が含まれているのにチャートに描画モジュールがなければ、`loadState()` はエラーになり、チャートはそのままです。[保存と復元](state.md)を参照してください。

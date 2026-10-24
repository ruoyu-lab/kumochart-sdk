# カスタムシリーズ

<!-- code-prelude
interface DotsStyle {
  color: string;
  radius: number;
}
-->

チャートがローソク足を表示するまでには 2 つの段階があります。まず、どの足を表示するかを決め（ローソク足の変換。たとえば練行足は足をボックスに置き換えます）、次にそれをどう描くかを決めます（シリーズ。たとえばローソク足やライン）。どちらの段階も自分で書けます。

## 描き方を自分で書く

次のシリーズは、各足の終値の位置に点を 1 つ描きます。

```ts live height=360
import { createChart, type SeriesTypeDefinition } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

interface DotsStyle {
  color: string;
  radius: number;
}

const dots: SeriesTypeDefinition<DotsStyle> = {
  type: 'dots',
  input: 'value', // 1 本につき 1 つの値。'ohlc' なら四本値を受け取る
  defaultStyle: (_theme, color) => ({ color, radius: 2 }),
  paint: ({ ctx, points, style }) => {
    ctx.fillStyle = style.color;
    for (let i = 0; i < points.count; i += 1) {
      const y = points.value(i);
      if (Number.isNaN(y)) continue; // 値がないところ
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

`paint` が受け取るのは見えている点だけで、座標はすでに換算されています。

- `points.x(i)`：i 番目の点の横座標（足の中心）。
- `input: 'value'` のときは `points.value(i)` が縦座標。`input: 'ohlc'` のときは `points.open(i)`、`high(i)`、`low(i)`、`close(i)` を使い、`points.isUp(i)` は上昇したかどうか。
- `points.color(i)`：メインシリーズの `barColor` がこの足に決めた色。なければ `null`。
- `barSpacing`：1 本の足が占める幅。棒やローソク足の幅を決めるのに使う。
- `valueToY`：追加のもの、たとえばベースラインを描くときに使う。

`ctx` はすでにプロット領域にクリップされ、平行移動済みなので、CSS ピクセルで描きます。

`defaultStyle(theme, color)` は完全なデフォルトのスタイルを返します。`color` はチャートがこのシリーズに割り当てた色で（追加したシリーズにはテーマの palette から順に割り当てられます）、ユーザーが指定したスタイルはその上にマージされます。価格軸がデータ以外の値も収める必要があるとき（棒の起点など）は、`extraExtents(style)` でそれらの値を返します。

### メインシリーズに使う

登録したシリーズは、メインシリーズにも使えます。

```ts
chart.applyOptions({ mainSeries: { type: 'dots' } });
```

TypeScript では、メインシリーズのタイプはチャートが知っている名前でなければなりません。宣言のマージで伝えます。

```ts
declare module '@kumochart-sdk/core' {
  interface SeriesStyleMap {
    dots: DotsStyle;
  }
}
```

これで `mainSeries.type: 'dots'` と `mainSeries.styles.dots` の両方が型チェックされます。

## ローソク足の変換を自分で書く

ローソク足の変換は現在の時間足のローソク足を受け取り、1 本ずつ新しい足を作ります。次の例は N 本ごとに 1 本にまとめます。

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

    if (this.count < this.size) return []; // まだ本数が足りない。完成した足はない
    const done = this.forming;
    this.forming = null;
    this.count = 0;
    return [done];
  }

  current(): Bar | null {
    return this.forming; // まだ形成中の足。最後に描かれる
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

守るべきルールは次のとおりです。

- `next(bar, side)` は、この入力で完成した足（0 本、1 本、または数本）を時間の順に返します。約定から作るときの `side` はその約定の成行側（`buy`、`sell`、不明なら `null`）で、足から作るときは `null` です。使わなければこの引数は省略できます。
- `current()` は、まだ完成していない形成中の足を返します。なければ `null` です。
- `clone()` はすべての状態をコピーしなければなりません。最新の足がリアルタイムで更新されるとき、チャートは更新前のコピーから計算し直します。
- `keepsTime`：入力の各足がちょうど同じ時間の 1 本の出力になる場合（平均足のように）は `true` にします。チャートはカウントダウンのような時間足に依存する機能を保ちます。そうでなければ `false` です。
- `create(params, input, from)` の `input` はこれから入力されるすべての足で、自動のサイズを計算するのに使えます（アベレージ・トゥルー・レンジからボックスの高さを決めるなど）。`from` はそれが何かを表し、`'bars'` なら現在の時間足の足、`'trades'` なら 1 件ずつの約定です。パラメーターが正しくなければエラーを投げてください。`transforms.set()` はそのエラーを呼び出し元に渡します。

自動で計算したパラメーターを報告すると、`chart.transforms.get().resolved` で読めるようになり、画面に表示できます。まだ決まらないうちは `null` を返します。計算器にメソッドを 1 つ追加します。

```ts no-check
class MergeStream implements BarTransformStream {
  // ……上のメソッド群

  resolved(): Readonly<Record<string, unknown>> {
    return { size: this.size };
  }
}
```

## 両方を組み合わせる

カギ足のように、作った足を専用の描き方で描きたいときは、変換とシリーズをそれぞれ登録し、両方を一緒にオンにします。

```ts
chart.batch(() => {
  chart.transforms.set({ type: 'merge', params: { size: 5 } });
  chart.applyOptions({ mainSeries: { type: 'dots' } });
});
```

シリーズの `paint` では、`transform` に変換が報告したパラメーター（`resolved`）が入っているので、ボックスのサイズのようなものを描くのに使えます。

これらのタイプをチャートの作成時から組み込みたいときや、パッケージにしてほかのプロジェクトで使いたいときは、[カスタムモジュール](custom-modules.md)を参照してください。

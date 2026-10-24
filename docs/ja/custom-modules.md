# カスタムモジュール

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
-->

独自のインジケーター、描画、シリーズを使う最も簡単な方法は、対応するモジュールにそのまま渡すことです（`indicators([...allIndicators, MY_INDICATOR])`）。いくつかのものをひとまとめにしたいとき、たとえば独自のインジケーター一式とプラグインを組み合わせ、さらにチャートに独自の API を追加したいときは、モジュールにします。SDK のモジュールと同じように、チャートの作成時に渡します。

## モジュールを書く

`createModule({ name, install })`：`install` はチャートが作られ、SDK のモジュールがすべて組み込まれたあとに実行されます。チャートそのものを受け取り、返したオブジェクトがチャートの新しい API になります。

```ts
import { createChart, createModule, withAlpha } from '@kumochart-sdk/core';

/** メインペインで強調する価格帯。いつでも変えられる */
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
chart.band.set(62_000, 64_000); // 型付き
```

`{ band: ... }` を返すと、チャートに `chart.band` が加わり、TypeScript もそれを認識します。新しい API の名前は、チャートに既にあるもの（`data`、`indicators` など）と重複してはいけません。重複するとチャートの作成時にエラーになります。新しい API が必要なければ、`install` は何も返さなくてかまいません。

## 独自のタイプを持ち込む

モジュールの中でインジケーターや描画のタイプを登録するには、チャートに対応するモジュールが必要です。`install` が受け取る `chart` にはコアの型しかないので、あるモジュールの API を使うときは、そのモジュールを持つチャートとして型を付けます。

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

`install` はチャートがオプションを使う前に実行されるので、作成時のオプションでもモジュールが登録したタイプを使えます。たとえば、メインシリーズにカスタムシリーズをそのまま使えます。

```ts no-check
createChart(container, {
  modules: [myToolkit],
  mainSeries: { type: 'dots' } // 'dots' は myToolkit が登録
});
```

## オプション、イベント、レイアウト

モジュールは SDK のモジュールと同じように、チャートのオプションに独自のセクションを加え、独自のイベントを発生させ、`saveState()` が保存するレイアウトに独自の内容を保存できます。これらを使うには、モジュールが加えるものを型で書き、`createModule` の型パラメーターとして渡します。

```ts
import { createChart, createModule } from '@kumochart-sdk/core';

interface Range {
  from: number;
  to: number;
}

interface BandTypes {
  /** チャートの新しい API */
  api: { band: { set(range: Range | null): void } };
  /** オプションの 1 セクション：options.band */
  options: { band: { opacity: number } };
  /** モジュールのイベント */
  events: { bandChange: { range: Range | null } };
  /** 保存するレイアウトの一部：saveState().band */
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

### オプション

`options` の `key` は、チャートのオプションでのセクション名です。作成時や `applyOptions()` で渡したこのセクションは `defaults()` にマージされ、`validate()` でチェックされます。`validate()` がエラーを投げると、その設定では何も変わりません。モジュールは `context.options()` でセクションの現在の値を読み、`chart.options()` にも含まれます。`options` を宣言していないモジュールが `context.options()` を呼ぶとエラーになります。

### イベント

`context.emit(名前, イベント)` でモジュールのイベントを発生させると、チャートの `chart.on()` で受け取れ、SDK のイベントと同じく型が付きます。API 呼び出しの中で発生させたイベントは、チャートのイベントと同じく、呼び出しが終わってから届きます。

### オプションの変化に追従する

チャートはオプションを設定するたびに（`applyOptions()`、および `loadState()` がメインシリーズのタイプを設定するとき）`optionsChange` を発生させ、設定後の `options` と設定前の `previous` を渡します。モジュールは関心のある項目を比べれば、変わったかどうかが分かります。たとえばメインシリーズのタイプが変わったとき：

```ts
chart.on('optionsChange', ({ options, previous }) => {
  if (options.mainSeries.type !== previous.mainSeries.type) {
    // メインシリーズのタイプが変わった
  }
});
```

### レイアウトに保存する

`context.keepState()` を使うと、`saveState()` が `save()` の結果を `key` の下に保存します。`loadState()` はまず `read()` でこの部分をチェックし（エラーを投げると読み込み全体が失敗し、チャートは何も変わりません）、すべての部分が通ってから `load()` を呼びます。読み込むレイアウトにこの部分がないとき（このモジュールを入れる前に保存したものなど）、`load()` は `null` を受け取ります。`key` はチャート自身が保存するもの（`view`、`panes` など）や、ほかのモジュールのものと重複してはいけません。

## 実行順序

- SDK のモジュールが先に組み込まれ、そのあと `modules` に並べた順に、各カスタムモジュールの `install` が実行されます。
- `install` の中で投げたエラーは `createChart()` を失敗させ、作りかけのチャートは後片付けされます。
- 1 つのチャートの中でモジュール名は重複できません。`chart.modules()` はすべてのモジュールの名前を返します。

## パッケージにして公開する

モジュールはただの関数なので、自分の npm パッケージに入れられます。`@kumochart-sdk/core` を `peerDependencies` にしておけば、使う人は SDK を 1 つだけインストールし、あなたのモジュールと自分のチャートでそれを共有できます。

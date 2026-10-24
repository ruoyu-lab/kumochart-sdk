# インジケーター

インジケーターモジュールには 50 種類のインジケーターがあり、移動平均、MACD、RSI から一目均衡表、VWAP までそろっています。世界的に広く使われているインジケーターは、計算方法もデフォルトのパラメーターも国際的に一般的なものと同じです。KDJ や BIAS のように中国でよく使われるインジケーターは、中国で広く使われているソフトの計算式に従います。

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'BOLL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

## 読み込み

```ts
import { indicators, allIndicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators(allIndicators)] }); // すべて
createChart(container, { modules: [indicators([MA, MACD, RSI])] }); // この数種類だけ
```

## 追加

```ts
const id = chart.indicators.add({ type: 'RSI' });
```

<!-- code-prelude
declare const id: string;
declare const userInput: import('@kumochart-sdk/core/indicators').IndicatorInput;
-->

`add()` はインジケーターの id を返します。指定した `id`、またはチャートが種類ごとに振った番号（`rsi-1` など）です。書かなかった設定にはそのインジケーターのデフォルト値が使われるので、変えたいものだけを書きます。

```ts
chart.indicators.add({
  type: 'MA',
  params: { periods: [20, 60, 120] }, // パラメーター
  source: 'hlc3', // 計算に使う価格。デフォルトは終値
  pane: 'main', // 描くペイン：'main'、'new'（新しいペインを開く）、または既存のペインの id
  scale: 'right', // ペインのどの価格軸を使うか
  colors: { ma20: '#e8b04a' }, // 出力ごとに色を変える
  styles: { ma120: { lineWidth: 2, lineStyle: 'dashed' } }, // 出力ごとに線の太さや種類を変える、または非表示にする
  levels: [], // 基準線。RSI の 70、30 など。[] なら描かない
  visible: true
});
```

移動平均のようにメインペインに重ねるインジケーターはデフォルトで `pane: 'main'` になり、MACD や RSI のようなものはデフォルトで専用のペインを開きます。[ペイン](panes.md)を参照してください。

## 変更と削除

```ts
chart.indicators.update(id, { params: { period: 21 } });
chart.indicators.update(id, { colors: { rsi: null } }); // null でデフォルトの色に戻す
chart.indicators.update(id, { levels: null }); // デフォルトの基準線に戻す
chart.indicators.update(id, { visible: false }); // 非表示
chart.indicators.update(id, { pane: 'new' }); // 専用のペインに移す。'main' でメインペインに戻す

chart.indicators.remove(id);
chart.indicators.list(); // すべてのインジケーター
chart.indicators.get(id);
chart.indicators.set([{ type: 'MA' }, { type: 'RSI' }]); // まとめて置き換える
chart.indicators.clear(); // すべて削除
```

[アラート](alerts.md)が監視しているインジケーターは、そのままでは削除できません。先にアラートを削除してください。`set()` で置き換えるときや `clear()` で消すときも同じです。

## 値を読む

```ts
chart.indicators.valuesAt(id); // 最新の足の値
chart.indicators.valuesAt(id, 120); // 120 本目の足の値
// [{ key: 'rsi', label: 'RSI', value: 63.2, text: '63.20', color: '#…' }, …]
```

凡例に表示されるものと同じです。`text` はインジケーターの小数点以下の桁数で整形済みの文字列、`color` はそのラインの色です。ある足でそのラインに値がないとき（たとえば RSI の計算に必要な本数の足がまだそろっていないとき）、`value` は `null` になります。

## インジケーターからインジケーターを計算する

`source` には別のインジケーターのラインも指定できます。たとえば RSI の EMA は次のように書きます。

```ts
const rsiId = chart.indicators.add({ type: 'RSI' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: rsiId, key: 'rsi' },
  pane: rsiId // RSI と同じペインに描く
});
```

`key` を書かなければ、そのインジケーターの最初のラインを使います。ほかのインジケーターに使われているインジケーターは、先に削除することはできません。

## 別の時間足で計算する

`timeframe` を指定すると、インジケーターをチャートより長い時間足で計算します。たとえば 5 分足のチャートに 1 時間足の移動平均線を表示できます。

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('5m');

chart.indicators.add({ type: 'MA', params: { periods: [20] }, timeframe: '1h' }); // 1 時間足の 20 本移動平均
chart.indicators.add({ type: 'MA', params: { periods: [20] } }); // 5 分足の 20 本移動平均
```

インジケーターが使う 1 時間足は、チャートの元の足から取引カレンダーに従って合成され、[時間足を切り替える](timeframes.md#時間足を切り替える)ときに合成される足と同じです。リアルタイムデータ、過去に読み込んだ履歴、カレンダーの変更、[リプレイ](replay.md)にも追従します。同じ時間足のインジケーターは 1 組の足を共有します。

**大きい時間足の確定を待つ**：チャートの各足に表示されるのは、その足が終わるまでに確定した最後の 1 時間足の値です。1 時間足は次の 1 時間足が始まった時点で確定するので、値は各 1 時間の最後の 5 分足で変わり、階段状に描かれます。こうして過去のどの足も、その時点でまだなかったデータを使いません。例外は最新の足で、まだ確定していない 1 時間足の値をリアルタイムに表示します。足は次の足が始まる時点で終わるものとして扱うので、時間足が割り切れない場合（3 分足チャート上の 5 分足インジケーター）や、週末・休場をまたぐ場合も同じ規則です。

**計算できないときはチャートの足で計算する**：チャートの時間足がインジケーターの時間足より短くないとき（日足チャート上の 1 時間足インジケーターなど）、元の足からその時間足を合成できないとき（[合成できる時間足](timeframes.md#合成できる時間足)を参照）、または時間に沿わない足を表示しているとき（練行足など。[チャートタイプ](chart-types.md)を参照）は、`timeframe` を指定しなかった場合と同じくチャートの足で計算します。エラーにはならず、消えることもありません。計算できるようになれば自分の時間足に戻ります。平均足のように 1 本ずつ変換するものは影響しません。長さを比べるとき、秒・分・時間は実際の長さで、1 日は 24 時間、1 週は 7 日、1 か月は 30 日として数えます。

`offset` はインジケーター自身の時間足の本数でずらします。たとえば 1 時間足の一目均衡表の先行スパンは 1 時間足 26 本分右に描かれます。同じ大きい時間足の足に付くマーカーは 1 回だけ描きます。凡例ではパラメーターのあとに時間足を書きます（`MA 20 1h`）。[保存した状態](state.md)にも含まれます。

```ts
chart.indicators.get(id)?.timeframe; // '1h'。指定がなければ null
chart.indicators.update(id, { timeframe: '4h' }); // 4 時間足に変える
chart.indicators.update(id, { timeframe: null }); // チャートの足に戻す
```

別のインジケーターから計算するインジケーターは、そのインジケーターの時間足でその値から計算し、表示の規則も同じです。

```ts
const hourlyRsi = chart.indicators.add({ type: 'RSI', timeframe: '1h' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: hourlyRsi }, // これも 1 時間足で計算する
  pane: hourlyRsi
});
```

これに別の `timeframe` を指定するとエラーになります。[チャートなしで計算する](#チャートなしで計算する) `computeIndicator()` は変わりません。渡された足の時間足で計算します。

## 設定画面を作る

インジケーターにどんなパラメーターがあり、それぞれがどの範囲を取るかは、定義から読み取れます。

```ts
const definition = chart.indicators.definition('RSI');
definition?.params; // { period: { default: 14, min: 1, max: 2000, integer: true, label: 'RSI Length' }, … }
```

`options` を持つパラメーターはその中の値しか取れないので（移動平均の種類など）、画面ではドロップダウンにします。ユーザーが入力した設定は、先に `checkIndicatorInput()` でチェックしてください。正しくなければ `add()` と同じエラーを投げます。

```ts
import { checkIndicatorInput } from '@kumochart-sdk/core/indicators';

checkIndicatorInput(chart.indicators.definition('RSI')!, userInput);
```

## 多言語

インジケーターの定義は、名前やラベルを英語で書いています。凡例と `valuesAt()` をチャートの `locale` に合わせて中国語・日本語・韓国語で表示するには、SDK に付いている訳語 `indicatorTexts` をモジュールに渡します。

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

createChart(container, {
  modules: [indicators(allIndicators, { texts: [indicatorTexts] })],
  locale: 'zh-CN'
});
```

渡さなければ英語のままで、`indicatorTexts` もバンドルに含まれません。`MA` や `RSI` のような略号はどの言語でも同じなので訳しません。

設定画面を作るときは、`chart.indicators.title(type)` がインジケーターの正式名を、`chart.indicators.label(text)` が定義のラベル（ライン、パラメーター、選択肢の名前）をチャートの言語で返します。

```ts
chart.indicators.title('BOLL'); // '布林带'
chart.indicators.label('Period'); // '周期'
```

訳語は言語ごと、英語の原文ごとに書き、後から渡したものが優先されます。独自のインジケーターを多言語にしたいときや、いくつかの言葉を変えたいときは、もう 1 つ渡します。数字で終わるラベル（`Upper Band #2` など）に専用の訳語がなければ、`Upper Band #{n}` の訳語の `{n}` をその数字に置き換えて使います。

```ts
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

indicators(allIndicators, {
  texts: [indicatorTexts, { zh: { labels: { Upper: '上沿' } } }]
});
```

チャートがないとき（チャートより先に設定画面を開く場合など）は、`indicatorLanguage(texts, locale)` が同じ規則で `title()` と `label()` を返します。

## 組み込みインジケーター

下の表の「出力」は各ラインの key で、値を読むとき、色を設定するとき、[アラート](alerts.md)を設定するときに使います。移動平均のように一度に複数の期間を指定できるものは、出力の key に期間が付きます（例：`ma20`）。

### 移動平均

| タイプ      | 名前                     | デフォルトのパラメーター        | 出力                   |
| ----------- | ------------------------ | ------------------------------- | ---------------------- |
| `MA`        | 単純移動平均             | 期間 9                          | `ma9`                  |
| `EMA`       | 指数平滑移動平均         | 期間 9                          | `ema9`                 |
| `SMMA`      | 平滑移動平均             | 期間 7                          | `smma7`                |
| `WMA`       | 加重移動平均             | 期間 9                          | `wma9`                 |
| `HMA`       | ハル移動平均             | 期間 9                          | `hma9`                 |
| `VWMA`      | 出来高加重移動平均       | 期間 20                         | `vwma20`               |
| `ALMA`      | アルノー・ルグー移動平均 | 9、オフセット 0.85、σ 6         | `alma`                 |
| `KAMA`      | カウフマン適応型移動平均 | 10、短期 2、長期 30             | `kama`                 |
| `ALLIGATOR` | アリゲーター             | 13・8・5、右へ 8・5・3 本ずらす | `jaw`、`teeth`、`lips` |
| `BBI`       | ブル・ベア指数（中国式） | 3・6・12・24                    | `bbi`                  |

### チャネル

| タイプ     | 名前               | デフォルトのパラメーター                      | 出力                                                                        |
| ---------- | ------------------ | --------------------------------------------- | --------------------------------------------------------------------------- |
| `BOLL`     | ボリンジャーバンド | 20、SMA、標準偏差の 2 倍                      | `basis`、`upper`、`lower`                                                   |
| `KC`       | ケルトナーチャネル | 20、EMA、ATR（10）の 2 倍                     | `upper`、`basis`、`lower`                                                   |
| `DC`       | ドンチャンチャネル | 20                                            | `basis`、`upper`、`lower`                                                   |
| `ICHIMOKU` | 一目均衡表         | 9・26・52、ずらし 26                          | `conversionLine`、`baseLine`、`laggingSpan`、`leadingSpanA`、`leadingSpanB` |
| `VWAP`     | 出来高加重平均価格 | 取引日ごとに計算し直す、標準偏差 1 倍のバンド | `vwap`、`upperBand1`、`lowerBand1`                                          |

### トレンドとストップ

| タイプ       | 名前                     | デフォルトのパラメーター | 出力                       |
| ------------ | ------------------------ | ------------------------ | -------------------------- |
| `SAR`        | パラボリック SAR         | 0.02、0.02、0.2          | `parabolicSar`             |
| `SUPERTREND` | スーパートレンド         | 10、ATR の 3 倍          | `upTrend`、`downTrend`     |
| `CHANDELIER` | シャンデリア・エグジット | 22、ATR 22、3 倍         | `longExit`、`shortExit`    |
| `DMI`        | 方向性指数               | ADX の平滑化 14、DI 14   | `adx`、`plus`、`minus`     |
| `AROON`      | アルーン                 | 14                       | `aroonUp`、`aroonDown`     |
| `FRACTALS`   | ウィリアムズ・フラクタル | 2                        | `downFractal`、`upFractal` |

### オシレーター

| タイプ     | 名前                             | デフォルトのパラメーター                  | 出力                              |
| ---------- | -------------------------------- | ----------------------------------------- | --------------------------------- |
| `MACD`     | 移動平均収束拡散法               | 12、26、9                                 | `macd`、`signalLine`、`histogram` |
| `RSI`      | 相対力指数                       | 14、期間 14 の SMA 付き                   | `rsi`、`rsiBasedMa`               |
| `STOCH`    | ストキャスティクス               | 14、%K の平滑化 1、%D の平滑化 3          | `k`、`d`                          |
| `STOCHRSI` | ストキャスティクス RSI           | %K 3、%D 3、RSI 14、ストキャスティクス 14 | `k`、`d`                          |
| `CCI`      | 商品チャネル指数                 | 20（hlc3）、期間 14 の SMA 付き           | `cci`、`cciBasedMa`               |
| `WR`       | ウィリアムズ %R                  | 14                                        | `wr14`                            |
| `ROC`      | 変化率                           | 9                                         | `roc`                             |
| `MTM`      | モメンタム                       | 10                                        | `mom`                             |
| `TRIX`     | 三重指数平滑移動平均             | 18                                        | `trix`                            |
| `DPO`      | トレンド除去価格オシレーター     | 21                                        | `dpo`                             |
| `FISHER`   | フィッシャー・トランスフォーム   | 9（hl2）                                  | `fisher`、`trigger`               |
| `KDJ`      | ストキャスティクス KDJ（中国式） | 9、3、3                                   | `k`、`d`、`j`                     |
| `BIAS`     | 移動平均乖離率（中国式）         | 6・12・24                                 | `bias6`、`bias12`、`bias24`       |
| `PSY`      | サイコロジカルライン（中国式）   | 12、6                                     | `psy`、`psyma`                    |
| `BRAR`     | 人気・意欲指標（中国式）         | 26                                        | `br`、`ar`                        |
| `DMA`      | 移動平均の差（中国式）           | 10、50、10                                | `dif`、`difma`                    |

### 出来高

| タイプ | 名前                       | デフォルトのパラメーター | 出力              |
| ------ | -------------------------- | ------------------------ | ----------------- |
| `VOL`  | 出来高                     | 移動平均なし             | `volume`          |
| `OBV`  | オン・バランス・ボリューム | 移動平均なし             | `onBalanceVolume` |
| `MFI`  | マネーフローインデックス   | 14                       | `mf`              |
| `CMF`  | チャイキン・マネーフロー   | 20                       | `cmf`             |
| `EMV`  | イーズ・オブ・ムーブメント | 14、除数 10000           | `eom`             |
| `VR`   | ボリュームレシオ（中国式） | 26、6                    | `vr`、`mavr`      |

### ボラティリティ

| タイプ | 名前                         | デフォルトのパラメーター | 出力   |
| ------ | ---------------------------- | ------------------------ | ------ |
| `ATR`  | アベレージ・トゥルー・レンジ | 14、RMA                  | `atr`  |
| `STD`  | 標準偏差                     | 20                       | `std`  |
| `CHOP` | チョピネス・インデックス     | 14                       | `chop` |
| `ADR`  | 平均日中レンジ               | 14                       | `adr`  |

### 期間とセッション

| タイプ     | 名前                     | デフォルトのパラメーター                             | 出力                                          |
| ---------- | ------------------------ | ---------------------------------------------------- | --------------------------------------------- |
| `PIVOTS`   | ピボットポイント         | トラディショナル、期間はチャートに合わせて自動で選ぶ | `p`、`r1`、`s1` … `r5`、`s5`                  |
| `PREVHLC`  | 前期間の高値・安値・終値 | 日                                                   | `high`、`low`、`close`                        |
| `SESSIONS` | 取引セッション           | 東京・ロンドン・ニューヨーク                         | `tokyoHigh`、`londonHigh`、`newYorkHigh` など |

ピボットポイントの期間は、既定ではチャートの時間足に合わせて選びます。15 分足以下なら日、それ以外の日中足なら週、日足なら月、週足・月足なら年です。`data.set()` に `interval` を渡さなかったときは日です。

各インジケーターのすべてのパラメーターと出力は、`chart.indicators.definition(type)` で調べるか、[API リファレンス](../api.md#indicators)を見てください。

## 中国で広く使われているソフトとの違い

中国で広く使われているソフトに慣れている場合は、次の点に注意してください。

- **MACD**：ヒストグラムは MACD ラインからシグナルラインを引いた値で、2 倍はしません。3 本のラインは `macd`、`signalLine`、`histogram` です。
- **RSI**：デフォルトは期間 14 のライン 1 本で、基準線は 70 と 30、さらに期間 14 の移動平均が付きます。平滑化には Wilder の方法を使い、最初の 14 本は単純平均から始めます。
- **WR**：-100 から 0 の範囲を取り、0 が最も高い位置です。
- **移動平均**：MA と EMA はデフォルトで期間 9 のライン 1 本です。何本も必要なら `periods: [5, 10, 20, 30]` を指定します。EMA の最初の値は、最初の数本の単純平均です。
- **出来高**：デフォルトでは移動平均が付きません。必要なら `periods: [5, 10]` を指定します。

KDJ、BIAS、BRAR、PSY、DMA、VR、BBI は中国でよく使われるインジケーターで、計算方法は中国で広く使われているソフトと同じです。

## チャートなしで計算する

```ts
import { computeIndicator, RSI } from '@kumochart-sdk/core/indicators';

const { rsi } = computeIndicator(RSI, bars);
// rsi[i] は i 本目の足の値。チャート上で計算した値と同じ
```

リアルタイムデータに合わせて 1 本ずつ計算するには `createIndicatorCalculator()` を使います。どちらも渡したデータだけに依存するので、Node.js でも使えます。たとえばサーバーでアラートを判定するのに使えます。VWAP やピボットポイントのように取引日や時間足に沿って計算するインジケーターは、チャートの取引カレンダーと時間足も渡すと、チャートと同じ値になります：`{ calendar, interval: '15m' }`。

あるインジケーターを別のインジケーターから計算する（たとえば RSI の EMA）ときは、`nextOf(bar, value)` でその足の別のインジケーターの値を渡します。チャートで `source` に別のインジケーターを指定したときと同じ値になります。

```ts
import { createIndicatorCalculator, EMA, RSI } from '@kumochart-sdk/core/indicators';

const rsi = createIndicatorCalculator(RSI);
const ema = createIndicatorCalculator(EMA, { params: { periods: [5] } });

for (const bar of bars) {
  const [value] = rsi.next(bar);
  const [smoothed] = ema.nextOf(bar, value); // RSI にまだ値がない足（NaN）は、チャートと同じく飛ばされます
}
```

独自のインジケーターを作るには、[カスタムインジケーター](custom-indicators.md)を参照してください。

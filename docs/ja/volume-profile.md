# 価格帯別出来高

<!-- code-prelude
declare function showPointOfControl(price: number): void;
-->

価格帯別出来高は、出来高を価格ごとに並べたものです。1 行が 1 つの価格帯で、横棒が長いほどその価格帯で多く約定しています。出来高がいちばん多い行が POC（ポイント・オブ・コントロール）で、線で示します。その周りで合わせて出来高の 70% を占める行がバリューエリアで、色が濃くなります。

`@kumochart-sdk/core/volume-profile` に入っていて、3 種類あります。画面に表示されている足のプロファイル、取引日ごとのプロファイル、そしてユーザーが期間を囲んで描く固定範囲の価格帯別出来高（描画ツールの一種）です。

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

// 画面に表示されている足のプロファイルを右端に。スクロールやズームに合わせて変わる
chart.volumeProfiles.add({ mode: 'visible' });

// さらにユーザーに期間を囲んでもらう：2 回クリックする
chart.drawings.startTool('fixed-range-volume-profile');
```

## 表示範囲と取引日

```ts
import { volumeProfiles } from '@kumochart-sdk/core/volume-profile';

createChart(container, { modules: [volumeProfiles()] });

const id = chart.volumeProfiles.add({ mode: 'visible' }); // id を返す
chart.volumeProfiles.add({ mode: 'session' }); // 取引日ごとに 1 つ。上のものと同時に表示できる

chart.volumeProfiles.update(id, { rows: 48, placement: 'left' });
chart.volumeProfiles.get(id); // { id, mode, rows, valueArea, width, placement, ... }
chart.volumeProfiles.list(); // すべて。追加した順
chart.volumeProfiles.remove(id);
chart.volumeProfiles.set([{ mode: 'session' }]); // まとめて置き換える
chart.volumeProfiles.clear(); // すべて削除
```

| オプション  | デフォルト                    | 説明                                                                                                                                   |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`      | 必須                          | `visible`：画面に表示されている足のプロファイルを 1 つ、描画領域の端に沿って描く。`session`：取引日ごとに 1 つ、その日の始まりから描く |
| `rows`      | 24                            | 価格を何行に分けるか。1 から 1000                                                                                                      |
| `valueArea` | 0.7                           | バリューエリアが出来高全体に占める割合                                                                                                 |
| `width`     | 0.25 / 0.7                    | いちばん長い行の長さ。描画領域の幅（`visible`）またはその日の幅（`session`）に対する割合                                               |
| `placement` | `right`                       | `visible` のプロファイルがどちらの端から伸びるか。`left` か `right`                                                                    |
| `upColor`   | テーマの `up`                 | 終値が始値以上の足の出来高                                                                                                             |
| `downColor` | テーマの `down`               | 終値が始値より低い足の出来高                                                                                                           |
| `pocColor`  | テーマの `palette` の最初の色 | POC の線                                                                                                                               |
| `visible`   | `true`                        | 表示するかどうか                                                                                                                       |
| `id`        | 自動生成                      | `volume-profile-1` のような id。削除したものと重なることはない                                                                         |

`get()` と `list()` が返す `width` と 3 つの色は、指定していなければ `null` で、デフォルトを使うことを表します。そのため `update()` で `mode` を変えると、指定していない `width` も新しいモードのデフォルトに変わります。

プロファイルはメインペインのローソク足の下に描かれ、価格スケールの範囲には影響しません。取引日はチャートの `calendar` オプションに従い、日足と同じように分かれます。夜間取引は翌取引日に含まれ、取引セッション外の足はその直前の取引日に含まれます。[時間足と取引カレンダー](timeframes.md)を参照してください。

### 元データから計算する

プロファイルは、表示されている足ではなく**元データ**から計算します。1 分足のデータで日足を見ているとき、各日の出来高は日足全体に均されるのではなく、実際に約定した価格に置かれます。元データが細かいほど、プロファイルは正確になります。

リプレイ中は、すでに表示された足だけを数えます。計算したプロファイルはキャッシュされ、データか画面に表示されている足が変わったときだけ計算し直します。取引日ごとのプロファイルを左右にスクロールしても、画面に残っている日は計算し直しません。

`chart.saveState()` はすべてのプロファイルを保存し、`loadState()` で復元します。[保存と復元](state.md)を参照してください。

## 固定範囲

固定範囲の価格帯別出来高は描画ツールの一種です。ユーザーが 2 回クリックして始まりと終わりの時間を決めると、その間の足のプロファイルが枠の中に描かれます。枠の高さは、それらの足の高値と安値で決まります。ほかの描画と同じように、ドラッグ、幅の変更、複製、元に戻すができ、描画と一緒に保存されます。

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { fixedRangeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

createChart(container, {
  modules: [drawings([...allDrawings, fixedRangeVolumeProfile({ rows: 32 })])]
});

chart.drawings.startTool('fixed-range-volume-profile');
```

`fixedRangeVolumeProfile()` のオプションは、この種類の描画すべてに効きます。`rows`、`valueArea`、`width`（いちばん長い行が枠の幅に占める割合。デフォルト 0.6）、`upColor`、`downColor`、`pocColor` です。描画ごとのスタイルは `color` だけで、枠の色です。`allModules()` にはこの描画ツールがすでに含まれています。

これも元データから計算し、リプレイ中はすでに表示された足だけを数えます。リプレイがまだその期間に達していないときなど、枠の中に出来高がなければ、枠は 2 つのアンカーの価格で描かれ、選択やドラッグはそのままできます。

## チャートなしで計算する

`computeVolumeProfile(bars, from, to, options)` はこれらの裏にある計算で、単独でも使えます。たとえば自分のパネルに POC の価格を表示したり、Node.js で計算したりできます。`bars` にはチャートの `chart.data.source` や `chart.data.bars` も、自分のローソク足の配列も渡せます。`from` と `to` はその中のインデックスです（`to` は含まない）。

```ts
import { computeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

const { source } = chart.data;
const from = source.lowerBound(Date.now() - 86_400_000); // 直近 1 日
const profile = computeVolumeProfile(source, from, source.length, { rows: 50 });

if (profile) {
  const poc = profile.rows[profile.poc]!;
  showPointOfControl((poc.low + poc.high) / 2);
}
```

結果は次のとおりです。

```ts
interface VolumeProfileData {
  rows: { low: number; high: number; up: number; down: number }[]; // 最安値から上へ
  total: number; // 出来高全体
  poc: number; // POC の行のインデックス
  valueArea: { low: number; high: number }; // バリューエリアの最初と最後の行のインデックス
}
```

各足の出来高は、安値から高値までの範囲に均等に割り振られます。終値が始値以上の足は `up` に、それ以外は `down` に入ります。足に出来高がなければ `null` を返します。

### POC とバリューエリア

- POC：出来高がいちばん多い行です。同じだけの行がいくつかあれば、真ん中にいちばん近い行を選び、同じだけ近ければ上の行を選びます。
- バリューエリア：POC から始めて、バリューエリアのすぐ上の行とすぐ下の行を比べ、出来高の多いほうを加えます。同じなら POC に近いほう、同じだけ近ければ上のほうを加えます。ある行を加えると `valueArea` を超えるところで止まるので、バリューエリアの出来高がこの割合を超えることはありません。

この 2 つの規則も単独で使えます。各行の出来高を最安値から上へ順に渡します。

```ts
import { pointOfControl, valueAreaOf } from '@kumochart-sdk/core/volume-profile';

const volumes = [10, 25, 40, 25];
const poc = pointOfControl(volumes); // 2
valueAreaOf(volumes, poc, 0.7); // { low: 2, high: 3 }：40 + 25 = 65。もう 1 行加えると 90 で、70 を超える
```

約定など別のもののプロファイルを自分で計算し、チャートのプロファイルと合わせたいときは、同じ分け方を使います。`volumeProfileGrid(low, high, rows)` は `low` から `high` までの行（最も低い行の `bottom`、各行の高さ `step`、行数 `count`）を返し、`computeVolumeProfile` がローソク足の価格を分けるのとまったく同じです。`checkVolumeProfileOptions(options, label)` は同じ規則で `rows` と `valueArea` をチェックし、デフォルト値を補います。

```ts
import { checkVolumeProfileOptions, volumeProfileGrid } from '@kumochart-sdk/core/volume-profile';

const { rows } = checkVolumeProfileOptions({ rows: 4 }, 'options');
volumeProfileGrid(90, 110, rows); // { bottom: 90, step: 5, count: 4 }
```

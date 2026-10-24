# 成交量分布

<!-- code-prelude
declare function showPointOfControl(price: number): void;
-->

成交量分布把成交量按价格摊开：每一行是一段价格，横条越长，这段价格上成交得越多。成交最多的一行是控制点（POC），用一条线标出；围绕它、合起来占总成交量 70% 的几行是价值区，颜色更深。

它在 `@kumochart-sdk/core/volume-profile` 里，有三种：屏幕上这些 K 线的一个分布、每个交易日一个分布，以及用户自己框出一段时间的固定范围分布（一种画线）。

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

// 屏幕上这些 K 线的分布，贴着右边；拖动、缩放时跟着变
chart.volumeProfiles.add({ mode: 'visible' });

// 再让用户自己框一段：点两下
chart.drawings.startTool('fixed-range-volume-profile');
```

## 可见范围和交易日

```ts
import { volumeProfiles } from '@kumochart-sdk/core/volume-profile';

createChart(container, { modules: [volumeProfiles()] });

const id = chart.volumeProfiles.add({ mode: 'visible' }); // 返回 id
chart.volumeProfiles.add({ mode: 'session' }); // 每个交易日一个，可以和上面的同时显示

chart.volumeProfiles.update(id, { rows: 48, placement: 'left' });
chart.volumeProfiles.get(id); // { id, mode, rows, valueArea, width, placement, ... }
chart.volumeProfiles.list(); // 全部，按添加的顺序
chart.volumeProfiles.remove(id);
chart.volumeProfiles.set([{ mode: 'session' }]); // 整批替换
chart.volumeProfiles.clear(); // 全部去掉
```

| 选项        | 默认                    | 说明                                                                                            |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `mode`      | 必填                    | `visible`：屏幕上这些 K 线的一个分布，贴着绘图区的一边；`session`：每个交易日一个，从当天开始画 |
| `rows`      | 24                      | 价格分成几行，1 到 1000                                                                         |
| `valueArea` | 0.7                     | 价值区占总成交量的比例                                                                          |
| `width`     | 0.25 / 0.7              | 最长一行有多长：占绘图区宽度（`visible`）或当天宽度（`session`）的比例                          |
| `placement` | `right`                 | `visible` 的分布从哪一边往里长：`left` 或 `right`                                               |
| `upColor`   | 主题的 `up`             | 收盘价不低于开盘价的 K 线的成交量                                                               |
| `downColor` | 主题的 `down`           | 收盘价低于开盘价的 K 线的成交量                                                                 |
| `pocColor`  | 主题 `palette` 第一个色 | 控制点的线                                                                                      |
| `visible`   | `true`                  | 是否显示                                                                                        |
| `id`        | 自动生成                | 像 `volume-profile-1`，不会和删掉的重复                                                         |

`get()`、`list()` 返回的 `width` 和三个颜色，没设时是 `null`，表示用默认值；所以 `update()` 换了 `mode`，没设的 `width` 也跟着换成新模式的默认值。

分布画在主图的 K 线下面，不影响价格坐标的范围。交易日按图表的 `calendar` 选项划分，和日线一样：夜盘算到下一个交易日；交易时段之外的 K 线算到它前面那个交易日。见[周期和交易日历](timeframes.md)。

### 用的是原始数据

分布按**原始数据**算，不按显示的 K 线算：用 1 分钟数据看日线时，每天的成交量落在它实际成交的价格上，而不是摊在整根日线上。原始数据越细，分布越准。

回放时只算已经放出来的 K 线。算好的分布会缓存，数据或屏幕上的 K 线变了才重算；按交易日的分布在左右拖动时，还在屏幕上的那几天也不重算。

`chart.saveState()` 会存下全部分布，`loadState()` 时恢复，见[保存和恢复](state.md)。

## 固定范围

固定范围成交量分布是一种画线：用户点两下定下起止时间，中间这些 K 线的分布画在一个框里，框的高度由这些 K 线的最高价和最低价决定。它和别的画线一样可以拖动、改宽度、复制、撤销，和画线一起保存。

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { fixedRangeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

createChart(container, {
  modules: [drawings([...allDrawings, fixedRangeVolumeProfile({ rows: 32 })])]
});

chart.drawings.startTool('fixed-range-volume-profile');
```

`fixedRangeVolumeProfile()` 的选项对这种画线的每一条都有效：`rows`、`valueArea`、`width`（最长一行占框宽的比例，默认 0.6）、`upColor`、`downColor`、`pocColor`。每条画线自己的样式只有 `color`，是框的颜色。`allModules()` 已经带上了这种画线。

它同样按原始数据算，回放时只算已经放出来的 K 线。框里没有成交量时，比如回放还没放到这一段，框按两个锚点的价格画，仍然可以选中、拖动。

## 不用图表计算

`computeVolumeProfile(bars, from, to, options)` 是背后的计算，可以单独用，比如在自己的面板里显示控制点的价格，或者在 Node.js 里算。`bars` 可以是图表的 `chart.data.source`、`chart.data.bars`，也可以是你自己的 K 线数组，`from`、`to` 是其中的序号（不含 `to`）：

```ts
import { computeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

const { source } = chart.data;
const from = source.lowerBound(Date.now() - 86_400_000); // 最近一天
const profile = computeVolumeProfile(source, from, source.length, { rows: 50 });

if (profile) {
  const poc = profile.rows[profile.poc]!;
  showPointOfControl((poc.low + poc.high) / 2);
}
```

结果是：

```ts
interface VolumeProfileData {
  rows: { low: number; high: number; up: number; down: number }[]; // 从最低价往上
  total: number; // 全部成交量
  poc: number; // 控制点那一行的序号
  valueArea: { low: number; high: number }; // 价值区第一行和最后一行的序号
}
```

每根 K 线的成交量平均摊在它从最低价到最高价的范围里；收盘价不低于开盘价的算进 `up`，否则算进 `down`。这些 K 线没有成交量时返回 `null`。

### 控制点和价值区

- 控制点：成交量最大的一行。几行一样大时，取离中间最近的一行；一样近时取上面那行。
- 价值区：从控制点开始，看价值区上面一行和下面一行，成交量大的那行并进来；一样大时并离控制点近的，一样近时并上面的。某一行并进来会超过 `valueArea` 时就停下，所以价值区的成交量不会超过这个比例。

这两条规则也单独提供，传入每一行的成交量，从最低价往上：

```ts
import { pointOfControl, valueAreaOf } from '@kumochart-sdk/core/volume-profile';

const volumes = [10, 25, 40, 25];
const poc = pointOfControl(volumes); // 2
valueAreaOf(volumes, poc, 0.7); // { low: 2, high: 3 }：40 + 25 = 65，再并一行就是 90，超过 70
```

自己算别的东西的分布时（比如按成交逐笔算），想和图上的分布对得上，用同样的划分和选项：`volumeProfileGrid(low, high, rows)` 给出从 `low` 到 `high` 的各行（最低一行的 `bottom`、每行的高度 `step`、行数 `count`），和 `computeVolumeProfile` 划分 K 线的价格完全一样；`checkVolumeProfileOptions(options, label)` 照同样的规则检查 `rows`、`valueArea` 并补上默认值。

```ts
import { checkVolumeProfileOptions, volumeProfileGrid } from '@kumochart-sdk/core/volume-profile';

const { rows } = checkVolumeProfileOptions({ rows: 4 }, 'options');
volumeProfileGrid(90, 110, rows); // { bottom: 90, step: 5, count: 4 }
```

# Volume profile

<!-- code-prelude
declare function showPointOfControl(price: number): void;
-->

A volume profile spreads the volume out by price: each row is a band of prices, and the longer its bar, the more traded there. The row with the most volume is the point of control (POC), marked with a line; the rows around it that hold 70% of the volume together are the value area, in stronger colors.

It is in `@kumochart-sdk/core/volume-profile`, in three kinds: one profile of the bars in view, one for each trading day, and the fixed range volume profile of a span of time the user marks out, which is a drawing.

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

// The profile of the bars in view, along the right edge; it follows scrolling and zooming
chart.volumeProfiles.add({ mode: 'visible' });

// And a span for the user to mark out: two clicks
chart.drawings.startTool('fixed-range-volume-profile');
```

## The bars in view and trading days

```ts
import { volumeProfiles } from '@kumochart-sdk/core/volume-profile';

createChart(container, { modules: [volumeProfiles()] });

const id = chart.volumeProfiles.add({ mode: 'visible' }); // returns the id
chart.volumeProfiles.add({ mode: 'session' }); // one per trading day, shown with the one above

chart.volumeProfiles.update(id, { rows: 48, placement: 'left' });
chart.volumeProfiles.get(id); // { id, mode, rows, valueArea, width, placement, ... }
chart.volumeProfiles.list(); // every one, in the order they were added
chart.volumeProfiles.remove(id);
chart.volumeProfiles.set([{ mode: 'session' }]); // replaces every profile
chart.volumeProfiles.clear(); // removes every profile
```

| Option      | Default                            | What it is                                                                                                            |
| ----------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `mode`      | required                           | `visible`: one profile of the bars in view, along an edge of the plot; `session`: one per trading day, from its start |
| `rows`      | 24                                 | How many rows the prices are divided into, from 1 to 1000                                                             |
| `valueArea` | 0.7                                | The share of the volume in the value area                                                                             |
| `width`     | 0.25 / 0.7                         | How long the longest row is: a share of the plot's width (`visible`) or of the day's (`session`)                      |
| `placement` | `right`                            | The edge a `visible` profile grows from: `left` or `right`                                                            |
| `upColor`   | the theme's `up`                   | The volume of bars that closed at or above their open                                                                 |
| `downColor` | the theme's `down`                 | The volume of bars that closed below their open                                                                       |
| `pocColor`  | the first of the theme's `palette` | The line of the point of control                                                                                      |
| `visible`   | `true`                             | Whether it shows                                                                                                      |
| `id`        | generated                          | Such as `volume-profile-1`, never one a removed profile had                                                           |

In what `get()` and `list()` return, `width` and the three colors are `null` when they were not set, for their defaults; so when `update()` changes the `mode`, a `width` left unset changes to the new mode's default too.

The profiles are painted under the bars of the main pane and leave the price scale's range as it is. Trading days follow the chart's `calendar` option as daily bars do: a night session belongs to the next trading day, and bars outside the sessions to the trading day before them. See [Timeframes and calendars](timeframes.md).

### From the source data

The profiles are computed from the **source data**, not from the bars displayed: on a daily chart of 1-minute data, each day's volume lies at the prices it traded at, rather than spread over the whole daily bar. The finer the source data, the sharper the profile.

While replaying, only the bars replay has revealed count. A profile is kept until the data or the bars in view change; as one per trading day is scrolled, the days still in view are not computed again.

`chart.saveState()` keeps every profile and `loadState()` restores them; see [Save and restore](state.md).

## Fixed range

The fixed range volume profile is a drawing: the user clicks twice to set where it starts and ends in time, and the profile of the bars between is painted in a frame as high as their highest and lowest prices. Like other drawings it can be dragged, widened, copied and undone, and it is saved with the drawings.

```ts
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { fixedRangeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

createChart(container, {
  modules: [drawings([...allDrawings, fixedRangeVolumeProfile({ rows: 32 })])]
});

chart.drawings.startTool('fixed-range-volume-profile');
```

The options of `fixedRangeVolumeProfile()` hold for every drawing of the type: `rows`, `valueArea`, `width` (the longest row as a share of the frame's width, 0.6 by default), `upColor`, `downColor` and `pocColor`. The style of each drawing has `color` alone, the color of the frame. `allModules()` comes with this drawing already.

It is computed from the source data too, and while replaying from the bars revealed. Where the frame holds no volume, as before replay has reached it, the frame spans its two anchors' prices, so it can still be selected and dragged.

## Without a chart

`computeVolumeProfile(bars, from, to, options)` is the computation behind them, to use on its own, for example to show the price of the point of control in a panel of yours, or in Node.js. `bars` are a chart's, `chart.data.source` or `chart.data.bars`, or an array of bars of your own, and `from` and `to` are indices into them (`to` excluded):

```ts
import { computeVolumeProfile } from '@kumochart-sdk/core/volume-profile';

const { source } = chart.data;
const from = source.lowerBound(Date.now() - 86_400_000); // the last day
const profile = computeVolumeProfile(source, from, source.length, { rows: 50 });

if (profile) {
  const poc = profile.rows[profile.poc]!;
  showPointOfControl((poc.low + poc.high) / 2);
}
```

It gives:

```ts
interface VolumeProfileData {
  rows: { low: number; high: number; up: number; down: number }[]; // from the lowest price up
  total: number; // the whole volume
  poc: number; // the index of the point of control's row
  valueArea: { low: number; high: number }; // the indices of the value area's first and last rows
}
```

Each bar's volume is spread evenly over its range from low to high; that of a bar closing at or above its open counts as `up`, otherwise as `down`. Bars without volume give `null`.

### The point of control and the value area

- The point of control: the row with the most volume. Of rows with as much, the one nearest the middle; of two as near, the upper one.
- The value area: from the point of control, the row above the area and the row below it are compared, and the one with more volume joins; on a tie the one nearer the point of control, and of two as near the upper one. It stops at the first row that would take it past `valueArea`, so the value area never holds more than that share.

Both rules are there on their own as well, given the volume of each row from the lowest price up:

```ts
import { pointOfControl, valueAreaOf } from '@kumochart-sdk/core/volume-profile';

const volumes = [10, 25, 40, 25];
const poc = pointOfControl(volumes); // 2
valueAreaOf(volumes, poc, 0.7); // { low: 2, high: 3 }: 40 + 25 = 65, and one row more makes 90, past 70
```

To profile something else, such as trades, so that it matches the profiles on the chart, divide it the same way: `volumeProfileGrid(low, high, rows)` gives the rows from `low` to `high` (the `bottom` of the lowest, the height `step` of each and their `count`), exactly as `computeVolumeProfile` divides the prices of bars; `checkVolumeProfileOptions(options, label)` checks `rows` and `valueArea` by the same rules, with their defaults.

```ts
import { checkVolumeProfileOptions, volumeProfileGrid } from '@kumochart-sdk/core/volume-profile';

const { rows } = checkVolumeProfileOptions({ rows: 4 }, 'options');
volumeProfileGrid(90, 110, rows); // { bottom: 90, step: 5, count: 4 }
```

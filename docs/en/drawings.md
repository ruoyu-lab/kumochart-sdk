# Drawings

<!-- code-prelude
declare const drawingToolbar: { release(type: string): void };
-->

The drawings module has 38 drawing tools: users draw on the chart, and you can draw from code. Drawings sit at a time and a price, so they move with the bars as the timeframe, the zoom and the view change.

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { drawings, allDrawings } from '@kumochart-sdk/core/drawings';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [drawings(allDrawings)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

// A Fibonacci retracement from the low to the high of the last 120 bars
const bars = chart.data.toArray().slice(-120);
const high = bars.reduce((a, b) => (b.high > a.high ? b : a));
const low = bars.reduce((a, b) => (b.low < a.low ? b : a));
chart.drawings.add({
  type: 'fib-retracement',
  points: [
    { time: low.time, price: low.low },
    { time: high.time, price: high.high }
  ]
});

// And a trend line for the user to draw: two clicks
chart.drawings.startTool('trend-line');
```

## Loading

```ts
import {
  drawings,
  allDrawings,
  trendLine,
  horizontalLine,
  fibRetracement
} from '@kumochart-sdk/core/drawings';

createChart(container, { modules: [drawings(allDrawings)] }); // all of them
createChart(container, { modules: [drawings([trendLine, horizontalLine, fibRetracement])] }); // just these
```

## Letting users draw

```ts
chart.drawings.startTool('rectangle');
```

The user clicks each anchor in turn and the drawing is done, which ends the tool; Esc or a right click cancels it. A placed drawing emits `drawingsChange` (`reason: 'create'`), then `toolEnd`:

```ts
chart.on('toolEnd', ({ type, completed }) => {
  drawingToolbar.release(type); // e.g. release the tool's button
});
```

A click where the drawing would draw nothing does not count, and the tool waits for the next one: an anchored VWAP after the last bar, or a regression trend ending on the bar it starts at.

On a touch screen the anchor follows the finger while it presses, shown in the loupe, and is placed where the finger lifts.

The tool's options:

```ts
chart.drawings.startTool('horizontal-line', {
  style: { color: '#e8b04a', lineStyle: 'dashed' }, // the style of this drawing
  continuous: true // stays active for the next one
});

chart.drawings.activeTool(); // the active tool, or null
chart.drawings.cancelTool(); // ends it from code, without toolEnd
```

To have each tool remember the style the user last chose, use `setToolStyle()`: drawings of that type the user places from then on take it.

```ts
chart.drawings.setToolStyle('trend-line', { color: '#5b9cf0', lineWidth: 2 });
```

### Magnet

Anchors can snap to the open, high, low or close of the bars:

```ts
chart.applyOptions({ drawings: { magnet: 'weak' } }); // 'off' (default), 'weak' when near, 'strong' always
```

Holding Ctrl/⌘ while drawing inverts it.

## Every type

| Group       | Types (anchors)                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lines       | `trend-line` (2), `ray` (2), `extended-line` (2), `arrow` (2), `trend-angle` (2), `horizontal-line` (1), `horizontal-ray` (1), `vertical-line` (1), `cross-line` (1) |
| Channels    | `parallel-channel` (3), `regression-trend` (2), `pitchfork` (3)                                                                                                      |
| Fibonacci   | `fib-retracement` (2), `fib-extension` (3), `fib-channel` (3), `fib-time-zone` (2), `fib-speed-fan` (2)                                                              |
| Gann        | `gann-box` (2)                                                                                                                                                       |
| Shapes      | `rectangle` (2), `circle` (2), `ellipse` (3), `triangle` (3), `path` (until a double click), `brush` (drawn by hand)                                                 |
| Patterns    | `xabcd-pattern` (5), `head-and-shoulders` (7), `elliott-impulse` (6), `elliott-correction` (4)                                                                       |
| Measures    | `price-range` (2), `date-range` (2), `date-price-range` (2), `long-position` (3), `short-position` (3), `anchored-vwap` (1)                                          |
| Annotations | `text` (1), `callout` (2), `price-label` (1), `flag-mark` (1)                                                                                                        |

Each is imported by its type in camel case: `trend-line` is `trendLine`, `fib-retracement` is `fibRetracement`.

Long and short positions read whether they reached their target or their stop, and their gain, from the real prices: on charts built from the bars, such as Heikin-Ashi or Renko, and on a longer timeframe, from the source bars, as far as a replay has revealed them. Anchored VWAPs and regression trends are computed from the bars the chart shows.

## Drawing from code

```ts
const id = chart.drawings.add({
  type: 'trend-line',
  points: [
    { time: '2026-05-01T08:00:00Z', price: 94200 },
    { time: '2026-05-03T16:00:00Z', price: 96800 }
  ],
  style: { color: '#ef5d5d', lineWidth: 2, extendRight: true }
});

chart.drawings.update(id, { style: { lineStyle: 'dashed' } }); // merged into its style
chart.drawings.remove(id);
chart.drawings.clear(); // every drawing

chart.drawings.list(); // every drawing
chart.drawings.get(id);
chart.drawings.duplicate(id); // a copy a few bars to the right, as pasting makes
```

<!-- code-prelude
declare const id: string;
declare const savedDrawings: import('@kumochart-sdk/core/drawings').DrawingInput[];
declare const drawing: import('@kumochart-sdk/core/drawings').Drawing;
declare function showToolbar(x: number, y: number): void;
declare function hideToolbar(): void;
-->

`points` has as many anchors as the type takes. A drawing in another pane than the main one names its `pane`, such as a horizontal line in an RSI pane.

Anchored VWAPs, regression trends, long and short positions and fixed range volume profiles are computed from the bars of the main pane, so they go on the main pane only; another `pane` throws.

`set()` replaces every drawing and clears the undo history, as loading saved drawings wants:

```ts
chart.drawings.set(savedDrawings);
```

For drawings from elsewhere, `validate()` throws the error `set()` would, without adding anything.

## Styles

| Style                                     | Meaning                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`, `lineWidth`, `lineStyle`         | The line                                                                                                                                          |
| `fill`, `fillColor`                       | Whether closed shapes such as rectangles and channels are filled, and with what (opacity included); unfilled, a click inside does not select them |
| `textColor`, `fontSize`, `bold`, `italic` | The text                                                                                                                                          |
| `textAlign`, `textPosition`               | The text along its line, and above it, on it or below it                                                                                          |
| `extendLeft`, `extendRight`               | Lines on to the edges of the plot                                                                                                                 |
| `startArrow`, `endArrow`                  | Arrowheads at the ends                                                                                                                            |
| `levels`, `timeLevels`                    | The lines of Fibonacci and Gann tools: ratios, colors, shown or not                                                                               |
| `source`                                  | The price of the bars a regression channel or an anchored VWAP computes from                                                                      |
| `degree`                                  | The degree of Elliott waves, which sets how they are labelled                                                                                     |

Not every type uses every style. For a settings form, `fields(type)` lists the styles a type has, and `defaultStyle(type)` gives their defaults:

```ts
chart.drawings.fields('fib-retracement'); // ['color', 'lineWidth', 'lineStyle', 'levels', 'fill', ...]
chart.drawings.defaultStyle('fib-retracement').levels; // the default lines
```

`levels` is replaced whole, so changing one line takes the whole set:

```ts
const levels = chart.drawings
  .defaultStyle('fib-retracement')
  .levels.map((level) => (level.value === 0.5 ? { ...level, color: '#ef5d5d' } : level));
chart.drawings.update(id, { style: { levels } });
```

A slider dragged in a settings form, or a field typed into, would make an undo step of every `update()`. Give the updates of one edit the same `merge` key and they make one step:

```ts
chart.drawings.update(id, { style: { lineWidth: 3 } }, { merge: 'lineWidth-7' });
```

## Text

Types such as `text` and `callout` have text, which users edit in place with a double click. From code:

```ts
chart.drawings.editText(id);
chart.drawings.update(id, { text: 'Breakout' });
```

The words drawings paint themselves, such as "R:R" in a position, follow the chart's `locale`: Chinese, English, Japanese or Korean. Replace any of them with `drawings.texts`.

## Locked, hidden, on some timeframes

```ts
chart.drawings.update(id, { locked: true }); // selectable and deletable, not draggable, no text editing
chart.drawings.update(id, { visible: false }); // hidden
chart.drawings.update(id, {
  // only on timeframes from 1 to 59 minutes and from 1 to 4 hours
  timeframes: { minute: { from: 1, to: 59 }, hour: { from: 1, to: 4 } }
});
chart.drawings.update(id, { timeframes: null }); // on every timeframe
```

To hide every drawing at once, such as with a "hide drawings" button, use the option rather than changing each one: the drawings stay as they are, and nothing is added to undo.

```ts
chart.applyOptions({ drawings: { visible: false } }); // true shows them again, each by its own visible
```

While they are hidden, a tool shows and places nothing, and dragging pans the chart; once they show again, the tool goes on.

Units left out of `timeframes` do not show it; bars that do not stand for a period of time, such as Renko or tick bars, take `untimed: true`.

## Undo and redo

What users draw, drag and delete, and your `add()`, `update()` and `remove()`, go into the undo history:

```ts
chart.drawings.undo();
chart.drawings.redo();
chart.drawings.canUndo(); // whether an undo button is enabled
```

On the keyboard, Ctrl/⌘ + Z and Ctrl/⌘ + Shift + Z. Undoing and redoing by key emits `drawingsChange` (`reason: 'undo'`, `'redo'`); calling `undo()` or `redo()` does not.

Without undo in your app, turn the history off: the keys and `undo()` then do nothing.

```ts
chart.applyOptions({ drawings: { history: false } });
```

## A toolbar by the selected drawing

When the user selects a drawing, you may want a small toolbar next to it (color, delete). `bounds(id)` gives the area the drawing covers on the chart, its lines past the anchors and its labels included:

```ts
chart.on('selectionChange', ({ selection }) => {
  if (selection?.kind === 'drawing') {
    const box = chart.drawings.bounds(selection.id); // { x, y, width, height }, null while hidden
    if (box) showToolbar(box.x + box.width / 2, box.y);
  } else {
    hideToolbar();
  }
});
```

The drawing moves with the view, so ask again on `visibleRangeChange`.

## The lines of a drawing

`levels(id)` lists the lines of a drawing that alerts can watch, such as a rectangle's `top` and `bottom` or the lines of a Fibonacci retracement. See [Alerts](alerts.md).

A line at a ratio or a number of deviations is named by that number, as its label writes it: `0.618` for Fibonacci and Gann tools, `2`, `-2` and `0` for the base line of a regression trend, `vwap`, `1` and `-1` for an anchored VWAP.

The lines can be computed without a chart too, for example to tell on a server whether the price touched a retracement a user drew:

```ts
import { computeDrawingLevels, fibRetracement } from '@kumochart-sdk/core/drawings';

const lines = computeDrawingLevels(fibRetracement, { points: drawing.points }, bars);
// { '0': [...], '0.236': [...], ... }: the price of each line at each bar
```

It depends on what you pass alone, and runs in Node.js as well.

## Saving

`chart.saveState()` keeps every drawing; see [Save and restore](state.md), which also shows drawings kept for each symbol.

To make a drawing type of your own, see [Custom drawings](custom-drawings.md).

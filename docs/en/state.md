# Save and restore

The indicators users add, the lines they draw and the panes they arrange can be saved at once, and restored at once the next time.

```ts
// Save
const state = chart.saveState();
localStorage.setItem('layout', JSON.stringify(state));

// Restore
const saved = localStorage.getItem('layout');
if (saved) chart.loadState(JSON.parse(saved));
```

<!-- code-prelude
declare const saved: import('@kumochart-sdk/core').ChartState;
declare const drawingsBySymbol: Record<string, import('@kumochart-sdk/core/drawings').Drawing[]>;
declare const symbol: string, next: string;
declare function barsOf(symbol: string): import('@kumochart-sdk/core').BarInput[];
-->

`saveState()` returns a plain object that goes straight to JSON, for the browser's storage or your server.

## What is saved

- The main series' type and the price it draws (`mainSeries.type`, `mainSeries.source`).
- The bar transform, such as Heikin-Ashi or Renko, with its parameters (`transform`).
- The view: the width of the bars and how far it is from the latest bar.
- The panes: which there are, their order, heights and titles, and for each price scale its mode (logarithmic, percent and so on), whether it is inverted, a range set by hand and its margins.
- What each module keeps: the indicators module every indicator with its parameters and styles, the drawings module every drawing, the volume profiles module every profile.

What belongs to your application is **not** saved: the bars, the timeframe, added series, orders, markers and alerts. Your application keeps them, and sets them again after restoring a layout.

## Restoring

`loadState()` restores everything or changes nothing: anything wrong in the state, such as an unknown version, an indicator type the chart does not have, or a drawing in a pane that does not exist, makes it throw, and the chart stays as it was.

```ts
try {
  chart.loadState(saved);
} catch (error) {
  console.warn('The layout could not be restored; using the default one.', error);
}
```

Restoring needs the same modules: a state with drawings on a chart without the drawings module throws too.

Restore before or after setting the bars, as you like: the indicators compute again with the data. Usually it goes: create the chart, set the bars, restore the layout.

## Drawings for each symbol

Drawings sit at a time and a price, so they fit the same symbol in every timeframe, not another symbol. For drawings of each symbol with one set of indicators and panes, keep the drawings apart:

```ts
// Before switching, keep this symbol's drawings
drawingsBySymbol[symbol] = chart.drawings.list();

// Switch to the next symbol
chart.data.set(barsOf(next), { interval: '1m' });
chart.drawings.set(drawingsBySymbol[next] ?? []);
```

`drawings.set()` replaces every drawing and clears the undo history.

## Version

A state has a `version`, now `1`. When the format changes, so will the version; `loadState()` throws for a version it does not know.

# Interaction

<!-- code-prelude
declare const left: import('@kumochart-sdk/core').Chart, right: import('@kumochart-sdk/core').Chart;
declare const time: number, id: string;
declare function showQuote(bar: import('@kumochart-sdk/core').Bar): void;
declare function openDrawingSettings(id: string): void;
declare function openMenu(x: number, y: number, event: import('@kumochart-sdk/core').ChartPointerEvent): void;
-->

The chart handles mouse, trackpad, touch and keyboard by itself. This page lists what users can do, how to turn parts of it off, and how to move the view, drive the crosshair and select objects from code.

## Mouse and trackpad

| Action                                         | Effect                                            |
| ---------------------------------------------- | ------------------------------------------------- |
| Drag                                           | Scrolls through time, gliding on after a flick    |
| Wheel up and down                              | Zooms                                             |
| Sideways swipe on a trackpad, Shift + wheel    | Scrolls through time                              |
| Pinch on a trackpad                            | Zooms                                             |
| Drag the time axis                             | Changes the width of the bars                     |
| Drag the price axis, or turn the wheel over it | Scales the prices                                 |
| Double-click the price axis                    | Fits the prices again                             |
| Double-click the time axis                     | Restores the bar width and goes to the latest bar |
| Drag the separator between panes               | Resizes the panes                                 |

One rule says which bar stays put as the bars zoom: while the view follows the latest bar (it is in view), the latest bar stays, and the view goes on following it; otherwise the bar under the pointer stays as the wheel, the trackpad, a pinch or a drag of the time axis zooms (under the middle of the fingers, or where the axis was pressed), and the bar in the middle as the keys or `timeScale.zoomIn()` and `zoomOut()` zoom.

## Touch

| Action     | Effect                                                       |
| ---------- | ------------------------------------------------------------ |
| Drag       | Scrolls through time                                         |
| Pinch      | Zooms by how far apart the fingers are across the chart      |
| Long press | Shows the crosshair, which follows the finger until it lifts |

While placing a drawing or dragging an object, a magnifier above the finger shows what is under it.

## Keyboard

Once the chart has focus (click it):

| Key                            | Effect                                             |
| ------------------------------ | -------------------------------------------------- |
| ← →                            | Scrolls; with Shift, half a screen                 |
| ↑ or +, ↓ or -                 | Zooms in, out                                      |
| End                            | Goes to the latest bar                             |
| Esc                            | Cancels the drawing being placed, or the selection |
| Delete, Backspace              | Deletes the selected object                        |
| Ctrl/⌘ + Z                     | Undo                                               |
| Ctrl/⌘ + Shift + Z, Ctrl/⌘ + Y | Redo                                               |
| Ctrl/⌘ + C, Ctrl/⌘ + V         | Copies, pastes the selected drawing                |

The modules handle deleting, undoing and copying their objects: the drawings module undoes drawings, for instance. A key that does nothing, as with nothing to undo or nothing selected, is left to the page and its own shortcuts; so are the other keys with Ctrl/⌘ or Alt, as Ctrl + - zooming the page and Alt + ← going back.

## Turning things off

```ts
chart.applyOptions({
  interaction: {
    pan: true, // drag to scroll
    wheelZoom: true, // wheel and trackpad zoom
    pinchZoom: true, // pinch zoom on touch screens
    axisScale: true, // dragging and double-clicking the axes
    kineticScroll: true, // gliding on after a flick
    keyboard: true, // keyboard commands
    longPressMs: 300, // how long a press shows the crosshair
    touchMagnifier: true, // the magnifier on touch screens
    hitTolerance: 6 // how near counts as on an object, in CSS pixels
  }
});
```

For a static chart, such as a thumbnail in a list, turn off `pan`, `wheelZoom`, `pinchZoom`, `axisScale` and `keyboard`.

## Moving the view

`chart.timeScale` drives the horizontal view:

```ts
chart.timeScale.scrollToRealTime(); // to the latest bar
chart.timeScale.fitContent(); // every bar on one screen
chart.timeScale.setVisibleRange({ from: '2026-05-01', to: '2026-05-08' });
chart.timeScale.scrollToTime(time, 'center'); // a time to the middle
chart.timeScale.zoomIn();
chart.timeScale.setBarSpacing(12); // bars 12 pixels wide
chart.timeScale.reset(); // the default width, at the latest bar

chart.timeScale.visibleRange(); // the times of the first and last bars in view
chart.timeScale.isFollowing(); // whether the latest bar is in view
```

The view emits `visibleRangeChange` as it changes:

```ts
chart.on('visibleRangeChange', ({ range }) => {
  if (range) console.log(new Date(range.from), new Date(range.to));
});
```

## Crosshair

The crosshair follows the pointer over the chart and emits `crosshairMove`, with the time, price and bar under the pointer. It is emitted too when the pointer keeps still but the bar under it changes, as the keyboard or a fling scrolls the bars or a real-time update changes that bar:

```ts
chart.on('crosshairMove', (event) => {
  if (event.visible && event.bar) {
    showQuote(event.bar); // e.g. show the bar's values elsewhere on the page
  }
});
```

The crosshair can also go to a time without a pointer, for example to keep several charts in step:

```ts
left.on('crosshairMove', (event) => {
  if (event.visible && event.time !== null) {
    right.crosshair.set({ time: event.time });
  } else {
    right.crosshair.set(null);
  }
});
```

`crosshair.set(null)` hides it. `crosshair.get()` returns where the crosshair is, or `null` while it is hidden.

## Selecting objects

Drawings, orders, alerts and markers can be clicked. Selecting emits `selectionChange`:

```ts
chart.on('selectionChange', ({ selection }) => {
  // such as { kind: 'drawing', id: 'xxx' }; null for a click on nothing
  if (selection?.kind === 'drawing') openDrawingSettings(selection.id);
});

chart.select({ kind: 'drawing', id }); // select from code
chart.selection(); // what is selected
chart.select(null); // nothing
```

`selectionChange` reports the user's clicks; calling `select()` emits nothing.

## Clicks and context menus

`click`, `doubleClick` and `contextMenu` tell where the user clicked and on what:

```ts
chart.on('contextMenu', (event) => {
  // event.area: 'plot', 'price-axis', 'time-axis', 'separator' or 'outside'
  // event.paneId, event.time, event.price: where
  // event.target: the object, such as { kind: 'drawing', id, part: 'line' }, or null
  openMenu(event.x, event.y, event);
});
```

With a `contextMenu` listener the browser's own menu no longer opens over the chart. A right click while a drawing is being placed cancels it and emits nothing.

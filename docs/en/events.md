# Events

<!-- code-prelude
declare function modifyOrder(id: string, price: number): void;
-->

Listen with `chart.on()`, which returns a function that stops listening:

```ts
const off = chart.on('crosshairMove', (event) => {
  /* ... */
});

off(); // stop listening
```

Destroying the chart releases every listener.

## When events fire

Most events report what the **user** did: changes you make through the API do not come back to you. A drawing the user places emits `drawingsChange`; `chart.drawings.add()` does not. So you can save what an event reports to your server and set it on the chart again without going round in circles.

`barsChange`, `visibleRangeChange`, `typesChange` and `optionsChange` are the exceptions: they describe the chart as it is, whoever changed it.

The events of an API call are dispatched once the call has done its work, as it returns, a read's too: when `visibleRange()` works out a new visible range, `visibleRangeChange` follows once it has, and a listener changing the chart there does not change what it returns.

To make several API calls take effect together, with their events dispatched once, use `batch()`:

```ts
chart.batch(() => {
  chart.data.set(bars, { interval: '1m' });
  chart.data.setTimeframe('1h');
  chart.timeScale.scrollToRealTime();
});
```

## Events of the core

| Event                | When                                                         | See                                                       |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `crosshairMove`      | The pointer moves over the chart, or leaves it               | [Interaction](interaction.md#crosshair)                   |
| `visibleRangeChange` | The bars in view change                                      | [Interaction](interaction.md#moving-the-view)             |
| `loadMore`           | The view nears the first bar                                 | [Data](data.md#loading-history)                           |
| `barsChange`         | The displayed bars change                                    | [Data](data.md#when-bars-change)                          |
| `click`              | A click                                                      | [Interaction](interaction.md#clicks-and-context-menus)    |
| `doubleClick`        | A double click                                               | the same                                                  |
| `contextMenu`        | A right click; listening keeps the browser's menu away       | the same                                                  |
| `selectionChange`    | The user selects an object, or nothing                       | [Interaction](interaction.md#selecting-objects)           |
| `paneResize`         | The user lets go of a pane separator                         | [Panes](panes.md)                                         |
| `legendButtonClick`  | A button of the legend is clicked                            | [Appearance](appearance.md#legend)                        |
| `buttonClick`        | A button on the label of an order or an alert is clicked     | [Orders and fills](trading.md)                            |
| `typesChange`        | A series, transform, indicator or drawing type comes or goes | [Modules](modules.md#adding-types-later)                  |
| `optionsChange`      | Options are set (`applyOptions()`, `loadState()`)            | [Custom modules](custom-modules.md#following-the-options) |

## Events of the modules

With their modules:

| Event            | Module   | When                                                                 |
| ---------------- | -------- | -------------------------------------------------------------------- |
| `drawingsChange` | Drawings | The user creates, edits or deletes drawings, or undoes or redoes     |
| `toolEnd`        | Drawings | The user finishes a drawing, or cancels it with Esc or a right click |
| `orderDrag`      | Orders   | The user drags an order line                                         |
| `alertDrag`      | Alerts   | The user drags an alert line                                         |
| `alertTrigger`   | Alerts   | An alert fires                                                       |
| `replay`         | Replay   | Replay plays a bar on, or reaches the end                            |

Drags come in phases: `start`, `move`, `end`, or `cancel` when Esc cancels them, with the price before the drag and the price now:

```ts
chart.on('orderDrag', ({ id, phase, price, initialPrice }) => {
  if (phase === 'end') {
    modifyOrder(id, price); // modify the order once the user lets go
  }
});
```

## In TypeScript

Event names and their payloads are typed after the chart's modules: on a chart without the drawings module, `chart.on('drawingsChange', ...)` fails to compile.

To forward every event, as a component for another framework does, `ALL_EVENTS` of `@kumochart-sdk/core/all` names the events of the core and of every module, and `AllEventMap` types them.

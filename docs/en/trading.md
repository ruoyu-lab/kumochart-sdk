# Orders and fills

<!-- code-prelude
declare const order: { id: string };
declare const fill: { id: string; time: number; price: number };
declare const openOrders: import('@kumochart-sdk/core/trading').OrderInput[];
declare const exchange: {
  modifyOrder(id: string, price: number): Promise<void>;
  cancelOrder(id: string): void;
};
-->

Two things trading screens need: open orders as price lines the user can drag, and fills marked on the bars. They are two modules, both in `@kumochart-sdk/core/trading`; load either one alone if you like.

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { orders, markers } from '@kumochart-sdk/core/trading';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [orders(), markers()]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');

const bars = chart.data.toArray();
const last = bars.at(-1)!;
chart.orders.add({
  id: 'o1',
  side: 'buy',
  price: last.close * 0.99,
  label: 'LIMIT',
  quantity: 0.5
});
chart.orders.add({ id: 'o2', side: 'sell', price: last.close * 1.015, label: 'TP', quantity: 0.5 });

const entry = bars.at(-40)!;
chart.markers.add({
  id: 'f1',
  time: entry.time,
  position: 'below',
  shape: 'arrow-up',
  text: 'Buy'
});
```

## Order lines

```ts
import { orders } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [orders()] });

chart.orders.add({
  id: order.id, // usually the order id of the exchange or broker
  side: 'buy', // 'buy' or 'sell', which sets the default color
  price: 95000,
  label: 'LIMIT', // the label's text, BUY or SELL by default
  quantity: 0.25 // shown after the label
});

chart.orders.update(order.id, { price: 94800 });
chart.orders.remove(order.id);
chart.orders.set(openOrders); // replaces them with the latest open orders
```

Without an `id` the chart numbers the order, `order-1` on, and `add()` returns it; `clear()` removes every order.

The exchange knows the state of an order: the simplest is to `set()` every open order whenever they change.

### Dragging to modify

Users drag order lines up and down. The line follows, stays at the new price when they let go, and `orderDrag` reports each phase:

```ts
chart.on('orderDrag', async ({ id, phase, price, initialPrice }) => {
  if (phase !== 'end') return;

  try {
    await exchange.modifyOrder(id, price);
  } catch {
    chart.orders.update(id, { price: initialPrice }); // modifying failed: back where it was
  }
});
```

Esc during a drag cancels it: the line goes back and the phase is `cancel`. For an order that must not be dragged, set `draggable: false`.

### Buttons on the label

```ts
chart.orders.add({
  id: order.id,
  side: 'sell',
  price: 98000,
  buttons: [{ id: 'cancel', text: '✕' }]
});

chart.on('buttonClick', ({ kind, id, buttonId }) => {
  if (kind === 'order' && buttonId === 'cancel') exchange.cancelOrder(id);
});
```

A button shows `text`, or an `icon` given as SVG path data in a 24 × 24 box.

## Fill markers

```ts
import { markers } from '@kumochart-sdk/core/trading';

createChart(container, { modules: [markers()] });

chart.markers.add({
  id: fill.id,
  time: fill.time, // on the bar this time falls in
  position: 'below', // 'above' the high, 'below' the low, or at a 'price'
  shape: 'arrow-up',
  text: 'Buy 0.25'
});
```

The shapes are `arrow-up`, `arrow-down`, `triangle-up`, `triangle-down`, `circle` and `square`. Upward shapes take the theme's `buy` color, downward ones its `sell` color, circles and squares the text color; `color` sets another, `size` the size (8 pixels by default).

At a price:

```ts
chart.markers.add({
  id: 'f2',
  time: fill.time,
  position: 'price',
  price: fill.price,
  shape: 'circle'
});
```

Markers have `update()`, `remove()`, `set()`, `clear()`, `list()` and `get()` too; without an `id` they are numbered `marker-1` on.

A marker later than the period of the latest bar is not drawn until its bar comes, and then sits on it; on bars that take no time, such as Renko bricks, every marker after the latest one sits on it. Only the markers in view are worked on, so tens of thousands of fills of a backtest do not slow down scrolling and zooming.

## Selecting

Order lines and markers can be clicked, which emits `selectionChange` with `selection.kind` `'order'` or `'marker'`; see [Interaction](interaction.md#selecting-objects).

Orders and markers are not part of `saveState()`: they are your trading data, fetched from the exchange each time.

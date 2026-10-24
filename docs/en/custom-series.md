# Custom series

<!-- code-prelude
interface DotsStyle {
  color: string;
  radius: number;
}
-->

The chart shows bars in two steps: which bars to show (a bar transform, such as Renko turning bars into bricks), and how to draw them (a series type, such as candles or a line). You can write either.

## A way of drawing

This series type draws a dot at the close of each bar:

```ts live height=360
import { createChart, type SeriesTypeDefinition } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

interface DotsStyle {
  color: string;
  radius: number;
}

const dots: SeriesTypeDefinition<DotsStyle> = {
  type: 'dots',
  input: 'value', // one value a bar; 'ohlc' gives open, high, low and close
  defaultStyle: (_theme, color) => ({ color, radius: 2 }),
  paint: ({ ctx, points, style }) => {
    ctx.fillStyle = style.color;
    for (let i = 0; i < points.count; i += 1) {
      const y = points.value(i);
      if (Number.isNaN(y)) continue; // no value here
      ctx.beginPath();
      ctx.arc(points.x(i), y, style.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const chart = createChart(document.getElementById('chart')!);
chart.series.register(dots);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.series.add({
  type: 'dots',
  data: chart.data.toArray().map((bar) => ({ time: bar.time, value: bar.close }))
});
```

`paint` receives the points in view only, already in pixels:

- `points.x(i)`: where point i is, at the center of its bar.
- With `input: 'value'`, `points.value(i)` is its y; with `input: 'ohlc'`, `points.open(i)`, `high(i)`, `low(i)` and `close(i)`, and `points.isUp(i)` whether it rose.
- `points.color(i)`: the color the main series' `barColor` gave the bar, or `null`.
- `barSpacing`: the width of a bar, for columns and candles.
- `valueToY`: for anything else, such as a base line.

`ctx` is clipped to the plot and moved to its corner; paint in CSS pixels.

`defaultStyle(theme, color)` gives the whole default style: `color` is the color the chart gives the series (added series take the theme's palette in turn), and users' styles merge over it. When the price scale must include values besides the data, such as where columns start, return them from `extraExtents(style)`.

### On the main series

A registered series type can draw the main series too:

```ts
chart.applyOptions({ mainSeries: { type: 'dots' } });
```

In TypeScript, the main series' type must be a name the chart knows; declaration merging tells it:

```ts
declare module '@kumochart-sdk/core' {
  interface SeriesStyleMap {
    dots: DotsStyle;
  }
}
```

Then `mainSeries.type: 'dots'` and `mainSeries.styles.dots` are type-checked.

## A bar transform

A transform receives the bars of the timeframe and builds new bars from them, one by one. This one merges every N bars into one:

```ts
import type { Bar, BarTransformDefinition, BarTransformStream } from '@kumochart-sdk/core';

class MergeStream implements BarTransformStream {
  constructor(
    private readonly size: number,
    private forming: Bar | null = null,
    private count = 0
  ) {}

  next(bar: Bar): readonly Bar[] {
    const f = this.forming;
    this.forming = f
      ? {
          time: f.time,
          open: f.open,
          high: Math.max(f.high, bar.high),
          low: Math.min(f.low, bar.low),
          close: bar.close,
          volume: f.volume + bar.volume
        }
      : { ...bar };
    this.count += 1;

    if (this.count < this.size) return []; // not enough yet: no bar completed
    const done = this.forming;
    this.forming = null;
    this.count = 0;
    return [done];
  }

  current(): Bar | null {
    return this.forming; // the bar still forming, drawn last
  }

  clone(): BarTransformStream {
    return new MergeStream(this.size, this.forming, this.count);
  }
}

export const mergeBars: BarTransformDefinition<{ size?: number }> = {
  type: 'merge',
  name: 'Merge',
  keepsTime: false,
  create: ({ size = 3 }) => {
    if (!Number.isInteger(size) || size < 1)
      throw new Error('merge: size must be a positive integer');
    return new MergeStream(size);
  }
};

chart.transforms.register(mergeBars);
chart.transforms.set({ type: 'merge', params: { size: 5 } });
```

The rules:

- `next(bar, side)` returns the bars this input completed (none, one or several), in order of time. Built from the trades, `side` is the side of the trade's taker (`buy`, `sell`, or `null` when unknown); built from bars, it is `null`. A transform without a use for it leaves it out.
- `current()` returns the bar still forming, or `null`.
- `clone()` copies all the state: as the latest bar updates, the chart computes again from a copy taken before it.
- `keepsTime`: `true` when each input bar becomes one output bar at the same time (as Heikin-Ashi), which keeps the features that rely on the timeframe, such as the countdown; otherwise `false`.
- `create(params, input, from)`: `input` holds every bar about to come in, for automatic sizes (such as a box from the average true range); `from` says what they are, `'bars'`, the bars of the timeframe, or `'trades'`, each trade. Throw for wrong parameters; `transforms.set()` passes the error to its caller.

Report automatic parameters and `chart.transforms.get().resolved` returns them, for your UI; return `null` while the bars do not tell them yet. Add a method to the stream:

```ts no-check
class MergeStream implements BarTransformStream {
  // ...the methods above

  resolved(): Readonly<Record<string, unknown>> {
    return { size: this.size };
  }
}
```

## Both together

As with Kagi lines, bars built by a transform may want their own drawing: register the transform and the series type, and turn both on together.

```ts
chart.batch(() => {
  chart.transforms.set({ type: 'merge', params: { size: 5 } });
  chart.applyOptions({ mainSeries: { type: 'dots' } });
});
```

In the series type's `paint`, `transform` holds what the transform reports (`resolved`), for example to draw a box size.

To bring these types along when the chart is created, or to share them with other projects, see [Custom modules](custom-modules.md).

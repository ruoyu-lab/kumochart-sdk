# Custom indicators

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition<{ period: number }>;
-->

An indicator of your own works like those of the SDK: it goes on the chart, shows in the legend, can be watched by alerts, is saved with the layout, and computes without a chart too.

## The simplest way

Tell the chart how many bars each value looks back at (`lookback`), and give a function that computes the values from them (`compute`):

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, type IndicatorDefinition } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

/** How far the price is from its moving average, in percent */
const DEVIATION: IndicatorDefinition<{ period: number }> = {
  type: 'DEVIATION',
  name: 'Deviation',
  pane: 'new', // a pane of its own; 'main' draws on the main pane
  precision: 2,
  params: { period: { default: 20, min: 2, max: 500, integer: true, label: 'Period' } },
  outputs: () => [{ key: 'dev', label: 'DEV%', plot: { kind: 'histogram', colorBy: 'sign' } }],
  levels: () => [0],
  lookback: ({ period }) => period,
  compute: (window) => {
    let sum = 0;
    for (let i = 0; i < window.length; i += 1) sum += window.price(i);
    const average = sum / window.length;
    const latest = window.price(window.length - 1);
    return [((latest - average) / average) * 100];
  }
};

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators([DEVIATION])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
chart.indicators.add({ type: 'DEVIATION' });
```

`window` holds the latest `lookback` bars, oldest first: `window.price(i)` is the indicator's price (the close by default), `window.bar(i)` the whole bar. Until there are `lookback` bars, `compute` is not called and those bars have no value.

`compute` returns an array with a value for each output; `NaN` where there is none.

## Using it

Give it with the SDK's indicators when you create the chart:

```ts
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators([...allIndicators, DEVIATION])] });
```

Or register it later:

```ts
chart.indicators.register(DEVIATION);
chart.indicators.add({ type: 'DEVIATION', params: { period: 50 } });
```

## Bar by bar

`compute` goes through the whole window on every bar, which gets slow with long periods; and some indicators carry state from long ago, such as an EMA. For those, write `create`, returning a calculator that steps from bar to bar:

```ts
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

/** How many bars in a row closed up (positive) or down (negative) */
class StreakStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private previous = Number.NaN,
    private streak = 0
  ) {}

  next(_bar: unknown, price: number): ArrayLike<number> {
    if (price > this.previous) this.streak = this.streak > 0 ? this.streak + 1 : 1;
    else if (price < this.previous) this.streak = this.streak < 0 ? this.streak - 1 : -1;
    else this.streak = 0;
    this.previous = price;
    this.out[0] = this.streak;
    return this.out;
  }

  clone(): IndicatorStream {
    return new StreakStream(this.previous, this.streak);
  }
}

export const STREAK: IndicatorDefinition<Record<string, never>> = {
  type: 'STREAK',
  name: 'Streak',
  pane: 'new',
  precision: 0,
  params: {},
  outputs: () => [{ key: 'streak', label: 'STREAK', plot: { kind: 'histogram', colorBy: 'sign' } }],
  create: () => new StreakStream()
};
```

Two rules:

- `next(bar, price)` is called once a bar, in order of time. The `bar` object is reused: keep the numbers you need, not the object.
- `clone()` copies all the state. As the latest bar updates in real time, the chart computes it again from a copy taken before it, so a copy must not share anything with the original.

## Built of the SDK's blocks

Common calculations such as an EMA or a standard deviation need not be written again: `@kumochart-sdk/core/indicators` exports the blocks the SDK's own indicators are built of, each with `clone()`:

| Block                         | Computes                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `movingAverage(kind, period)` | a moving average: `'sma'`, `'ema'`, `'rma'`, `'wma'` or `'vwma'`, as the built-in indicators pick |
| `StandardDeviation`           | the standard deviation of the latest `period` values                                              |
| `RollingExtremes`             | the highest high and lowest low of the latest `period` bars                                       |
| `RingBuffer`                  | the latest `capacity` values, their highest, lowest and sum                                       |
| `Previous`                    | the value before                                                                                  |

Such as a band of a few standard deviations around an EMA:

```ts
import type { Bar } from '@kumochart-sdk/core';
import {
  movingAverage,
  StandardDeviation,
  type BarStep,
  type IndicatorDefinition,
  type IndicatorStream
} from '@kumochart-sdk/core/indicators';

class EmaBandStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly width: number,
    private readonly average: BarStep,
    private readonly deviation: StandardDeviation
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const middle = this.average.next(price, bar); // the bar, for the volume of a volume-weighted average
    const spread = this.deviation.next(price) * this.width;
    this.out[0] = middle;
    this.out[1] = middle + spread;
    this.out[2] = middle - spread;
    return this.out;
  }

  clone(): IndicatorStream {
    // each block copies its own state
    return new EmaBandStream(this.width, this.average.clone(), this.deviation.clone());
  }
}

export const EMA_BAND: IndicatorDefinition<{ period: number; width: number }> = {
  type: 'EMA_BAND',
  name: 'EMA band',
  pane: 'main',
  precision: 'price',
  params: {
    period: { default: 20, min: 2, max: 500, integer: true, label: 'Length' },
    width: { default: 2, min: 0.1, max: 10, label: 'Width' }
  },
  outputs: () => [
    { key: 'basis', label: 'EMA', plot: { kind: 'line' } },
    { key: 'upper', label: 'Upper', plot: { kind: 'line' } },
    { key: 'lower', label: 'Lower', plot: { kind: 'line' } }
  ],
  fills: () => [{ from: 'upper', to: 'lower' }],
  create: ({ period, width }) =>
    new EmaBandStream(width, movingAverage('ema', period), new StandardDeviation(period))
};
```

The averages and the deviation are `NaN` until `period` values came; a `NaN` is skipped and leaves the value as it was. Cloning each block in `clone()` copies the whole calculator.

## How outputs are drawn

Each output's `plot`:

| `kind`      | Draws                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `line`      | A line; `style` is `solid`, `dashed` or `dotted`, `width` its width in pixels (0.5 to 10, default 1.25)                  |
| `segments`  | A horizontal line through each run of equal values, such as the pivot points of a day; `style` and `width` as for `line` |
| `histogram` | Columns from zero, colored by sign (`sign`), change (`change`) or bar direction (`bar`)                                  |
| `columns`   | Columns from another output (or a fixed value) to this one                                                               |
| `box`       | Boxes from another output to this one, such as the range of a session                                                    |
| `marker`    | A shape or a text on the bars with a value, such as an arrow where lines cross                                           |
| `hidden`    | Nothing: shown in the legend and available to alerts only                                                                |

More settings of an output:

```ts
import type { IndicatorOutput } from '@kumochart-sdk/core/indicators';

const upper: IndicatorOutput = {
  key: 'upper',
  label: 'Upper',
  plot: { kind: 'line' },
  color: '#5b9cf0', // without it, the theme's palette in turn
  themeColor: 'up', // or the theme's rising or falling color
  offset: 26, // drawn 26 bars to the right, as Ichimoku's leading spans
  legend: false, // not in the legend
  precision: 4, // decimals of this output alone
  autoscale: false // left out when the price scale fits what is in view
};
```

To shade between two outputs, give the definition `fills`, such as between the bands of Bollinger Bands: `fills: () => [{ from: 'upper', to: 'lower' }]`. Like `outputs`, it is a function of the parameters, so a shade can come only with the bands the parameters turn on; a shade between outputs the parameters do not make fails as the indicator is added, rather than drawing nothing.

## Parameters

```ts
import type { ParamSpec } from '@kumochart-sdk/core/indicators';

const params = {
  period: { default: 14, min: 1, max: 500, integer: true, label: 'Period' },
  periods: { default: [5, 10, 20], min: 1, integer: true }, // several numbers, such as moving averages
  anchor: {
    default: 1,
    // only these values, which a form offers as a select
    options: [
      { value: 1, label: 'Day' },
      { value: 2, label: 'Week' }
    ]
  }
} satisfies Record<string, ParamSpec>;
```

Parameters are numbers or arrays of numbers. The chart checks what users give against these ranges and throws for values outside them.

## Following trading days

An indicator that starts again every trading day, week or month, such as a daily VWAP, takes the trading calendar in the second argument:

```ts
import type { Bar, Calendar } from '@kumochart-sdk/core';
import type { IndicatorDefinition, IndicatorStream } from '@kumochart-sdk/core/indicators';

class DayHighStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly calendar: Calendar,
    private day: number | null = null,
    private high = Number.NaN
  ) {}

  next(bar: Bar): ArrayLike<number> {
    // the trading day of the bar; null outside the sessions
    const day = this.calendar.bucket(bar.time, '1D');
    this.high = day === this.day ? Math.max(this.high, bar.high) : bar.high;
    this.day = day;
    this.out[0] = this.high;
    return this.out;
  }

  clone(): IndicatorStream {
    return new DayHighStream(this.calendar, this.day, this.high);
  }
}

const DAY_HIGH: IndicatorDefinition<Record<string, never>> = {
  type: 'DAY_HIGH',
  name: 'Day high',
  pane: 'main',
  precision: 'price',
  params: {},
  outputs: () => [{ key: 'high', label: 'DH', plot: { kind: 'segments' } }],
  create: (_params, { calendar }) => new DayHighStream(calendar)
};
```

The calendar is the chart's `calendar` option; when the user changes the sessions, the indicator computes again. The second argument also has `interval`, the interval of the bars: the timeframe the chart shows, or `null` for bars `data.set()` got without one.

## Without a chart

```ts
import { computeIndicator } from '@kumochart-sdk/core/indicators';

const { dev } = computeIndicator(DEVIATION, bars, { params: { period: 50 } });
// dev[i] is the value at bar i, as the chart computes it
```

To step bar by bar, use `createIndicatorCalculator()`, for example to follow real-time data on a server and evaluate alerts. Both run in Node.js.

# Appearance

<!-- code-prelude
import { darkTheme } from '@kumochart-sdk/core';
declare const EYE_ICON: string, CLOSE_ICON: string;
-->

Options decide how the chart looks: give them when you create it, and change them any time with `applyOptions()`.

```ts
const chart = createChart(container, {
  theme: darkTheme,
  grid: { vertical: false },
  latestPrice: { countdown: true }
});

chart.applyOptions({ crosshair: { mode: 'magnet' } });
chart.options(); // every option as it is now
```

`applyOptions()` changes only what you give and keeps the rest; arrays and functions are replaced whole. An unknown option or a wrong value throws, and the chart stays as it was.

An option left unset is `null`, such as `locale`, `timeZone`, `legend.rows` or `panes.separatorColor`; to go back to the default after setting one, set it to `null` again, as in `chart.applyOptions({ locale: null })`. So are each word of `texts` and the styles of each type in `mainSeries.styles`.

## Themes

The SDK has a light theme, `lightTheme` (the default), and a dark one, `darkTheme`; for the dark one, pass `theme: darkTheme`:

```ts live height=320
import { createChart, darkTheme } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { theme: darkTheme });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
```

A theme is a set of colors; bars, indicators and drawings without colors of their own take theirs from it. Start from a theme of the SDK and change what you need:

```ts
import { lightTheme } from '@kumochart-sdk/core';

// Red for rising, green for falling
const theme = {
  ...lightTheme,
  up: '#ef5d5d',
  down: '#2fb57e',
  volumeUp: 'rgba(239, 93, 93, 0.4)',
  volumeDown: 'rgba(47, 181, 126, 0.4)'
};

createChart(container, { theme });
```

| Color                      | Used for                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `background`               | The background                                                |
| `text`, `textMuted`        | Text of the axes and the legend, and secondary text           |
| `grid`, `border`           | Grid lines, and the lines between panes                       |
| `crosshair`                | The crosshair                                                 |
| `crosshairLabelBackground` | The crosshair's labels on the axes                            |
| `crosshairLabelText`       | Their text                                                    |
| `up`, `down`               | Rising and falling bars and values                            |
| `volumeUp`, `volumeDown`   | Rising and falling volume columns                             |
| `accent`                   | Selected objects and the handles being dragged                |
| `palette`                  | Colors taken in turn by indicators, drawings and added series |
| `buy`, `sell`              | Buy and sell orders, and fill markers                         |
| `alert`                    | Alert lines                                                   |

`withAlpha(color, 0.3)` gives a color an opacity, handy when making a theme.

Colors take any CSS syntax, such as `#26a69a`, `rgb(38 166 154)`, `rgba(38, 166, 154, 0.5)` or `teal`. They are checked as they are given: a misspelled color of a theme, a style, an indicator, a drawing, an alert or anything else throws at once, naming its field, rather than when it is painted. Computed without a chart, as in Node.js, nothing is painted, and a color is only checked to be text. To check colors of your own settings as the chart does, use `checkColor(path, value)`.

## The main series

The main series draws candles by default. The core has 11 series types:

```ts
chart.applyOptions({ mainSeries: { type: 'line' } });
```

| Type             | Draws               |
| ---------------- | ------------------- |
| `candles`        | Candles             |
| `hollow-candles` | Hollow candles      |
| `ohlc`           | OHLC bars           |
| `high-low`       | High-low bars       |
| `line`           | A line              |
| `step-line`      | A step line         |
| `line-markers`   | A line with markers |
| `area`           | An area             |
| `baseline`       | A baseline          |
| `hlc-area`       | An HLC area         |
| `columns`        | Columns             |

Types that draw one price, such as the line, draw `mainSeries.source`: `open`, `high`, `low`, `close` (default), `hl2`, `hlc3` or `ohlc4`.

Each type keeps a style of its own, so switching types keeps each one's style:

```ts
chart.applyOptions({
  mainSeries: {
    styles: {
      candles: { upColor: '#ffffff', border: true, bodyRatio: 0.7 },
      line: { color: '#5aa9fa', lineWidth: 2 }
    }
  }
});
```

What a style leaves out comes from the theme and follows it when the theme changes. The styles of each type: [API reference](../api.md#SeriesStyleMap).

To color single bars, such as those with heavy volume, use `mainSeries.barColor`:

```ts
chart.applyOptions({
  mainSeries: {
    barColor: ({ bar }) => (bar.volume > 500 ? '#e8b04a' : null) // null keeps the usual color
  }
});
```

## Grid and crosshair

```ts
chart.applyOptions({
  grid: { vertical: false, horizontal: true, style: 'dashed' },
  crosshair: {
    mode: 'magnet', // the horizontal line snaps to the close; 'free' follows the pointer
    labels: true, // time and price labels on the axes
    style: 'dashed'
  }
});
```

Lines are `'solid'`, `'dashed'` or `'dotted'`.

## Scales

```ts
chart.applyOptions({
  priceScale: {
    margins: { top: 0.1, bottom: 0.08 }, // space above and below auto-scaled data, as fractions of the pane
    precision: 2, // decimals of prices; 'auto' (default) infers them from the data
    minWidth: 48 // the narrowest the axis gets; it grows to fit its labels
  },
  timeScale: {
    barSpacing: 8, // the width of a bar to start with
    minBarSpacing: 0.5,
    maxBarSpacing: 60,
    rightOffset: 60 // space after the latest bar
  }
});
```

`margins` and the `setMargins()` of each scale go by one rule: each at least 0, and together at most 0.9, leaving the data a tenth of the pane at least.

Widths and heights are in CSS pixels.

### Formatting

Write the text of prices and times yourself:

```ts
chart.applyOptions({
  priceScale: {
    formatter: (value, { precision }) => `$${value.toFixed(precision)}`
  },
  timeScale: {
    formatter: (time, { kind, unit }) => {
      const date = new Date(time);
      if (kind === 'crosshair') return date.toLocaleString('en-GB');
      return unit === 'day'
        ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : date.toTimeString().slice(0, 5);
    }
  }
});
```

`kind` is `axis` (a tick on the axis) or `crosshair` (the crosshair's label); `unit` is the calendar boundary a tick sits on: year, month, day, hour, minute or second. Without a formatter, times and prices follow `locale` and `timeZone`. The `locale` and `timeZone` a formatter is given are those in effect: without them set, the runtime's language and the local time zone.

## Latest price

The label of the latest price on the right axis, and its line:

```ts
chart.applyOptions({
  latestPrice: {
    line: true,
    label: true,
    countdown: true, // the time left until the bar closes, under the label
    style: 'dotted',
    color: null // null follows the latest bar, rising or falling
  }
});
```

The countdown shows only for bars that stand for periods of time: not while replaying, nor for bricks and the like. Nor once the latest bar has closed, as when the data stopped or the market is closed: it counts down again once a new bar comes.

## Legend

The legend sits at the top left of each pane, with the open, high, low and close of the bar under the pointer (or the latest one) and the values of the indicators. Each indicator's row gives its name and parameters, then the values of its lines; an indicator of one line, such as RSI or MA of one period, is named by its title, and its value goes without the line's name.

```ts
chart.applyOptions({
  legend: {
    visible: true,
    // buttons of the row under the pointer
    buttons: (item) =>
      item.kind === 'indicator'
        ? [
            { id: 'hide', icon: EYE_ICON },
            { id: 'remove', icon: CLOSE_ICON }
          ]
        : []
  }
});

chart.on('legendButtonClick', ({ item, buttonId }) => {
  if (buttonId === 'remove') chart.indicators.remove(item.id);
  if (buttonId === 'hide') chart.indicators.update(item.id, { visible: false });
});
```

A button's `icon` is SVG path data in a 24 × 24 box (the `d` of a `<path>`), as icon sets give them.

By default the legend lists the visible indicators and series. To list the hidden ones too, dimmed, for a button that shows them again, use `rows`:

```ts
chart.applyOptions({ legend: { rows: () => true } });
```

## Watermark

The middle of the main pane can show a line or two of large text, such as the symbol and the timeframe, faint and under the bars. The watermark module shows it, from its option:

```ts
import { createChart } from '@kumochart-sdk/core';
import { watermark } from '@kumochart-sdk/core/watermark';

const chart = createChart(container, {
  modules: [watermark()],
  watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
});

chart.applyOptions({ watermark: { lines: [{ text: 'ETHUSDT' }, { text: '4h', size: 20 }] } });
```

`lines` go from the top down, each `size` in pixels (40 by default); without a `color`, the theme's text color is used, faint. Set new `lines` with `applyOptions()` as the symbol or the timeframe changes.

## Language and words

```ts
createChart(container, {
  locale: 'de-DE', // the format of numbers and dates; the browser's by default
  texts: {
    legendOpen: 'Eröffnung',
    legendClose: 'Schluss',
    days: (count) => `${count} T` // whole days in the countdown
  }
});
```

The words the chart paints default to forms every language reads, such as `O H L C V`; `texts` replaces them where you want.

## Font

```ts
chart.applyOptions({ font: { family: 'Inter, sans-serif', size: 12 } });
```

## Screenshots

```ts
const canvas = chart.screenshot();
canvas.toBlob((blob) => {
  /* download or upload it */
});
```

`screenshot()` returns a canvas with the whole chart painted, every pane and axis.

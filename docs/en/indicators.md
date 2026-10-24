# Indicators

The indicators module has 50 indicators, from moving averages, MACD and RSI to Ichimoku and VWAP. The widely used ones compute and default as they commonly do around the world; those common in Chinese markets, such as KDJ and BIAS, follow the formulas of Chinese charting software.

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'BOLL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

## Loading

```ts
import { indicators, allIndicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators(allIndicators)] }); // all of them
createChart(container, { modules: [indicators([MA, MACD, RSI])] }); // just these
```

## Adding

```ts
const id = chart.indicators.add({ type: 'RSI' });
```

<!-- code-prelude
declare const id: string;
declare const userInput: import('@kumochart-sdk/core/indicators').IndicatorInput;
-->

`add()` returns the indicator's id: the `id` you give, or one the chart numbers by type, such as `rsi-1`. What you leave out takes the type's defaults; give what you want otherwise:

```ts
chart.indicators.add({
  type: 'MA',
  params: { periods: [20, 60, 120] }, // parameters
  source: 'hlc3', // the price it computes from, the close by default
  pane: 'main', // where: 'main', 'new' (a pane of its own) or the id of a pane
  scale: 'right', // which price scale of the pane
  colors: { ma20: '#e8b04a' }, // colors by output
  styles: { ma120: { lineWidth: 2, lineStyle: 'dashed' } }, // widths and styles by output, or hidden
  levels: [], // reference lines, such as RSI's 70 and 30; [] draws none
  visible: true
});
```

Indicators drawn over the bars, such as moving averages, default to `pane: 'main'`; oscillators such as MACD and RSI open a pane of their own. See [Panes](panes.md).

## Changing and removing

```ts
chart.indicators.update(id, { params: { period: 21 } });
chart.indicators.update(id, { colors: { rsi: null } }); // null restores the default color
chart.indicators.update(id, { levels: null }); // the default reference lines
chart.indicators.update(id, { visible: false }); // hidden
chart.indicators.update(id, { pane: 'new' }); // moved to a pane of its own; 'main' moves it back

chart.indicators.remove(id);
chart.indicators.list(); // every indicator
chart.indicators.get(id);
chart.indicators.set([{ type: 'MA' }, { type: 'RSI' }]); // replaces every indicator
chart.indicators.clear(); // removes every indicator
```

An indicator an [alert](alerts.md) watches cannot be removed before the alert, by `set()` and `clear()` neither.

## Reading values

```ts
chart.indicators.valuesAt(id); // the values at the latest bar
chart.indicators.valuesAt(id, 120); // at bar 120
// [{ key: 'rsi', label: 'RSI', value: 63.2, text: '63.20', color: '#…' }, …]
```

As the legend shows them: `text` in the indicator's decimals, `color` the line's. `value` is `null` on a bar where the line has none, such as before RSI has enough bars.

## An indicator of an indicator

`source` can be a line of another indicator, such as an EMA of RSI:

```ts
const rsiId = chart.indicators.add({ type: 'RSI' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: rsiId, key: 'rsi' },
  pane: rsiId // in RSI's pane
});
```

Without `key` it reads the other indicator's first line. An indicator another one reads cannot be removed first.

## In a timeframe of its own

`timeframe` computes an indicator in a timeframe longer than the chart's, such as an hourly moving average on 5-minute bars:

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('5m');

chart.indicators.add({ type: 'MA', params: { periods: [20] }, timeframe: '1h' }); // the 20-hour average
chart.indicators.add({ type: 'MA', params: { periods: [20] } }); // the 20-bar average of 5 minutes
```

Its hourly bars are built from the chart's source bars with the trading calendar, as [switching timeframes](timeframes.md#switching-timeframes) builds them, and follow the real-time data, the history loaded before, changes of the calendar and [replay](replay.md). The indicators of a timeframe share its bars.

**Waiting for the close**: each bar of the chart shows the value of the latest hourly bar closed by its end. An hourly bar is closed once the next one has started, so the value changes on the last 5-minute bar of each hour, in steps. No bar of the history uses data that was not there yet. The latest bar is the exception: it shows the hourly bar still forming, live. A bar ends where the next one starts, so the rule holds for periods that do not divide each other (5 minutes on 3-minute bars) and across weekends and breaks.

**Otherwise on the chart's bars**: while the chart's timeframe is not shorter than the indicator's (an hourly indicator on daily bars), the source bars cannot build it (see [which timeframes can be built](timeframes.md#which-timeframes-can-be-built)), or the bars shown are not bars of time (Renko bricks and the like, see [chart types](chart-types.md)), the indicator is computed on the chart's bars, as without a `timeframe`: it neither throws nor goes away, and comes back to its timeframe when the chart's bars allow. Transforms bar for bar, such as Heikin-Ashi, do not count. Lengths compare as they are for seconds, minutes and hours, a day as 24 hours, a week as 7 days and a month as 30 days.

`offset` shifts by bars of the indicator's timeframe: the leading spans of an hourly Ichimoku Cloud lie 26 hours ahead. A marker of a bar of the timeframe is drawn once. The legend writes the timeframe after the parameters, `MA 20 1h`, and [the saved state](state.md) keeps it.

```ts
chart.indicators.get(id)?.timeframe; // '1h', null without one
chart.indicators.update(id, { timeframe: '4h' }); // in 4 hours
chart.indicators.update(id, { timeframe: null }); // back on the chart's bars
```

An indicator of an indicator is computed in that one's timeframe, on its values, and shown the same way:

```ts
const hourlyRsi = chart.indicators.add({ type: 'RSI', timeframe: '1h' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: hourlyRsi }, // hourly too
  pane: hourlyRsi
});
```

Another `timeframe` given to it throws. `computeIndicator()` [without a chart](#without-a-chart) is unchanged: it computes on the bars of whatever timeframe it is given.

## Settings forms

The parameters of a type and their ranges are in its definition:

```ts
const definition = chart.indicators.definition('RSI');
definition?.params; // { period: { default: 14, min: 1, max: 2000, integer: true, label: 'RSI Length' }, … }
```

A parameter with `options` takes only those values (such as the type of a moving average): a select in a form. Check what users entered with `checkIndicatorInput()`, which throws the error `add()` would:

```ts
import { checkIndicatorInput } from '@kumochart-sdk/core/indicators';

checkIndicatorInput(chart.indicators.definition('RSI')!, userInput);
```

## Languages

Definitions name indicators and label their parts in English. For the legend and `valuesAt()` to follow the chart's `locale` in Chinese, Japanese or Korean, give the module the SDK's texts, `indicatorTexts`:

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

createChart(container, {
  modules: [indicators(allIndicators, { texts: [indicatorTexts] })],
  locale: 'zh-CN'
});
```

Without them, everything is in English, and `indicatorTexts` stays out of your bundle. Codes such as `MA` and `RSI` read alike in every language and are not translated.

For a settings form, `chart.indicators.title(type)` gives an indicator's full name, and `chart.indicators.label(text)` a label of its definition (of a line, a parameter or an option) in the chart's language:

```ts
chart.indicators.title('BOLL'); // 'Bollinger Bands'
chart.indicators.label('Period'); // 'Period'
```

Texts go by language, then by the English they translate; those given later win. Add your own for indicators of your own or to change some words; a label ending in a number, such as `Upper Band #2`, without words of its own takes those of `Upper Band #{n}`, with its number for `{n}`:

```ts
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

indicators(allIndicators, {
  texts: [indicatorTexts, { zh: { labels: { Upper: '上沿' } } }]
});
```

Without a chart, as for a settings form opened before it, `indicatorLanguage(texts, locale)` gives `title()` and `label()` by the same rules.

## The indicators

"Outputs" are the keys of the lines, for reading values, colors and [alerts](alerts.md). Types that take several periods at once, such as MA, have keys with the period, such as `ma20`.

### Moving averages

| Type        | Name                            | Defaults                  | Outputs                |
| ----------- | ------------------------------- | ------------------------- | ---------------------- |
| `MA`        | Simple moving average           | period 9                  | `ma9`                  |
| `EMA`       | Exponential moving average      | period 9                  | `ema9`                 |
| `SMMA`      | Smoothed moving average         | period 7                  | `smma7`                |
| `WMA`       | Weighted moving average         | period 9                  | `wma9`                 |
| `HMA`       | Hull moving average             | period 9                  | `hma9`                 |
| `VWMA`      | Volume-weighted moving average  | period 20                 | `vwma20`               |
| `ALMA`      | Arnaud Legoux moving average    | 9, offset 0.85, sigma 6   | `alma`                 |
| `KAMA`      | Kaufman adaptive moving average | 10, fast 2, slow 30       | `kama`                 |
| `ALLIGATOR` | Williams Alligator              | 13, 8, 5, shifted 8, 5, 3 | `jaw`, `teeth`, `lips` |
| `BBI`       | Bull and bear index (Chinese)   | 3, 6, 12, 24              | `bbi`                  |

### Channels

| Type       | Name                          | Defaults                                     | Outputs                                                                     |
| ---------- | ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `BOLL`     | Bollinger Bands               | 20, SMA, 2 standard deviations               | `basis`, `upper`, `lower`                                                   |
| `KC`       | Keltner Channels              | 20, EMA, 2 × ATR (10)                        | `upper`, `basis`, `lower`                                                   |
| `DC`       | Donchian Channels             | 20                                           | `basis`, `upper`, `lower`                                                   |
| `ICHIMOKU` | Ichimoku Cloud                | 9, 26, 52, displacement 26                   | `conversionLine`, `baseLine`, `laggingSpan`, `leadingSpanA`, `leadingSpanB` |
| `VWAP`     | Volume-weighted average price | from each trading day, a band of 1 deviation | `vwap`, `upperBand1`, `lowerBand1`                                          |

### Trend and stops

| Type         | Name                       | Defaults                | Outputs                    |
| ------------ | -------------------------- | ----------------------- | -------------------------- |
| `SAR`        | Parabolic SAR              | 0.02, 0.02, 0.2         | `parabolicSar`             |
| `SUPERTREND` | SuperTrend                 | 10, 3 × ATR             | `upTrend`, `downTrend`     |
| `CHANDELIER` | Chandelier Exit            | 22, ATR 22, 3 ×         | `longExit`, `shortExit`    |
| `DMI`        | Directional Movement Index | ADX smoothing 14, DI 14 | `adx`, `plus`, `minus`     |
| `AROON`      | Aroon                      | 14                      | `aroonUp`, `aroonDown`     |
| `FRACTALS`   | Williams Fractals          | 2                       | `downFractal`, `upFractal` |

### Oscillators

| Type       | Name                                    | Defaults                          | Outputs                           |
| ---------- | --------------------------------------- | --------------------------------- | --------------------------------- |
| `MACD`     | Moving average convergence divergence   | 12, 26, 9                         | `macd`, `signalLine`, `histogram` |
| `RSI`      | Relative strength index                 | 14, with an SMA of 14             | `rsi`, `rsiBasedMa`               |
| `STOCH`    | Stochastic                              | 14, %K smoothing 1, %D 3          | `k`, `d`                          |
| `STOCHRSI` | Stochastic RSI                          | %K 3, %D 3, RSI 14, stochastic 14 | `k`, `d`                          |
| `CCI`      | Commodity channel index                 | 20 (hlc3), with an SMA of 14      | `cci`, `cciBasedMa`               |
| `WR`       | Williams %R                             | 14                                | `wr14`                            |
| `ROC`      | Rate of change                          | 9                                 | `roc`                             |
| `MTM`      | Momentum                                | 10                                | `mom`                             |
| `TRIX`     | Triple exponential average              | 18                                | `trix`                            |
| `DPO`      | Detrended price oscillator              | 21                                | `dpo`                             |
| `FISHER`   | Fisher transform                        | 9 (hl2)                           | `fisher`, `trigger`               |
| `KDJ`      | KDJ (Chinese)                           | 9, 3, 3                           | `k`, `d`, `j`                     |
| `BIAS`     | Bias ratio (Chinese)                    | 6, 12, 24                         | `bias6`, `bias12`, `bias24`       |
| `PSY`      | Psychological line (Chinese)            | 12, 6                             | `psy`, `psyma`                    |
| `BRAR`     | BRAR (Chinese)                          | 26                                | `br`, `ar`                        |
| `DMA`      | Difference of moving averages (Chinese) | 10, 50, 10                        | `dif`, `difma`                    |

### Volume

| Type  | Name                   | Defaults          | Outputs           |
| ----- | ---------------------- | ----------------- | ----------------- |
| `VOL` | Volume                 | no moving average | `volume`          |
| `OBV` | On-balance volume      | no moving average | `onBalanceVolume` |
| `MFI` | Money flow index       | 14                | `mf`              |
| `CMF` | Chaikin money flow     | 20                | `cmf`             |
| `EMV` | Ease of movement       | 14, divisor 10000 | `eom`             |
| `VR`  | Volume ratio (Chinese) | 26, 6             | `vr`, `mavr`      |

### Volatility

| Type   | Name                | Defaults | Outputs |
| ------ | ------------------- | -------- | ------- |
| `ATR`  | Average true range  | 14, RMA  | `atr`   |
| `STD`  | Standard deviation  | 20       | `std`   |
| `CHOP` | Choppiness index    | 14       | `chop`  |
| `ADR`  | Average daily range | 14       | `adr`   |

### Periods and sessions

| Type       | Name                         | Defaults                                  | Outputs                                           |
| ---------- | ---------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `PIVOTS`   | Pivot points                 | traditional, the period after the chart's | `p`, `r1`, `s1` … `r5`, `s5`                      |
| `PREVHLC`  | Previous high, low and close | day                                       | `high`, `low`, `close`                            |
| `SESSIONS` | Trading sessions             | Tokyo, London, New York                   | `tokyoHigh`, `londonHigh`, `newYorkHigh` and more |

The pivot points follow the chart's interval by default: days on bars of 15 minutes or less, weeks on other intraday bars, months on daily bars, years on weekly and monthly bars; days when `data.set()` got no `interval`.

Every parameter and output of a type: `chart.indicators.definition(type)`, or the [API reference](../api.md#indicators).

## Coming from Chinese charting software

The differences to watch for:

- **MACD**: the histogram is the MACD line minus its signal line, not doubled. The lines are `macd`, `signalLine` and `histogram`.
- **RSI**: one line of 14 by default, reference lines at 70 and 30, and a moving average of 14; Wilder's smoothing, starting from a simple average of the first 14 changes.
- **WR**: from -100 to 0, 0 at the highest.
- **Moving averages**: MA and EMA default to one line of 9; for more, give `periods: [5, 10, 20, 30]`. An EMA starts from the simple average of its first values.
- **Volume**: no moving average by default; give `periods: [5, 10]` for some.

KDJ, BIAS, BRAR, PSY, DMA, VR and BBI are common in Chinese markets and compute as there.

## Without a chart

```ts
import { computeIndicator, RSI } from '@kumochart-sdk/core/indicators';

const { rsi } = computeIndicator(RSI, bars);
// rsi[i] is the value at bar i, as the chart computes it
```

To follow real-time data bar by bar, use `createIndicatorCalculator()`. Both depend on what you pass alone and run in Node.js, for example to evaluate alerts on a server. Indicators that follow trading days or the interval, such as VWAP and the pivot points, compute what the chart does once you pass its calendar and interval too: `{ calendar, interval: '15m' }`.

To compute one indicator from another (such as an EMA of RSI), feed the other's value on each bar with `nextOf(bar, value)`; the values are those of a chart whose `source` is the other indicator:

```ts
import { createIndicatorCalculator, EMA, RSI } from '@kumochart-sdk/core/indicators';

const rsi = createIndicatorCalculator(RSI);
const ema = createIndicatorCalculator(EMA, { params: { periods: [5] } });

for (const bar of bars) {
  const [value] = rsi.next(bar);
  const [smoothed] = ema.nextOf(bar, value); // bars where RSI has no value yet (NaN) are skipped, as on a chart
}
```

To write an indicator of your own, see [Custom indicators](custom-indicators.md).

# Changelog

The packages of KumoChart share one version. Each release lists what changed for those who use them.

## Unreleased

**Added**

- Twelve indicators, each in `allIndicators` and on its own for applications that pick a few:
  - `AD`, accumulation/distribution: the running total of each bar's volume weighted by where its close lies in its range.
  - `VO`, the volume oscillator: the short EMA of the volume against the long one, in percent.
  - `RVOL`, relative volume at time: the volume of the trading day so far against its average at the same time of the days before, or of the bar against the bars at that time; by weeks, months, quarters or years too, following the chart's calendar.
  - `CHAIKINOSC`, the Chaikin oscillator; `EFI`, Elder's force index; `KVO`, the Klinger oscillator with its signal line; `PVT`, the price volume trend.
  - `WVAD`, Williams' variable accumulation distribution with its average, as in Chinese charting software.
  - `HV`, historical volatility: the deviation of the log returns, annualized by the interval of the bars.
  - `MASS`, the mass index; `BBW`, Bollinger BandWidth with its highest expansion and lowest contraction; `BBP`, Bollinger Bands %B.

## 1.0.0-beta.4

**Breaking**

- The HLC area fills the band from the highs to the closes in `highFillColor` and the one from the closes to the lows in `lowFillColor`, rather than both in `fillColor`; by default the highs are cyan and the lows pink, each band a faint fill of its line's color.

**Fixes**

- Older bars added with `data.prepend()` or `series.prependData()` take the time of the bars they add, not of every bar the chart holds. Each page copied all the bars and built the bars of the timeframe again from all the source bars, so scrolling back through a long history stuttered more the further it went: most on bars built from many, as Kagi lines on a timeframe of minutes are, from hundreds of source bars each, which take page after page.
- The crosshair follows the pointer while a trackpad's fling scrolls or zooms the chart. The wheel events of a fling tell where it began, and the crosshair stayed there, catching up with the pointer only once the fling ended.
- A drawing dragged while the wheel zooms or scrolls the chart stays under the pointer: dragged as a whole it drifted by as much as the view moved, and a handle or a drawing being placed waited for the pointer to move again.
- Replacing the bars, as for another symbol with `data.set()`, switching the timeframe with `data.setTimeframe()`, the transform with `transforms.set()` or the calendar with `applyOptions()`, no longer scrolls the chart back to the latest bar. The view stays where it was, at its zoom: following the latest bar, the new latest bar shows where the old one did, as far from the right edge; looking back at history, the time at the right edge of the plot stays there. A time before the new bars shows the oldest of them, which `loadMore` asks to extend.

**Added**

- Thirteen drawing types, each in `allDrawings` and on its own for applications that pick a few:
  - `info-line`, a trend line showing the change of value and its percentage, the bars, the time and its angle between its anchors in a box under its middle.
  - `schiff-pitchfork` and `modified-schiff-pitchfork`, pitchforks whose median line starts halfway up the handle, in value alone or in time and value, for trends too steep for Andrews' fork.
  - `gann-fan`, rays from the first anchor at Gann's angles, 8×1 to 1×8, the 1×1 through the second anchor, alerts watching each by its angle, as `2×1`.
  - `abcd-pattern`, the harmonic ABCD with the retracements of BC and CD.
  - `elliott-triangle` (A to E), `elliott-double-combo` (W, X, Y) and `elliott-triple-combo` (W, X, Y, X, Z), labelled in the notation of their degree as the impulse and the correction are.
  - `cyclic-lines`, vertical lines repeating the span between the anchors on to the right edge, to time cycles.
  - `highlighter`, a wide see-through freehand stroke drawn while the button is held, as the brush is.
  - `rotated-rectangle`, a rectangle at any angle, along a sloping channel or a flag: its middle line between the first two anchors, as wide on each side as the third is from it, with handles at the ends of that line, which turn it at its width, and at its corners, which widen it.
  - `arrow-mark-up` and `arrow-mark-down`, arrows under or above a point in the colors of up and down, with a text of their own.
- `crosshair.snapToBars`, on by default: off, the vertical line follows the pointer smoothly rather than stepping from bar to bar, its time label and the legend those of the bar under it.
- `loadMore` says in `bars` how many more of the bars shown the view wants before the first, the room left empty on the left included, so that bars built from many, as Kagi lines are, can be filled at once.
- `DrawingSpace.unitHeight`, how tall a unit of the scale is on screen in widths of a bar, for `moveHandle()` to keep angles and lengths as the screen shows them.

## 1.0.0-beta.3

**Fixes**

- In a time zone whose clocks change within an hour of UTC, as at 15:30 UTC in a zone of +10:30 (Adelaide, St. John's, Lord Howe Island), the half hour after the change showed times, and cut days and sessions, by the offset before it.
- Lifting one of three fingers from a pinch no longer makes the chart jump at the next move: the two fingers left pinch on from where they are.
- The axis labels of a drawing stay at their own places when one of its points is off the scale, as on a logarithmic scale; they were shifted onto the points after it.
- Boxes sized by `params.percentage`, of Renko, Kagi and point-and-figure charts, take the percentage of the latest closed close, as the documentation says, rather than of the bar still forming.
- A value area of the whole volume, `valueArea: 1`, takes every row; a rounding could leave out the last.
- The steps of the price axis below 1 are no longer raised a level on engines whose negative powers of ten are not exact, as 0.0005 to 0.001.
- `loadState()` names the field of a pane that has no `range`, instead of throwing a `TypeError`.

## 1.0.0-beta.2

**License**: from this release on, the packages are licensed under [Apache-2.0](LICENSE), with a [NOTICE](NOTICE) asking websites and apps that use KumoChart to credit it with a link to kumochart.com; 1.0.0-beta.1 stays MIT.

**Breaking**

- `calendar.timeZone` is `UTC` by default, as crypto exchanges cut their bars, rather than the zone the chart shows times in; it is always a zone, no longer `null`. Bars given in an exchange's time need its zone, such as `America/New_York`.
- Bars of minutes and hours given with an `interval` must start where the trading calendar starts one: `data.set()`, `update()` and `prepend()` throw for a bar the calendar would start elsewhere, and so does `applyOptions()` for a calendar the bars do not fit. Such bars used to be moved, or merged with the bar before. Bars of days, weeks and months go by their trading date, whatever time of it dates them: days dated at midnight are no longer dropped by a calendar with sessions, and trades fold into the day of their date.
- `data.addTrades()` skips late trades, before the last bar or the latest trade, as a stream may deliver after it reconnects, instead of throwing for the whole batch.
- Getters are named by what they give, as `options()` and `selection()` are: `timeScale.getVisibleRange()`, `getVisibleLogicalRange()` and `getBarSpacing()` are `visibleRange()`, `visibleLogicalRange()` and `barSpacing()`, and a price scale's `getRange()`, `getMode()` and `getMargins()` are `range()`, `mode()` and `margins()`. A series type asks `points.isUp(i)` whether a point rose, which was `points.up(i)`.
- `crosshair.clear()` is `crosshair.set(null)`: a slot of one value is emptied by setting it to `null`, as `select(null)`, `transforms.set(null)` and `setTimeframe(null)` are.
- `plugins.list()` gives the plugins, in the order they paint, rather than their names, as every `list()` gives what it lists.
- Every collection of the chart, series, indicators, drawings, volume profiles, panes, orders, markers and alerts, has the same methods meaning the same: `add()` returns the id, the one given or one the chart numbers by type or kind, such as `rsi-1`, never twice in a chart's life; `set()` replaces every item, an invalid input changing nothing, and `clear()` removes them all; `update()` and `remove()` throw for an unknown id, and `get()` returns `null` for one. The `id` of a pane, an order, a marker or an alert may be left out now, numbered `pane-1`, `order-1`, `marker-1` and `alert-1` on, and indicators, series and volume profiles have `set()` and `clear()`. Panes have neither: the main pane always stays, and a pane cannot go while indicators or series are in it.
- What the API returns has `null` where it has no value, never a field left out: `transforms.get().resolved` is `null` while the transform reports nothing, and `alertDrag`'s `bound` is `null` for the line of one level.
- `createModule()` takes one definition, `{ name, options, install }`, rather than a name and a function; `install` receives the chart and a context.
- Charts are light unless given a theme: `lightTheme` is the default; pass `theme: darkTheme` for the dark one.
- An option left unset is `null`, and setting `null` unsets it again: `locale`, `timeZone`, `legend.rows`, `legend.buttons`, `panes.separatorColor` and `panes.separatorHoverColor` were `undefined`, which a patch skips, so none could go back to its default. Each word of `texts` and `drawings.texts` is `null` until replaced, `mainSeries.styles` takes `null` for a type to drop its overrides, and the formatters' contexts get the `locale` and `timeZone` in effect, always strings.
- The margins of the chart and of a scale go by one rule: at least 0 each, at most 0.9 together, for `priceScale.margins` and `setMargins()` alike.
- One rule says where the bars zoom from, and `interaction.wheelZoomAnchor` is gone: while the view follows the latest bar, it stays put; otherwise the bar under the pointer stays as the wheel, a trackpad, a pinch or a drag of the time axis zooms, and the bar in the middle as the keys or the API zoom.
- A destroyed chart throws for reads too, on its namespaces and price scales as well; `destroy()` again does nothing.
- `IndicatorDefinition.fills` is a function of the parameters, as `outputs` and `levels` are, and a definition is checked alike with a chart and without: its type, its source and its functions.
- Drawing types get their anchors as many as they have: `DrawingTypeDefinition<Anchors<2>>` gets a pair, typed so, in `DrawingGeometry` and `DrawingPaintContext`; `Positions<A>` types their positions.
- Every line of a drawing at a level is named by its value as its label writes it, up to three decimals: a regression trend's lines are `2`, `-2` and `0`, no longer `+2`, `-2` and `base`, and an anchored VWAP's bands `1` and `-1`; alerts on them name them so.

**Added**

- A module made with `createModule()` adds a section of options of its own, emits events of its own and keeps a part of the saved state, through the context `install` receives, as the SDK's modules do.
- The building blocks of the SDK's indicators are exported for custom ones: `movingAverage()`, `Previous`, `RingBuffer`, `RollingExtremes` and `StandardDeviation`.
- `optionsChange` reports every setting of the options, by `applyOptions()` and `loadState()`, with the options before and after.
- `intervalDuration()` gives the length of an interval of seconds, minutes or hours; `volumeProfileGrid()` and `checkVolumeProfileOptions()` divide and check a profile of your own, such as one of trades, as the chart's volume profiles do.
- `LINE_STYLES` lists the line styles, as `PRICE_SOURCES` lists the prices, for the forms of an application.
- `checkColor()` checks a color as the chart does, and `indicatorLanguage()` gives the words of indicators in a locale without a chart, for the forms of an application.
- The words of indicators follow the chart's `locale`: `indicators(types, { texts })` takes them by language, and `indicatorTexts` brings those of the SDK's indicators in English, Chinese, Japanese and Korean, left out of a bundle that does not import it. `chart.indicators.title()` and `label()` give names and labels for a settings form. For a page without a bundler, they are a script of their own, `kumochart-indicator-texts.iife.js`, as `KumoChartIndicatorTexts`, and `allModules({ indicators: { texts } })` gives them to the indicators.
- The watermark module, `watermark()` from `@kumochart-sdk/core/watermark`, shows lines of large faint text, such as the symbol and its timeframe, in the middle of the main pane, from its `watermark` option.
- Trades carry the side of their taker, `side: 'buy' | 'sell'`, which transforms built from the trades receive as `next(bar, side)`; `series.addTrades()` folds trades into a series, such as a symbol compared, as `data.addTrades()` folds them into the main bars: into its bars, or for a line or another series of values, into a value per source interval, the price of its last trade.
- Trades carry the side of their taker, `side: 'buy' | 'sell'`, which transforms built from the trades receive as `next(bar, side)`; `series.addTrades()` folds trades into a series of bars, such as a symbol compared, as `data.addTrades()` folds them into the main bars.
- Indicators of a timeframe of their own: `timeframe: '1h'` computes an indicator on hourly bars built from the source bars with the trading calendar, as the chart builds its timeframe, while the chart shows shorter bars, such as 5-minute ones. Each bar of the chart shows the value of the latest hourly bar closed by its end, so no bar uses data that was not there yet, and the latest bar the hourly bar still forming. On a timeframe as long or longer, one the source cannot build, or bars without time such as Renko bricks, the indicator is computed on the chart's bars. An indicator of an indicator is computed in that one's timeframe. `Indicator.timeframe`, the legend (`MA 20 1h`) and the saved state give it.

**Fixes**

- Rays, extended lines and the extended sides of trend lines, channels, fans and pitchforks cross the plot however far before it their anchors are; they used to fall short a few hundred bars back, neither drawn nor clickable, while alerts still watched them.
- Alerts on Renko, Kagi, point & figure and other bars a transform builds no longer fire on ticks that change nothing, and `once-per-bar-close` takes only the bars completed from closed bars as closed.
- A transform that fails on the bars, such as a Renko box far too small for the prices, changes nothing, from `transforms.set()` and `loadState()` alike; nor do options a calendar cannot take, nor a module failing as the chart is created, which left the chart's element in the container.
- A plugin, series type or drawing type whose painting throws no longer leaves the canvas clipped to its pane for the frames after.
- Generated ids never name a new drawing, indicator, series or volume profile after one that is gone, also for the drawings `drawings.set()` brings without ids and after `loadState()`; an alert waiting for a removed drawing no longer watches a new one. What a list brings without ids is numbered after the ids it gives, and what fails to be added takes no number.
- `fitContent()`, `setVisibleRange()` and `scrollToIndex()` called while the chart has no width, as in a hidden tab, take effect once it has one.
- Heikin-Ashi candles show prices with the decimals of the market, not seven.
- Keys the chart does nothing with, as Ctrl/⌘ + Z with nothing to undo or Escape with nothing to cancel, are left to the page, and so are Ctrl/⌘ and Alt with the keys that move the chart, as Ctrl + - zooming the page and Alt + ← going back.
- `chartTypes()` checks its types, and rejects one given twice, before a chart is created; `loadState()` names a missing `mainSeries`, `panes` or `view`.
- `alerts.set()` changes nothing for an invalid alert; an alert before it in the list, of a condition unchanged, took its new settings.
- Colors are checked as they are given, in options, styles, indicators, drawings, series, volume profiles, orders, markers and alerts: a misspelled one throws at once, naming its field, instead of failing, or painting in another color, when it is drawn.
- An alert or order line dragged in a pane of compact numbers, as of an indicator of tiny values, keeps values of their size; it was rounded to whole numbers, and so to 0.
- The legend names the one value of an indicator once, in its title: `MA 9 68,000.00` rather than `MA 9 MA9 68,000.00`. Indicators of several values still name each.
- The displacement of the Ichimoku Cloud is labelled `Displacement`, no longer `Lagging Span` as its line is.
- Series show beside a chart of a single bar, as after a timeframe that folds the bars into one; they showed nothing.
- Kagi lines and point & figure columns keep the volume of every bar, the bars of a reversal included; automatic box sizes wait for the closed bars to give them; bars of several days take that many trading days; series added without points follow the timeframe too; coordinate conversions check what they convert.
- Positions on bars a transform builds close on the real prices behind them; anchored VWAPs and regression trends keep a bounded number of series; a position placed from right to left spans the bars between the clicks, and a short one shows its gains as gains.
- Placing drawings: a finger places its anchor where it lifts; two clicks on one spot place no drawing of no length, nor does a tool place one that shows nothing; a press that is lost takes back the anchor it placed; one rule picks the drawing under the pointer; a drawing's bounds cover what it draws; the text editor opens at the type's text anchor and closes with its drawing; a copied drawing goes with its pane when a loaded layout has none.
- Alerts: leaping over a whole channel neither enters nor exits it. Indicators: `nextOf()` computes exactly what a chart computes from another indicator; pivot points left to Auto follow the chart's interval; compact values under 1, such as EMV's, keep their digits.
- Rendering and interaction: the crosshair's labels leave out the ticks under them; the price axis is wide enough for the countdown, which ticks exactly while shown; labels of orders and alerts crowded at the bottom move up; columns are drawn on a logarithmic scale; a line of zeros gets an axis of ticks; a right axis with nothing of its own shows the left one; reading a price scale no longer creates it; dragging a separator moves only it while the panes do not fit, and the main pane keeps its minimum height; a pinch begun with one finger above the other zooms smoothly; `crosshairMove` follows what is under a pointer at rest; a read dispatches its events after it, as any call does; destroying a chart releases everything, also when a step fails.
- The Vue and React components forward every event the core lists, and build the timeframe once.

**Performance**

- Panning and zooming build one frame a frame; the wheel zooms, and hovering highlights, in the next frame; a fling or a zoom that cannot move the bars stops.
- Drawings out of view are neither painted nor hit-tested, their styles are worked out once, a tool or a drag repaints the series only where it must, and the steps to undo share the drawings that did not change.
- A tick computes only the volume profile of its trading day again; markers look up the bars in view only; styles of series and tints of colors are worked out once, and bars of many chosen colors are drawn in one pass.

## 1.0.0-beta.1

The first release on npm: `@kumochart-sdk/core`, `@kumochart-sdk/vue` and `@kumochart-sdk/react`.

- **Core**: bars, price and time scales, panes, crosshair, legend, zoom and pan; 1-minute bars build any timeframe in the browser, following trading sessions and time zones; bars and trades stream in; the chart's state saves and loads.
- **Modules**, each loaded whole or only the parts you pick: 50 indicators, 38 drawing tools, 10 chart types, alerts, order lines and markers, replay, and volume profiles of the bars in view, of each trading day and of a range drawn on the chart.
- **Without a chart**: `computeIndicator()`, `createIndicatorCalculator()` (with `nextOf()` for an indicator computed from another) and `computeVolumeProfile()` run in Node.js too.
- **Extensible**: indicators, drawing types, series types, bar transforms and plugins of your own work like the built-in ones.
- **Strict inputs**: a misspelled field of any input or option throws instead of going unnoticed.
- **Vue and React** components, and complete TypeScript types.

Documentation in English, Chinese, Japanese and Korean: [docs.kumochart.com](https://docs.kumochart.com/).

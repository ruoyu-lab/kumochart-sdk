import type { Bar, PriceSource } from '../data/types';
import type { Interval } from '../feed/interval';
import type { SeriesStyleOverrides, SeriesType } from '../series/styles';

/** The ways a line is stroked. */
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;

export type LineStyle = (typeof LINE_STYLES)[number];

/** Colors used across the chart. Series, indicator and object styles derive their defaults from it. */
export interface Theme {
  background: string;
  text: string;
  textMuted: string;
  grid: string;
  border: string;
  crosshair: string;
  crosshairLabelBackground: string;
  crosshairLabelText: string;
  /** Bullish candles, rising values. */
  up: string;
  /** Bearish candles, falling values. */
  down: string;
  volumeUp: string;
  volumeDown: string;
  /** Selection handles and highlighted objects. */
  accent: string;
  /** Default colors for drawings, indicators and additional series, in order; at least one. */
  palette: readonly [string, ...string[]];
  buy: string;
  sell: string;
  alert: string;
}

export interface FontOptions {
  family: string;
  /** Axis and label font size in CSS pixels. */
  size: number;
}

export interface GridOptions {
  vertical: boolean;
  horizontal: boolean;
  style: LineStyle;
}

export interface CrosshairOptions {
  /** `magnet` snaps the horizontal line to the close of the hovered bar. */
  mode: 'magnet' | 'free';
  vertical: boolean;
  horizontal: boolean;
  /** Shows the time and price labels on the axes. */
  labels: boolean;
  style: LineStyle;
}

/** Formats a time label. `kind` tells where the label is shown. */
export type TimeFormatter = (time: number, context: TimeFormatContext) => string;

export interface TimeFormatContext {
  kind: 'axis' | 'crosshair';
  /** For axis labels: the calendar boundary the tick sits on. */
  unit: TimeUnit;
  /** The locale the chart writes in: its `locale`, or the runtime's. */
  locale: string;
  /** The zone the chart shows times in: its `timeZone`, or the local one. */
  timeZone: string;
}

export type TimeUnit = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

/** Formats a price label. `value` is already converted for percent/indexed scales. */
export type PriceFormatter = (value: number, context: PriceFormatContext) => string;

export interface PriceFormatContext {
  paneId: string;
  mode: PriceScaleMode;
  precision: number;
  /** The locale the chart writes in: its `locale`, or the runtime's. */
  locale: string;
}

export type PriceScaleMode = 'normal' | 'log' | 'percent' | 'indexed';

/**
 * Empty space above and below the auto-scaled range of a price scale, as fractions of the pane
 * height: each at least 0, and together at most 0.9.
 */
export interface ScaleMargins {
  top: number;
  bottom: number;
}

export interface PriceScaleOptions {
  visible: boolean;
  /** Empty space above and below the auto-scaled range. */
  margins: ScaleMargins;
  /** Decimals of main-series prices, or `auto` to infer them from the data. */
  precision: number | 'auto';
  formatter: PriceFormatter | null;
  /** Minimum axis width in CSS pixels; the axis grows to fit its labels. */
  minWidth: number;
}

export interface TimeScaleOptions {
  visible: boolean;
  /** Axis height in CSS pixels. */
  height: number;
  /** Initial distance between bars in CSS pixels. */
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  /** Empty space after the latest bar, in CSS pixels, when the chart follows real time. */
  rightOffset: number;
  /** `loadMore` fires when fewer than this many bars remain hidden on the left. */
  loadMoreThreshold: number;
  formatter: TimeFormatter | null;
}

export interface LatestPriceOptions {
  line: boolean;
  label: boolean;
  /**
   * Shows the time left until the current bar closes under the price label, for bars of periods
   * of time, not while replaying, and not once the bar has closed.
   */
  countdown: boolean;
  style: LineStyle;
  /**
   * Color of the line and the label; `null` follows the latest bar, rising or falling, in the
   * main series' colors.
   */
  color: string | null;
}

/** A row of the legend: the main series, an indicator, or a series added to the chart. */
export interface LegendItem {
  readonly kind: 'main' | 'indicator' | 'series';
  /** The indicator's or the series' id; `main` for the main series. */
  readonly id: string;
  /** The indicator's type; `null` for series. */
  readonly type: string | null;
  readonly paneId: string;
  /** Hidden indicators and series are listed only if `rows` asks for them, dimmed. */
  readonly visible: boolean;
}

/** A button of a legend row. */
export interface LegendButton {
  readonly id: string;
  /** SVG path data drawn in a 24 × 24 box, e.g. from an icon set. */
  readonly icon: string;
}

export interface LegendOptions {
  /** Shows the OHLC values and indicator values of the hovered (or latest) bar in each pane. */
  visible: boolean;
  /**
   * Which rows to list; `null` (default) lists the main series and the visible indicators and
   * series. List hidden ones too, and they show dimmed, e.g. for a button that shows them again.
   */
  rows: ((item: LegendItem) => boolean) | null;
  /**
   * Buttons shown after the title of the row under the pointer, such as hide, settings and remove.
   * A click emits `legendButtonClick`. `null` (default) shows none.
   */
  buttons: ((item: LegendItem) => readonly LegendButton[]) | null;
  /** Hides the values of the row under the pointer while its buttons show. */
  hideValuesOnHover: boolean;
}

/** Words that replace those a chart or a module paints, each `null` while it is not replaced. */
export type TextOverrides<Texts> = { [K in keyof Texts]: Texts[K] | null };

/** Words the chart paints on the canvas, alike in every language unless they are set. */
export interface ChartTexts {
  /** Labels of the main series' open, high, low, close and volume in the legend: `O`, `H`, … */
  legendOpen: string;
  legendHigh: string;
  legendLow: string;
  legendClose: string;
  legendVolume: string;
  /** Whole days of the countdown to the bar's close, `2d` in `2d 03:15:00`. */
  days: (count: number) => string;
}

export interface InteractionOptions {
  /** Drag the plot to scroll through time. */
  pan: boolean;
  /** Mouse wheel and trackpad zoom. */
  wheelZoom: boolean;
  /** Two-finger pinch zoom on touch screens. */
  pinchZoom: boolean;
  /** Drag the axes to scale them; double-click the price axis to reset auto-scale. */
  axisScale: boolean;
  /** Keeps scrolling briefly after a quick pan is released. */
  kineticScroll: boolean;
  /** Arrow keys, +/-, Delete, Escape and undo/redo shortcuts while the chart has focus. */
  keyboard: boolean;
  /** Touch press duration that switches a touch into crosshair mode. */
  longPressMs: number;
  /** Shows a magnifying loupe above the finger while placing anchors or dragging objects by touch. */
  touchMagnifier: boolean;
  /** Pointer distance in CSS pixels that counts as a hit on an object, such as a drawing. */
  hitTolerance: number;
}

export interface PaneOptions {
  /** Height in CSS pixels of a newly created pane. */
  defaultHeight: number;
  /** Panes never shrink below this height while resizing. */
  minHeight: number;
  /** Height of the draggable separator between panes. */
  separatorHeight: number;
  /** Width in CSS pixels of the line drawn along the separator; `0` draws none. */
  separatorWidth: number;
  /** Color of that line; `null` (default) takes the theme's `border`. */
  separatorColor: string | null;
  /**
   * Color of the line under the pointer and while it is dragged; `null` (default) takes the
   * theme's `crosshair`.
   */
  separatorHoverColor: string | null;
}

export interface PerformanceOptions {
  /** Caps the canvas pixel ratio to limit memory use on very dense screens. */
  maxPixelRatio: number;
  /**
   * How many of the latest trades passed to `data.addTrades()` the chart keeps for bar types
   * built from trades, such as tick bars; older ones go, the bars built from them staying until
   * the bars are rebuilt. `0` keeps none.
   */
  maxTrades: number;
}

export interface MainSeriesOptions {
  /** A built-in series type such as `candles`, `line` or `area`, or a registered custom type. */
  type: SeriesType;
  /** The price a line-like main series plots. */
  source: PriceSource;
  /** Style overrides keyed by series type, so switching types keeps each type's style. */
  styles: SeriesStyleOverrides;
  /**
   * Colors single bars: return a color, or `null` for the style's up or down color. Called for
   * every visible bar when the chart repaints; candles, hollow candles, OHLC and high-low bars
   * use it.
   */
  barColor: ((bar: BarColorContext) => string | null) | null;
}

/** What `mainSeries.barColor` receives for one bar. */
export interface BarColorContext {
  /** Index of the displayed bar. */
  readonly index: number;
  readonly bar: Bar;
  /** Output `key` (default: the first) of an indicator drawn on this bar; `NaN` where it has none. */
  readonly indicator: (id: string, key?: string) => number;
}

/**
 * Overrides the built-in bucketing: returns the start of the bucket `time` belongs to, or `null`
 * to drop the time (a holiday or a halt). `fallback` is the built-in result for the same interval.
 * Buckets must not decrease with time.
 */
export type CalendarBucket = (
  time: number,
  interval: Interval,
  fallback: (time: number) => number | null
) => number | null;

/** The trading calendar that aggregates source bars and trades into timeframes. */
export interface CalendarOptions {
  /**
   * Zone the trading calendar is defined in, as the data times its bars: `UTC` (the default), as
   * crypto exchanges do, or the zone of an exchange, such as `America/New_York`. The chart's
   * `timeZone` only shows the times.
   */
  timeZone: string;
  /**
   * Trading sessions of a trading day as `'HH:MM-HH:MM'`; an end before its start crosses
   * midnight. Times outside every session are dropped. Empty: trading around the clock.
   */
  sessions: readonly string[];
  /**
   * Wall-clock time a trading day starts. From this time on, times belong to the next date, e.g.
   * `'21:00'` for night sessions or `'17:00'` for FX.
   */
  dayStart: string;
  /**
   * Weekdays that are trading days (0 = Sunday). A trading date on another weekday moves to the
   * next trading weekday, so a Friday night session belongs to Monday.
   */
  weekdays: readonly number[];
  /** First day of a week bar (0 = Sunday). */
  weekStart: number;
  bucket: CalendarBucket | null;
}

export interface ChartOptions {
  /** Follows the container size with a `ResizeObserver`. When false, call `chart.resize()`. */
  autoSize: boolean;
  /** BCP 47 locale for numbers and dates; `null` (default) uses the runtime's. */
  locale: string | null;
  /** IANA time zone such as `Asia/Shanghai`; `null` (default) uses the local time zone. */
  timeZone: string | null;
  /** The chart's colors: `lightTheme` by default, or `darkTheme`, or one of your own. */
  theme: Theme;
  font: FontOptions;
  grid: GridOptions;
  crosshair: CrosshairOptions;
  mainSeries: MainSeriesOptions;
  timeScale: TimeScaleOptions;
  priceScale: PriceScaleOptions;
  latestPrice: LatestPriceOptions;
  legend: LegendOptions;
  interaction: InteractionOptions;
  panes: PaneOptions;
  calendar: CalendarOptions;
  performance: PerformanceOptions;
  /** Overrides of the words the chart paints, such as the legend's labels; `null` keeps a word. */
  texts: TextOverrides<ChartTexts>;
}

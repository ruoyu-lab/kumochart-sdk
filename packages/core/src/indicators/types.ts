import type { Bar, PriceSource } from '../data/types';
import type { MarkerShape } from '../canvas/shapes';
import type { Calendar } from '../feed/calendar';
import type { Interval, IntervalInput } from '../feed/interval';
import type { LineStyle } from '../options/types';

/** One of the values a parameter takes, and its name. */
export interface ParamOption {
  readonly value: number;
  readonly label: string;
}

/**
 * Constraints of a numeric parameter. Array defaults accept up to 8 values, such as MA periods,
 * at least one unless the default is empty, such as the volume's averages.
 */
export interface ParamSpec {
  default: number | readonly number[];
  min?: number;
  max?: number;
  integer?: boolean;
  /** Shown in the legend and in parameter UIs. Defaults to the parameter key. */
  label?: string;
  /**
   * The only values the parameter takes, each named: the legend shows the name instead of the
   * number, and a parameter UI can offer the names as a select. E.g. the VWAP anchor.
   */
  options?: readonly ParamOption[];
  /**
   * Shows the value in the legend after the indicator's name. Default `true`; `false` for
   * settings that need no mention there, such as the type of a smoothing average.
   */
  legend?: boolean;
}

export type ParamValues = Record<string, number | readonly number[]>;

export type IndicatorPlot =
  /** A polyline, `width` CSS pixels wide (0.5 to 10, default 1.25) unless the user sets one. */
  | { readonly kind: 'line'; readonly style?: LineStyle; readonly width?: number }
  /**
   * A horizontal line through each run of bars with the same value, from the left edge of the
   * run's first bar to the right edge of its last; a new value starts a new line. For levels that
   * hold over a period, such as the pivot points of a trading day.
   */
  | { readonly kind: 'segments'; readonly style?: LineStyle; readonly width?: number }
  /**
   * A box over each run of consecutive bars with values, from the lowest value of output `from`
   * to the highest of this one in the run, shaded and outlined in this output's color: the range
   * of a session from its high and low so far, which grows with the latest run.
   */
  | {
      readonly kind: 'box';
      /** The key of the output the boxes reach down to. */
      readonly from: string;
      /**
       * The key of an output whose value tells the boxes apart, such as the start of a session:
       * a bar where it changes starts a new box, also right after the last one.
       */
      readonly group?: string;
    }
  /**
   * Columns from zero in the theme's up and down colors by the sign of the value, its change, or
   * the bar direction; all in the color of the output when it has one, fixed or set.
   */
  | { readonly kind: 'histogram'; readonly colorBy: 'sign' | 'change' | 'bar' }
  /**
   * Columns in the output's color from another output's value, or from a fixed value, to this
   * one, on the bars where both are defined: candle-like bodies or highlighted bars.
   */
  | {
      readonly kind: 'columns';
      /** The key of the output the columns start at, or a value such as `0`. */
      readonly from: string | number;
      /** Width as a share of the bar spacing, from 0 to 1. Default `0.6`. */
      readonly width?: number;
      /** Draws the outline only. */
      readonly hollow?: boolean;
    }
  /**
   * A shape, a text or both at the value, on the bars where it is defined: signals such as an
   * arrow under the bar a crossing happens on. Upward shapes point up at the value from below
   * and downward shapes down at it from above; circles and squares sit on it. Text goes beyond
   * the shape, or on the value without one. Without a color, arrows and triangles take the
   * theme's buy and sell colors.
   */
  | {
      readonly kind: 'marker';
      readonly shape?: MarkerShape;
      readonly text?: string;
      /** Half the width of the shape in CSS pixels, as for chart markers. Default `5`. */
      readonly size?: number;
    }
  /** Not drawn; only shown in the legend and available to alerts. */
  | { readonly kind: 'hidden' };

export interface IndicatorOutput {
  readonly key: string;
  readonly label: string;
  readonly plot: IndicatorPlot;
  /** Fixed color. Lines without one take theme palette colors in order. */
  readonly color?: string;
  /** Takes the theme's `up` or `down` color unless a fixed color is set, e.g. for an uptrend. */
  readonly themeColor?: 'up' | 'down';
  /**
   * Whole bars to shift the plot by: the value computed on bar `i` is drawn on bar `i + offset`,
   * to the right when positive (past the latest bar, such as the leading spans of Ichimoku) and to
   * the left when negative; bars of the indicator's timeframe when it has one. The legend,
   * `valuesAt()`, alerts and `barColor` read the value drawn on a bar. Default `0`.
   */
  readonly offset?: number;
  /**
   * Shows the value in the legend. Default `true`; turn it off for values that only place a
   * drawing, such as where columns start or where a marker sits.
   */
  readonly legend?: boolean;
  /**
   * Decimals of this output in the legend and `valuesAt()`, in place of the indicator's
   * precision, e.g. for a percentage among prices.
   */
  readonly precision?: number;
  /**
   * Takes part in fitting the price scale to what is in view. Default `true`; `false` for levels
   * that can lie far from the price, such as the outer pivot points, which would squash the bars:
   * they are drawn where they are and may leave the plot. A scale with nothing else to fit fits
   * them all the same.
   */
  readonly autoscale?: boolean;
}

/**
 * Shades the area between two outputs where both are drawn, such as Bollinger Bands; a `hidden`
 * output bounds a shade too. Between two `segments` outputs the area steps with them, bar by bar.
 */
export interface IndicatorFill {
  readonly from: string;
  readonly to: string;
  /**
   * `from` (default) shades the area in the color of `from`; `higher` in the color of whichever
   * output is higher, split exactly where the lines cross, such as the Ichimoku cloud.
   */
  readonly colorBy?: 'from' | 'higher';
}

/**
 * Incremental calculator. `next()` consumes one bar and returns one value per output (`NaN` while
 * warming up). The engine may call `clone()` to keep a checkpoint, so every state must be copied.
 *
 * `bar` is reused between calls and must not be retained; `price` is the configured source price.
 */
export interface IndicatorStream {
  next(bar: Bar, price: number): ArrayLike<number>;
  clone(): IndicatorStream;
}

/**
 * What a calculator knows beyond the bars. The chart computes its indicators again when the
 * calendar or the interval changes.
 */
export interface IndicatorContext {
  /**
   * The chart's trading calendar (the `calendar` option): `calendar.bucket(bar.time, '1D')` is
   * the start of the trading day of a bar, `'1W'` of its week, `'1M'` of its month.
   */
  readonly calendar: Calendar;
  /**
   * The interval of the bars: the indicator's timeframe while it is computed in it, else the
   * chart's timeframe, or the source interval when it shows the source bars; `null` for bars
   * given without one. Bars a transform builds, such as Renko bricks, have the interval of the
   * bars they are built from.
   */
  readonly interval: Interval | null;
}

/** A window of the most recent bars, oldest first. */
export interface BarWindow {
  readonly length: number;
  bar(index: number): Bar;
  price(index: number): number;
}

/** What every indicator type has, whichever way it computes its values. */
export interface IndicatorDefinitionBase<P extends ParamValues> {
  /** The type indicators of it are added by, such as `MACD`. */
  readonly type: string;
  /** Display name, such as `MACD` or `Ichimoku`. */
  readonly name: string;
  /** Overlays share the main pane; oscillators get a pane of their own by default. */
  readonly pane: 'main' | 'new';
  /** Price the calculator receives when the indicator names no source. Default `close`. */
  readonly source?: PriceSource;
  readonly params: { readonly [K in keyof P]: ParamSpec };
  outputs(params: P): readonly IndicatorOutput[];
  /** Horizontal reference lines, such as RSI 30/70. */
  levels?(params: P): readonly number[];
  /** Shades between outputs the parameters make, such as the bands they turn on. */
  fills?(params: P): readonly IndicatorFill[];
  /**
   * Decimals of the values, `price` to follow the main series precision, or `volume` for values
   * of any size in few characters, such as `1.25M`, `0.00412` or `4.12E-10`.
   */
  readonly precision: number | 'price' | 'volume';
  /** Fixed scale range of the pane, such as 0..100 for RSI. */
  readonly range?: { readonly min: number; readonly max: number };
}

/**
 * An indicator type. Implement either `create()` for full incremental control, or `lookback` and
 * `compute()` to derive each value from the latest bars only.
 */
export type IndicatorDefinition<P extends ParamValues = ParamValues> = IndicatorDefinitionBase<P> &
  (
    | { create(params: P, context: IndicatorContext): IndicatorStream }
    | {
        lookback(params: P): number;
        compute(window: BarWindow, params: P, context: IndicatorContext): ArrayLike<number>;
      }
  );

/**
 * Another indicator's output used as the input of an indicator, e.g. a moving average of RSI. Its
 * values are read by the bar they are computed on, and the reading indicator is drawn shifted by
 * the same `offset`.
 */
export interface IndicatorReference {
  kind: 'indicator';
  id: string;
  /**
   * Output key. Without it the indicator reads the first output, whatever it is named, so it
   * keeps working when the upstream parameters (and so its keys, such as `rsi6`) change.
   */
  key?: string;
}

export interface IndicatorInput {
  /** Generated when omitted. */
  id?: string;
  type: string;
  /** Overrides of the definition's parameter defaults. */
  params?: ParamValues;
  /** `main`, `new` (a pane of its own) or the id of an existing pane. */
  pane?: string;
  /**
   * Price scale in the pane: `right` (default), `left`, or any other name for an overlay scale of
   * its own, e.g. volume at the bottom of the main pane.
   */
  scale?: string;
  /**
   * Price passed to the calculator, `close` unless the type sets another default (`hlc3` for
   * VWAP), or another indicator's output. Fed by an indicator, the calculator sees its value as
   * open, high, low and close, and skips bars where it has none.
   */
  source?: PriceSource | IndicatorReference;
  /**
   * The timeframe it is computed in, longer than the chart's, such as `'1h'` on 5-minute bars:
   * on bars of it built from the chart's source bars with the trading calendar, as the chart
   * builds its own timeframe. Each displayed bar shows the value of the latest bar of the
   * timeframe closed by its end, so no bar shows what was not known by then, and the latest one
   * shows the bar still forming. While the chart's bars cannot show it, as on a timeframe as long
   * or longer, one their source cannot build, or bars a transform builds without time such as
   * Renko bricks, it is computed on the chart's bars, and back on its own when they can. Lengths
   * compare nominally: seconds, minutes and hours as they are, a day as 24 hours, a week as 7 days
   * and a month as 30. An indicator reading another is computed in that one's timeframe, which
   * one given must be. `null` (default): on the chart's bars.
   */
  timeframe?: IntervalInput | null;
  visible?: boolean;
  /** Color overrides keyed by output key. */
  colors?: Record<string, string>;
  /** How outputs are drawn, keyed by output key: shown or not, the width and style of lines. */
  styles?: Record<string, IndicatorOutputStyle>;
  /** Reference lines in place of the type's, such as RSI 30 and 70; `[]` draws none. */
  levels?: readonly number[];
}

/** How an output of an indicator is drawn, over what its type sets. */
export interface IndicatorOutputStyle {
  /** Drawn and shown in the legend. Default `true`. */
  visible?: boolean;
  /** Width of a line in CSS pixels, from 0.5 to 10. Default: the plot's `width`, else `1.25`. */
  lineWidth?: number;
  /** Style of a line, in place of the type's. */
  lineStyle?: LineStyle;
  /** Takes part in fitting the price scale, in place of the output's `autoscale`. */
  autoscale?: boolean;
}

/**
 * Changes of an indicator. Colors and styles change by output key, `null` restoring the type's;
 * those of outputs that new parameters no longer produce, such as `ma5` after `periods: [7]`,
 * go. `levels: null` restores the type's reference lines.
 */
export interface IndicatorPatch {
  params?: ParamValues;
  /**
   * Moves the indicator: to `main`, to `new` (a pane of its own, on its `right` scale unless
   * `scale` names another) or to an existing pane by id. A pane made for it goes with the last
   * thing in it.
   */
  pane?: string;
  source?: PriceSource | IndicatorReference;
  /** The timeframe it is computed in; `null` for the chart's bars. */
  timeframe?: IntervalInput | null;
  visible?: boolean;
  scale?: string;
  colors?: Record<string, string | null>;
  styles?: Record<string, IndicatorOutputStyle | null>;
  levels?: readonly number[] | null;
}

export interface Indicator {
  readonly id: string;
  readonly type: string;
  readonly params: ParamValues;
  readonly pane: string;
  readonly scale: string;
  readonly source: PriceSource | Readonly<IndicatorReference>;
  /**
   * The timeframe it is computed in, such as `1h`, that of the indicator it reads too; `null` for
   * the chart's bars.
   */
  readonly timeframe: string | null;
  readonly visible: boolean;
  readonly colors: Readonly<Record<string, string>>;
  readonly styles: Readonly<Record<string, Readonly<IndicatorOutputStyle>>>;
  /** The reference lines set in place of the type's, or `null` for the type's. */
  readonly levels: readonly number[] | null;
}

export interface IndicatorValue {
  readonly key: string;
  /** The output's label in the chart's language, as the legend writes it. */
  readonly label: string;
  /** The color the value is drawn in on the bar, as the legend shows it. */
  readonly color: string;
  /**
   * `null` where the output has none on the bar, as other single values of the chart are; the
   * calculators, which give a value per bar, give `NaN` there.
   */
  readonly value: number | null;
  /** Formatted with the indicator precision. */
  readonly text: string;
}

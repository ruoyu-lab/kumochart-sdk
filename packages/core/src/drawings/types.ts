import type { TimeInput } from '../data/time';
import type { BarsView, PriceSource } from '../data/types';
import type { IntervalUnit } from '../feed/interval';
import type { Point } from '../interaction/types';
import type { LineStyle, Theme } from '../options/types';

export interface DrawingPointInput {
  time: TimeInput;
  price: number;
}

/** An anchor of a drawing: a time (epoch milliseconds) and a value of its pane. */
export interface DrawingPoint {
  readonly time: number;
  readonly price: number;
}

/**
 * A level of a drawing: a ratio of a Fibonacci or Gann tool, such as `0.618`, a number of standard
 * deviations of a regression channel or of the bands of an anchored VWAP, a count of a time zone.
 */
export interface DrawingLevelStyle {
  readonly value: number;
  /**
   * Default: of Fibonacci ratios and Gann boxes, the drawing's color for 0 and 1 and the theme's
   * palette in turn for the others; of the other tools, the drawing's color.
   */
  readonly color?: string;
  /** Default `true`. */
  readonly visible?: boolean;
}

export type TextAlign = 'left' | 'center' | 'right';
/** Degrees of Elliott waves, from the largest; each labels its waves its own way. */
export type WaveDegree =
  | 'supermillennium'
  | 'millennium'
  | 'submillennium'
  | 'grand-supercycle'
  | 'supercycle'
  | 'cycle'
  | 'primary'
  | 'intermediate'
  | 'minor'
  | 'minute'
  | 'minuette'
  | 'subminuette'
  | 'micro'
  | 'submicro'
  | 'miniscule';
export type TextPosition = 'top' | 'middle' | 'bottom';

export interface DrawingStyle {
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** Whether closed shapes, channels and the bands between levels are filled. */
  fill: boolean;
  /** Fill of closed shapes such as rectangles and channels, with its opacity. */
  fillColor: string;
  textColor: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** Where the text runs along its line or box: from the left, centered or to the right. */
  textAlign: TextAlign;
  /** The text above its line, on it or below it; at the top, middle or bottom of its box. */
  textPosition: TextPosition;
  /** Lines and levels go on past the anchors to the left or the right edge of the plot. */
  extendLeft: boolean;
  extendRight: boolean;
  /** Arrowheads at the first and at the last anchor. */
  startArrow: boolean;
  endArrow: boolean;
  /**
   * The levels of Fibonacci and Gann tools, the price levels of those with time levels too, the
   * deviations of a regression channel and the bands of an anchored VWAP; arrays replace the
   * default whole.
   */
  levels: readonly DrawingLevelStyle[];
  /** The time levels of tools that divide time too, such as a Gann box: ratios of its width. */
  timeLevels: readonly DrawingLevelStyle[];
  /** The price of each bar a tool computes from, such as a regression channel or a VWAP. */
  source: PriceSource;
  /** The degree of Elliott waves, which sets how their waves are labelled. */
  degree: WaveDegree;
}

/**
 * What a form of a type's settings offers: fields of its style, and `text` when the type paints
 * its text.
 */
export type DrawingField = keyof DrawingStyle | 'text';

/** Counts of a unit of timeframes, both included: `{ from: 1, to: 59 }` minutes. */
export interface TimeframeRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The timeframes a drawing shows on, by unit: `{ minute: { from: 1, to: 59 }, hour: { from: 1,
 * to: 4 } }` shows it on minute timeframes and on those of up to 4 hours, and hides it on the
 * others. Bars of unknown resolution show every drawing.
 */
export type DrawingTimeframes = {
  readonly [U in IntervalUnit]?: TimeframeRange;
} & {
  /** Bars that do not stand for a period of time, such as Renko or tick bars. */
  readonly untimed?: boolean;
};

export interface DrawingInput {
  /** Generated when omitted. */
  id?: string;
  /** A type the chart has, such as `trend-line` or `fib-retracement`, given or registered. */
  type: string;
  /** Pane id; defaults to `main`. */
  pane?: string;
  points: readonly DrawingPointInput[];
  style?: Partial<DrawingStyle>;
  text?: string;
  /** Locked drawings can be selected but not moved. */
  locked?: boolean;
  visible?: boolean;
  /** The timeframes it shows on; `null` or left out, every one. */
  timeframes?: DrawingTimeframes | null;
}

export interface Drawing {
  readonly id: string;
  readonly type: string;
  readonly pane: string;
  readonly points: readonly DrawingPoint[];
  /** The style overrides given for this drawing. */
  readonly style: Readonly<Partial<DrawingStyle>>;
  readonly text: string;
  readonly locked: boolean;
  readonly visible: boolean;
  /** The timeframes it shows on, or `null` for every one. */
  readonly timeframes: DrawingTimeframes | null;
}

/**
 * The anchors of a drawing of a type of `N` anchors: that many, or two and more for a type of any
 * number (`0`). A definition typed by them, as `DrawingTypeDefinition<Anchors<2>>`, gets its
 * anchors and their positions so, none of them missing.
 */
export type Anchors<N extends number> = N extends 0
  ? readonly [DrawingPoint, DrawingPoint, ...DrawingPoint[]]
  : TupleOf<DrawingPoint, N>;

/** `N` items of `T`. */
export type TupleOf<
  T,
  N extends number,
  Items extends readonly T[] = readonly []
> = Items['length'] extends N ? Items : TupleOf<T, N, readonly [...Items, T]>;

/** The positions of anchors `A`, one for each. */
export type Positions<A extends readonly DrawingPoint[]> = { readonly [K in keyof A]: Point };

/**
 * Pixel geometry of a drawing with anchors `A` passed to its type definition. Coordinates are
 * plot-relative.
 */
export interface DrawingGeometry<A extends readonly DrawingPoint[] = readonly DrawingPoint[]> {
  /** Anchors in plot coordinates, in the order they were placed. */
  readonly points: Positions<A>;
  /** Anchors in data coordinates. */
  readonly anchors: A;
  readonly width: number;
  readonly height: number;
  readonly style: DrawingStyle;
  readonly text: string;
  readonly theme: Theme;
  readonly fontFamily: string;
  /** The CSS font of the text: the style's size, weight and slant in the chart's family. */
  readonly textFont: string;
  readonly valueToY: (value: number) => number;
  /** The value at a height of the plot, the inverse of `valueToY`. */
  readonly yToValue: (y: number) => number;
  /** X of a time, between bars and beyond them too, e.g. of each bar of a curve. */
  readonly timeToX: (time: number) => number;
  /** Continuous bar index of a time, for counting bars between anchors. */
  readonly barIndex: (time: number) => number;
  /** The displayed bars, e.g. to find where price went after an anchor. */
  readonly bars: BarsView;
  /** The source bars a running replay has revealed (all of them otherwise). */
  readonly source: BarsView;
  /** Formats a value with the pane's precision, e.g. for fib level labels. */
  readonly formatValue: (value: number) => string;
  /** Width of `text` in CSS pixels in the drawing's `textFont`. */
  readonly measureText: (text: string) => number;
  /** Words to paint, following the chart's `locale` and the `drawings.texts` option. */
  readonly texts: DrawingTexts;
}

/**
 * Words the drawings paint on the canvas, such as the labels of positions. Defaults follow the
 * chart's `locale`: Chinese, Japanese or Korean for `zh`, `ja` or `ko`, English otherwise.
 */
export interface DrawingTexts {
  /** Shown by an empty text drawing. */
  text: string;
  /** A number of bars, e.g. in the price range label. */
  bars: (count: number) => string;
  /** A span of time in milliseconds, e.g. in the date range label. */
  duration: (ms: number) => string;
  target: string;
  stop: string;
  /** Risk/reward ratio. */
  riskReward: string;
  /** A position still open. */
  open: string;
  targetHit: string;
  stopped: string;
  /** The parts of a head and shoulders pattern. */
  leftShoulder: string;
  head: string;
  rightShoulder: string;
}

export interface DrawingPaintContext<A extends readonly DrawingPoint[] = readonly DrawingPoint[]> {
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  readonly geometry: DrawingGeometry<A>;
  readonly hovered: boolean;
  readonly selected: boolean;
  /** The text is being edited in place: paint everything but the text. */
  readonly editing: boolean;
}

export interface DrawingHit {
  /** `line` or `body`; handles are hit-tested by the chart. */
  readonly part: 'line' | 'body';
  readonly distance: number;
}

/** A point the user drags to reshape a drawing, in plot coordinates. */
export interface DrawingHandle {
  /** Passed back to `moveHandle()`; anchors use their index (`'0'`, `'1'`, …). */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** CSS cursor over the handle. Default `move`. */
  readonly cursor?: string;
  /**
   * A line the handle can be grabbed anywhere along, such as a whole edge, in plot coordinates.
   * Markers are grabbed before lines.
   */
  readonly line?: readonly [Point, Point];
  /** Draws the handle's marker at `x`, `y`. Default `true`; `false` for a line alone. */
  readonly marker?: boolean;
}

/** Values and times a drawing highlights on the axes. */
export interface DrawingAxisMarks {
  readonly prices: readonly number[];
  readonly times: readonly number[];
  /** Shown whenever the drawing is visible, not only while it is selected. */
  readonly always?: boolean;
}

/**
 * A line of a drawing that alerts can watch, straight on screen through two points. Values between
 * the points follow the pane's scale, so a line on a logarithmic scale is watched as drawn. A
 * line that is not straight, such as an anchored VWAP, gives its value at each bar instead.
 */
export interface DrawingLevel {
  /** Names the line in an alert: `{ kind: 'drawing', id, level }`. */
  readonly key: string;
  readonly from: DrawingPoint;
  readonly to: DrawingPoint;
  /**
   * How far the line reaches: between its points (`none`, default), on past `to` (`end`), or
   * both ways (`both`). Points at the same time make a horizontal level.
   */
  readonly extend?: 'none' | 'end' | 'both';
  /**
   * The value at the time of a bar of a line that is not straight, `NaN` where it does not
   * reach; `from` and `to` then only mark where it starts and ends.
   */
  readonly valueAt?: (time: number) => number;
}

/** What lines of a drawing may be computed from, besides its anchors. */
export interface LevelContext {
  /** The bars alerts watch, e.g. for a regression of their closes. */
  readonly bars: BarsView;
  /** Continuous bar index of a time, between bars and beyond them. */
  readonly barIndex: (time: number) => number;
  /** Time at a continuous bar index, the inverse of `barIndex`. */
  readonly timeAt: (index: number) => number;
}

/** The pane's scale, e.g. logarithmic, for levels offset from one another as drawn. */
export interface LevelScale {
  toScale(value: number): number;
  fromScale(scaled: number): number;
}

/**
 * How anchors lie on screen: their values on the pane's scale, and their times by position among
 * the bars. Straight lines on screen are straight in this space.
 */
export interface DrawingSpace extends LevelScale {
  /** Continuous bar index of a time, between bars and beyond them. */
  barIndex(time: number): number;
  /** Time at a continuous bar index, the inverse of `barIndex`. */
  timeAt(index: number): number;
}

/** A rectangle in plot coordinates. */
export interface DrawingBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Describes a drawing tool. Register custom tools with `chart.drawings.register()`. Typed by its
 * anchors `A`, as `DrawingTypeDefinition<Anchors<2>>` for `points: 2`, it gets them all, and
 * `Placed`, those the user places for `complete()`.
 */
export interface DrawingTypeDefinition<
  A extends readonly DrawingPoint[] = readonly DrawingPoint[],
  Placed extends readonly DrawingPoint[] = A
> {
  /** The type drawings of it name, such as `trend-line`. */
  readonly type: string;
  /** Anchors of a drawing; `0` means any number, finished with a double click or Enter. */
  readonly points: number;
  /**
   * Drawn by hand, as with a brush: the anchors follow the pointer while the button is held,
   * off the bar grid and without the magnet, and letting go finishes the drawing. Needs
   * `points: 0`.
   */
  readonly freehand?: boolean;
  /**
   * Anchors the user places when fewer than `points`; `complete()` then adds the others, e.g. a
   * stop level mirrored from the target. Default: `points`.
   */
  readonly place?: number;
  /**
   * The drawing's anchors, `points` of them, from the `place` anchors the user placed; also used
   * for the preview.
   */
  complete?(placed: Placed): readonly DrawingPoint[];
  /**
   * Computed from the bars of the main pane, such as an anchored VWAP, whose values another pane
   * does not have: drawings of it go on the main pane only. Default `false`.
   */
  readonly mainPane?: boolean;
  /** Style defaults on top of the chart's drawing defaults. */
  defaultStyle?(theme: Theme): Partial<DrawingStyle>;
  /**
   * What a form of its settings offers: the style fields it paints with, and `text` when it
   * paints its text. Default: `color`, `lineWidth` and `lineStyle`.
   */
  readonly fields?: readonly DrawingField[];
  paint(context: DrawingPaintContext<A>): void;
  /**
   * Paints under the series, before `paint()` paints over them: areas such as the zones of a
   * position, which leave the bars as they are. Hover and selection do not repaint it, so it is
   * painted as neither.
   */
  paintBelow?(context: DrawingPaintContext<A>): void;
  hitTest(geometry: DrawingGeometry<A>, point: Point, tolerance: number): DrawingHit | null;
  /**
   * Handles shown on hover and selection. Default: one per anchor, which `Shift` constrains to
   * horizontal, vertical or diagonal from the neighbouring anchor.
   */
  handles?(geometry: DrawingGeometry<A>): readonly DrawingHandle[];
  /**
   * The anchors after dragging `handle` to `to`. Required with custom `handles()` unless their
   * ids are anchor indices: one that is not fails as soon as the handles show. `space` places
   * them as the drawing is drawn, so that a handle between anchors ends under the pointer on a
   * logarithmic scale or across gaps between bars too; `style` is the drawing's.
   */
  moveHandle?(
    anchors: A,
    handle: string,
    to: DrawingPoint,
    space: DrawingSpace,
    style: DrawingStyle
  ): readonly DrawingPoint[];
  /**
   * Highlighted on the axes, as the drawing's `style` draws it. Default: every anchor's value and
   * time while selected.
   */
  axisMarks?(anchors: A, style: DrawingStyle): DrawingAxisMarks;
  /**
   * The area the drawing covers, as far as it reaches past the plot, its labels included: where
   * `chart.drawings.bounds()` places a floating toolbar. `null` where it draws nothing, where the
   * tool then places nothing either. Default: around the handles.
   */
  bounds?(geometry: DrawingGeometry<A>): DrawingBounds | null;
  /** Placing it or double-clicking it opens the in-place text editor. */
  readonly editableText?: boolean;
  /** Index of the anchor the text starts at, where the editor opens. Default `0`. */
  readonly textAnchor?: number;
  /**
   * Lines alerts can watch, the first one by default, as the drawing's style draws them (e.g.
   * extended). Without it the type has none. Keys must not depend on the bars of `context`.
   */
  levels?(
    anchors: A,
    scale: LevelScale,
    style: DrawingStyle,
    context: LevelContext
  ): readonly DrawingLevel[];
}

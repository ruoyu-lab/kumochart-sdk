import type { BarChange } from '../data/types';
import type { ObjectKind } from '../interaction/types';
import type { Selection } from '../objects/types';
import type { ChartOptions, LegendItem } from '../options/types';
import type { LogicalRange } from '../scales/time-scale';
import type { CrosshairState } from './cursor';

export interface TimeRange {
  /** Time of the first visible bar. */
  readonly from: number;
  /** Time of the last visible bar. */
  readonly to: number;
}

/** The pointer moved over the chart (`visible: true`) or left it. */
export type CrosshairMoveEvent =
  ({ readonly visible: true } & CrosshairState) | { readonly visible: false };

export interface VisibleRangeChangeEvent {
  /** Times of the first and last visible bars, or `null` when no bar is visible. */
  readonly range: TimeRange | null;
  readonly logicalRange: LogicalRange | null;
}

/** The view approaches the oldest bar: load bars before `before` and pass them to `data.prepend()`. */
export interface LoadMoreEvent {
  readonly before: number;
}

/** The object under the pointer when it was clicked. */
export interface ObjectTarget {
  readonly kind: ObjectKind;
  readonly id: string;
  /** The part that was hit, such as `line`, `label`, `handle:0` or `button:close`. */
  readonly part: string;
}

/**
 * The part of the chart under the pointer: the plot of a pane, a price axis, the time axis, the
 * separator between two panes, or none of them, such as the corner below the price axis.
 */
export type ChartArea = 'plot' | 'price-axis' | 'time-axis' | 'separator' | 'outside';

/** A click, double click or context menu on the chart. */
export interface ChartPointerEvent {
  /** CSS pixel position inside the chart. */
  readonly x: number;
  readonly y: number;
  readonly area: ChartArea;
  /** The pane whose plot or price axis is under the pointer. */
  readonly paneId: string | null;
  /** Over a price axis, its scale, such as `right` or `left`, for `chart.priceScale()`. */
  readonly scaleId: string | null;
  /** Logical bar index under the pointer, over a plot or the time axis. */
  readonly index: number | null;
  readonly time: number | null;
  /** The value at `y` in the pane's scale, or in the scale of the price axis under the pointer. */
  readonly price: number | null;
  readonly target: ObjectTarget | null;
}

/** The user changed the selection by clicking. */
export interface SelectionChangeEvent {
  readonly selection: Selection | null;
}

/** The user finished resizing a pane by dragging a separator. */
export interface PaneResizeEvent {
  readonly paneId: string;
  readonly height: number;
}

/**
 * A series type, transform type, indicator type or drawing type was registered or unregistered,
 * for lists of the types to follow.
 */
export interface TypesChangeEvent {
  readonly kind: 'series' | 'transform' | 'indicator' | 'drawing';
  readonly type: string;
  /** `false` when it was unregistered. */
  readonly registered: boolean;
}

/** A button of a legend row was clicked. */
export interface LegendButtonClickEvent {
  readonly item: LegendItem;
  readonly buttonId: string;
}

/** A button in the label of an object, such as an order or an alert, was clicked. */
export interface ButtonClickEvent {
  readonly kind: ObjectKind;
  readonly id: string;
  readonly buttonId: string;
}

/**
 * The displayed bars changed: data was set, streamed or prepended, the timeframe or transform
 * changed, or a replay revealed or hid bars.
 */
export interface BarsChangeEvent {
  /** `tail`: only bars from `from` on changed or were appended; `reset`: any bar may have. */
  readonly change: BarChange;
}

/** Options applied, by `applyOptions()` or `loadState()`: those now, and those before. */
export interface OptionsChangeEvent {
  readonly options: ChartOptions;
  readonly previous: ChartOptions;
}

export interface ChartEventMap {
  crosshairMove: CrosshairMoveEvent;
  visibleRangeChange: VisibleRangeChangeEvent;
  loadMore: LoadMoreEvent;
  click: ChartPointerEvent;
  doubleClick: ChartPointerEvent;
  /** Listening suppresses the browser's context menu over the chart. */
  contextMenu: ChartPointerEvent;
  selectionChange: SelectionChangeEvent;
  paneResize: PaneResizeEvent;
  buttonClick: ButtonClickEvent;
  legendButtonClick: LegendButtonClickEvent;
  barsChange: BarsChangeEvent;
  /** Reports every registration, by the API too: no one feeds it back. */
  typesChange: TypesChangeEvent;
  optionsChange: OptionsChangeEvent;
}

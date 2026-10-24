import type { BarStore } from '../data/bar-store';
import type { BarsView } from '../data/types';
import type { Formatter } from '../format/formatter';
import type { Interval } from '../feed/interval';
import type { DragSession, HitTarget, Modifiers, ObjectKind, Point } from '../interaction/types';
import type { ChartOptions } from '../options/types';
import type { Frame, PaneFrame } from '../render/frame';
import type { PriceScale } from '../scales/price-scale';
import type { TimeScale } from '../scales/time-scale';

/** The single selected object of a chart. */
export interface Selection {
  readonly kind: ObjectKind;
  readonly id: string;
}

/**
 * The resolution of the displayed bars: an interval, `untimed` for bars that do not stand for a
 * period of time (Renko, tick bars), or `null` when it is not known.
 */
export type Resolution = Interval | 'untimed' | null;

export interface ObjectContext {
  readonly frame: Frame;
  readonly bars: BarStore;
  /** The displayed bars, read-only, for code outside the chart. */
  readonly displayed: BarsView;
  /** The source bars a running replay has revealed. */
  readonly source: BarsView;
  readonly timeScale: TimeScale;
  readonly resolution: Resolution;
  readonly options: ChartOptions;
  readonly formatter: Formatter;
  readonly selection: Selection | null;
  readonly hovered: HitTarget | null;
  /** Source data after this time is hidden, as a replay hides it; `Infinity` shows all. */
  readonly cutoff: number;
  /** A price scale of a pane, as the frame fitted it, or `null` while nothing is placed on it. */
  readonly scaleOf: (paneId: string, scaleId: string) => PriceScale | null;
  /** Width of `text` in CSS pixels in a CSS `font`. */
  readonly measureText: (text: string, font: string) => number;
}

export interface ObjectPaintContext extends ObjectContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
}

export interface ObjectHit {
  readonly target: HitTarget;
  /** Higher wins: buttons and handles beat labels, labels beat lines. */
  readonly priority: number;
  readonly distance: number;
}

/** Hit priorities shared by every object kind. */
export const HitPriority = {
  button: 50,
  handle: 40,
  label: 30,
  line: 20,
  body: 10
} as const;

/** One kind of chart object: drawings, orders, alerts or markers. */
export interface ObjectDomain {
  readonly kind: ObjectKind;
  hitTest(context: ObjectContext, point: Point): ObjectHit | null;
  paint(context: ObjectPaintContext): void;
  beginDrag(
    context: ObjectContext,
    target: HitTarget,
    point: Point,
    modifiers: Modifiers
  ): DragSession | null;
  has(id: string): boolean;
  /** Opens the editor of an object the user double-clicked; returns whether one opened. */
  edit?(id: string): boolean;
}

/** x of a time in plot coordinates, interpolated and extrapolated between bars. */
export function timeToX(context: Pick<ObjectContext, 'bars' | 'timeScale'>, time: number): number {
  return context.timeScale.indexToX(context.bars.logicalIndexOf(time));
}

export function paneOf(frame: Frame, paneId: string): PaneFrame | undefined {
  return frame.panes.find((pane) => pane.id === paneId);
}

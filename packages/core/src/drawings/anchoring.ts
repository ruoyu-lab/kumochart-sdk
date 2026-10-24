import type { Modifiers, Point } from '../interaction/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import type { PaneFrame } from '../render/frame';
import { timeToX, type ObjectContext } from '../objects/types';
import type { MagnetMode } from './options';
import type { DrawingPoint } from './types';

/** The weak magnet snaps to an OHLC value within this many pixels. */
const WEAK_MAGNET_PX = 16;
const OCTANT = Math.PI / 4;

/** The magnet in effect: Ctrl/⌘ turns it off when it is on, and to strong when it is off. */
export function magnetFor(mode: MagnetMode, modifiers: Modifiers): MagnetMode {
  if (!modifiers.command) {
    return mode;
  }

  return mode === 'off' ? 'strong' : 'off';
}

/** Moves `point` onto the nearest horizontal, vertical or diagonal through `pivot`. */
export function constrainAngle(pivot: Point, point: Point): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const angle = Math.round(Math.atan2(dy, dx) / OCTANT) * OCTANT;
  const cos = Math.round(Math.cos(angle) * 1e9) / 1e9;
  const sin = Math.round(Math.sin(angle) * 1e9) / 1e9;
  const length = dx * cos + dy * sin;
  return { x: pivot.x + length * cos, y: pivot.y + length * sin };
}

/**
 * Whether the bars give an anchor a place: a time and a value. Fewer than two bars give a time
 * only to the bar there is.
 */
export function placeable(anchor: DrawingPoint): boolean {
  return Number.isFinite(anchor.time) && Number.isFinite(anchor.price);
}

/** Plot-relative position of an anchor in `pane`. */
export function anchorPosition(
  context: Pick<ObjectContext, 'bars' | 'timeScale'>,
  pane: PaneFrame,
  anchor: DrawingPoint
): Point {
  return { x: timeToX(context, anchor.time), y: pane.scale.valueToY(anchor.price) };
}

/** The anchor right under a plot-relative point, between bars too: a stroke drawn by hand. */
export function freeAnchorAt(context: ObjectContext, pane: PaneFrame, local: Point): DrawingPoint {
  return {
    time: context.bars.timeOfLogicalIndex(context.timeScale.xToIndex(local.x)),
    price: pane.scale.yToValue(local.y)
  };
}

export interface AnchorRules {
  readonly magnet: MagnetMode;
  /** With Shift held: the anchor the new one is constrained against. */
  readonly pivot: DrawingPoint | null;
}

/**
 * Converts a plot-relative point into a drawing anchor: the time snaps to the bar grid (beyond
 * the data too), the value to the bar's open, high, low or close with the magnet, and a pivot
 * constrains the direction (and turns the magnet off).
 */
export function anchorAt(
  context: ObjectContext,
  pane: PaneFrame,
  local: Point,
  rules: AnchorRules
): DrawingPoint {
  const { bars, timeScale } = context;
  const point = rules.pivot
    ? constrainAngle(anchorPosition(context, pane, rules.pivot), local)
    : local;
  const index = Math.round(timeScale.xToIndex(point.x));
  const time = bars.timeOfLogicalIndex(index);
  const price = pane.scale.yToValue(point.y);
  const bar = bars.bar(index);

  if (rules.pivot || rules.magnet === 'off' || !bar || pane.id !== MAIN_PANE_ID) {
    return { time, price };
  }

  const nearest = [bar.open, bar.high, bar.low, bar.close].reduce((best, value) =>
    Math.abs(pane.scale.valueToY(value) - point.y) < Math.abs(pane.scale.valueToY(best) - point.y)
      ? value
      : best
  );
  const distance = Math.abs(pane.scale.valueToY(nearest) - point.y);
  return { time, price: rules.magnet === 'strong' || distance <= WEAK_MAGNET_PX ? nearest : price };
}

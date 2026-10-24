import type { ValueSource } from '../data/types';
import type { LineStyle } from '../options/types';
import type { PriceDragEvent, PriceLineButton } from '../objects/price-line';

/**
 * The two bounds of a channel, in either order: at each bar the channel lies between them, e.g.
 * the top and the bottom of a rectangle.
 */
export type ChannelBounds = readonly [number | ValueSource, number | ValueSource];

/**
 * - `cross-up` / `cross-down` / `cross`: the source moves through the threshold between two
 *   evaluations (ticks or bars).
 * - `above` / `below`: the source is beyond the threshold.
 * - `enter-channel` / `exit-channel`: the source moves into, or out of, the channel between two
 *   evaluations: inside after being outside or on a bound to enter, outside after being inside or
 *   on a bound to exit. Leaping over the whole channel, from below it to above it, does neither.
 * - `inside-channel` / `outside-channel`: the source is between the bounds, or beyond one.
 */
export type AlertTrigger =
  | 'cross'
  | 'cross-up'
  | 'cross-down'
  | 'above'
  | 'below'
  | 'enter-channel'
  | 'exit-channel'
  | 'inside-channel'
  | 'outside-channel';

/**
 * - `once`: fires one time, then the alert's status becomes `triggered` until `rearm()`.
 * - `once-per-bar`: at most once per bar, on the tick that meets the condition.
 * - `once-per-bar-close`: evaluates closed bars only, when the next bar starts.
 * - `every-time`: whenever an evaluation meets the condition.
 */
export type AlertFrequency = 'once' | 'once-per-bar' | 'once-per-bar-close' | 'every-time';

export interface AlertInput {
  /** The chart numbers one, `alert-1` on, when it is left out. */
  id?: string;
  /** Watched value; defaults to the main close. */
  source?: ValueSource;
  trigger: AlertTrigger;
  /**
   * A fixed level (drawn as a draggable line) or another value to compare with; for the channel
   * triggers, the channel's two bounds, such as two lines of a drawing.
   */
  value: number | ValueSource | ChannelBounds;
  frequency?: AlertFrequency;
  enabled?: boolean;
  /** Text of the line label. */
  label?: string;
  /** Defaults to the theme's alert color. */
  color?: string;
  lineStyle?: LineStyle;
  /** Lets the user drag a fixed level. Default `true`. */
  draggable?: boolean;
  /** Shows the line of a fixed level. Default `true`. */
  visible?: boolean;
  buttons?: PriceLineButton[];
}

export type AlertStatus = 'active' | 'triggered' | 'disabled';

export interface Alert {
  readonly id: string;
  readonly source: ValueSource;
  readonly trigger: AlertTrigger;
  readonly value: number | ValueSource | ChannelBounds;
  readonly frequency: AlertFrequency;
  readonly enabled: boolean;
  readonly label: string | null;
  readonly color: string | null;
  readonly lineStyle: LineStyle;
  readonly draggable: boolean;
  readonly visible: boolean;
  readonly buttons: readonly PriceLineButton[];
  readonly status: AlertStatus;
  /** Time of the bar on which the alert last fired. */
  readonly triggeredAt: number | null;
}

export interface AlertTriggerEvent {
  readonly id: string;
  /** Time of the bar that met the condition. */
  readonly time: number;
  readonly value: number;
  /**
   * The threshold at that bar; for the channel triggers, the bound the value went through to
   * enter or exit, or the bound nearest to it inside or outside.
   */
  readonly threshold: number;
  readonly trigger: AlertTrigger;
  /** The alert fired while the chart replays history. */
  readonly replay: boolean;
}

/** The user drags the line of an alert: its level, or a bound of its channel that is a number. */
export interface AlertDragEvent extends PriceDragEvent {
  /** The index in the alert's `value` of the channel bound dragged; `null` for one level. */
  readonly bound: number | null;
}

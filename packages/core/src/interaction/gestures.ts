import type { Pinch } from './pinch';
import type { DragSession, HitTarget, LegendHit, PaneResizeSession, Point, Region } from './types';

/** What the pointer or the fingers are doing, from a press until they let go. */
export type Gesture =
  | { readonly kind: 'idle' }
  /** Pressed but not moved yet: becomes a click, a drag or (touch) a long press. */
  | {
      readonly kind: 'pressed';
      readonly pointerId: number;
      readonly touch: boolean;
      readonly start: Point;
      readonly region: Region;
      readonly target: HitTarget | null;
    }
  | {
      readonly kind: 'pan';
      readonly pointerId: number;
      /** Touch pans do not show the crosshair. */
      readonly touch: boolean;
      readonly paneId: string | null;
      last: Point;
      samples: Array<{ x: number; time: number }>;
    }
  | {
      readonly kind: 'drag';
      readonly pointerId: number;
      readonly touch: boolean;
      readonly session: DragSession;
    }
  | {
      readonly kind: 'time-axis';
      readonly pointerId: number;
      /** Where the axis was pressed, which the drag zooms from. */
      readonly startX: number;
      lastX: number;
    }
  | {
      readonly kind: 'price-axis';
      readonly pointerId: number;
      readonly paneId: string;
      readonly scale: string;
      readonly anchorY: number;
      lastY: number;
    }
  | {
      readonly kind: 'separator';
      readonly pointerId: number;
      readonly startY: number;
      readonly session: PaneResizeSession;
    }
  | { readonly kind: 'touch-crosshair'; readonly pointerId: number }
  /** Pressed on a legend button: a click if released there. */
  | { readonly kind: 'legend'; readonly pointerId: number; readonly hit: LegendHit }
  | { readonly kind: 'pinch'; readonly pinch: Pinch }
  | { readonly kind: 'tool'; readonly pointerId: number; readonly touch: boolean };

export const IDLE: Gesture = { kind: 'idle' };

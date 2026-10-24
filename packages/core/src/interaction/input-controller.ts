import { KineticScroll, VELOCITY_WINDOW_MS } from './kinetic';
import { runKeyCommand } from './keyboard';
import { Pinch } from './pinch';
import {
  NO_MODIFIERS,
  type DragSession,
  type HitTarget,
  type InteractionHost,
  type LegendHit,
  type Modifiers,
  type PaneResizeSession,
  type Point,
  type Region
} from './types';

const MOUSE_SLOP = 3;
const TOUCH_SLOP = 8;
const WHEEL_ZOOM_SPEED = 0.0018;
const PINCH_WHEEL_SPEED = 0.012;
const AXIS_DRAG_SPEED = 0.006;
const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);

function modifiersOf(event: MouseEvent | KeyboardEvent): Modifiers {
  return { shift: event.shiftKey, alt: event.altKey, command: event.ctrlKey || event.metaKey };
}

type Gesture =
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

const IDLE: Gesture = { kind: 'idle' };

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/** Pixel deltas of a wheel event, whatever unit the device reports in. */
function wheelPixels(event: WheelEvent, pageHeight: number): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

/**
 * Turns pointer, touch, wheel and keyboard input into chart intents. Every gesture can be
 * cancelled (pointercancel, lost capture, window blur, Escape), which reverts object drags.
 * Hover hit-testing and wheel zooming are coalesced to one update per frame, made before it
 * paints.
 */
export class InputController {
  private gesture: Gesture = IDLE;
  private readonly touches = new Map<number, Point>();
  private hoverPoint: Point | null = null;
  /** Hover hit-testing waits for the next frame, before it paints. */
  private hoverPending = false;
  private wheel = { x: 0, y: 0, pinch: 0, point: { x: 0, y: 0 } as Point, pending: false };
  private readonly kinetic: KineticScroll;
  private longPressTimer = 0;
  /** Modifier keys and position of the latest pointer input, replayed when a modifier changes. */
  private modifiers: Modifiers = NO_MODIFIERS;
  private lastPoint: Point | null = null;
  private readonly root: HTMLElement;

  constructor(
    private readonly host: InteractionHost,
    private readonly view: Window
  ) {
    this.root = host.root;
    this.kinetic = new KineticScroll(view, (deltaX) => host.scrollTime(deltaX));
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerCancel);
    this.root.addEventListener('lostpointercapture', this.onPointerCancel);
    this.root.addEventListener('pointerleave', this.onPointerLeave);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('dblclick', this.onDoubleClick);
    this.root.addEventListener('contextmenu', this.onContextMenu);
    this.root.addEventListener('keydown', this.onKeyDown);
    this.root.addEventListener('keyup', this.onKeyUp);
    this.view.addEventListener('blur', this.onWindowBlur);
  }

  /** Ends the gesture in progress and stops listening, also when ending the gesture fails. */
  destroy(): void {
    try {
      this.cancelGesture();
    } finally {
      this.stopListening();
    }
  }

  private stopListening(): void {
    this.kinetic.stop();
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerCancel);
    this.root.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.root.removeEventListener('wheel', this.onWheel);
    this.root.removeEventListener('dblclick', this.onDoubleClick);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('keyup', this.onKeyUp);
    this.view.removeEventListener('blur', this.onWindowBlur);
  }

  /** Cancels the gesture in progress, reverting an object drag. */
  cancelGesture(): void {
    const gesture = this.gesture;
    this.clearLongPress();
    this.gesture = IDLE;

    if (gesture.kind === 'drag') {
      gesture.session.cancel();
    } else if (gesture.kind === 'separator') {
      gesture.session.cancel();
    } else if (gesture.kind === 'touch-crosshair') {
      this.host.setPointer(null);
    } else if (gesture.kind === 'tool') {
      this.host.activeTool()?.cancelPress();
    }

    this.host.magnify(null);
    this.host.hoverSeparator(null);
    this.updateCursor(null, null);
  }

  // ─── Pointer events ────────────────────────────────────────────────────────

  /** The point in chart coordinates, whose x 0 is the plots' left edge. */
  private local(event: MouseEvent): Point {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left - this.host.originX(), y: event.clientY - rect.top };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    this.kinetic.stop();
    this.root.focus({ preventScroll: true });
    const point = this.local(event);
    this.track(event, point);
    const touch = event.pointerType === 'touch';

    if (touch) {
      this.touches.set(event.pointerId, point);

      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }

      if (this.touches.size > 2) {
        return;
      }
    }

    if (this.gesture.kind !== 'idle') {
      return;
    }

    if (event.isTrusted) {
      this.root.setPointerCapture(event.pointerId);
    }

    const tool = this.host.activeTool();
    const region = this.host.regionAt(point);

    if (tool && region.kind === 'plot') {
      this.gesture = { kind: 'tool', pointerId: event.pointerId, touch };
      tool.pointerDown(point, this.modifiers, touch);

      // A finger covers the anchor it places: a loupe shows it.
      if (touch) {
        this.host.magnify(point);
      }

      return;
    }

    this.startPress(event.pointerId, touch, point, region);
  };

  private startPress(pointerId: number, touch: boolean, point: Point, region: Region): void {
    if (region.kind === 'separator') {
      // The crosshair would stay where the panes were: it waits for the resize to end.
      this.host.setPointer(null);
      this.host.hoverSeparator(region.above);
      this.gesture = {
        kind: 'separator',
        pointerId,
        startY: point.y,
        session: this.host.beginPaneResize(region.above, region.below)
      };
      return;
    }

    if (region.kind === 'time-axis' && this.host.enabled('axisScale')) {
      this.gesture = { kind: 'time-axis', pointerId, startX: point.x, lastX: point.x };
      return;
    }

    if (region.kind === 'price-axis' && this.host.enabled('axisScale')) {
      this.gesture = {
        kind: 'price-axis',
        pointerId,
        paneId: region.paneId,
        scale: region.scale,
        anchorY: point.y,
        lastY: point.y
      };
      return;
    }

    const legend = region.kind === 'plot' ? this.host.legendAt(point) : null;

    if (legend?.button) {
      this.gesture = { kind: 'legend', pointerId, hit: legend };
      return;
    }

    const target = region.kind === 'plot' ? this.host.hitTest(point) : null;
    this.gesture = { kind: 'pressed', pointerId, touch, start: point, region, target };

    if (touch && !target) {
      this.longPressTimer = this.view.setTimeout(() => {
        this.longPressTimer = 0;

        if (this.gesture.kind === 'pressed' && this.gesture.pointerId === pointerId) {
          this.gesture = { kind: 'touch-crosshair', pointerId };
          this.host.setPointer(point);
        }
      }, this.host.longPressMs());
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.local(event);
    this.track(event, point);
    const gesture = this.gesture;

    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, point);

      if (gesture.kind === 'pinch') {
        this.movePinch();
        return;
      }
    }

    switch (gesture.kind) {
      case 'idle':
        if (event.pointerType !== 'touch') {
          this.scheduleHover(point);
        }

        this.host.activeTool()?.pointerMove(point, this.modifiers);
        return;
      case 'tool':
        if (event.pointerId === gesture.pointerId) {
          this.host.activeTool()?.pointerMove(point, this.modifiers);
          this.host.setPointer(point);

          if (gesture.touch) {
            this.host.magnify(point);
          }
        }

        return;
      case 'pressed':
        if (event.pointerId === gesture.pointerId) {
          this.movePressed(gesture, point);
        }

        return;
      case 'pan':
        if (event.pointerId === gesture.pointerId) {
          this.movePan(gesture, point, event.timeStamp);
        }

        return;
      case 'drag':
        if (event.pointerId === gesture.pointerId) {
          gesture.session.move(point, this.modifiers);

          if (gesture.touch) {
            this.host.magnify(point);
          } else {
            this.host.setPointer(point);
          }
        }

        return;
      case 'time-axis':
        if (event.pointerId === gesture.pointerId) {
          this.host.zoomTime(Math.exp((point.x - gesture.lastX) * AXIS_DRAG_SPEED), gesture.startX);
          gesture.lastX = point.x;
        }

        return;
      case 'price-axis':
        if (event.pointerId === gesture.pointerId) {
          this.host.zoomPrice(
            gesture.paneId,
            gesture.scale,
            Math.exp((gesture.lastY - point.y) * AXIS_DRAG_SPEED),
            gesture.anchorY
          );
          gesture.lastY = point.y;
        }

        return;
      case 'separator':
        if (event.pointerId === gesture.pointerId) {
          gesture.session.move(point.y - gesture.startY);
        }

        return;
      case 'touch-crosshair':
        if (event.pointerId === gesture.pointerId) {
          this.host.setPointer(point);
        }

        return;
      case 'pinch':
      case 'legend':
        return;
    }
  };

  private movePressed(gesture: Extract<Gesture, { kind: 'pressed' }>, point: Point): void {
    if (distance(point, gesture.start) < (gesture.touch ? TOUCH_SLOP : MOUSE_SLOP)) {
      return;
    }

    this.clearLongPress();
    const target = gesture.target;

    if (target?.draggable) {
      const session = this.host.beginDrag(target, gesture.start, this.modifiers);

      if (session) {
        this.gesture = {
          kind: 'drag',
          pointerId: gesture.pointerId,
          touch: gesture.touch,
          session
        };
        session.move(point, this.modifiers);
        this.updateCursor(target, null);

        if (gesture.touch) {
          this.host.magnify(point);
        }

        return;
      }
    }

    if (gesture.region.kind !== 'plot' || !this.host.enabled('pan')) {
      this.gesture = IDLE;
      return;
    }

    const pan: Extract<Gesture, { kind: 'pan' }> = {
      kind: 'pan',
      pointerId: gesture.pointerId,
      touch: gesture.touch,
      paneId: gesture.region.paneId,
      last: gesture.start,
      samples: []
    };
    this.gesture = pan;
    this.root.style.cursor = 'grabbing';
    this.movePan(pan, point, performance.now());
  }

  private movePan(gesture: Extract<Gesture, { kind: 'pan' }>, point: Point, time: number): void {
    const deltaX = point.x - gesture.last.x;
    const deltaY = point.y - gesture.last.y;
    gesture.last = point;
    this.host.scrollTime(deltaX);

    if (gesture.paneId !== null && !this.host.isAutoScale(gesture.paneId)) {
      this.host.panPrice(gesture.paneId, deltaY);
    }

    gesture.samples.push({ x: point.x, time });

    while (
      gesture.samples.length > 2 &&
      time - (gesture.samples[0]?.time ?? time) > VELOCITY_WINDOW_MS
    ) {
      gesture.samples.shift();
    }

    if (!gesture.touch) {
      this.host.setPointer(point);
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const point = this.local(event);
    this.track(event, point);
    this.touches.delete(event.pointerId);
    const gesture = this.gesture;

    if (gesture.kind === 'pinch') {
      this.endPinch();
      return;
    }

    if ('pointerId' in gesture && gesture.pointerId !== event.pointerId) {
      return;
    }

    this.clearLongPress();
    this.gesture = IDLE;

    switch (gesture.kind) {
      case 'pressed':
        this.host.click(point, gesture.target);
        break;
      case 'tool':
        this.host.activeTool()?.pointerUp(point, this.modifiers, gesture.touch);
        break;
      case 'pan':
        if (this.host.enabled('kineticScroll')) {
          this.kinetic.start(gesture.samples, event.timeStamp);
        }

        break;
      case 'drag':
        gesture.session.end();
        break;
      case 'legend': {
        const hit = this.host.legendAt(point);

        if (hit?.button === gesture.hit.button && hit.item.id === gesture.hit.item.id) {
          this.host.clickLegend(hit);
        }

        break;
      }
      case 'separator': {
        gesture.session.end();
        const region = this.host.regionAt(point);
        this.host.hoverSeparator(region.kind === 'separator' ? region.above : null);
        break;
      }
      default:
        break;
    }

    if (event.pointerType === 'touch') {
      // The crosshair and the loupe follow a finger only while it presses.
      this.host.setPointer(null);
      this.host.magnify(null);
    }

    this.updateCursor(null, event.pointerType === 'touch' ? null : point);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);

    if ('pointerId' in this.gesture && this.gesture.pointerId === event.pointerId) {
      this.cancelGesture();
    } else if (this.gesture.kind === 'pinch') {
      this.endPinch();
    }
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' && this.gesture.kind === 'idle') {
      this.hoverPoint = null;
      this.host.hover(null);
      this.host.hoverSeparator(null);
      this.host.hoverLegend(null);
      this.host.setPointer(null);
    }
  };

  private readonly onWindowBlur = (): void => {
    this.cancelGesture();
  };

  // ─── Hover ─────────────────────────────────────────────────────────────────

  private scheduleHover(point: Point): void {
    // The crosshair moves at once: a frame painted before the hover is handled would show it where
    // the pointer was, and the line would step back before it goes on.
    const region = this.host.regionAt(point);
    // Over a separator, the crosshair would sit on the edge of a pane.
    this.host.setPointer(region.kind === 'separator' ? null : point);
    this.hoverPoint = point;

    if (!this.hoverPending) {
      this.hoverPending = true;
      this.host.beforePaint(() => {
        this.hoverPending = false;
        const hovered = this.hoverPoint;

        if (hovered && this.gesture.kind === 'idle') {
          const region = this.host.regionAt(hovered);
          this.host.hoverSeparator(region.kind === 'separator' ? region.above : null);
          const target =
            region.kind === 'plot' && !this.host.activeTool() ? this.host.hitTest(hovered) : null;
          this.host.hover(target);
          const legend = region.kind === 'plot' ? this.host.legendAt(hovered) : null;
          this.host.hoverLegend(legend);
          this.updateCursor(target, hovered);

          if (legend?.button) {
            this.root.style.cursor = 'pointer';
          }
        }
      });
    }
  }

  private updateCursor(target: HitTarget | null, point: Point | null): void {
    if (target) {
      this.root.style.cursor = target.cursor;
      return;
    }

    if (!point) {
      this.root.style.cursor = '';
      return;
    }

    const region = this.host.regionAt(point);
    const axisScale = this.host.enabled('axisScale');
    this.root.style.cursor =
      region.kind === 'separator'
        ? 'row-resize'
        : region.kind === 'price-axis' && axisScale
          ? 'ns-resize'
          : region.kind === 'time-axis' && axisScale
            ? 'ew-resize'
            : region.kind === 'plot'
              ? 'crosshair'
              : '';
  }

  // ─── Touch pinch ───────────────────────────────────────────────────────────

  /** The two fingers on the chart, while there are two. */
  private fingers(): [Point, Point] | null {
    const [first, second] = [...this.touches.values()];
    return first && second ? [first, second] : null;
  }

  private startPinch(): void {
    this.cancelGesture();
    const fingers = this.fingers();

    if (fingers && this.host.enabled('pinchZoom')) {
      this.gesture = { kind: 'pinch', pinch: new Pinch(...fingers) };
    }
  }

  private movePinch(): void {
    const gesture = this.gesture;
    const fingers = this.fingers();

    if (gesture.kind === 'pinch' && fingers) {
      gesture.pinch.move(...fingers, this.host);
    }
  }

  /** After a pinch, a remaining finger continues as a pan from where it is, without a jump. */
  private endPinch(): void {
    if (this.touches.size >= 2) {
      return;
    }

    const [remaining] = [...this.touches.entries()];
    this.gesture =
      remaining && this.host.enabled('pan')
        ? {
            kind: 'pan',
            pointerId: remaining[0],
            touch: true,
            paneId: null,
            last: remaining[1],
            samples: []
          }
        : IDLE;
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== 0) {
      this.view.clearTimeout(this.longPressTimer);
      this.longPressTimer = 0;
    }
  }

  // ─── Wheel, double click, context menu, keyboard ───────────────────────────

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.host.enabled('wheelZoom')) {
      return;
    }

    event.preventDefault();
    this.kinetic.stop();
    const pixels = wheelPixels(event, this.root.clientHeight);

    if (event.ctrlKey) {
      this.wheel.pinch += pixels.y;
    } else {
      this.wheel.x += pixels.x;
      this.wheel.y += event.shiftKey ? 0 : pixels.y;
      this.wheel.x += event.shiftKey ? pixels.y : 0;
    }

    this.wheel.point = this.local(event);

    if (!this.wheel.pending) {
      this.wheel.pending = true;
      this.host.beforePaint(() => {
        this.wheel.pending = false;
        this.applyWheel();
      });
    }
  };

  private applyWheel(): void {
    const { x, y, pinch, point } = this.wheel;
    this.wheel.x = 0;
    this.wheel.y = 0;
    this.wheel.pinch = 0;
    const region = this.host.regionAt(point);

    if (region.kind === 'price-axis') {
      this.host.zoomPrice(
        region.paneId,
        region.scale,
        Math.exp(-(y + pinch) * WHEEL_ZOOM_SPEED),
        point.y
      );
      return;
    }

    if (pinch !== 0) {
      this.host.zoomTime(Math.exp(-pinch * PINCH_WHEEL_SPEED), point.x);
    }

    // Horizontal swipes scroll; vertical wheel movement zooms around the pointer.
    if (Math.abs(x) > Math.abs(y)) {
      this.host.scrollTime(-x);
    } else if (y !== 0) {
      this.host.zoomTime(Math.exp(-y * WHEEL_ZOOM_SPEED), point.x);
    }

    this.host.setPointer(point);
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const point = this.local(event);
    const tool = this.host.activeTool();

    if (tool) {
      tool.doubleClick(point);
      return;
    }

    const region = this.host.regionAt(point);
    const target = region.kind === 'plot' ? this.host.hitTest(point) : null;

    if (!target || !this.host.editObject(target)) {
      this.host.doubleClick(point, region);
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    const point = this.local(event);
    const region = this.host.regionAt(point);
    const target = region.kind === 'plot' ? this.host.hitTest(point) : null;

    if (this.host.contextMenu(point, target, event)) {
      event.preventDefault();
    }
  };

  /** Remembers the modifiers and position of pointer input. */
  private track(event: PointerEvent, point: Point): void {
    this.modifiers = modifiersOf(event);
    this.lastPoint = point;
  }

  /** Pressing or releasing a modifier updates a drawing preview or drag without moving. */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.refreshModifiers(event);
  };

  private refreshModifiers(event: KeyboardEvent): void {
    if (!MODIFIER_KEYS.has(event.key) || !this.lastPoint) {
      return;
    }

    this.modifiers = modifiersOf(event);
    const gesture = this.gesture;

    if (gesture.kind === 'drag') {
      gesture.session.move(this.lastPoint, this.modifiers);
    } else if (gesture.kind === 'tool' || gesture.kind === 'idle') {
      this.host.activeTool()?.pointerMove(this.lastPoint, this.modifiers);
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.refreshModifiers(event);

    if (!this.host.enabled('keyboard')) {
      return;
    }

    const handled = runKeyCommand(event, this.host, this.gesture.kind !== 'idle', () => {
      const tool = this.gesture.kind === 'tool';
      this.cancelGesture();

      // Escape ends the tool too, as it does between presses.
      if (tool) {
        this.host.command('escape');
      }
    });

    if (handled) {
      event.preventDefault();
    }
  };
}

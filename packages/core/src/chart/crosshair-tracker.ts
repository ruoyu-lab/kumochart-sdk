import type { BarStore } from '../data/bar-store';
import type { Point } from '../interaction/types';
import type { Frame } from '../render/frame';
import type { ChartCore } from './chart-core';
import { crosshairAt, type CrosshairState } from './cursor';

/** A crosshair placed without a pointer, e.g. to mirror another chart. */
export interface ExternalCrosshair {
  readonly time: number;
  readonly price: number | null;
  readonly paneId: string;
}

/**
 * The bar whose period holds `time`; past either end of the data, the slot a bar of that time
 * would take, where a pointer finds it too. A time after the latest bar's period is not the
 * latest bar: a chart mirroring another one's pointer past its data would show it there.
 */
function slotOf(bars: BarStore, time: number): number | null {
  const index = bars.indexAt(time);

  if (index >= 0 && index < bars.length - 1) {
    return index;
  }

  const logical = bars.logicalIndexOf(time);

  if (!Number.isFinite(logical)) {
    return index >= 0 ? index : null;
  }

  // Bar times are whole intervals apart; the epsilon keeps a bar's own time in its slot.
  return Math.floor(logical + 1e-9);
}

/** Whether two crosshairs are alike: where they are, and the bar and value they point at. */
function sameCrosshair(left: CrosshairState | null, right: CrosshairState | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  const a = left.bar;
  const b = right.bar;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.paneId === right.paneId &&
    left.index === right.index &&
    left.time === right.time &&
    left.price === right.price &&
    (a === null || b === null
      ? a === b
      : a.time === b.time &&
        a.open === b.open &&
        a.high === b.high &&
        a.low === b.low &&
        a.close === b.close &&
        a.volume === b.volume)
  );
}

/** How long after the bars last moved under the pointer the crosshair snaps to a bar again. */
const MOTION_REST_MS = 150;

/**
 * Where the crosshair is: at the pointer or at a programmatic position. It is resolved once per
 * frame, which also emits `crosshairMove` when the crosshair of the pointer changed: the pointer
 * moved, or what is under it did, as bars scrolled by the keyboard or updated in real time.
 */
export class CrosshairTracker {
  private pointer: Point | null = null;
  private external: ExternalCrosshair | null = null;
  private dirty = false;
  private fromPointer = false;
  private frame: Frame | null = null;
  private current: CrosshairState | null = null;
  /** The user scrolls or zooms the bars: the crosshair stays at the pointer until they rest. */
  private moving = false;
  private motionTimer = 0;
  /** Where the pointer was as the bars last moved; the crosshair stays there until it moves. */
  private restingAt: Point | null = null;

  constructor(
    private readonly core: ChartCore,
    private readonly changed: () => void
  ) {}

  /** The crosshair as of the last `sync()`. */
  get value(): CrosshairState | null {
    return this.current;
  }

  /** Moves the crosshair to a pointer position, or hides it with `null`. */
  setPointer(point: Point | null): void {
    if (this.moving) {
      this.restingAt = point;
    } else if (point?.x !== this.restingAt?.x || point?.y !== this.restingAt?.y) {
      this.restingAt = null;
    }

    this.pointer = point;
    this.external = null;
    this.dirty = true;
    this.fromPointer = true;
    this.changed();
  }

  /**
   * The bars move under the pointer by the user's scrolling or zooming. Snapped to the bar under a
   * pointer at rest, the crosshair would hop from bar to bar as they slide by: it follows the
   * pointer, and snaps again once the pointer moves after the bars rest. Snapping as they come
   * to rest would jump the line under a pointer that keeps still.
   */
  noteMotion(): void {
    const { view } = this.core;
    this.moving = true;
    this.restingAt = this.pointer;
    view.clearTimeout(this.motionTimer);
    this.motionTimer = view.setTimeout(() => {
      this.motionTimer = 0;
      this.moving = false;
    }, MOTION_REST_MS);
  }

  destroy(): void {
    this.core.view.clearTimeout(this.motionTimer);
  }

  setExternal(crosshair: ExternalCrosshair | null): void {
    this.pointer = null;
    this.external = crosshair;
    this.dirty = true;
    this.fromPointer = false;
    this.changed();
  }

  /** Re-resolves the crosshair when the pointer or the geometry changed. */
  sync(frame: Frame): void {
    if (!this.dirty && frame === this.frame) {
      return;
    }

    const previous = this.current;
    const next = this.locate(frame);
    this.current = next;
    this.frame = frame;
    this.dirty = false;

    if (this.fromPointer && !sameCrosshair(previous, next)) {
      // Events report x from the chart's left edge, beyond a left price axis.
      const x = (next?.x ?? 0) + frame.layout.leftAxisWidth;
      this.core.bus.emit(
        'crosshairMove',
        next ? { visible: true, ...next, x } : { visible: false }
      );
    }
  }

  /** The crosshair for the current pointer or programmatic position in `frame`. */
  private locate(frame: Frame): CrosshairState | null {
    const { core } = this;

    if (this.pointer) {
      const free = !core.options.crosshair.snapToBars || this.moving || this.restingAt !== null;
      return crosshairAt(core, frame, this.pointer.x, this.pointer.y, !free);
    }

    if (!this.external) {
      return null;
    }

    const { time, price, paneId } = this.external;
    const index = slotOf(core.bars, time);
    const pane = frame.panes.find((item) => item.id === paneId);

    if (index === null || !pane) {
      return null;
    }

    const y =
      price === null
        ? pane.plot.y + pane.plot.height / 2
        : pane.plot.y + pane.scale.valueToY(price);
    return crosshairAt(core, frame, core.timeScale.indexToX(index), y);
  }
}

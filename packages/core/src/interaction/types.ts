import type { LegendItem } from '../options/types';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The part of the chart under a point. */
export type Region =
  | { readonly kind: 'plot'; readonly paneId: string }
  | { readonly kind: 'price-axis'; readonly paneId: string; readonly scale: string }
  | { readonly kind: 'time-axis' }
  | { readonly kind: 'separator'; readonly above: string; readonly below: string }
  | { readonly kind: 'outside' };

export type ObjectKind = 'drawing' | 'order' | 'alert' | 'marker';

/**
 * A command of the keyboard or the context menu that modules run: Escape, Delete, undo, redo,
 * Enter, copy and paste.
 */
export type ChartCommand = 'escape' | 'delete' | 'undo' | 'redo' | 'enter' | 'copy' | 'paste';

/** A legend row under the pointer, and its button there. */
export interface LegendHit {
  readonly item: LegendItem;
  readonly button: string | null;
}

/** An object under the pointer. */
export interface HitTarget {
  readonly kind: ObjectKind;
  readonly id: string;
  /** The part that was hit, such as `line`, `label`, `handle:0` or `button:close`. */
  readonly part: string;
  /** CSS cursor while hovering it. */
  readonly cursor: string;
  readonly draggable: boolean;
}

/** Modifier keys held during a pointer action. */
export interface Modifiers {
  /** Constrains angles while drawing. */
  readonly shift: boolean;
  /** Copies a drawing while dragging it. */
  readonly alt: boolean;
  /** Ctrl, or ⌘ on macOS: inverts the drawing magnet. */
  readonly command: boolean;
}

export const NO_MODIFIERS: Modifiers = { shift: false, alt: false, command: false };

/** An object drag in progress. */
export interface DragSession {
  move(point: Point, modifiers: Modifiers): void;
  /** Keeps the result. */
  end(): void;
  /** Restores the state from before the drag. */
  cancel(): void;
}

/** A drawing tool placing points. */
export interface ToolSession {
  /** A mouse places an anchor where it presses; a finger, which covers it, where it lifts. */
  pointerDown(point: Point, modifiers: Modifiers, touch: boolean): void;
  pointerMove(point: Point, modifiers: Modifiers): void;
  pointerUp(point: Point, modifiers: Modifiers, touch: boolean): void;
  doubleClick(point: Point): void;
  /** The press in progress was lost (Escape, the window's blur, a pinch): what it placed goes. */
  cancelPress(): void;
}

export interface PaneResizeSession {
  /** Total vertical movement since the drag started. */
  move(deltaY: number): void;
  end(): void;
  /** Restores the heights from before the drag. */
  cancel(): void;
}

/** What the input controller asks the chart to do. */
export interface InteractionHost {
  readonly root: HTMLElement;
  enabled(
    feature: 'pan' | 'wheelZoom' | 'pinchZoom' | 'axisScale' | 'kineticScroll' | 'keyboard'
  ): boolean;
  longPressMs(): number;
  /** Runs `task` in the chart's next frame, before it paints what the task changes. */
  beforePaint(task: () => void): void;
  plotWidth(): number;
  /** X of the plots' left edge in the chart element, right of a left price axis. */
  originX(): number;
  regionAt(point: Point): Region;
  setPointer(point: Point | null): void;
  /** Shows the touch loupe at a point, or hides it with `null`. */
  magnify(point: Point | null): void;
  hitTest(point: Point): HitTarget | null;
  hover(target: HitTarget | null): void;
  /** Marks the separator below the pane `above` as hovered, or none with `null`. */
  hoverSeparator(above: string | null): void;
  /** The legend row, and its button, at a point. */
  legendAt(point: Point): LegendHit | null;
  /** Marks the legend row under the pointer, which shows its buttons. */
  hoverLegend(hit: LegendHit | null): void;
  /** A legend button was clicked. */
  clickLegend(hit: LegendHit): void;
  beginDrag(target: HitTarget, point: Point, modifiers: Modifiers): DragSession | null;
  activeTool(): ToolSession | null;
  click(point: Point, target: HitTarget | null): void;
  doubleClick(point: Point, region: Region): void;
  /** Returns whether the browser menu should be suppressed. */
  contextMenu(point: Point, target: HitTarget | null, event: MouseEvent): boolean;
  /** Scrolls the bars; returns whether they moved. */
  scrollTime(deltaX: number): boolean;
  /**
   * Zooms the bars from a pointer at `pointerX`, or with `null` from none, as the keys do; see
   * `TimeScale.zoomAnchor()`. Returns whether they moved.
   */
  zoomTime(factor: number, pointerX: number | null): boolean;
  isAutoScale(paneId: string): boolean;
  panPrice(paneId: string, deltaY: number): void;
  zoomPrice(paneId: string, scale: string, factor: number, anchorY: number): void;
  beginPaneResize(above: string, below: string): PaneResizeSession;
  /**
   * Runs a command of the modules, such as undo; returns whether one did anything. Escape that no
   * module takes clears the selection.
   */
  command(command: ChartCommand): boolean;
  /** Double-click on an object; returns whether it opened an editor. */
  editObject(target: HitTarget): boolean;
  scrollToRealTime(): void;
}

import type { Modifiers, Point, ToolSession } from '../interaction/types';
import { paneOf, type ObjectContext } from '../objects/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import type { PaneFrame } from '../render/frame';
import { anchorAt, freeAnchorAt, magnetFor, placeable, type AnchorRules } from './anchoring';
import type { DrawingPoint, DrawingStyle, DrawingTypeDefinition } from './types';
import { drawingOptions } from './options';
import { fail } from '../utils/errors';
import { checkArray } from '../utils/validate';

/** A stroke drawn by hand takes an anchor every few pixels the pointer moves. */
const FREEHAND_STEP = 3;

export interface ToolOptions {
  style?: Partial<DrawingStyle>;
  text?: string;
  /** Keeps the tool active after a drawing is placed, for drawing several in a row. */
  continuous?: boolean;
}

/** What a tool needs from the drawings. */
export interface ToolHost {
  context(): ObjectContext;
  definition(type: string): DrawingTypeDefinition;
  repaint(): void;
  /** Whether the drawing of the tool with `anchors` draws anything in `pane`. */
  draws(tool: DrawingTool, anchors: readonly DrawingPoint[], pane: PaneFrame): boolean;
  /** The tool placed every anchor. */
  complete(tool: DrawingTool): void;
}

/** Anchors the user places for a type; `0` means any number. */
export function placedCount(definition: DrawingTypeDefinition): number {
  return definition.place ?? definition.points;
}

/**
 * The anchors of a drawing from the anchors the user placed, as many as its type has: a
 * complete() that gives others fails before anything is placed.
 */
export function completed(
  definition: DrawingTypeDefinition,
  placed: readonly DrawingPoint[]
): readonly DrawingPoint[] {
  if (!definition.complete) {
    return placed;
  }

  const { type } = definition;
  const points = definition.complete(placed);
  checkArray(`complete() of "${type}"`, points);

  if (points.length !== definition.points) {
    fail(
      `complete() of "${type}" gives ${points.length} anchors; a "${type}" drawing has ${definition.points}.`
    );
  }

  return points;
}

export function paneAtPoint(context: ObjectContext, point: Point): PaneFrame | undefined {
  return context.frame.panes.find(
    (pane) =>
      point.y >= pane.plot.y &&
      point.y < pane.plot.y + pane.plot.height &&
      point.x >= 0 &&
      point.x < pane.plot.width
  );
}

export function local(pane: PaneFrame, point: Point): Point {
  return { x: point.x - pane.plot.x, y: point.y - pane.plot.y };
}

/**
 * The active drawing tool: places anchors with clicks, or where a finger lifts, previews the
 * next anchor under the pointer, snaps with the magnet and constrains the direction with Shift.
 */
export class DrawingTool implements ToolSession {
  points: DrawingPoint[] = [];
  /** The pane of the anchors placed so far, by id: the panes move as the chart's layout does. */
  paneId: string | null = null;
  private downAt: Point | null = null;
  /** Whether the press in progress placed an anchor, which goes when the press is lost. */
  private pressPlaced = false;
  /** Where the last anchor of a stroke drawn by hand was taken. */
  private strokeAt: Point | null = null;
  /** Where the pointer is, which the next anchor follows, and the keys held. */
  private hover: { readonly point: Point; readonly modifiers: Modifiers } | null = null;

  constructor(
    readonly type: string,
    readonly options: ToolOptions,
    private readonly host: ToolHost
  ) {}

  get definition(): DrawingTypeDefinition {
    return this.host.definition(this.type);
  }

  /** The pane of the anchors placed so far, as the chart lays it out now. */
  private placedPane(context: ObjectContext): PaneFrame | undefined {
    return this.paneId === null ? undefined : paneOf(context.frame, this.paneId);
  }

  /**
   * The pane an anchor at `point` goes in: that of the anchors placed so far, or the one under
   * `point`, which must be the main pane for a type computed from its bars.
   */
  private paneAt(context: ObjectContext, point: Point): PaneFrame | undefined {
    if (this.paneId !== null) {
      return this.placedPane(context);
    }

    const pane = paneAtPoint(context, point);
    return this.definition.mainPane && pane?.id !== MAIN_PANE_ID ? undefined : pane;
  }

  /** The pane of the drawing being placed, or of the anchor the pointer would place first. */
  pane(context: ObjectContext): PaneFrame | undefined {
    return this.hover ? this.paneAt(context, this.hover.point) : this.placedPane(context);
  }

  /** Drops the anchors placed in a pane that was removed: the next click starts over. */
  forgetPane(paneId: string): void {
    if (this.paneId === paneId) {
      this.points = [];
      this.paneId = null;
      this.downAt = null;
      this.strokeAt = null;
    }
  }

  pointerDown(point: Point, modifiers: Modifiers, touch: boolean): void {
    this.pressPlaced = false;

    // A finger covers where it presses: the anchor follows it, in the loupe, until it lifts.
    if (touch && !this.definition.freehand) {
      this.pointerMove(point, modifiers);
    } else if (this.placeAt(point, modifiers)) {
      this.pressPlaced = true;
      this.downAt = point;
      this.strokeAt = point;
    }
  }

  pointerMove(point: Point, modifiers: Modifiers): void {
    this.hover = { point, modifiers };
    const last = this.strokeAt;

    // A stroke drawn by hand follows the pointer while the button is held.
    if (
      this.definition.freehand &&
      this.downAt &&
      last &&
      Math.hypot(point.x - last.x, point.y - last.y) >= FREEHAND_STEP
    ) {
      this.strokeAt = point;
      this.placeNext(point, modifiers);
    }

    this.host.repaint();
  }

  /**
   * The anchor the pointer would place next, as the chart is now: the bars may have moved under
   * a pointer that kept still, scrolled by a wheel or a trackpad, and the anchor stays with it.
   */
  preview(context: ObjectContext): DrawingPoint | null {
    const hover = this.hover;
    const pane = hover && this.paneAt(context, hover.point);
    const anchor = hover && pane ? this.anchor(context, pane, hover.point, hover.modifiers) : null;
    return anchor && placeable(anchor) ? anchor : null;
  }

  /**
   * A mouse places anchors by clicking, then moving to the next one: holding the button never
   * draws. A finger places its anchor where it lifts, and leaves no pointer to follow.
   */
  pointerUp(point: Point, modifiers: Modifiers, touch: boolean): void {
    this.downAt = null;
    this.pressPlaced = false;

    if (this.definition.freehand) {
      this.endStroke(point, modifiers);
    } else if (touch) {
      this.hover = null;
      this.placeAt(point, modifiers);
    }
  }

  doubleClick(): void {
    this.finish();
  }

  /**
   * The press was lost, as to a pinch or the window's blur: what it placed goes, a stroke drawn by
   * hand or the anchor it pressed, and so does the anchor a finger was aiming; anchors placed
   * before stay.
   */
  cancelPress(): void {
    this.downAt = null;
    this.strokeAt = null;
    this.hover = null;

    if (this.pressPlaced) {
      this.points = this.definition.freehand ? [] : this.points.slice(0, -1);
      this.paneId = this.points.length > 0 ? this.paneId : null;
    }

    this.pressPlaced = false;
    this.host.repaint();
  }

  /** Letting go finishes a stroke drawn by hand; a click without a stroke starts over. */
  private endStroke(point: Point, modifiers: Modifiers): void {
    const last = this.strokeAt;
    this.strokeAt = null;

    if (last && (point.x !== last.x || point.y !== last.y)) {
      this.placeNext(point, modifiers);
    }

    if (this.points.length >= 2) {
      this.host.complete(this);
    } else {
      this.points = [];
      this.paneId = null;
    }

    this.host.repaint();
  }

  /** Ends a drawing with any number of anchors (a path); returns whether it did. */
  finish(): boolean {
    if (this.definition.points !== 0 || this.definition.freehand) {
      return false;
    }

    if (this.points.length < 2) {
      return false;
    }

    this.host.complete(this);
    return true;
  }

  /**
   * Places an anchor at `point` in `pane`; returns whether it could. The bars give an anchor no
   * place off the only bar; an anchor where the one before is, as the clicks of a double click
   * place it, adds nothing; and the last one is not placed where the drawing would draw
   * nothing, such as a VWAP after the last bar.
   */
  private place(
    context: ObjectContext,
    pane: PaneFrame,
    point: Point,
    modifiers: Modifiers
  ): boolean {
    const anchor = this.anchor(context, pane, point, modifiers);
    const previous = this.points.at(-1);
    const points = [...this.points, anchor];
    const required = placedCount(this.definition);

    if (
      !placeable(anchor) ||
      (previous?.time === anchor.time && previous.price === anchor.price) ||
      (points.length === required &&
        !this.host.draws(this, completed(this.definition, points), pane))
    ) {
      return false;
    }

    this.points = points;
    return true;
  }

  /**
   * Places an anchor at `point`, in its pane, as a press or a finger lifting does; returns
   * whether it did.
   */
  private placeAt(point: Point, modifiers: Modifiers): boolean {
    const context = this.host.context();
    const pane = this.paneAt(context, point);

    if (!pane || !this.place(context, pane, point, modifiers)) {
      return false;
    }

    this.paneId = pane.id;
    this.hover = null;
    this.completeWhenReady();
    this.host.repaint();
    return true;
  }

  /** Places the next anchor of the drawing at `point`, in the pane of those placed so far. */
  private placeNext(point: Point, modifiers: Modifiers): void {
    const context = this.host.context();
    const pane = this.placedPane(context);

    if (pane) {
      this.place(context, pane, point, modifiers);
    }
  }

  private anchor(
    context: ObjectContext,
    pane: PaneFrame,
    point: Point,
    modifiers: Modifiers
  ): DrawingPoint {
    if (this.definition.freehand) {
      return freeAnchorAt(context, pane, local(pane, point));
    }

    const rules: AnchorRules = {
      magnet: magnetFor(drawingOptions(context.options).magnet, modifiers),
      pivot: modifiers.shift ? (this.points.at(-1) ?? null) : null
    };
    return anchorAt(context, pane, local(pane, point), rules);
  }

  private completeWhenReady(): void {
    const required = placedCount(this.definition);

    if (required > 0 && this.points.length >= required) {
      this.host.complete(this);
    }
  }
}

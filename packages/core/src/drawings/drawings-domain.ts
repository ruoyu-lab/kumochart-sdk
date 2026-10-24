import type { DragSession, HitTarget, Modifiers, Point, ToolSession } from '../interaction/types';
import type { PaneFrame } from '../render/frame';
import type { ObjectContext, ObjectDomain, ObjectHit, ObjectPaintContext } from '../objects/types';
import { placeable } from './anchoring';
import { beginDrawingDrag } from './drawing-drag';
import {
  checkTextValue,
  DrawingHistory,
  type DrawingSnapshot,
  type DrawingStore
} from './drawing-store';
import { hitDrawings } from './hit-testing';
import {
  drawingBounds,
  geometryOf,
  paintDrawings,
  paintDrawingsBelow,
  paneShowing
} from './painting';
import { checkStyle } from './style';
import { TextEditing, type EditedText } from './text-editing';
import { completed, DrawingTool, type ToolOptions } from './tool';
import type { Drawing, DrawingBounds, DrawingInput, DrawingStyle } from './types';
import { drawingOptions } from './options';
import { fail } from '../utils/errors';
import { checkBoolean, checkFields, fieldsOf } from '../utils/validate';
import { sameData } from '../utils/merge';

const TOOL_FIELDS = fieldsOf<ToolOptions>({ style: true, text: true, continuous: true });

/** Bars a pasted or duplicated drawing is moved to the right, so it does not hide the original. */
const COPY_SHIFT_BARS = 5;

export type DrawingsChangeReason = 'create' | 'edit' | 'remove' | 'undo' | 'redo';
export type { ToolOptions } from './tool';

export interface DrawingsHost {
  context(): ObjectContext;
  /** The chart element, which hosts the text editor. */
  readonly root: HTMLElement;
  /**
   * Repaints the drawings, and with `below` the scene too, where placed drawings paint what they
   * put under the series.
   */
  repaint(below: boolean): void;
  /** Whether the chart has a pane, which drawings must be in. */
  paneExists(id: string): boolean;
  formatValue(pane: PaneFrame, value: number): string;
  /**
   * Drops the selection and the hover of objects that are gone, reporting the selection's change
   * when the user made it.
   */
  prune(user: boolean): void;
  /** A user action changed drawings. */
  changed(reason: DrawingsChangeReason, ids: readonly string[]): void;
  /** The user ended the tool of `type`: placed its drawing (`completed`) or cancelled it. */
  toolEnded(type: string, completed: boolean): void;
  /** A user action selected a drawing (or cleared the selection). */
  selected(id: string | null): void;
}

/** How a change of the drawings goes into the history and is reported. */
export interface DrawingsChange {
  /** Joins the step before when that one had the same key. */
  readonly merge?: string;
  /** The user made the change, which is reported for these drawings. */
  readonly user?: { readonly reason: DrawingsChangeReason; readonly ids: readonly string[] };
  /** The drawing the user selects with the change, before it is reported. */
  readonly select?: string;
}

/** A drawing as input for a copy of it, in its pane. */
type CopyInput = DrawingInput & { readonly pane: string };

/** A drawing as input for a copy of it. */
function copyInput(drawing: Drawing): CopyInput {
  return {
    type: drawing.type,
    pane: drawing.pane,
    points: drawing.points,
    style: drawing.style,
    text: drawing.text,
    locked: drawing.locked,
    visible: drawing.visible,
    timeframes: drawing.timeframes
  };
}

/** Drawings: storage, undo history, the active tool, editing, hit testing and painting. */
export class DrawingsDomain implements ObjectDomain {
  readonly kind = 'drawing';
  readonly history = new DrawingHistory(() => drawingOptions(this.host.context().options).history);
  private tool: DrawingTool | null = null;
  private clipboard: CopyInput | null = null;
  private readonly text: TextEditing;
  /** Set while the API closes the text editor, which then reports no end of a tool. */
  private quietly = false;
  /** The style each tool gives new drawings, under the style `startTool()` gives. */
  private readonly toolStyles = new Map<string, Partial<DrawingStyle>>();
  private readonly paneExists = (id: string) => this.host.paneExists(id);

  constructor(
    readonly store: DrawingStore,
    readonly host: DrawingsHost
  ) {
    this.text = new TextEditing({
      root: host.root,
      context: () => host.context(),
      repaint: () => {
        host.repaint(false);
      },
      definition: (type) => store.registry.require(type),
      keep: (edited, text) => {
        this.keepText(edited, text);
      },
      drop: (edited) => {
        this.dropText(edited);
      }
    });
  }

  edit(id: string): boolean {
    return this.editText(id);
  }

  has(id: string): boolean {
    return this.store.get(id) !== undefined;
  }

  /** Whether a drawing shows on the chart as it is: visible, on the timeframe displayed. */
  shown(id: string): boolean {
    const entry = this.store.get(id);
    return entry !== undefined && paneShowing(this.host.context(), entry) !== undefined;
  }

  // ─── Tool ──────────────────────────────────────────────────────────────────

  /** The tool, which places nothing while every drawing is hidden: the chart then has none. */
  activeTool(): ToolSession | null {
    return this.placing(this.host.context());
  }

  private placing(context: ObjectContext): DrawingTool | null {
    return drawingOptions(context.options).visible ? this.tool : null;
  }

  activeToolType(): string | null {
    return this.tool?.type ?? null;
  }

  startTool(type: string, options: ToolOptions): void {
    this.store.registry.require(type);
    checkFields('tool options', options, TOOL_FIELDS);
    const validated: ToolOptions = {
      ...(options.style !== undefined ? { style: checkStyle(options.style) } : {}),
      ...(options.text !== undefined ? { text: checkTextValue(options.text) } : {}),
      ...(options.continuous !== undefined &&
      checkBoolean('tool options.continuous', options.continuous)
        ? { continuous: true }
        : {})
    };
    this.closeTextQuietly(true);
    this.tool = this.newTool(type, validated);
    this.host.repaint(false);
  }

  /** Ends the tool, and drops the text of a drawing it placed, without reporting either. */
  cancelTool(): void {
    if (this.text.edited?.id === null) {
      this.closeTextQuietly(false);
    }

    if (this.tool) {
      this.tool = null;
      this.host.repaint(false);
    }
  }

  toolStyle(type: string): Partial<DrawingStyle> {
    this.store.registry.require(type);
    return { ...this.toolStyles.get(type) };
  }

  setToolStyle(type: string, style: Partial<DrawingStyle> | null): void {
    this.store.registry.require(type);

    if (style === null) {
      this.toolStyles.delete(type);
    } else {
      this.toolStyles.set(type, checkStyle(style));
    }

    this.host.repaint(false);
  }

  /**
   * Removes the drawings of a pane that was removed, with what is kept of them: their history, a
   * copy of one of them, the anchors the tool placed there and the editor of a text there.
   */
  forgetPane(paneId: string): void {
    const edited = this.text.edited;

    if (edited && this.paneOfText(edited) === paneId) {
      this.closeTextQuietly(false);
    }

    this.store.removePane(paneId);
    this.history.forgetPane(paneId);
    this.tool?.forgetPane(paneId);

    if (this.clipboard?.pane === paneId) {
      this.clipboard = null;
    }
  }

  /** The pane of a text being edited. */
  private paneOfText(edited: EditedText): string | undefined {
    return edited.id === null ? edited.input.pane : this.store.get(edited.id)?.pane;
  }

  /**
   * Forgets what is kept of a type that was unregistered: its tool's style, a copy of a drawing of
   * it and the text of one being placed.
   */
  forgetType(type: string): void {
    const edited = this.text.edited;

    if (edited?.id === null && edited.input.type === type) {
      this.closeTextQuietly(false);
    }

    this.toolStyles.delete(type);
    this.history.forgetType(type);

    if (this.clipboard?.type === type) {
      this.clipboard = null;
    }
  }

  /** The style of the drawing a tool places: its type's tool style, then the tool's own. */
  private placingStyle(tool: DrawingTool): Partial<DrawingStyle> {
    return { ...this.toolStyles.get(tool.type), ...tool.options.style };
  }

  /** Enter: finishes a drawing with any number of anchors. */
  finishTool(): boolean {
    return this.placing(this.host.context())?.finish() ?? false;
  }

  private newTool(type: string, options: ToolOptions): DrawingTool {
    return new DrawingTool(type, options, {
      context: () => this.host.context(),
      definition: (name) => this.store.registry.require(name),
      // A tool paints its drawing over the series, what goes under them too.
      repaint: () => {
        this.host.repaint(false);
      },
      draws: (tool, anchors, pane) => {
        const shape = {
          definition: tool.definition,
          style: this.placingStyle(tool),
          text: tool.options.text ?? ''
        };
        const geometry = geometryOf(this.host.context(), this.host, shape, anchors, pane);
        return drawingBounds(tool.definition, geometry) !== null;
      },
      complete: (tool) => {
        this.placed(tool);
      }
    });
  }

  /** The tool placed every anchor: creates the drawing, or first asks for its text. */
  private placed(tool: DrawingTool): void {
    const pane = tool.paneId;

    if (pane === null) {
      return;
    }

    this.tool = tool.options.continuous ? this.newTool(tool.type, tool.options) : null;
    const endsTool = this.tool === null;
    const style = this.placingStyle(tool);
    const input: DrawingInput = {
      type: tool.type,
      pane,
      points: completed(tool.definition, tool.points),
      ...(Object.keys(style).length > 0 ? { style } : {}),
      ...(tool.options.text !== undefined ? { text: tool.options.text } : {})
    };

    if (tool.definition.editableText && tool.options.text === undefined) {
      // The tool ends once its text is kept or dropped.
      this.text.open(input, { id: null, input, endsTool });
      this.host.repaint(false);
    } else {
      this.create(input);

      if (endsTool) {
        this.host.toolEnded(tool.type, true);
      }
    }
  }

  /** Adds a drawing as the user does: one step to undo, selected and reported. */
  private create(input: DrawingInput): void {
    const entry = this.store.create(input, this.paneExists);
    this.change(
      () => {
        this.store.add(entry);
      },
      { user: { reason: 'create', ids: [entry.id] }, select: entry.id }
    );
  }

  // ─── Changes ───────────────────────────────────────────────────────────────

  /**
   * Changes the drawings, the one way they change: `operation` as one step to undo, or as part of
   * the step before with the same merge key, then as every change goes on.
   */
  change(operation: () => void, change: DrawingsChange = {}): void {
    const before = this.store.snapshot();
    operation();
    this.changed(before, change);
  }

  /**
   * The drawings changed from `before`: a step to undo unless nothing changed, such as with
   * update(id, {}); then they settle, the drawing the user selects with the change is selected,
   * and the change is reported when the user made it.
   */
  private changed(before: DrawingSnapshot, change: DrawingsChange): void {
    if (!sameData(before, this.store.snapshot())) {
      this.history.record(before, change.merge ?? null);
    }

    if (change.select !== undefined) {
      this.host.selected(change.select);
    }

    this.settle(change.user !== undefined);

    if (change.user) {
      this.host.changed(change.user.reason, change.user.ids);
    }
  }

  /**
   * After the drawings changed: the editor of a drawing that is gone closes without its text, the
   * selection and the hover of drawings gone drop, and the drawings repaint.
   */
  private settle(user: boolean): void {
    const edited = this.text.edited;

    if (edited && edited.id !== null && !this.has(edited.id)) {
      this.closeTextQuietly(false);
    }

    this.host.prune(user);
    this.host.repaint(true);
  }

  /** Removes a drawing, as the user does with `user`. */
  remove(id: string, user: boolean): void {
    this.store.require(id);
    this.change(
      () => {
        this.store.remove(id);
      },
      user ? { user: { reason: 'remove', ids: [id] } } : {}
    );
  }

  /**
   * Puts `drawings` in place of every drawing, as a layout loads, with a history of its own: the
   * text being edited goes with the drawings, and a copy of a drawing with the pane it was in
   * when the layout has no such pane.
   */
  replace(drawings: DrawingSnapshot): void {
    this.closeTextQuietly(false);
    this.store.restore(drawings);
    this.history.clear();

    if (this.clipboard && !this.host.paneExists(this.clipboard.pane)) {
      this.clipboard = null;
    }

    this.settle(false);
  }

  /**
   * Undoes or redoes a step, as the user does with `user`; without a step, nothing. The text
   * being edited is kept first, as clicking an undo button outside its editor keeps it.
   */
  restore(direction: 'undo' | 'redo', user: boolean): boolean {
    if (!(direction === 'undo' ? this.history.canUndo : this.history.canRedo)) {
      return false;
    }

    this.closeTextQuietly(true);
    const current = this.store.snapshot();
    const target = direction === 'undo' ? this.history.undo(current) : this.history.redo(current);

    if (!target) {
      return false;
    }

    this.store.restore(target);
    this.settle(user);

    if (user) {
      this.host.changed(direction, []);
    }

    return true;
  }

  // ─── Clipboard ─────────────────────────────────────────────────────────────

  /**
   * A copy of a drawing a few bars to the right of where it was, or where it was when fewer than
   * two bars give no times to move it to.
   */
  private shifted(input: CopyInput): CopyInput | null {
    const { bars } = this.host.context();
    const points = input.points.map((point) => ({
      time: bars.timeOfLogicalIndex(bars.logicalIndexOf(Number(point.time)) + COPY_SHIFT_BARS),
      price: point.price
    }));
    // Without two bars there is no spacing to move the copy by.
    return points.every(placeable) ? { ...input, points } : null;
  }

  /** Copies the selected drawing; returns whether there was one. */
  copy(selection: string | null): boolean {
    const entry = selection === null ? undefined : this.store.get(selection);

    if (!entry) {
      return false;
    }

    this.clipboard = copyInput(this.store.info(entry));
    return true;
  }

  /** Pastes the copied drawing a few bars to the right; returns whether it could. */
  paste(): boolean {
    const shifted = this.clipboard && this.shifted(this.clipboard);

    if (!shifted) {
      return false;
    }

    this.clipboard = shifted;
    this.create(shifted);
    return true;
  }

  /** Adds a copy of a drawing a few bars to the right and returns its id. */
  duplicate(id: string): string {
    const copy =
      this.shifted(copyInput(this.store.info(this.store.require(id)))) ??
      fail('duplicate() needs two bars or more, to place the copy bars to the right.');
    const entry = this.store.create(copy, this.paneExists);
    this.change(() => {
      this.store.add(entry);
    });
    return entry.id;
  }

  // ─── Text ──────────────────────────────────────────────────────────────────

  /** Edits the text of a drawing in place; returns whether its type has editable text. */
  editText(id: string): boolean {
    const entry = this.store.require(id);

    if (!entry.definition.editableText || entry.locked) {
      return false;
    }

    this.closeTextQuietly(true);
    this.text.open(this.store.info(entry), { id });
    return true;
  }

  /** Keeps the text being edited, as clicking outside its editor does. */
  commitText(): void {
    this.text.commit();
  }

  /**
   * Closes the text editor for the API, keeping its text or not: a tool placing the drawing ends
   * without `toolEnd`, as the API's other ways of ending a tool do.
   */
  closeTextQuietly(keep: boolean): void {
    this.quietly = true;

    try {
      if (keep) {
        this.text.commit();
      } else {
        this.text.cancel();
      }
    } finally {
      this.quietly = false;
    }
  }

  /** Keeps the text an editor closed with: places the drawing with it, or edits the drawing's. */
  private keepText(edited: EditedText, text: string): void {
    const { id } = edited;

    if (id === null) {
      const placed = text.trim() !== '';

      if (placed) {
        this.create({ ...edited.input, text });
      }

      if (edited.endsTool && !this.quietly) {
        this.host.toolEnded(edited.input.type, placed);
      }
    } else if (this.has(id) && text !== this.store.require(id).text) {
      this.change(
        () => {
          this.store.update(id, { text }, this.paneExists);
        },
        { user: { reason: 'edit', ids: [id] } }
      );
    }
  }

  /** An editor closed without its text: the drawing a tool was placing is not placed. */
  private dropText(edited: EditedText): void {
    if (edited.id === null && edited.endsTool && !this.quietly) {
      this.host.toolEnded(edited.input.type, false);
    }
  }

  // ─── Geometry ──────────────────────────────────────────────────────────────

  /** The area a drawing covers in chart coordinates, clipped to its pane; `null` off screen. */
  bounds(id: string): DrawingBounds | null {
    const context = this.host.context();
    const entry = this.store.require(id);
    const pane = paneShowing(context, entry);

    if (!pane) {
      return null;
    }

    const box = drawingBounds(
      entry.definition,
      geometryOf(context, this.host, entry, entry.points, pane)
    );

    if (!box) {
      return null;
    }

    const left = Math.max(0, box.x);
    const top = Math.max(0, box.y);
    const right = Math.min(pane.plot.width, box.x + box.width);
    const bottom = Math.min(pane.plot.height, box.y + box.height);

    if (!(right >= left && bottom >= top)) {
      return null;
    }

    // Reported from the chart's left edge, beyond a left price axis.
    return {
      x: context.frame.layout.leftAxisWidth + pane.plot.x + left,
      y: pane.plot.y + top,
      width: right - left,
      height: bottom - top
    };
  }

  // ─── Hit testing, dragging and painting ────────────────────────────────────

  hitTest(context: ObjectContext, point: Point): ObjectHit | null {
    return hitDrawings(this.store.list(), this.host, context, point);
  }

  beginDrag(
    context: ObjectContext,
    target: HitTarget,
    point: Point,
    modifiers: Modifiers
  ): DragSession | null {
    return beginDrawingDrag(
      {
        store: this.store,
        context: () => this.host.context(),
        keepText: () => {
          this.commitText();
        },
        copyOf: (source) => this.store.create(copyInput(this.store.info(source)), this.paneExists),
        select: (id) => {
          this.host.selected(id);
        },
        repaint: (below) => {
          this.host.repaint(below);
        },
        dropped: (before, id, created) => {
          this.changed(before, { user: { reason: created ? 'create' : 'edit', ids: [id] } });
        },
        cancelled: () => {
          this.settle(true);
        }
      },
      context,
      target,
      point,
      modifiers
    );
  }

  /**
   * Paints what the drawings of `pane` put under its series, such as the zones of a position;
   * `ctx` is translated to the plot.
   */
  paintBelow(context: ObjectPaintContext, pane: PaneFrame): void {
    paintDrawingsBelow(context, this.host, this.store.list(), pane);
  }

  paint(context: ObjectPaintContext): void {
    const tool = this.placing(context);
    paintDrawings(context, this.host, this.store.list(), {
      placing: tool && { tool, style: this.placingStyle(tool) },
      editing: this.text.edited?.id ?? null
    });
  }
}

import type { DragSession, HitTarget, Modifiers, Point } from '../interaction/types';
import { paneOf, type ObjectContext } from '../objects/types';
import type { PaneFrame } from '../render/frame';
import { anchorAt, magnetFor, placeable } from './anchoring';
import type { DrawingEntry, DrawingSnapshot, DrawingStore } from './drawing-store';
import { handleOf, moveHandle, pivotFor } from './handles';
import { LINEAR_SCALE, LOG_SCALE } from './levels';
import { drawingOptions } from './options';
import { styleOf } from './painting';
import { local } from './tool';
import type { DrawingPoint, DrawingSpace } from './types';

/** What dragging a drawing needs of the drawings. */
export interface DragHost {
  readonly store: DrawingStore;
  context(): ObjectContext;
  /** Keeps the text being edited, before the drag changes anything. */
  keepText(): void;
  /** A copy of a drawing, in its pane, to drag with Alt held. */
  copyOf(source: DrawingEntry): DrawingEntry;
  /** Selects a drawing, as the user does. */
  select(id: string): void;
  /** Repaints the drawings as they move, and with `below` the scene too. */
  repaint(below: boolean): void;
  /** The drag moved a drawing, or made one, from the drawings `before`: one step to undo. */
  dropped(before: DrawingSnapshot, id: string, created: boolean): void;
  /** The drag was cancelled: the drawings are back as they were. */
  cancelled(): void;
}

/**
 * The space the drawings of a pane are drawn in: its scale, the positions of the bars, and how
 * tall a unit of the scale is against the width of a bar.
 */
function spaceOf({ bars, timeScale }: ObjectContext, pane: PaneFrame): DrawingSpace {
  const unit = Math.abs(pane.scale.yToScale(0) - pane.scale.yToScale(1));
  return {
    ...(pane.scale.mode === 'log' ? LOG_SCALE : LINEAR_SCALE),
    barIndex: (time) => bars.logicalIndexOf(time),
    timeAt: (index) => bars.timeOfLogicalIndex(index),
    unitHeight: unit > 0 ? 1 / unit / timeScale.barSpacing : 1
  };
}

/** Where a drag started on the bars: the logical index and the scaled value under the pointer. */
interface DragStart {
  readonly index: number;
  readonly value: number;
}

/**
 * Anchors moved by whole bars and by the value from where the drag started to the pointer. The
 * start is kept on the bars, not on the screen, so that a drawing dragged as the view scrolls or
 * zooms stays under the pointer.
 */
function translated(
  context: ObjectContext,
  pane: PaneFrame,
  original: readonly DrawingPoint[],
  start: DragStart,
  position: Point
): DrawingPoint[] {
  const { timeScale, bars } = context;
  const steps = Math.round(timeScale.xToIndex(position.x) - start.index);
  const shift = pane.scale.yToScale(position.y) - start.value;
  return original.map((anchor) => ({
    time: bars.timeOfLogicalIndex(bars.logicalIndexOf(anchor.time) + steps),
    price: pane.scale.fromScale((pane.scale.toScale(anchor.price) ?? Number.NaN) + shift)
  }));
}

/**
 * Drags a drawing, or one of its handles, from `point`: Alt drags a copy and leaves the
 * original in place. `null` for a drawing that cannot be dragged.
 */
export function beginDrawingDrag(
  host: DragHost,
  context: ObjectContext,
  target: HitTarget,
  point: Point,
  modifiers: Modifiers
): DragSession | null {
  const { store } = host;
  const source = store.get(target.id);

  if (!source || source.locked || !paneOf(context.frame, source.pane)) {
    return null;
  }

  host.keepText();
  const handle = handleOf(target.part);
  let entry = source;

  if (modifiers.alt && handle === null) {
    entry = host.copyOf(source);
    store.add(entry);
  }

  const created = entry !== source;
  /** Whether the drawing paints under the series, which the drag then repaints too. */
  const below = entry.definition.paintBelow !== undefined;
  const original = entry.points.map((anchor) => ({ ...anchor }));
  const startPane = paneOf(context.frame, entry.pane);
  const pressed = startPane ? local(startPane, point) : point;
  const start: DragStart = {
    index: context.timeScale.xToIndex(pressed.x),
    value: startPane ? startPane.scale.yToScale(pressed.y) : Number.NaN
  };
  let moved = false;
  host.select(entry.id);
  /**
   * Whether the drawing dragged is still there. The API may remove it or replace every drawing
   * while the drag goes on, which then leaves them alone.
   */
  const dragged = () => store.get(entry.id) === entry;
  /** The drawings as they are, without what the drag did: the copy it made, or its moves. */
  const undragged = (): DrawingSnapshot => {
    const drawings = store.snapshot();
    return created
      ? drawings.filter((item) => item.id !== entry.id)
      : drawings.map((item) => (item.id === entry.id ? { ...item, points: original } : item));
  };

  return {
    move: (next, held) => {
      const current = host.context();
      const pane = paneOf(current.frame, entry.pane);

      if (!pane || !dragged()) {
        return;
      }

      const position = local(pane, next);
      const points =
        handle === null
          ? translated(current, pane, original, start, position)
          : moveHandle(
              entry.definition,
              original,
              handle,
              anchorAt(current, pane, position, {
                magnet: magnetFor(drawingOptions(current.options).magnet, held),
                pivot: held.shift ? pivotFor(entry.definition, original, handle) : null
              }),
              spaceOf(current, pane),
              styleOf(current, entry)
            );

      // Off the only bar, the bars give the anchors no time: the drawing stays where it was.
      if (!points.every(placeable)) {
        return;
      }

      store.setPoints(entry.id, points);
      moved = true;
      host.repaint(below);
    },
    end: () => {
      if ((moved || created) && dragged()) {
        host.dropped(undragged(), entry.id, created);
      }
    },
    cancel: () => {
      if (dragged()) {
        store.restore(undragged());
        host.select(source.id);
        host.cancelled();
      }
    }
  };
}

import type { Point } from '../interaction/types';
import { HitPriority, type ObjectContext, type ObjectHit } from '../objects/types';
import type { PaneFrame } from '../render/frame';
import type { DrawingEntry } from './drawing-store';
import { HANDLE_PART, handleAt, handlesOf } from './handles';
import { drawingOptions } from './options';
import { geometryOf, paneShowing, reaches, type PaintHost } from './painting';
import { local } from './tool';
import type { DrawingHit } from './types';

/** Markers of handles are grabbed this much beyond their radius. */
const HANDLE_HIT_EXTRA = 4;

/** Whether a point of the chart is over the plot of a pane, where its drawings are painted. */
function insidePlot(pane: PaneFrame, point: Point): boolean {
  return point.y >= pane.plot.y && point.y < pane.plot.y + pane.plot.height;
}

/**
 * Handles of the selected and the hovered drawing can be grabbed, in their pane: a handle past
 * its edge is not painted.
 */
function handleHit(
  entries: readonly DrawingEntry[],
  host: PaintHost,
  context: ObjectContext,
  point: Point
): ObjectHit | null {
  const ids = new Set<string>();

  if (context.selection?.kind === 'drawing') {
    ids.add(context.selection.id);
  }

  if (context.hovered?.kind === 'drawing') {
    ids.add(context.hovered.id);
  }

  let best: ObjectHit | null = null;

  // The selected drawing's first, which keeps a tie.
  for (const id of ids) {
    const entry = entries.find((each) => each.id === id);
    const pane = entry ? paneShowing(context, entry) : undefined;

    if (!entry || !pane || !insidePlot(pane, point)) {
      continue;
    }

    const geometry = geometryOf(context, host, entry, entry.points, pane);
    const radius = drawingOptions(context.options).handleRadius + HANDLE_HIT_EXTRA;
    const hit = handleAt(
      handlesOf(entry.definition, geometry),
      local(pane, point),
      radius,
      context.options.interaction.hitTolerance
    );

    if (hit && (!best || hit.distance < best.distance)) {
      best = {
        target: {
          kind: 'drawing',
          id: entry.id,
          part: `${HANDLE_PART}${hit.handle.id}`,
          cursor: entry.locked ? 'pointer' : (hit.handle.cursor ?? 'move'),
          draggable: !entry.locked
        },
        priority: HitPriority.handle,
        distance: hit.distance
      };
    }
  }

  return best;
}

/** Whether a hit beats another: a line beats a body, and of the same part the nearer wins. */
function beats(hit: DrawingHit, other: DrawingHit): boolean {
  return hit.part === other.part ? hit.distance < other.distance : hit.part === 'line';
}

/**
 * The drawing under a point of the chart: a handle of the selected or the hovered drawing, else
 * a line before the inside of a shape, the nearer of the same part, the upper one at a tie.
 */
export function hitDrawings(
  entries: readonly DrawingEntry[],
  host: PaintHost,
  context: ObjectContext,
  point: Point
): ObjectHit | null {
  const handle = handleHit(entries, host, context, point);

  if (handle) {
    return handle;
  }

  const tolerance = context.options.interaction.hitTolerance;
  let best: { readonly entry: DrawingEntry; readonly hit: DrawingHit } | null = null;

  // From the top drawing down, so that the upper one keeps a tie.
  for (const entry of [...entries].reverse()) {
    const pane = paneShowing(context, entry);

    if (!pane || !insidePlot(pane, point)) {
      continue;
    }

    const geometry = geometryOf(context, host, entry, entry.points, pane);
    const at = local(pane, point);
    // Away from the point, it has nothing there to hit.
    const near = reaches(entry.definition, geometry, {
      x: at.x - tolerance,
      y: at.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2
    });
    const hit = near ? entry.definition.hitTest(geometry, at, tolerance) : null;

    if (hit && (!best || beats(hit, best.hit))) {
      best = { entry, hit };
    }
  }

  return (
    best && {
      target: {
        kind: 'drawing',
        id: best.entry.id,
        part: best.hit.part,
        cursor: 'pointer',
        draggable: !best.entry.locked
      },
      priority: best.hit.part === 'line' ? HitPriority.line : HitPriority.body,
      distance: best.hit.distance
    }
  );
}

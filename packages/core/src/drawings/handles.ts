import { applyStroke } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import type { Point } from '../interaction/types';
import { distanceToSegment } from './geometry';
import { fail } from '../utils/errors';
import type {
  DrawingGeometry,
  DrawingHandle,
  DrawingPoint,
  DrawingSpace,
  DrawingStyle,
  DrawingTypeDefinition
} from './types';

/** What the part of a hit on a handle starts with, before the handle's id. */
export const HANDLE_PART = 'handle:';

/** The id of the handle a part of a hit names, or `null` for a part that is no handle. */
export function handleOf(part: string): string | null {
  return part.startsWith(HANDLE_PART) ? part.slice(HANDLE_PART.length) : null;
}

/** Whether a handle is named after an anchor, by its index: `'0'`, `'1'`, … */
function isAnchor(handle: DrawingHandle, count: number): boolean {
  const index = Number(handle.id);
  return Number.isInteger(index) && index >= 0 && index < count && String(index) === handle.id;
}

/**
 * The handles of a drawing: the definition's, or one per anchor. Without moveHandle(), the
 * definition's handles must be named after anchors, which dragging them moves; one that is not
 * fails as soon as it shows, rather than once it is dragged.
 */
export function handlesOf(
  definition: DrawingTypeDefinition,
  geometry: DrawingGeometry
): readonly DrawingHandle[] {
  if (!definition.handles) {
    return geometry.points.map((point, index) => ({ id: String(index), x: point.x, y: point.y }));
  }

  const handles = definition.handles(geometry);
  const other = definition.moveHandle
    ? undefined
    : handles.find((handle) => !isAnchor(handle, geometry.anchors.length));

  if (other) {
    fail(
      `The handle "${other.id}" of a "${definition.type}" drawing is no anchor; define moveHandle() to move it.`
    );
  }

  return handles;
}

/** The anchors after dragging a handle to `to`: without moveHandle(), the anchor it names. */
export function moveHandle(
  definition: DrawingTypeDefinition,
  anchors: readonly DrawingPoint[],
  handle: string,
  to: DrawingPoint,
  space: DrawingSpace,
  style: DrawingStyle
): readonly DrawingPoint[] {
  if (definition.moveHandle) {
    return definition.moveHandle(anchors, handle, to, space, style);
  }

  return anchors.map((anchor, index) => (String(index) === handle ? to : anchor));
}

/**
 * The anchor that `Shift` constrains a dragged anchor handle against: its neighbour. Custom
 * handles are not constrained.
 */
export function pivotFor(
  definition: DrawingTypeDefinition,
  anchors: readonly DrawingPoint[],
  handle: string
): DrawingPoint | null {
  if (definition.handles || anchors.length < 2) {
    return null;
  }

  const index = Number(handle);
  return anchors[index - 1] ?? anchors[index + 1] ?? null;
}

/**
 * The handle under `point`: the closest marker within `radius`, or else the closest handle line
 * within `tolerance`.
 */
export function handleAt(
  handles: readonly DrawingHandle[],
  point: Point,
  radius: number,
  tolerance: number
): { handle: DrawingHandle; distance: number } | null {
  let best: { handle: DrawingHandle; distance: number } | null = null;

  for (const handle of handles) {
    const distance = Math.hypot(handle.x - point.x, handle.y - point.y);

    if (handle.marker !== false && distance <= radius && (!best || distance < best.distance)) {
      best = { handle, distance };
    }
  }

  if (best) {
    return best;
  }

  for (const handle of handles) {
    const distance = handle.line
      ? distanceToSegment(point, handle.line[0], handle.line[1])
      : Number.POSITIVE_INFINITY;

    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { handle, distance };
    }
  }

  return best;
}

export interface HandleLook {
  readonly color: string;
  readonly background: string;
  readonly radius: number;
  /** Id of the handle under the pointer, drawn larger and filled. */
  readonly hovered: string | null;
}

/** Paints handles at plot-relative positions offset by `origin`. */
export function paintHandles(
  ctx: CanvasRenderingContext2D,
  origin: Point,
  handles: readonly Pick<DrawingHandle, 'id' | 'x' | 'y' | 'marker'>[],
  look: HandleLook
): void {
  for (const handle of handles) {
    if (handle.marker === false) {
      continue;
    }

    const x = origin.x + handle.x;
    const y = origin.y + handle.y;
    const active = handle.id === look.hovered;

    if (active) {
      ctx.beginPath();
      ctx.arc(x, y, look.radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(look.color, 0.18);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, active ? look.radius + 1 : look.radius, 0, Math.PI * 2);
    ctx.fillStyle = active ? look.color : look.background;
    ctx.fill();
    applyStroke(ctx, active ? look.background : look.color, 1.5);
    ctx.stroke();
  }
}

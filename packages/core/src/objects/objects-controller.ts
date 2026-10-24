import type { DragSession, HitTarget, Modifiers, ObjectKind, Point } from '../interaction/types';
import type {
  ObjectContext,
  ObjectDomain,
  ObjectHit,
  ObjectPaintContext,
  Selection
} from './types';

function sameTarget(left: HitTarget | null, right: HitTarget | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.id === right.id &&
      left.part === right.part)
  );
}

/**
 * Coordinates the object domains the modules add: picks the best hit across all of them, keeps
 * the single selection and the hovered object, and paints every domain in z-order.
 */
export class ObjectsController {
  private selected: Selection | null = null;
  private hoveredTarget: HitTarget | null = null;
  private domains: Array<{ readonly domain: ObjectDomain; readonly z: number }> = [];

  /** Adds the objects of a kind, painted over the domains of a lower `z`. */
  add(domain: ObjectDomain, z: number): void {
    this.domains = [...this.domains, { domain, z }].sort((left, right) => left.z - right.z);
  }

  /** The kinds of objects the chart has. */
  kinds(): ObjectKind[] {
    return this.domains.map(({ domain }) => domain.kind);
  }

  get selection(): Selection | null {
    return this.selected;
  }

  get hovered(): HitTarget | null {
    return this.hoveredTarget;
  }

  /** Sets the hovered object; returns whether it changed. */
  setHovered(target: HitTarget | null): boolean {
    if (sameTarget(target, this.hoveredTarget)) {
      return false;
    }

    this.hoveredTarget = target;
    return true;
  }

  /** Sets the selection; returns whether it changed. */
  select(selection: Selection | null): boolean {
    const current = this.selected;

    if (
      current === selection ||
      (current && selection && current.kind === selection.kind && current.id === selection.id)
    ) {
      return false;
    }

    this.selected = selection;
    return true;
  }

  exists(selection: Selection): boolean {
    return this.domain(selection.kind)?.has(selection.id) ?? false;
  }

  /** Drops the selection and hover state of objects that no longer exist. */
  prune(): boolean {
    let changed = false;

    if (this.selected && !this.domain(this.selected.kind)?.has(this.selected.id)) {
      this.selected = null;
      changed = true;
    }

    if (this.hoveredTarget && !this.domain(this.hoveredTarget.kind)?.has(this.hoveredTarget.id)) {
      this.hoveredTarget = null;
      changed = true;
    }

    return changed;
  }

  hitTest(context: ObjectContext, point: Point): HitTarget | null {
    let best: ObjectHit | null = null;

    for (const { domain } of this.domains) {
      const hit = domain.hitTest(context, point);

      if (hit && (!best || this.beats(hit, best))) {
        best = hit;
      }
    }

    return best?.target ?? null;
  }

  beginDrag(
    context: ObjectContext,
    target: HitTarget,
    point: Point,
    modifiers: Modifiers
  ): DragSession | null {
    return this.domain(target.kind)?.beginDrag(context, target, point, modifiers) ?? null;
  }

  /** Opens the editor of an object, as a double click does; returns whether one opened. */
  edit(target: HitTarget): boolean {
    return this.domain(target.kind)?.edit?.(target.id) ?? false;
  }

  paint(context: ObjectPaintContext): void {
    for (const { domain } of this.domains) {
      domain.paint(context);
    }
  }

  private domain(kind: ObjectKind): ObjectDomain | undefined {
    return this.domains.find((entry) => entry.domain.kind === kind)?.domain;
  }

  /** Priority first, then the selected object, then the closest one. */
  private beats(hit: ObjectHit, best: ObjectHit): boolean {
    if (hit.priority !== best.priority) {
      return hit.priority > best.priority;
    }

    const hitSelected = this.isSelected(hit.target);
    const bestSelected = this.isSelected(best.target);

    if (hitSelected !== bestSelected) {
      return hitSelected;
    }

    return hit.distance < best.distance;
  }

  private isSelected(target: HitTarget): boolean {
    return this.selected?.kind === target.kind && this.selected.id === target.id;
  }
}

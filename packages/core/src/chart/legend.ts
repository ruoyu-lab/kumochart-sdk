import { IconCache } from '../canvas/icon-cache';
import type { LegendHit, Point } from '../interaction/types';
import type { Rect } from '../layout/layout';
import { paintCursor, type CrosshairView, type LegendLayout } from '../render/cursor-painter';
import type { Frame } from '../render/frame';
import {
  buildCursorView,
  type CrosshairState,
  type CursorSources,
  type LegendHover
} from './cursor';

const inside = (rect: Rect, point: Point) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/** The legend as last painted, and the row and button under the pointer. */
export class LegendState {
  readonly icons = new IconCache();
  layout: LegendLayout = { rows: [], buttons: [] };
  private hovered: LegendHover | null = null;

  get hover(): LegendHover | null {
    return this.hovered;
  }

  /**
   * Paints the cursor layer: the legends, the latest price's label and the crosshair, of which
   * `view` gives the lines and the labels, keeping where the legends went.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    sources: CursorSources,
    frame: Frame,
    crosshair: CrosshairState | null,
    view: CrosshairView | null,
    pixelRatio: number
  ): void {
    const cursor = buildCursorView(sources, frame, crosshair, view, Date.now(), this.hovered);
    this.layout = paintCursor(ctx, frame, sources.options, pixelRatio, cursor, this.icons);
  }

  /** The row, and the button, at a point in plot coordinates. */
  at(point: Point): LegendHit | null {
    const button = this.layout.buttons.find((candidate) => inside(candidate.rect, point));

    if (button) {
      return { item: button.item, button: button.id };
    }

    const row = this.layout.rows.find((candidate) => inside(candidate.rect, point));
    return row ? { item: row.item, button: null } : null;
  }

  /** Marks what is under the pointer; returns whether that changed. */
  setHover(hit: LegendHit | null): boolean {
    const next = hit ? { kind: hit.item.kind, id: hit.item.id, button: hit.button } : null;
    const previous = this.hovered;

    if (
      previous?.kind === next?.kind &&
      previous?.id === next?.id &&
      previous?.button === next?.button
    ) {
      return false;
    }

    this.hovered = next;
    return true;
  }
}

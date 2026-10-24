import type { Point } from '../interaction/types';
import type { Layout } from '../layout/layout';
import type { Theme } from '../options/types';
import { applyStroke } from '../canvas/canvas';

const RADIUS = 56;
const ZOOM = 2;
/** Clearance between the finger and the loupe, so the finger never covers it. */
const LIFT = 48;
const CROSS = 7;

/**
 * Paints a loupe above a touch point: the scene and the objects around it, magnified, with a
 * cross at the point itself, so a finger placing an anchor sees where it lands. `ctx` draws in
 * chart coordinates (x 0 at the plots' left edge); `sources` are the full layer canvases.
 */
export function paintMagnifier(
  ctx: CanvasRenderingContext2D,
  sources: readonly HTMLCanvasElement[],
  point: Point,
  layout: Layout,
  pixelRatio: number,
  theme: Theme
): void {
  const left = -layout.leftAxisWidth;
  const center = {
    x: Math.min(Math.max(point.x, left + RADIUS), left + layout.width - RADIUS),
    y: point.y - LIFT - RADIUS >= RADIUS ? point.y - LIFT - RADIUS : point.y + LIFT + RADIUS
  };

  // The source square around the point, in canvas pixels, clipped to the canvas.
  const half = RADIUS / ZOOM;
  const width = layout.width * pixelRatio;
  const height = layout.height * pixelRatio;
  const fromX = (point.x - left - half) * pixelRatio;
  const fromY = (point.y - half) * pixelRatio;
  const size = 2 * half * pixelRatio;
  const sx = Math.max(0, fromX);
  const sy = Math.max(0, fromY);
  const sw = Math.min(width, fromX + size) - sx;
  const sh = Math.min(height, fromY + size) - sy;
  const scale = (2 * RADIUS) / size;

  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = theme.background;
  ctx.fillRect(center.x - RADIUS, center.y - RADIUS, 2 * RADIUS, 2 * RADIUS);

  if (sw > 0 && sh > 0) {
    const dx = center.x - RADIUS + (sx - fromX) * scale;
    const dy = center.y - RADIUS + (sy - fromY) * scale;

    for (const source of sources) {
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
    }
  }

  ctx.beginPath();
  ctx.moveTo(center.x - CROSS, center.y);
  ctx.lineTo(center.x + CROSS, center.y);
  ctx.moveTo(center.x, center.y - CROSS);
  ctx.lineTo(center.x, center.y + CROSS);
  applyStroke(ctx, theme.crosshair, 1.5);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center.x, center.y, RADIUS, 0, Math.PI * 2);
  applyStroke(ctx, theme.border, 2);
  ctx.stroke();
}

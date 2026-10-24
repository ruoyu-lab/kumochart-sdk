/** Shapes of markers: on the chart's markers and on indicator values. */
export type MarkerShape =
  'arrow-up' | 'arrow-down' | 'triangle-up' | 'triangle-down' | 'circle' | 'square';

export const MARKER_SHAPES = [
  'arrow-up',
  'arrow-down',
  'triangle-up',
  'triangle-down',
  'circle',
  'square'
] as const;

/** Which way a shape points: up, down, or neither for circles and squares. */
export function shapeDirection(shape: MarkerShape): 1 | -1 | 0 {
  return shape === 'arrow-up' || shape === 'triangle-up'
    ? 1
    : shape === 'arrow-down' || shape === 'triangle-down'
      ? -1
      : 0;
}

/** Adds a shape centered on `x`, `y` to the current path; `size` is half its width. */
export function traceShape(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  size: number
): void {
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, size, 0, Math.PI * 2);
      return;
    case 'square':
      ctx.rect(x - size, y - size, size * 2, size * 2);
      return;
    case 'triangle-up':
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.lineTo(x - size, y + size);
      ctx.closePath();
      return;
    case 'triangle-down':
      ctx.moveTo(x, y + size);
      ctx.lineTo(x + size, y - size);
      ctx.lineTo(x - size, y - size);
      ctx.closePath();
      return;
    case 'arrow-up':
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x + size * 0.4, y);
      ctx.lineTo(x + size * 0.4, y + size);
      ctx.lineTo(x - size * 0.4, y + size);
      ctx.lineTo(x - size * 0.4, y);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      return;
    case 'arrow-down':
      ctx.moveTo(x, y + size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x + size * 0.4, y);
      ctx.lineTo(x + size * 0.4, y - size);
      ctx.lineTo(x - size * 0.4, y - size);
      ctx.lineTo(x - size * 0.4, y);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      return;
  }
}

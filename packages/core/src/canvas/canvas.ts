import type { LineStyle } from '../options/types';

function dashPattern(style: LineStyle, lineWidth: number): number[] {
  switch (style) {
    case 'solid':
      return [];
    case 'dashed':
      return [4 * lineWidth + 2, 3 * lineWidth + 1];
    case 'dotted':
      return [lineWidth, 2 * lineWidth + 1];
  }
}

export function applyStroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  style: LineStyle = 'solid'
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashPattern(style, lineWidth));
}

/** Snaps a coordinate so a line of `lineWidth` CSS pixels lands on whole device pixels. */
export function snap(coordinate: number, lineWidth: number, pixelRatio: number): number {
  const deviceWidth = Math.max(1, Math.round(lineWidth * pixelRatio));
  const device = Math.round(coordinate * pixelRatio);
  return (deviceWidth % 2 === 1 ? device + 0.5 : device) / pixelRatio;
}

/** Rounds a coordinate to the device pixel grid. */
export function alignToDevice(coordinate: number, pixelRatio: number): number {
  return Math.round(coordinate * pixelRatio) / pixelRatio;
}

/**
 * Paints between `save()` and `restore()`, restoring even when painting throws, so that the code
 * of a plugin or of a custom type that fails leaves no clip or transform behind for the frames
 * after it.
 */
export function isolated(ctx: CanvasRenderingContext2D, paint: () => void): void {
  ctx.save();

  try {
    paint();
  } finally {
    ctx.restore();
  }
}

export function font(size: number, family: string, weight: number | 'normal' = 'normal'): string {
  return `${weight} ${size}px ${family}`;
}

/** Draws a rounded label box with centered text and returns its width. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    background: string;
    color: string;
    paddingX: number;
    height: number;
    align: 'left' | 'center' | 'right';
    radius?: number;
  }
): number {
  const width = ctx.measureText(text).width + options.paddingX * 2;
  const left = options.align === 'left' ? x : options.align === 'right' ? x - width : x - width / 2;
  const top = y - options.height / 2;

  ctx.fillStyle = options.background;
  ctx.beginPath();
  ctx.roundRect(left, top, width, options.height, options.radius ?? 2);
  ctx.fill();
  ctx.fillStyle = options.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, y + 0.5);
  return width;
}

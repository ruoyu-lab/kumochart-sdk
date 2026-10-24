import type { Point } from '../../interaction/types';
import { leftEnd, textLineHeight } from '../geometry';
import type { DrawingGeometry, DrawingPaintContext, DrawingStyle } from '../types';
import { LABEL_GAP, strokeDrawing } from './shared';

/** Where a text goes in the room it has: at its start, its middle or its end. */
const SHARE = { left: 0, center: 0.5, right: 1, top: 0, middle: 0.5, bottom: 1 } as const;
const ARROW_SPREAD = Math.PI / 8;

/** Length of an arrowhead of a line of the style's width. */
export function arrowLength(style: DrawingStyle): number {
  return 9 + style.lineWidth * 2.5;
}

/**
 * How far back from its tip a line ending in an arrowhead stops, inside the head, so that its cap
 * does not poke through the tip: at most half of the line's `length`.
 */
export function arrowInset(style: DrawingStyle, length: number): number {
  return Math.min(length / 2, arrowLength(style) * 0.6);
}

/** A filled arrowhead of the style's size with its tip at `tip`, pointing along `angle`. */
export function paintArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  angle: number,
  style: DrawingStyle,
  color = style.color
): void {
  const head = arrowLength(style);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - head * Math.cos(angle - ARROW_SPREAD),
    tip.y - head * Math.sin(angle - ARROW_SPREAD)
  );
  ctx.lineTo(
    tip.x - head * Math.cos(angle + ARROW_SPREAD),
    tip.y - head * Math.sin(angle + ARROW_SPREAD)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A solid line from `from` to `to` in `color`, ending in an arrowhead at `to`. */
export function paintArrow(
  context: DrawingPaintContext,
  from: Point,
  to: Point,
  color: string
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);

  // Anchors at the same place point nowhere.
  if (length === 0) {
    return;
  }

  const { style } = context.geometry;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const inset = arrowInset(style, length);
  strokeDrawing(
    context,
    (path) => {
      path.moveTo(from.x, from.y);
      path.lineTo(to.x - inset * Math.cos(angle), to.y - inset * Math.sin(angle));
    },
    { color, lineStyle: 'solid' }
  );
  paintArrowHead(context.ctx, to, angle, style, color);
}

function textLines(geometry: DrawingGeometry): string[] {
  return geometry.text === '' ? [] : geometry.text.split('\n');
}

/** How far the drawing's text along a line reaches from the line: `0` without text. */
export function segmentTextReach(geometry: DrawingGeometry): number {
  const lines = textLines(geometry);
  return lines.length === 0
    ? 0
    : LABEL_GAP + lines.length * textLineHeight(geometry.style.fontSize);
}

/**
 * Lines of text in a block `width` wide from `left`, the first line's middle at `top`, each
 * aligned in it as `textAlign` says, in `color`.
 */
export function paintTextBlock(
  context: DrawingPaintContext,
  lines: readonly string[],
  left: number,
  top: number,
  width: number,
  color: string
): void {
  const { ctx, geometry } = context;
  const { style } = geometry;
  const lineHeight = textLineHeight(style.fontSize);
  ctx.font = geometry.textFont;
  ctx.fillStyle = color;
  ctx.textAlign = style.textAlign;
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, left + width * SHARE[style.textAlign], top + index * lineHeight);
  });
}

/**
 * The drawing's text along the segment from `start` to `end`, upright: at its left end, middle
 * or right end as `textAlign` says, and above it, on it or below it as `textPosition` says. Text
 * on the line is set on the background, so the line does not cross it.
 */
export function paintSegmentText(context: DrawingPaintContext, start: Point, end: Point): void {
  const lines = textLines(context.geometry);

  if (lines.length === 0) {
    return;
  }

  const { ctx, geometry } = context;
  const { style } = geometry;
  const [left, right] = leftEnd(start, end) ? [start, end] : [end, start];
  const room = Math.hypot(right.x - left.x, right.y - left.y) - LABEL_GAP * 2;
  const lineHeight = textLineHeight(style.fontSize);
  const height = lines.length * lineHeight;
  const top =
    style.textPosition === 'top'
      ? -LABEL_GAP - height
      : style.textPosition === 'bottom'
        ? LABEL_GAP
        : -height / 2;
  ctx.save();
  ctx.translate(left.x, left.y);
  ctx.rotate(Math.atan2(right.y - left.y, right.x - left.x));

  if (style.textPosition === 'middle') {
    const width = Math.max(...lines.map((line) => geometry.measureText(line)));
    ctx.fillStyle = geometry.theme.background;
    ctx.fillRect((room - width) * SHARE[style.textAlign], top, width + LABEL_GAP * 2, height);
  }

  paintTextBlock(context, lines, LABEL_GAP, top + lineHeight / 2, room, style.textColor);
  ctx.restore();
}

/**
 * The drawing's text inside the box from `first` to `second`: at its left, center or right, and
 * at its top, middle or bottom.
 */
export function paintBoxText(context: DrawingPaintContext, first: Point, second: Point): void {
  const lines = textLines(context.geometry);

  if (lines.length === 0) {
    return;
  }

  const { style } = context.geometry;
  const lineHeight = textLineHeight(style.fontSize);
  const room = Math.abs(second.y - first.y) - LABEL_GAP * 2 - lines.length * lineHeight;
  paintTextBlock(
    context,
    lines,
    Math.min(first.x, second.x) + LABEL_GAP,
    Math.min(first.y, second.y) + LABEL_GAP + room * SHARE[style.textPosition] + lineHeight / 2,
    Math.abs(second.x - first.x) - LABEL_GAP * 2,
    style.textColor
  );
}

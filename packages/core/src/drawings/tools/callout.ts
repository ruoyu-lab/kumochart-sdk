import { withAlpha } from '../../canvas/color';
import type { Point } from '../../interaction/types';
import { distanceToSegment, textLineHeight } from '../geometry';
import type { Anchors, DrawingBounds, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { paintTextBlock } from './labels';
import { bodyHit, strokeDrawing } from './shared';
import { linesOf, TEXT_PADDING } from './shapes';

const PADDING = TEXT_PADDING + 2;
const TARGET_RADIUS = 3;

/** The box of text around the second anchor: its left edge, at the middle of the first line. */
function boxOf(geometry: DrawingGeometry<Anchors<2>>): DrawingBounds {
  const [, anchor] = geometry.points;
  const lines = linesOf(geometry);
  const lineHeight = textLineHeight(geometry.style.fontSize);
  const width = Math.max(...lines.map((line) => geometry.measureText(line)));
  return {
    x: anchor.x - PADDING,
    y: anchor.y - lineHeight / 2 - PADDING,
    width: width + PADDING * 2,
    height: lines.length * lineHeight + PADDING * 2
  };
}

/** Where the pointer from the target meets the box. */
function tailEnd(target: Point, box: DrawingBounds): Point {
  return {
    x: Math.min(Math.max(target.x, box.x), box.x + box.width),
    y: Math.min(Math.max(target.y, box.y), box.y + box.height)
  };
}

/** Text in a box pointing at a place on the chart: place the target, then the box. */
export const callout: DrawingTypeDefinition<Anchors<2>> = {
  type: 'callout',
  points: 2,
  editableText: true,
  textAnchor: 1,
  fields: [
    'color',
    'lineWidth',
    'lineStyle',
    'fill',
    'fillColor',
    'text',
    'textColor',
    'fontSize',
    'bold',
    'italic',
    'textAlign'
  ],
  defaultStyle: (theme) => ({ fillColor: withAlpha(theme.accent, 0.12) }),
  paint: (context) => {
    const { ctx, geometry, editing } = context;
    const [target, anchor] = geometry.points;
    const box = boxOf(geometry);
    const { style } = geometry;
    const end = tailEnd(target, box);
    strokeDrawing(context, (path) => {
      path.moveTo(target.x, target.y);
      path.lineTo(end.x, end.y);
    });
    ctx.beginPath();
    ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();

    const outline = (path: CanvasRenderingContext2D) => {
      path.roundRect(box.x, box.y, box.width, box.height, 4);
    };

    if (style.fill) {
      ctx.beginPath();
      outline(ctx);
      ctx.fillStyle = style.fillColor;
      ctx.fill();
    }

    strokeDrawing(context, outline, { lineStyle: 'solid' });

    if (editing) {
      return;
    }

    paintTextBlock(
      context,
      linesOf(geometry),
      anchor.x,
      anchor.y,
      box.width - PADDING * 2,
      geometry.text === '' ? withAlpha(style.textColor, 0.5) : style.textColor
    );
  },
  hitTest: (geometry, point, tolerance) => {
    const [target] = geometry.points;
    const box = boxOf(geometry);
    const inside =
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height;

    if (inside) {
      return bodyHit;
    }

    const distance = distanceToSegment(point, target, tailEnd(target, box));
    return distance <= tolerance ? { part: 'line', distance } : null;
  },
  bounds: (geometry) => {
    const [target] = geometry.points;
    const box = boxOf(geometry);
    const left = Math.min(box.x, target.x);
    const top = Math.min(box.y, target.y);
    return {
      x: left,
      y: top,
      width: Math.max(box.x + box.width, target.x) - left,
      height: Math.max(box.y + box.height, target.y) - top
    };
  }
};

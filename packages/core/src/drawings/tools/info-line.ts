import { withAlpha } from '../../canvas/color';
import { boundsOf, extendSides, insideRect, type Segment } from '../geometry';
import type { Anchors, DrawingBounds, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { screenAngle, sideLevel } from './lines';
import { barsBetween, priceChangeText } from './ranges';
import { bodyHit, segmentHit, strokeDrawing, tracePath } from './shared';

const PADDING = 6;
/** Between the second anchor and the box of the figures. */
const GAP = 10;
const LINE_GAP = 4;

interface InfoBox extends DrawingBounds {
  readonly lines: readonly string[];
  readonly lineHeight: number;
}

interface InfoLine {
  readonly line: Segment;
  readonly box: InfoBox;
}

function infoLineOf(geometry: DrawingGeometry<Anchors<2>>): InfoLine {
  const [start, end] = geometry.points;
  const [from, to] = geometry.anchors;
  const { style, texts } = geometry;
  const lines = [
    priceChangeText(geometry, from, to),
    `${texts.bars(barsBetween(geometry, from, to))} · ${texts.duration(to.time - from.time)}`,
    `${screenAngle(start, end).toFixed(2)}°`
  ];
  const lineHeight = style.fontSize + LINE_GAP;
  const width = Math.max(...lines.map((line) => geometry.measureText(line))) + PADDING * 2;
  const height = lines.length * lineHeight - LINE_GAP + PADDING * 2;
  // Beside the second anchor, on the side away from the first, and inside the plot.
  const after = end.x >= start.x;
  const x = after ? end.x + GAP : end.x - GAP - width;
  const y = end.y >= start.y ? end.y + GAP : end.y - GAP - height;
  return {
    line: extendSides(
      start,
      end,
      geometry.width,
      geometry.height,
      style.extendLeft,
      style.extendRight
    ),
    box: {
      x: Math.min(Math.max(x, 0), Math.max(0, geometry.width - width)),
      y: Math.min(Math.max(y, 0), Math.max(0, geometry.height - height)),
      width,
      height,
      lines,
      lineHeight
    }
  };
}

/**
 * An info line: a trend line with its figures in a box by its second anchor, the change of value
 * and its percentage, the bars and the time between the anchors, and its angle on screen.
 */
export const infoLine: DrawingTypeDefinition<Anchors<2>> = {
  type: 'info-line',
  points: 2,
  fields: ['color', 'lineWidth', 'lineStyle', 'extendLeft', 'extendRight', 'fontSize'],
  paint: (context) => {
    const { ctx, geometry } = context;
    const { line, box } = infoLineOf(geometry);
    strokeDrawing(context, (path) => {
      tracePath(path, line, false);
    });
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, 4);
    ctx.fillStyle = withAlpha(geometry.style.color, 0.9);
    ctx.fill();
    ctx.font = geometry.textFont;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    box.lines.forEach((text, index) => {
      ctx.fillText(text, box.x + PADDING, box.y + PADDING + index * box.lineHeight);
    });
  },
  hitTest: (geometry, point, tolerance) => {
    const { line, box } = infoLineOf(geometry);
    return (
      segmentHit(point, line[0], line[1], tolerance) ??
      (insideRect(point, box, { x: box.x + box.width, y: box.y + box.height }, tolerance)
        ? bodyHit
        : null)
    );
  },
  bounds: (geometry) => {
    const { line, box } = infoLineOf(geometry);
    return boundsOf([...line, box, { x: box.x + box.width, y: box.y + box.height }]);
  },
  levels: ([from, to], _scale, style) => [sideLevel('line', from, to, style)]
};

import { withAlpha } from '../../canvas/color';
import { boundsOf, extendSides, insideRect, type Segment } from '../geometry';
import type { Anchors, DrawingBounds, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { screenAngle, sideLevel } from './lines';
import { barsBetween, priceChangeText } from './ranges';
import { bodyHit, segmentHit, strokeDrawing, tracePath } from './shared';

const PADDING = 6;
/** Between the line and the box of the figures. */
const GAP = 8;
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
  // By the middle of the line, below it (left of an upright one), clear of it, inside the plot.
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const [nx, ny] = length === 0 ? [0, 1] : [(start.y - end.y) / length, (end.x - start.x) / length];
  const [ux, uy] = ny < 0 || (ny === 0 && nx > 0) ? [-nx, -ny] : [nx, ny];
  const reach = (Math.abs(ux) * width + Math.abs(uy) * height) / 2 + GAP;
  const x = (start.x + end.x) / 2 + ux * reach - width / 2;
  const y = (start.y + end.y) / 2 + uy * reach - height / 2;
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
 * An info line: a trend line with its figures in a box under its middle, the change of value
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

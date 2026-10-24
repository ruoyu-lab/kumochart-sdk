import type { Point } from '../../interaction/types';
import { insidePolygon, insideRect } from '../geometry';
import type { Anchors, DrawingBounds, DrawingGeometry, DrawingTypeDefinition } from '../types';
import { bodyHit, fillArea, strokeDrawing, tracePath } from './shared';

const LABEL_PADDING = 8;
/** How far up and right of its point a price label sits. */
const LABEL_OFFSET = 10;
const FLAG_HEIGHT = 22;
const FLAG_WIDTH = 16;
const FLAG_DEPTH = 10;

interface PriceLabel {
  readonly anchor: Point;
  readonly box: DrawingBounds;
  /** The tail from the box down to the point. */
  readonly tail: readonly Point[];
  readonly text: string;
  readonly font: string;
}

function priceLabelOf(geometry: DrawingGeometry<Anchors<1>>): PriceLabel {
  const [anchor] = geometry.points;
  const [point] = geometry.anchors;
  const { style } = geometry;
  const text = geometry.formatValue(point.price);
  const height = style.fontSize + 10;
  const width = geometry.measureText(text) + LABEL_PADDING * 2;
  const left = anchor.x + LABEL_OFFSET;
  const bottom = anchor.y - LABEL_OFFSET;
  return {
    anchor,
    box: { x: left, y: bottom - height, width, height },
    tail: [anchor, { x: left, y: bottom - height / 2 }, { x: left + height / 2, y: bottom }],
    text,
    font: geometry.textFont
  };
}

/**
 * The price of its point in a label above and to the right of it, with a tail pointing at it.
 * Its color is the label's; the text has its own.
 */
export const priceLabel: DrawingTypeDefinition<Anchors<1>> = {
  type: 'price-label',
  points: 1,
  fields: ['color', 'textColor', 'fontSize'],
  defaultStyle: () => ({ textColor: '#ffffff', bold: true }),
  paint: (context) => {
    const { ctx, geometry } = context;
    const label = priceLabelOf(geometry);
    const { box, tail } = label;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, 4);
    tracePath(ctx, tail, true);
    ctx.fillStyle = geometry.style.color;
    ctx.fill();
    ctx.font = label.font;
    ctx.fillStyle = geometry.style.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, box.x + box.width / 2, box.y + box.height / 2 + 0.5);
  },
  hitTest: (geometry, point, tolerance) => {
    const label = priceLabelOf(geometry);
    const { box } = label;
    const inBox = insideRect(
      point,
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      tolerance
    );
    return inBox || insidePolygon(point, label.tail) ? bodyHit : null;
  },
  bounds: (geometry) => {
    const { box, anchor } = priceLabelOf(geometry);
    return {
      x: anchor.x,
      y: box.y,
      width: box.x + box.width - anchor.x,
      height: anchor.y - box.y
    };
  }
};

/** The flag above its point: the pole's top and the flag's outline. */
function flagOf(geometry: DrawingGeometry<Anchors<1>>): { pole: Point; outline: Point[] } {
  const [anchor] = geometry.points;
  const top = anchor.y - FLAG_HEIGHT;
  const right = anchor.x + FLAG_WIDTH;
  return {
    pole: { x: anchor.x, y: top },
    outline: [
      { x: anchor.x, y: top },
      { x: right, y: top },
      { x: right - 4, y: top + FLAG_DEPTH / 2 },
      { x: right, y: top + FLAG_DEPTH },
      { x: anchor.x, y: top + FLAG_DEPTH }
    ]
  };
}

/** A small flag planted at its point, to mark a place on the chart. */
export const flagMark: DrawingTypeDefinition<Anchors<1>> = {
  type: 'flag-mark',
  points: 1,
  fields: ['color'],
  paint: (context) => {
    const { ctx, geometry } = context;
    const [anchor] = geometry.points;
    const flag = flagOf(geometry);

    strokeDrawing(
      context,
      (path) => {
        path.moveTo(anchor.x, anchor.y);
        path.lineTo(flag.pole.x, flag.pole.y);
      },
      { lineWidth: 1.5, lineStyle: 'solid' }
    );
    fillArea(ctx, flag.outline, geometry.style.color);
  },
  hitTest: (geometry, point, tolerance) => {
    const [anchor] = geometry.points;
    return insideRect(
      point,
      { x: anchor.x, y: anchor.y - FLAG_HEIGHT },
      { x: anchor.x + FLAG_WIDTH, y: anchor.y },
      tolerance
    )
      ? bodyHit
      : null;
  },
  bounds: ({ points: [anchor] }) => ({
    x: anchor.x,
    y: anchor.y - FLAG_HEIGHT,
    width: FLAG_WIDTH,
    height: FLAG_HEIGHT
  })
};

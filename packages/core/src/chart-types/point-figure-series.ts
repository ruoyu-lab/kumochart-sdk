import { alignToDevice } from '../canvas/canvas';
import { fail } from '../utils/errors';
import type { PointFigureStyle } from '../series/styles';
import type { SeriesPaintContext, SeriesTypeDefinition } from '../series/types';

/** Boxes lower than this many pixels draw as one block per column: X's and O's would blur. */
const MIN_BOX = 4;
/** Room around an X or an O within its box, as a share of the box. */
const INSET = 0.12;

/**
 * Point & figure columns as they are commonly drawn: an X (up color) or an O (down
 * color) in each box, centered on the box's level, from the column's open to its close. A
 * column's first box is an X when it sits above the previous column's last box, an O below it,
 * so a column turned one step back starts with its one box the other way.
 */
function paintPointFigure(context: SeriesPaintContext<PointFigureStyle>): void {
  const { ctx, points, style, pixelRatio, barSpacing, valueToY, first, transform } = context;
  const columns = context.bars ?? fail('Point & figure columns are OHLC bars.');
  const reported = transform?.box;
  const box = style.box ?? (typeof reported === 'number' ? reported : Number.NaN);

  if (!(box > 0)) {
    return;
  }

  const width = Math.max(1 / pixelRatio, barSpacing * style.widthRatio);
  /** The boxes within their room: X's, then O's, as left, top, right, bottom. */
  const crosses: number[] = [];
  const noughts: number[] = [];
  const blocks: Array<{ rising: boolean; x: number; top: number; bottom: number }> = [];

  for (let point = 0; point < points.count; point += 1) {
    const index = first + point;
    const open = columns.open(index);
    const close = columns.close(index);
    const rising = close > open;
    const firstRising = index > 0 ? open > columns.close(index - 1) : rising;
    const step = rising ? box : -box;
    const count = Math.round(Math.abs(close - open) / box) + 1;
    const x = points.x(point);
    const height = Math.abs(valueToY(open + box / 2) - valueToY(open - box / 2));

    if (height < MIN_BOX || width < MIN_BOX) {
      blocks.push({
        rising,
        x,
        top: valueToY(Math.max(open, close) + box / 2),
        bottom: valueToY(Math.min(open, close) - box / 2)
      });
      continue;
    }

    for (let at = 0; at < count; at += 1) {
      const level = open + at * step;
      const top = valueToY(level + box / 2);
      const bottom = valueToY(level - box / 2);

      if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
        continue;
      }

      const insetX = width * INSET;
      const insetY = Math.abs(bottom - top) * INSET;
      ((at === 0 ? firstRising : rising) ? crosses : noughts).push(
        x - width / 2 + insetX,
        Math.min(top, bottom) + insetY,
        x + width / 2 - insetX,
        Math.max(top, bottom) - insetY
      );
    }
  }

  ctx.setLineDash([]);
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let at = 0; at < crosses.length; at += 4) {
    const [left = 0, high = 0, right = 0, low = 0] = crosses.slice(at, at + 4);
    ctx.moveTo(left, high);
    ctx.lineTo(right, low);
    ctx.moveTo(left, low);
    ctx.lineTo(right, high);
  }

  ctx.strokeStyle = style.upColor;
  ctx.stroke();
  ctx.beginPath();

  for (let at = 0; at < noughts.length; at += 4) {
    const [left = 0, high = 0, right = 0, low = 0] = noughts.slice(at, at + 4);
    const radiusX = (right - left) / 2;
    ctx.moveTo(right, (high + low) / 2);
    ctx.ellipse(left + radiusX, (high + low) / 2, radiusX, (low - high) / 2, 0, 0, Math.PI * 2);
  }

  ctx.strokeStyle = style.downColor;
  ctx.stroke();

  for (const block of blocks) {
    const left = alignToDevice(block.x - width / 2, pixelRatio);
    ctx.fillStyle = block.rising ? style.upColor : style.downColor;
    ctx.fillRect(
      left,
      Math.min(block.top, block.bottom),
      Math.max(1 / pixelRatio, alignToDevice(width, pixelRatio)),
      Math.abs(block.bottom - block.top)
    );
  }
}

/**
 * Point & figure columns: draws the bars of the `point-figure` transform, X's in
 * rising columns and O's in falling ones, with the box size the transform reports (or
 * `style.box`).
 */
export const pointFigureSeries: SeriesTypeDefinition<PointFigureStyle> = {
  type: 'point-figure',
  input: 'ohlc',
  defaultStyle: (theme) => ({
    upColor: theme.up,
    downColor: theme.down,
    lineWidth: 1.5,
    widthRatio: 0.85,
    box: null
  }),
  paint: paintPointFigure
};

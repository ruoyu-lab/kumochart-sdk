import { drawLabel, font } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import { timeToX, type ObjectPaintContext } from '../objects/types';
import type { PaneFrame } from '../render/frame';
import type { DrawingAxisMarks, DrawingPoint, DrawingStyle, DrawingTypeDefinition } from './types';

const LABEL_PADDING_X = 6;
const LABEL_TEXT = '#ffffff';

/** Every anchor's value and time, as drawings mark them on the axes by default. */
export function anchorMarks(anchors: readonly DrawingPoint[]): DrawingAxisMarks {
  return {
    prices: anchors.map((anchor) => anchor.price),
    times: anchors.map((anchor) => anchor.time)
  };
}

/** The axis marks of a drawing's anchors, all of them: the definition's, or every anchor's. */
export function axisMarksOf(
  definition: DrawingTypeDefinition,
  anchors: readonly DrawingPoint[],
  style: DrawingStyle
): DrawingAxisMarks {
  return definition.axisMarks?.(anchors, style) ?? anchorMarks(anchors);
}

/**
 * Highlights a drawing on the axes in its color: value labels on the pane's price axis, time
 * labels on the time axis, and the range between them as a band unless `labelsOnly`.
 */
export function paintAxisMarks(
  context: ObjectPaintContext,
  pane: PaneFrame,
  marks: DrawingAxisMarks,
  color: string,
  formatValue: (value: number) => string,
  labelsOnly: boolean
): void {
  const { ctx, frame, options } = context;
  const height = options.font.size + 8;
  const half = height / 2;
  ctx.font = font(options.font.size, options.font.family);
  const top = pane.plot.y + half;
  const bottom = pane.plot.y + pane.plot.height - half;
  // By the index of each mark: one off the scale has no label, and the others keep theirs.
  const ys = marks.prices.map((price) => pane.plot.y + pane.scale.valueToY(price));
  const shownYs = ys.filter((y) => Number.isFinite(y));

  if (options.priceScale.visible && shownYs.length > 0) {
    const axis = pane.axis;

    if (!labelsOnly && shownYs.length > 1) {
      const from = Math.max(pane.plot.y, Math.min(...shownYs));
      const to = Math.min(pane.plot.y + pane.plot.height, Math.max(...shownYs));
      ctx.fillStyle = withAlpha(color, 0.14);
      ctx.fillRect(axis.x, from, axis.width, Math.max(0, to - from));
    }

    marks.prices.forEach((price, index) => {
      const y = ys[index];

      if (y !== undefined && y >= top - half && y <= bottom + half) {
        drawLabel(ctx, formatValue(price), axis.x + 1, Math.min(Math.max(y, top), bottom), {
          background: color,
          color: LABEL_TEXT,
          paddingX: LABEL_PADDING_X,
          height,
          align: 'left'
        });
      }
    });
  }

  const timeAxis = frame.layout.timeAxis;
  const xs = marks.times.map((time) => timeToX(context, time));
  const shownXs = xs.filter((x) => Number.isFinite(x));

  if (!timeAxis || shownXs.length === 0) {
    return;
  }

  if (!labelsOnly && shownXs.length > 1) {
    const from = Math.max(0, Math.min(...shownXs));
    const to = Math.min(frame.layout.plotWidth, Math.max(...shownXs));
    ctx.fillStyle = withAlpha(color, 0.14);
    ctx.fillRect(from, timeAxis.y, Math.max(0, to - from), timeAxis.height);
  }

  const interval = context.bars.interval();
  marks.times.forEach((time, index) => {
    const x = xs[index];

    if (x === undefined || !Number.isFinite(x) || x < 0 || x > frame.layout.plotWidth) {
      return;
    }

    const custom = options.timeScale.formatter;
    const text = custom
      ? custom(time, {
          kind: 'crosshair',
          unit: 'minute',
          locale: context.formatter.locale,
          timeZone: context.formatter.timeZone
        })
      : context.formatter.timeCrosshair(time, interval);
    const width = ctx.measureText(text).width + LABEL_PADDING_X * 2;
    const center = Math.min(Math.max(x, width / 2), frame.layout.plotWidth - width / 2);
    drawLabel(ctx, text, center, timeAxis.y + timeAxis.height / 2, {
      background: color,
      color: LABEL_TEXT,
      paddingX: LABEL_PADDING_X,
      height,
      align: 'center'
    });
  });
}

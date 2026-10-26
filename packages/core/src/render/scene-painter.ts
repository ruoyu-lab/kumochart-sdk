import type { ChartOptions } from '../options/types';
import { applyStroke, font, isolated, snap } from '../canvas/canvas';
import type { Rect } from '../layout/layout';
import { priceTickCovered, timeTickCovered, type CrosshairCovers } from './axis-covers';
import { labelHeight, placeAxisLabels } from './axis-labels';
import type { Frame, PaneFrame, PlotJob, PriceLabel } from './frame';
import type { SeriesPoints } from '../series/types';
import { shapeDirection, traceShape } from '../canvas/shapes';
import { withAlpha } from '../canvas/color';

const AXIS_LABEL_PADDING = 8;

function paintJob(
  ctx: CanvasRenderingContext2D,
  job: PlotJob,
  pane: PaneFrame,
  pixelRatio: number,
  barSpacing: number
): void {
  switch (job.kind) {
    case 'series':
      isolated(ctx, () => {
        job.definition.paint({
          ctx,
          pixelRatio,
          width: pane.plot.width,
          height: pane.plot.height,
          barSpacing,
          style: job.style,
          points: job.points,
          valueToY: job.valueToY,
          bars: job.bars,
          first: job.first,
          transform: job.transform
        });
      });
      return;
    case 'fill': {
      const fill = job.steps ? fillSteps : fillArea;

      // One path per color, so the two sides only meet where the lines cross.
      if (job.above === job.below) {
        fill(ctx, job.from, job.to, null, job.above, barSpacing);
      } else {
        fill(ctx, job.from, job.to, true, job.above, barSpacing);
        fill(ctx, job.from, job.to, false, job.below, barSpacing);
      }

      return;
    }
    case 'segments':
      paintSegments(ctx, job, pixelRatio, barSpacing);
      return;
    case 'boxes':
      ctx.beginPath();

      for (const box of job.boxes) {
        ctx.rect(
          snap(box.x, 1, pixelRatio),
          snap(box.y, 1, pixelRatio),
          Math.round(box.width * pixelRatio) / pixelRatio,
          Math.round(box.height * pixelRatio) / pixelRatio
        );
      }

      ctx.fillStyle = withAlpha(job.color, 0.1);
      ctx.fill();
      applyStroke(ctx, withAlpha(job.color, 0.6), 1, 'solid');
      ctx.stroke();
      return;
    case 'reference': {
      const y = snap(job.y, 1, pixelRatio);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(pane.plot.width, y);
      applyStroke(ctx, job.color, 1, 'dashed');
      ctx.stroke();
      return;
    }
    case 'columns':
      paintColumns(ctx, job, pixelRatio, barSpacing);
      return;
    case 'markers':
      paintMarkers(ctx, job);
      return;
  }
}

/**
 * Fills the area between two lines where both are defined; `above` keeps only the stretches where
 * `from` is drawn above `to` (`true`) or below it (`false`), cut where the lines cross.
 */
function fillArea(
  ctx: CanvasRenderingContext2D,
  from: SeriesPoints,
  to: SeriesPoints,
  above: boolean | null,
  color: string
): void {
  const isAbove = (index: number) => from.value(index) <= to.value(index);
  let start = -1;
  let entryX = Number.NaN;
  let entryY = Number.NaN;

  /** Adds the stretch from `start` to `end`, between the crossings it starts and ends at, if any. */
  const stretch = (end: number, exitX: number, exitY: number) => {
    if (above !== null && isAbove(end) !== above) {
      return;
    }

    if (Number.isNaN(entryX)) {
      ctx.moveTo(from.x(start), from.value(start));
    } else {
      ctx.moveTo(entryX, entryY);
    }

    for (let index = start; index <= end; index += 1) {
      ctx.lineTo(from.x(index), from.value(index));
    }

    if (!Number.isNaN(exitX)) {
      ctx.lineTo(exitX, exitY);
    }

    for (let index = end; index >= start; index -= 1) {
      ctx.lineTo(to.x(index), to.value(index));
    }

    ctx.closePath();
  };

  ctx.beginPath();

  for (let index = 0; index < from.count; index += 1) {
    if (Number.isNaN(from.value(index)) || Number.isNaN(to.value(index))) {
      if (start >= 0) {
        stretch(index - 1, Number.NaN, Number.NaN);
      }

      start = -1;
    } else if (start < 0) {
      start = index;
      entryX = Number.NaN;
      entryY = Number.NaN;
    } else if (isAbove(index) !== isAbove(index - 1)) {
      // Both lines are straight between two points, so they cross where their gap reaches zero.
      const gap = from.value(index - 1) - to.value(index - 1);
      const ratio = gap / (gap - (from.value(index) - to.value(index)));
      const x = from.x(index - 1) + ratio * (from.x(index) - from.x(index - 1));
      const y = from.value(index - 1) + ratio * (from.value(index) - from.value(index - 1));
      stretch(index - 1, x, y);
      start = index;
      entryX = x;
      entryY = y;
    }
  }

  if (start >= 0) {
    stretch(from.count - 1, Number.NaN, Number.NaN);
  }

  ctx.fillStyle = color;
  ctx.fill();
}

/** Fills each bar's slot between the two values; `above` as for {@link fillArea}. */
function fillSteps(
  ctx: CanvasRenderingContext2D,
  from: SeriesPoints,
  to: SeriesPoints,
  above: boolean | null,
  color: string,
  barSpacing: number
): void {
  ctx.beginPath();

  for (let index = 0; index < from.count; index += 1) {
    const top = from.value(index);
    const bottom = to.value(index);

    if (Number.isNaN(top) || Number.isNaN(bottom) || (above !== null && top <= bottom !== above)) {
      continue;
    }

    ctx.rect(
      from.x(index) - barSpacing / 2,
      Math.min(top, bottom),
      barSpacing,
      Math.abs(bottom - top)
    );
  }

  ctx.fillStyle = color;
  ctx.fill();
}

/** A horizontal line through each run of equal values, edge to edge of the run's bars. */
function paintSegments(
  ctx: CanvasRenderingContext2D,
  job: Extract<PlotJob, { kind: 'segments' }>,
  pixelRatio: number,
  barSpacing: number
): void {
  const { points } = job;
  ctx.beginPath();

  for (let index = 0; index < points.count; index += 1) {
    const y = points.value(index);

    if (Number.isNaN(y) || y === points.value(index - 1)) {
      continue;
    }

    let end = index;

    while (end + 1 < points.count && points.value(end + 1) === y) {
      end += 1;
    }

    const snapped = snap(y, job.lineWidth, pixelRatio);
    ctx.moveTo(points.x(index) - barSpacing / 2, snapped);
    ctx.lineTo(points.x(end) + barSpacing / 2, snapped);
  }

  applyStroke(ctx, job.color, job.lineWidth, job.lineStyle);
  ctx.stroke();
}

function paintColumns(
  ctx: CanvasRenderingContext2D,
  job: Extract<PlotJob, { kind: 'columns' }>,
  pixelRatio: number,
  barSpacing: number
): void {
  const { points, from } = job;
  const width = Math.max(
    1 / pixelRatio,
    Math.round(barSpacing * job.width * pixelRatio) / pixelRatio
  );
  const hairline = 1 / pixelRatio;
  ctx.fillStyle = job.color;
  ctx.beginPath();

  for (let index = 0; index < points.count; index += 1) {
    const end = points.value(index);
    const start = from.value(index);

    if (Number.isNaN(end) || Number.isNaN(start)) {
      continue;
    }

    const left = Math.round((points.x(index) - width / 2) * pixelRatio) / pixelRatio;
    const top = Math.min(start, end);
    const height = Math.max(hairline, Math.abs(end - start));

    if (job.hollow) {
      // The outline sits inside the column, on device pixels.
      ctx.rect(left + hairline / 2, top + hairline / 2, width - hairline, height - hairline);
    } else {
      // One fillRect per column: rasterizing a single path of thousands of rectangles is slower.
      ctx.fillRect(left, top, width, height);
    }
  }

  if (job.hollow) {
    applyStroke(ctx, job.color, hairline, 'solid');
    ctx.stroke();
  }
}

/**
 * Upward shapes point up at the value from below it and downward shapes down at it from above,
 * like an arrow under a low; other shapes sit on it. Texts go beyond the shape, or on the value.
 */
function paintMarkers(
  ctx: CanvasRenderingContext2D,
  job: Extract<PlotJob, { kind: 'markers' }>
): void {
  const { points, shape, text, size } = job;
  const direction = shape ? shapeDirection(shape) : 0;
  // From the value to the center of the shape, which is `size` from its tip.
  const shift = direction * size;
  ctx.fillStyle = job.color;

  if (shape) {
    ctx.beginPath();

    for (let index = 0; index < points.count; index += 1) {
      const y = points.value(index);

      if (!Number.isNaN(y)) {
        const x = points.x(index);
        // A shape of its own: a circle would otherwise join the previous one.
        ctx.moveTo(x + size, y + shift);
        traceShape(ctx, shape, x, y + shift, size);
      }
    }

    ctx.fill();
  }

  if (text.length === 0) {
    return;
  }

  ctx.font = job.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = !shape ? 'middle' : direction > 0 ? 'top' : 'bottom';
  const offset = !shape ? 0 : direction > 0 ? shift + size + 2 : shift - size - 2;

  for (let index = 0; index < points.count; index += 1) {
    const y = points.value(index);
    const label = typeof text === 'string' ? text : (text[index] ?? '');

    if (!Number.isNaN(y) && label !== '') {
      ctx.fillText(label, points.x(index), y + offset);
    }
  }
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number
): void {
  const { grid, theme } = options;

  if (!grid.vertical && !grid.horizontal) {
    return;
  }

  ctx.beginPath();

  for (const pane of frame.panes) {
    const { plot } = pane;

    if (grid.vertical) {
      for (const tick of frame.timeTicks) {
        const x = snap(tick.x, 1, pixelRatio);
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
      }
    }

    if (grid.horizontal) {
      for (const tick of pane.ticks) {
        const y = snap(plot.y + tick.y, 1, pixelRatio);
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
      }
    }
  }

  applyStroke(ctx, theme.grid, 1, grid.style);
  ctx.stroke();
}

function paintPriceAxes(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  crosshair: CrosshairCovers
): void {
  if (!options.priceScale.visible) {
    return;
  }

  const { theme } = options;
  ctx.font = font(options.font.size, options.font.family);
  ctx.fillStyle = theme.textMuted;
  ctx.textBaseline = 'middle';
  const half = options.font.size / 2;
  // The labels of the latest values and of the crosshair cover the ticks they would overlap,
  // which are left out.
  const latest = placeAxisLabels(frame, options, (frame.latest?.countdown ?? null) !== null);
  const covers = [
    ...latest.map((label) => {
      const top = label.y - (options.font.size + 8) / 2;
      return { axis: label.axis, top, bottom: top + labelHeight(options, label.lines) };
    }),
    ...crosshair.price
  ];
  const labels = (axis: Rect, ticks: readonly PriceLabel[], x: number) => {
    for (const tick of ticks) {
      const inside = tick.y >= half && tick.y <= axis.height - half;

      if (inside && !priceTickCovered(covers, axis, tick.y, half)) {
        ctx.fillText(tick.text, x, axis.y + tick.y);
      }
    }
  };

  for (const pane of frame.panes) {
    ctx.textAlign = 'left';
    labels(pane.axis, pane.ticks, pane.axis.x + AXIS_LABEL_PADDING);

    if (pane.left) {
      ctx.textAlign = 'right';
      labels(pane.left.axis, pane.left.ticks, -AXIS_LABEL_PADDING);
    }
  }

  const borders =
    frame.layout.leftAxisWidth > 0 ? [frame.layout.plotWidth, 0] : [frame.layout.plotWidth];
  ctx.beginPath();

  for (const border of borders) {
    const x = snap(border, 1, pixelRatio);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, frame.layout.height);
  }

  applyStroke(ctx, theme.border, 1);
  ctx.stroke();
}

function paintTimeAxis(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  crosshair: CrosshairCovers
): void {
  const axis = frame.layout.timeAxis;

  if (!axis) {
    return;
  }

  const { theme } = options;
  const y = snap(axis.y, 1, pixelRatio);
  ctx.beginPath();
  ctx.moveTo(axis.x, y);
  ctx.lineTo(axis.x + axis.width, y);
  applyStroke(ctx, theme.border, 1);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, axis.y, frame.layout.plotWidth, axis.height);
  ctx.clip();
  ctx.font = font(options.font.size, options.font.family);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const tick of frame.timeTicks) {
    if (timeTickCovered(crosshair, tick)) {
      continue;
    }

    const strong = tick.unit === 'year' || tick.unit === 'month' || tick.unit === 'day';
    ctx.fillStyle = strong ? theme.text : theme.textMuted;
    ctx.fillText(tick.text, tick.x, axis.y + axis.height / 2);
  }

  ctx.restore();
}

/** The line along each separator between panes; `hovered` names the pane above the one hovered. */
function paintSeparators(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  hovered: string | null
): void {
  const { separatorWidth: width, separatorColor, separatorHoverColor } = options.panes;

  if (width <= 0) {
    return;
  }

  const left = -frame.layout.leftAxisWidth;

  for (const separator of frame.layout.separators) {
    const y = snap(separator.y + separator.height / 2, width, pixelRatio);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + frame.layout.width, y);
    applyStroke(
      ctx,
      separator.above === hovered
        ? (separatorHoverColor ?? options.theme.crosshair)
        : (separatorColor ?? options.theme.border),
      width
    );
    ctx.stroke();
  }
}

function paintLatestPriceLine(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number
): void {
  const latest = frame.latest;

  if (!latest || !options.latestPrice.line || !Number.isFinite(latest.y)) {
    return;
  }

  const { plot } = frame.main;

  if (latest.y < 0 || latest.y > plot.height) {
    return;
  }

  const y = snap(plot.y + latest.y, 1, pixelRatio);
  ctx.beginPath();
  ctx.moveTo(plot.x, y);
  ctx.lineTo(plot.x + plot.width, y);
  applyStroke(ctx, latest.color, 1, options.latestPrice.style);
  ctx.stroke();
}

/** Paints extra content of a pane, under or over its series; `ctx` is translated to the plot. */
export type PaneLayerPainter = (
  ctx: CanvasRenderingContext2D,
  pane: PaneFrame,
  layer: 'below' | 'above'
) => void;

/** Paints background, grid, series, indicators and axes. */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  barSpacing: number,
  paintLayer: PaneLayerPainter,
  /** The pane above the separator under the pointer or being dragged. */
  hoveredSeparator: string | null,
  /** Where the crosshair's labels cover the axes. */
  crosshair: CrosshairCovers
): void {
  ctx.fillStyle = options.theme.background;
  ctx.fillRect(-frame.layout.leftAxisWidth, 0, frame.layout.width, frame.layout.height);
  paintGrid(ctx, frame, options, pixelRatio);

  for (const pane of frame.panes) {
    const { plot } = pane;
    isolated(ctx, () => {
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.width, plot.height);
      ctx.clip();
      ctx.translate(plot.x, plot.y);
      paintLayer(ctx, pane, 'below');

      for (const job of pane.jobs) {
        paintJob(ctx, job, pane, pixelRatio, barSpacing);
      }

      paintLayer(ctx, pane, 'above');
    });
  }

  paintLatestPriceLine(ctx, frame, options, pixelRatio);
  paintSeparators(ctx, frame, options, pixelRatio, hoveredSeparator);
  paintPriceAxes(ctx, frame, options, pixelRatio, crosshair);
  paintTimeAxis(ctx, frame, options, pixelRatio, crosshair);
}

/**
 * Paints the axes of the scene again, over it, as the ticks the crosshair's labels cover change:
 * the plots stay as they are. Takes what `paintScene` does.
 */
export function repaintAxes(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  hoveredSeparator: string | null,
  crosshair: CrosshairCovers
): void {
  const { timeAxis } = frame.layout;
  const axes = frame.panes.flatMap((pane) =>
    pane.left ? [pane.axis, pane.left.axis] : [pane.axis]
  );
  isolated(ctx, () => {
    ctx.beginPath();

    for (const axis of timeAxis ? [...axes, timeAxis] : axes) {
      ctx.rect(axis.x, axis.y, axis.width, axis.height);
    }

    ctx.clip();
    ctx.fillStyle = options.theme.background;
    ctx.fillRect(-frame.layout.leftAxisWidth, 0, frame.layout.width, frame.layout.height);
    // The separators cross the price axes.
    paintSeparators(ctx, frame, options, pixelRatio, hoveredSeparator);
    paintPriceAxes(ctx, frame, options, pixelRatio, crosshair);
    paintTimeAxis(ctx, frame, options, pixelRatio, crosshair);
  });
}

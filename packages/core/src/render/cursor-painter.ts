import type { ChartOptions, LegendButton, LegendItem } from '../options/types';
import { applyStroke, drawLabel, font, snap } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import type { IconCache } from '../canvas/icon-cache';
import type { Rect } from '../layout/layout';
import { LABEL_PADDING_X, timeLabelCenter } from './axis-covers';
import { placeAxisLabels } from './axis-labels';
import type { Frame } from './frame';

export interface CrosshairView {
  /** Absolute x of the vertical line. */
  readonly x: number;
  /** Absolute y of the horizontal line, or `null` outside the plots. */
  readonly y: number | null;
  readonly timeText: string | null;
  readonly priceText: string | null;
  /** The value on the left axis of the pane, when it has one. */
  readonly leftPriceText: string | null;
}

export interface LegendSegment {
  readonly text: string;
  readonly color: string;
}

export interface LegendRow {
  readonly item: LegendItem;
  /** The title first, then the values. */
  readonly segments: readonly LegendSegment[];
  /** Buttons after the title: the row is under the pointer. */
  readonly buttons: readonly LegendButton[];
  /** The id of the button under the pointer. */
  readonly hoveredButton: string | null;
}

/** Where the legend rows and their buttons were painted, in plot coordinates. */
export interface LegendLayout {
  readonly rows: ReadonlyArray<{ readonly item: LegendItem; readonly rect: Rect }>;
  readonly buttons: ReadonlyArray<{
    readonly item: LegendItem;
    readonly id: string;
    readonly rect: Rect;
  }>;
}

export interface CursorView {
  readonly crosshair: CrosshairView | null;
  readonly legends: readonly LegendRow[];
  readonly countdown: string | null;
}

const LEGEND_GAP = 8;
/** Hidden indicators and series listed in the legend show this faint. */
const HIDDEN_ALPHA = 0.45;
const EMPTY_LAYOUT: LegendLayout = { rows: [], buttons: [] };

/**
 * Paints a value's label on an axis at `y` within it, with lines under the first such as the
 * countdown, in white or in `ink`; nothing beyond the axis.
 */
function paintAxisLabel(
  ctx: CanvasRenderingContext2D,
  options: ChartOptions,
  axis: Rect,
  y: number,
  color: string,
  lines: readonly string[],
  ink = '#ffffff'
): void {
  if (!(y >= 0 && y <= axis.height) || axis.width === 0) {
    return;
  }

  const height = options.font.size + 8;
  const top = axis.y + y - height / 2;
  ctx.font = font(options.font.size, options.font.family);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(axis.x + 1, top, axis.width - 2, (height - 6) * lines.length + 6, 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((text, line) => {
    ctx.fillText(text, axis.x + LABEL_PADDING_X + 2, top + height / 2 + 0.5 + (height - 6) * line);
  });
}

/**
 * The latest values of series that label them and the real-time price, apart from each other,
 * and the latest price.
 */
function paintLatestLabels(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  countdown: string | null
): void {
  const { latest } = frame;

  for (const label of placeAxisLabels(frame, options, countdown !== null)) {
    if (label.mark) {
      // The real-time price's label is light: its text takes the theme's.
      const ink = label.mark === latest?.live ? options.theme.text : undefined;
      paintAxisLabel(ctx, options, label.axis, label.y, label.mark.color, [label.mark.text], ink);
    } else if (latest) {
      const lines = countdown === null ? [latest.text] : [latest.text, countdown];
      paintAxisLabel(ctx, options, label.axis, label.y, latest.color, lines);
    }
  }
}

function paintCrosshair(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  crosshair: CrosshairView
): void {
  const { theme } = options;
  const config = options.crosshair;
  const plotBottom = frame.layout.timeAxis?.y ?? frame.layout.height;
  ctx.beginPath();

  if (config.vertical) {
    const x = snap(crosshair.x, 1, pixelRatio);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotBottom);
  }

  if (config.horizontal && crosshair.y !== null) {
    const y = snap(crosshair.y, 1, pixelRatio);
    ctx.moveTo(0, y);
    ctx.lineTo(frame.layout.plotWidth, y);
  }

  applyStroke(ctx, theme.crosshair, 1, config.style);
  ctx.stroke();

  if (!config.labels) {
    return;
  }

  ctx.font = font(options.font.size, options.font.family);
  const height = options.font.size + 8;
  const label = {
    background: theme.crosshairLabelBackground,
    color: theme.crosshairLabelText,
    paddingX: LABEL_PADDING_X,
    height
  };

  if (crosshair.priceText !== null && crosshair.y !== null && options.priceScale.visible) {
    drawLabel(ctx, crosshair.priceText, frame.layout.plotWidth + 1, crosshair.y, {
      ...label,
      align: 'left'
    });
  }

  if (crosshair.leftPriceText !== null && crosshair.y !== null && options.priceScale.visible) {
    drawLabel(ctx, crosshair.leftPriceText, -1, crosshair.y, { ...label, align: 'right' });
  }

  const axis = frame.layout.timeAxis;

  if (crosshair.timeText !== null && axis) {
    const width = ctx.measureText(crosshair.timeText).width + LABEL_PADDING_X * 2;
    const center = timeLabelCenter(frame, crosshair.x, width);
    drawLabel(ctx, crosshair.timeText, center, axis.y + axis.height / 2, {
      ...label,
      align: 'center'
    });
  }
}

/** Paints a legend button: its icon, on a faint square while the pointer is on it. */
function paintLegendButton(
  ctx: CanvasRenderingContext2D,
  options: ChartOptions,
  icons: IconCache,
  button: LegendButton,
  rect: Rect,
  hovered: boolean
): void {
  const { theme } = options;

  if (hovered) {
    ctx.fillStyle = withAlpha(theme.text, 0.12);
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 2);
    ctx.fill();
  }

  const size = rect.height - 4;
  ctx.save();
  ctx.translate(rect.x + 2, rect.y + 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = hovered ? theme.text : theme.textMuted;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.stroke(icons.get(button.icon));
  ctx.restore();
}

/**
 * Paints the legend rows of each pane at its top left, a row wrapping onto the next line rather
 * than running under the price axis, and returns where the rows and their buttons went.
 */
function paintLegends(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  legends: readonly LegendRow[],
  icons: IconCache
): LegendLayout {
  ctx.font = font(options.font.size, options.font.family);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lineHeight = options.font.size + 6;
  // An icon a pixel larger than the text, with two pixels around it.
  const buttonSize = options.font.size + 5;
  /** Lines each pane's legends take so far. */
  const linesByPane = new Map<string, number>();
  const rows: Array<LegendLayout['rows'][number]> = [];
  const buttons: Array<LegendLayout['buttons'][number]> = [];

  for (const row of legends) {
    const { item } = row;
    const pane = frame.panes.find((candidate) => candidate.id === item.paneId);

    if (!pane) {
      continue;
    }

    const start = pane.plot.x + 8;
    const end = pane.plot.x + pane.plot.width - 8;
    const bottom = pane.plot.y + pane.plot.height;
    const first = linesByPane.get(item.paneId) ?? 0;
    let line = first;
    let x = start;
    let y = pane.plot.y + 6 + line * lineHeight;
    let right = start;
    /** Room a piece of the row takes: on this line, or the next. */
    const place = (width: number): boolean => {
      // A row longer than the plot goes on below, rather than under the price axis.
      if (x > start && x + width > end) {
        line += 1;
        x = start;
        y += lineHeight;
      }

      return y + lineHeight <= bottom;
    };

    const paintButtons = () => {
      ctx.globalAlpha = 1;

      for (const button of row.buttons) {
        if (!place(buttonSize)) {
          break;
        }

        const rect = { x, y: y - 2, width: buttonSize, height: buttonSize };
        paintLegendButton(ctx, options, icons, button, rect, row.hoveredButton === button.id);
        buttons.push({ item, id: button.id, rect });
        x += buttonSize + 2;
        right = Math.max(right, x);
      }

      x += LEGEND_GAP - 2;
    };
    // The buttons go after the title, so that the values changing beside them do not move them;
    // the main series' row has no title, and starts with them.
    const buttonsAt = row.buttons.length === 0 ? -1 : item.kind === 'main' ? 0 : 1;
    // Hidden values keep their room, so that the row stays as wide under the pointer.
    const hideFrom = buttonsAt >= 0 && options.legend.hideValuesOnHover ? buttonsAt : Infinity;

    for (const [index, segment] of row.segments.entries()) {
      if (index === buttonsAt) {
        paintButtons();
      }

      const width = ctx.measureText(segment.text).width;

      if (!place(width)) {
        break;
      }

      if (index < hideFrom) {
        ctx.globalAlpha = item.visible ? 1 : HIDDEN_ALPHA;
        ctx.fillStyle = segment.color;
        ctx.fillText(segment.text, x, y);
      }

      x += width + LEGEND_GAP;
      right = Math.max(right, x - LEGEND_GAP);
    }

    // A title alone: its buttons follow it.
    if (buttonsAt >= row.segments.length) {
      paintButtons();
    }

    ctx.globalAlpha = 1;
    const top = pane.plot.y + 6 + first * lineHeight - 2;
    rows.push({
      item,
      rect: { x: start, y: top, width: right - start, height: (line - first + 1) * lineHeight }
    });
    linesByPane.set(item.paneId, line + 1);
  }

  return { rows, buttons };
}

/** Paints legends, the latest-price label and the crosshair; returns where the legends went. */
export function paintCursor(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: ChartOptions,
  pixelRatio: number,
  view: CursorView,
  icons: IconCache
): LegendLayout {
  const legends = options.legend.visible
    ? paintLegends(ctx, frame, options, view.legends, icons)
    : EMPTY_LAYOUT;

  paintLatestLabels(ctx, frame, options, view.countdown);

  if (view.crosshair) {
    paintCrosshair(ctx, frame, options, pixelRatio, view.crosshair);
  }

  return legends;
}

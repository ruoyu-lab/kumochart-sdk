import type { Point } from '../interaction/types';
import type { Rect } from '../layout/layout';
import type { LineStyle } from '../options/types';
import { applyStroke, font, snap } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import { fail } from '../utils/errors';
import type { IconCache } from '../canvas/icon-cache';
import { checkArray, checkFields, checkNumber, checkString, fieldsOf } from '../utils/validate';
import type { ValueFormat } from '../format/value-format';
import type { PaneFrame } from '../render/frame';
import { HitPriority, type ObjectContext } from './types';

export type DragPhase = 'start' | 'move' | 'end' | 'cancel';

export interface PriceDragEvent {
  readonly id: string;
  readonly phase: DragPhase;
  /** Price at this phase (the restored price for `cancel`). */
  readonly price: number;
  /** Price before the drag started. */
  readonly initialPrice: number;
}

export interface PriceLineHost {
  context(): ObjectContext;
  repaint(): void;
  formatValue(pane: PaneFrame, value: number): string;
  dragged(event: PriceDragEvent): void;
}

/**
 * The value a line dragged to `y` on a scale takes, rounded as the pane writes its values: to their
 * decimals, or, for compact numbers, to the power of ten at or below what a pixel is worth there,
 * so that every pixel the line moves still changes its value.
 */
export function draggedValue(
  scale: { yToValue(y: number): number },
  format: ValueFormat,
  y: number
): number {
  const value = scale.yToValue(y);

  if (format.kind === 'decimal') {
    const factor = 10 ** format.precision;
    return Math.round(value * factor) / factor;
  }

  const pixel = Math.abs(scale.yToValue(y + 1) - value);

  if (!Number.isFinite(pixel) || pixel === 0) {
    return value;
  }

  const exponent = Math.floor(Math.log10(pixel));

  // A factor rather than a step below 1, which a double cannot hold exactly.
  if (exponent < 0) {
    const factor = 10 ** -exponent;
    return Math.round(value * factor) / factor;
  }

  const step = 10 ** exponent;
  return Math.round(value / step) * step;
}

/** A button inside an order or alert label. Clicking it emits `buttonClick`. */
export interface PriceLineButton {
  id: string;
  /** Short text such as `✕` or `TP`. */
  text?: string;
  /** SVG path data drawn in a 24 × 24 box, e.g. from an icon set. */
  icon?: string;
  /** Width in CSS pixels; defaults to fit the content. */
  width?: number;
}

const BUTTON_FIELDS = fieldsOf<PriceLineButton>({ id: true, text: true, icon: true, width: true });
const SVG_PATH = /^\s*[Mm][\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/;

export function validateButtons(
  buttons: readonly PriceLineButton[] | undefined,
  label: string
): PriceLineButton[] {
  if (buttons === undefined) {
    return [];
  }

  checkArray(label, buttons);

  const ids = new Set<string>();

  return buttons.map((button, index) => {
    const path = `${label}[${index}]`;
    checkFields(path, button, BUTTON_FIELDS);
    checkString(`${path}.id`, button.id);

    if (ids.has(button.id)) {
      fail(`${label} contains the button id "${button.id}" twice.`);
    }

    ids.add(button.id);

    if (button.text === undefined && button.icon === undefined) {
      fail(`${path} needs a text or an icon.`);
    }

    if (button.text !== undefined && typeof button.text !== 'string') {
      fail(`${path}.text must be a string.`);
    }

    if (
      button.icon !== undefined &&
      (typeof button.icon !== 'string' || !SVG_PATH.test(button.icon))
    ) {
      fail(`${path}.icon must be SVG path data starting with a move command, e.g. "M6 6L18 18".`);
    }

    if (button.width !== undefined) {
      checkNumber(`${path}.width`, button.width, { min: 8, max: 200 });
    }

    return { ...button };
  });
}

export interface PriceLineView {
  readonly id: string;
  /** Plot-relative y of the line. */
  readonly y: number;
  readonly color: string;
  readonly text: string;
  readonly axisText: string;
  readonly buttons: readonly PriceLineButton[];
  readonly lineStyle: LineStyle;
  readonly emphasized: boolean;
}

export interface PriceLineLayout {
  readonly view: PriceLineView;
  /** Center of the label, moved apart from overlapping labels. */
  readonly labelY: number;
  readonly label: Rect;
  readonly textWidth: number;
  readonly buttons: ReadonlyArray<{ readonly button: PriceLineButton; readonly rect: Rect }>;
}

const LABEL_PADDING = 6;
const LABEL_MARGIN = 8;
const LABEL_GAP = 2;

/**
 * Where the labels go: at their lines, each moved down past the one above it, and those that
 * would then leave the plot at the bottom moved up, each above the one below it. Labels of lines
 * below the plot stay with their lines.
 */
function labelCenters(
  sorted: readonly PriceLineView[],
  plotHeight: number,
  height: number
): number[] {
  const half = height / 2;
  const labels = sorted.map((view) => ({ view, center: view.y }));
  let bottom = Number.NEGATIVE_INFINITY;

  for (const label of labels) {
    label.center = Math.max(label.view.y, bottom + LABEL_GAP + half);
    bottom = label.center + half;
  }

  let top = plotHeight + LABEL_GAP;

  for (const label of [...labels].reverse()) {
    if (label.view.y <= plotHeight) {
      label.center = Math.min(label.center, top - LABEL_GAP - half);
      top = label.center - half;
    }
  }

  return labels.map((label) => label.center);
}

/** Lays out the labels of price lines at the right of the plot, keeping them from overlapping. */
export function layoutPriceLines(
  views: readonly PriceLineView[],
  plotWidth: number,
  plotHeight: number,
  fontSize: number,
  measure: (text: string, size: number) => number
): PriceLineLayout[] {
  const height = fontSize + 8;
  const sorted = [...views]
    .filter((view) => Number.isFinite(view.y))
    .sort((left, right) => left.y - right.y);
  const centers = labelCenters(sorted, plotHeight, height);

  return sorted.map((view, index) => {
    const textWidth = view.text ? measure(view.text, fontSize) + LABEL_PADDING * 2 : 0;
    const buttonWidths = view.buttons.map(
      (button) =>
        button.width ??
        (button.icon ? height : measure(button.text ?? '', fontSize) + LABEL_PADDING * 2)
    );
    const width = textWidth + buttonWidths.reduce((sum, value) => sum + value, 0);
    const labelY = centers[index] ?? view.y;
    const left = plotWidth - LABEL_MARGIN - width;
    const top = labelY - height / 2;
    let x = left + textWidth;
    const buttons = view.buttons.map((button, index) => {
      const buttonWidth = buttonWidths[index] ?? height;
      const rect = { x, y: top, width: buttonWidth, height };
      x += buttonWidth;
      return { button, rect };
    });

    return { view, labelY, label: { x: left, y: top, width, height }, textWidth, buttons };
  });
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export interface PriceLineHit {
  readonly id: string;
  readonly part: string;
  readonly priority: number;
  readonly distance: number;
}

/** Hit-tests buttons, then labels, then lines. `point` is plot-relative. */
export function hitPriceLines(
  layouts: readonly PriceLineLayout[],
  point: Point,
  tolerance: number
): PriceLineHit | null {
  for (const layout of layouts) {
    for (const { button, rect } of layout.buttons) {
      if (contains(rect, point)) {
        return {
          id: layout.view.id,
          part: `button:${button.id}`,
          priority: HitPriority.button,
          distance: 0
        };
      }
    }
  }

  for (const layout of layouts) {
    if (contains(layout.label, point)) {
      return { id: layout.view.id, part: 'label', priority: HitPriority.label, distance: 0 };
    }
  }

  let best: PriceLineHit | null = null;

  for (const layout of layouts) {
    const distance = Math.abs(point.y - layout.view.y);

    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: layout.view.id, part: 'line', priority: HitPriority.line, distance };
    }
  }

  return best;
}

/** Paints price lines in a pane: the line, its label with buttons, and its price-axis label. */
export function paintPriceLines(
  ctx: CanvasRenderingContext2D,
  layouts: readonly PriceLineLayout[],
  plot: Rect,
  axis: Rect,
  options: {
    fontSize: number;
    fontFamily: string;
    pixelRatio: number;
    textColor: string;
    showAxis: boolean;
  },
  icons: IconCache
): void {
  ctx.font = font(options.fontSize, options.fontFamily);
  ctx.textBaseline = 'middle';

  for (const layout of layouts) {
    const { view, label } = layout;
    const y = snap(plot.y + view.y, 1, options.pixelRatio);
    const lineWidth = view.emphasized ? 2 : 1;

    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    applyStroke(ctx, view.color, lineWidth, view.lineStyle);
    ctx.stroke();

    const top = plot.y + label.y;
    const left = plot.x + label.x;

    if (layout.labelY !== view.y) {
      ctx.beginPath();
      ctx.moveTo(left + label.width / 2, y);
      ctx.lineTo(left + label.width / 2, top);
      applyStroke(ctx, view.color, 1);
      ctx.stroke();
    }

    ctx.fillStyle = view.color;
    ctx.beginPath();
    ctx.roundRect(left, top, label.width, label.height, 3);
    ctx.fill();

    if (view.text) {
      ctx.fillStyle = options.textColor;
      ctx.textAlign = 'center';
      ctx.fillText(view.text, left + layout.textWidth / 2, top + label.height / 2 + 0.5);
    }

    for (const { button, rect } of layout.buttons) {
      const x = plot.x + rect.x;
      ctx.fillStyle = withAlpha('#000000', 0.18);
      ctx.fillRect(x, top, rect.width, rect.height);
      ctx.fillStyle = withAlpha(options.textColor, 0.35);
      ctx.fillRect(x, top + 3, 1, rect.height - 6);

      if (button.icon) {
        const size = rect.height - 8;
        ctx.save();
        ctx.translate(x + (rect.width - size) / 2, top + 4);
        ctx.scale(size / 24, size / 24);
        ctx.strokeStyle = options.textColor;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.stroke(icons.get(button.icon));
        ctx.restore();
      } else if (button.text) {
        ctx.fillStyle = options.textColor;
        ctx.textAlign = 'center';
        ctx.fillText(button.text, x + rect.width / 2, top + rect.height / 2 + 0.5);
      }
    }

    if (options.showAxis && view.y >= 0 && view.y <= plot.height) {
      const height = options.fontSize + 8;
      ctx.fillStyle = view.color;
      ctx.beginPath();
      ctx.roundRect(axis.x + 1, plot.y + view.y - height / 2, axis.width - 2, height, 2);
      ctx.fill();
      ctx.fillStyle = options.textColor;
      ctx.textAlign = 'left';
      ctx.fillText(view.axisText, axis.x + 8, plot.y + view.y + 0.5);
    }
  }
}

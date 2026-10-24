import { applyStroke, isolated } from '../canvas/canvas';
import { timeToX, type ObjectContext, type ObjectPaintContext } from '../objects/types';
import type { PaneFrame } from '../render/frame';
import { anchorPosition } from './anchoring';
import { anchorMarks, axisMarksOf, paintAxisMarks } from './axis-marks';
import type { DrawingEntry } from './drawing-store';
import { handleOf, handlesOf, paintHandles } from './handles';
import { resolveStyle, textFont } from './style';
import { shownAt } from './timeframes';
import { completed, placedCount, type DrawingTool } from './tool';
import { boundsOf } from './geometry';
import type {
  DrawingBounds,
  DrawingGeometry,
  DrawingPoint,
  DrawingStyle,
  DrawingTypeDefinition
} from './types';
import { drawingOptions, drawingTexts } from './options';

/** How far past its bounds a drawing may paint, in CSS pixels. */
const PAINT_REACH = 16;

/** What painting a drawing takes: its type, style and text. */
export type Shape = Pick<DrawingEntry, 'definition' | 'style' | 'text'>;

/** What painting needs of the chart. */
export interface PaintHost {
  formatValue(pane: PaneFrame, value: number): string;
}

/** How a drawing is marked as it is painted. */
export interface EntryState {
  readonly hovered: boolean;
  readonly selected: boolean;
  /** Its text is being edited in place. */
  readonly editing: boolean;
  readonly handles: boolean;
  readonly hoveredHandle: string | null;
  /** Also paints what it puts under the series, which the scene paints only of placed drawings. */
  readonly below: boolean;
}

export function styleOf(context: ObjectContext, entry: Shape): DrawingStyle {
  return resolveStyle(context.options, entry.definition, entry.style);
}

/**
 * The pane a drawing shows in: shown, with the drawings, on the displayed timeframe, and on a pane
 * there.
 */
export function paneShowing(
  context: ObjectContext,
  entry: Pick<DrawingEntry, 'visible' | 'timeframes' | 'pane'>
): PaneFrame | undefined {
  return drawingOptions(context.options).visible &&
    entry.visible &&
    shownAt(entry.timeframes, context.resolution)
    ? context.frame.panes.find((pane) => pane.id === entry.pane)
    : undefined;
}

export function geometryOf(
  context: ObjectContext,
  host: PaintHost,
  entry: Shape,
  points: readonly DrawingPoint[],
  pane: PaneFrame
): DrawingGeometry {
  const style = styleOf(context, entry);
  const textFontValue = textFont(style, context.options.font.family);
  return {
    points: points.map((point) => anchorPosition(context, pane, point)),
    anchors: points,
    width: pane.plot.width,
    height: pane.plot.height,
    style,
    text: entry.text,
    theme: context.options.theme,
    fontFamily: context.options.font.family,
    textFont: textFontValue,
    valueToY: (value) => pane.scale.valueToY(value),
    yToValue: (y) => pane.scale.yToValue(y),
    timeToX: (time) => timeToX(context, time),
    barIndex: (time) => context.bars.logicalIndexOf(time),
    bars: context.displayed,
    source: context.source,
    formatValue: (value) => host.formatValue(pane, value),
    measureText: (text) => context.measureText(text, textFontValue),
    texts: drawingTexts(context.options)
  };
}

/** The area a drawing covers, or `null` where it draws nothing: its type's bounds, or its handles'. */
export function drawingBounds(
  definition: DrawingTypeDefinition,
  geometry: DrawingGeometry
): DrawingBounds | null {
  return definition.bounds
    ? definition.bounds(geometry)
    : boundsOf(handlesOf(definition, geometry));
}

/**
 * Whether a drawing may reach into `area` of its plot: not where its type's bounds lie wholly
 * outside it, or are `null`. A type without bounds() may reach anywhere.
 */
export function reaches(
  definition: DrawingTypeDefinition,
  geometry: DrawingGeometry,
  area: DrawingBounds
): boolean {
  if (!definition.bounds) {
    return true;
  }

  const box = definition.bounds(geometry);
  return (
    box !== null &&
    box.x <= area.x + area.width &&
    box.x + box.width >= area.x &&
    box.y <= area.y + area.height &&
    box.y + box.height >= area.y
  );
}

/**
 * The plot of a drawing and what it paints past its bounds: half its widest lines, its
 * arrowheads and the markers of its handles.
 */
export function paintedArea(geometry: DrawingGeometry): DrawingBounds {
  return {
    x: -PAINT_REACH,
    y: -PAINT_REACH,
    width: geometry.width + PAINT_REACH * 2,
    height: geometry.height + PAINT_REACH * 2
  };
}

/** Paints a drawing in its pane's plot, with its handles when `state` asks. */
export function paintEntry(
  context: ObjectPaintContext,
  pane: PaneFrame,
  definition: DrawingTypeDefinition,
  geometry: DrawingGeometry,
  state: EntryState
): void {
  const { ctx, pixelRatio } = context;
  isolated(ctx, () => {
    ctx.beginPath();
    ctx.rect(pane.plot.x, pane.plot.y, pane.plot.width, pane.plot.height);
    ctx.clip();
    ctx.translate(pane.plot.x, pane.plot.y);
    const paintContext = {
      ctx,
      pixelRatio,
      geometry,
      hovered: state.hovered,
      selected: state.selected,
      editing: state.editing
    };

    if (state.below) {
      definition.paintBelow?.(paintContext);
    }

    definition.paint(paintContext);
  });

  if (state.handles && !state.editing) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.plot.x, pane.plot.y, pane.plot.width, pane.plot.height);
    ctx.clip();
    paintHandles(ctx, { x: pane.plot.x, y: pane.plot.y }, handlesOf(definition, geometry), {
      color: geometry.style.color,
      background: context.options.theme.background,
      radius: drawingOptions(context.options).handleRadius,
      hovered: state.hoveredHandle
    });
    ctx.restore();
  }
}

/** Paints what a drawing puts under the series, `ctx` translated to its pane's plot. */
export function paintEntryBelow(
  context: ObjectPaintContext,
  definition: DrawingTypeDefinition,
  geometry: DrawingGeometry
): void {
  const { ctx, pixelRatio } = context;
  isolated(ctx, () => {
    definition.paintBelow?.({
      ctx,
      pixelRatio,
      geometry,
      hovered: false,
      selected: false,
      editing: false
    });
  });
}

/**
 * Labels a drawing's anchors on the axes, with the range between them: as its type marks them,
 * or, while a tool places only some of them, those placed.
 */
export function paintMarks(
  context: ObjectPaintContext,
  host: PaintHost,
  pane: PaneFrame,
  entry: Shape,
  points: readonly DrawingPoint[],
  complete = true
): void {
  const style = styleOf(context, entry);
  paintAxisMarks(
    context,
    pane,
    complete ? axisMarksOf(entry.definition, points, style) : anchorMarks(points),
    style.color,
    (value) => host.formatValue(pane, value),
    false
  );
}

/**
 * The drawing a tool is placing, or the anchor it would place, with its axis marks. `style` is
 * the style the tool gives its drawings.
 */
export function paintPlacing(
  context: ObjectPaintContext,
  host: PaintHost,
  tool: DrawingTool,
  style: DrawingEntry['style']
): void {
  const pane = tool.pane(context);

  if (!pane) {
    return;
  }

  const preview = tool.preview(context);

  const placed = preview ? [...tool.points, preview] : tool.points;
  const definition = tool.definition;
  const shape: Shape = { definition, style, text: tool.options.text ?? '' };
  const needed = placedCount(definition) || 2;
  const points = placed.length >= needed ? completed(definition, placed) : placed;

  if (placed.length >= needed && !definition.editableText) {
    paintEntry(context, pane, definition, geometryOf(context, host, shape, points, pane), {
      hovered: false,
      selected: true,
      editing: false,
      handles: true,
      hoveredHandle: null,
      below: true
    });
  } else {
    const resolved = styleOf(context, shape);
    const positions = points.map((point, index) => ({
      id: String(index),
      ...anchorPosition(context, pane, point)
    }));

    // Until the last anchor, the anchors placed so far are joined, e.g. a channel's base line.
    if (positions.length > 1 && !definition.editableText) {
      const { ctx } = context;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.plot.x, pane.plot.y, pane.plot.width, pane.plot.height);
      ctx.clip();
      ctx.beginPath();
      positions.forEach(({ x, y }, index) => {
        if (index === 0) {
          ctx.moveTo(pane.plot.x + x, pane.plot.y + y);
        } else {
          ctx.lineTo(pane.plot.x + x, pane.plot.y + y);
        }
      });
      applyStroke(ctx, resolved.color, resolved.lineWidth, resolved.lineStyle);
      ctx.stroke();
      ctx.restore();
    }

    paintHandles(context.ctx, { x: pane.plot.x, y: pane.plot.y }, positions, {
      color: resolved.color,
      background: context.options.theme.background,
      radius: drawingOptions(context.options).handleRadius,
      hovered: null
    });
  }

  paintMarks(context, host, pane, shape, points, placed.length >= needed);
}

/** What the drawings are painted with: the drawing being placed and the text being edited. */
export interface DrawingsState {
  /** The tool placing a drawing, and the style it gives it. */
  readonly placing: { readonly tool: DrawingTool; readonly style: DrawingEntry['style'] } | null;
  /** The drawing whose text is edited in place, painted without it. */
  readonly editing: string | null;
}

/**
 * Paints the drawings in z-order, their handles where hovered or selected, their axis marks over
 * them, the selected drawing's last, and the drawing a tool is placing.
 */
export function paintDrawings(
  context: ObjectPaintContext,
  host: PaintHost,
  entries: readonly DrawingEntry[],
  state: DrawingsState
): void {
  // While a tool places a drawing, the selection steps back so only the new drawing is marked.
  const selectedId =
    context.selection?.kind === 'drawing' && !state.placing ? context.selection.id : null;
  const hovered = context.hovered?.kind === 'drawing' ? context.hovered : null;
  let selected: { entry: DrawingEntry; pane: PaneFrame } | null = null;

  for (const entry of entries) {
    const pane = paneShowing(context, entry);

    if (!pane) {
      continue;
    }

    const isSelected = entry.id === selectedId;
    const isHovered = hovered?.id === entry.id;
    const geometry = geometryOf(context, host, entry, entry.points, pane);

    if (isSelected) {
      selected = { entry, pane };
    }

    // Off the plot, it paints nothing there.
    if (!reaches(entry.definition, geometry, paintedArea(geometry))) {
      continue;
    }

    paintEntry(context, pane, entry.definition, geometry, {
      hovered: isHovered,
      selected: isSelected,
      editing: state.editing === entry.id,
      handles: isSelected || isHovered,
      hoveredHandle: isHovered ? handleOf(hovered.part) : null,
      below: false
    });
  }

  for (const entry of entries) {
    const pane = paneShowing(context, entry);
    const style = styleOf(context, entry);
    const marks = pane ? axisMarksOf(entry.definition, entry.points, style) : null;

    if (pane && marks?.always && entry.id !== selectedId) {
      paintAxisMarks(
        context,
        pane,
        marks,
        style.color,
        (value) => host.formatValue(pane, value),
        true
      );
    }
  }

  if (selected) {
    paintMarks(context, host, selected.pane, selected.entry, selected.entry.points);
  }

  if (state.placing) {
    paintPlacing(context, host, state.placing.tool, state.placing.style);
  }
}

/**
 * Paints what the drawings of `pane` put under its series, such as the zones of a position;
 * `ctx` is translated to the plot.
 */
export function paintDrawingsBelow(
  context: ObjectPaintContext,
  host: PaintHost,
  entries: readonly DrawingEntry[],
  pane: PaneFrame
): void {
  for (const entry of entries) {
    if (entry.definition.paintBelow && paneShowing(context, entry)?.id === pane.id) {
      const geometry = geometryOf(context, host, entry, entry.points, pane);

      if (reaches(entry.definition, geometry, paintedArea(geometry))) {
        paintEntryBelow(context, entry.definition, geometry);
      }
    }
  }
}

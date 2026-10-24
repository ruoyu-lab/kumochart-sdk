export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangles are relative to the left edge of the plots and the top of the chart: the plots start
 * at x 0, and a left price axis lies at negative x. `chart.layout()` reports them relative to the
 * chart's left edge.
 */
export interface PaneLayout {
  id: string;
  /** The drawing area. Its `x` is always 0. */
  plot: Rect;
  /** The price axis to the right of the plot. */
  axis: Rect;
  /** The price axis to the left of the plot, or `null` without one. */
  leftAxis: Rect | null;
}

export interface SeparatorLayout {
  above: string;
  below: string;
  y: number;
  height: number;
}

export interface Layout {
  width: number;
  height: number;
  plotWidth: number;
  axisWidth: number;
  /** Width of the left price axis; `0` without one. */
  leftAxisWidth: number;
  panes: PaneLayout[];
  separators: SeparatorLayout[];
  timeAxis: Rect | null;
}

export interface LayoutPaneInput {
  id: string;
  /** Requested height in pixels. Ignored for the stretching pane. */
  height: number;
  /** The main pane absorbs the space left by the other panes. */
  stretch: boolean;
}

export interface LayoutInput {
  width: number;
  height: number;
  axisWidth: number;
  leftAxisWidth: number;
  timeAxisHeight: number;
  separatorHeight: number;
  minPaneHeight: number;
  panes: readonly LayoutPaneInput[];
}

/**
 * Heights of the fixed panes within `budget`: as requested while they fit, else shrunk in
 * proportion, those that would fall below `floor` staying on it and the others sharing the rest.
 */
function fitFixedPanes(panes: readonly LayoutPaneInput[], budget: number, floor: number): number[] {
  const onFloor = panes.map(() => false);
  const shrinking = (pane: LayoutPaneInput, index: number) => !pane.stretch && !onFloor[index];

  for (;;) {
    const room = budget - onFloor.filter(Boolean).length * floor;
    const total = panes.reduce(
      (sum, pane, index) => (shrinking(pane, index) ? sum + pane.height : sum),
      0
    );
    const scale = total > room ? room / total : 1;
    const below = panes.flatMap((pane, index) =>
      shrinking(pane, index) && pane.height * scale < floor ? [index] : []
    );

    if (below.length === 0) {
      return panes.map((pane, index) =>
        pane.stretch ? 0 : onFloor[index] ? floor : pane.height * scale
      );
    }

    below.forEach((index) => {
      onFloor[index] = true;
    });
  }
}

/**
 * Resolves pane heights. Fixed panes keep their requested heights and the stretching pane takes
 * the rest; when space runs out, fixed panes shrink proportionally while every pane, the
 * stretching one included, keeps `minHeight` where possible.
 */
function resolvePaneHeights(
  available: number,
  panes: readonly LayoutPaneInput[],
  minHeight: number
): number[] {
  if (panes.length === 0) {
    return [];
  }

  const floor = Math.min(minHeight, available / panes.length);
  const stretchCount = panes.filter((pane) => pane.stretch).length;
  const heights = fitFixedPanes(panes, available - stretchCount * floor, floor);
  const used = heights.reduce((sum, height) => sum + height, 0);
  const rest = Math.max(0, available - used);

  if (stretchCount === 0) {
    const lastIndex = heights.length - 1;
    heights[lastIndex] = (heights[lastIndex] ?? 0) + rest;
    return heights;
  }

  return panes.map((pane, index) => (pane.stretch ? rest / stretchCount : (heights[index] ?? 0)));
}

export function computeLayout(input: LayoutInput): Layout {
  const width = Math.max(0, input.width);
  const height = Math.max(0, input.height);
  const axisWidth = Math.min(input.axisWidth, width);
  const leftAxisWidth = Math.min(input.leftAxisWidth, width - axisWidth);
  const plotWidth = Math.max(0, width - axisWidth - leftAxisWidth);
  const timeAxisHeight = Math.min(input.timeAxisHeight, height);
  const separators = Math.max(0, input.panes.length - 1) * input.separatorHeight;
  const available = Math.max(0, height - timeAxisHeight - separators);
  const heights = resolvePaneHeights(available, input.panes, input.minPaneHeight);
  const panes: PaneLayout[] = [];
  const separatorLayouts: SeparatorLayout[] = [];
  let y = 0;

  input.panes.forEach((pane, index) => {
    const paneHeight = heights[index] ?? 0;
    panes.push({
      id: pane.id,
      plot: { x: 0, y, width: plotWidth, height: paneHeight },
      axis: { x: plotWidth, y, width: axisWidth, height: paneHeight },
      leftAxis:
        leftAxisWidth > 0
          ? { x: -leftAxisWidth, y, width: leftAxisWidth, height: paneHeight }
          : null
    });
    y += paneHeight;

    const next = input.panes[index + 1];

    if (next) {
      separatorLayouts.push({ above: pane.id, below: next.id, y, height: input.separatorHeight });
      y += input.separatorHeight;
    }
  });

  return {
    width,
    height,
    plotWidth,
    axisWidth,
    leftAxisWidth,
    panes,
    separators: separatorLayouts,
    timeAxis: timeAxisHeight > 0 ? { x: -leftAxisWidth, y, width, height: timeAxisHeight } : null
  };
}

/** The layout with x relative to the chart's left edge, as the API reports it. */
export function chartLayout(layout: Layout): Layout {
  const shift = layout.leftAxisWidth;
  const move = (rect: Rect): Rect => ({ ...rect, x: rect.x + shift });
  return {
    ...layout,
    panes: layout.panes.map((pane) => ({
      id: pane.id,
      plot: move(pane.plot),
      axis: move(pane.axis),
      leftAxis: pane.leftAxis ? move(pane.leftAxis) : null
    })),
    separators: layout.separators.map((separator) => ({ ...separator })),
    timeAxis: layout.timeAxis ? move(layout.timeAxis) : null
  };
}

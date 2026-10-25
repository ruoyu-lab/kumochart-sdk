import { applyStroke } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import type {
  AreaStyle,
  BaselineStyle,
  ColumnsStyle,
  HlcAreaStyle,
  LineMarkersStyle,
  LineSeriesStyle
} from './styles';
import type { SeriesPoints, SeriesTypeDefinition } from './types';

/** Adds a polyline through the points to the current path, breaking at gaps. */
export function tracePolyline(
  ctx: CanvasRenderingContext2D,
  points: SeriesPoints,
  read: (index: number) => number,
  step = false
): void {
  if (step) {
    traceSteps(ctx, points, read);
    return;
  }

  // Several points in one pixel column draw the same pixels as its first, lowest, highest and
  // last point, so dense lines (more bars than pixels) keep only those.
  let drawing = false;
  let column = Number.NaN;
  let low = 0;
  let lowX = 0;
  let high = 0;
  let highX = 0;
  let lastX = 0;
  let lastY = 0;
  let pending = 0;

  const flush = () => {
    if (pending > 1) {
      if (lowX < highX) {
        ctx.lineTo(lowX, low);
        ctx.lineTo(highX, high);
      } else {
        ctx.lineTo(highX, high);
        ctx.lineTo(lowX, low);
      }

      ctx.lineTo(lastX, lastY);
    }

    pending = 0;
  };

  for (let index = 0; index < points.count; index += 1) {
    const y = read(index);

    if (Number.isNaN(y)) {
      flush();
      drawing = false;
      continue;
    }

    const x = points.x(index);
    const pixel = Math.floor(x);

    if (drawing && pixel === column) {
      if (y < low) {
        low = y;
        lowX = x;
      }

      if (y > high) {
        high = y;
        highX = x;
      }

      lastX = x;
      lastY = y;
      pending += 1;
      continue;
    }

    flush();

    if (drawing) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      drawing = true;
    }

    column = pixel;
    low = y;
    lowX = x;
    high = y;
    highX = x;
    lastX = x;
    lastY = y;
    pending = 1;
  }

  flush();
}

function traceSteps(
  ctx: CanvasRenderingContext2D,
  points: SeriesPoints,
  read: (index: number) => number
): void {
  let drawing = false;
  let previousY = 0;

  for (let index = 0; index < points.count; index += 1) {
    const y = read(index);

    if (Number.isNaN(y)) {
      drawing = false;
      continue;
    }

    const x = points.x(index);

    if (drawing) {
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      drawing = true;
    }

    previousY = y;
  }
}

/** Fills the area between the line and `baseY` for each unbroken run of points. */
function fillToBase(
  ctx: CanvasRenderingContext2D,
  points: SeriesPoints,
  read: (index: number) => number,
  baseY: number
): void {
  let start = -1;

  const close = (end: number) => {
    if (start < 0) {
      return;
    }

    ctx.lineTo(points.x(end), baseY);
    ctx.lineTo(points.x(start), baseY);
    ctx.closePath();
    start = -1;
  };

  for (let index = 0; index < points.count; index += 1) {
    const y = read(index);

    if (Number.isNaN(y)) {
      close(index - 1);
      continue;
    }

    if (start < 0) {
      start = index;
      ctx.moveTo(points.x(index), y);
    } else {
      ctx.lineTo(points.x(index), y);
    }
  }

  close(points.count - 1);
}

function lineStyle(color: string): LineSeriesStyle {
  return { color, lineWidth: 2, lineStyle: 'solid' };
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  points: SeriesPoints,
  style: LineSeriesStyle,
  step: boolean
): void {
  ctx.beginPath();
  tracePolyline(ctx, points, (index) => points.value(index), step);
  applyStroke(ctx, style.color, style.lineWidth, style.lineStyle);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

export const lineSeries: SeriesTypeDefinition<LineSeriesStyle> = {
  type: 'line',
  input: 'value',
  defaultStyle: (_theme, color) => lineStyle(color),
  paint: ({ ctx, points, style }) => {
    paintLine(ctx, points, style, false);
  }
};

export const stepLineSeries: SeriesTypeDefinition<LineSeriesStyle> = {
  type: 'step-line',
  input: 'value',
  defaultStyle: (_theme, color) => lineStyle(color),
  paint: ({ ctx, points, style }) => {
    paintLine(ctx, points, style, true);
  }
};

export const lineMarkersSeries: SeriesTypeDefinition<LineMarkersStyle> = {
  type: 'line-markers',
  input: 'value',
  defaultStyle: (_theme, color) => ({ ...lineStyle(color), markerRadius: 3 }),
  paint: ({ ctx, points, style }) => {
    paintLine(ctx, points, style, false);
    ctx.beginPath();

    for (let index = 0; index < points.count; index += 1) {
      const y = points.value(index);

      if (!Number.isNaN(y)) {
        ctx.moveTo(points.x(index) + style.markerRadius, y);
        ctx.arc(points.x(index), y, style.markerRadius, 0, Math.PI * 2);
      }
    }

    ctx.fillStyle = style.color;
    ctx.fill();
  }
};

export const areaSeries: SeriesTypeDefinition<AreaStyle> = {
  type: 'area',
  input: 'value',
  defaultStyle: (_theme, color) => ({
    lineColor: color,
    lineWidth: 2,
    topColor: withAlpha(color, 0.4),
    bottomColor: withAlpha(color, 0)
  }),
  paint: ({ ctx, points, style, height }) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, style.topColor);
    gradient.addColorStop(1, style.bottomColor);
    ctx.beginPath();
    fillToBase(ctx, points, (index) => points.value(index), height);
    ctx.fillStyle = gradient;
    ctx.fill();
    paintLine(
      ctx,
      points,
      { color: style.lineColor, lineWidth: style.lineWidth, lineStyle: 'solid' },
      false
    );
  }
};

export const baselineSeries: SeriesTypeDefinition<BaselineStyle> = {
  type: 'baseline',
  input: 'value',
  defaultStyle: (theme) => ({
    baseValue: null,
    lineWidth: 2,
    topLineColor: theme.up,
    topFillColor: withAlpha(theme.up, 0.22),
    bottomLineColor: theme.down,
    bottomFillColor: withAlpha(theme.down, 0.22)
  }),
  paint: ({ ctx, points, style, width, height, valueToY }) => {
    let baseY = style.baseValue === null ? Number.NaN : valueToY(style.baseValue);

    for (let index = 0; Number.isNaN(baseY) && index < points.count; index += 1) {
      baseY = points.value(index);
    }

    if (Number.isNaN(baseY)) {
      return;
    }

    const halves = [
      { top: 0, bottom: baseY, line: style.topLineColor, fill: style.topFillColor },
      { top: baseY, bottom: height, line: style.bottomLineColor, fill: style.bottomFillColor }
    ];

    for (const half of halves) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, half.top, width, half.bottom - half.top);
      ctx.clip();
      ctx.beginPath();
      fillToBase(ctx, points, (index) => points.value(index), baseY);
      ctx.fillStyle = half.fill;
      ctx.fill();
      paintLine(
        ctx,
        points,
        { color: half.line, lineWidth: style.lineWidth, lineStyle: 'solid' },
        false
      );
      ctx.restore();
    }
  }
};

const HLC_HIGH = '#00bcd4';
const HLC_LOW = '#e91e63';

export const hlcAreaSeries: SeriesTypeDefinition<HlcAreaStyle> = {
  type: 'hlc-area',
  input: 'ohlc',
  // The highs in cyan and the lows in pink, each filled faintly to the closes between them.
  defaultStyle: (_theme, color) => ({
    highColor: HLC_HIGH,
    lowColor: HLC_LOW,
    closeColor: color,
    highFillColor: withAlpha(HLC_HIGH, 0.25),
    lowFillColor: withAlpha(HLC_LOW, 0.25),
    lineWidth: 1.5
  }),
  paint: ({ ctx, points, style }) => {
    const bands = [
      { color: style.highFillColor, edge: (index: number) => points.high(index) },
      { color: style.lowFillColor, edge: (index: number) => points.low(index) }
    ];

    // Each band from its edge back along the closes.
    for (const band of bands) {
      ctx.beginPath();
      tracePolyline(ctx, points, band.edge);

      for (let index = points.count - 1; index >= 0; index -= 1) {
        ctx.lineTo(points.x(index), points.close(index));
      }

      ctx.closePath();
      ctx.fillStyle = band.color;
      ctx.fill();
    }

    const lines = [
      { color: style.highColor, read: (index: number) => points.high(index) },
      { color: style.lowColor, read: (index: number) => points.low(index) },
      { color: style.closeColor, read: (index: number) => points.close(index) }
    ];

    for (const line of lines) {
      ctx.beginPath();
      tracePolyline(ctx, points, line.read);
      applyStroke(ctx, line.color, style.lineWidth);
      ctx.stroke();
    }
  }
};

export const columnsSeries: SeriesTypeDefinition<ColumnsStyle> = {
  type: 'columns',
  input: 'value',
  defaultStyle: (theme) => ({
    upColor: theme.volumeUp,
    downColor: theme.volumeDown,
    base: 0,
    widthRatio: 0.72
  }),
  extraExtents: (style) => (style.base === null ? [] : [style.base]),
  paint: ({ ctx, points, style, pixelRatio, barSpacing, height, valueToY }) => {
    // A base the scale cannot place, as zero on a logarithmic one, is the bottom of the pane.
    const placed = style.base === null ? Number.NaN : valueToY(style.base);
    const baseY = Number.isFinite(placed) ? placed : height;
    const width = Math.max(
      1 / pixelRatio,
      Math.round(barSpacing * style.widthRatio * pixelRatio) / pixelRatio
    );

    // One fillRect per column: rasterizing a single path of thousands of rectangles is far slower.
    for (const up of [true, false]) {
      ctx.fillStyle = up ? style.upColor : style.downColor;

      for (let index = 0; index < points.count; index += 1) {
        const y = points.value(index);

        if (points.isUp(index) === up && !Number.isNaN(y)) {
          const left = Math.round((points.x(index) - width / 2) * pixelRatio) / pixelRatio;
          ctx.fillRect(
            left,
            Math.min(y, baseY),
            width,
            Math.max(1 / pixelRatio, Math.abs(baseY - y))
          );
        }
      }
    }
  }
};

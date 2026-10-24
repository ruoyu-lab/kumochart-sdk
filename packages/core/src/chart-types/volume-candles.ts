import { alignToDevice, snap } from '../canvas/canvas';
import { candleStyle, groupsOf } from '../series/bars';
import type { CandleStyle } from '../series/styles';
import type { SeriesPaintContext, SeriesTypeDefinition } from '../series/types';

/**
 * Candles as wide as their volume: the bar with the most volume in view takes the full body
 * width, the others their share of it.
 */
function paintVolumeCandles(context: SeriesPaintContext<CandleStyle>): void {
  const { ctx, points, style, pixelRatio, barSpacing } = context;
  const hairline = 1 / pixelRatio;
  let most = 0;

  for (let index = 0; index < points.count; index += 1) {
    most = Math.max(most, points.volume(index) || 0);
  }

  const widthOf = (index: number) =>
    Math.max(
      hairline,
      alignToDevice(
        (barSpacing * style.bodyRatio * (points.volume(index) || 0)) / (most || 1),
        pixelRatio
      )
    );
  ctx.setLineDash([]);

  for (const group of groupsOf(points)) {
    const { up, color } = group;
    const bodyColor = color ?? (up ? style.upColor : style.downColor);

    if (style.wick) {
      ctx.beginPath();

      for (const index of group.indices) {
        const x = snap(points.x(index), 1, pixelRatio);
        ctx.moveTo(x, points.high(index));
        ctx.lineTo(x, points.low(index));
      }

      ctx.strokeStyle = color ?? (up ? style.upWickColor : style.downWickColor);
      ctx.lineWidth = hairline;
      ctx.stroke();
    }

    ctx.beginPath();

    for (const index of group.indices) {
      const width = widthOf(index);
      const open = points.open(index);
      const close = points.close(index);
      ctx.rect(
        alignToDevice(points.x(index) - width / 2, pixelRatio),
        alignToDevice(Math.min(open, close), pixelRatio),
        width,
        Math.max(hairline, alignToDevice(Math.abs(close - open), pixelRatio))
      );
    }

    ctx.fillStyle = bodyColor;
    ctx.fill();

    if (style.border) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = color ?? (up ? style.upBorderColor : style.downBorderColor);
      ctx.lineWidth = 2 * Math.max(hairline, alignToDevice(1, pixelRatio));
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Candles whose bodies are as wide as their volume. */
export const volumeCandlesSeries: SeriesTypeDefinition<CandleStyle> = {
  type: 'volume-candles',
  input: 'ohlc',
  defaultStyle: (theme) => candleStyle(theme.up, theme.down),
  paint: paintVolumeCandles
};

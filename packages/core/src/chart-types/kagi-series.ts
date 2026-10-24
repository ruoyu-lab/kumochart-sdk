import { snap } from '../canvas/canvas';
import type { BarsView } from '../data/types';
import { fail } from '../utils/errors';
import type { KagiStyle } from '../series/styles';
import type { SeriesPaintContext, SeriesTypeDefinition } from '../series/types';

/**
 * How Kagi line `index` leaves the yin and yang: yang (`true`) when it rises past the last
 * shoulder, the top of the rising line before it, yin (`false`) when it falls past the last
 * waist, `null` when it passes neither.
 */
function crossing(lines: BarsView, index: number): boolean | null {
  if (index < 2) {
    return null;
  }

  const close = lines.close(index);
  const before = lines.close(index - 2);

  if (close > lines.open(index)) {
    return close > before ? true : null;
  }

  return close < before ? false : null;
}

/**
 * Whether Kagi line `index` starts yang: as the last line that passed a shoulder or a waist
 * left it, or else as the first line went, yang when it rose.
 */
export function startsYang(lines: BarsView, index: number): boolean {
  for (let before = index - 1; before >= 2; before -= 1) {
    const crossed = crossing(lines, before);

    if (crossed !== null) {
      return crossed;
    }
  }

  return lines.close(0) > lines.open(0);
}

/** A run of the line in one state, as points to join. */
interface Run {
  readonly yang: boolean;
  readonly points: number[];
}

/**
 * Kagi lines as they are commonly drawn: each bar a vertical line from its open to
 * its close, joined to the next by a short horizontal one, yang (thick, in the up color) from
 * where a line rises past the last shoulder, yin (thin, in the down color) from where it falls
 * past the last waist; a line passing neither keeps the state it started in.
 */
function paintKagi(context: SeriesPaintContext<KagiStyle>): void {
  const { ctx, points, style, pixelRatio, valueToY, first } = context;
  const lines = context.bars ?? fail('Kagi lines are OHLC bars.');
  const runs: Run[] = [];
  let run: Run | null = null;
  let last: readonly [number, number] | null = null;
  // Each run lands on whole device pixels for its own width.
  const snapped = (x: number, y: number, yang: boolean) => {
    const width = yang ? style.upWidth : style.downWidth;
    return [snap(x, width, pixelRatio), snap(y, width, pixelRatio)];
  };
  const to = (x: number, y: number, yang: boolean) => {
    if (run?.yang === yang) {
      run.points.push(...snapped(x, y, yang));
    } else {
      // A new run starts where the last one ended, so the line has no gap.
      const from = last ?? [x, y];
      run = { yang, points: [...snapped(from[0], from[1], yang), ...snapped(x, y, yang)] };
      runs.push(run);
    }

    last = [x, y];
  };
  let yang = startsYang(lines, first);

  for (let point = 0; point < points.count; point += 1) {
    const index = first + point;
    const x = points.x(point);
    const crossed = crossing(lines, index);

    // The horizontal line of the turn, in the state the line turned in.
    to(x, points.open(point), yang);

    if (crossed !== null && crossed !== yang) {
      to(x, valueToY(lines.close(index - 2)), yang);
      yang = crossed;
    }

    to(x, points.close(point), yang);
  }

  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);

  for (const state of [true, false]) {
    ctx.beginPath();

    for (const each of runs) {
      if (each.yang === state) {
        ctx.moveTo(each.points[0] ?? 0, each.points[1] ?? 0);

        for (let at = 2; at < each.points.length; at += 2) {
          ctx.lineTo(each.points[at] ?? 0, each.points[at + 1] ?? 0);
        }
      }
    }

    ctx.strokeStyle = state ? style.upColor : style.downColor;
    ctx.lineWidth = state ? style.upWidth : style.downWidth;
    ctx.stroke();
  }
}

/**
 * Kagi lines: draws the bars of the `kagi` transform, each a line from its open to its
 * close, yang lines thick in the up color and yin lines thin in the down color.
 */
export const kagiSeries: SeriesTypeDefinition<KagiStyle> = {
  type: 'kagi',
  input: 'ohlc',
  defaultStyle: (theme) => ({
    upColor: theme.up,
    downColor: theme.down,
    upWidth: 2,
    downWidth: 1
  }),
  paint: paintKagi
};

import type { DrawingSpace, DrawingStyle } from '../../src/drawings/types';
import type { BarInput } from '../../src/data/types';
import { DRAWING_OPTIONS } from '../../src/drawings/options';
import { typeStyle } from '../../src/drawings/style';
import { trendLine } from '../../src/drawings/tools/lines';
import { createDefaultOptions } from '../../src/options/defaults';

export const MINUTE = 60_000;
export const T0 = Date.UTC(2024, 0, 2, 9, 30);

/** Deterministic bars with a gentle up-and-down drift. */
export function createBars(count: number, start = T0, interval = MINUTE): BarInput[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.5 + (index % 3);
    const close = open + (index % 2 === 0 ? 1.25 : -0.75);
    return {
      time: start + index * interval,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000 + index * 10
    };
  });
}

/** Anchors drawn as they are: times as bar positions, prices on a linear scale. */
export const PLAIN_SPACE: DrawingSpace = {
  toScale: (value) => value,
  fromScale: (scaled) => scaled,
  barIndex: (time) => time,
  timeAt: (index) => index,
  unitHeight: 1
};

/** The style of a drawing on a chart whose options are the defaults. */
export const PLAIN_STYLE: DrawingStyle = structuredClone(
  typeStyle(createDefaultOptions([DRAWING_OPTIONS]), trendLine)
);

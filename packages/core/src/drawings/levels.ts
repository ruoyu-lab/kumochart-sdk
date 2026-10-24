import type { BarsView } from '../data/types';
import type { DrawingLevel, LevelContext, LevelScale } from './types';

/** A level that never reaches a time: the default for anything a definition cannot describe. */
const NONE = Number.NaN;

export const LINEAR_SCALE: LevelScale = {
  toScale: (value) => value,
  fromScale: (scaled) => scaled
};

export const LOG_SCALE: LevelScale = {
  toScale: (value) => (value > 0 ? Math.log10(value) : Number.NaN),
  fromScale: (scaled) => 10 ** scaled
};

/** Continuous positions of times among bars, between them and beyond, as a chart lays them out. */
export interface BarPositions {
  logicalIndexOf(time: number): number;
  timeOfLogicalIndex(logical: number): number;
}

/** What the lines of drawings are computed from: the bars alerts watch, by their positions. */
export function levelContext(bars: BarsView, positions: BarPositions): LevelContext {
  return {
    bars,
    barIndex: (time) => positions.logicalIndexOf(time),
    timeAt: (index) => positions.timeOfLogicalIndex(index)
  };
}

/**
 * Value of `level` at `time`, interpolated between its points by bar position in the pane's
 * scale, as the line is drawn, or as a line that is not straight gives it; `NaN` where the line
 * does not reach.
 */
export function levelValue(
  level: DrawingLevel,
  time: number,
  positions: BarPositions,
  scale: LevelScale
): number {
  if (level.valueAt) {
    return level.valueAt(time);
  }

  const extend = level.extend ?? 'none';
  const start = positions.logicalIndexOf(level.from.time);
  const end = positions.logicalIndexOf(level.to.time);
  const at = positions.logicalIndexOf(time);

  if ([start, end, at].some(Number.isNaN)) {
    return NONE;
  }

  if (start === end) {
    const horizontal = level.from.price === level.to.price;
    const reached = extend === 'both' || (extend === 'end' ? at >= start : at === start);
    return horizontal && reached ? level.from.price : NONE;
  }

  const position = (at - start) / (end - start);
  const reached = extend === 'both' || (position >= 0 && (extend === 'end' || position <= 1));

  if (!reached) {
    return NONE;
  }

  const from = scale.toScale(level.from.price);
  const to = scale.toScale(level.to.price);
  return scale.fromScale(from + position * (to - from));
}

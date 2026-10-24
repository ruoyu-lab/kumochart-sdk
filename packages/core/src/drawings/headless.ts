import { BarStore } from '../data/bar-store';
import { logicalIndex, logicalTime, typicalInterval } from '../data/positions';
import type { BarInput, BarsView } from '../data/types';
import { createDefaultOptions } from '../options/defaults';
import type { ChartOptions } from '../options/types';
import { checkArray, checkFields, checkObject, checkOneOf, fieldsOf } from '../utils/validate';
import { validateDefinition } from './api';
import { checkPointCount, parsePoints } from './drawing-store';
import { LINEAR_SCALE, LOG_SCALE, levelContext, levelValue, type BarPositions } from './levels';
import { checkStyle, resolveStyle } from './style';
import type { DrawingInput, DrawingLevel, DrawingTypeDefinition, LevelScale } from './types';

/** A drawing as {@link drawingLevels} takes it: its anchors and style, as `drawings.add()` does. */
export type DrawingLevelsInput = Pick<DrawingInput, 'points' | 'style'>;

/** Options of {@link drawingLevels}, {@link drawingLevelValue} and {@link computeDrawingLevels}. */
export interface DrawingLevelsOptions {
  /**
   * The scale of the drawing's pane, which lines offset from one another and the values between
   * anchors follow as drawn. Default `linear`.
   */
  scale?: 'linear' | 'log';
}

const SCALES = ['linear', 'log'] as const;
const OPTION_FIELDS = fieldsOf<DrawingLevelsOptions>({ scale: true });

let defaults: ChartOptions | null = null;

/** A chart's options as no one set them, whose theme and font the style of drawings starts from. */
function defaultOptions(): ChartOptions {
  defaults ??= createDefaultOptions();
  return defaults;
}

let noBars: BarStore | null = null;

/** No bars, for lines of the anchors alone, such as the keys of a drawing's lines. */
function emptyBars(): BarStore {
  noBars ??= new BarStore();
  return noBars;
}

function scaleOf(options: DrawingLevelsOptions): LevelScale {
  checkFields('options', options, OPTION_FIELDS);
  const scale = options.scale === undefined ? 'linear' : options.scale;
  return checkOneOf('options.scale', scale, SCALES) === 'log' ? LOG_SCALE : LINEAR_SCALE;
}

/** The typical interval of bars, by their revision, which their positions go by. */
const intervals = new WeakMap<BarsView, { revision: number; interval: number | null }>();

/** The positions of times among bars as a chart of them lays them out. */
function positionsOf(bars: BarsView): BarPositions {
  let entry = intervals.get(bars);

  if (entry?.revision !== bars.revision) {
    entry = { revision: bars.revision, interval: typicalInterval(bars) };
    intervals.set(bars, entry);
  }

  const { interval } = entry;
  return {
    logicalIndexOf: (time) => logicalIndex(bars, interval, time),
    timeOfLogicalIndex: (logical) => logicalTime(bars, interval, logical)
  };
}

/**
 * The lines of a drawing of a type, such as `fibRetracement`, that alerts can watch, computed
 * without a chart: those a chart with `bars` has for the drawing, the first being the one an alert
 * watches by default. The style is as the drawing's `style` gives it, over its type's. Lines computed from the bars, such as a regression trend's or an anchored VWAP's,
 * follow `bars` as they change; without bars a drawing still has its lines, which reach no bar.
 * Runs anywhere, Node included.
 */
export function drawingLevels(
  definition: DrawingTypeDefinition,
  drawing: DrawingLevelsInput,
  bars: BarsView = emptyBars(),
  options: DrawingLevelsOptions = {}
): DrawingLevel[] {
  validateDefinition(definition);
  checkObject('drawing', drawing);
  const points = parsePoints(drawing.points, 'drawing.points');
  checkPointCount(definition, points, definition.type);
  const style = resolveStyle(defaultOptions(), definition, checkStyle(drawing.style ?? {}));
  return [
    ...(definition.levels?.(
      points,
      scaleOf(options),
      style,
      levelContext(bars, positionsOf(bars))
    ) ?? [])
  ];
}

/**
 * The value of a line of {@link drawingLevels} at the time of a bar, as an alert reads it on a
 * chart with these bars: interpolated between its points by bar position, `NaN` where it does
 * not reach.
 */
export function drawingLevelValue(
  level: DrawingLevel,
  time: number,
  bars: BarsView,
  options: DrawingLevelsOptions = {}
): number {
  return levelValue(level, time, positionsOf(bars), scaleOf(options));
}

/**
 * Computes the lines of a drawing over `bars`, oldest first: one array per line key, with its
 * value at every bar, as a chart with these bars draws it and its alerts read it.
 */
export function computeDrawingLevels(
  definition: DrawingTypeDefinition,
  drawing: DrawingLevelsInput,
  bars: readonly BarInput[],
  options: DrawingLevelsOptions = {}
): Record<string, number[]> {
  checkArray('bars', bars);
  const store = new BarStore();
  store.set(bars);
  const scale = scaleOf(options);
  return Object.fromEntries(
    drawingLevels(definition, drawing, store, options).map((level) => [
      level.key,
      Array.from({ length: store.length }, (_, index) =>
        levelValue(level, store.time(index), store, scale)
      )
    ])
  );
}

import type { ValueReader } from '../chart/values';
import type { BarStore } from '../data/bar-store';
import type { ValueSource } from '../data/types';
import type { ChartOptions } from '../options/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { fail } from '../utils/errors';
import type { DrawingEntry, DrawingStore } from './drawing-store';
import { levelContext, levelValue } from './levels';
import { resolveStyle } from './style';
import type { DrawingLevel, LevelScale } from './types';

type DrawingSource = Extract<ValueSource, { kind: 'drawing' }>;

/** What the lines of drawings are read on: the bars, the options, and the scale of each pane. */
export interface DrawingValuesHost {
  readonly bars: BarStore;
  readonly options: () => ChartOptions;
  /** The scale a drawing in the pane is straight on. */
  readonly scaleOf: (paneId: string) => LevelScale;
}

/** The lines of drawings, which alerts watch, read where the drawings are now. */
export function drawingValues(
  host: DrawingValuesHost,
  store: DrawingStore
): ValueReader<DrawingSource> {
  const { bars, scaleOf } = host;
  const context = levelContext(bars, bars);
  /** The lines of a drawing alerts can watch, as its style draws them. */
  const levelsOf = (entry: DrawingEntry): readonly DrawingLevel[] =>
    entry.definition.levels?.(
      entry.points,
      scaleOf(entry.pane),
      resolveStyle(host.options(), entry.definition, entry.style),
      context
    ) ?? [];
  /** The watched line of a drawing, or `null` when the drawing or the line is gone. */
  const levelOf = (entry: DrawingEntry, key: string | undefined): DrawingLevel | null => {
    const levels = levelsOf(entry);
    return (key === undefined ? levels[0] : levels.find((level) => level.key === key)) ?? null;
  };

  return {
    movable: true,
    check: (source, label) => {
      const entry = store.get(source.id) ?? fail(`${label}: unknown drawing "${source.id}".`);
      const keys = levelsOf(entry).map((level) => level.key);

      if (keys.length === 0) {
        fail(`${label}: a "${entry.type}" drawing has no lines to watch.`);
      }

      if (source.level !== undefined && !keys.includes(source.level)) {
        fail(
          `${label}: a "${entry.type}" drawing has no line "${source.level}"; it has ${keys.map((key) => `"${key}"`).join(', ')}.`
        );
      }
    },
    read: (source, index) => {
      // A removed drawing reads as nothing, so what watches it waits until undo brings it back.
      const entry = store.get(source.id);
      const level = entry ? levelOf(entry, source.level) : null;
      return entry && level
        ? levelValue(level, bars.time(index), bars, scaleOf(entry.pane))
        : Number.NaN;
    },
    paneOf: (source) => store.get(source.id)?.pane ?? MAIN_PANE_ID
  };
}

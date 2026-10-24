import type { OptionsSection } from '../options/resolve';
import { checkTexts, unsetTexts, withTexts } from '../options/texts';
import type { ChartOptions, TextOverrides } from '../options/types';
import { checkBoolean, checkFields, checkNumber, checkOneOf, fieldsOf } from '../utils/validate';
import { ENGLISH, textsFor } from './texts';
import type { DrawingTexts } from './types';

/**
 * Snapping of drawing anchors to the open, high, low or close of the bar under the pointer:
 * `weak` snaps near those values, `strong` always. Ctrl/⌘ inverts it while held.
 */
export type MagnetMode = 'off' | 'weak' | 'strong';

/** The `drawings` section of the chart's options, which the drawings module adds. */
export interface DrawingOptions {
  /**
   * Snapping of anchors to the open, high, low or close of the bar under the pointer: `weak`
   * snaps near those values, `strong` always. Ctrl/⌘ inverts it while held.
   */
  magnet: MagnetMode;
  /** Radius of drawing handles in CSS pixels. */
  handleRadius: number;
  /**
   * Shows the drawings. `false` hides every one, as a "hide all" switch does, without changing
   * them: each keeps its own `visible`, and no step is recorded to undo. Default `true`.
   */
  visible: boolean;
  /**
   * Keeps the steps to undo and redo changes of the drawings by. `false` keeps none: undo and
   * redo, by the API or the keys, do nothing. Default `true`.
   */
  history: boolean;
  /** Overrides of the words the drawings paint, `null` for one that follows `locale`. */
  texts: TextOverrides<DrawingTexts>;
}

const FIELDS = fieldsOf<DrawingOptions>({
  magnet: true,
  handleRadius: true,
  visible: true,
  history: true,
  texts: true
});

export const DRAWING_OPTIONS: OptionsSection<DrawingOptions> = {
  key: 'drawings',
  defaults: () => ({
    magnet: 'off',
    handleRadius: 5,
    visible: true,
    history: true,
    texts: unsetTexts(ENGLISH)
  }),
  validate: (options, label) => {
    checkFields(label, options, FIELDS);
    checkOneOf(`${label}.magnet`, options.magnet, ['off', 'weak', 'strong']);
    checkNumber(`${label}.handleRadius`, options.handleRadius, { min: 1 });
    checkBoolean(`${label}.visible`, options.visible);
    checkBoolean(`${label}.history`, options.history);
    checkTexts(`${label}.texts`, options.texts, ENGLISH);
  }
};

/** The drawing options of a chart. */
export function drawingOptions(options: ChartOptions): DrawingOptions {
  // The drawings module adds the section to every chart it is given to.
  return (options as ChartOptions & { readonly drawings: DrawingOptions }).drawings;
}

const resolved = new WeakMap<ChartOptions, DrawingTexts>();

/** The words the drawings paint: those of the chart's `locale`, then `drawings.texts`. */
export function drawingTexts(options: ChartOptions): DrawingTexts {
  let texts = resolved.get(options);

  if (!texts) {
    texts = withTexts(textsFor(options.locale), drawingOptions(options).texts);
    resolved.set(options, texts);
  }

  return texts;
}

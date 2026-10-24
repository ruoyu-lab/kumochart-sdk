import { font } from '../canvas/canvas';
import { checkColor, withAlpha } from '../canvas/color';
import { defineModule, type ChartModule } from '../chart/modules';
import type { OptionsSection } from '../options/resolve';
import type { ChartOptions } from '../options/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { checkArray, checkFields, checkNumber, checkString, fieldsOf } from '../utils/validate';

/** A line of text of the watermark. */
export interface WatermarkLine {
  readonly text: string;
  /** Font size in CSS pixels, from 6 to 200. Default 40. */
  readonly size?: number;
}

/** The `watermark` section of the chart's options, which the watermark module adds. */
export interface WatermarkOptions {
  /**
   * Lines of text in the middle of the main pane, under the series, such as the symbol and its
   * timeframe, from the top down. None by default.
   */
  lines: readonly WatermarkLine[];
  /** The color of the text; `null` (default) takes the theme's text color, faint. */
  color: string | null;
}

export type WatermarkModule = ChartModule<{
  readonly options: { readonly watermark: WatermarkOptions };
}>;

const DEFAULT_SIZE = 40;
/** The height of a line, as a share of its font size. */
const LINE_HEIGHT = 1.25;
/** How strong the theme's text color is in the watermark. */
const FAINT = 0.1;

const FIELDS = fieldsOf<WatermarkOptions>({ lines: true, color: true });
const LINE_FIELDS = fieldsOf<WatermarkLine>({ text: true, size: true });

const WATERMARK_OPTIONS: OptionsSection<WatermarkOptions> = {
  key: 'watermark',
  defaults: () => ({ lines: [], color: null }),
  validate: (options, label) => {
    checkFields(label, options, FIELDS);
    checkArray(`${label}.lines`, options.lines);
    options.lines.forEach((line, index) => {
      const path = `${label}.lines[${index}]`;
      checkFields(path, line, LINE_FIELDS);
      checkString(`${path}.text`, line.text);

      if (line.size !== undefined) {
        checkNumber(`${path}.size`, line.size, { min: 6, max: 200 });
      }
    });

    if (options.color !== null) {
      checkColor(`${label}.color`, options.color);
    }
  }
};

/** The watermark options of a chart. */
function watermarkOptions(options: ChartOptions): WatermarkOptions {
  // The module adds the section to every chart it is given to.
  return (options as ChartOptions & { readonly watermark: WatermarkOptions }).watermark;
}

/**
 * The watermark module: large faint text in the middle of the main pane, under the series, such
 * as the symbol and its timeframe, set by the `watermark` option:
 *
 * ```ts
 * const chart = createChart(container, {
 *   modules: [watermark()],
 *   watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
 * });
 * ```
 */
export function watermark(): WatermarkModule {
  return defineModule({
    name: 'watermark',
    options: WATERMARK_OPTIONS,
    install: (core) => {
      core.scenePainters.push((ctx, _frame, pane, layer) => {
        const { lines, color } = watermarkOptions(core.options);

        if (layer !== 'below' || pane.id !== MAIN_PANE_ID || lines.length === 0) {
          return;
        }

        const { theme, font: chartFont } = core.options;
        const heights = lines.map((line) => (line.size ?? DEFAULT_SIZE) * LINE_HEIGHT);
        let top = (pane.plot.height - heights.reduce((sum, height) => sum + height, 0)) / 2;
        ctx.fillStyle = color ?? withAlpha(theme.text, FAINT);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        lines.forEach((line, index) => {
          const height = heights[index] ?? 0;
          ctx.font = font(line.size ?? DEFAULT_SIZE, chartFont.family, 600);
          ctx.fillText(line.text, pane.plot.width / 2, top + height / 2);
          top += height;
        });
      });
      return {};
    }
  });
}

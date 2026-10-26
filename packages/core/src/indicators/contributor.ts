import { font } from '../canvas/canvas';
import { withAlpha } from '../canvas/color';
import { shapeDirection } from '../canvas/shapes';
import { formatValue, type ValueFormat } from '../format/value-format';
import type { Theme } from '../options/types';
import {
  paletteColor,
  type BufferPool,
  type Contributor,
  type ContributorProvider
} from '../render/contributors';
import type { FrameSources, PlotJob } from '../render/frame';
import { includeValue, type Extents, type PriceScale } from '../scales/price-scale';
import type { PointBuffer } from '../series/types';
import type { IndicatorEntry, IndicatorStore } from './indicator-store';
import type { IndicatorOutput, IndicatorPlot } from './types';

/** A run of consecutive logical indices with values, and the extent of its values. */
interface Run {
  readonly start: number;
  readonly end: number;
  readonly high: number;
  readonly low: number;
}

/**
 * The runs where `top` and `bottom` both have values that reach into `[from, to]`, each whole:
 * a run reaching past the window is followed to its ends. A change of `group` starts a new run.
 */
function runsOf(
  top: (index: number) => number,
  bottom: (index: number) => number,
  group: ((index: number) => number) | null,
  from: number,
  to: number
): Run[] {
  const defined = (index: number) => !Number.isNaN(top(index)) && !Number.isNaN(bottom(index));
  /** Whether the bar after `index` continues its run. */
  const joined = (index: number) =>
    defined(index) && defined(index + 1) && (!group || group(index) === group(index + 1));
  const runs: Run[] = [];

  for (let index = from; index <= to; index += 1) {
    if (!defined(index)) {
      continue;
    }

    let start = index;
    let end = index;

    while (joined(start - 1)) {
      start -= 1;
    }

    while (joined(end)) {
      end += 1;
    }

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;

    for (let position = start; position <= end; position += 1) {
      high = Math.max(high, top(position));
      low = Math.min(low, bottom(position));
    }

    runs.push({ start, end, high, low });
    index = end;
  }

  return runs;
}

class IndicatorContributor implements Contributor {
  readonly pane: string;
  readonly scale: string;

  constructor(
    private readonly sources: FrameSources,
    private readonly entry: IndicatorEntry,
    private readonly range: { from: number; to: number },
    readonly format: ValueFormat,
    private readonly colors: ReadonlyMap<string, string>,
    private readonly pool: BufferPool
  ) {
    this.pane = entry.pane;
    this.scale = entry.scale;
  }

  /** Reads output `column` by the logical index it is drawn on. */
  private reader(column: number): (index: number) => number {
    return this.entry.series.reader(column);
  }

  /** Where the columns of an output start at each bar: another output's value, or a fixed one. */
  private startOf(from: string | number): (index: number) => number {
    if (typeof from === 'number') {
      return () => from;
    }

    return this.reader(this.entry.outputs.findIndex((output) => output.key === from));
  }

  /**
   * The text of the marker of output `column` on each logical index of `[from, to]`: its text and
   * its value, as the legend writes it; none where it has no value.
   */
  private valueTexts(column: number, output: IndicatorOutput, from: number, to: number): string[] {
    const read = this.reader(column);
    const format = outputFormat(output, this.format);
    const text = output.plot.kind === 'marker' ? output.plot.text : undefined;
    const texts: string[] = [];

    for (let index = from; index <= to; index += 1) {
      const value = read(index);
      texts.push(
        Number.isNaN(value)
          ? ''
          : [text, formatValue(this.sources.formatter, value, format)].filter(Boolean).join(' ')
      );
    }

    return texts;
  }

  /** The runs of a `box` output over logical indices `[from, to]`. */
  private boxRuns(
    column: number,
    plot: Extract<IndicatorPlot, { kind: 'box' }>,
    from: number,
    to: number
  ): Run[] {
    const group = plot.group === undefined ? null : this.startOf(plot.group);
    return runsOf(this.reader(column), this.startOf(plot.from), group, from, to);
  }

  /**
   * Logical indices across the plot, `margin` more on each side, where outputs can be drawn: on
   * the bars, and before or after them as far as outputs are shifted.
   */
  private window(margin: number): { from: number; to: number } {
    const { series, outputs } = this.entry;
    const logical = this.sources.timeScale.logicalRange();
    const reach = outputs.map((_output, column) => series.reach(column));
    return {
      from: Math.max(
        Math.floor(logical.from + 0.5) - margin,
        -Math.max(0, ...reach.map((each) => each.before))
      ),
      to: Math.min(
        Math.ceil(logical.to - 0.5) + margin,
        this.sources.bars.length - 1 + Math.max(0, ...reach.map((each) => each.after))
      )
    };
  }

  include(extents: Extents, everything: boolean): void {
    const { outputs, definition, styles } = this.entry;
    const { from, to } = this.window(0);

    outputs.forEach((output, column) => {
      const { plot } = output;

      if (
        !drawn(this.entry, output) ||
        (!everything && (styles[output.key]?.autoscale ?? output.autoscale) === false)
      ) {
        return;
      }

      const read = this.reader(column);
      const start = plot.kind === 'columns' ? this.startOf(plot.from) : null;

      for (let index = from; index <= to; index += 1) {
        const value = read(index);
        includeValue(extents, value);

        if (start && !Number.isNaN(value)) {
          includeValue(extents, start(index));
        }
      }

      if (output.plot.kind === 'histogram') {
        includeValue(extents, 0);
      } else if (output.plot.kind === 'box') {
        for (const run of this.boxRuns(column, output.plot, from, to)) {
          includeValue(extents, run.high);
          includeValue(extents, run.low);
        }
      }
    });

    if (definition.range) {
      includeValue(extents, definition.range.min);
      includeValue(extents, definition.range.max);
    }
  }

  /**
   * The first output's value on the first bar in view, or on the first one after it where it has
   * one, such as after its warm-up: what a percent or indexed scale is measured from.
   */
  firstValue(): number | null {
    const read = this.reader(0);
    const { to } = this.window(0);

    for (let index = this.range.from; index <= to; index += 1) {
      const value = read(index);

      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  emit(scale: PriceScale, jobs: PlotJob[]): void {
    const { outputs, fills, definition, params, id, series } = this.entry;
    const { timeScale, options, seriesTypes } = this.sources;
    const theme = options.theme;
    const { from, to } = this.window(1);
    const buffers = new Map<string, PointBuffer>();
    /** Where the columns of `columns` outputs start. */
    const starts = new Map<string, PointBuffer>();
    /** Outputs that bound a shade, which a hidden output can do too. */
    const filled = new Set(fills.flatMap((fill) => [fill.from, fill.to]));

    outputs.forEach((output, column) => {
      const { plot } = output;
      const bounds =
        plot.kind === 'hidden' &&
        filled.has(output.key) &&
        this.entry.styles[output.key]?.visible !== false;

      if (!drawn(this.entry, output) && !bounds) {
        return;
      }

      const points = this.pool.take(`indicator:${id}:${output.key}`);
      points.reset(to - from + 1);

      if (plot.kind === 'columns') {
        const start = this.startOf(plot.from);
        const starting = this.pool.take(`indicator:${id}:${output.key}:from`);
        starting.reset(to - from + 1);

        for (let index = from; index <= to; index += 1) {
          starting.pushValue(timeScale.indexToX(index), scale.valueToY(start(index)), true);
        }

        starts.set(output.key, starting);
      }

      const read = this.reader(column);
      const before = series.reader(column, 1);
      const rises = (at: number) => series.rises(at);
      // A marker of a bar shown on several displayed bars, as of a longer timeframe, goes once.
      const marked = plot.kind === 'marker';

      for (let index = from; index <= to; index += 1) {
        const value = marked && !series.opens(index) ? Number.NaN : read(index);
        const up =
          plot.kind === 'histogram'
            ? columnRises(plot.colorBy, read, before, rises, index)
            : !(value < read(index - 1));
        points.pushValue(timeScale.indexToX(index), scale.valueToY(value), up);
      }

      buffers.set(output.key, points);
    });

    fills.forEach((fill) => {
      const fromBuffer = buffers.get(fill.from);
      const toBuffer = buffers.get(fill.to);

      if (fromBuffer && toBuffer) {
        // A shade that tells which output is higher has to read at a glance; a band only frames.
        const alpha = fill.colorBy === 'higher' ? 0.14 : 0.08;
        const shade = (key: string) => withAlpha(this.colors.get(key) ?? theme.textMuted, alpha);
        const higher = shade(fill.from);
        const lower = fill.colorBy === 'higher' ? shade(fill.to) : higher;
        // Where `from` is higher it is drawn above `to`, unless the scale is inverted.
        const segmented = (key: string) =>
          outputs.find((output) => output.key === key)?.plot.kind === 'segments';
        jobs.push({
          kind: 'fill',
          above: scale.inverted ? lower : higher,
          below: scale.inverted ? higher : lower,
          from: fromBuffer,
          to: toBuffer,
          steps: segmented(fill.from) && segmented(fill.to)
        });
      }
    });

    (this.entry.levels ?? definition.levels?.(params) ?? []).forEach((level) => {
      const y = scale.valueToY(level);

      if (Number.isFinite(y)) {
        jobs.push({ kind: 'reference', y, color: withAlpha(theme.textMuted, 0.6) });
      }
    });

    outputs.forEach((output, column) => {
      const points = buffers.get(output.key);

      if (!points) {
        return;
      }

      if (output.plot.kind === 'box') {
        const spacing = timeScale.barSpacing;
        jobs.push({
          kind: 'boxes',
          boxes: this.boxRuns(column, output.plot, from, to).map((run) => {
            const top = scale.valueToY(run.high);
            const bottom = scale.valueToY(run.low);
            return {
              x: timeScale.indexToX(run.start) - spacing / 2,
              y: Math.min(top, bottom),
              width: (run.end - run.start + 1) * spacing,
              height: Math.abs(bottom - top)
            };
          }),
          color: this.colors.get(output.key) ?? theme.text
        });
        return;
      }

      if (output.plot.kind === 'histogram') {
        // A color of its own, set or fixed, paints every column, as the legend shows the value.
        const own = this.colors.get(output.key);
        const [upColor, downColor] = own ? [own, own] : columnColors(output.plot.colorBy, theme);
        jobs.push({
          kind: 'series',
          definition: seriesTypes.require('columns'),
          style: { upColor, downColor, base: 0, widthRatio: 0.6 },
          points,
          valueToY: (value) => scale.valueToY(value),
          bars: null,
          first: from,
          transform: null
        });
      } else if (output.plot.kind === 'line') {
        jobs.push({
          kind: 'series',
          definition: seriesTypes.require('line'),
          style: {
            color: this.colors.get(output.key) ?? theme.text,
            lineWidth: this.entry.styles[output.key]?.lineWidth ?? output.plot.width ?? 1.25,
            lineStyle: this.entry.styles[output.key]?.lineStyle ?? output.plot.style ?? 'solid'
          },
          points,
          valueToY: (value) => scale.valueToY(value),
          bars: null,
          first: from,
          transform: null
        });
      } else if (output.plot.kind === 'segments') {
        jobs.push({
          kind: 'segments',
          points,
          color: this.colors.get(output.key) ?? theme.text,
          lineWidth: this.entry.styles[output.key]?.lineWidth ?? output.plot.width ?? 1.25,
          lineStyle: this.entry.styles[output.key]?.lineStyle ?? output.plot.style ?? 'solid'
        });
      } else if (output.plot.kind === 'columns') {
        jobs.push({
          kind: 'columns',
          points,
          from: starts.get(output.key) ?? points,
          color: this.colors.get(output.key) ?? theme.text,
          width: output.plot.width ?? 0.6,
          hollow: output.plot.hollow ?? false
        });
      } else if (output.plot.kind === 'marker') {
        jobs.push({
          kind: 'markers',
          points,
          color: this.colors.get(output.key) ?? plainColor(output.plot, theme),
          shape: output.plot.shape ?? null,
          text: output.plot.value
            ? this.valueTexts(column, output, from, to)
            : (output.plot.text ?? ''),
          size: output.plot.size ?? 5,
          font: font(options.font.size - 1, options.font.family)
        });
      }
    });
  }
}

/** The up and down colors of the columns of a histogram: the volume's for columns by bar. */
function columnColors(colorBy: 'sign' | 'change' | 'bar', theme: Theme): [string, string] {
  return colorBy === 'bar' ? [theme.volumeUp, theme.volumeDown] : [theme.up, theme.down];
}

/**
 * The color of an output without a color of its own: arrows and triangles take the buy and sell
 * colors, as chart markers do.
 */
function plainColor(plot: IndicatorPlot, theme: Theme): string {
  const direction = plot.kind === 'marker' && plot.shape ? shapeDirection(plot.shape) : 0;
  return direction > 0 ? theme.buy : direction < 0 ? theme.sell : theme.text;
}

/**
 * Whether the column of a histogram on logical index `index` takes the up color: `before` reads
 * the value of the bar before the one shown there, and `rises` tells whether the one shown rose.
 */
function columnRises(
  colorBy: 'sign' | 'change' | 'bar',
  read: (index: number) => number,
  before: (index: number) => number,
  rises: (index: number) => boolean,
  index: number
): boolean {
  switch (colorBy) {
    case 'bar':
      return rises(index);
    case 'sign':
      return read(index) >= 0;
    case 'change':
      return !(read(index) < before(index));
  }
}

/**
 * The color the value of `output`, the indicator's output `column`, is drawn in on logical index
 * `index`, for the legend and `valuesAt()`: the output's color, else for a histogram the theme's
 * color of its column, for an arrow or a triangle the buy or sell color.
 */
export function valueColor(
  entry: IndicatorEntry,
  output: IndicatorOutput,
  column: number,
  index: number,
  colors: ReadonlyMap<string, string>,
  theme: Theme
): string {
  const { plot } = output;
  const color = colors.get(output.key);

  if (color) {
    return color;
  }

  if (plot.kind === 'histogram') {
    const { series } = entry;
    const [up, down] = columnColors(plot.colorBy, theme);
    const rises = (at: number) => series.rises(at);
    return columnRises(plot.colorBy, series.reader(column), series.reader(column, 1), rises, index)
      ? up
      : down;
  }

  return plainColor(plot, theme);
}

/** Whether an output of an indicator is drawn: not a hidden plot, nor one the user hid. */
export function drawn(entry: IndicatorEntry, output: IndicatorOutput): boolean {
  return output.plot.kind !== 'hidden' && entry.styles[output.key]?.visible !== false;
}

/**
 * Colors of the indicator outputs: explicit overrides, then fixed colors, then theme colors, then
 * the palette. Outputs take the palette colors in turn, those overridden too, so that coloring
 * one leaves the others as they were. The output a box reaches down to takes the box's color.
 */
export function indicatorColors(entry: IndicatorEntry, theme: Theme): Map<string, string> {
  const colors = new Map<string, string>();
  const boxOf = new Map<string, string>();
  let next = 0;

  for (const { key, plot } of entry.outputs) {
    if (plot.kind === 'box') {
      boxOf.set(plot.from, key);
    }
  }

  for (const output of entry.outputs) {
    const fixed = output.color ?? (output.themeColor && theme[output.themeColor]);
    const { plot } = output;
    // Values seen nowhere, such as where columns start, leave the palette to the others, and
    // so do arrows and triangles, which take the buy and sell colors, and the bottoms of boxes.
    const unseen = plot.kind === 'hidden' && output.legend === false;
    const directed = plot.kind === 'marker' && plot.shape && shapeDirection(plot.shape) !== 0;
    const turn =
      !fixed && plot.kind !== 'histogram' && !unseen && !directed && !boxOf.has(output.key)
        ? paletteColor(theme.palette, next++)
        : undefined;
    const color = entry.colors[output.key] ?? fixed ?? turn;

    if (color) {
      colors.set(output.key, color);
    }
  }

  boxOf.forEach((box, bottom) => {
    const color = colors.get(box);

    if (color && !colors.has(bottom)) {
      colors.set(bottom, color);
    }
  });

  return colors;
}

/** How an output's values read: in its own precision, or in the indicator's `format`. */
export function outputFormat(output: IndicatorOutput, format: ValueFormat): ValueFormat {
  return output.precision === undefined ? format : { kind: 'decimal', precision: output.precision };
}

export function indicatorFormat(entry: IndicatorEntry, priceFormat: ValueFormat): ValueFormat {
  const precision = entry.definition.precision;

  // Price precision follows the input: the bars, or the indicator read.
  if (precision === 'price') {
    return entry.upstream ? indicatorFormat(entry.upstream, priceFormat) : priceFormat;
  }

  return precision === 'volume' ? { kind: 'compact' } : { kind: 'decimal', precision };
}

/** Draws the visible indicators of a store in their panes. */
export function indicatorContributors(store: IndicatorStore): ContributorProvider {
  return (sources, range, priceFormat, pool) =>
    store.list().flatMap((entry) => {
      if (!entry.visible) {
        return [];
      }

      entry.series.sync();
      return [
        new IndicatorContributor(
          sources,
          entry,
          range,
          indicatorFormat(entry, priceFormat),
          indicatorColors(entry, sources.options.theme),
          pool
        )
      ];
    });
}

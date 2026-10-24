import type { ValueFormat } from '../format/value-format';
import type { Theme } from '../options/types';
import { MAIN_PANE_ID, RIGHT_SCALE } from '../panes/pane-store';
import { includeValue, type Extents, type PriceScale } from '../scales/price-scale';
import { PointBuffer, type SeriesTypeDefinition } from '../series/types';
import { describeValue, fail } from '../utils/errors';
import type { FrameSources, PlotJob } from './frame';
import { SeriesContributor, seriesFormat, styleFor } from './series-contributor';

/** Contributors a module adds to a frame, such as one per indicator. */
export type ContributorProvider = (
  sources: FrameSources,
  range: { readonly from: number; readonly to: number },
  priceFormat: ValueFormat,
  pool: BufferPool
) => Contributor[];

/** A source of values drawn in one pane. */
export interface Contributor {
  readonly pane: string;
  /** Id of the price scale in the pane. */
  readonly scale: string;
  readonly format: ValueFormat;
  /**
   * Widens `extents` by the values in view; `everything` also by those left out of autoscale,
   * for a scale with nothing else to fit.
   */
  include(extents: Extents, everything: boolean): void;
  /** The value at the first bar in view, which percent and indexed scales measure against. */
  firstValue(): number | null;
  /**
   * Measures the values against a first value of their own on a percent or indexed scale whose
   * base is `base`, as symbols compared with the bars are: placed where the scale's base moved
   * as much would be. Those without it are measured against the scale's base.
   */
  rebase?(mode: 'percent' | 'indexed', base: number): void;
  emit(scale: PriceScale, jobs: PlotJob[]): void;
  /** The latest value to mark on the axis of its scale, as placed there, in its color. */
  latest?(): { readonly value: number; readonly color: string } | null;
}

/** Palette color `index`, cycling through the palette, which a theme never leaves empty. */
export function paletteColor(palette: Theme['palette'], index: number): string {
  return palette[index % palette.length] as string;
}

/** Owns the point buffers of every plotted line between frames. */
export class BufferPool {
  private buffers = new Map<string, PointBuffer>();
  private used = new Set<string>();

  take(key: string): PointBuffer {
    this.used.add(key);
    let buffer = this.buffers.get(key);

    if (!buffer) {
      buffer = new PointBuffer();
      this.buffers.set(key, buffer);
    }

    return buffer;
  }

  /** Drops the buffers not taken since the previous call. */
  sweep(): void {
    for (const key of this.buffers.keys()) {
      if (!this.used.has(key)) {
        this.buffers.delete(key);
      }
    }

    this.used = new Set();
  }
}

/** The color `mainSeries.barColor` chooses for a bar, or `null` without the option. */
function barColorer(sources: FrameSources): ((index: number) => string | null) | null {
  const choose = sources.options.mainSeries.barColor;

  if (!choose) {
    return null;
  }

  const { bars, values } = sources;
  return (index) => {
    const bar = bars.bar(index) ?? fail(`There is no bar ${index}.`);
    // Checked at runtime: the callback may come from plain JavaScript.
    const color: unknown = choose({
      index,
      bar,
      indicator: (id, key) => {
        const source = { kind: 'indicator', id, ...(key === undefined ? {} : { key }) } as const;
        values.check(source, 'mainSeries.barColor');
        return values.read(source, index);
      }
    });

    if (color !== null && typeof color !== 'string') {
      fail(
        `mainSeries.barColor must return a color string or null, received ${describeValue(color)}.`
      );
    }

    return color;
  };
}

class MainContributor implements Contributor {
  readonly pane = MAIN_PANE_ID;
  readonly scale = RIGHT_SCALE;

  constructor(
    private readonly sources: FrameSources,
    private readonly range: { from: number; to: number },
    readonly format: ValueFormat,
    private readonly pool: BufferPool
  ) {}

  private get definition(): SeriesTypeDefinition<object> {
    return this.sources.seriesTypes.require(this.sources.options.mainSeries.type);
  }

  include(extents: Extents): void {
    const { bars, options } = this.sources;
    const ohlc = this.definition.input === 'ohlc';

    for (let index = this.range.from; index <= this.range.to; index += 1) {
      if (ohlc) {
        includeValue(extents, bars.low(index));
        includeValue(extents, bars.high(index));
      } else {
        includeValue(extents, bars.price(index, options.mainSeries.source));
      }
    }
  }

  firstValue(): number | null {
    const { bars, options } = this.sources;
    return bars.price(
      this.range.from,
      this.definition.input === 'ohlc' ? 'close' : options.mainSeries.source
    );
  }

  emit(scale: PriceScale, jobs: PlotJob[]): void {
    const { bars, timeScale, options } = this.sources;
    const definition = this.definition;
    const points = this.pool.take('main');
    const from = Math.max(0, this.range.from - 1);
    const to = Math.min(bars.length - 1, this.range.to + 1);
    points.reset(to - from + 1);

    const colorOf = barColorer(this.sources);

    for (let index = from; index <= to; index += 1) {
      const x = timeScale.indexToX(index);

      if (definition.input === 'ohlc') {
        const open = bars.open(index);
        const close = bars.close(index);
        points.pushOhlc(
          x,
          scale.valueToY(open),
          scale.valueToY(bars.high(index)),
          scale.valueToY(bars.low(index)),
          scale.valueToY(close),
          bars.volume(index),
          close >= open,
          colorOf?.(index) ?? null
        );
      } else {
        const value = bars.price(index, options.mainSeries.source);
        const previous = index > 0 ? bars.price(index - 1, options.mainSeries.source) : value;
        points.pushValue(x, scale.valueToY(value), value >= previous);
      }
    }

    jobs.push({
      kind: 'series',
      definition,
      style: styleFor(
        options.mainSeries,
        definition,
        this.sources,
        paletteColor(options.theme.palette, 0),
        options.mainSeries.styles[options.mainSeries.type] ?? undefined
      ),
      points,
      valueToY: (value) => scale.valueToY(value),
      bars: definition.input === 'ohlc' ? bars : null,
      first: from,
      transform: this.sources.transform
    });
  }
}

export function collectContributors(
  sources: FrameSources,
  range: { from: number; to: number },
  priceFormat: ValueFormat,
  pool: BufferPool
): Contributor[] {
  const { options } = sources;
  const palette = options.theme.palette;
  const contributors: Contributor[] = [new MainContributor(sources, range, priceFormat, pool)];

  sources.series.list().forEach((entry, index) => {
    if (entry.visible) {
      const color = paletteColor(palette, index + 1);
      contributors.push(
        new SeriesContributor(sources, entry, range, seriesFormat(entry, priceFormat), color, pool)
      );
    }
  });

  sources.contributors.forEach((provider) => {
    contributors.push(...provider(sources, range, priceFormat, pool));
  });

  return contributors;
}

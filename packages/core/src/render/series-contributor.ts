import type { ValueFormat } from '../format/value-format';
import type { Theme } from '../options/types';
import { includeValue, type Extents, type PriceScale } from '../scales/price-scale';
import type { SeriesEntry } from '../series/series-store';
import type { SeriesTypeDefinition } from '../series/types';
import { deepMerge } from '../utils/merge';
import type { BufferPool, Contributor } from './contributors';
import type { FrameSources, PlotJob } from './frame';

interface StyleMemo {
  readonly definition: SeriesTypeDefinition<object>;
  readonly theme: Theme;
  readonly color: string;
  readonly overrides: object | undefined;
  readonly style: object;
}

/** The styles last worked out, by what they are of: a series, or the main series' options. */
const styles = new WeakMap<object, StyleMemo>();

/**
 * The style a series is drawn with: its type's in the theme and its color, under its own. It is
 * worked out again for `owner`, what it is the style of, only when one of those changes.
 */
export function styleFor(
  owner: object,
  definition: SeriesTypeDefinition<object>,
  sources: FrameSources,
  color: string,
  overrides: object | undefined
): object {
  const { theme } = sources.options;
  const memo = styles.get(owner);

  if (
    memo?.definition === definition &&
    memo.theme === theme &&
    memo.color === color &&
    memo.overrides === overrides
  ) {
    return memo.style;
  }

  const style = deepMerge<object>(definition.defaultStyle(theme, color), overrides);
  styles.set(owner, { definition, theme, color, overrides, style });
  return style;
}

/** How a series' values read: in its own decimals, or in the main series'. */
export function seriesFormat(entry: SeriesEntry, priceFormat: ValueFormat): ValueFormat {
  return entry.precision === null ? priceFormat : { kind: 'decimal', precision: entry.precision };
}

/** An additional series, such as a symbol compared with the bars. */
export class SeriesContributor implements Contributor {
  readonly pane: string;
  readonly scale: string;
  /** Where a value is placed on the scale: itself, or measured against the series' own base. */
  private placed: (value: number) => number = (value) => value;

  constructor(
    private readonly sources: FrameSources,
    private readonly entry: SeriesEntry,
    /** Integer indices of the bars in view. */
    private readonly range: { from: number; to: number },
    readonly format: ValueFormat,
    private readonly color: string,
    private readonly pool: BufferPool
  ) {
    this.pane = entry.pane;
    this.scale = entry.scale;
  }

  /** Index range of the series points around the visible logical range. */
  private window(): { from: number; to: number } {
    const { bars, timeScale } = this.sources;
    const range = timeScale.logicalRange();
    const store = this.entry.bars ?? this.entry.values;
    const length = store?.length ?? 0;
    // Beside one bar, no time off it can be told: the window keeps to the bar.
    const single = bars.length === 1;
    const startTime = bars.timeOfLogicalIndex(single ? 0 : Math.floor(range.from) - 1);
    const endTime = bars.timeOfLogicalIndex(single ? 0 : Math.ceil(range.to) + 1);

    if (!store || Number.isNaN(startTime) || Number.isNaN(endTime)) {
      return { from: 0, to: -1 };
    }

    const from = store.lowerBound(startTime);
    const to = Math.min(length, store.lowerBound(endTime) + 1) - 1;
    return { from, to };
  }

  include(extents: Extents): void {
    const { from, to } = this.window();
    const { bars, values } = this.entry;
    const placed = this.placed;

    for (let index = from; index <= to; index += 1) {
      if (bars) {
        includeValue(extents, placed(bars.low(index)));
        includeValue(extents, placed(bars.high(index)));
      } else if (values) {
        includeValue(extents, placed(values.value(index)));
      }
    }

    const style = styleFor(
      this.entry,
      this.entry.definition,
      this.sources,
      this.color,
      this.entry.style
    );
    this.entry.definition.extraExtents?.(style).forEach((value) => {
      includeValue(extents, placed(value));
    });
  }

  /**
   * The close or value at the time of the first bar in view, or the first one after it where the
   * series has none there, such as a symbol that started trading later.
   */
  firstValue(): number | null {
    const { bars: store, values } = this.entry;
    const { to } = this.window();
    const first = this.sources.bars.time(this.range.from);

    for (let index = (store ?? values)?.lowerBound(first) ?? 0; index <= to; index += 1) {
      const value = store ? store.close(index) : (values?.value(index) ?? Number.NaN);

      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  rebase(mode: 'percent' | 'indexed', base: number): void {
    const own = this.firstValue();

    if (own === null || own === base) {
      return;
    }

    // As the scale's base needs to be, the series' own is not zero, or for indexed, positive.
    if (mode === 'percent') {
      this.placed =
        own === 0
          ? () => Number.NaN
          : (value) => base + ((value - own) / Math.abs(own)) * Math.abs(base);
    } else {
      this.placed = own > 0 ? (value) => (value / own) * base : () => Number.NaN;
    }
  }

  /**
   * Its latest close or value, when it shows a label of it: in the color of its line, or of a
   * rising or falling bar.
   */
  latest(): { value: number; color: string } | null {
    const { bars: store, values, lastValueLabel } = this.entry;
    const last = ((store ?? values)?.length ?? 0) - 1;
    const value = store ? store.close(last) : (values?.value(last) ?? Number.NaN);

    if (!lastValueLabel || !Number.isFinite(value)) {
      return null;
    }

    const { theme } = this.sources.options;
    const style = styleFor(
      this.entry,
      this.entry.definition,
      this.sources,
      this.color,
      this.entry.style
    ) as {
      color?: string;
      upColor?: string;
      downColor?: string;
    };
    const up = !store || value >= store.open(last);
    return {
      value: this.placed(value),
      color: style.color ?? (up ? (style.upColor ?? theme.up) : (style.downColor ?? theme.down))
    };
  }

  emit(scale: PriceScale, jobs: PlotJob[]): void {
    const { from, to } = this.window();
    const { bars: store, values } = this.entry;
    const { bars, timeScale } = this.sources;
    const points = this.pool.take(`series:${this.entry.id}`);
    const placed = this.placed;
    const valueToY = (value: number) => scale.valueToY(placed(value));
    points.reset(Math.max(0, to - from + 1));

    for (let index = from; index <= to; index += 1) {
      if (store) {
        const x = timeScale.indexToX(bars.logicalIndexOf(store.time(index)));
        const open = store.open(index);
        const close = store.close(index);
        points.pushOhlc(
          x,
          valueToY(open),
          valueToY(store.high(index)),
          valueToY(store.low(index)),
          valueToY(close),
          store.volume(index),
          close >= open
        );
      } else if (values) {
        const x = timeScale.indexToX(bars.logicalIndexOf(values.time(index)));
        const value = values.value(index);
        const previous = index > 0 ? values.value(index - 1) : value;
        points.pushValue(x, valueToY(value), !(value < previous));
      }
    }

    jobs.push({
      kind: 'series',
      definition: this.entry.definition,
      style: styleFor(
        this.entry,
        this.entry.definition,
        this.sources,
        this.color,
        this.entry.style
      ),
      points,
      valueToY,
      bars: store,
      first: from,
      transform: null
    });
  }
}

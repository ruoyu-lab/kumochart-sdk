import { checkStyleColors } from '../canvas/color';
import type { BarStore } from '../data/bar-store';
import type { BarInput, ValuePointInput } from '../data/types';
import type { ValueStore } from '../data/value-store';
import type { Bucketer } from '../feed/calendar';
import {
  createBarFeed,
  createValueFeed,
  identityBucketer,
  type BarFeed,
  type ValueFeed
} from '../feed/aggregator';
import type { Theme } from '../options/types';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import type { Registry } from '../utils/registry';
import { checkBoolean, checkFields, checkNumber, checkString, fieldsOf } from '../utils/validate';
import type { SeriesTypeDefinition } from './types';

export type SeriesPointInput = ValuePointInput | BarInput;

export interface SeriesInput {
  /** Generated when omitted. */
  id?: string;
  /** A series type such as `line`, `area`, `columns` or `candles`. */
  type: string;
  /** `main`, `new` (a pane of its own) or the id of an existing pane. Defaults to `main`. */
  pane?: string;
  /**
   * Price scale in the pane: `right` (default), `left`, or any other name for an overlay scale
   * of its own without an axis, e.g. to compare symbols at different prices.
   */
  scale?: string;
  title?: string;
  visible?: boolean;
  /**
   * Decimals of its values in the legend and on an axis of its own, such as those of a symbol
   * compared with the bars; `null` (default) for the main series'.
   */
  precision?: number | null;
  /** A label of its latest value on the axis of its scale, in its color; off by default. */
  lastValueLabel?: boolean;
  /** Style overrides merged on top of the type's theme-derived defaults. */
  style?: Record<string, unknown>;
  data?: readonly SeriesPointInput[];
}

/** What `series.update()` changes of a series. */
export type SeriesPatch = Pick<
  SeriesInput,
  'title' | 'visible' | 'precision' | 'lastValueLabel' | 'style' | 'scale'
>;

const INPUT_FIELDS = fieldsOf<SeriesInput>({
  id: true,
  type: true,
  pane: true,
  scale: true,
  title: true,
  visible: true,
  precision: true,
  lastValueLabel: true,
  style: true,
  data: true
});
const PATCH_FIELDS = fieldsOf<SeriesPatch>({
  title: true,
  visible: true,
  precision: true,
  lastValueLabel: true,
  style: true,
  scale: true
});

/** Checks that a series is an object of the fields an input has, before its pane is placed. */
export function checkSeriesFields(input: SeriesInput): void {
  checkFields('series', input, INPUT_FIELDS);
}

/** Decimals as the price scale takes them, or `null` for the main series'. */
function checkPrecision(value: unknown): number | null {
  return value === null
    ? null
    : checkNumber('series.precision', value, { min: 0, max: 12, integer: true });
}

/** A series as reported by the API (without its data). */
export interface Series {
  readonly id: string;
  readonly type: string;
  readonly pane: string;
  readonly scale: string;
  readonly title: string;
  readonly visible: boolean;
  readonly precision: number | null;
  readonly lastValueLabel: boolean;
  readonly style: Readonly<Record<string, unknown>>;
}

export interface SeriesEntry {
  readonly id: string;
  readonly type: string;
  readonly definition: SeriesTypeDefinition<object>;
  pane: string;
  scale: string;
  title: string;
  visible: boolean;
  precision: number | null;
  lastValueLabel: boolean;
  style: Record<string, unknown>;
  /**
   * The displayed points: the source points aggregated to the chart's timeframe. Exactly one of
   * the two stores is used, depending on the definition's input.
   */
  readonly bars: BarStore | null;
  readonly values: ValueStore | null;
  /** What aggregates the source points: of bars or of values, as the definition's input is. */
  readonly source:
    | { readonly input: 'ohlc'; readonly feed: BarFeed }
    | { readonly input: 'value'; readonly feed: ValueFeed };
  /** The time of the latest trade folded into its bars; earlier ones are late. */
  latestTrade: number;
}

/** Additional series drawn next to the main bars, each with its own data. */
export class SeriesStore {
  private readonly entries = new Map<string, SeriesEntry>();
  private readonly ids: IdSequence;
  private bucketer: Bucketer = identityBucketer;
  private cutoff = Number.POSITIVE_INFINITY;

  /** `after` numbers on from the ids of the store this one stages series for. */
  constructor(
    private readonly registry: Registry<SeriesTypeDefinition<object>>,
    private readonly theme: () => Theme,
    after?: IdSequence
  ) {
    this.ids = new IdSequence((id) => this.entries.has(id), after);
  }

  /**
   * An empty store to check the series `inputs` that are to replace these, their points displayed
   * as this one displays its own: it numbers those without an id after the ids this one gave and
   * those the inputs give.
   */
  staging(inputs: readonly SeriesInput[]): SeriesStore {
    const staging = new SeriesStore(this.registry, this.theme, this.ids);
    staging.bucketer = this.bucketer;
    staging.cutoff = this.cutoff;
    staging.ids.reserve(inputs);
    return staging;
  }

  list(): SeriesEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): SeriesEntry | undefined {
    return this.entries.get(id);
  }

  require(id: string): SeriesEntry {
    return this.entries.get(id) ?? fail(`Unknown series "${id}".`);
  }

  info(entry: SeriesEntry): Series {
    return {
      id: entry.id,
      type: entry.type,
      pane: entry.pane,
      scale: entry.scale,
      title: entry.title,
      visible: entry.visible,
      precision: entry.precision,
      lastValueLabel: entry.lastValueLabel,
      style: { ...entry.style }
    };
  }

  add(input: SeriesInput, pane: string): SeriesEntry {
    const id = input.id ?? this.ids.next(input.type);
    checkString('series.id', id);
    checkString('series.type', input.type);

    if (this.entries.has(id)) {
      fail(`A series with id "${id}" already exists.`);
    }

    const definition = this.registry.require(input.type);
    // Points are displayed in the chart's timeframe however they come, as those of every series.
    const source =
      definition.input === 'ohlc'
        ? ({ input: 'ohlc', feed: createBarFeed(this.bucketer) } as const)
        : ({ input: 'value', feed: createValueFeed(this.bucketer) } as const);
    source.feed.setCutoff(this.cutoff);
    const entry: SeriesEntry = {
      id,
      type: input.type,
      definition,
      pane,
      scale: input.scale === undefined ? 'right' : checkString('series.scale', input.scale),
      title: input.title === undefined ? id : checkString('series.title', input.title),
      visible: input.visible === undefined ? true : checkBoolean('series.visible', input.visible),
      precision: input.precision === undefined ? null : checkPrecision(input.precision),
      lastValueLabel:
        input.lastValueLabel === undefined
          ? false
          : checkBoolean('series.lastValueLabel', input.lastValueLabel),
      style: input.style === undefined ? {} : this.checkStyle(definition, input.style),
      bars: source.input === 'ohlc' ? source.feed.display : null,
      values: source.input === 'value' ? source.feed.display : null,
      source,
      latestTrade: Number.NEGATIVE_INFINITY
    };

    if (input.data) {
      this.write(entry, 'set', input.data);
    }

    this.entries.set(id, entry);
    this.ids.note(id);
    return entry;
  }

  update(id: string, patch: SeriesPatch): void {
    checkFields('series patch', patch, PATCH_FIELDS);
    const entry = this.require(id);
    const title =
      patch.title === undefined ? entry.title : checkString('series.title', patch.title);
    const scale =
      patch.scale === undefined ? entry.scale : checkString('series.scale', patch.scale);
    const visible =
      patch.visible === undefined ? entry.visible : checkBoolean('series.visible', patch.visible);
    const precision =
      patch.precision === undefined ? entry.precision : checkPrecision(patch.precision);
    const lastValueLabel =
      patch.lastValueLabel === undefined
        ? entry.lastValueLabel
        : checkBoolean('series.lastValueLabel', patch.lastValueLabel);
    const style =
      patch.style === undefined
        ? entry.style
        : { ...entry.style, ...this.checkStyle(entry.definition, patch.style) };
    entry.title = title;
    entry.scale = scale;
    entry.visible = visible;
    entry.precision = precision;
    entry.lastValueLabel = lastValueLabel;
    entry.style = style;
  }

  /** A style of only the fields its type's style has; the color does not change which those are. */
  private checkStyle(
    definition: SeriesTypeDefinition<object>,
    style: Record<string, unknown>
  ): Record<string, unknown> {
    const theme = this.theme();
    checkFields('series.style', style, Object.keys(definition.defaultStyle(theme, theme.text)));
    checkStyleColors('series.style', style);
    return { ...style };
  }

  move(id: string, pane: string): void {
    this.require(id).pane = pane;
  }

  remove(id: string): SeriesEntry {
    const entry = this.require(id);
    this.entries.delete(id);
    return entry;
  }

  /** Takes over the series of a staging store checked in full. */
  adopt(staging: SeriesStore): void {
    this.entries.clear();
    staging.entries.forEach((entry, id) => {
      this.entries.set(id, entry);
      this.ids.note(id);
    });
  }

  /** Validates and applies new source points; they are displayed in the chart's timeframe. */
  write(
    entry: SeriesEntry,
    mode: 'set' | 'update' | 'prepend',
    data: readonly SeriesPointInput[]
  ): void {
    const { source } = entry;

    if (source.input === 'ohlc') {
      planWrite(source.feed, mode, data as readonly BarInput[], this.bucketer)();
    } else {
      const values = data.map((point, index) => {
        if (typeof point !== 'object' || (point as unknown) === null || !('value' in point)) {
          fail(
            `Series "${entry.id}" of type "${entry.type}" needs { time, value } points (points[${index}]).`
          );
        }

        return point;
      });
      planWrite(source.feed, mode, values, this.bucketer)();
    }

    // New points of the series are what later trades go after.
    if (mode === 'set') {
      entry.latestTrade = Number.NEGATIVE_INFINITY;
    }
  }

  /** Validates bucketing every series with `bucketer`; returns the function that applies it. */
  planRebucket(bucketer: Bucketer): () => void {
    const commits = this.list().map((entry) => entry.source.feed.planRebucket(bucketer));

    return () => {
      commits.forEach((commit) => {
        commit();
      });
      this.bucketer = bucketer;
    };
  }

  /** Hides the source points after `time` in every series (`Infinity` shows all). */
  setCutoff(time: number): void {
    this.cutoff = time;

    for (const entry of this.entries.values()) {
      entry.source.feed.setCutoff(time);
    }
  }
}

/** The feed of a series type's input, as the feed of bars or of values and as either. */
function planWrite<Input>(
  feed: {
    planSet(inputs: readonly Input[], bucketer: Bucketer): () => void;
    planUpdate(inputs: readonly Input[]): () => void;
    planPrepend(inputs: readonly Input[]): { commit: () => void };
  },
  mode: 'set' | 'update' | 'prepend',
  data: readonly Input[],
  bucketer: Bucketer
): () => void {
  if (mode === 'set') {
    return feed.planSet(data, bucketer);
  }

  return mode === 'update' ? feed.planUpdate(data) : feed.planPrepend(data).commit;
}

import { checkColor } from '../canvas/color';
import type { PriceSource } from '../data/types';
import { formatInterval, sameInterval, type Interval, type IntervalInput } from '../feed/interval';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import type { Registry } from '../utils/registry';
import { checkBoolean, checkObject, checkString } from '../utils/validate';
import {
  byOutput,
  checkLevels,
  checkSource,
  checkStyle,
  parseSettings,
  parseTimeframe,
  resolveSettings
} from './input';
import type { IndicatorBases } from './basis';
import { IndicatorSeries, type Upstream } from './instance';
import type {
  Indicator,
  IndicatorDefinition,
  IndicatorFill,
  IndicatorInput,
  IndicatorOutput,
  IndicatorOutputStyle,
  IndicatorPatch,
  IndicatorReference,
  ParamValues
} from './types';

export interface IndicatorEntry {
  readonly id: string;
  readonly type: string;
  readonly definition: IndicatorDefinition;
  params: ParamValues;
  pane: string;
  scale: string;
  source: PriceSource | IndicatorReference;
  /** The indicator whose output this one reads, when its source is an indicator. */
  upstream: IndicatorEntry | null;
  /**
   * The timeframe it is computed in when its source is a price, `null` for the chart's bars; one
   * reading an indicator is computed in that one's, as {@link timeframeOf} gives it.
   */
  timeframe: Interval | null;
  visible: boolean;
  colors: Record<string, string>;
  styles: Record<string, IndicatorOutputStyle>;
  /** Reference lines in place of the type's, or `null` for the type's. */
  levels: readonly number[] | null;
  outputs: readonly IndicatorOutput[];
  /** The shades between outputs the parameters make. */
  fills: readonly IndicatorFill[];
  series: IndicatorSeries;
}

/** The timeframe an indicator is computed in: its own, or that of the indicator it reads. */
export function timeframeOf(entry: IndicatorEntry): Interval | null {
  return entry.upstream ? timeframeOf(entry.upstream) : entry.timeframe;
}

/** A timeframe in a message: its shorthand quoted, or `null`. */
function named(timeframe: Interval | null): string {
  return timeframe ? JSON.stringify(formatInterval(timeframe)) : 'null';
}

/** Reads output `key` (or the first output) of `entry`, whichever calculation it holds now. */
function upstreamOf(entry: IndicatorEntry, key: string | undefined): Upstream {
  return () => ({
    series: entry.series,
    column: key === undefined ? 0 : entry.outputs.findIndex((output) => output.key === key)
  });
}

/** The indicators of a chart and their computed values. */
export class IndicatorStore {
  private readonly entries = new Map<string, IndicatorEntry>();
  private readonly ids: IdSequence;

  /** `after` numbers on from the ids of the store this one stages indicators for. */
  constructor(
    /** The bars the indicators are computed on, shared with the stores staging indicators. */
    private readonly bases: IndicatorBases,
    readonly registry: Registry<IndicatorDefinition>,
    after?: IdSequence
  ) {
    this.ids = new IdSequence((id) => this.entries.has(id), after);
  }

  /**
   * An empty store to check the indicators `inputs` that are to replace these: it numbers those
   * without an id after the ids this one gave and those the inputs give.
   */
  staging(inputs: readonly IndicatorInput[]): IndicatorStore {
    const staging = new IndicatorStore(this.bases, this.registry, this.ids);
    staging.ids.reserve(inputs);
    return staging;
  }

  list(): IndicatorEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): IndicatorEntry | undefined {
    return this.entries.get(id);
  }

  require(id: string): IndicatorEntry {
    return this.entries.get(id) ?? fail(`Unknown indicator "${id}".`);
  }

  info(entry: IndicatorEntry): Indicator {
    const timeframe = timeframeOf(entry);
    return {
      id: entry.id,
      type: entry.type,
      params: structuredClone(entry.params),
      pane: entry.pane,
      scale: entry.scale,
      source: typeof entry.source === 'string' ? entry.source : { ...entry.source },
      timeframe: timeframe ? formatInterval(timeframe) : null,
      visible: entry.visible,
      colors: { ...entry.colors },
      styles: structuredClone(entry.styles),
      levels: entry.levels === null ? null : [...entry.levels]
    };
  }

  /**
   * Default pane of a type: `new` for oscillators; overlays go to the main pane, or to the pane
   * of the indicator they read.
   */
  defaultPane(type: string, source: IndicatorInput['source']): string {
    const placement = this.registry.require(type).pane;
    const upstream =
      typeof source === 'object' && placement === 'main' ? this.entries.get(source.id) : undefined;
    return upstream?.pane ?? placement;
  }

  /** Parses a source: a price field, or an output of an existing indicator. */
  private parseSource(
    source: IndicatorInput['source'],
    self: string | null
  ): { source: IndicatorEntry['source']; upstream: IndicatorEntry | null } {
    if (source === undefined) {
      return { source: 'close', upstream: null };
    }

    const checked = checkSource(source);

    if (typeof checked === 'string') {
      return { source: checked, upstream: null };
    }

    const { id, key } = checked;
    const upstream = this.entries.get(id) ?? fail(`indicator.source: unknown indicator "${id}".`);

    if (key !== undefined && !upstream.outputs.some((output) => output.key === key)) {
      fail(`indicator.source: indicator "${id}" has no output "${key}".`);
    }

    // An indicator cannot read itself, directly or through others.
    for (let entry: IndicatorEntry | null = upstream; entry; entry = entry.upstream) {
      if (entry.id === self) {
        fail(`indicator.source: "${id}" reads "${self}", so "${self}" cannot read it.`);
      }
    }

    return {
      source: { kind: 'indicator', id: upstream.id, ...(key === undefined ? {} : { key }) },
      upstream
    };
  }

  /**
   * The timeframe of an indicator reading a price: the one given, else `kept`. One reading an
   * indicator is computed in that one's timeframe, which one given must be.
   */
  private parseTimeframe(
    given: IntervalInput | null | undefined,
    upstream: IndicatorEntry | null,
    kept: Interval | null
  ): Interval | null {
    const timeframe = given === undefined ? undefined : parseTimeframe(given);

    if (!upstream) {
      return timeframe === undefined ? kept : timeframe;
    }

    const theirs = timeframeOf(upstream);

    if (timeframe !== undefined && !sameInterval(timeframe, theirs)) {
      fail(
        `indicator.timeframe must be ${named(theirs)}, the timeframe of the indicator "${upstream.id}" it reads, received ${named(timeframe)}.`
      );
    }

    return null;
  }

  /** Lets go of the bars of the timeframes no indicator is computed in any longer. */
  private release(): void {
    this.bases.keep(this.list().map((entry) => entry.timeframe));
  }

  /** Ids of the indicators that read `id`. */
  dependents(id: string): string[] {
    return this.list()
      .filter((entry) => entry.upstream?.id === id)
      .map((entry) => entry.id);
  }

  private series(
    definition: IndicatorDefinition,
    params: ParamValues,
    outputs: readonly IndicatorOutput[],
    source: IndicatorEntry['source'],
    upstream: IndicatorEntry | null,
    timeframe: Interval | null
  ): IndicatorSeries {
    const input =
      upstream && typeof source !== 'string'
        ? upstreamOf(upstream, source.key)
        : (source as PriceSource);
    return new IndicatorSeries(definition, params, outputs, input, this.bases.of(timeframe));
  }

  add(input: IndicatorInput, pane: string): IndicatorEntry {
    checkString('indicator.type', input.type);
    const definition = this.registry.require(input.type);

    if (input.id !== undefined && this.entries.has(checkString('indicator.id', input.id))) {
      fail(`An indicator with id "${input.id}" already exists.`);
    }

    const settings = parseSettings(definition, input);
    const { params, outputs } = settings;
    // Nothing reads an indicator not added yet, so its source makes no loop.
    const { source, upstream } = this.parseSource(input.source ?? definition.source, null);
    const timeframe = this.parseTimeframe(input.timeframe, upstream, null);
    const scale =
      input.scale !== undefined
        ? checkString('indicator.scale', input.scale)
        : upstream && upstream.pane === pane
          ? upstream.scale
          : 'right';
    const id = input.id ?? this.ids.next(input.type.toLowerCase());
    const entry: IndicatorEntry = {
      id,
      type: input.type,
      definition,
      pane,
      scale,
      source,
      upstream,
      timeframe,
      ...settings,
      series: this.series(definition, params, outputs, source, upstream, timeframe)
    };
    this.entries.set(id, entry);
    this.ids.note(id);
    return entry;
  }

  /**
   * Updates an indicator of a patch checked for its fields; `checkOutputs` may reject the new
   * output keys before anything changes. Its pane is the chart's to move.
   */
  update(id: string, patch: IndicatorPatch, checkKeys: (keys: readonly string[]) => void): void {
    const entry = this.require(id);

    if (patch.params !== undefined) {
      checkObject('params', patch.params);
    }

    const { params, outputs, fills } =
      patch.params === undefined
        ? entry
        : resolveSettings(entry.definition, { ...entry.params, ...patch.params }, entry.type);
    const { source, upstream } =
      patch.source === undefined
        ? { source: entry.source, upstream: entry.upstream }
        : this.parseSource(patch.source, id);
    const timeframe = this.parseTimeframe(patch.timeframe, upstream, timeframeOf(entry));
    const keys = outputs.map((output) => output.key);

    for (const dependent of this.list()) {
      if (
        dependent.upstream === entry &&
        typeof dependent.source !== 'string' &&
        dependent.source.key !== undefined &&
        !keys.includes(dependent.source.key)
      ) {
        fail(
          `Indicator "${id}" would no longer produce "${dependent.source.key}", which indicator "${dependent.id}" reads.`
        );
      }
    }

    checkKeys(keys);
    const colors = byOutput(entry.type, entry.colors, patch.colors, outputs, 'colors', checkColor);
    const styles = byOutput(entry.type, entry.styles, patch.styles, outputs, 'styles', checkStyle);
    const levels =
      patch.levels === undefined
        ? entry.levels
        : patch.levels === null
          ? null
          : checkLevels(patch.levels);
    const visible =
      patch.visible === undefined
        ? entry.visible
        : checkBoolean('indicator.visible', patch.visible);
    const scale =
      patch.scale === undefined ? entry.scale : checkString('indicator.scale', patch.scale);

    if (patch.params !== undefined || patch.source !== undefined || patch.timeframe !== undefined) {
      entry.series = this.series(entry.definition, params, outputs, source, upstream, timeframe);
    }

    entry.params = params;
    entry.source = source;
    entry.upstream = upstream;
    entry.timeframe = timeframe;
    entry.outputs = outputs;
    entry.fills = fills;
    entry.colors = colors;
    entry.styles = styles;
    entry.levels = levels;
    entry.visible = visible;
    entry.scale = scale;
    this.release();
  }

  move(id: string, pane: string): void {
    this.require(id).pane = pane;
  }

  remove(id: string): IndicatorEntry {
    const entry = this.require(id);
    const dependents = this.dependents(id);

    if (dependents.length > 0) {
      fail(
        `Indicator "${id}" is read by the indicators ${dependents.map((dependent) => `"${dependent}"`).join(', ')}; remove them first.`
      );
    }

    this.entries.delete(id);
    this.release();
    return entry;
  }

  /** Takes over the indicators of a fully validated staging store. */
  adopt(staging: IndicatorStore): void {
    this.entries.clear();
    staging.entries.forEach((entry, id) => {
      this.entries.set(id, entry);
      this.ids.note(id);
    });
    this.release();
  }
}

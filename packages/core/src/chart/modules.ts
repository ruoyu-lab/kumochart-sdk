import type { OptionsSection } from '../options/resolve';
import { fail } from '../utils/errors';
import { checkFields, checkObject, checkString } from '../utils/validate';
import type { ChartCore } from './chart-core';
import type { Chart } from './create-chart';

/**
 * What a module adds to the chart's types: namespaces of the API, options, events, and what it
 * keeps of the chart's layout in a saved state.
 */
export interface ModuleTypes {
  readonly api?: object;
  readonly options?: object;
  readonly events?: object;
  readonly state?: object;
}

/**
 * A part of the chart beyond its core, such as indicators or drawings, given to
 * `createChart(container, { modules })`. Each module adds its namespace to the chart, e.g.
 * `chart.indicators`, and may add options and events.
 */
export interface ChartModule<Types extends ModuleTypes = ModuleTypes> {
  /** Unique among the modules of a chart, such as `indicators`. */
  readonly name: string;
  /** What the module adds, for the chart's types only: never set. */
  readonly '~types'?: Types;
}

/** The options a module adds to the chart's, as a section of them: `options.<key>`. */
export interface ModuleOptions<Key extends string = string, Section extends object = object> {
  readonly key: Key;
  /** The section's defaults, which the options given are merged over. */
  defaults(): Section;
  /** Throws for an invalid section, as merged; `label` names it, e.g. `options.footprint`. */
  validate(section: Section, label: string): void;
}

/** A part of a chart's saved layout that a module keeps: `saveState()[key]`. */
export interface ModuleStatePart<Key extends string = string, State = unknown> {
  readonly key: Key;
  /** What the module keeps now, as plain data. */
  save(): State;
  /** The part of a state to load, checked: throws for an invalid one, and changes nothing. */
  read(saved: unknown, label: string): State;
  /** Applies a part `read` gave, or `null` for a state without one. */
  load(state: State | null): void;
}

/** What any module may add, as the chart takes a module's options, events and state. */
export interface AnyModuleTypes {
  readonly api: object;
  readonly options: Readonly<Record<string, object>>;
  readonly events: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, object>>;
}
/** The section of options a module of `Types` may add. */
export type ModuleOptionsOf<Types extends ModuleTypes> = {
  [K in keyof NonNullable<Types['options']> & string]: ModuleOptions<
    K,
    NonNullable<Types['options']>[K] & object
  >;
}[keyof NonNullable<Types['options']> & string];

/** What a module made with `createModule()` gets, beside the chart, as it joins one. */
export interface ModuleContext<Types extends ModuleTypes = ModuleTypes> {
  /** The module's section of the chart's options, as they are now; a module without one throws. */
  options(): NonNullable<Types['options']>[keyof NonNullable<Types['options']>];
  /** Emits one of the module's events to the listeners `chart.on()` registers. */
  emit<K extends keyof NonNullable<Types['events']> & string>(
    type: K,
    event: NonNullable<Types['events']>[K]
  ): void;
  /** Keeps a part of the chart's layout in its saved state, which `loadState()` brings back. */
  keepState<K extends keyof NonNullable<Types['state']> & string>(
    part: ModuleStatePart<K, NonNullable<NonNullable<Types['state']>[K]>>
  ): void;
}

/** A module of an application or another package, as `createModule()` takes it. */
export interface ModuleDefinition<
  Types extends ModuleTypes = ModuleTypes,
  Api extends object = NonNullable<Types['api']>
> {
  /** Unique among the modules of a chart. */
  readonly name: string;
  readonly options?: ModuleOptionsOf<Types>;
  /**
   * Joins the chart once the chart and the SDK's modules given with it are there, before the
   * chart uses its options; returns the namespaces the module adds, or nothing.
   */
  install(chart: Chart, context: ModuleContext<Types>): Api | undefined;
}

/** How a module joins a chart. */
export interface ModuleSpec {
  readonly name: string;
  readonly options?: OptionsSection;
  /**
   * A module of the SDK: joins the core before anything uses it, registering its types, hooks
   * and objects, and returns the namespaces it adds to the chart's API.
   */
  install?(core: ChartCore): Readonly<Record<string, object>>;
  /**
   * A module of an application or another package: joins the chart through its API once the
   * chart and the SDK's modules are there, and returns the namespaces it adds.
   */
  extend?(chart: Chart, context: ModuleContext<AnyModuleTypes>): object;
}

const specs = new WeakMap<ChartModule, ModuleSpec>();

/** Makes a module from how it joins a chart. */
export function defineModule<Types extends ModuleTypes>(spec: ModuleSpec): ChartModule<Types> {
  const module: ChartModule<Types> = Object.freeze({ name: spec.name });
  specs.set(module, spec);
  return module;
}

/**
 * A module of an application or another package, such as one registering its own indicator or
 * drawing types: `install` runs on the chart once the chart and the SDK's modules given with it
 * are there, before the chart uses its options, so the options can use the types it registers.
 * What it returns joins the chart as namespaces, e.g. `{ footprint: footprintApi }` becomes
 * `chart.footprint`. A module may add a section of options, emit events of its own and keep a
 * part of the saved state; `Types` says what it adds, as `ChartModule<Types>` does. Without
 * `Types`, the namespaces are those `install` returns.
 *
 * ```ts
 * interface StampTypes {
 *   api: { stamp: { count(): number } };
 *   options: { stamp: { text: string } };
 *   events: { stampChange: { text: string } };
 * }
 *
 * const stamp = createModule<StampTypes>({
 *   name: 'stamp',
 *   options: { key: 'stamp', defaults: () => ({ text: '' }), validate: () => {} },
 *   install: (chart, context) => {
 *     chart.on('optionsChange', ({ options, previous }) => {
 *       if (options.stamp.text !== previous.stamp.text) {
 *         context.emit('stampChange', { text: context.options().text });
 *       }
 *     });
 *     return { stamp: { count: () => context.options().text.length } };
 *   }
 * });
 * ```
 */
export function createModule<
  Types extends ModuleTypes = ModuleTypes,
  Api extends object = NonNullable<Types['api']>
>(definition: ModuleDefinition<Types, Api>): ChartModule<Types & { readonly api: Api }> {
  checkObject('module definition', definition);
  const { name, options } = definition;

  if (typeof name !== 'string' || name === '') {
    fail('createModule() needs the name of the module.');
  }

  if (typeof definition.install !== 'function') {
    fail(`The module "${name}" needs an install() function.`);
  }

  if (options !== undefined) {
    checkFields(`The options of the module "${name}"`, options, ['key', 'defaults', 'validate']);
    checkString(`The options key of the module "${name}"`, options.key);

    if (typeof options.defaults !== 'function' || typeof options.validate !== 'function') {
      fail(`The options of the module "${name}" need defaults() and validate().`);
    }
  }

  return defineModule<Types & { readonly api: Api }>({
    name,
    ...(options === undefined ? {} : { options }),
    extend: (chart, context) =>
      definition.install(chart, context as unknown as ModuleContext<Types>) ?? {}
  });
}

/** The specs of the modules given to a chart, checked and in order. */
export function moduleSpecs(modules: readonly ChartModule[]): ModuleSpec[] {
  // Checked at runtime: the modules may come from plain JavaScript.
  const given: unknown = modules;

  if (!Array.isArray(given)) {
    fail('options.modules must be an array of modules, such as [indicators(allIndicators)].');
  }

  const names = new Set<string>();

  return modules.map((module, index) => {
    const spec =
      specs.get(module) ??
      fail(`options.modules[${index}] is not a module, such as indicators(allIndicators).`);

    if (names.has(spec.name)) {
      fail(`The ${spec.name} module is given twice.`);
    }

    names.add(spec.name);
    return spec;
  });
}

/**
 * What the modules add to the chart, merged: their API, options, events and saved state. The
 * union of what each adds becomes an intersection through the parameter of a function type.
 */
export type ModulesTypes<M extends readonly ChartModule[]> = (
  NonNullable<M[number]['~types']> extends infer T
    ? T extends unknown
      ? (value: T) => void
      : never
    : never
) extends (value: infer I) => void
  ? I
  : never;

/** The namespaces the modules add to the chart. */
export type ModulesApi<M extends readonly ChartModule[]> =
  ModulesTypes<M> extends { readonly api: infer A } ? A : unknown;

/** The options the modules add to the chart's. */
export type ModulesOptions<M extends readonly ChartModule[]> =
  ModulesTypes<M> extends { readonly options: infer O } ? O : unknown;

/** The events the modules add to the chart's. */
export type ModulesEvents<M extends readonly ChartModule[]> =
  ModulesTypes<M> extends { readonly events: infer E } ? E : unknown;

/** What the modules keep in the chart's saved state. */
export type ModulesState<M extends readonly ChartModule[]> =
  ModulesTypes<M> extends { readonly state: infer S } ? S : unknown;

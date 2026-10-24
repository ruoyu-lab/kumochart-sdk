import { toTime, type TimeInput } from '../data/time';
import type { Unsubscribe } from '../events/event-bus';
import type { ChartOptionsInput } from '../options/resolve';
import { chartLayout, type Layout } from '../layout/layout';
import type { ChartOptions } from '../options/types';
import { MAIN_PANE_ID, RIGHT_SCALE } from '../panes/pane-store';
import { fail } from '../utils/errors';
import { checkFields, checkNumber, checkOneOf, checkString, fieldsOf } from '../utils/validate';
import { isPlainObject, type DeepPartial } from '../utils/merge';
import { createDataApi, type DataApi } from './api/data';
import {
  createPanesApi,
  createPriceScaleApi,
  type PanesApi,
  type PriceScaleApi
} from './api/panes';
import { createSeriesApi, type SeriesApi } from './api/series';
import { createTimeScaleApi, type TimeScaleApi } from './api/time-scale';
import { createTransformsApi, type TransformsApi } from './api/transforms';
import { ChartCore } from './chart-core';
import type { CrosshairState } from './cursor';
import type { ChartPlugin } from './plugins';
import { assertEnvironment } from './environment';
import { CORE_STATE_KEYS, loadState, saveState, type ChartState } from './state';
import type { Selection } from '../objects/types';
import type { ChartEventMap } from './events';
import {
  moduleSpecs,
  type AnyModuleTypes,
  type ChartModule,
  type ModuleContext,
  type ModuleSpec,
  type ModulesApi,
  type ModulesEvents,
  type ModulesOptions,
  type ModulesState
} from './modules';

export interface CrosshairApi {
  /** Where the crosshair is, or `null` while it is hidden. */
  get(): CrosshairState | null;
  /**
   * Shows the crosshair at a time (and optionally a value of a pane) without a pointer, for
   * example to mirror another chart, or hides it with `null`. Pointer movement takes over again.
   */
  set(position: { time: TimeInput; price?: number; pane?: string } | null): void;
}

const POSITION_FIELDS = fieldsOf<NonNullable<Parameters<CrosshairApi['set']>[0]>>({
  time: true,
  price: true,
  pane: true
});

export interface PluginsApi {
  /** Attaches a plugin; its name must be unique. */
  add(plugin: ChartPlugin): void;
  /** Detaches a plugin. */
  remove(name: string): void;
  /** The plugin of a name, or `null`. */
  get(name: string): ChartPlugin | null;
  /** The plugins, in the order they paint. */
  list(): ChartPlugin[];
}

/** The chart without the namespaces of its modules, which `Chart` adds. */
export interface ChartBase<Options = unknown, Events = unknown, State = unknown> {
  /** The element the chart created inside its container. */
  readonly element: HTMLElement;
  /** The resolved options. */
  options(): Readonly<ChartOptions & Options>;
  /** Deep-merges option changes; arrays and functions are replaced. */
  applyOptions(options: DeepPartial<ChartOptions & Options>): void;
  /** Rectangles of the panes, the price axis and the time axis, for positioning custom overlays. */
  layout(): Layout;
  /** Sets the size in CSS pixels; with `autoSize` the container size wins on its next change. */
  resize(width: number, height: number): void;
  /** Runs several API calls and dispatches their events once afterwards. */
  batch(operation: () => void): void;
  on<K extends keyof (ChartEventMap & Events)>(
    type: K,
    listener: (event: (ChartEventMap & Events)[K]) => void
  ): Unsubscribe;
  readonly data: DataApi;
  readonly transforms: TransformsApi;
  readonly timeScale: TimeScaleApi;
  /**
   * A price scale of a pane (default: the main pane): `right` (default), `left`, or an overlay
   * scale named by the series and indicators placed on it.
   */
  priceScale(paneId?: string, scaleId?: string): PriceScaleApi;
  readonly panes: PanesApi;
  readonly series: SeriesApi;
  readonly crosshair: CrosshairApi;
  readonly plugins: PluginsApi;
  /** The names of the chart's modules, in the order they were given. */
  modules(): string[];
  /** Selects a drawing, order, alert or marker, or clears the selection with `null`. */
  select(selection: Selection | null): void;
  /** The selected object, or `null`. */
  selection(): Selection | null;
  /** The user-editable layout: main series type, view, panes, and what the modules keep. */
  saveState(): ChartState & State;
  /** Restores a saved layout atomically; an invalid state throws and changes nothing. */
  loadState(state: ChartState): void;
  /** Renders pending changes and returns a canvas with the whole chart. */
  screenshot(): HTMLCanvasElement;
  /**
   * Removes the chart's element and releases every listener, observer and timer. Every other
   * call on the chart throws afterwards, a read as well as a change; calling it again does
   * nothing.
   */
  destroy(): void;
}

/**
 * A chart with the modules `M`, such as `Chart<[typeof indicators]>`: the core and the namespaces,
 * options and events of the modules. `Chart` alone is the chart without modules, which every
 * chart is.
 */
export type Chart<M extends readonly ChartModule[] = readonly []> = ChartBase<
  ModulesOptions<M>,
  ModulesEvents<M>,
  ModulesState<M>
> &
  ModulesApi<M>;

/** What `createChart()` takes: the modules of the chart, and its options. */
export type CreateChartOptions<M extends readonly ChartModule[]> = DeepPartial<
  ChartOptions & ModulesOptions<M>
> & {
  /** The parts of the chart beyond its core, such as `indicators(allIndicators)`. */
  readonly modules?: M;
};

/**
 * Makes each method and getter of `api`, but those `kept`, and of its namespaces with `nested`, a
 * chart operation: the events it emits, such as those of a frame a read builds, are dispatched
 * once it returns, and a destroyed chart throws for it, for a read as for a change.
 */
function asOperations<T extends object>(
  core: ChartCore,
  api: T,
  nested: boolean,
  kept: readonly string[] = []
): T {
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(api))) {
    const read = descriptor.get?.bind(api);
    const value: unknown = descriptor.value;

    if (kept.includes(key)) {
      continue;
    }

    if (read) {
      Object.defineProperty(api, key, { ...descriptor, get: () => core.run(read) as unknown });
    } else if (typeof value === 'function') {
      const method = value as (...args: unknown[]) => unknown;
      Object.defineProperty(api, key, {
        ...descriptor,
        value: (...args: unknown[]) => core.run(() => method.apply(api, args))
      });
    } else if (nested && isPlainObject(value)) {
      asOperations(core, value, false);
    }
  }

  return api;
}

/** What a module of an application gets beside the chart: its options, events and state. */
function moduleContext(core: ChartCore, spec: ModuleSpec): ModuleContext<AnyModuleTypes> {
  const section = spec.options;
  const events = core.events<Record<string, unknown>>();
  return {
    options: () =>
      section
        ? ((core.options as unknown as Record<string, unknown>)[section.key] as never)
        : fail(`The ${spec.name} module has no options.`),
    emit: (type, event) => {
      events.emit(type, event);
    },
    keepState: (part) => {
      checkFields(`The state part of the ${spec.name} module`, part, [
        'key',
        'save',
        'read',
        'load'
      ]);
      const { key } = part;
      checkString(`The state key of the ${spec.name} module`, key);

      if (CORE_STATE_KEYS.includes(key) || core.stateParts.some((kept) => kept.key === key)) {
        fail(`The ${spec.name} module keeps "${key}" of the state, which the chart keeps already.`);
      }

      core.stateParts.push({
        key,
        save: () => part.save(),
        prepare: (saved) => {
          const state = saved === undefined ? null : part.read(saved, `state.${key}`);
          return {
            apply: () => {
              part.load(state);
            }
          };
        }
      });
    }
  };
}

/**
 * Creates a chart inside `container` with the given modules. The chart fills the container and
 * follows its size unless `autoSize` is off.
 *
 * ```ts
 * const chart = createChart(document.getElementById('chart')!, {
 *   modules: [indicators(allIndicators)],
 *   locale: 'zh-CN'
 * });
 * chart.data.set(bars);
 * chart.indicators.add({ type: 'MACD' });
 * ```
 */
export function createChart<const M extends readonly ChartModule[] = readonly []>(
  container: HTMLElement,
  options?: CreateChartOptions<M>
): Chart<M> {
  const view = assertEnvironment(container);
  const { modules = [], ...rest } = options ?? {};
  const specs = moduleSpecs(modules);
  const core: ChartCore = new ChartCore(
    view,
    container,
    rest as ChartOptionsInput,
    specs,
    () => chart
  );
  const priceScales = new Map<string, PriceScaleApi>();

  const chart: Chart = {
    element: core.surface.root,
    options: () => core.options,
    applyOptions: (patch) => {
      core.run(() => {
        core.applyOptions(patch);
      });
    },
    layout: () => chartLayout(core.frame().layout),
    resize: (width, height) => {
      checkNumber('width', width, { min: 0 });
      checkNumber('height', height, { min: 0 });
      core.run(() => {
        core.resize(width, height);
      });
    },
    batch: (operation) => {
      core.run(operation);
    },
    on: (type, listener) => core.bus.on(type, listener),
    data: createDataApi(core),
    transforms: createTransformsApi(core),
    timeScale: createTimeScaleApi(core),
    priceScale: (paneId = MAIN_PANE_ID, scaleId = RIGHT_SCALE) => {
      core.panes.require(paneId);
      checkString('scale id', scaleId);
      const key = `${paneId}\u0000${scaleId}`;
      let api = priceScales.get(key);

      if (!api) {
        api = asOperations(core, createPriceScaleApi(core, paneId, scaleId), false);
        priceScales.set(key, api);
      }

      return api;
    },
    panes: createPanesApi(core),
    series: createSeriesApi(core),
    crosshair: {
      get: () => {
        const crosshair = core.crosshair;
        return crosshair && { ...crosshair, x: crosshair.x + core.frame().layout.leftAxisWidth };
      },
      set: (position) => {
        core.run(() => {
          if (position === null) {
            core.setExternalCrosshair(null);
            return;
          }

          checkFields('crosshair position', position, POSITION_FIELDS);
          const { time, price, pane = MAIN_PANE_ID } = position;
          core.panes.require(pane);
          core.setExternalCrosshair({
            time: toTime(time),
            price: price === undefined ? null : checkNumber('price', price),
            paneId: pane
          });
        });
      }
    },
    modules: () => specs.map((spec) => spec.name),
    select: (selection) => {
      core.run(() => {
        if (selection !== null) {
          checkOneOf('selection.kind', selection.kind, core.objects.kinds());
          checkString('selection.id', selection.id);

          if (!core.objects.exists(selection)) {
            fail(`There is no ${selection.kind} with id "${selection.id}".`);
          }
        }

        core.select(selection);
      });
    },
    selection: () => core.objects.selection,
    saveState: () => saveState(core),
    loadState: (state) => {
      core.run(() => {
        loadState(core, state);
      });
    },
    screenshot: () =>
      core.run(() => {
        core.flush();
        return core.surface.composite();
      }),
    plugins: {
      add: (plugin) => {
        core.run(() => {
          core.plugins.add(plugin);
        });
      },
      remove: (name) => {
        core.run(() => {
          core.plugins.remove(name);
        });
      },
      get: (name) => core.plugins.get(name),
      list: () => core.plugins.list()
    },
    destroy: () => {
      core.destroy();
    }
  };
  Object.assign(chart, core.moduleApis);
  // Destroying a destroyed chart does nothing.
  asOperations(core, chart, true, ['destroy']);

  try {
    for (const spec of specs) {
      for (const [name, api] of Object.entries(
        spec.extend?.(chart, moduleContext(core, spec)) ?? {}
      )) {
        if (Object.hasOwn(chart, name)) {
          fail(`The ${spec.name} module adds chart.${name}, which the chart has already.`);
        }

        Object.assign(chart, { [name]: api as unknown });
      }
    }

    // The modules may bring the main series' type.
    core.seriesTypes.require(core.options.mainSeries.type);
  } catch (error) {
    core.destroy();
    throw error;
  }

  return chart as Chart<M>;
}

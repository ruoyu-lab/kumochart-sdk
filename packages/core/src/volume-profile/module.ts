import type { ChartCore } from '../chart/chart-core';
import { defineModule, type ChartModule } from '../chart/modules';
import type { StatePart } from '../chart/state';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { checkArray } from '../utils/validate';
import { VolumeProfileStore } from './store';
import type { VolumeProfile, VolumeProfileInput } from './types';

/**
 * Volume profiles under the bars of the main pane: of the bars in view, or of each trading day.
 * They are computed from the source bars, so a daily chart of 1-minute bars puts each day's
 * volume at the prices it traded at, and only from those a running replay has revealed.
 */
export interface VolumeProfilesApi {
  /** Replaces every profile. An invalid input throws and changes nothing. */
  set(inputs: readonly VolumeProfileInput[]): void;
  /** Adds a profile and returns its id: the one it has, or one the chart numbers for it. */
  add(input: VolumeProfileInput): string;
  /** Changes a profile; what the patch leaves out stays. Throws for an unknown id. */
  update(id: string, patch: Partial<Omit<VolumeProfileInput, 'id'>>): void;
  /** Throws for an unknown id. */
  remove(id: string): void;
  /** Removes every profile. */
  clear(): void;
  /** The profile of an id, or `null`. */
  get(id: string): VolumeProfile | null;
  /** Every profile, in the order they paint. */
  list(): VolumeProfile[];
}

export type VolumeProfilesModule = ChartModule<{
  readonly api: { readonly volumeProfiles: VolumeProfilesApi };
  readonly state: { readonly volumeProfiles: readonly VolumeProfileInput[] };
}>;

/** A store of the profiles `inputs` bring in place of those of `store`, checked in full. */
function staged(
  store: VolumeProfileStore,
  inputs: readonly VolumeProfileInput[],
  label: string
): VolumeProfileStore {
  checkArray(label, inputs);
  const staging = store.staging(inputs);
  inputs.forEach((input, index) => {
    staging.add(input, `${label}[${index}]`);
  });
  return staging;
}

/** What a chart state keeps of the profiles, under `volumeProfiles`. */
function profilesState(store: VolumeProfileStore): StatePart {
  return {
    key: 'volumeProfiles',
    save: () => store.inputs(),
    prepare: (saved) => {
      const staging = staged(
        store,
        (saved ?? []) as readonly VolumeProfileInput[],
        'state.volumeProfiles'
      );
      return {
        apply: () => {
          store.adopt(staging);
        }
      };
    }
  };
}

function createApi(core: ChartCore, store: VolumeProfileStore): VolumeProfilesApi {
  const mutate = <T>(operation: () => T): T =>
    core.run(() => {
      const result = operation();
      core.invalidateLayers('scene');
      return result;
    });

  return {
    set: (inputs) => {
      mutate(() => {
        store.adopt(staged(store, inputs, 'volumeProfiles'));
      });
    },
    add: (input) => mutate(() => store.add(input)),
    update: (id, patch) => {
      mutate(() => {
        store.update(id, patch);
      });
    },
    remove: (id) => {
      mutate(() => {
        store.remove(id);
      });
    },
    clear: () => {
      mutate(() => {
        store.adopt(store.staging([]));
      });
    },
    get: (id) => store.get(id),
    list: () => store.list()
  };
}

/**
 * The volume profiles module: `chart.volumeProfiles`, the volume traded at each price of the
 * bars in view or of each trading day, under the bars of the main pane. The profiles are kept in
 * the chart's state.
 */
export function volumeProfiles(): VolumeProfilesModule {
  return defineModule({
    name: 'volumeProfiles',
    install: (core) => {
      const store = new VolumeProfileStore();
      core.scenePainters.push((ctx, frame, pane, layer) => {
        if (layer !== 'below' || pane.id !== MAIN_PANE_ID) {
          return;
        }

        const { timeScale } = core;
        ctx.save();
        store.paint(ctx, {
          bars: core.market.displayed,
          source: core.market.revealed,
          changes: core.market.feed.source,
          visible: frame.visible,
          calendar: core.market.tradingCalendar(),
          theme: core.options.theme,
          width: pane.plot.width,
          barSpacing: timeScale.barSpacing,
          indexToX: (index) => timeScale.indexToX(index),
          valueToY: (value) => pane.scale.valueToY(value)
        });
        ctx.restore();
      });
      core.stateParts.push(profilesState(store));
      return { volumeProfiles: createApi(core, store) };
    }
  });
}

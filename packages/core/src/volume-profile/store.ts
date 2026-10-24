import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import { checkFields, checkString } from '../utils/validate';
import { ProfileCache, paintChartProfile, type ProfileView } from './chart-profiles';
import { inputOf, parseProfile, PATCH_FIELDS } from './config';
import type { VolumeProfile, VolumeProfileInput } from './types';

interface ProfileEntry {
  readonly profile: VolumeProfile;
  readonly cache: ProfileCache;
}

function entryOf(profile: VolumeProfile): ProfileEntry {
  return { profile, cache: new ProfileCache(profile) };
}

/** The volume profiles of a chart, in the order they were added, which they paint in. */
export class VolumeProfileStore {
  private entries = new Map<string, ProfileEntry>();
  private readonly ids: IdSequence;

  /** `after` numbers on from the ids of the store this one stages profiles for. */
  constructor(after?: IdSequence) {
    this.ids = new IdSequence((id) => this.entries.has(id), after);
  }

  /**
   * An empty store to check the profiles `inputs` that are to replace these: it numbers those
   * without an id after the ids this one gave and those the inputs give.
   */
  staging(inputs: readonly VolumeProfileInput[]): VolumeProfileStore {
    const staging = new VolumeProfileStore(this.ids);
    staging.ids.reserve(inputs);
    return staging;
  }

  list(): VolumeProfile[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.profile }));
  }

  get(id: string): VolumeProfile | null {
    const entry = this.entries.get(id);
    return entry ? { ...entry.profile } : null;
  }

  /** The inputs that give every profile, as a chart state keeps them. */
  inputs(): VolumeProfileInput[] {
    return [...this.entries.values()].map((entry) => inputOf(entry.profile));
  }

  add(input: VolumeProfileInput, label = 'volumeProfile'): string {
    const settings = parseProfile(input, label);
    const id =
      input.id === undefined
        ? this.ids.next('volume-profile')
        : checkString(`${label}.id`, input.id);

    if (this.entries.has(id)) {
      fail(`A volume profile with id "${id}" already exists.`);
    }

    this.entries.set(id, entryOf({ id, ...settings }));
    this.ids.note(id);
    return id;
  }

  update(id: string, patch: Partial<Omit<VolumeProfileInput, 'id'>>): void {
    const entry = this.entries.get(id) ?? fail(`Unknown volume profile "${id}".`);
    checkFields('volumeProfile patch', patch, PATCH_FIELDS);
    const settings = parseProfile({ ...inputOf(entry.profile), ...patch }, 'volumeProfile');
    this.entries.set(id, entryOf({ id, ...settings }));
  }

  remove(id: string): void {
    if (!this.entries.delete(id)) {
      fail(`Unknown volume profile "${id}".`);
    }
  }

  /** Takes over the profiles of a store checked in full, such as one a chart state brought. */
  adopt(staging: VolumeProfileStore): void {
    this.entries = staging.entries;
    this.entries.forEach((_, id) => {
      this.ids.note(id);
    });
  }

  /** Paints the profiles shown under the series of the main pane. */
  paint(ctx: CanvasRenderingContext2D, view: ProfileView): void {
    this.entries.forEach(({ profile, cache }) => {
      if (profile.visible) {
        paintChartProfile(ctx, view, profile, cache);
      }
    });
  }
}

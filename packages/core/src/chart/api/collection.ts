import { fail } from '../../utils/errors';
import type { IdSequence } from '../../utils/ids';
import { checkArray, checkString } from '../../utils/validate';
import type { ChartCore } from '../chart-core';

/** Objects the application owns, kept by id: orders, markers, alerts. */
export interface Collection<Input, Item> {
  set(inputs: readonly Input[]): void;
  add(input: Input): string;
  update(id: string, patch: Partial<Omit<Input, 'id'>>): void;
  remove(id: string): void;
  get(id: string): Item | null;
  list(): Item[];
}

/** What the API offers of a collection of objects drawn on the objects layer. */
export interface CollectionApi<Input, Item> {
  /**
   * Replaces every object, e.g. with the latest state from the broker. An invalid input throws
   * and changes nothing.
   */
  set(inputs: readonly Input[]): void;
  /** Adds an object and returns its id: the one it has, or one the chart numbers for it. */
  add(input: Input): string;
  /** Changes an object; what the patch leaves out stays. Throws for an unknown id. */
  update(id: string, patch: Partial<Omit<Input, 'id'>>): void;
  /** Throws for an unknown id. */
  remove(id: string): void;
  /** Removes every object. */
  clear(): void;
  /** The object of an id, or `null`. */
  get(id: string): Item | null;
  /** Every object, in the order they were added. */
  list(): Item[];
}

/**
 * What `inputs` bring in place of every object of a collection, by id in their order: each input
 * parsed but for its id, and its id the one it gives, or the next of `prefix` after those of
 * `ids`. Every input is checked before any is numbered, and an id given twice throws; `ids` notes
 * the ids once they are all valid.
 */
export function replacement<Input extends { readonly id?: string }, Settings extends object>(
  label: string,
  inputs: readonly Input[],
  ids: IdSequence,
  prefix: string,
  parse: (input: Input, label: string) => Settings
): Map<string, Settings & { readonly id: string }> {
  checkArray(label, inputs);
  const parsed = inputs.map((input, index) => ({
    input,
    settings: parse(input, `${label}[${index}]`)
  }));
  const given = new Set<string>();

  parsed.forEach(({ input }, index) => {
    if (input.id !== undefined) {
      const id = checkString(`${label}[${index}].id`, input.id);

      if (given.has(id)) {
        fail(`${label} contains the id "${id}" twice.`);
      }

      given.add(id);
    }
  });

  // Those given go first, so that none of them is numbered for another input.
  given.forEach((id) => {
    ids.note(id);
  });
  const items = new Map<string, Settings & { readonly id: string }>();
  parsed.forEach(({ input, settings }) => {
    const id = input.id ?? ids.next(prefix);
    ids.note(id);
    items.set(id, { id, ...settings });
  });
  return items;
}

export function collectionApi<Input, Item>(
  core: ChartCore,
  collection: Collection<Input, Item>
): CollectionApi<Input, Item> {
  const mutate = <T>(operation: () => T): T =>
    core.run(() => {
      const result = operation();
      core.objects.prune();
      core.invalidateLayers('objects');
      return result;
    });

  return {
    set: (inputs) => {
      mutate(() => {
        collection.set(inputs);
      });
    },
    add: (input) => mutate(() => collection.add(input)),
    update: (id, patch) => {
      mutate(() => {
        collection.update(id, patch);
      });
    },
    remove: (id) => {
      mutate(() => {
        collection.remove(id);
      });
    },
    clear: () => {
      mutate(() => {
        collection.set([]);
      });
    },
    get: (id) => collection.get(id),
    list: () => collection.list()
  };
}

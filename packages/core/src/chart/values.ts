import type { BarStore } from '../data/bar-store';
import type { ValueAccess, ValueSource } from '../data/types';
import { MAIN_PANE_ID, RIGHT_SCALE } from '../panes/pane-store';
import type { SeriesStore } from '../series/series-store';
import { fail } from '../utils/errors';

export type ValueKind = ValueSource['kind'];

/** Reads the sources of one kind; a module provides those of its objects. */
export interface ValueReader<S extends ValueSource = ValueSource> {
  /** Throws for a source that names nothing, such as an unknown indicator or output. */
  check(source: S, label: string): void;
  /** The value at bar `index`; `NaN` where it has none. */
  read(source: S, index: number): number;
  /** The pane the source is drawn in. */
  paneOf(source: S): string;
  /** The price scale of its pane the source is drawn on; default `right`. */
  scaleOf?(source: S): string;
  /**
   * Values that move with an object the user drags, such as the lines of drawings: read where the
   * object is now at the bar before too, so moving it never counts as the value moving.
   */
  readonly movable?: boolean;
}

/** What reads values, such as alerts: which of its objects read a source. */
export interface ValueUser {
  /** The objects (e.g. alert ids) reading sources of `kind` with `id`, and the sources they read. */
  uses(
    kind: ValueKind,
    id: string
  ): ReadonlyArray<{ readonly user: string; readonly source: ValueSource }>;
  /** The values read may have changed other than by new bars: take them as they are now. */
  reset(): void;
  /** Checks the sources read against the ones a chart state is about to bring. */
  verify(check: (source: ValueSource, label: string) => void): void;
  /** What reads them, for messages, e.g. `alert`. */
  readonly noun: string;
}

/** The value sources the chart can read, by kind, and what reads them. */
export class Values implements ValueAccess {
  private readonly readers = new Map<ValueKind, ValueReader>();
  private readonly users: ValueUser[] = [];

  constructor(bars: BarStore, series: SeriesStore) {
    this.provide<Extract<ValueSource, { kind: 'price' }>>('price', {
      check: () => undefined,
      read: (source, index) => bars.price(index, source.field ?? 'close'),
      paneOf: () => MAIN_PANE_ID
    });
    this.provide<Extract<ValueSource, { kind: 'series' }>>('series', {
      check: (source) => {
        series.require(source.id);
      },
      read: (source, index) => {
        const entry = series.require(source.id);
        const store = entry.values ?? entry.bars;
        // The series point at or before the bar's time.
        const at = store ? store.lowerBound(bars.time(index) + 1) - 1 : -1;

        if (at < 0) {
          return Number.NaN;
        }

        return entry.values ? entry.values.value(at) : (entry.bars?.close(at) ?? Number.NaN);
      },
      paneOf: (source) => series.require(source.id).pane,
      scaleOf: (source) => series.require(source.id).scale
    });
  }

  provide<S extends ValueSource>(kind: S['kind'], reader: ValueReader<S>): void {
    this.readers.set(kind, reader);
  }

  use(user: ValueUser): void {
    this.users.push(user);
  }

  private reader(source: ValueSource, label: string): ValueReader {
    return (
      this.readers.get(source.kind) ??
      fail(
        `${label}: the chart has no ${source.kind} values; load the module of its ${source.kind}s.`
      )
    );
  }

  check(source: ValueSource, label: string): void {
    this.reader(source, label).check(source, label);
  }

  read(source: ValueSource, index: number): number {
    return this.reader(source, 'source').read(source, index);
  }

  paneOf(source: ValueSource): string {
    return this.reader(source, 'source').paneOf(source);
  }

  scaleOf(source: ValueSource): string {
    return this.reader(source, 'source').scaleOf?.(source) ?? RIGHT_SCALE;
  }

  movable(source: ValueSource): boolean {
    return this.readers.get(source.kind)?.movable === true;
  }

  /** The objects reading sources of `kind` with `id`. */
  uses(
    kind: ValueKind,
    id: string
  ): Array<{ readonly user: string; readonly source: ValueSource; readonly noun: string }> {
    return this.users.flatMap((user) =>
      user.uses(kind, id).map((use) => ({ ...use, noun: user.noun }))
    );
  }

  /** Fails while something reads sources of `kind` with `id`, which is about to go. */
  assertUnused(kind: ValueKind, id: string): void {
    const byNoun = new Map<string, Set<string>>();

    for (const use of this.uses(kind, id)) {
      byNoun.set(use.noun, (byNoun.get(use.noun) ?? new Set()).add(use.user));
    }

    if (byNoun.size === 0) {
      return;
    }

    const readers = [...byNoun].map(([noun, users]) => {
      const names = [...users].map((user) => `"${user}"`).join(', ');
      return users.size > 1 ? `the ${noun}s ${names}` : `${noun} ${names}`;
    });
    const many = readers.length > 1 || [...byNoun.values()].some((users) => users.size > 1);
    fail(`"${id}" is read by ${readers.join(' and ')}; remove ${many ? 'them' : 'it'} first.`);
  }

  /** The values may have changed other than by new bars: what reads them takes them as they are. */
  reset(): void {
    this.users.forEach((user) => {
      user.reset();
    });
  }

  /** Checks what reads values against the sources a chart state is about to bring. */
  verify(check: (source: ValueSource, label: string) => void): void {
    this.users.forEach((user) => {
      user.verify(check);
    });
  }
}

import type { ValueReader } from '../chart/values';
import type { ValueSource } from '../data/types';
import { fail } from '../utils/errors';
import type { IndicatorEntry, IndicatorStore } from './indicator-store';

type IndicatorSource = Extract<ValueSource, { kind: 'indicator' }>;

function columnOf(entry: IndicatorEntry, key: string | undefined): number {
  return key === undefined ? 0 : entry.outputs.findIndex((output) => output.key === key);
}

/** Checks that `store` has the indicator and output a source reads. */
export function checkSource(store: IndicatorStore, source: IndicatorSource, label: string): void {
  const entry = store.get(source.id) ?? fail(`${label}: unknown indicator "${source.id}".`);

  if (columnOf(entry, source.key) < 0) {
    fail(`${label}: indicator "${source.id}" has no output "${String(source.key)}".`);
  }
}

/** The values of the outputs of the indicators of `store`, as they are drawn. */
export function indicatorValues(store: IndicatorStore): ValueReader<IndicatorSource> {
  return {
    check: (source, label) => {
      checkSource(store, source, label);
    },
    read: (source, index) => {
      const entry = store.require(source.id);
      entry.series.sync();
      return entry.series.drawn(columnOf(entry, source.key), index);
    },
    paneOf: (source) => store.require(source.id).pane,
    scaleOf: (source) => store.require(source.id).scale
  };
}

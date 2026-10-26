import { describe, expect, it } from 'vitest';
import { BarStore, parseBar } from '../../src/data/bar-store';
import type { BarInput } from '../../src/data/types';
import { createBarFeed, identityBucketer } from '../../src/feed/aggregator';
import { ChartError } from '../../src/utils/errors';
import { createBars, MINUTE, T0 } from '../helpers/bars';

/** A feed showing `bars` as given, which writes the bars of a store as the chart does. */
function feedOf(bars: readonly BarInput[]) {
  const feed = createBarFeed(identityBucketer);
  feed.planSet(bars, identityBucketer)();
  return {
    store: feed.display,
    update: (inputs: readonly BarInput[]) => {
      feed.planUpdate(inputs)();
    },
    prepend: (inputs: readonly BarInput[]) => {
      const { inserted, commit } = feed.planPrepend(inputs);
      commit();
      return inserted;
    }
  };
}

describe('BarStore', () => {
  it('stores bars in time order and exposes columns', () => {
    const store = new BarStore();
    store.set(createBars(3));

    expect(store.length).toBe(3);
    expect(store.time(2)).toBe(T0 + 2 * MINUTE);
    expect(store.bar(1)).toMatchObject({ time: T0 + MINUTE, volume: 1010 });
    expect(store.bar(3)).toBeNull();
    expect(store.price(0, 'hl2')).toBe((store.high(0) + store.low(0)) / 2);
  });

  it('parses ISO strings and dates', () => {
    const store = new BarStore();
    store.set([
      { time: '2024-01-02T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: new Date('2024-01-03T00:00:00Z'), open: 1, high: 2, low: 0.5, close: 1.5 }
    ]);

    expect(store.time(0)).toBe(Date.UTC(2024, 0, 2));
    expect(store.time(1)).toBe(Date.UTC(2024, 0, 3));
    expect(store.volume(0)).toBe(0);
  });

  it('rejects unsorted, duplicate and inconsistent bars without changing state', () => {
    const store = new BarStore();
    store.set(createBars(2));
    const revision = store.revision;
    const [first, second] = createBars(2);

    expect(() => {
      store.set([second!, first!]);
    }).toThrow(/strictly ascending/);
    expect(() => {
      store.set([first!, first!]);
    }).toThrow(ChartError);
    expect(() => {
      store.set([{ time: T0, open: 10, high: 9, low: 8, close: 9 }]);
    }).toThrow(/inconsistent/);
    expect(() => {
      store.set([{ time: 'not a date', open: 1, high: 1, low: 1, close: 1 }]);
    }).toThrow(/not a valid point in time/);
    expect(store.revision).toBe(revision);
    expect(store.length).toBe(2);
  });

  it('takes the last bar replaced or newer ones as a change of the tail', () => {
    const { store, update } = feedOf(createBars(3));
    const revision = store.revision;
    const last = createBars(3)[2]!;

    update([{ ...last, close: last.close + 0.5, high: last.high + 0.5 }]);
    expect(store.length).toBe(3);
    expect(store.changesSince(revision)).toEqual({ kind: 'tail', from: 2 });

    update(createBars(5).slice(3));
    expect(store.length).toBe(5);
    expect(store.changesSince(revision)).toEqual({ kind: 'tail', from: 2 });
    expect(store.changesSince(store.revision)).toBeNull();
    // A revision it never had, such as one of another store, reads everything again.
    expect(store.changesSince(store.revision + 1)).toEqual({ kind: 'reset' });
  });

  it('rejects updates older than the last bar, also within one batch', () => {
    const { store, update } = feedOf(createBars(3));
    const bars = createBars(6);

    expect(() => {
      update([bars[1]!]);
    }).toThrow(/older than the last bar/);
    expect(() => {
      update([bars[5]!, bars[4]!]);
    }).toThrow(/older than the last bar/);
    expect(store.length).toBe(3);
  });

  it('takes older bars before the first one, ignoring the overlapping ones, as a reset', () => {
    const all = createBars(12);
    const { store, prepend } = feedOf(all.slice(8));
    const revision = store.revision;

    expect(prepend(all.slice(5, 10))).toBe(3);
    expect(store.toArray().map((bar) => (bar.time - T0) / MINUTE)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(store.toArray()).toEqual(all.slice(5).map((bar) => parseBar(bar)));
    expect(store.changesSince(revision)).toEqual({ kind: 'reset' });
  });

  it('takes page after page of older bars, with newer ones in between', () => {
    const all = createBars(520);
    const { store, update, prepend } = feedOf(all.slice(500, 510));
    let next = 510;

    for (let page = 0; page < 50; page += 1) {
      expect(prepend(all.slice(490 - page * 10, 500 - page * 10))).toBe(10);

      if (page % 5 === 0) {
        update([all[next] as BarInput]);
        next += 1;
      }
    }

    expect(store.toArray()).toEqual(all.map((bar) => parseBar(bar)));
  });

  it('grows capacity across many appends', () => {
    const bars = createBars(1000);
    const { store, update } = feedOf([]);

    bars.forEach((bar) => {
      update([bar]);
    });

    expect(store.length).toBe(1000);
    expect(store.close(999)).toBe(bars[999]!.close);
    expect(store.interval()).toBe(MINUTE);
  });

  it('finds indices by time', () => {
    const store = new BarStore();
    store.set(createBars(10));

    expect(store.indexOf(T0 + 4 * MINUTE)).toBe(4);
    expect(store.indexOf(T0 + 4 * MINUTE + 1)).toBe(-1);
    expect(store.indexAt(T0 + 4 * MINUTE + 30_000)).toBe(4);
    expect(store.indexAt(T0 - 1)).toBe(-1);
    expect(store.lowerBound(T0 + 100 * MINUTE)).toBe(10);
  });

  it('reports a reset to consumers that fell behind the change log', () => {
    const { store, update } = feedOf(createBars(1));
    const revision = store.revision;

    for (let index = 0; index < 300; index += 1) {
      update([{ time: T0, open: 1, high: 2, low: 0.5, close: 1 + index / 1000 }]);
    }

    expect(store.changesSince(revision)).toEqual({ kind: 'reset' });
  });
});

describe('parseBar', () => {
  it('normalizes a bar as the chart takes it', () => {
    expect(
      parseBar({ time: '2024-01-01T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5 })
    ).toEqual({
      time: Date.UTC(2024, 0, 1),
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 0
    });
  });

  it('names the bar in its errors', () => {
    const bar = { time: 0, open: 1, high: 2, low: 0.5, close: 1.5 };

    expect(() => parseBar({ ...bar, high: '2' } as never)).toThrow(
      'bar.high must be a finite number, received "2".'
    );
    expect(() => parseBar({ ...bar, low: 1.2 }, 'feed', 3)).toThrow(
      'feed[3] is inconsistent: high (2) and low (1.2) must enclose open (1) and close (1.5).'
    );
    expect(() => parseBar({ ...bar, time: 'later' }, 'bars', 0)).toThrow(
      'bars[0].time "later" is not a valid point in time.'
    );
    expect(() => parseBar(null as never, 'bars', 1)).toThrow(
      'bars[1] must be an object, received null.'
    );
    expect(() => parseBar({ ...bar, volume: -1 })).toThrow(
      'bar.volume must not be negative, received -1.'
    );
  });
});

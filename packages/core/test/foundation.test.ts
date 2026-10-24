import { withAlpha } from '../src/canvas/color';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events/event-bus';
import { createDefaultOptions } from '../src/options/defaults';
import { resolveOptions } from '../src/options/resolve';
import { lightTheme } from '../src/options/themes';
import { deepMerge } from '../src/utils/merge';
import { LruCache } from '../src/utils/lru-cache';

describe('options', () => {
  it('merges partial options without mutating the base', () => {
    const base = createDefaultOptions();
    const next = resolveOptions(base, { timeScale: { barSpacing: 12 }, theme: lightTheme }, []);

    expect(next.timeScale.barSpacing).toBe(12);
    expect(next.timeScale.minBarSpacing).toBe(base.timeScale.minBarSpacing);
    expect(next.theme.background).toBe(lightTheme.background);
    expect(base.timeScale.barSpacing).toBe(8);
  });

  it('rejects invalid values with the option path', () => {
    const base = createDefaultOptions();

    expect(() => resolveOptions(base, { timeScale: { barSpacing: 1000 } }, [])).toThrow(
      'options.timeScale.barSpacing must be at most 60'
    );
    expect(() => resolveOptions(base, { crosshair: { mode: 'sticky' as 'free' } }, [])).toThrow(
      /options.crosshair.mode must be one of/
    );
    expect(() => resolveOptions(base, { timeZone: 'Mars/Olympus' }, [])).toThrow(/time zone/);
    expect(() =>
      resolveOptions(base, { theme: { palette: [] as unknown as [string] } }, [])
    ).toThrow(/palette/);
  });

  it('ignores prototype keys while merging', () => {
    const merged = deepMerge<Record<string, unknown>>(
      { a: 1 },
      JSON.parse('{"__proto__": {"polluted": true}, "b": 2}') as Record<string, unknown>
    );

    expect(merged).toEqual({ a: 1, b: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('EventBus', () => {
  interface Events {
    ping: number;
    pong: string;
  }

  it('defers events until the outermost operation ends', () => {
    const bus = new EventBus<Events>();
    const seen: string[] = [];
    bus.on('ping', (value) => seen.push(`ping ${value}`));

    bus.defer(() => {
      bus.emit('ping', 1);
      bus.defer(() => {
        bus.emit('ping', 2);
      });
      seen.push('operation done');
    });

    expect(seen).toEqual(['operation done', 'ping 1', 'ping 2']);
  });

  it('dispatches events emitted by listeners after the current one', () => {
    const bus = new EventBus<Events>();
    const seen: string[] = [];
    bus.on('ping', () => {
      bus.emit('pong', 'reply');
      seen.push('ping');
    });
    bus.on('pong', (value) => seen.push(value));

    bus.emit('ping', 1);

    expect(seen).toEqual(['ping', 'reply']);
  });

  it('calls every listener and rethrows the first error', () => {
    const bus = new EventBus<Events>();
    const second = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', second);

    expect(() => {
      bus.emit('ping', 1);
    }).toThrow('boom');
    expect(second).toHaveBeenCalledOnce();
  });

  it('unsubscribes', () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    const off = bus.on('ping', listener);
    off();
    bus.emit('ping', 1);

    expect(listener).not.toHaveBeenCalled();
    expect(bus.has('ping')).toBe(false);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
  });
});

describe('colors', () => {
  it('reads hex, rgb() and what the canvas takes, and rejects the rest', () => {
    expect(withAlpha('#f80', 0.5)).toBe('rgba(255, 136, 0, 0.5)');
    expect(withAlpha('rgb(1, 2, 3)', 1)).toBe('rgba(1, 2, 3, 1)');
    // The canvas of the tests keeps any string it is given, as no browser does.
    expect(() => withAlpha('not a color', 1)).toThrow('Unsupported color "not a color"');
  });
});

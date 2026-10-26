import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../helpers/chart';
import type { Bar, BarInput } from '../../src/data/types';
import { BarStore } from '../../src/data/bar-store';
import { averageTrueRange, roundSize } from '../../src/chart-types/box-sizes';
import type { BarTransformDefinition, BarTransformStream } from '../../src/feed/transform';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { kagi } from '../../src/chart-types';
import { chartTypes } from '../../src/chart-types/module';
import { createModularChart, createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

/** A walk with big swings, so bricks and range bars form often. */
function swingBars(count: number): BarInput[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + 12 * Math.sin(index / 5) + (index % 4);
    const close = 100 + 12 * Math.sin((index + 1) / 5) + ((index + 1) % 4);
    return {
      time: T0 + index * MINUTE,
      open,
      high: Math.max(open, close) + 0.75,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 100 + index
    };
  });
}

/** Swings growing with the prices, so the average true range grows bar after bar. */
function growingSwings(count: number): BarInput[] {
  return swingBars(count).map((bar, index) => {
    const scale = 1 + index / 40;
    return {
      ...bar,
      open: bar.open * scale,
      high: bar.high * scale,
      low: bar.low * scale,
      close: bar.close * scale
    };
  });
}

function chartWith(bars: readonly BarInput[]): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  chart.data.set(bars, { interval: '1m' });
  return chart;
}

/** The displayed bars after streaming `bars` one by one, each first as a partial bar. */
function streamed(bars: readonly BarInput[], transform: Parameters<Chart['transforms']['set']>[0]) {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  chart.data.set(bars.slice(0, 20), { interval: '1m' });
  chart.transforms.set(transform);

  for (const bar of bars.slice(20)) {
    chart.data.update({ ...bar, close: bar.open, high: bar.open, low: bar.open });
    chart.data.update(bar);
  }

  return chart.data.toArray();
}

/** A bar every `volume` traded. */
class VolumeStream implements BarTransformStream {
  constructor(
    private readonly volume: number,
    private forming: Bar | null
  ) {}

  next(bar: Bar): readonly Bar[] {
    const forming: Bar = this.forming
      ? {
          ...this.forming,
          high: Math.max(this.forming.high, bar.high),
          low: Math.min(this.forming.low, bar.low),
          close: bar.close,
          volume: this.forming.volume + bar.volume
        }
      : bar;
    this.forming = forming.volume >= this.volume ? null : forming;
    return this.forming ? [] : [forming];
  }

  current(): Bar | null {
    return this.forming;
  }

  clone(): BarTransformStream {
    return new VolumeStream(this.volume, this.forming);
  }
}

describe('bar transforms', () => {
  it('builds Heikin-Ashi candles bar by bar', () => {
    const bars = createBars(5);
    const chart = chartWith(bars);
    chart.transforms.set({ type: 'heikin-ashi' });
    const [first, second] = bars as [BarInput, BarInput];
    const ha = chart.data.toArray();
    const close0 = (first.open + first.high + first.low + first.close) / 4;
    const open0 = (first.open + first.close) / 2;
    const close1 = (second.open + second.high + second.low + second.close) / 4;
    const open1 = (open0 + close0) / 2;

    expect(chart.transforms.get()).toEqual({
      type: 'heikin-ashi',
      params: {},
      input: 'bars',
      resolved: null
    });
    expect(ha).toHaveLength(5);
    expect(ha[0]).toEqual({
      time: first.time,
      open: open0,
      high: Math.max(first.high, open0, close0),
      low: Math.min(first.low, open0, close0),
      close: close0,
      volume: first.volume
    });
    expect(ha[1]?.open).toBeCloseTo(open1);
    expect(ha[1]?.close).toBeCloseTo(close1);

    chart.transforms.set(null);
    expect(chart.transforms.get()).toBeNull();
    expect(chart.data.toArray()).toEqual(bars);
  });

  it.each([
    { type: 'heikin-ashi' },
    { type: 'renko', params: { box: 2 } },
    { type: 'renko', params: { box: 1.5, source: 'ohlc' } },
    { type: 'range', params: { range: 3 } },
    { type: 'line-break', params: { lines: 2 } },
    { type: 'kagi', params: { reversal: 3 } },
    { type: 'point-figure', params: { box: 1, reversal: 2, source: 'hl' } },
    { type: 'point-figure', params: { box: 1, reversal: 1, oneStepBack: true } },
    { type: 'tick', params: { count: 4 } },
    { type: 'volume', params: { volume: 700 } },
    { type: 'turnover', params: { turnover: 50_000 } }
  ])('streams $type exactly like a rebuild', (transform) => {
    const bars = swingBars(160);
    const chart = chartWith(bars);
    chart.transforms.set(transform);

    expect(chart.data.length).toBeGreaterThan(5);
    expect(streamed(bars, transform)).toEqual(chart.data.toArray());
  });

  it('builds kagi lines on a timeframe from history taken page after page as from all of it', () => {
    const bars = swingBars(600);
    const paged = createTestChart({ calendar: { timeZone: 'UTC' } });
    paged.data.set(bars.slice(500), { interval: '1m' });
    paged.data.setTimeframe('3m');
    paged.transforms.set({ type: 'kagi' });

    for (let end = 500; end > 0; end -= 50) {
      paged.data.prepend(bars.slice(end - 50, end));
    }

    const atOnce = chartWith(bars);
    atOnce.data.setTimeframe('3m');
    atOnce.transforms.set({ type: 'kagi' });
    expect(paged.data.length).toBeGreaterThan(10);
    expect(paged.data.toArray()).toEqual(atOnce.data.toArray());
    expect(paged.transforms.get()?.resolved).toEqual(atOnce.transforms.get()?.resolved);
  });

  it.each([
    { type: 'renko', params: {}, size: 'box' },
    { type: 'renko', params: { source: 'ohlc' }, size: 'box' },
    { type: 'range', params: {}, size: 'range' },
    { type: 'kagi', params: {}, size: 'reversal' },
    { type: 'kagi', params: { atrLength: 5 }, size: 'reversal' },
    { type: 'point-figure', params: { reversal: 1 }, size: 'box' }
  ])(
    'builds $type $params from no bars once the closed bars give the size, then keeps it',
    ({ type, params, size }) => {
      const bars = growingSwings(160);
      const length = (params as { atrLength?: number }).atrLength ?? 14;
      const live = createTestChart({ calendar: { timeZone: 'UTC' } });
      live.data.set([], { interval: '1m' });
      live.transforms.set({ type, params });

      bars.forEach((bar, index) => {
        live.data.update({ ...bar, close: bar.open, high: bar.open, low: bar.open });
        live.data.update(bar);

        // The bar just added is forming: the ones before it are closed.
        if (index < length) {
          expect(live.data.length).toBe(0);
          expect(live.transforms.get()?.resolved).toBeNull();
        } else if (index === length) {
          // As the bars would be built at this moment, from the first one on.
          const now = chartWith(bars.slice(0, index + 1));
          now.transforms.set({ type, params });
          expect(live.transforms.get()?.resolved).toEqual(now.transforms.get()?.resolved);
          expect(live.data.toArray()).toEqual(now.data.toArray());
          expect(live.data.length).toBeGreaterThan(0);
        }
      });

      // The bars after it keep the size, however far they swing.
      const fixed = live.transforms.get()?.resolved?.[size];
      const kept = chartWith(bars);
      const given = Object.entries(params).filter(([key]) => key !== 'atrLength');
      kept.transforms.set({ type, params: Object.fromEntries([...given, [size, fixed]]) });
      expect(live.data.toArray()).toEqual(kept.data.toArray());

      // Built again, the size is the one of the latest closed bars.
      const rebuilt = chartWith(bars);
      rebuilt.transforms.set({ type, params });
      live.transforms.set({ type, params });
      expect(live.transforms.get()?.resolved).toEqual(rebuilt.transforms.get()?.resolved);
      expect(live.transforms.get()?.resolved?.[size]).not.toBe(fixed);
    }
  );

  it('sizes by a percentage of the first closed price when it starts without bars', () => {
    const bars = growingSwings(40);
    const live = createTestChart({ calendar: { timeZone: 'UTC' } });
    live.data.set([], { interval: '1m' });
    live.transforms.set({ type: 'renko', params: { percentage: 2 } });
    live.data.update(bars[0] as BarInput);

    expect(live.data.length).toBe(0);
    expect(live.transforms.get()?.resolved).toBeNull();

    live.data.update(bars.slice(1));
    expect(live.transforms.get()?.resolved?.box).toBe(roundSize(((bars[0]?.close ?? 0) * 2) / 100));
  });

  it('builds nothing from fewer closed bars than the average true range takes', () => {
    const bars = swingBars(40);
    const chart = chartWith(bars.slice(0, 14));
    chart.transforms.set({ type: 'renko' });

    // 13 closed bars and the forming one: the average true range of 14 bars is not there yet.
    expect(chart.data.length).toBe(0);
    expect(chart.transforms.get()).toEqual({
      type: 'renko',
      params: {},
      input: 'bars',
      resolved: null
    });

    chart.data.update(bars.slice(14, 16));
    const now = chartWith(bars.slice(0, 16));
    now.transforms.set({ type: 'renko' });
    expect(chart.transforms.get()?.resolved).toEqual(now.transforms.get()?.resolved);
    expect(chart.data.toArray()).toEqual(now.data.toArray());
  });

  it('sizes by the latest closed bars again when history comes before them', () => {
    const bars = growingSwings(160);
    const chart = chartWith(bars.slice(60));
    chart.transforms.set({ type: 'renko' });
    chart.data.prepend(bars.slice(0, 60));
    const all = chartWith(bars);
    all.transforms.set({ type: 'renko' });

    expect(chart.transforms.get()?.resolved).toEqual(all.transforms.get()?.resolved);
    expect(chart.data.toArray()).toEqual(all.data.toArray());
  });

  it('needs a size of its own to build from trades, which have no true range', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    chart.data.set([], { interval: '1m' });

    expect(() => {
      chart.transforms.set({ type: 'renko', input: 'trades' });
    }).toThrow(
      'Trades have no true range to size the "renko" transform by: give params.box or params.percentage.'
    );
    expect(() => {
      chart.transforms.set({ type: 'range', input: 'trades' });
    }).toThrow('Trades have no true range to size the "range" transform by: give params.range.');
    expect(chart.transforms.get()).toBeNull();

    chart.transforms.set({ type: 'renko', params: { percentage: 1 }, input: 'trades' });
    chart.data.addTrades(
      Array.from({ length: 30 }, (_, index) => ({
        time: T0 + index * 1000,
        price: 100 + 3 * Math.sin(index / 4),
        size: 1
      }))
    );
    // A percent of the first trade, closed by the one after it.
    expect(chart.transforms.get()?.resolved?.box).toBe(1);
    expect(chart.data.length).toBeGreaterThan(0);
  });

  it('keeps the automatic Renko box while streaming', () => {
    const bars = swingBars(160);
    const chart = chartWith(bars.slice(0, 20));
    chart.transforms.set({ type: 'renko' });
    const box = Math.abs((chart.data.at(0)?.close ?? 0) - (chart.data.at(0)?.open ?? 0));
    chart.data.update(bars.slice(20));

    chart.data.toArray().forEach((brick) => {
      expect(Math.abs(brick.close - brick.open)).toBeCloseTo(box);
    });
  });

  it('sizes range bars from the average true range of the closed bars', () => {
    const chart = chartWith(createBars(40));
    const store = new BarStore();
    store.assign(chart.data.toArray());
    const range = roundSize(averageTrueRange(store, 14, store.length - 1));
    chart.transforms.set({ type: 'range' });

    expect(chart.transforms.get()?.resolved).toEqual({ range });
    chart.data
      .toArray()
      .slice(0, -1)
      .forEach((bar) => {
        expect(bar.high - bar.low).toBeCloseTo(range);
      });
  });

  it('closes range bars at exactly the range', () => {
    const chart = chartWith(swingBars(120));
    chart.transforms.set({ type: 'range', params: { range: 3 } });
    const bars = chart.data.toArray();

    bars.slice(0, -1).forEach((bar) => {
      expect(bar.high - bar.low).toBeCloseTo(3);
    });
    expect((bars.at(-1)?.high ?? 0) - (bars.at(-1)?.low ?? 0)).toBeLessThanOrEqual(3 + 1e-9);
    expect(bars.reduce((sum, bar) => sum + bar.volume, 0)).toBe(
      swingBars(120).reduce((sum, bar) => sum + (bar.volume ?? 0), 0)
    );
  });

  it('keeps the transform across timeframes and follows a replay', () => {
    const bars = swingBars(180);
    const chart = chartWith(bars);
    chart.transforms.set({ type: 'renko', params: { box: 2 } });
    chart.data.setTimeframe('5m');
    const fiveMinute = chartWith(bars);
    fiveMinute.data.setTimeframe('5m');
    fiveMinute.transforms.set({ type: 'renko', params: { box: 2 } });

    expect(chart.data.toArray()).toEqual(fiveMinute.data.toArray());

    chart.data.setTimeframe(null);
    chart.replay.start(T0 + 60 * MINUTE);
    const atStart = chart.data.length;
    chart.replay.step(60);
    const partial = chartWith(bars.slice(0, 121));
    partial.transforms.set({ type: 'renko', params: { box: 2 } });

    expect(chart.data.length).toBeGreaterThan(atStart);
    expect(chart.data.toArray()).toEqual(partial.data.toArray());
  });

  it('labels the time axis and drops the countdown for bricks', () => {
    // Within the latest bar, which the countdown counts down.
    vi.spyOn(Date, 'now').mockReturnValue(T0 + 39.5 * MINUTE);
    // Jumps of ten boxes put bricks a millisecond apart.
    const bars = Array.from({ length: 40 }, (_, index) => {
      const close = 100 + (index % 2 === 0 ? 0 : 10) + index * 0.1;
      return { time: T0 + index * MINUTE, open: close, high: close, low: close, close };
    });
    const chart = chartWith(bars);
    // Wide bars leave room for a label at every brick.
    chart.applyOptions({ latestPrice: { countdown: true }, timeScale: { barSpacing: 60 } });
    chart.transforms.set({ type: 'renko', params: { box: 1 } });
    const texts = (layer: string) => {
      const canvas = chart.element.querySelector<HTMLCanvasElement>(
        `canvas[data-layer="${layer}"]`
      );
      const calls = canvas ? canvasCalls(canvas) : [];
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };

    expect(texts('scene').some((text) => /^\d{2}:\d{2}$/.test(text))).toBe(true);
    expect(texts('scene').some((text) => /\d{2}:\d{2}:\d{2}/.test(text))).toBe(false);
    expect(texts('cursor').some((text) => text.includes(':'))).toBe(false);

    chart.transforms.set({ type: 'heikin-ashi' });
    expect(texts('cursor').some((text) => /\d{2}:\d{2}/.test(text))).toBe(true);
    vi.restoreAllMocks();
  });

  it('computes indicators on the transformed bars', () => {
    const chart = chartWith(createBars(30));
    const ma = chart.indicators.add({ type: 'MA', params: { periods: [3] } });
    chart.transforms.set({ type: 'heikin-ashi' });
    const ha = chart.data.toArray();
    const expected = ((ha[27]?.close ?? 0) + (ha[28]?.close ?? 0) + (ha[29]?.close ?? 0)) / 3;

    expect(chart.indicators.valuesAt(ma, 29)[0]?.value).toBeCloseTo(expected);
  });

  it('come with the chart types module, and say so without it', () => {
    const chart = createModularChart({});
    chart.data.set(createBars(20));

    expect(chart.transforms.types()).toEqual([]);
    expect(() => {
      chart.transforms.set({ type: 'renko' });
    }).toThrow('Unknown bar transform "renko". Give it to the chartTypes module');
    expect(() => {
      chart.applyOptions({ mainSeries: { type: 'kagi' } });
    }).toThrow('Unknown series type "kagi"');

    const kagiChart = createModularChart({
      modules: [chartTypes([kagi])],
      mainSeries: { type: 'kagi' }
    });
    expect(kagiChart.transforms.types()).toEqual(['kagi']);
    expect(kagiChart.options().mainSeries.type).toBe('kagi');
  });

  it('validates transforms before changing anything', () => {
    const bars = createBars(20);
    const chart = chartWith(bars);

    expect(() => {
      chart.transforms.set({ type: 'three-line-break' });
    }).toThrow('Unknown bar transform "three-line-break"');
    expect(() => {
      chart.transforms.set({ type: 'renko', params: { box: -1 } });
    }).toThrow('params.box');
    expect(() => {
      chart.transforms.set({ type: 'renko', params: { size: 1 } });
    }).toThrow('The "renko" transform has no parameter "size"');
    expect(() => {
      chart.transforms.set({ type: 'heikin-ashi', params: 3 as never });
    }).toThrow('transform.params must be an object');
    expect(chart.transforms.get()).toBeNull();
    expect(chart.data.toArray()).toEqual(bars);
  });

  it('show prices with the decimals of the market, not of the bars they build', () => {
    const bars = createBars(50).map((bar) => ({
      ...bar,
      open: bar.open + 0.12,
      high: bar.high + 0.55,
      low: bar.low + 0.31,
      close: bar.close + 0.47
    }));
    const chart = chartWith(bars);
    let text = '';
    chart.plugins.add({
      name: 'probe',
      paint: ({ pane }) => {
        if (pane.id === 'main') {
          text = pane.formatValue(100.5);
        }
      }
    });
    chart.screenshot();
    const plain = text;
    chart.transforms.set({ type: 'heikin-ashi' });
    chart.screenshot();

    expect(plain).toBe('100.50');
    expect(text).toBe(plain);
  });

  it('change nothing when they fail on the bars, set or loaded', () => {
    const bars = createBars(20);
    const chart = chartWith(bars);
    const tiny = { type: 'renko', params: { box: 1e-9 } };

    expect(() => {
      chart.transforms.set(tiny);
    }).toThrow('too small');
    expect(chart.transforms.get()).toBeNull();
    expect(chart.data.toArray()).toEqual(bars);

    chart.transforms.set({ type: 'heikin-ashi' });
    const shown = chart.data.toArray();

    expect(() => {
      chart.transforms.set(tiny);
    }).toThrow('too small');
    expect(chart.transforms.get()?.type).toBe('heikin-ashi');
    expect(chart.data.toArray()).toEqual(shown);

    const saved = chart.saveState();

    expect(() => {
      chart.loadState({ ...saved, mainSeries: { type: 'line', source: 'close' }, transform: tiny });
    }).toThrow('too small');
    expect(chart.options().mainSeries.type).toBe('candles');
    expect(chart.transforms.get()?.type).toBe('heikin-ashi');
    expect(chart.data.toArray()).toEqual(shown);
  });

  it('build the bars right after a bar they failed on', () => {
    const bars = createBars(20);
    const last = bars[bars.length - 1]?.close ?? 0;
    const next = (index: number, close: number): BarInput => ({
      time: T0 + index * MINUTE,
      open: last,
      high: Math.max(last, close),
      low: Math.min(last, close),
      close,
      volume: 1
    });
    const renko = { type: 'renko', params: { box: 1 } };
    const chart = chartWith(bars);
    chart.transforms.set(renko);

    expect(() => {
      chart.data.update([next(20, last + 2), next(21, last * 1e6)]);
    }).toThrow('too small');

    chart.data.update(next(21, last + 5));
    const fresh = chartWith([...bars, next(20, last + 2), next(21, last + 5)]);
    fresh.transforms.set(renko);

    expect(chart.data.toArray()).toEqual(fresh.data.toArray());
  });

  it('runs custom transforms and checks their output', () => {
    const volumeBars: BarTransformDefinition<{ volume: number }> = {
      type: 'my-volume',
      name: 'Volume bars',
      keepsTime: false,
      create: ({ volume }) => new VolumeStream(volume, null)
    };
    const chart = chartWith(createBars(10));
    chart.transforms.register(volumeBars);
    chart.transforms.set({ type: 'my-volume', params: { volume: 3000 } });

    expect(chart.data.length).toBeGreaterThan(0);
    expect(() => {
      chart.transforms.register({ ...volumeBars, type: 'renko' });
    }).toThrow('A bar transform "renko" is already registered');
    expect(() => {
      chart.transforms.register({ type: 'broken', name: 'Broken', keepsTime: true } as never);
    }).toThrow('needs a create() function');

    chart.transforms.register({
      type: 'backwards',
      name: 'Backwards',
      keepsTime: false,
      create: () => {
        const stream = {
          next: (bar: Bar) => [bar, { ...bar, time: bar.time - 1 }],
          current: () => null,
          clone: () => stream
        };
        return stream;
      }
    });
    expect(() => {
      chart.transforms.set({ type: 'backwards' });
    }).toThrow('times must not decrease');
  });
});

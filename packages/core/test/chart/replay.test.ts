import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartPointerEvent } from '../../src/chart/events';
import type { ReplayEvent } from '../../src/replay/replay';
import { Feed } from '../../src/feed/aggregator';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createSeriesRegistry } from '../../src/series/built-in';
import { SeriesStore } from '../../src/series/series-store';
import { click, createTestChart } from '../helpers/chart';

/** 30 one-minute bars from 09:30 UTC shown as 5-minute bars. */
function replayChart() {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
  const bars = createBars(30);
  chart.data.set(bars, { interval: '1m' });
  chart.data.setTimeframe('5m');
  const events: ReplayEvent[] = [];
  chart.on('replay', (event) => events.push(event));
  return { chart, bars, events };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('replay', () => {
  it('shows the data up to the cursor, with the displayed bar forming from the source', () => {
    const { chart, bars } = replayChart();
    chart.replay.start(T0 + 7 * MINUTE);

    expect(chart.data.length).toBe(2);
    expect(chart.data.last()).toMatchObject({
      time: T0 + 5 * MINUTE,
      open: bars[5]?.open,
      close: bars[7]?.close
    });
    expect(chart.replay.state()).toEqual({
      time: T0 + 7 * MINUTE,
      speed: 1,
      step: 'bar',
      playing: false,
      ended: false
    });
  });

  it('counts the source bars it has revealed once a change, however often they are read', () => {
    const { chart } = replayChart();
    chart.replay.start(T0 + 7 * MINUTE);
    const counts = vi.spyOn(Feed.prototype, 'revealed');
    const lengths = () => Array.from({ length: 100 }, () => chart.data.source.length);

    expect(lengths()).toEqual(Array.from({ length: 100 }, () => 8));
    expect(counts.mock.calls.length).toBeLessThanOrEqual(1);

    chart.replay.step();
    counts.mockClear();
    expect(new Set(lengths())).toEqual(new Set([10]));
    expect(counts.mock.calls.length).toBeLessThanOrEqual(1);
    counts.mockRestore();
  });

  it('steps by source bars or by whole displayed bars', () => {
    const { chart, bars } = replayChart();
    chart.replay.start(T0 + 7 * MINUTE, { step: 'source' });

    expect(chart.replay.step()).toBe(1);
    expect(chart.data.last()?.close).toBe(bars[8]?.close);

    chart.replay.configure({ step: 'bar' });
    chart.replay.step();
    // Completes the bar in progress (up to 09:39).
    expect(chart.replay.state()?.time).toBe(T0 + 9 * MINUTE);
    expect(chart.data.length).toBe(2);

    chart.replay.step(2);
    expect(chart.replay.state()?.time).toBe(T0 + 19 * MINUTE);
    expect(chart.data.length).toBe(4);
  });

  it('seeks back and forth and stops at the end', () => {
    const { chart } = replayChart();
    chart.replay.start(T0 + 20 * MINUTE);
    chart.replay.seek(T0 + 3 * MINUTE);

    expect(chart.data.length).toBe(1);

    chart.replay.seek(T0 + 29 * MINUTE);
    expect(chart.data.length).toBe(6);
    expect(chart.replay.state()?.ended).toBe(true);
    expect(chart.replay.step()).toBe(0);

    chart.replay.stop();
    expect(chart.replay.state()).toBeNull();
    expect(chart.data.length).toBe(6);
  });

  it('keeps the cursor across timeframes and hides new data until it is reached', () => {
    const { chart } = replayChart();
    chart.replay.start(T0 + 12 * MINUTE);
    chart.data.setTimeframe(null);

    expect(chart.data.length).toBe(13);

    chart.data.update(createBars(31)[30] as never);
    expect(chart.data.length).toBe(13);
    expect(chart.replay.state()?.time).toBe(T0 + 12 * MINUTE);

    chart.replay.stop();
    expect(chart.data.length).toBe(31);
  });

  it('plays with the window timers and reports progress from them only', () => {
    vi.useFakeTimers();
    const { chart, events } = replayChart();
    chart.replay.start(T0 + 14 * MINUTE, { speed: 2 });
    chart.replay.step();

    expect(events).toEqual([]);

    chart.replay.play();
    expect(chart.replay.state()?.playing).toBe(true);

    vi.advanceTimersByTime(500);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reason: 'step',
      state: { time: T0 + 24 * MINUTE, playing: true }
    });

    vi.advanceTimersByTime(500);
    expect(events[1]).toMatchObject({
      reason: 'end',
      state: { time: T0 + 29 * MINUTE, ended: true, playing: false }
    });
    expect(chart.replay.state()?.playing).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(2);
  });

  it('pauses, changes speed while playing and clears its timer on destroy', () => {
    vi.useFakeTimers();
    const { chart, events } = replayChart();
    chart.replay.start(T0 + 4 * MINUTE);
    chart.replay.play();
    chart.replay.configure({ speed: 4 });
    vi.advanceTimersByTime(250);

    expect(events).toHaveLength(1);

    chart.replay.pause();
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(1);

    chart.replay.play();
    chart.destroy();
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(1);
  });

  it('fires alerts on revealed bars and flags them as replayed', () => {
    const chart = createTestChart({ calendar: { timeZone: 'UTC' } });
    const bars = Array.from({ length: 10 }, (_, index) => {
      const close = index < 6 ? 100 : 110;
      return { time: T0 + index * MINUTE, open: close, high: close, low: close, close };
    });
    chart.data.set(bars, { interval: '1m' });
    chart.replay.start(T0 + 3 * MINUTE);
    const triggers = vi.fn();
    chart.on('alertTrigger', triggers);
    chart.alerts.add({ id: 'a', trigger: 'cross-up', value: 105 });

    chart.replay.step(3);
    expect(triggers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', time: T0 + 6 * MINUTE, replay: true })
    );
  });

  it('hides series points and markers after the cursor', () => {
    const chart = createTestChart({ timeScale: { barSpacing: 40 } });
    const bars = createBars(60);
    chart.data.set(bars, { interval: '1m' });
    const series = new SeriesStore(createSeriesRegistry(), () => chart.options().theme);
    const entry = series.add(
      {
        type: 'line',
        data: bars.map((bar, index) => ({ time: bar.time, value: index }))
      },
      'main'
    );
    series.setCutoff(T0 + 50 * MINUTE);
    expect(entry.values?.length).toBe(51);
    series.setCutoff(Number.POSITIVE_INFINITY);
    expect(entry.values?.length).toBe(60);

    const close = bars[50]?.close ?? 0;
    chart.markers.set([
      { id: 'm', time: T0 + 55 * MINUTE, position: 'price', price: close, shape: 'circle' }
    ]);
    const clicks = vi.fn<(event: ChartPointerEvent) => void>();
    chart.on('click', clicks);
    const markerAt = (index: number) => {
      const x = chart.timeScale.timeToX(T0 + index * MINUTE) ?? Number.NaN;
      const y = chart.priceScale().priceToY(close) ?? Number.NaN;
      click(chart, x, y);
      return clicks.mock.lastCall?.[0]?.target;
    };

    chart.replay.start(T0 + 50 * MINUTE);
    // Without the cutoff, the marker after the data would sit on the last bar.
    expect(markerAt(50)).toBeNull();

    chart.replay.stop();
    expect(markerAt(55)).toMatchObject({ kind: 'marker', id: 'm' });
  });

  it('validates its input and ends when the data is cleared', () => {
    const { chart } = replayChart();

    expect(() => {
      chart.replay.step();
    }).toThrow('replay.start() first');
    expect(() => {
      chart.replay.start(T0 - MINUTE);
    }).toThrow('before the first bar');
    expect(() => {
      chart.replay.start(T0, { speed: 0 });
    }).toThrow('replay.speed must be greater than 0');
    expect(() => {
      chart.replay.start(T0, { step: 'tick' as never });
    }).toThrow('replay.step must be one of');

    chart.replay.start(T0 + 5 * MINUTE);
    chart.data.clear();
    expect(chart.replay.state()).toBeNull();

    expect(() => {
      chart.replay.start(T0);
    }).toThrow('Replay needs data');
  });
});

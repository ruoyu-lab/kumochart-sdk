import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';

const HOUR = 60 * MINUTE;

/** A chart of minute bars, looking back at history: bar 300 the last in view. */
function scrolledBack(): Chart {
  const chart = createTestChart();
  chart.data.set(createBars(600), { interval: '1m' });
  chart.timeScale.setBarSpacing(12);
  chart.timeScale.scrollToIndex(300, 'right');
  return chart;
}

/** The time at the right edge of the plot. */
function rightEdge(chart: Chart): number {
  const range = chart.timeScale.visibleLogicalRange();
  const x = range ? chart.timeScale.indexToX(range.to) : null;
  return (x === null ? null : chart.timeScale.xToTime(x)) ?? Number.NaN;
}

describe('the view as the bars are replaced', () => {
  it('keeps the time at the right edge and the zoom for bars of another symbol', () => {
    const chart = scrolledBack();
    const before = rightEdge(chart);

    expect(chart.timeScale.isFollowing()).toBe(false);
    expect(before).toBe(T0 + 300.5 * MINUTE);

    // Other bars over a longer time, of the same times as far as they go.
    chart.data.set(createBars(900, T0 - 120 * MINUTE), { interval: '1m' });

    expect(rightEdge(chart)).toBe(before);
    expect(chart.timeScale.barSpacing()).toBe(12);
    expect(chart.timeScale.isFollowing()).toBe(false);
  });

  it('keeps following the latest bar when it did', () => {
    const chart = createTestChart();
    chart.data.set(createBars(600), { interval: '1m' });
    chart.timeScale.setBarSpacing(12);
    chart.data.set(createBars(900, T0 + 600 * MINUTE), { interval: '1m' });

    expect(chart.timeScale.isFollowing()).toBe(true);
    expect(chart.timeScale.visibleRange()?.to).toBe(T0 + 1499 * MINUTE);
    expect(chart.timeScale.barSpacing()).toBe(12);
  });

  it('keeps the time across timeframes, in the bar of the timeframe that holds it', () => {
    const chart = scrolledBack();
    chart.data.setTimeframe('1h');

    // 09:30 plus 300 minutes is 14:30, half way through the bar of 14:00.
    const hourly = rightEdge(chart);
    expect(hourly).toBeGreaterThanOrEqual(T0 + 270 * MINUTE);
    expect(hourly).toBeLessThan(T0 + 270 * MINUTE + HOUR);
    expect(chart.timeScale.isFollowing()).toBe(false);

    chart.data.setTimeframe(null);
    expect(Math.abs(rightEdge(chart) - (T0 + 300 * MINUTE))).toBeLessThan(HOUR);
  });

  it('keeps the time as another calendar cuts the bars of the timeframe again', () => {
    const chart = scrolledBack();
    chart.data.setTimeframe('1h');
    const before = rightEdge(chart);
    // Hours of India start half an hour off those of UTC.
    chart.applyOptions({ calendar: { timeZone: 'Asia/Kolkata' } });

    expect(chart.timeScale.isFollowing()).toBe(false);
    expect(Math.abs(rightEdge(chart) - before)).toBeLessThan(HOUR);
  });

  it('keeps the time across transforms that change the bars', () => {
    const chart = scrolledBack();
    chart.transforms.set({ type: 'heikin-ashi' });

    expect(rightEdge(chart)).toBe(T0 + 300.5 * MINUTE);
    expect(chart.timeScale.isFollowing()).toBe(false);
  });

  it('shows the oldest bars for a time before them, and follows for one past the latest', () => {
    const chart = scrolledBack();
    chart.data.set(createBars(600, T0 + 400 * MINUTE), { interval: '1m' });

    expect(chart.timeScale.visibleRange()?.from).toBe(T0 + 400 * MINUTE);
    expect(chart.timeScale.isFollowing()).toBe(false);

    const later = scrolledBack();
    later.data.set(createBars(200, T0), { interval: '1m' });

    expect(later.timeScale.isFollowing()).toBe(true);
    expect(later.timeScale.visibleRange()?.to).toBe(T0 + 199 * MINUTE);
  });
});

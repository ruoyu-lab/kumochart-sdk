import { describe, expect, it } from 'vitest';
import { allDrawings, drawings } from '../../src/drawings';
import { fixedRangeVolumeProfile } from '../../src/volume-profile';
import { click, createModularChart, createTestChart, drag, type Chart } from '../helpers/chart';
import { count, DAY_START, HOUR, hourly } from './helpers';

const TYPE = 'fixed-range-volume-profile';

function hourlyChart(): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' }, timeScale: { barSpacing: 6 } });
  chart.data.set(hourly(72), { interval: '1h' });
  chart.timeScale.fitContent();
  return chart;
}

const point = (hour: number, price: number) => ({ time: DAY_START + hour * HOUR, price });

/** The highest high and the lowest low of the hourly bars `from` to `to`, both included. */
function priceRange(from: number, to: number): { high: number; low: number } {
  const bars = hourly(72).slice(from, to + 1);
  return {
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low))
  };
}

describe('the fixed range volume profile', () => {
  it('comes with every module, and offers its color alone in a form of its settings', () => {
    const chart = hourlyChart();

    expect(chart.drawings.types()).toContain(TYPE);
    expect(chart.drawings.fields(TYPE)).toEqual(['color']);
    expect(createModularChart({ modules: [drawings(allDrawings)] }).drawings.types()).not.toContain(
      TYPE
    );
  });

  it('paints its rows under the bars and its frame over them', () => {
    const chart = hourlyChart();
    const below = count(chart, 'scene', 'fillRect');
    const frames = count(chart, 'objects', 'strokeRect');
    chart.drawings.add({ type: TYPE, points: [point(10, 0), point(30, 0)] });

    // The background, then two rects a row of the 24.
    expect(count(chart, 'scene', 'fillRect') - below).toBe(1 + 2 * 24);
    expect(count(chart, 'objects', 'strokeRect') - frames).toBe(1);
    expect(count(chart, 'objects', 'fillRect')).toBe(0);
  });

  it('spans the time of its anchors and the prices of the bars between them', () => {
    const chart = hourlyChart();
    const id = chart.drawings.add({ type: TYPE, points: [point(30, 95), point(10, 105)] });
    const bounds = chart.drawings.bounds(id);
    const { high, low } = priceRange(10, 30);

    expect(bounds?.x).toBeCloseTo(chart.timeScale.timeToX(point(10, 0).time) ?? Number.NaN);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeCloseTo(
      chart.timeScale.timeToX(point(30, 0).time) ?? Number.NaN
    );
    expect(bounds?.y).toBeCloseTo(chart.priceScale().priceToY(high) ?? Number.NaN);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeCloseTo(
      chart.priceScale().priceToY(low) ?? Number.NaN
    );
  });

  it('is selected by a click inside it, and moved in time by its handles', () => {
    const chart = hourlyChart();
    const id = chart.drawings.add({ type: TYPE, points: [point(10, 0), point(30, 0)] });
    const bounds = chart.drawings.bounds(id);

    const middle = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
    const right = (bounds?.x ?? 0) + (bounds?.width ?? 0);

    click(chart, (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2, middle);
    expect(chart.selection()).toEqual({ kind: 'drawing', id });

    // The handle of the second anchor, halfway up the frame.
    drag(chart, [right, middle], [chart.timeScale.timeToX(point(40, 0).time) ?? 0, middle - 30]);
    expect(chart.drawings.get(id)?.points.map((anchor) => anchor.time)).toEqual([
      point(10, 0).time,
      point(40, 0).time
    ]);

    click(chart, 5, 5);
    expect(chart.selection()).toBeNull();
  });

  it('counts only the bars a running replay has revealed, and spans its anchors without any', () => {
    const chart = hourlyChart();
    const id = chart.drawings.add({ type: TYPE, points: [point(10, 101), point(30, 104)] });
    chart.replay.start(point(20, 0).time);
    const { high, low } = priceRange(10, 20);
    const scale = chart.priceScale();

    expect(chart.drawings.bounds(id)?.y).toBeCloseTo(scale.priceToY(high) ?? Number.NaN);
    expect(chart.drawings.bounds(id)?.height).toBeCloseTo(
      (scale.priceToY(low) ?? 0) - (scale.priceToY(high) ?? 0)
    );

    // Before the range: no bars, so the frame spans its anchors' prices.
    chart.replay.seek(point(5, 0).time);
    expect(chart.drawings.bounds(id)?.y).toBeCloseTo(scale.priceToY(104) ?? Number.NaN);
    expect(chart.drawings.bounds(id)?.height).toBeCloseTo(
      (scale.priceToY(101) ?? 0) - (scale.priceToY(104) ?? 0)
    );
  });

  it('takes its options for every drawing of the type, and checks them', () => {
    const chart = createModularChart({
      modules: [drawings([fixedRangeVolumeProfile({ rows: 16, width: 0.3, pocColor: '#f0a' })])],
      calendar: { timeZone: 'UTC' }
    });
    chart.data.set(hourly(72), { interval: '1h' });
    const below = count(chart, 'scene', 'fillRect');
    chart.drawings.add({ type: TYPE, points: [point(10, 0), point(30, 0)] });
    chart.drawings.add({ type: TYPE, points: [point(40, 0), point(50, 0)] });

    expect(count(chart, 'scene', 'fillRect') - below).toBe(2 * (1 + 2 * 16));
    expect(() => fixedRangeVolumeProfile({ width: 0 })).toThrow(
      'fixedRangeVolumeProfile() options.width must be greater than 0, received 0.'
    );
    expect(() => fixedRangeVolumeProfile({ rows: 0 })).toThrow(
      'fixedRangeVolumeProfile() options.rows must be at least 1'
    );
    expect(() => fixedRangeVolumeProfile({ upColor: '' })).toThrow(
      'fixedRangeVolumeProfile() options.upColor must be a non-empty string'
    );
  });
});

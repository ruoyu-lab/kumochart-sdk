import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import { Clock } from '../../src/format/clock';
import { buildTimeTicks, TimeMarks } from '../../src/scales/time-ticks';
import { TimeScale } from '../../src/scales/time-scale';
import { createBars } from '../helpers/bars';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function setup(count: number, start: number, interval: number, width: number, spacing: number) {
  const store = new BarStore();
  store.set(createBars(count, start, interval));
  const scale = new TimeScale({ minBarSpacing: 0.5, maxBarSpacing: 50, rightOffset: 0 }, spacing);
  scale.setWidth(width);
  scale.setBarCount(store.length, 'reset');
  const marks = new TimeMarks(store, new Clock('UTC'));
  return { store, scale, marks };
}

describe('time ticks', () => {
  it('prefers month and year boundaries on daily bars', () => {
    const { scale, store, marks } = setup(400, Date.UTC(2023, 0, 1), DAY, 600, 1.5);
    const ticks = buildTimeTicks(scale, store, marks, 40);
    const units = new Set(ticks.map((tick) => tick.unit));

    expect(units.has('year')).toBe(true);
    expect(units.has('month')).toBe(true);
    ticks.forEach((tick, index) => {
      const next = ticks[index + 1];

      if (next) {
        expect(next.x - tick.x).toBeGreaterThanOrEqual(40);
      }
    });
  });

  it('labels intraday bars with day and hour boundaries', () => {
    const { scale, store, marks } = setup(200, Date.UTC(2024, 4, 1, 20), 15 * 60_000, 800, 8);
    const ticks = buildTimeTicks(scale, store, marks, 50);
    const dayTick = ticks.find((tick) => tick.unit === 'day');

    expect(dayTick).toBeDefined();
    expect(new Date(dayTick!.time).getUTCHours()).toBe(0);
    expect(ticks.some((tick) => tick.unit === 'hour')).toBe(true);
  });

  it('recomputes weights after the data changes', () => {
    const { scale, store, marks } = setup(10, Date.UTC(2024, 0, 1), DAY, 400, 20);
    buildTimeTicks(scale, store, marks, 30);
    store.set(createBars(10, Date.UTC(2024, 0, 28), DAY));
    scale.setBarCount(store.length, 'reset');
    const ticks = buildTimeTicks(scale, store, marks, 30);

    expect(ticks.find((tick) => tick.unit === 'month')?.time).toBe(Date.UTC(2024, 1, 1));
  });

  it('honours the configured time zone', () => {
    const store = new BarStore();
    store.set(createBars(48, Date.UTC(2024, 0, 1, 0), HOUR));
    const shanghai = new TimeMarks(store, new Clock('Asia/Shanghai'));
    const midnightShanghai = store.indexOf(Date.UTC(2024, 0, 1, 16));

    expect(shanghai.weight(midnightShanghai)).toBeGreaterThanOrEqual(70);
  });
});

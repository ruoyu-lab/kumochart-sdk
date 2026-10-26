import { describe, expect, it } from 'vitest';
import { toTime } from '../../src/data/time';
import type { BarInput } from '../../src/data/types';
import { createCalendar, type Calendar } from '../../src/feed/calendar';
import { computeIndicator, RVOL } from '../../src/indicators';
import { BTCUSDT } from '../helpers/market';
import { compute, expectClose, incrementalMatchesFull, UTC_DAYS } from './helpers';
import { divide, N, walk } from './reference';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ANCHORS = ['1D', '1W', '1M', '3M', '12M'];

/** A bar `hours` after 1 January 2024 UTC, with a volume. */
function at(hours: number, volume: number): Required<BarInput> {
  return {
    time: Date.UTC(2024, 0, 1) + hours * HOUR,
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    volume
  };
}

/**
 * Relative volume at time, from its definition: each bar's period starts where the calendar
 * starts a new one; in each of the `length` periods before, the bars that started by the same
 * time after the period's start count, and the latest of them gives the value (its volume, or
 * the volume of its period up to it); periods without such a bar are left out.
 */
function relativeVolume(
  bars: readonly Required<BarInput>[],
  calendar: Calendar,
  anchor: string,
  length: number,
  cumulative: boolean
): number[][] {
  const periods: { start: number; bars: number[] }[] = [];
  const periodOf = bars.map((bar, index) => {
    const start = calendar.bucket(bar.time, anchor);
    const last = periods[periods.length - 1];

    if (start !== null && start !== last?.start) {
      periods.push({ start, bars: [index] });
    } else {
      last?.bars.push(index);
    }

    return periods.length - 1;
  });
  const volume = (indexes: readonly number[]) =>
    cumulative
      ? indexes.reduce((total, index) => total + (bars[index]?.volume ?? N), 0)
      : (bars[indexes[indexes.length - 1] ?? -1]?.volume ?? N);
  const columns: number[][] = [[], [], []];

  bars.forEach((bar, index) => {
    const position = periodOf[index] ?? -1;
    const period = periods[position];

    if (!period) {
      columns.forEach((column) => column.push(N));
      return;
    }

    const offset = toTime(bar.time) - period.start;
    const current = volume(period.bars.filter((each) => each <= index));
    const values = periods
      .slice(Math.max(0, position - length), position)
      .map((past) =>
        past.bars.filter((each) => toTime(bars[each]?.time ?? N) - past.start <= offset)
      )
      .filter((within) => within.length > 0)
      .map(volume);
    const past =
      position < length || values.length === 0
        ? N
        : values.reduce((total, value) => total + value, 0) / values.length;
    columns[0]?.push(divide(current, past));
    columns[1]?.push(current);
    columns[2]?.push(past);
  });

  return columns;
}

describe('RVOL', () => {
  // Day 1 at 00:00, 01:00, 02:00; day 2 at 00:00 and 02:00 (none at 01:00); day 3 at 00:00 to
  // 03:00.
  const bars = [
    at(0, 10),
    at(1, 20),
    at(2, 30),
    at(24, 40),
    at(26, 60),
    at(48, 20),
    at(49, 20),
    at(50, 20),
    at(51, 10)
  ];

  it('compares the volume of the day so far with that of the days before by then', () => {
    // Day 3 at 00:00: 20 against (10 + 40) / 2. At 01:00: 40 against (30 + 40) / 2, day 2
    // having no bar at 01:00 but the one at 00:00. At 02:00: 60 against (60 + 100) / 2; at
    // 03:00, after the last bars of days 1 and 2, 70 against the same.
    const values = compute('RVOL', bars, { period: 2 });
    expectClose(values.relativeVolumeRatio ?? [], [N, N, N, N, N, 0.8, 8 / 7, 0.75, 0.875]);
    expectClose(values.currentVolume ?? [], [10, 30, 60, 40, 100, 20, 40, 60, 70]);
    expectClose(values.pastVolume ?? [], [N, N, N, N, N, 25, 35, 80, 80]);
  });

  it('compares the volume of each bar in regular mode', () => {
    // Day 3 against (10 + 40) / 2, (20 + 40) / 2, (30 + 60) / 2 and the same.
    const values = compute('RVOL', bars, { period: 2, mode: 1 });
    expectClose(values.relativeVolumeRatio ?? [], [N, N, N, N, N, 0.8, 2 / 3, 4 / 9, 2 / 9]);
    expectClose(values.currentVolume ?? [], [10, 20, 30, 40, 60, 20, 20, 20, 10]);
    expectClose(values.pastVolume ?? [], [N, N, N, N, N, 25, 30, 45, 45]);
  });

  it('leaves out a past day without a bar by then, as the first day may be', () => {
    // The bars start at 02:00 of day 1: by 00:00 and 01:00 only day 2 counts, by 02:00 day 1
    // too, with the 30 of its one bar.
    const values = compute('RVOL', bars.slice(2), { period: 2 });
    expectClose(values.pastVolume ?? [], [N, N, N, 40, 40, 65, 65]);
    expectClose(values.relativeVolumeRatio ?? [], [N, N, N, 0.5, 1, 12 / 13, 14 / 13]);
  });

  it('compares each bar with the bars before when the anchor is no longer than the bars', () => {
    // On daily bars, each day is a period of its own of one bar.
    const days = [10, 20, 30, 60].map((volume, index) => at(index * 24, volume));
    const values = compute('RVOL', days, { period: 2 });
    expectClose(values.relativeVolumeRatio ?? [], [N, N, 2, 60 / 25]);
    expectClose(
      values.relativeVolumeRatio ?? [],
      compute('RVOL', days, { period: 2, mode: 1 }).relativeVolumeRatio ?? []
    );
  });

  it('follows the trading days of the calendar', () => {
    // In Shanghai a day starts at 16:00 UTC.
    const shanghai = createCalendar({ timeZone: 'Asia/Shanghai' });
    const input = walk(600);
    const values = compute('RVOL', input, {}, shanghai).relativeVolumeRatio ?? [];
    expectClose(values, relativeVolume(input, shanghai, '1D', 5, true)[0] ?? [], 9);
    expect(values).not.toEqual(compute('RVOL', input).relativeVolumeRatio);
  });

  describe('matches the reference', () => {
    const hours = BTCUSDT['1h'];
    const days = BTCUSDT['1d'];
    const cases: [name: string, bars: Required<BarInput>[], anchor: number, length: number][] = [
      ['a random walk', walk(600), 0, 10],
      ['a random walk', walk(600), 1, 2],
      ['BTCUSDT 1h', hours, 0, 10],
      ['BTCUSDT 1h', hours, 1, 5],
      ['BTCUSDT 1h', hours, 2, 1],
      ['BTCUSDT 1d', days, 0, 10],
      ['BTCUSDT 1d', days, 1, 10],
      ['BTCUSDT 1d', days, 2, 3],
      ['BTCUSDT 1d', days, 3, 2],
      ['BTCUSDT 1d', days, 4, 1]
    ];

    it.each(cases)('on %s, anchor %i, length %i, in both modes', (_name, input, anchor, period) => {
      for (const mode of [0, 1]) {
        const values = compute('RVOL', input, { anchor, period, mode });
        const expected = relativeVolume(input, UTC_DAYS, ANCHORS[anchor] ?? '', period, mode === 0);
        ['relativeVolumeRatio', 'currentVolume', 'pastVolume'].forEach((key, column) => {
          const actual = values[key] ?? [];
          const target = expected[column] ?? [];
          expect(actual.map(Number.isNaN), `${mode} ${key}`).toEqual(target.map(Number.isNaN));
          actual.forEach((value, bar) => {
            const goal = target[bar] ?? N;

            if (!Number.isNaN(goal)) {
              expect(Math.abs(value - goal), `${mode} ${key} ${bar}`).toBeLessThanOrEqual(
                1e-9 * Math.max(1, Math.abs(goal))
              );
            }
          });
        });
        expect(values.relativeVolumeRatio?.some((value) => !Number.isNaN(value))).toBe(true);
      }
    });
  });

  it('has the anchor Day, the length 5 and the cumulative mode by default', () => {
    const input = BTCUSDT['1h'];
    const values = compute('RVOL', input);
    const expected = relativeVolume(input, UTC_DAYS, '1D', 5, true);
    expectClose(values.relativeVolumeRatio ?? [], expected[0] ?? [], 9);
    // Five days before the first value, the first of them partly: the bars start at 16:00 UTC.
    const first = values.relativeVolumeRatio?.findIndex((value) => !Number.isNaN(value)) ?? -1;
    const start = input[0]?.time ?? 0;
    expect(input[first]?.time).toBe(start - (start % DAY) + 5 * DAY);
  });

  it('gives the same values bar by bar, a copy keeping the day in progress', () => {
    for (const mode of [0, 1]) {
      const { full, incremental } = incrementalMatchesFull('RVOL', BTCUSDT['1h'], { mode });

      for (const [key, values] of Object.entries(full)) {
        expectClose(incremental[key] ?? [], values, 6);
      }
    }
  });

  it('computes without a chart with the calendar given', () => {
    const input = BTCUSDT['1h'];
    const { relativeVolumeRatio } = computeIndicator(RVOL, input, { calendar: UTC_DAYS });
    expectClose(relativeVolumeRatio ?? [], compute('RVOL', input).relativeVolumeRatio ?? [], 12);
  });
});

import { describe, expect, it } from 'vitest';
import { Clock } from '../../src/format/clock';
import { decimalsOf, Formatter } from '../../src/format/formatter';

describe('Clock', () => {
  it('converts instants to calendar fields of a time zone across DST', () => {
    const clock = new Clock('America/New_York');

    expect(clock.fields(Date.UTC(2024, 0, 15, 17, 30))).toMatchObject({ hour: 12, minute: 30 });
    expect(clock.fields(Date.UTC(2024, 6, 15, 16, 30))).toMatchObject({ hour: 12, minute: 30 });
  });
});

describe('Formatter', () => {
  const formatter = new Formatter('en-US', 'UTC');

  it('formats numbers with a fixed precision', () => {
    expect(formatter.number(1234.5, 2)).toBe('1,234.50');
    expect(formatter.number(0.000123, 6)).toBe('0.000123');
  });

  it('formats volumes compactly', () => {
    expect(formatter.compact(1_250_000)).toBe('1.25M');
    expect(formatter.compact(12.345)).toBe('12.35');
    expect(formatter.compact(0)).toBe('0');
  });

  it('keeps three significant digits of compact values under 1, however small', () => {
    expect(formatter.compact(0.004)).toBe('0.004');
    expect(formatter.compact(-0.000123456)).toBe('-0.000123');
    expect(formatter.compact(4.1234e-10)).toBe('4.12E-10');
    expect(formatter.compact(-2e-10)).toBe('-2E-10');
  });

  it('formats tick labels per calendar unit', () => {
    const time = Date.UTC(2024, 2, 9, 14, 5);

    expect(formatter.timeTick(time, 'year')).toBe('2024');
    expect(formatter.timeTick(time, 'month')).toBe('Mar');
    expect(formatter.timeTick(time, 'day')).toBe('9');
    expect(formatter.timeTick(time, 'minute')).toBe('14:05');
  });

  it('formats countdowns', () => {
    expect(formatter.duration(65_000, (count) => `${count}d`)).toBe('01:05');
    expect(formatter.duration(3_725_000, (count) => `${count}d`)).toBe('1:02:05');
    expect(formatter.duration(2 * 86_400_000, (count) => `${count}d`)).toBe('2d 00:00:00');
  });
});

describe('decimalsOf', () => {
  it('finds the decimals needed by the values', () => {
    const decimals = (values: readonly number[]) =>
      values.reduce((atLeast, value) => decimalsOf(value, atLeast), 0);

    expect(decimals([1, 2, 3])).toBe(0);
    expect(decimals([1.5, 2.25])).toBe(2);
    expect(decimals([2.25, 1.5])).toBe(2);
    expect(decimals([0.1 + 0.2])).toBe(1);
    expect(decimals([123456.7891])).toBe(4);
    expect(decimals([Math.PI])).toBe(8);
    expect(decimalsOf(Number.NaN, 3)).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { shiftStart, withRoom, type Column } from '../../src/data/columns';

const valuesOf = (column: Column, count: number) => Array.from(column.subarray(0, count));

describe('columns', () => {
  it('takes values before the first page after page, copying them only now and then', () => {
    let column: Column = Float64Array.from([1000, 1001]);
    let count = 2;
    const memories = new Set<ArrayBufferLike>([column.buffer]);

    for (let page = 99; page >= 0; page -= 1) {
      column = shiftStart(column, count, 10);
      column.set(
        Array.from({ length: 10 }, (_, index) => page * 10 + index),
        0
      );
      count += 10;
      memories.add(column.buffer);
    }

    expect(valuesOf(column, count)).toEqual([
      ...Array.from({ length: 1000 }, (_, index) => index),
      1000,
      1001
    ]);
    // Each copy leaves room for half as many values again: a few copies, not one a page.
    expect(memories.size).toBeLessThan(15);
  });

  it('keeps the room at one end as the column grows at the other', () => {
    let column = shiftStart(Float64Array.from([1, 2, 3]), 3, 1);
    column[0] = 0;
    column = withRoom(column, 4, 100);
    const memory = column.buffer;
    column[4] = 4;

    column = shiftStart(column, 5, 1);
    column[0] = -1;

    expect(column.buffer).toBe(memory);
    expect(valuesOf(column, 6)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(column.length).toBeGreaterThanOrEqual(100);
  });

  it('drops values from the front in place', () => {
    const start = Float64Array.from([1, 2, 3, 4]);
    const column = shiftStart(start, 4, -2);

    expect(column.buffer).toBe(start.buffer);
    expect(valuesOf(column, 2)).toEqual([3, 4]);
  });
});

/** A column of numbers: a view of memory that may have room to spare before and after it. */
export type Column = Float64Array<ArrayBuffer>;

const BYTES = Float64Array.BYTES_PER_ELEMENT;

/** How many values fit before the start of a column, in the memory it views. */
function roomBefore(column: Column): number {
  return column.byteOffset / BYTES;
}

/**
 * The first `count` values of `column` in new memory: a column of `length` values with room for
 * `before` more in front of it.
 */
function moved(column: Column, count: number, before: number, length: number): Column {
  const next = new Float64Array(new ArrayBuffer((before + length) * BYTES), before * BYTES, length);
  next.set(column.subarray(0, count));
  return next;
}

/**
 * `column`, holding `count` values, with room for `size` from its start: itself when it has the
 * room, otherwise a copy twice as long, which keeps the room in front of it.
 */
export function withRoom(column: Column, count: number, size: number): Column {
  if (size <= column.length) {
    return column;
  }

  return moved(column, count, roomBefore(column), Math.max(16, column.length * 2, size));
}

/**
 * `column`, holding `count` values, starting `shift` values earlier (later when negative), its
 * values that much further on: the same memory when the room in front of it allows, otherwise a
 * copy with room in front for half as many values again, so that adding values before the first
 * costs those values alone on average, not a copy of every value each time.
 */
export function shiftStart(column: Column, count: number, shift: number): Column {
  const base =
    roomBefore(column) >= shift
      ? column
      : moved(column, count, shift + ((count + shift) >> 1), Math.max(16, column.length));
  return new Float64Array(base.buffer, base.byteOffset - shift * BYTES, base.length + shift);
}

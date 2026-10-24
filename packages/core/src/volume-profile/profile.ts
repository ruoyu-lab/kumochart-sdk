import { BarStore } from '../data/bar-store';
import type { BarInput, BarsView } from '../data/types';
import { fail } from '../utils/errors';
import { checkFields, checkNumber, fieldsOf } from '../utils/validate';

/** One price row of a volume profile: the volume traded between `low` and `high`. */
export interface VolumeProfileRow {
  readonly low: number;
  readonly high: number;
  /** Volume of the bars that closed at or above their open. */
  readonly up: number;
  /** Volume of the bars that closed below their open. */
  readonly down: number;
}

/** The volume traded at each price of a run of bars, as {@link computeVolumeProfile} gives it. */
export interface VolumeProfileData {
  /** Rows of one height, from the lowest price to the highest. */
  readonly rows: readonly VolumeProfileRow[];
  /** The volume of every row together. */
  readonly total: number;
  /** Index of the row with the most volume, the point of control, as {@link pointOfControl}. */
  readonly poc: number;
  /** Indices of the first and the last row of the value area, as {@link valueAreaOf}. */
  readonly valueArea: { readonly low: number; readonly high: number };
}

/** The price rows of a volume profile: `count` rows `step` high, from `bottom` up. */
export interface VolumeProfileGrid {
  readonly bottom: number;
  readonly step: number;
  readonly count: number;
}

/** Options of {@link computeVolumeProfile}. */
export interface VolumeProfileOptions {
  /** Number of price rows, from 1 to 1000. Default 24. */
  rows?: number;
  /** Share of the volume in the value area, above 0 and at most 1. Default 0.7. */
  valueArea?: number;
}

export const DEFAULT_ROWS = 24;
export const DEFAULT_VALUE_AREA = 0.7;
/** Past this many rows, rows are too thin to be seen or read. */
const MAX_ROWS = 1000;

const OPTION_FIELDS = fieldsOf<VolumeProfileOptions>({ rows: true, valueArea: true });

export function checkRows(path: string, value: unknown): number {
  return checkNumber(path, value, { min: 1, max: MAX_ROWS, integer: true });
}

/** A share of a whole, such as the value area's of the volume: above 0 and at most 1. */
export function checkShare(path: string, value: unknown): number {
  return checkNumber(path, value, { min: 0, exclusiveMin: true, max: 1 });
}

/**
 * The rows and the value area of options as {@link computeVolumeProfile} takes them, checked,
 * with their defaults; `label` names the options in errors. Other fields are left to the caller,
 * for a profile of its own, such as one of trades.
 */
export function checkVolumeProfileOptions(
  options: VolumeProfileOptions,
  label: string
): Required<VolumeProfileOptions> {
  return {
    rows: options.rows === undefined ? DEFAULT_ROWS : checkRows(`${label}.rows`, options.rows),
    valueArea:
      options.valueArea === undefined
        ? DEFAULT_VALUE_AREA
        : checkShare(`${label}.valueArea`, options.valueArea)
  };
}

/**
 * The point of control of the volumes of rows, from the lowest price up: the row with the most
 * volume. Of rows with as much, the one nearest the middle, and of two as near, the upper one.
 */
export function pointOfControl(volumes: ArrayLike<number>): number {
  if (volumes.length === 0) {
    fail('pointOfControl() needs the volume of one row at least.');
  }

  const middle = (volumes.length - 1) / 2;
  let poc = 0;

  for (let row = 1; row < volumes.length; row += 1) {
    const volume = volumes[row] ?? 0;
    const best = volumes[poc] ?? 0;

    if (volume > best || (volume === best && Math.abs(row - middle) <= Math.abs(poc - middle))) {
      poc = row;
    }
  }

  return poc;
}

/**
 * The value area of the volumes of rows, from the lowest price up, around the point of control
 * `poc`: from it, the row above or the row below the area, whichever has more volume (the nearer
 * one to `poc` on a tie, the upper one when as near), joins the area while the area stays within
 * `share` of the whole volume, and it stops at the first that would take it past. Gives the
 * indices of its first and last row.
 */
export function valueAreaOf(
  volumes: ArrayLike<number>,
  poc: number,
  share = DEFAULT_VALUE_AREA
): { low: number; high: number } {
  checkNumber('poc', poc, { min: 0, max: volumes.length - 1, integer: true });
  checkShare('share', share);
  let total = 0;

  for (let row = 0; row < volumes.length; row += 1) {
    total += volumes[row] ?? 0;
  }

  const target = total * share;
  let volume = volumes[poc] ?? 0;
  let low = poc;
  let high = poc;

  while (low > 0 || high < volumes.length - 1) {
    const above = high < volumes.length - 1 ? (volumes[high + 1] ?? 0) : -1;
    const below = low > 0 ? (volumes[low - 1] ?? 0) : -1;
    const up = above > below || (above === below && high + 1 - poc <= poc - (low - 1));
    const next = up ? above : below;

    if (volume + next > target) {
      break;
    }

    volume += next;

    if (up) {
      high += 1;
    } else {
      low -= 1;
    }
  }

  return { low, high };
}

function isBarArray(bars: BarsView | readonly BarInput[]): bars is readonly BarInput[] {
  return Array.isArray(bars);
}

/** {@link volumeProfileGrid} of checked arguments, `high` at least `low`. */
function gridOf(low: number, high: number, count: number): VolumeProfileGrid {
  // Prices all at one still get rows of some height around it.
  const span = high > low ? high - low : Math.max(Math.abs(high) * 1e-3, 1e-9);
  return { bottom: high > low ? low : low - span / 2, step: span / count, count };
}

/**
 * The rows a volume profile divides the prices from `low` to `high` into, as
 * {@link computeVolumeProfile} divides those of bars: `rows` of one height, from 1 to 1000. For a
 * profile of your own, such as one of trades, to match the chart's. `null` without a range.
 */
export function volumeProfileGrid(
  low: number,
  high: number,
  rows: number
): VolumeProfileGrid | null {
  checkRows('rows', rows);
  return high >= low ? gridOf(low, high, rows) : null;
}

/**
 * The volume profile of the bars `[from, to)`: a chart's, such as `chart.data.source`, or bars
 * of your own, checked as `chart.data.set()` checks them. Each bar's volume is spread evenly over
 * its range from low to high, so finer bars give a sharper profile. `null` when the bars hold no
 * volume. Runs anywhere, Node included.
 */
export function computeVolumeProfile(
  bars: BarsView | readonly BarInput[],
  from: number,
  to: number,
  options: VolumeProfileOptions = {}
): VolumeProfileData | null {
  checkFields('options', options, OPTION_FIELDS);
  const { rows, valueArea } = checkVolumeProfileOptions(options, 'options');
  checkNumber('from', from, { integer: true });
  checkNumber('to', to, { integer: true });
  let view: BarsView;

  if (isBarArray(bars)) {
    const store = new BarStore();
    store.set(bars);
    view = store;
  } else {
    view = bars;
  }

  return profileOf(view, from, to, rows, valueArea);
}

/** {@link computeVolumeProfile} of checked arguments. */
export function profileOf(
  bars: BarsView,
  from: number,
  to: number,
  count: number,
  share: number
): VolumeProfileData | null {
  const start = Math.max(0, from);
  const end = Math.min(bars.length, to);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = start; index < end; index += 1) {
    min = Math.min(min, bars.low(index));
    max = Math.max(max, bars.high(index));
  }

  if (!(max >= min)) {
    return null;
  }

  const { bottom, step } = gridOf(min, max, count);
  const up = new Float64Array(count);
  const down = new Float64Array(count);

  for (let index = start; index < end; index += 1) {
    const volume = bars.volume(index);

    if (!(volume > 0)) {
      continue;
    }

    const target = bars.close(index) >= bars.open(index) ? up : down;
    const low = bars.low(index);
    const high = bars.high(index);
    const first = Math.min(count - 1, Math.max(0, Math.floor((low - bottom) / step)));
    const last = Math.min(count - 1, Math.max(0, Math.floor((high - bottom) / step)));

    if (first === last || high === low) {
      target[first] = (target[first] ?? 0) + volume;
      continue;
    }

    for (let row = first; row <= last; row += 1) {
      const rowLow = bottom + row * step;
      const overlap = Math.min(high, rowLow + step) - Math.max(low, rowLow);

      if (overlap > 0) {
        target[row] = (target[row] ?? 0) + (volume * overlap) / (high - low);
      }
    }
  }

  const totals = new Float64Array(count);
  let total = 0;

  for (let row = 0; row < count; row += 1) {
    totals[row] = (up[row] ?? 0) + (down[row] ?? 0);
    total += totals[row] ?? 0;
  }

  if (!(total > 0)) {
    return null;
  }

  const poc = pointOfControl(totals);
  return {
    rows: Array.from({ length: count }, (_, row) => ({
      low: bottom + row * step,
      high: bottom + (row + 1) * step,
      up: up[row] ?? 0,
      down: down[row] ?? 0
    })),
    total,
    poc,
    valueArea: valueAreaOf(totals, poc, share)
  };
}

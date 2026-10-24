import type { Bar } from '../data/types';
import { checkBoolean, checkNumber, checkOneOf } from '../utils/validate';
import { sizedStream, sizeRuleOf } from './box-sizes';
import type { BarTransformDefinition, BarTransformStream } from '../feed/transform';
import { checkKeys } from './transforms';

/** What a point & figure chart is plotted from: the closes, or the highs and lows. */
export type PointFigureSource = 'close' | 'hl';

const SOURCES: readonly PointFigureSource[] = ['close', 'hl'];

interface Settings {
  readonly box: number;
  /** Boxes a reversal takes. */
  readonly reversal: number;
  readonly source: PointFigureSource;
  readonly oneStepBack: boolean;
}

/**
 * A column, its boxes counted in boxes from zero, so levels never gather rounding errors. A
 * column turned one step back starts with its one box the other way.
 */
interface Column {
  time: number;
  /** Rising (X) or falling (O): the way its boxes after the first go. */
  rising: boolean;
  first: number;
  last: number;
  volume: number;
}

interface PointFigureState {
  /** The first open, which the first column starts from; `NaN` before the first bar. */
  start: number;
  startTime: number;
  column: Column | null;
  /**
   * Volume of the bars since the column's last box, from the start while there is no column:
   * the column it goes on with, or the next one, takes it.
   */
  pending: number;
}

/** Box levels within a rounding error of a price count as reached. */
const EPSILON = 1e-9;

/**
 * Columns of X's and O's. Boxes sit on multiples of
 * the box size; an X fills the box at or under the price, an O the box at or over it. A column
 * goes on while the price fills another box its way and turns when the price comes back
 * `reversal` boxes from its last box, the new column starting a box from it. With the highs and
 * lows, a rising column checks the high first and only then the low, a falling one the other way
 * round. The first column starts from the first open once the price is `reversal` boxes away. A
 * column holds the volume of the bars after the last box before it up to its own last box, so
 * the columns hold every bar's volume, as Renko bricks do.
 */
class PointFigureStream implements BarTransformStream {
  constructor(
    private readonly settings: Settings,
    private readonly state: PointFigureState
  ) {}

  next(bar: Bar): readonly Bar[] {
    const state = this.state;
    const { box, reversal, source } = this.settings;

    // The chart starts from the first bar's open, and that bar may already start the first column.
    if (Number.isNaN(state.start)) {
      state.start = bar.open;
      state.startTime = bar.time;
    }

    // The boxes an X and an O of the high and the low would fill.
    const up = Math.floor((source === 'hl' ? bar.high : bar.close) / box + EPSILON);
    const down = Math.ceil((source === 'hl' ? bar.low : bar.close) / box - EPSILON);
    const column = state.column;

    if (!column) {
      state.pending += bar.volume;
      const from = state.start / box;

      if (up >= Math.floor(from + EPSILON) + reversal) {
        state.column = this.open(state.startTime, true, Math.floor(from + EPSILON), up);
      } else if (down <= Math.ceil(from - EPSILON) - reversal) {
        state.column = this.open(state.startTime, false, Math.ceil(from - EPSILON), down);
      }

      return [];
    }

    const further = column.rising ? up >= column.last + 1 : down <= column.last - 1;
    const back = column.rising ? down <= column.last - reversal : up >= column.last + reversal;

    if (further) {
      column.last = column.rising ? up : down;
      column.volume += state.pending + bar.volume;
      state.pending = 0;
      return [];
    }

    state.pending += bar.volume;

    if (!back) {
      return [];
    }

    const target = column.rising ? down : up;

    // One step back: a column of one box turns within itself, starting with that box.
    if (this.settings.oneStepBack && column.first === column.last) {
      column.rising = !column.rising;
      column.last = target;
      column.volume += state.pending;
      state.pending = 0;
      return [];
    }

    const first = column.rising ? column.last - 1 : column.last + 1;
    state.column = this.open(bar.time, !column.rising, first, target);
    return [this.bar(column)];
  }

  current(): Bar | null {
    return this.state.column ? this.bar(this.state.column) : null;
  }

  clone(): BarTransformStream {
    const column = this.state.column;
    return new PointFigureStream(this.settings, {
      ...this.state,
      column: column ? { ...column } : null
    });
  }

  resolved(): Readonly<Record<string, unknown>> {
    const { box, reversal, source, oneStepBack } = this.settings;
    return { box, reversal, source, oneStepBack };
  }

  private open(time: number, rising: boolean, first: number, last: number): Column {
    const volume = this.state.pending;
    this.state.pending = 0;
    return { time, rising, first, last, volume };
  }

  /** A column as a bar: from the level of its first box (`open`) to its last (`close`). */
  private bar(column: Column): Bar {
    // Levels written out exactly: box 0.1 times 3 is 0.3.
    const level = (boxes: number) => Number((boxes * this.settings.box).toPrecision(12));
    const open = level(column.first);
    const close = level(column.last);
    return {
      time: column.time,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: column.volume
    };
  }
}

/**
 * Point & figure columns, each bar one column from the level of its first box (`open`) to its
 * last (`close`). Parameters: the box size, `box` fixed, `percentage` of the last close, or
 * otherwise, by default, the average true range over `atrLength` bars (14); `reversal`, the boxes a turn takes (3); `source`, `close` or `hl` for the highs and
 * lows; `oneStepBack`, which lets a one-box column turn within itself. Draw them with the
 * `point-figure` series type.
 */
export const pointFigureTransform: BarTransformDefinition = {
  type: 'point-figure',
  name: 'Point & figure',
  keepsTime: false,
  create: (params, input, from) => {
    checkKeys('point-figure', params, [
      'box',
      'percentage',
      'atrLength',
      'reversal',
      'source',
      'oneStepBack'
    ]);
    const rule = sizeRuleOf('point-figure', 'box', params, from);
    const settings: Omit<Settings, 'box'> = {
      reversal:
        params.reversal === undefined
          ? 3
          : checkNumber('params.reversal', params.reversal, { min: 1, max: 100, integer: true }),
      source:
        params.source === undefined ? 'close' : checkOneOf('params.source', params.source, SOURCES),
      oneStepBack:
        params.oneStepBack === undefined
          ? false
          : checkBoolean('params.oneStepBack', params.oneStepBack)
    };
    return sizedStream(
      rule,
      input,
      (box) =>
        new PointFigureStream(
          { ...settings, box },
          { start: Number.NaN, startTime: Number.NaN, column: null, pending: 0 }
        )
    );
  }
};

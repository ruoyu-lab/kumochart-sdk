import type { Bar } from '../data/types';
import { checkBoolean, checkOneOf } from '../utils/validate';
import { sizedStream, sizeRuleOf } from './box-sizes';
import type { BarTransformDefinition, BarTransformStream } from '../feed/transform';
import { checkKeys, checkSteps } from './transforms';

/** What Renko bricks are built from: the closes, or the open, high, low and close of each bar. */
export type RenkoSource = 'close' | 'ohlc';

const SOURCES: readonly RenkoSource[] = ['close', 'ohlc'];

interface Settings {
  readonly box: number;
  readonly source: RenkoSource;
  readonly wicks: boolean;
}

interface RenkoState {
  /**
   * Bottom and top of the last brick, counted in boxes from zero, so levels never gather
   * rounding errors; `NaN` before the first price.
   */
  bottom: number;
  top: number;
  /** Volume of the prices since the one that made the last bricks. */
  volume: number;
  /** The highest and lowest of those prices, which the next brick's wick reaches. */
  high: number;
  low: number;
}

/** Levels within a rounding error of a price count as reached. */
const EPSILON = 1e-9;

/**
 * Bricks on a grid of multiples of the box: the first price stands
 * in the box it is in, and a brick forms when a price is a box beyond the last brick, so a
 * reversal takes two boxes. Each bar gives its close, or with `ohlc` its open, low, high and
 * close when it rose and its open, high, low and close when it fell, each with an equal share of
 * its volume. A brick is timed at the bar of the price that made it and holds the volume since
 * the price that made the bricks before, shared by the bricks one price makes. The first of them
 * has a wick to the highest or lowest price since then, where that went more than a box past its
 * open the other way: an up brick to a low under the brick below it, a down brick to a high over
 * the brick above it.
 */
class RenkoStream implements BarTransformStream {
  constructor(
    private readonly settings: Settings,
    private readonly state: RenkoState
  ) {}

  next(bar: Bar): readonly Bar[] {
    const state = this.state;
    const prices =
      this.settings.source === 'close'
        ? [bar.close]
        : bar.close >= bar.open
          ? [bar.open, bar.low, bar.high, bar.close]
          : [bar.open, bar.high, bar.low, bar.close];
    const bricks: Bar[] = [];

    for (const price of prices) {
      state.volume += bar.volume / prices.length;
      state.high = Math.max(state.high, price);
      state.low = Math.min(state.low, price);
      this.reach(price, bar.time, bricks);
    }

    return bricks;
  }

  current(): Bar | null {
    return null;
  }

  clone(): BarTransformStream {
    return new RenkoStream(this.settings, { ...this.state });
  }

  resolved(): Readonly<Record<string, unknown>> {
    const { box, source, wicks } = this.settings;
    return { box, source, wicks };
  }

  /** Adds the bricks a price makes to `bricks`. */
  private reach(price: number, time: number, bricks: Bar[]): void {
    const state = this.state;
    const box = this.settings.box;
    const level = price / box;

    if (Number.isNaN(state.bottom)) {
      state.bottom = Math.floor(level + EPSILON);
      state.top = state.bottom + 1;
    }

    checkSteps('renko', box, Math.max(price - state.top * box, state.bottom * box - price));
    // The bricks as the boxes they go from and to.
    const made: [number, number][] = [];

    while (level >= state.top + 1 - EPSILON) {
      made.push([state.top, state.top + 1]);
      state.bottom = state.top;
      state.top += 1;
    }

    while (level <= state.bottom - 1 + EPSILON) {
      made.push([state.bottom, state.bottom - 1]);
      state.top = state.bottom;
      state.bottom -= 1;
    }

    if (made.length === 0) {
      return;
    }

    // Levels written out exactly: box 0.1 times 3 is 0.3.
    const at = (boxes: number) => Number((boxes * box).toPrecision(12));
    const volume = state.volume / made.length;

    made.forEach(([from, to], index) => {
      const open = at(from);
      const close = at(to);
      const wick = this.settings.wicks && index === 0;
      const rising = to > from;
      bricks.push({
        time,
        open,
        high:
          wick && !rising && state.high / box > from + 1 + EPSILON
            ? state.high
            : Math.max(open, close),
        low:
          wick && rising && state.low / box < from - 1 - EPSILON
            ? state.low
            : Math.min(open, close),
        close,
        volume
      });
    });

    state.volume = 0;
    state.high = Number.NEGATIVE_INFINITY;
    state.low = Number.POSITIVE_INFINITY;
  }
}

/**
 * Renko bricks. Parameters: the box size, `box` fixed, `percentage` of the last close, or
 * otherwise, by default, the average true range over `atrLength` bars (14); `source`, `close` or `ohlc`; `wicks` (`true`), the highest and
 * lowest prices between bricks where they went more than a box the other way.
 */
export const renkoTransform: BarTransformDefinition = {
  type: 'renko',
  name: 'Renko',
  keepsTime: false,
  create: (params, input, from) => {
    checkKeys('renko', params, ['box', 'percentage', 'atrLength', 'source', 'wicks']);
    const rule = sizeRuleOf('renko', 'box', params, from);
    const source =
      params.source === undefined ? 'close' : checkOneOf('params.source', params.source, SOURCES);
    const wicks = params.wicks === undefined ? true : checkBoolean('params.wicks', params.wicks);
    return sizedStream(
      rule,
      input,
      (box) =>
        new RenkoStream(
          { box, source, wicks },
          {
            bottom: Number.NaN,
            top: Number.NaN,
            volume: 0,
            high: Number.NEGATIVE_INFINITY,
            low: Number.POSITIVE_INFINITY
          }
        )
    );
  }
};

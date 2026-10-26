import type { Bar } from '../../data/types';
import { Previous, RollingExtremes } from '../primitives';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream } from '../types';
import { namedLine, periodParam } from './shared';
import { AverageTrueRange, trueRange } from './volatility';

/** The extremes of the price since the trend turned, the trend, and the stop. */
interface VolatilityStopState {
  max: number;
  min: number;
  up: boolean;
  stop: number;
}

/**
 * The stop trails the highest price of the uptrend `multiplier` ATRs below it, only rising, or the
 * lowest of the downtrend as far above it, only falling; while the ATR warms up the true range
 * stands in for it, unmultiplied. The first bar's stop is its price, and the trend is up. A price
 * through the stop turns the trend, which starts again from the price.
 */
class VolatilityStopStream implements IndicatorStream {
  private readonly out = new Float64Array(2);
  private state: VolatilityStopState = {
    max: Number.NaN,
    min: Number.NaN,
    up: true,
    stop: Number.NaN
  };

  constructor(
    private readonly multiplier: number,
    private readonly range: AverageTrueRange,
    private readonly closes = new Previous()
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    const before = this.state;
    const close = this.closes.next(bar.close);
    const atr = this.range.next(bar);
    // While the ATR warms up, the true range: NaN on the first bar, without a previous close.
    const offset = Number.isNaN(atr) ? trueRange(bar, close) : atr * this.multiplier;
    let max = Number.isNaN(before.max) ? price : Math.max(before.max, price);
    let min = Number.isNaN(before.min) ? price : Math.min(before.min, price);
    let stop = before.up
      ? Math.max(before.stop, max - offset)
      : Math.min(before.stop, min + offset);
    stop = Number.isNaN(stop) ? price : stop;
    const up = price - stop >= 0;

    if (up !== before.up) {
      max = price;
      min = price;
      stop = up ? max - offset : min + offset;
    }

    this.out[0] = up ? stop : Number.NaN;
    this.out[1] = up ? Number.NaN : stop;
    this.state = { max, min, up, stop };
    return this.out;
  }

  clone(): IndicatorStream {
    const copy = new VolatilityStopStream(this.multiplier, this.range.clone(), this.closes.clone());
    // Each bar replaces the state rather than changing it, so copies can share it.
    copy.state = this.state;
    return copy;
  }
}

/** A dot of the stop on each bar of a trend, in its theme color. */
function stopDots(key: string, label: string, themeColor: 'up' | 'down'): IndicatorOutput {
  return { key, label, plot: { kind: 'marker', shape: 'circle', size: 2 }, themeColor };
}

/**
 * Volatility stop: a dot under the bars in the theme's up color while the trend is up, over them in
 * its down color while it is down. The stop trails the price's extreme since the trend turned by
 * `multiplier` ATRs of `period` bars (Wilder's, seeded with the mean of the first true ranges),
 * only tightening; the true range, unmultiplied, stands in while the ATR warms up. The first bar's
 * stop is its price, in an uptrend; a price through the stop turns the trend.
 */
export const VSTOP: IndicatorDefinition<{ period: number; multiplier: number }> = {
  type: 'VSTOP',
  name: 'VStop',
  pane: 'main',
  precision: 'price',
  params: {
    period: { default: 20, min: 2, max: 2000, integer: true, label: 'Length' },
    multiplier: { default: 2, min: 0.25, max: 100, label: 'Multiplier' }
  },
  outputs: () => [
    stopDots('upTrend', 'Up Trend', 'up'),
    stopDots('downTrend', 'Down Trend', 'down')
  ],
  create: ({ period, multiplier }) =>
    new VolatilityStopStream(multiplier, AverageTrueRange.of(period))
};

/** The extreme of the bars `multiplier` ATRs inward, and its extreme over `stopPeriod` bars. */
class ChandeKrollStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly multiplier: number,
    private readonly extremes: RollingExtremes,
    private readonly range: AverageTrueRange,
    private readonly stops: RollingExtremes
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const spread = this.multiplier * this.range.next(bar);
    this.extremes.push(bar.high, bar.low);
    this.stops.push(this.extremes.highest() - spread, this.extremes.lowest() + spread);
    this.out[0] = this.stops.lowest();
    this.out[1] = this.stops.highest();
    return this.out;
  }

  clone(): IndicatorStream {
    return new ChandeKrollStream(
      this.multiplier,
      this.extremes.clone(),
      this.range.clone(),
      this.stops.clone()
    );
  }
}

/**
 * Chande Kroll stop: the first stops hang `multiplier` ATRs of `period` bars (Wilder's, seeded with
 * the mean of the first true ranges) under the highest high of `period` bars and above the lowest
 * low; the long stop is the lowest of the first low stops over `stopPeriod` bars, the short stop
 * the highest of the first high stops. Both start on bar `period + stopPeriod - 2`.
 */
export const CKSTOP: IndicatorDefinition<{
  period: number;
  multiplier: number;
  stopPeriod: number;
}> = {
  type: 'CKSTOP',
  name: 'Chande Kroll Stop',
  pane: 'main',
  precision: 'price',
  params: {
    period: periodParam(10, 'ATR Length'),
    multiplier: { default: 1, min: 0, max: 100, label: 'ATR Coefficient' },
    stopPeriod: periodParam(9, 'Stop Length')
  },
  outputs: () => [
    { ...namedLine('stopLong', 'Stop Long'), themeColor: 'up' },
    { ...namedLine('stopShort', 'Stop Short'), themeColor: 'down' }
  ],
  create: ({ period, multiplier, stopPeriod }) =>
    new ChandeKrollStream(
      multiplier,
      new RollingExtremes(period),
      AverageTrueRange.of(period),
      new RollingExtremes(stopPeriod)
    )
};

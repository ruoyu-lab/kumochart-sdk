import { textsOf } from '../options/texts';
import type { ChartCore } from './chart-core';

const TICK_MS = 1000;

type CountdownHost = Pick<
  ChartCore,
  | 'view'
  | 'bars'
  | 'options'
  | 'formatter'
  | 'barDuration'
  | 'barEnd'
  | 'timeBased'
  | 'replaying'
  | 'invalidate'
  | 'invalidateLayers'
>;

/**
 * The time left until the latest bar closes, under the latest price's label, and the timer that
 * repaints it every second while there is one to show.
 */
export class Countdown {
  private timer = 0;

  constructor(private readonly host: CountdownHost) {}

  /**
   * The time left at `now`, or `null` without one: with `latestPrice.countdown` off, while
   * replaying, for bars that are not periods of time such as bricks, and once the latest bar has
   * closed, as when the data stopped or the market is closed.
   */
  text(now: number): string | null {
    const end = this.end();
    return end !== null && end > now
      ? this.host.formatter.duration(end - now, textsOf(this.host.options).days)
      : null;
  }

  /** Runs the timer while there is a countdown to show; called as the chart's geometry is rebuilt. */
  sync(): void {
    const end = this.end();
    const needed = end !== null && end > Date.now();

    if (needed && this.timer === 0) {
      this.timer = this.host.view.setInterval(() => {
        // Once the bar closes the label loses its second line, and the axis may narrow.
        if (this.text(Date.now()) === null) {
          this.host.invalidate();
        } else {
          this.host.invalidateLayers('cursor');
        }
      }, TICK_MS);
    } else if (!needed) {
      this.stop();
    }
  }

  stop(): void {
    this.host.view.clearInterval(this.timer);
    this.timer = 0;
  }

  /**
   * When the latest bar closes, by the trading calendar where it can tell: days, weeks and months
   * are dated at midnight but may end at another time, such as 17:00 New York for forex.
   */
  private end(): number | null {
    const { bars, options } = this.host;

    if (!options.latestPrice.countdown || this.host.replaying || !this.host.timeBased) {
      return null;
    }

    if (bars.length === 0) {
      return null;
    }

    const time = bars.time(bars.length - 1);
    const interval = this.host.barDuration ?? bars.interval();
    return this.host.barEnd(time) ?? (interval === null ? null : time + interval);
  }
}

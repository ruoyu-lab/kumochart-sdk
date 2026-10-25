import type { ChartCore } from './chart-core';

type WatcherHost = Pick<ChartCore, 'bars' | 'timeScale' | 'bus' | 'market' | 'surface' | 'options'>;

/** Reports the visible range and asks for older data when the view nears the first bar. */
export class ViewportWatcher {
  private lastVisibleKey = '';
  private loadMoreArmed = true;
  private loadMoreFirstTime = Number.NaN;

  constructor(private readonly host: WatcherHost) {}

  /** Runs after every geometry change. */
  check(): void {
    const { bars, timeScale, bus } = this.host;
    const visible = timeScale.visibleBars();
    const key = visible ? `${bars.time(visible.from)}:${bars.time(visible.to)}` : '';

    if (key !== this.lastVisibleKey) {
      this.lastVisibleKey = key;
      const logical = timeScale.logicalRange();
      bus.emit('visibleRangeChange', {
        range: visible ? { from: bars.time(visible.from), to: bars.time(visible.to) } : null,
        logicalRange: visible ? logical : null
      });
    }

    this.checkLoadMore();
  }

  private checkLoadMore(): void {
    const { bars, timeScale, bus, market, surface, options } = this.host;

    if (bars.length === 0 || surface.width === 0) {
      return;
    }

    const wanted = options.timeScale.loadMoreThreshold - timeScale.logicalRange().from;
    const nearStart = wanted > 0;

    if (!nearStart) {
      this.loadMoreArmed = true;
      return;
    }

    const firstTime = market.firstSourceTime() ?? bars.time(0);

    if (this.loadMoreArmed || firstTime !== this.loadMoreFirstTime) {
      this.loadMoreArmed = false;
      this.loadMoreFirstTime = firstTime;
      bus.emit('loadMore', { before: firstTime, bars: Math.ceil(wanted) });
    }
  }
}

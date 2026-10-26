import type { Bar } from '../../data/types';
import type { Calendar } from '../../feed/calendar';
import type { IndicatorDefinition, IndicatorStream } from '../types';
import { choiceParam, periodParam, picked, ratio } from './shared';

/** Periods of the calendar the `anchor` parameter picks by value. */
const ANCHORS = ['1D', '1W', '1M', '3M', '12M'];

/** The bars of a period that has ended, which never changes again: copies of a stream share it. */
interface PastPeriod {
  /** When each bar started after the start of the period, in milliseconds, ascending. */
  readonly offsets: Float64Array;
  /** The volume of each bar, or in cumulative mode that of the period up to it. */
  readonly volumes: Float64Array;
}

/** The value of `period` at the latest of its bars that started by `offset`; `NaN` without one. */
function volumeAt(period: PastPeriod, offset: number): number {
  const { offsets, volumes } = period;
  let low = 0;
  let high = offsets.length;

  // The first bar that started after `offset`; the one before it is the latest by then.
  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((offsets[middle] ?? Number.NaN) <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low === 0 ? Number.NaN : (volumes[low - 1] ?? Number.NaN);
}

/** The bars of the current period, appended to as they come. */
class CurrentPeriod {
  constructor(
    /** Its start, `NaN` before the first period. */
    readonly start = Number.NaN,
    private offsets = new Float64Array(64),
    private volumes = new Float64Array(64),
    private count = 0,
    /** The volume of the period so far. */
    public total = 0
  ) {}

  add(offset: number, volume: number): void {
    if (this.count === this.offsets.length) {
      const offsets = new Float64Array(this.count * 2);
      const volumes = new Float64Array(this.count * 2);
      offsets.set(this.offsets);
      volumes.set(this.volumes);
      this.offsets = offsets;
      this.volumes = volumes;
    }

    this.offsets[this.count] = offset;
    this.volumes[this.count] = volume;
    this.count += 1;
  }

  /** Its bars, once it has ended. */
  ended(): PastPeriod {
    return {
      offsets: this.offsets.slice(0, this.count),
      volumes: this.volumes.slice(0, this.count)
    };
  }

  clone(): CurrentPeriod {
    return new CurrentPeriod(
      this.start,
      this.offsets.slice(),
      this.volumes.slice(),
      this.count,
      this.total
    );
  }
}

/**
 * The volume of each bar, or of its period up to it, against the average of the same in the
 * `length` periods before at the same time after their start.
 */
class RelativeVolumeStream implements IndicatorStream {
  private readonly out = new Float64Array(3);

  constructor(
    private readonly calendar: Calendar,
    private readonly anchor: string,
    private readonly length: number,
    private readonly cumulative: boolean,
    private current = new CurrentPeriod(),
    /** The latest periods that ended, oldest first, at most `length` of them. */
    private past: readonly PastPeriod[] = []
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const start = this.calendar.bucket(bar.time, this.anchor);

    // Bars the calendar drops (outside the sessions) count to the period they follow.
    if (start !== null && start !== this.current.start) {
      if (!Number.isNaN(this.current.start)) {
        this.past = [...this.past, this.current.ended()].slice(-this.length);
      }

      this.current = new CurrentPeriod(start);
    }

    if (Number.isNaN(this.current.start)) {
      this.out.fill(Number.NaN);
      return this.out;
    }

    const offset = bar.time - this.current.start;
    this.current.total += bar.volume;
    const volume = this.cumulative ? this.current.total : bar.volume;
    this.current.add(offset, volume);
    const past = this.past.length < this.length ? Number.NaN : this.average(offset);
    this.out[0] = ratio(volume, past);
    this.out[1] = volume;
    this.out[2] = past;
    return this.out;
  }

  /** The average volume of the past periods at `offset`, of those with a bar by then. */
  private average(offset: number): number {
    let sum = 0;
    let count = 0;

    for (const period of this.past) {
      const volume = volumeAt(period, offset);

      if (!Number.isNaN(volume)) {
        sum += volume;
        count += 1;
      }
    }

    return count === 0 ? Number.NaN : sum / count;
  }

  clone(): IndicatorStream {
    // Past periods never change: the copy shares them.
    return new RelativeVolumeStream(
      this.calendar,
      this.anchor,
      this.length,
      this.cumulative,
      this.current.clone(),
      this.past
    );
  }
}

/**
 * Relative volume at time: the volume of the period of the chart's calendar (trading day by
 * default) up to the bar, against its average over the `period` periods before up to the same
 * time after their start; in regular mode the bar's own volume against that of the bars at that
 * time. In each past period the bar that started at that time after the period's start counts,
 * else the latest one before it; a period without a bar by then is left out of the average. The
 * first period starts with the first bar. With an anchor no longer than the bars, each bar is a
 * period of its own: its volume against the average of the `period` bars before. The current and
 * the past volume are shown too.
 */
export const RVOL: IndicatorDefinition<{ anchor: number; period: number; mode: number }> = {
  type: 'RVOL',
  name: 'RelVol',
  pane: 'new',
  precision: 'volume',
  params: {
    anchor: choiceParam(['Day', 'Week', 'Month', 'Quarter', 'Year'], 0, 'Anchor Timeframe'),
    period: periodParam(5, 'Length'),
    mode: choiceParam(['Cumulative', 'Regular'], 0, 'Calculation Mode')
  },
  outputs: () => [
    {
      key: 'relativeVolumeRatio',
      label: 'Relative Volume Ratio',
      plot: { kind: 'columns', from: 0 },
      precision: 2
    },
    { key: 'currentVolume', label: 'Current Volume', plot: { kind: 'hidden' } },
    { key: 'pastVolume', label: 'Past Volume', plot: { kind: 'hidden' } }
  ],
  levels: () => [1],
  create: ({ anchor, period, mode }, { calendar }) =>
    new RelativeVolumeStream(
      calendar,
      picked(ANCHORS, anchor, 'anchor'),
      period,
      picked([true, false], mode, 'calculation mode')
    )
};

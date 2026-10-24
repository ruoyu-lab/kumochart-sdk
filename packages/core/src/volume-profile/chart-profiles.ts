import type { BarStore } from '../data/bar-store';
import type { BarsView } from '../data/types';
import type { Calendar } from '../feed/calendar';
import type { Theme } from '../options/types';
import { paintProfile, profileColors } from './paint';
import { profileOf, type VolumeProfileData } from './profile';
import type { VolumeProfile } from './types';

/** The source bars a profile is computed from, and what tells how they changed. */
export interface SourceBars {
  /** The source bars a running replay has revealed (all of them otherwise). */
  readonly source: BarsView;
  /** The changes of the source bars, revealed or not, since a revision of theirs. */
  readonly changes: Pick<BarStore, 'revision' | 'changesSince'>;
}

/** What the profiles read of the chart as it paints its main pane. */
export interface ProfileView extends SourceBars {
  /** The displayed bars. */
  readonly bars: BarsView;
  /** Indices of the displayed bars in view, both included, or `null`. */
  readonly visible: { readonly from: number; readonly to: number } | null;
  readonly calendar: Calendar;
  readonly theme: Theme;
  /** Width of the plot. */
  readonly width: number;
  readonly barSpacing: number;
  /** X of the center of the displayed bar at an index. */
  readonly indexToX: (index: number) => number;
  readonly valueToY: (value: number) => number;
}

/** A trading day of the source bars `[start, end)`, and its profile. */
interface Session {
  readonly start: number;
  readonly end: number;
  readonly profile: VolumeProfileData | null;
}

const DAY = '1D';
const VISIBLE_WIDTH = 0.25;
const SESSION_WIDTH = 0.7;

/** The source bars `[start, end)` of the displayed bars `from` to `to`, both included. */
function sourceRange(bars: BarsView, source: BarsView, from: number, to: number) {
  return {
    start: source.lowerBound(bars.time(from)),
    end: to + 1 < bars.length ? source.lowerBound(bars.time(to + 1)) : source.length
  };
}

/** Index of the displayed bar a source time belongs to. */
function displayedIndex(bars: BarsView, time: number): number {
  return Math.max(0, bars.lowerBound(time + 1) - 1);
}

/** The run of times of the day bar the calendar puts a source bar into, or `null` if it drops it. */
function runAt(calendar: Calendar, source: BarsView, index: number) {
  return calendar.range(source.time(index), DAY);
}

/**
 * The source bars `[start, end)` of the trading day the bar at `index` belongs to, as the calendar
 * puts them into day bars. Bars it drops (outside the sessions) count to the day they follow, as
 * the VWAP counts them; `null` for those before the first bar it keeps.
 */
function dayAt(calendar: Calendar, source: BarsView, index: number) {
  let kept = index;
  let run = runAt(calendar, source, kept);

  while (!run && kept > 0) {
    kept -= 1;
    run = runAt(calendar, source, kept);
  }

  if (!run) {
    return null;
  }

  const { bucket } = run;
  let start = source.lowerBound(run.start);
  let end = source.lowerBound(run.end);

  // A day of several sessions has a run of times for each, and the dropped bars between them.
  for (let before = start - 1; before >= 0; before -= 1) {
    const other = runAt(calendar, source, before);

    if (other?.bucket === bucket) {
      start = source.lowerBound(other.start);
      before = start;
    } else if (other) {
      break;
    }
  }

  while (end < source.length) {
    const other = runAt(calendar, source, end);

    if (!other) {
      end += 1;
    } else if (other.bucket === bucket) {
      end = source.lowerBound(other.end);
    } else {
      break;
    }
  }

  return { start, end };
}

/** The first source bar from `index` on that the calendar keeps, or the length of the bars. */
function keptFrom(calendar: Calendar, source: BarsView, index: number): number {
  let kept = index;

  while (kept < source.length && !runAt(calendar, source, kept)) {
    kept += 1;
  }

  return kept;
}

/**
 * What a profile computed for the view, kept until the source bars it reads, the bars in view or
 * the calendar change: a tick computes the profile of its trading day again, or of the bars in
 * view when it is one of them, and the trading days still in view are kept as the view moves.
 */
export class ProfileCache {
  /** The revision of the source bars the profiles were computed from. */
  private revision = -1;
  /** How many source bars were revealed then. */
  private length = 0;
  private calendar: Calendar | null = null;
  /** The source bars the trading days were found among. */
  private range = '';
  private visible: {
    readonly start: number;
    readonly end: number;
    readonly profile: VolumeProfileData | null;
  } | null = null;
  /** The trading days in view, by their first source bar. */
  private days = new Map<number, Session>();

  constructor(private readonly settings: Pick<VolumeProfile, 'rows' | 'valueArea'>) {}

  /** The profile of the source bars `[start, end)`. */
  profile(bars: SourceBars, start: number, end: number): VolumeProfileData | null {
    this.follow(bars);

    if (this.visible?.start !== start || this.visible.end !== end) {
      this.visible = { start, end, profile: this.compute(bars.source, start, end) };
    }

    return this.visible.profile;
  }

  /** The trading days with source bars in `[start, end)`, with their profiles. */
  sessions(bars: SourceBars, calendar: Calendar, start: number, end: number): Iterable<Session> {
    const { source } = bars;
    this.follow(bars);

    if (calendar !== this.calendar) {
      this.calendar = calendar;
      this.days.clear();
      this.range = '';
    }

    const range = `${start}:${end}`;

    if (range !== this.range) {
      const days = new Map<number, Session>();

      for (let index = start; index < end;) {
        const day = dayAt(calendar, source, index);

        if (!day) {
          index = keptFrom(calendar, source, index);
          continue;
        }

        // A day is kept while its bars are: those after it may have joined it.
        const kept = this.days.get(day.start);
        days.set(
          day.start,
          kept?.end === day.end
            ? kept
            : { ...day, profile: this.compute(source, day.start, day.end) }
        );
        index = day.end;
      }

      this.days = days;
      this.range = range;
    }

    return this.days.values();
  }

  private compute(source: BarsView, start: number, end: number): VolumeProfileData | null {
    return profileOf(source, start, end, this.settings.rows, this.settings.valueArea);
  }

  /**
   * Drops the profiles of the source bars that changed since they were computed. A replay
   * reveals or hides the latest bars, which changes them as a tick does.
   */
  private follow({ source, changes }: SourceBars): void {
    const change = changes.changesSince(this.revision);
    let from =
      source.length === this.length
        ? Number.POSITIVE_INFINITY
        : Math.min(source.length, this.length);

    if (change) {
      from = change.kind === 'reset' ? 0 : Math.min(from, change.from);
    }

    this.revision = changes.revision;
    this.length = source.length;

    if (from === Number.POSITIVE_INFINITY) {
      return;
    }

    if (this.visible && this.visible.end > from) {
      this.visible = null;
    }

    // A day ending where the bars changed may take the bars after it.
    for (const [start, day] of this.days) {
      if (day.end >= from) {
        this.days.delete(start);
      }
    }

    this.range = '';
  }
}

/**
 * Paints a profile under the series of the main pane: along an edge of the plot for the bars in
 * view, or from the start of each trading day in view.
 */
export function paintChartProfile(
  ctx: CanvasRenderingContext2D,
  view: ProfileView,
  profile: VolumeProfile,
  cache: ProfileCache
): void {
  const { bars, source, visible } = view;

  if (!visible) {
    return;
  }

  const { start, end } = sourceRange(bars, source, visible.from, visible.to);
  const colors = profileColors(profile, view.theme);

  if (profile.mode === 'visible') {
    const data = cache.profile(view, start, end);

    if (!data) {
      return;
    }

    const right = profile.placement === 'right';
    const length = (profile.width ?? VISIBLE_WIDTH) * view.width;
    paintProfile(
      ctx,
      data,
      view.valueToY,
      {
        x: right ? view.width : 0,
        length: right ? -length : length,
        pocTo: right ? 0 : view.width
      },
      colors
    );
    return;
  }

  const half = view.barSpacing / 2;

  for (const session of cache.sessions(view, view.calendar, start, end)) {
    if (!session.profile) {
      continue;
    }

    const left = view.indexToX(displayedIndex(bars, source.time(session.start))) - half;
    const right = view.indexToX(displayedIndex(bars, source.time(session.end - 1))) + half;
    paintProfile(
      ctx,
      session.profile,
      view.valueToY,
      { x: left, length: (profile.width ?? SESSION_WIDTH) * (right - left), pocTo: right },
      colors
    );
  }
}

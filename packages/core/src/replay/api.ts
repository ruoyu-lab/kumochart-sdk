import type { ChartCore } from '../chart/chart-core';
import type { TimeInput } from '../data/time';
import type { Replay, ReplaySettings, ReplayState } from './replay';

/**
 * Bar replay. A time cursor hides the source data after it: timeframes, indicators, alerts,
 * series and markers see only the revealed past, and a coarser timeframe shows its bar forming
 * from the revealed source bars. Data keeps streaming in while replaying and stays hidden until
 * the cursor reaches it. Playback emits `replay` events; these calls emit nothing.
 */
export interface ReplayApi {
  /** Starts (or restarts) replay showing the source data up to and including `time`. */
  start(time: TimeInput, settings?: Partial<ReplaySettings>): void;
  /** Ends replay and shows all data. */
  stop(): void;
  play(): void;
  pause(): void;
  /** Advances `count` steps (default 1); returns how many steps were possible. */
  step(count?: number): number;
  /** Moves the cursor to any time at or after the first bar, forward or back. */
  seek(time: TimeInput): void;
  configure(settings: Partial<ReplaySettings>): void;
  /** The replay, or `null` when the chart shows all data. */
  state(): ReplayState | null;
}

export function createReplayApi(core: ChartCore, replay: Replay): ReplayApi {
  return {
    start: (time, settings) => {
      core.run(() => {
        replay.start(time, settings);
      });
    },
    stop: () => {
      core.run(() => {
        replay.stop();
      });
    },
    play: () => {
      core.run(() => {
        replay.play();
      });
    },
    pause: () => {
      core.run(() => {
        replay.pause();
      });
    },
    step: (count) => core.run(() => replay.step(count)),
    seek: (time) => {
      core.run(() => {
        replay.seek(time);
      });
    },
    configure: (settings) => {
      core.run(() => {
        replay.configure(settings);
      });
    },
    state: () => replay.state()
  };
}

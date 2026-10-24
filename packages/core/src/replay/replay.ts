import type { MarketData } from '../chart/market-data';
import { toTime, type TimeInput } from '../data/time';
import { describeValue, fail } from '../utils/errors';
import { checkFields, checkNumber, checkOneOf, fieldsOf } from '../utils/validate';

export interface ReplaySettings {
  /** Steps per second while playing. */
  speed: number;
  /**
   * `bar` completes the displayed bar in progress or reveals the next one; `source` reveals one
   * source bar, so a coarser timeframe shows its bar forming.
   */
  step: 'bar' | 'source';
}

export interface ReplayState extends ReplaySettings {
  /** Time of the last revealed source bar. */
  readonly time: number;
  readonly playing: boolean;
  /** Every source bar is revealed; new data arriving later is revealed by further steps. */
  readonly ended: boolean;
}

export interface ReplayEvent {
  readonly state: ReplayState;
  /** `end` when playback reached the last source bar and paused. */
  readonly reason: 'step' | 'end';
}

/** What replay needs from the chart. */
export interface ReplayHost {
  readonly view: Window;
  readonly market: MarketData;
  /** Applies a cutoff; `follow` scrolls to the latest revealed bar. */
  reveal(time: number, follow: boolean): void;
  /** Runs a playback step as a chart operation and reports it. */
  played(step: () => ReplayEvent): void;
}

const DEFAULT_SETTINGS: ReplaySettings = { speed: 1, step: 'bar' };
const SETTING_FIELDS = fieldsOf<ReplaySettings>({ speed: true, step: true });

function parseSettings(base: ReplaySettings, patch: Partial<ReplaySettings>): ReplaySettings {
  checkFields('replay settings', patch, SETTING_FIELDS);
  const next = { ...base, ...patch };
  checkNumber('replay.speed', next.speed, { min: 0, exclusiveMin: true, max: 1000 });
  checkOneOf('replay.step', next.step, ['bar', 'source']);
  return next;
}

/**
 * Bar replay: a time cursor that hides the source data after it. Aggregation, indicators,
 * alerts, series and markers see only the revealed past.
 */
export class Replay {
  private cursor: number | null = null;
  private settings: ReplaySettings = DEFAULT_SETTINGS;
  private timer = 0;

  constructor(private readonly host: ReplayHost) {}

  get active(): boolean {
    return this.cursor !== null;
  }

  state(): ReplayState | null {
    if (this.cursor === null) {
      return null;
    }

    return {
      ...this.settings,
      time: this.cursor,
      playing: this.timer !== 0,
      ended: this.host.market.feed.nextCutoff(this.cursor, false) === null
    };
  }

  start(input: TimeInput, settings: Partial<ReplaySettings> = {}): void {
    const time = toTime(input, 'replay start');
    const next = parseSettings(this.settings, settings);
    const first = this.host.market.firstSourceTime();

    if (first === null) {
      fail('Replay needs data: set bars before starting it.');
    }

    if (time < first) {
      fail(
        `replay start ${describeValue(input)} is before the first bar; start at or after the first bar.`
      );
    }

    this.pause();
    this.settings = next;
    this.cursor = time;
    this.host.reveal(time, true);
  }

  stop(): void {
    if (this.cursor === null) {
      return;
    }

    this.pause();
    this.cursor = null;
    this.host.reveal(Number.POSITIVE_INFINITY, true);
  }

  play(): void {
    this.require('play()');

    if (this.timer === 0) {
      this.schedule();
    }
  }

  pause(): void {
    if (this.timer !== 0) {
      this.host.view.clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  /** Advances `count` steps; returns how many were possible. */
  step(count = 1): number {
    const cursor = this.require('step()');
    checkNumber('replay step count', count, { min: 1, integer: true });
    let time = cursor;
    let taken = 0;

    for (; taken < count; taken += 1) {
      const next = this.host.market.feed.nextCutoff(time, this.settings.step === 'bar');

      if (next === null) {
        break;
      }

      time = next;
    }

    if (taken > 0) {
      this.cursor = time;
      this.host.reveal(time, false);
    }

    return taken;
  }

  seek(input: TimeInput): void {
    this.require('seek()');
    const time = toTime(input, 'replay time');
    const first = this.host.market.firstSourceTime();

    if (first !== null && time < first) {
      fail(`replay time ${describeValue(input)} is before the first bar.`);
    }

    this.cursor = time;
    this.host.reveal(time, true);
  }

  configure(settings: Partial<ReplaySettings>): void {
    this.settings = parseSettings(this.settings, settings);

    if (this.timer !== 0) {
      this.pause();
      this.schedule();
    }
  }

  /** Ends replay without revealing anything, when the data is cleared. */
  reset(): void {
    this.pause();
    this.cursor = null;
  }

  private require(method: string): number {
    return (
      this.cursor ?? fail(`replay.${method} needs a running replay: call replay.start() first.`)
    );
  }

  private schedule(): void {
    this.timer = this.host.view.setTimeout(() => {
      this.timer = 0;
      this.host.played(() => this.tick());
    }, 1000 / this.settings.speed);
  }

  private tick(): ReplayEvent {
    const moved = this.cursor !== null && this.step() > 0;
    const state = this.state();

    if (!state) {
      return fail('Replay stopped during a step.');
    }

    if (!moved || state.ended) {
      return { state, reason: 'end' };
    }

    this.schedule();
    return { state: { ...state, playing: true }, reason: 'step' };
  }
}

/** Pans slower than this, in pixels per millisecond, end without gliding on. */
const KINETIC_MIN_SPEED = 0.15;
const KINETIC_STOP_SPEED = 0.02;
const KINETIC_DECAY_MS = 325;
/** The moves of a pan within this long before its end measure its speed. */
export const VELOCITY_WINDOW_MS = 80;

/** Where the pointer was during a pan, for its speed at release. */
export interface PanSample {
  readonly x: number;
  readonly time: number;
}

/**
 * After a fast pan, the bars glide on and slow down, as a page does after a flick: `scroll` gets
 * the pixels of each frame, and returns whether the bars moved; they stop where they cannot.
 */
export class KineticScroll {
  private velocity = 0;
  private time = 0;
  private frame = 0;

  constructor(
    private readonly view: Window,
    private readonly scroll: (deltaX: number) => boolean
  ) {}

  /** Starts gliding at the speed of the pan's last samples, released at `time`. */
  start(samples: readonly PanSample[], time: number): void {
    const first = samples[0];
    const last = samples[samples.length - 1];

    if (!first || !last || time - last.time > VELOCITY_WINDOW_MS) {
      return;
    }

    const elapsed = last.time - first.time;
    const velocity = elapsed > 0 ? (last.x - first.x) / elapsed : 0;

    if (Math.abs(velocity) < KINETIC_MIN_SPEED) {
      return;
    }

    this.velocity = velocity;
    this.time = performance.now();
    const step = (now: number) => {
      const delta = Math.max(0, now - this.time);
      this.time = now;
      this.velocity *= Math.exp(-delta / KINETIC_DECAY_MS);

      if (Math.abs(this.velocity) < KINETIC_STOP_SPEED) {
        this.frame = 0;
        return;
      }

      this.frame = this.scroll(this.velocity * delta) ? this.view.requestAnimationFrame(step) : 0;
    };
    this.frame = this.view.requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame !== 0) {
      this.view.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }
}

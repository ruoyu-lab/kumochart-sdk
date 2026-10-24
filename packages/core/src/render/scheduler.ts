import { runEach } from '../utils/errors';
import type { LayerName } from './surface';

/**
 * Coalesces repaint requests into one animation frame. Each request names the layers that changed;
 * a frame repaints every requested layer once, after the work asked to run before it, such as
 * input coalesced to a frame, so that what that work changes is painted in the same frame.
 */
export class FrameScheduler {
  private handle = 0;
  private pending = new Set<LayerName>();
  private tasks: Array<() => void> = [];
  /** The tasks of a frame run, whose repaints that frame paints. */
  private running = false;

  constructor(
    private readonly view: Window,
    private readonly run: (layers: ReadonlySet<LayerName>) => void
  ) {}

  request(...layers: LayerName[]): void {
    layers.forEach((layer) => this.pending.add(layer));

    if (this.pending.size > 0) {
      this.schedule();
    }
  }

  /** Runs `task` in the next frame, before it paints. */
  beforePaint(task: () => void): void {
    this.tasks.push(task);
    this.schedule();
  }

  /** Runs the work asked for and paints the pending layers now. */
  flush(): void {
    if (this.handle !== 0) {
      this.view.cancelAnimationFrame(this.handle);
      this.handle = 0;
    }

    const tasks = this.tasks;
    this.tasks = [];
    this.running = true;

    try {
      runEach(tasks);
    } finally {
      this.running = false;

      // Work a task asked for runs in the next frame.
      if (this.tasks.length > 0) {
        this.schedule();
      }

      this.paint();
    }
  }

  private schedule(): void {
    if (this.handle === 0 && !this.running) {
      this.handle = this.view.requestAnimationFrame(() => {
        this.handle = 0;
        this.flush();
      });
    }
  }

  private paint(): void {
    if (this.pending.size === 0) {
      return;
    }

    const layers = this.pending;
    this.pending = new Set();
    this.run(layers);
  }

  destroy(): void {
    if (this.handle !== 0) {
      this.view.cancelAnimationFrame(this.handle);
      this.handle = 0;
    }

    this.pending.clear();
    this.tasks = [];
  }
}

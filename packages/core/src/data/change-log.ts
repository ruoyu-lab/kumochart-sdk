import type { BarChange } from './types';

/** Tail changes kept for readers that fell behind; one further behind reads everything again. */
const MAX_TAILS = 256;

/**
 * The revision of a store of positions and how its positions changed, for readers that update
 * their own data incrementally: every change bumps the revision, as a tail from a position on
 * or as a reset of every position.
 */
export class ChangeLog {
  private current = 0;
  private resetAt = 0;
  private tails: { revision: number; from: number }[] = [];

  get revision(): number {
    return this.current;
  }

  /** Every position may have changed. */
  reset(): void {
    this.current += 1;
    this.resetAt = this.current;
    this.tails = [];
  }

  /** The positions from `from` on changed or were added. */
  tail(from: number): void {
    this.current += 1;
    this.tails.push({ revision: this.current, from });

    if (this.tails.length > MAX_TAILS) {
      this.tails.shift();
    }
  }

  /**
   * How the positions changed after `revision`, or `null` when nothing did. A revision the log
   * does not know, such as one of another store, reads everything again.
   */
  since(revision: number): BarChange | null {
    if (revision === this.current) {
      return null;
    }

    const oldest = this.tails[0];

    if (
      revision < this.resetAt ||
      revision > this.current ||
      !oldest ||
      oldest.revision > revision + 1
    ) {
      return { kind: 'reset' };
    }

    let from = Number.POSITIVE_INFINITY;

    for (const entry of this.tails) {
      if (entry.revision > revision) {
        from = Math.min(from, entry.from);
      }
    }

    return { kind: 'tail', from };
  }
}

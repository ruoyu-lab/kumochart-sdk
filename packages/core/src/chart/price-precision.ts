import type { BarStore } from '../data/bar-store';
import { decimalsOf } from '../format/formatter';

const SAMPLE = 500;

/**
 * Decimal places of the main prices, inferred from the latest source bars and cached per
 * revision: those of the market, not of bars a transform builds, such as Heikin-Ashi candles whose
 * averaged opens have many more.
 */
export class PricePrecision {
  private revision = -1;
  private value = 2;

  constructor(private readonly bars: BarStore) {}

  get(configured: number | 'auto'): number {
    if (configured !== 'auto') {
      return configured;
    }

    const bars = this.bars;

    if (this.revision !== bars.revision) {
      let decimals = 2;

      for (let index = Math.max(0, bars.length - SAMPLE); index < bars.length; index += 1) {
        decimals = decimalsOf(bars.open(index), decimals);
        decimals = decimalsOf(bars.high(index), decimals);
        decimals = decimalsOf(bars.low(index), decimals);
        decimals = decimalsOf(bars.close(index), decimals);
      }

      this.revision = bars.revision;
      this.value = decimals;
    }

    return this.value;
  }

  /** Infers the precision again on the next request. */
  invalidate(): void {
    this.revision = -1;
  }
}

import { niceStep, niceTicks } from '../utils/math';
import type { PriceScale } from './price-scale';

export interface PriceTick {
  /** Value in data units. */
  value: number;
  y: number;
}

const LOG_MULTIPLIERS = [1, 2, 5];

function logTicks(scale: PriceScale, minSpacing: number): number[] {
  const range = scale.scaleRange();

  if (!range) {
    return [];
  }

  const values: number[] = [];

  for (let decade = Math.floor(range.min); decade <= Math.ceil(range.max); decade += 1) {
    for (const multiplier of LOG_MULTIPLIERS) {
      const value = multiplier * 10 ** decade;
      const scaled = Math.log10(value);

      if (scaled >= range.min && scaled <= range.max) {
        values.push(value);
      }
    }
  }

  const accepted: number[] = [];
  let lastY = Number.NaN;

  for (const value of values) {
    const y = scale.valueToY(value);

    if (Number.isNaN(lastY) || Math.abs(y - lastY) >= minSpacing) {
      accepted.push(value);
      lastY = y;
    }
  }

  return accepted;
}

/** Nicely rounded ticks keeping at least `minSpacing` pixels between labels. */
export function buildPriceTicks(scale: PriceScale, minSpacing: number): PriceTick[] {
  const range = scale.scaleRange();
  const height = scale.plotHeight;

  if (!range || height <= 0) {
    return [];
  }

  const span = range.max - range.min;
  let values: number[];

  if (scale.mode === 'log' && span >= 1) {
    values = logTicks(scale, minSpacing);
  } else if (scale.mode === 'log') {
    const low = scale.fromScale(range.min);
    const high = scale.fromScale(range.max);
    const step = niceStep(((high - low) * minSpacing) / height);
    values = niceTicks(low, high, step);
  } else {
    const step = niceStep((span * minSpacing) / height);
    values = niceTicks(range.min, range.max, step).map((scaled) => scale.fromScale(scaled));
  }

  return values
    .map((value) => ({ value, y: scale.valueToY(value) }))
    .filter((tick) => tick.y >= 0 && tick.y <= height);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Rounds a step up to 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) {
    return 1;
  }

  const power = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / power;

  if (fraction <= 1) {
    return power;
  }

  if (fraction <= 2) {
    return 2 * power;
  }

  if (fraction <= 2.5) {
    return 2.5 * power;
  }

  if (fraction <= 5) {
    return 5 * power;
  }

  return 10 * power;
}

/** Returns evenly spaced "nice" values covering [min, max]. */
export function niceTicks(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return [];
  }

  const ticks: number[] = [];
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);

  for (let index = first; index <= last; index += 1) {
    ticks.push(Number((index * step).toFixed(decimals)));
  }

  return ticks;
}

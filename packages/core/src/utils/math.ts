export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Rounds a step up to 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(rawStep));
  // Below 1 by exact powers of ten: a negative power, as 10 ** -4, is not exact on every engine.
  const times = (multiple: number) =>
    exponent < 0 ? multiple / 10 ** -exponent : multiple * 10 ** exponent;
  const fraction = exponent < 0 ? rawStep * 10 ** -exponent : rawStep / 10 ** exponent;

  if (fraction <= 1) {
    return times(1);
  }

  if (fraction <= 2) {
    return times(2);
  }

  if (fraction <= 2.5) {
    return times(2.5);
  }

  if (fraction <= 5) {
    return times(5);
  }

  return times(10);
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

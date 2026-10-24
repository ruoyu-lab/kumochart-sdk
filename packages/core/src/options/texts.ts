import { fail } from '../utils/errors';
import { checkObject } from '../utils/validate';
import type { ChartOptions, ChartTexts, TextOverrides } from './types';

/** The value labels of the main series' legend and the countdown's days, alike in every language. */
export const CHART_TEXTS: ChartTexts = {
  legendOpen: 'O',
  legendHigh: 'H',
  legendLow: 'L',
  legendClose: 'C',
  legendVolume: 'V',
  days: (count) => `${count}d`
};

/** Overrides of none of `words`. */
export function unsetTexts<Texts extends object>(words: Texts): TextOverrides<Texts> {
  return Object.fromEntries(Object.keys(words).map((key) => [key, null])) as TextOverrides<Texts>;
}

/**
 * Throws unless `texts` overrides only words of `words`, each with `null` or a value of the same
 * kind: a string, or a function writing a number.
 */
export function checkTexts<Texts extends object>(
  label: string,
  texts: TextOverrides<Texts>,
  words: Texts
): void {
  checkObject(label, texts);

  for (const [key, value] of Object.entries(texts)) {
    if (!Object.hasOwn(words, key)) {
      fail(`${label} has no entry "${key}".`);
    }

    const kind = typeof (words as Readonly<Record<string, unknown>>)[key];

    if (value !== null && typeof value !== kind) {
      fail(`${label}.${key} must be ${kind === 'function' ? 'a function' : 'a string'} or null.`);
    }
  }
}

/** `words`, with those `texts` replaces replaced. */
export function withTexts<Texts extends object>(words: Texts, texts: TextOverrides<Texts>): Texts {
  const replaced = Object.entries(texts).filter(([, value]) => value !== null);
  return { ...words, ...Object.fromEntries(replaced) };
}

/** The words the chart paints, with the overrides of `texts`. */
export function textsOf(options: ChartOptions): ChartTexts {
  return withTexts(CHART_TEXTS, options.texts);
}

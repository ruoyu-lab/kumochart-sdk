import { checkArray, checkFields, checkObject, checkString } from '../utils/validate';

/** The words of indicators in one language, by the English their definitions are written in. */
export interface IndicatorWords {
  /** The full names of indicator types, such as `Moving average` for `MA`. */
  readonly names?: Readonly<Record<string, string>>;
  /**
   * The words of the definitions: the names, and the labels of outputs, parameters and their
   * options, such as `上轨` for `Upper`. One ending in a number, as `Upper Band #2`, takes the
   * words of `Upper Band #{n}` with its number.
   */
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * The words of indicators by language, the first subtag of a locale: `en`, `zh`, `ja`, `ko`, …
 * As `indicators(allIndicators, { texts: [indicatorTexts] })` takes them.
 */
export type IndicatorTexts = Readonly<Record<string, IndicatorWords>>;

/** The words of indicators in the language of a chart. */
export interface IndicatorLanguage {
  /** A word of the definitions in the language, or itself without one. */
  label(text: string): string;
  /** The full name of a type in the language, else in English, else `null`. */
  title(type: string): string | null;
}

const WORD_FIELDS = ['names', 'labels'];

function checkWords(label: string, words: Readonly<Record<string, string>> | undefined): void {
  if (words === undefined) {
    return;
  }

  checkObject(label, words);

  for (const [key, value] of Object.entries(words)) {
    checkString(`${label}.${JSON.stringify(key)}`, value);
  }
}

/** Checks the texts given to the indicators module. */
export function checkIndicatorTexts(label: string, given: readonly IndicatorTexts[]): void {
  checkArray(label, given);

  given.forEach((texts, index) => {
    checkObject(`${label}[${index}]`, texts);
    const languages: ReadonlyArray<readonly [string, IndicatorWords]> = Object.entries(texts);

    for (const [language, words] of languages) {
      const path = `${label}[${index}].${language}`;
      checkFields(path, words, WORD_FIELDS);
      checkWords(`${path}.names`, words.names);
      checkWords(`${path}.labels`, words.labels);
    }
  });
}

/** The words of `language` in `texts`, those given later over those before. */
function merged(
  texts: readonly IndicatorTexts[],
  language: string,
  part: keyof IndicatorWords
): ReadonlyMap<string, string> {
  return new Map(texts.flatMap((each) => Object.entries(each[language]?.[part] ?? {})));
}

/**
 * The words of indicators in the language of `locale`, the runtime's for `null`, as a chart
 * gives them with the texts given to its module: for a form of settings without a chart.
 */
export function indicatorLanguage(
  texts: readonly IndicatorTexts[],
  locale: string | null
): IndicatorLanguage {
  const language = new Intl.NumberFormat(locale ?? undefined)
    .resolvedOptions()
    .locale.split('-')[0];
  const labels = merged(texts, language ?? 'en', 'labels');
  const names = merged(texts, language ?? 'en', 'names');
  const english = merged(texts, 'en', 'names');
  return {
    label: (text) => {
      const own = labels.get(text);

      if (own !== undefined) {
        return own;
      }

      const number = /\d+$/.exec(text)?.[0];
      const numbered =
        number === undefined ? undefined : labels.get(`${text.slice(0, -number.length)}{n}`);
      return numbered === undefined || number === undefined
        ? text
        : numbered.replace('{n}', number);
    },
    title: (type) => names.get(type) ?? english.get(type) ?? null
  };
}

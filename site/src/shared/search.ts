// The search of the site: an index built with the pages, searched in the browser. Words are
// matched as parts of the text, so Chinese words are found without splitting the text into
// words, and several words must all be found.

/** The search index of one language, as the build writes it. */
export interface SearchIndex {
  /** Each page by title and address. */
  readonly pages: readonly { readonly title: string; readonly url: string }[];
  /** Sections of the pages: the page's position, the heading's anchor, the heading, the text. */
  readonly records: readonly (readonly [
    page: number,
    anchor: string,
    heading: string,
    text: string
  ])[];
}

/** Part of a result's text, a match of the query or not. */
export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

export interface SearchResult {
  readonly url: string;
  readonly page: string;
  /** The section's heading, empty for the start of a page. */
  readonly heading: string;
  /** Text around the first match in the section. */
  readonly snippet: readonly Segment[];
}

interface PreparedRecord {
  readonly page: number;
  readonly anchor: string;
  readonly heading: string;
  readonly text: string;
  readonly title: string;
  readonly headingKey: string;
  readonly textKey: string;
  readonly titleKey: string;
}

/** An index ready for searching: its texts in lower case. */
export interface PreparedIndex {
  readonly index: SearchIndex;
  readonly records: readonly PreparedRecord[];
}

const MAX_RESULTS = 20;
const MAX_PER_PAGE = 4;
const BEFORE = 24;
const AFTER = 90;

function key(text: string): string {
  return text.toLowerCase();
}

export function prepareIndex(index: SearchIndex): PreparedIndex {
  return {
    index,
    records: index.records.map(([page, anchor, heading, text]) => {
      const title = index.pages[page]?.title ?? '';
      return {
        page,
        anchor,
        heading,
        text,
        title,
        headingKey: key(heading),
        textKey: key(text),
        titleKey: key(title)
      };
    })
  };
}

/** The words of a query, in lower case. */
export function queryTerms(query: string): string[] {
  return key(query)
    .split(/\s+/)
    .filter((term) => term !== '');
}

const WORD = /[\p{L}\p{N}_$]/u;

/** Whether a match starts a word: Latin words count more when matched from their start. */
function startsWord(text: string, position: number): boolean {
  return (
    position === 0 || !WORD.test(text[position - 1] ?? '') || !/[a-z0-9]/.test(text[position] ?? '')
  );
}

function score(record: PreparedRecord, terms: readonly string[]): number {
  let total = 0;

  for (const term of terms) {
    const inHeading = record.headingKey.indexOf(term);
    const inTitle = record.titleKey.indexOf(term);
    const inText = record.textKey.indexOf(term);

    if (inHeading === -1 && inTitle === -1 && inText === -1) {
      return 0;
    }

    if (inHeading !== -1) {
      total += 10 + (startsWord(record.headingKey, inHeading) ? 4 : 0);
      total += record.headingKey === term ? 10 : 0;
    }

    if (inTitle !== -1) {
      total += 4 + (startsWord(record.titleKey, inTitle) ? 2 : 0);
    }

    if (inText !== -1) {
      total += 1 + (startsWord(record.textKey, inText) ? 1 : 0);
    }
  }

  // The start of a page stands for the page.
  return total + (record.anchor === '' ? 1 : 0);
}

/** The text around the first match of a term, the matches marked. */
export function snippet(text: string, terms: readonly string[]): Segment[] {
  const lower = key(text);
  const first = terms
    .map((term) => lower.indexOf(term))
    .filter((position) => position !== -1)
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const start = Number.isFinite(first) ? Math.max(0, first - BEFORE) : 0;
  const end = Math.min(text.length, (Number.isFinite(first) ? first : 0) + AFTER);
  const part = text.slice(start, end);
  const partKey = lower.slice(start, end);
  const marks = new Array<boolean>(part.length).fill(false);

  for (const term of terms) {
    let position = partKey.indexOf(term);

    while (position !== -1) {
      marks.fill(true, position, position + term.length);
      position = partKey.indexOf(term, position + term.length);
    }
  }

  const segments: { text: string; match: boolean }[] = [];

  for (let index = 0; index < part.length; index += 1) {
    const match = marks[index] ?? false;
    const last = segments[segments.length - 1];

    if (last?.match === match) {
      last.text += part[index] ?? '';
    } else {
      segments.push({ text: part[index] ?? '', match });
    }
  }

  if (start > 0) {
    segments.unshift({ text: '…', match: false });
  }

  if (end < text.length) {
    segments.push({ text: '…', match: false });
  }

  return segments;
}

/** The sections matching every word of the query, the best first. */
export function search(prepared: PreparedIndex, query: string): SearchResult[] {
  const terms = queryTerms(query);

  if (terms.length === 0) {
    return [];
  }

  const ranked = prepared.records
    .map((record, position) => ({ record, position, score: score(record, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position);
  const perPage = new Map<number, number>();
  const results: SearchResult[] = [];

  for (const { record } of ranked) {
    const count = perPage.get(record.page) ?? 0;

    if (count >= MAX_PER_PAGE) {
      continue;
    }

    perPage.set(record.page, count + 1);
    const page = prepared.index.pages[record.page];
    results.push({
      url: `${page?.url ?? ''}${record.anchor === '' ? '' : `#${record.anchor}`}`,
      page: record.title,
      heading: record.anchor === '' ? '' : record.heading,
      snippet: snippet(record.text === '' ? record.heading : record.text, terms)
    });

    if (results.length === MAX_RESULTS) {
      break;
    }
  }

  return results;
}

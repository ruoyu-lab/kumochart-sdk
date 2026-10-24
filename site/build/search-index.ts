import { createHash } from 'node:crypto';
import type { SearchIndex } from '../src/shared/search';
import type { Language } from '../src/shared/ui-text';
import type { TextSection } from './markdown';

/** A page as the search sees it. */
export interface SearchPage {
  readonly title: string;
  readonly url: string;
  readonly sections: readonly TextSection[];
}

export function buildSearchIndex(pages: readonly SearchPage[]): SearchIndex {
  return {
    pages: pages.map((page) => ({ title: page.title, url: page.url })),
    records: pages.flatMap((page, position) =>
      page.sections.map(
        (section) => [position, section.anchor, section.heading, section.text] as const
      )
    )
  };
}

/** The index as a file named by its content, so that it can be cached for ever. */
export function searchIndexFile(
  language: Language,
  index: SearchIndex
): { url: string; json: string } {
  const json = JSON.stringify(index);
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 10);
  return { url: `/search/${language}.${hash}.json`, json };
}

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LANGUAGES, SOURCE_LANGUAGE, type Language } from '../src/shared/ui-text';
import type { SiteConfig } from './config';
import { navPages, parseNav, type Nav } from './nav';
import type { Problems } from './problems';

/** The home page of each language, outside the navigation. */
export const HOME_FILE = 'index.md';

/** A Markdown file of the documentation. */
export interface SourceFile {
  readonly language: Language;
  /** Path in the language's directory, such as `data.md`. */
  readonly file: string;
  /** Absolute path. */
  readonly path: string;
  readonly text: string;
}

/** A page of the site in one language. */
export interface PageEntry {
  readonly language: Language;
  readonly file: string;
  readonly url: string;
  /** What the page shows: its own file, or the source language's while it is not translated. */
  readonly source: SourceFile;
  readonly translated: boolean;
  /** The title in the navigation; `null` for the home page. */
  readonly navTitle: string | null;
}

export interface Content {
  readonly nav: Nav;
  /** Every page of every language: the home page, then the navigation's pages in order. */
  readonly pages: readonly PageEntry[];
  /** Pages of the navigation that are not written yet. */
  readonly planned: ReadonlySet<string>;
}

/** The address of a page: `/zh-CN/` for the home page, `/zh-CN/data/` for `data.md`. */
export function pageUrl(language: Language, file: string): string {
  const path = file.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '/');
  return `/${language}/${path}`;
}

/** The Markdown files of a directory and its subdirectories, as paths relative to it. */
function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => path.split('\\').join('/'))
    .sort();
}

/** The navigation file of the documentation. */
export function navFile(config: SiteConfig): string {
  return join(config.docsDir, 'nav.json');
}

/**
 * Reads the navigation and the pages. Every written page must be in the navigation and every
 * translation must have a source page; pages of the navigation not written yet are left out
 * with a warning.
 */
export function loadContent(config: SiteConfig, problems: Problems): Content {
  const navPath = navFile(config);
  const nav = parseNav(JSON.parse(readFileSync(navPath, 'utf8')) as unknown);
  const listed = navPages(nav);
  const files = new Map<Language, Set<string>>(
    LANGUAGES.map((language) => [language, new Set(markdownFiles(join(config.docsDir, language)))])
  );
  const source = files.get(SOURCE_LANGUAGE) ?? new Set<string>();
  const listedFiles = new Set(listed.map((page) => page.file));
  const planned = new Set<string>();

  if (!source.has(HOME_FILE)) {
    problems.error(
      join(config.docsDir, SOURCE_LANGUAGE, HOME_FILE),
      undefined,
      'the home page is missing'
    );
  }

  for (const file of source) {
    if (file !== HOME_FILE && !listedFiles.has(file)) {
      problems.error(
        join(config.docsDir, SOURCE_LANGUAGE, file),
        undefined,
        `the page is not in ${relative(config.repoRoot, navPath)}; add it to a group`
      );
    }
  }

  for (const language of LANGUAGES) {
    for (const file of files.get(language) ?? []) {
      if (language !== SOURCE_LANGUAGE && !source.has(file)) {
        problems.error(
          join(config.docsDir, language, file),
          undefined,
          `the translation has no ${SOURCE_LANGUAGE} page ${SOURCE_LANGUAGE}/${file}`
        );
      }
    }
  }

  for (const page of listed) {
    if (!source.has(page.file)) {
      planned.add(page.file);
    }
  }

  if (planned.size > 0) {
    problems.warn(
      navPath,
      undefined,
      `${planned.size} page${planned.size === 1 ? ' is' : 's are'} not written yet and left out of the site: ${[...planned].join(', ')}`
    );
  }

  const read = (language: Language, file: string): SourceFile => {
    const path = join(config.docsDir, language, file);
    return { language, file, path, text: readFileSync(path, 'utf8') };
  };

  const pages: PageEntry[] = [];
  const entries = [
    { file: HOME_FILE, title: null },
    ...listed
      .filter((page) => !planned.has(page.file))
      .map((page) => ({ file: page.file, title: page.title }))
  ];

  for (const language of LANGUAGES) {
    for (const entry of entries) {
      if (!source.has(entry.file)) {
        continue;
      }

      const translated = files.get(language)?.has(entry.file) ?? false;
      pages.push({
        language,
        file: entry.file,
        url: pageUrl(language, entry.file),
        source: read(translated ? language : SOURCE_LANGUAGE, entry.file),
        translated,
        navTitle: entry.title === null ? null : entry.title[language]
      });
    }
  }

  return { nav, pages, planned };
}

/** The pages of a language without a translation of their own, for the translators. */
export function missingTranslations(content: Content, language: Language): PageEntry[] {
  return content.pages.filter((page) => page.language === language && !page.translated);
}

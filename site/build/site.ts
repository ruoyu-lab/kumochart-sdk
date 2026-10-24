import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import type { Token } from 'markdown-it';
import { LANGUAGES, SOURCE_LANGUAGE, UI_TEXT, type Language } from '../src/shared/ui-text';
import { extractApi } from './api/extract';
import type { ApiModel } from './api/model';
import {
  apiEntryUrl,
  apiTargetUrl,
  renderApiEntry,
  renderApiIndex,
  resolveApiFragment,
  type ApiPage
} from './api/render';
import { parseFenceInfo } from './code-blocks';
import type { SiteConfig } from './config';
import { HOME_FILE, loadContent, pageUrl, type Content, type PageEntry } from './content';
import {
  codeBlockHtml,
  exampleHtml,
  exampleModules,
  liveExampleHtml,
  type LiveExample
} from './examples';
import { createHighlighter, type Highlighter } from './highlight';
import { escapeHtml } from './html';
import { head, renderLayout, topbar, type PageLink, type SidebarGroup } from './layout';
import { apiUrl, resolveLink, type LinkTargets } from './links';
import {
  createMarkdown,
  lineOf,
  parseMarkdown,
  renderMarkdown,
  textSections,
  type Heading,
  type ParsedMarkdown
} from './markdown';
import { Problems, type Problem } from './problems';
import { LANGUAGE_STORAGE_KEY } from '../src/shared/storage-keys';
import { buildSearchIndex, searchIndexFile, type SearchPage } from './search-index';

/** The site, built in memory: what the dev server serves and the build writes. */
export interface Site {
  /** Every page by address, such as `/zh-CN/data/`, with `/` and `/404.html`. */
  readonly pages: ReadonlyMap<string, string>;
  /** The frames of the live examples by address, such as `/examples/zh-CN/data/1.html`. */
  readonly examplePages: ReadonlyMap<string, string>;
  /** The code of the live examples by address, such as `/examples/zh-CN/data/1.ts`. */
  readonly exampleModules: ReadonlyMap<string, string>;
  /** The search index of each language by address. */
  readonly searchIndexes: ReadonlyMap<string, string>;
  /** Images of the pages by address, and their files. */
  readonly images: ReadonlyMap<string, string>;
  readonly warnings: readonly Problem[];
}

export const NOT_FOUND_URL = '/404.html';

let highlighter: Promise<Highlighter> | null = null;

/** Where the Markdown of a page is edited on GitHub. */
function editUrl(config: SiteConfig, path: string): string {
  const file = relative(config.repoRoot, path).split(sep).join('/');
  return `${config.repository}/edit/${config.branch}/${file}`;
}

interface ParsedPage {
  readonly entry: PageEntry;
  readonly parsed: ParsedMarkdown;
}

/** The sidebar of a language: the groups of the navigation, the API reference with its entries. */
function sidebarOf(
  content: Content,
  api: ApiModel,
  language: Language,
  pages: readonly PageEntry[]
): SidebarGroup[] {
  const written = new Set(pages.map((page) => page.file));
  return content.nav.groups
    .map((group) => ({
      title: group.title[language],
      links: group.items.flatMap((item) => {
        if (item.kind === 'api') {
          return [
            {
              title: item.title[language],
              url: apiUrl(language),
              children: api.entries.map((entry) => ({
                title: entry.name,
                url: apiEntryUrl(language, entry.name),
                code: true
              }))
            }
          ];
        }

        return written.has(item.file)
          ? [{ title: item.title[language], url: pageUrl(language, item.file) }]
          : [];
      })
    }))
    .filter((group) => group.links.length > 0);
}

/** The pages of a language in reading order, for the previous and next links. */
function readingOrder(sidebar: readonly SidebarGroup[]): PageLink[] {
  return sidebar.flatMap((group) =>
    group.links.flatMap((link) => [
      { title: link.title, url: link.url },
      ...(link.children ?? []).map((child) => ({ title: child.title, url: child.url }))
    ])
  );
}

function neighbors(
  order: readonly PageLink[],
  url: string,
  home: PageLink
): { previous: PageLink | null; next: PageLink | null } {
  const index = order.findIndex((link) => link.url === url);

  if (index === -1) {
    return { previous: null, next: order[0] ?? null };
  }

  return {
    previous: index === 0 ? home : (order[index - 1] ?? null),
    next: order[index + 1] ?? null
  };
}

function rootPage(): string {
  return `<!doctype html>
<html lang="${SOURCE_LANGUAGE}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>KumoChart</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script>(()=>{const s=${JSON.stringify(LANGUAGES)};let l=null;try{l=localStorage.getItem(${JSON.stringify(LANGUAGE_STORAGE_KEY)})}catch{}if(!s.includes(l)){l=navigator.languages.map((x)=>s.find((y)=>x.toLowerCase().startsWith(y.split('-')[0]))).find(Boolean)??'en'}location.replace('/'+l+'/')})()</script>
<noscript><meta http-equiv="refresh" content="0; url=/${SOURCE_LANGUAGE}/" /></noscript>
</head>
<body>
<p>${LANGUAGES.map((language) => `<a href="/${language}/">${escapeHtml(UI_TEXT[language].languageName)}</a>`).join(' · ')}</p>
</body>
</html>
`;
}

function notFoundPage(repository: string): string {
  const message = (language: Language) => {
    const text = UI_TEXT[language];
    return `<div class="not-found" lang="${language}" data-not-found="${language}"${language === SOURCE_LANGUAGE ? '' : ' hidden'}><h1>${escapeHtml(text.notFoundTitle)}</h1><p>${escapeHtml(text.notFoundText)}</p><p><a href="/${language}/">${escapeHtml(text.backHome)}</a></p></div>`;
  };
  const alternates = Object.fromEntries(
    LANGUAGES.map((language) => [language, `/${language}/`])
  ) as Record<Language, string>;
  return `<!doctype html>
<html lang="${SOURCE_LANGUAGE}">
<head>
${head(`404 · KumoChart`, SOURCE_LANGUAGE)}
</head>
<body class="not-found-page">
${topbar(SOURCE_LANGUAGE, alternates, repository)}
<main id="content" class="main">${LANGUAGES.map(message).join('')}</main>
</body>
</html>
`;
}

/**
 * Builds the site from the documentation: the pages of every language, the API reference, the
 * live examples and the search indexes. Fails with every error found; warnings come back.
 * `api` reuses a reference already extracted from the sources.
 */
export async function buildSite(config: SiteConfig, api?: ApiModel): Promise<Site> {
  const problems = new Problems();
  const content = loadContent(config, problems);
  const md = createMarkdown();
  highlighter ??= createHighlighter();
  const code = await highlighter;
  const model = api ?? extractApi(config.repoRoot);

  for (const warning of model.warnings) {
    problems.warn(resolve(config.repoRoot, warning.file), warning.line, warning.message);
  }

  const parsed: ParsedPage[] = [];

  for (const entry of content.pages) {
    const result = parseMarkdown(md, entry.source.text);

    if (typeof result === 'string') {
      problems.error(entry.source.path, undefined, result);
    } else {
      parsed.push({ entry, parsed: result });
    }
  }

  const anchors = new Map(parsed.map(({ entry, parsed: page }) => [entry.url, page.anchors]));
  const written = new Set(
    content.pages.filter((page) => page.translated).map((page) => `${page.language}/${page.file}`)
  );
  const targets: LinkTargets = {
    anchors: (language, file) => anchors.get(pageUrl(language, file)) ?? null,
    written: (language, file) => written.has(`${language}/${file}`),
    planned: content.planned,
    api: (fragment, language) => {
      const target = resolveApiFragment(model, fragment);
      return 'error' in target ? target : apiTargetUrl(language, target);
    }
  };

  const pages = new Map<string, string>();
  const examples = new Map<string, LiveExample>();
  const images = new Map<string, string>();
  const searchPages = new Map<Language, SearchPage[]>(LANGUAGES.map((language) => [language, []]));
  const searchIndexes = new Map<string, string>();
  const searchUrls = new Map<Language, string>();
  const rendered: {
    entry: PageEntry;
    title: string;
    html: string;
    headings: readonly Heading[];
  }[] = [];

  const image = (source: PageEntry['source'], src: string, line: number | undefined): string => {
    if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) {
      return src;
    }

    const path = resolve(dirname(source.path), decodeURIComponent(src));

    if (relative(config.docsDir, path).startsWith('..') || !existsSync(path)) {
      problems.error(source.path, line, `there is no image ${src} in the documentation`);
      return src;
    }

    const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);
    const url = `/docs-assets/${basename(path, extname(path))}.${hash}${extname(path)}`;
    images.set(url, path);
    return url;
  };

  for (const { entry, parsed: page } of parsed) {
    const { source } = entry;
    let live = 0;

    const fence = (token: Token): string => {
      const info = parseFenceInfo(token.info);
      const line = lineOf(token);

      if (typeof info === 'string') {
        problems.error(source.path, line, info);
        return codeBlockHtml(code, token.content, 'text', entry.language);
      }

      if (!code.supports(info.language)) {
        problems.error(source.path, line, `code blocks cannot be written in "${info.language}"`);
        return codeBlockHtml(code, token.content, 'text', entry.language);
      }

      if (!info.live || info.checked === null) {
        return codeBlockHtml(code, token.content, info.language, entry.language);
      }

      live += 1;
      const example: LiveExample = {
        id: `${source.language}/${source.file.replace(/\.md$/, '')}/${live}`,
        language: info.checked,
        code: token.content,
        title: `${page.title} · ${live}`
      };
      examples.set(example.id, example);
      return liveExampleHtml(code, example, info, entry.language);
    };

    const html = renderMarkdown(md, page, {
      link: (href, line) => {
        const result = resolveLink(
          href,
          {
            language: entry.language,
            contentLanguage: source.language,
            path: source.path,
            anchors: page.anchors
          },
          targets,
          config
        );

        if (result.error !== undefined) {
          problems.error(source.path, line, result.error);
        }

        // A warning shows once, from the page in its own language.
        if (result.warning !== undefined && entry.language === source.language) {
          problems.warn(source.path, line, result.warning);
        }

        return result.href;
      },
      image: (src, line) => image(source, src, line),
      fence
    });

    rendered.push({ entry, title: page.title, html, headings: page.headings });
    searchPages
      .get(entry.language)
      ?.push({ title: page.title, url: entry.url, sections: textSections(page) });
  }

  const apiPages = new Map<Language, { url: string; page: ApiPage }[]>();

  for (const language of LANGUAGES) {
    const renderer = { language, md, highlighter: code, config };
    const list = [
      { url: apiUrl(language), page: renderApiIndex(renderer, model) },
      ...model.entries.map((entry) => ({
        url: apiEntryUrl(language, entry.name),
        page: renderApiEntry(renderer, entry)
      }))
    ];
    apiPages.set(language, list);

    for (const { url, page } of list) {
      searchPages.get(language)?.push({ title: page.title, url, sections: page.sections });
    }

    const file = searchIndexFile(language, buildSearchIndex(searchPages.get(language) ?? []));
    searchIndexes.set(file.url, file.json);
    searchUrls.set(language, file.url);
  }

  problems.throwIfAny(config.repoRoot);

  const sidebars = new Map(
    LANGUAGES.map((language) => [
      language,
      sidebarOf(
        content,
        model,
        language,
        content.pages.filter((page) => page.language === language)
      )
    ])
  );
  const alternatesOf = (url: string): Record<Language, string> =>
    Object.fromEntries(
      LANGUAGES.map((language) => [language, url.replace(/^\/[^/]+\//, `/${language}/`)])
    ) as Record<Language, string>;

  for (const language of LANGUAGES) {
    const sidebar = sidebars.get(language) ?? [];
    const order = readingOrder(sidebar);
    const home = { title: 'KumoChart', url: pageUrl(language, HOME_FILE) };
    const common = {
      language,
      sidebar,
      searchIndexUrl: searchUrls.get(language) ?? '',
      repository: config.repository
    };

    for (const page of rendered.filter((item) => item.entry.language === language)) {
      pages.set(
        page.entry.url,
        renderLayout({
          ...common,
          url: page.entry.url,
          title: page.title,
          html: page.html,
          contentLanguage: page.entry.source.language,
          headings: page.headings,
          alternates: alternatesOf(page.entry.url),
          ...neighbors(order, page.entry.url, home),
          editUrl: editUrl(config, page.entry.source.path),
          ...(page.entry.translated ? {} : { notice: UI_TEXT[language].untranslated })
        })
      );
    }

    for (const { url, page } of apiPages.get(language) ?? []) {
      pages.set(
        url,
        renderLayout({
          ...common,
          url,
          title: page.title,
          html: page.html,
          contentLanguage: 'en',
          headings: page.headings,
          alternates: alternatesOf(url),
          ...neighbors(order, url, home),
          editUrl: null
        })
      );
    }
  }

  pages.set('/', rootPage());
  pages.set(NOT_FOUND_URL, notFoundPage(config.repository));

  const examplePages = new Map<string, string>();
  const modules = new Map<string, string>();

  for (const example of examples.values()) {
    examplePages.set(
      `/examples/${example.id}.html`,
      exampleHtml(example, example.id.split('/')[0] as Language)
    );

    for (const [url, source] of exampleModules(example)) {
      modules.set(url, source);
    }
  }

  return {
    pages,
    examplePages,
    exampleModules: modules,
    searchIndexes,
    images,
    warnings: problems.warnings
  };
}

import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isLanguage, type Language } from '../src/shared/ui-text';
import type { SiteConfig } from './config';
import { pageUrl } from './content';

/** The Markdown file guide pages link to for the API reference, as `api.md#createChart`. */
export const API_LINK_FILE = 'api.md';

/** Where the API reference starts in a language. */
export function apiUrl(language: Language): string {
  return `/${language}/api/`;
}

/** The pages and symbols links can point at. */
export interface LinkTargets {
  /** Anchors of a page as the site shows it in a language, or `null` when there is no such page. */
  anchors(language: Language, file: string): ReadonlySet<string> | null;
  /** Whether a language has a file of its own for a page. */
  written(language: Language, file: string): boolean;
  /** Pages of the navigation that are not written yet. */
  readonly planned: ReadonlySet<string>;
  /**
   * The address of an API symbol in the API reference of a language, from a fragment such as
   * `createChart`, `DataApi.set` or `vue:KumoChart`; a problem as `{ error }`.
   */
  api(fragment: string, language: Language): string | { readonly error: string };
}

/** The page a link is on. */
export interface LinkSource {
  /** The language of the site the page is shown in. */
  readonly language: Language;
  /** The language of the Markdown, different while the page is not translated. */
  readonly contentLanguage: Language;
  /** The Markdown file. */
  readonly path: string;
  /** The anchors of the page itself. */
  readonly anchors: ReadonlySet<string>;
}

export interface LinkResult {
  readonly href: string;
  readonly error?: string;
  readonly warning?: string;
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** Text of a link as markdown-it normalized it, which percent-encodes everything but ASCII. */
function decode(text: string): string {
  return decodeURIComponent(text);
}

/**
 * Where a link of a page goes on the site. Links between Markdown files become addresses of
 * pages, `api.md#…` an address in the API reference, and links to other files of the repository
 * their address on GitHub; links that lead nowhere come back with an error.
 */
export function resolveLink(
  href: string,
  source: LinkSource,
  targets: LinkTargets,
  config: SiteConfig
): LinkResult {
  if (SCHEME.test(href) || href.startsWith('//')) {
    return { href };
  }

  const hash = href.indexOf('#');
  const path = decode(hash === -1 ? href : href.slice(0, hash));
  const fragment = hash === -1 ? '' : href.slice(hash + 1);
  const anchor = decode(fragment);
  const suffix = fragment === '' ? '' : `#${fragment}`;

  if (path === '') {
    return anchor === '' || source.anchors.has(anchor)
      ? { href }
      : { href, error: `there is no heading #${anchor} on this page` };
  }

  const target = path.startsWith('/')
    ? join(config.repoRoot, path)
    : resolve(dirname(source.path), path);

  if (target === join(config.docsDir, API_LINK_FILE)) {
    if (anchor === '') {
      return { href: apiUrl(source.language) };
    }

    const api = targets.api(anchor, source.language);
    return typeof api === 'string' ? { href: api } : { href, error: api.error };
  }

  const inDocs = relative(config.docsDir, target).split(sep);
  const [directory = '', ...rest] = inDocs;

  if (directory !== '..' && isLanguage(directory) && target.endsWith('.md')) {
    const file = rest.join('/');
    // An untranslated page links to the pages of the language it is shown in.
    const language = directory === source.contentLanguage ? source.language : directory;
    const url = `${pageUrl(language, file)}${suffix}`;
    const anchors = targets.anchors(language, file);

    if (anchors === null) {
      return targets.planned.has(file)
        ? { href: url, warning: `links to ${file}, which is not written yet` }
        : { href, error: `there is no page ${directory}/${file}` };
    }

    if (anchor !== '' && !anchors.has(anchor)) {
      return { href, error: `there is no heading #${anchor} on ${language}/${file}` };
    }

    return targets.written(directory, file)
      ? { href: url }
      : {
          href: url,
          warning: `links to ${directory}/${file}, which is not translated yet: a broken link on GitHub until it is`
        };
  }

  const inRepository = relative(config.repoRoot, target);

  if (inRepository.startsWith('..') || !existsSync(target)) {
    return { href, error: `there is no file ${path} in the repository` };
  }

  const kind = statSync(target).isDirectory() ? 'tree' : 'blob';
  const repositoryPath = inRepository.split(sep).join('/');
  return { href: `${config.repository}/${kind}/${config.branch}/${repositoryPath}${suffix}` };
}

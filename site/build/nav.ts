import { LANGUAGES, type Language } from '../src/shared/ui-text';

/** A text in every language of the site. */
export type Localized = Readonly<Record<Language, string>>;

function emptyTitles(): Localized {
  return Object.fromEntries(LANGUAGES.map((language) => [language, ''])) as Localized;
}

/** A page of the navigation, by its file in each language's directory, such as `data.md`. */
export interface NavPage {
  readonly kind: 'page';
  readonly file: string;
  readonly title: Localized;
}

/** The place of the generated API reference in the navigation. */
export interface NavApi {
  readonly kind: 'api';
  readonly title: Localized;
}

export type NavItem = NavPage | NavApi;

export interface NavGroup {
  readonly title: Localized;
  readonly items: readonly NavItem[];
}

/** The navigation file: groups of pages in their order, with their titles in every language. */
export interface Nav {
  readonly groups: readonly NavGroup[];
}

type Json = unknown;

function isRecord(value: Json): value is Readonly<Record<string, Json>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the navigation file, failing with every problem found, each with where it is, such as
 * `groups[1].items[0].title: needs a non-empty "en" title`.
 */
export function parseNav(json: Json): Nav {
  const problems: string[] = [];
  const files = new Set<string>();
  let apis = 0;

  const keys = (path: string, value: Readonly<Record<string, Json>>, allowed: string[]) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        problems.push(`${path}: unknown key "${key}" (expected ${allowed.join(', ')})`);
      }
    }
  };

  const localized = (path: string, value: Json): Localized => {
    if (!isRecord(value)) {
      problems.push(`${path}: needs a title per language, such as { "zh-CN": "…", "en": "…" }`);
      return emptyTitles();
    }

    keys(path, value, [...LANGUAGES]);
    const titles = {} as Record<Language, string>;

    for (const language of LANGUAGES) {
      const title = value[language];

      if (typeof title !== 'string' || title.trim() === '') {
        problems.push(`${path}: needs a non-empty "${language}" title`);
      }

      titles[language] = typeof title === 'string' ? title : '';
    }

    return titles;
  };

  const item = (path: string, value: Json): NavItem | null => {
    if (!isRecord(value)) {
      problems.push(`${path}: must be an object`);
      return null;
    }

    if (value.generated !== undefined) {
      keys(path, value, ['generated', 'title']);

      if (value.generated !== 'api') {
        problems.push(`${path}.generated: the only generated part is "api"`);
      }

      apis += 1;
      return { kind: 'api', title: localized(`${path}.title`, value.title) };
    }

    keys(path, value, ['page', 'title']);
    const file = value.page;

    if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\.md$/.test(file)) {
      problems.push(
        `${path}.page: must be the path of a Markdown file in the language directory, in lower case with hyphens, such as "getting-started.md"`
      );
      return null;
    }

    if (file === 'index.md') {
      problems.push(`${path}.page: index.md is the home page and is not part of the navigation`);
    }

    if (files.has(file)) {
      problems.push(`${path}.page: ${file} is listed twice`);
    }

    files.add(file);
    return { kind: 'page', file, title: localized(`${path}.title`, value.title) };
  };

  if (!isRecord(json) || !Array.isArray(json.groups)) {
    throw new Error('The navigation must be an object with a "groups" array.');
  }

  keys('navigation', json, ['groups']);
  const groups = (json.groups as Json[]).map((group, index): NavGroup => {
    const path = `groups[${index}]`;

    if (!isRecord(group) || !Array.isArray(group.items)) {
      problems.push(`${path}: must be an object with a "title" and an "items" array`);
      return { title: emptyTitles(), items: [] };
    }

    keys(path, group, ['title', 'items']);
    return {
      title: localized(`${path}.title`, group.title),
      items: (group.items as Json[])
        .map((value, position) => item(`${path}.items[${position}]`, value))
        .filter((value) => value !== null)
    };
  });

  if (apis > 1) {
    problems.push('the API reference is listed more than once');
  }

  if (problems.length > 0) {
    throw new Error(`The navigation is invalid:\n- ${problems.join('\n- ')}`);
  }

  return { groups };
}

/** The pages of the navigation in their order. */
export function navPages(nav: Nav): NavPage[] {
  return nav.groups.flatMap((group) => group.items.filter((item) => item.kind === 'page'));
}

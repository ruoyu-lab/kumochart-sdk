import type { MarkdownIt, Token } from 'markdown-it';
import { UI_TEXT, type Language } from '../../src/shared/ui-text';
import type { SiteConfig } from '../config';
import type { Highlighter } from '../highlight';
import { escapeHtml } from '../html';
import type { Heading, TextSection } from '../markdown';
import { KIND_ORDER } from './extract';
import {
  API_SCHEME,
  type ApiCode,
  type ApiEntry,
  type ApiKind,
  type ApiMember,
  type ApiModel,
  type ApiSymbol,
  type ApiTarget
} from './model';

const KIND_TITLES: Readonly<Record<ApiKind, string>> = {
  function: 'Functions',
  component: 'Components',
  class: 'Classes',
  interface: 'Interfaces',
  type: 'Types',
  variable: 'Variables'
};

const KIND_LABELS: Readonly<Record<ApiKind, string>> = {
  function: 'function',
  component: 'component',
  class: 'class',
  interface: 'interface',
  type: 'type',
  variable: 'variable'
};

/** The address of an entry's page. */
export function apiEntryUrl(language: Language, entry: string): string {
  return `/${language}/api/${entry}/`;
}

/** The address of a symbol or member in the API reference. */
export function apiTargetUrl(language: Language, target: ApiTarget): string {
  return `${apiEntryUrl(language, target.entry)}#${target.anchor}`;
}

/**
 * The symbol a fragment of an API link names: `createChart`, `DataApi.set` for a member, or
 * `vue:KumoChart` where several entries have a symbol of that name.
 */
export function resolveApiFragment(
  model: ApiModel,
  fragment: string
): ApiTarget | { error: string } {
  const match = /^(?:([a-z][a-z/-]*):)?([A-Za-z_$][\w$]*)(?:\.([\w$]+|\(call\)|\[index\]))?$/.exec(
    fragment
  );

  if (!match) {
    return {
      error: `"${fragment}" is not an API link; write a symbol such as #createChart, a member such as #DataApi.set, or #vue:KumoChart`
    };
  }

  const [, entryName, name = '', member] = match;
  const entries =
    entryName === undefined
      ? model.entries
      : model.entries.filter((entry) => entry.name === entryName);

  if (entryName !== undefined && entries.length === 0) {
    return { error: `there is no API entry "${entryName}"` };
  }

  const symbols = entries.flatMap((entry) =>
    entry.symbols.filter((symbol) => symbol.name === name)
  );

  if (symbols.length === 0) {
    return {
      error: `the API has no symbol ${name}${entryName === undefined ? '' : ` in ${entryName}`}`
    };
  }

  if (symbols.length > 1) {
    return {
      error: `several entries have a symbol ${name}; name one, as #${symbols.map((symbol) => `${symbol.entry}:${name}`).join(' or #')}`
    };
  }

  const symbol = symbols[0] as ApiSymbol;

  if (member === undefined) {
    return { entry: symbol.entry, anchor: symbol.name };
  }

  const found = symbol.members.find((item) => item.name === member);
  return found
    ? { entry: symbol.entry, anchor: found.anchor }
    : { error: `${name} has no member ${member}` };
}

/** A rendered page of the reference: its article, headings and text for the search. */
export interface ApiPage {
  readonly title: string;
  readonly html: string;
  readonly headings: readonly Heading[];
  readonly sections: readonly TextSection[];
}

interface Renderer {
  readonly language: Language;
  readonly md: MarkdownIt;
  readonly highlighter: Highlighter;
  readonly config: SiteConfig;
}

function codeHtml(renderer: Renderer, code: ApiCode): string {
  return renderer.highlighter.html(
    code.text,
    'ts',
    code.links.map((link) => ({
      start: link.start,
      end: link.end,
      href: apiTargetUrl(renderer.language, link.target)
    }))
  );
}

/** A comment of the sources as HTML, its API links pointing at the reference. */
function docHtml(renderer: Renderer, doc: string): string {
  if (doc.trim() === '') {
    return '';
  }

  const tokens = renderer.md.parse(doc, {});

  for (const token of tokens) {
    for (const child of token.children ?? []) {
      const href = child.type === 'link_open' ? child.attrGet('href') : null;

      if (typeof href === 'string' && href.startsWith(API_SCHEME)) {
        const [entry = '', anchor = ''] = href.slice(API_SCHEME.length).split('#');
        child.attrSet('href', apiTargetUrl(renderer.language, { entry, anchor }));
      }
    }
  }

  const html = renderer.md.renderer.render(tokens, renderer.md.options, {
    hooks: {
      fence: (token: Token) =>
        renderer.highlighter.html(
          token.content,
          renderer.highlighter.supports(token.info.trim()) ? token.info.trim() : 'text'
        )
    }
  });
  return `<div class="api-doc">${html}</div>`;
}

/** The text of a comment for the search, without Markdown. */
function plainText(doc: string): string {
  return doc
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLink(renderer: Renderer, source: { file: string; line: number }): string {
  const href = `${renderer.config.repository}/blob/${renderer.config.branch}/${source.file}#L${source.line}`;
  return `<a class="api-source" href="${escapeHtml(href)}">${escapeHtml(UI_TEXT[renderer.language].apiSource)}</a>`;
}

function anchorLink(id: string): string {
  return `<a class="anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a>`;
}

function memberHtml(renderer: Renderer, member: ApiMember): string {
  return [
    `<div class="api-member" id="${escapeHtml(member.anchor)}">`,
    `<div class="api-signature">${member.code.map((code) => codeHtml(renderer, code)).join('')}${anchorLink(member.anchor)}</div>`,
    docHtml(renderer, member.doc),
    '</div>'
  ].join('\n');
}

function symbolHtml(renderer: Renderer, symbol: ApiSymbol): string {
  return [
    '<section class="api-symbol">',
    `<h3 id="${escapeHtml(symbol.name)}"><code>${escapeHtml(symbol.name)}</code><span class="api-kind">${KIND_LABELS[symbol.kind]}</span>${anchorLink(symbol.name)}${sourceLink(renderer, symbol.source)}</h3>`,
    ...symbol.code.map((code) => codeHtml(renderer, code)),
    docHtml(renderer, symbol.doc),
    symbol.members.length > 0
      ? `<div class="api-members">${symbol.members.map((member) => memberHtml(renderer, member)).join('\n')}</div>`
      : '',
    '</section>'
  ].join('\n');
}

function note(renderer: Renderer): string {
  return `<p class="api-note">${escapeHtml(UI_TEXT[renderer.language].apiEnglishOnly)}</p>`;
}

/** The page of an entry point: its symbols by kind, then what it re-exports. */
export function renderApiEntry(renderer: Renderer, entry: ApiEntry): ApiPage {
  const headings: Heading[] = [{ level: 1, id: '', text: entry.specifier, line: 1 }];
  const sections: TextSection[] = [];
  const parts = [
    `<h1>${escapeHtml(entry.specifier)}</h1>`,
    note(renderer),
    renderer.highlighter.html(`import { … } from '${entry.specifier}';`, 'ts')
  ];

  for (const kind of KIND_ORDER) {
    const symbols = entry.symbols.filter((symbol) => symbol.kind === kind);

    if (symbols.length === 0) {
      continue;
    }

    const id = KIND_TITLES[kind].toLowerCase();
    headings.push({ level: 2, id, text: KIND_TITLES[kind], line: 1 });
    parts.push(`<h2 id="${id}">${KIND_TITLES[kind]}${anchorLink(id)}</h2>`);

    for (const symbol of symbols) {
      headings.push({ level: 3, id: symbol.name, text: symbol.name, line: 1 });
      parts.push(symbolHtml(renderer, symbol));
      sections.push({ anchor: symbol.name, heading: symbol.name, text: plainText(symbol.doc) });

      for (const member of symbol.members) {
        headings.push({ level: 4, id: member.anchor, text: member.name, line: 1 });
        sections.push({
          anchor: member.anchor,
          heading: member.anchor,
          text: plainText(member.doc)
        });
      }
    }
  }

  if (entry.reexports.length > 0) {
    headings.push({ level: 2, id: 're-exports', text: 'Re-exports', line: 1 });
    parts.push(
      `<h2 id="re-exports">Re-exports${anchorLink('re-exports')}</h2>`,
      '<ul class="api-reexports">',
      ...entry.reexports.map(
        (item) =>
          `<li><a href="${escapeHtml(apiTargetUrl(renderer.language, item.target))}"><code>${escapeHtml(item.name)}</code></a> from <code>${escapeHtml(item.target.entry)}</code></li>`
      ),
      '</ul>'
    );
  }

  return { title: entry.specifier, html: parts.join('\n'), headings, sections };
}

/** The first page of the reference: the entry points and what they hold. */
export function renderApiIndex(renderer: Renderer, model: ApiModel): ApiPage {
  const rows = model.entries.map((entry) => {
    const counts = KIND_ORDER.map((kind) => {
      const count = entry.symbols.filter((symbol) => symbol.kind === kind).length;
      return count === 0 ? null : `${count} ${KIND_TITLES[kind].toLowerCase()}`;
    }).filter((text) => text !== null);
    return `<tr><td><a href="${escapeHtml(apiEntryUrl(renderer.language, entry.name))}"><code>${escapeHtml(entry.specifier)}</code></a></td><td>${escapeHtml(counts.join(', '))}</td></tr>`;
  });
  return {
    title: 'API',
    html: [
      '<h1>API</h1>',
      note(renderer),
      '<div class="table-scroll"><table><thead><tr><th>Entry point</th><th>Exports</th></tr></thead><tbody>',
      ...rows,
      '</tbody></table></div>'
    ].join('\n'),
    headings: [{ level: 1, id: '', text: 'API', line: 1 }],
    sections: [
      { anchor: '', heading: 'API', text: model.entries.map((entry) => entry.specifier).join(' ') }
    ]
  };
}

import Markdown, { type Env, type MarkdownIt, type Token } from 'markdown-it';
import { escapeHtml } from './html';
import { Slugger } from './slug';

/** A heading of a page with its anchor, as GitHub makes it. */
export interface Heading {
  readonly level: number;
  readonly id: string;
  readonly text: string;
  /** Line in the Markdown file, from 1. */
  readonly line: number;
}

export interface ParsedMarkdown {
  readonly tokens: Token[];
  /** The text of the page's `#` title. */
  readonly title: string;
  readonly headings: readonly Heading[];
  readonly anchors: ReadonlySet<string>;
}

/** What rendering asks the page for: links, images and code blocks. */
export interface RenderHooks {
  /** The address a link goes to on the site. */
  link(href: string, line: number | undefined): string;
  /** The address of an image on the site. */
  image(src: string, line: number | undefined): string;
  /** The HTML of a fenced code block. */
  fence(token: Token): string;
}

interface RenderEnv extends Env {
  hooks: RenderHooks;
}

/** The text of inline Markdown, as a heading's anchor and the search see it. */
export function inlineText(tokens: readonly Token[] | null): string {
  return (tokens ?? [])
    .map((token) => (token.type === 'text' || token.type === 'code_inline' ? token.content : ''))
    .join('');
}

/** The Markdown renderer of the site: CommonMark with tables and inline HTML, as on GitHub. */
export function createMarkdown(): MarkdownIt {
  const md = new Markdown({ html: true });
  const rules = md.renderer.rules;

  rules.fence = (tokens, index, _options, env) =>
    (env as RenderEnv).hooks.fence(tokens[index] as Token);
  rules.heading_close = (tokens, index) => {
    const close = tokens[index] as Token;
    const id = tokens[index - 2]?.attrGet('id');
    const anchor =
      close.tag === 'h1' || id === null || id === undefined
        ? ''
        : `<a class="anchor" href="#${escapeHtml(String(id))}" aria-hidden="true" tabindex="-1">#</a>`;
    return `${anchor}</${close.tag}>\n`;
  };
  rules.table_open = () => '<div class="table-scroll"><table>\n';
  rules.table_close = () => '</table></div>\n';
  return md;
}

/** Line of a block token in the file, from 1. */
export function lineOf(token: Token): number | undefined {
  return token.map ? token.map[0] + 1 : undefined;
}

/**
 * Parses a page: it starts with its `#` title, the only one, and every heading gets the anchor
 * GitHub gives it. A string is the problem with the page.
 */
export function parseMarkdown(md: MarkdownIt, text: string): ParsedMarkdown | string {
  const tokens = md.parse(text, {});
  const slugger = new Slugger();
  const headings: Heading[] = [];

  tokens.forEach((token, index) => {
    if (token.type === 'heading_open') {
      const text = inlineText(tokens[index + 1]?.children ?? null);
      const id = slugger.slug(text);
      token.attrSet('id', id);
      headings.push({ level: Number(token.tag.slice(1)), id, text, line: lineOf(token) ?? 1 });
    }
  });

  const first = tokens.find((token) => token.type !== 'html_block');

  if (first?.type !== 'heading_open' || first.tag !== 'h1') {
    return 'a page starts with its title, a "# " heading';
  }

  const second = headings.slice(1).find((heading) => heading.level === 1);

  if (second) {
    return `line ${second.line}: a page has one "# " title; use "## " for its sections`;
  }

  return {
    tokens,
    title: headings[0]?.text ?? '',
    headings,
    anchors: new Set(headings.map((heading) => heading.id))
  };
}

/** Renders parsed Markdown, asking `hooks` for the addresses of links and for code blocks. */
export function renderMarkdown(md: MarkdownIt, parsed: ParsedMarkdown, hooks: RenderHooks): string {
  for (const token of parsed.tokens) {
    if (token.type !== 'inline') {
      continue;
    }

    const line = lineOf(token);

    for (const child of token.children ?? []) {
      const href = child.type === 'link_open' ? child.attrGet('href') : null;
      const src = child.type === 'image' ? child.attrGet('src') : null;

      if (typeof href === 'string') {
        child.attrSet('href', hooks.link(href, line));
      }

      if (typeof src === 'string') {
        child.attrSet('src', hooks.image(src, line));
      }
    }
  }

  const env: RenderEnv = { hooks };
  return md.renderer.render(parsed.tokens, md.options, env);
}

/** A part of a page for the search: the text from one `##` or `###` heading to the next. */
export interface TextSection {
  /** The anchor of the heading; empty for the text before the first heading. */
  readonly anchor: string;
  readonly heading: string;
  readonly text: string;
}

/** The text of a page by section, code included, for the search index. */
export function textSections(parsed: ParsedMarkdown): TextSection[] {
  const sections: { anchor: string; heading: string; parts: string[] }[] = [
    { anchor: '', heading: parsed.title, parts: [] }
  ];
  let heading: Token | null = null;

  for (const token of parsed.tokens) {
    const current = sections[sections.length - 1];

    if (token.type === 'heading_open') {
      heading = token;
    } else if (token.type === 'heading_close') {
      heading = null;
    } else if (
      token.type === 'inline' &&
      heading &&
      (heading.tag === 'h2' || heading.tag === 'h3')
    ) {
      sections.push({
        anchor: String(heading.attrGet('id')),
        heading: inlineText(token.children),
        parts: []
      });
    } else if (token.type === 'inline' && heading?.tag !== 'h1') {
      current?.parts.push(inlineText(token.children));
    } else if (token.type === 'fence' || token.type === 'code_block') {
      current?.parts.push(token.content);
    }
  }

  return sections.map(({ anchor, heading: title, parts }) => ({
    anchor,
    heading: title,
    text: parts.join(' ').replace(/\s+/g, ' ').trim()
  }));
}

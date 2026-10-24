import { createCssVariablesTheme, createHighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { escapeHtml } from './html';

/** Colors are CSS variables (`--code-token-keyword`, …) that the site sets for each theme. */
const THEME = createCssVariablesTheme({ name: 'docs', variablePrefix: '--code-' });

/** The languages of code blocks, by the name written after the fence, and their grammars. */
const GRAMMARS = {
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  vue: 'vue',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  json: 'json',
  css: 'css',
  html: 'html'
} as const;

/** Names of code blocks shown without colors. */
const PLAIN = new Set(['', 'text', 'txt']);

/** A part of the code that links somewhere, by offsets in the code. */
export interface CodeLink {
  readonly start: number;
  readonly end: number;
  readonly href: string;
}

export interface Highlighter {
  /** Whether code blocks can be written in this language. */
  supports(language: string): boolean;
  /** The code as a `<pre>` element; `links` turn parts of it into links. */
  html(code: string, language: string, links?: readonly CodeLink[]): string;
}

/** A token's color as a class of the site's stylesheet: `--code-token-keyword` is `t-keyword`. */
function tokenClass(token: ThemedToken): string {
  const match = /^var\(--code-token-([a-z-]+)\)$/.exec(token.color ?? '');
  return match ? `t-${match[1] ?? ''}` : '';
}

/** One line of tokens, split where links start and end. */
function renderLine(tokens: readonly ThemedToken[], links: readonly CodeLink[]): string {
  let html = '';

  for (const token of tokens) {
    const end = token.offset + token.content.length;
    const cuts = new Set([token.offset, end]);

    for (const link of links) {
      if (link.start > token.offset && link.start < end) {
        cuts.add(link.start);
      }

      if (link.end > token.offset && link.end < end) {
        cuts.add(link.end);
      }
    }

    const points = [...cuts].sort((a, b) => a - b);
    const name = tokenClass(token);

    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index] ?? 0;
      const to = points[index + 1] ?? 0;
      const text = escapeHtml(token.content.slice(from - token.offset, to - token.offset));
      const link = links.find((item) => item.start <= from && item.end >= to);
      const span = name === '' ? text : `<span class="${name}">${text}</span>`;
      html += link ? `<a href="${escapeHtml(link.href)}">${span}</a>` : span;
    }
  }

  return html;
}

/** The highlighter of the site's code, with the grammars of the languages above. */
export async function createHighlighter(): Promise<Highlighter> {
  const grammars = [...new Set(Object.values(GRAMMARS))];
  const core = await createHighlighterCore({
    themes: [THEME],
    langs: grammars.map((name) => bundledLanguages[name]),
    engine: createJavaScriptRegexEngine()
  });

  return {
    supports: (language) => PLAIN.has(language) || language in GRAMMARS,
    html: (code, language, links = []) => {
      const text = code.replace(/\n$/, '');
      const grammar = GRAMMARS[language as keyof typeof GRAMMARS] as string | undefined;
      const lines =
        grammar === undefined
          ? text.split('\n').map((line) => escapeHtml(line))
          : core
              .codeToTokens(text, { lang: grammar, theme: THEME.name ?? 'docs' })
              .tokens.map((line) => renderLine(line, links));
      return `<pre class="code" data-language="${escapeHtml(language)}"><code>${lines.join('\n')}</code></pre>`;
    }
  };
}

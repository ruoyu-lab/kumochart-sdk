import { describe, expect, it } from 'vitest';
import {
  createMarkdown,
  parseMarkdown,
  renderMarkdown,
  textSections,
  type ParsedMarkdown
} from '../build/markdown';

const md = createMarkdown();

function parse(text: string): ParsedMarkdown {
  const parsed = parseMarkdown(md, text);

  if (typeof parsed === 'string') {
    throw new Error(parsed);
  }

  return parsed;
}

const PAGE = `<!-- a comment before the title -->
# 数据 and \`bars\`

Intro with a [link](other.md) and ![an image](a.png).

## 设置数据

Text.

### Options

| a | b |
| - | - |
| 1 | 2 |

## 设置数据

\`\`\`ts
chart.data.set(bars);
\`\`\`
`;

describe('a page of Markdown', () => {
  it('has its title, and anchors on its headings as on GitHub', () => {
    const parsed = parse(PAGE);
    expect(parsed.title).toBe('数据 and bars');
    expect(parsed.headings.map((heading) => [heading.level, heading.id, heading.line])).toEqual([
      [1, '数据-and-bars', 2],
      [2, '设置数据', 6],
      [3, 'options', 10],
      [2, '设置数据-1', 16]
    ]);
    expect([...parsed.anchors]).toContain('设置数据-1');
  });

  it('starts with a single title', () => {
    expect(parseMarkdown(md, 'Text first.\n\n# Title\n')).toBe(
      'a page starts with its title, a "# " heading'
    );
    expect(parseMarkdown(md, '# One\n\n# Two\n')).toBe(
      'line 3: a page has one "# " title; use "## " for its sections'
    );
  });

  it('renders with the addresses and code blocks the page gives', () => {
    const html = renderMarkdown(md, parse(PAGE), {
      link: (href) => `/site/${href}`,
      image: (src) => `/images/${src}`,
      fence: (token) => `<pre data-info="${token.info}">${token.content}</pre>`
    });

    expect(html).toContain('<a href="/site/other.md">link</a>');
    expect(html).toContain('<img src="/images/a.png" alt="an image">');
    expect(html).toContain(
      '<h2 id="设置数据">设置数据<a class="anchor" href="#设置数据" aria-hidden="true" tabindex="-1">#</a></h2>'
    );
    expect(html).toContain('<h1 id="数据-and-bars">数据 and <code>bars</code></h1>');
    expect(html).toContain('<div class="table-scroll"><table>');
    expect(html).toContain('<pre data-info="ts">chart.data.set(bars);\n</pre>');
  });

  it('gives its text by section for the search', () => {
    expect(textSections(parse(PAGE))).toEqual([
      { anchor: '', heading: '数据 and bars', text: 'Intro with a link and .' },
      { anchor: '设置数据', heading: '设置数据', text: 'Text.' },
      { anchor: 'options', heading: 'Options', text: 'a b 1 2' },
      { anchor: '设置数据-1', heading: '设置数据', text: 'chart.data.set(bars);' }
    ]);
  });
});

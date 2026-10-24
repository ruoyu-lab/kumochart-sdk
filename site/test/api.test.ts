import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { entryFiles, extractApi } from '../build/api/extract';
import type { ApiModel, ApiSymbol } from '../build/api/model';
import { renderApiEntry, resolveApiFragment } from '../build/api/render';
import { siteConfig } from '../build/config';
import { createHighlighter } from '../build/highlight';
import { createMarkdown } from '../build/markdown';

const config = siteConfig();
let model: ApiModel;

beforeAll(() => {
  model = extractApi(config.repoRoot);
});

function symbol(entry: string, name: string): ApiSymbol {
  const found = model.entries
    .find((item) => item.name === entry)
    ?.symbols.find((item) => item.name === name);

  if (!found) {
    throw new Error(`No ${name} in ${entry}.`);
  }

  return found;
}

describe('the API reference', () => {
  it('covers every entry point of the packages', () => {
    expect(model.entries.map((entry) => entry.specifier)).toEqual([
      '@kumochart-sdk/core',
      '@kumochart-sdk/core/indicators',
      '@kumochart-sdk/core/drawings',
      '@kumochart-sdk/core/chart-types',
      '@kumochart-sdk/core/alerts',
      '@kumochart-sdk/core/trading',
      '@kumochart-sdk/core/replay',
      '@kumochart-sdk/core/volume-profile',
      '@kumochart-sdk/core/watermark',
      '@kumochart-sdk/core/all',
      '@kumochart-sdk/vue',
      '@kumochart-sdk/react'
    ]);

    for (const entry of model.entries) {
      expect(entry.symbols.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('gives every symbol and member of a page its own anchor', () => {
    for (const entry of model.entries) {
      const anchors = entry.symbols.flatMap((item) => [
        item.name,
        ...item.members.map((member) => member.anchor)
      ]);
      expect(new Set(anchors).size, entry.name).toBe(anchors.length);
    }
  });

  it('links the types of a declaration to where they are documented', () => {
    const create = symbol('core', 'createChart');
    const [code] = create.code;
    expect(code?.text).toBe(
      'function createChart<const M extends readonly ChartModule[] = readonly []>(\n  container: HTMLElement,\n  options?: CreateChartOptions<M>\n): Chart<M>'
    );
    expect(code?.links.map((link) => [code.text.slice(link.start, link.end), link.target])).toEqual(
      [
        ['ChartModule', { entry: 'core', anchor: 'ChartModule' }],
        ['CreateChartOptions', { entry: 'core', anchor: 'CreateChartOptions' }],
        ['Chart', { entry: 'core', anchor: 'Chart' }]
      ]
    );

    for (const entry of model.entries) {
      for (const item of entry.symbols) {
        for (const code of [...item.code, ...item.members.flatMap((member) => member.code)]) {
          for (const link of code.links) {
            const target = model.entries.find((other) => other.name === link.target.entry);
            const anchors = target?.symbols.map((other) => other.name) ?? [];
            expect(anchors, `${item.name} → ${link.target.anchor}`).toContain(link.target.anchor);
          }
        }
      }
    }
  });

  it('documents the members of interfaces and the props of the Vue component', () => {
    const data = symbol('core', 'DataApi');
    expect(data.kind).toBe('interface');
    expect(data.members.find((member) => member.name === 'set')).toMatchObject({
      anchor: 'DataApi.set',
      code: [{ text: 'set(bars: readonly BarInput[], options?: DataSetOptions): void' }],
      doc: 'Replaces the source bars. Bars must be sorted by strictly ascending time.'
    });

    const component = symbol('vue', 'KumoChart');
    expect(component.kind).toBe('component');
    expect(component.members.map((member) => member.name)).toContain('timeframe');
    expect(component.members.find((member) => member.name === 'data')?.code[0]?.text).toBe(
      'data?: readonly BarInput[]'
    );
  });

  it('turns links of the comments into links of the reference', () => {
    expect(symbol('core/all', 'AllModules').doc).toBe(
      'The modules of [`allModules`](api:core/all#allModules), for `Chart<AllModules>`.'
    );
  });

  it('resolves the fragments of API links', () => {
    expect(resolveApiFragment(model, 'createChart')).toEqual({
      entry: 'core',
      anchor: 'createChart'
    });
    expect(resolveApiFragment(model, 'DataApi.set')).toEqual({
      entry: 'core',
      anchor: 'DataApi.set'
    });
    expect(resolveApiFragment(model, 'MACD')).toEqual({ entry: 'core/indicators', anchor: 'MACD' });
    expect(resolveApiFragment(model, 'vue:KumoChart')).toEqual({
      entry: 'vue',
      anchor: 'KumoChart'
    });
    expect(resolveApiFragment(model, 'KumoChart')).toEqual({
      error:
        'several entries have a symbol KumoChart; name one, as #vue:KumoChart or #react:KumoChart'
    });
    expect(resolveApiFragment(model, 'DataApi.nothing')).toEqual({
      error: 'DataApi has no member nothing'
    });
    expect(resolveApiFragment(model, 'svelte:KumoChart')).toEqual({
      error: 'there is no API entry "svelte"'
    });
    const notALink = resolveApiFragment(model, 'chart.data.set()');
    expect('error' in notALink ? notALink.error : '').toContain('is not an API link');
  });

  it('renders an entry with the anchors and links of its symbols', async () => {
    const page = renderApiEntry(
      { language: 'en', md: createMarkdown(), highlighter: await createHighlighter(), config },
      model.entries[0]!
    );
    expect(page.html).toContain('<h3 id="createChart"><code>createChart</code>');
    expect(page.html).toContain(
      '<a href="/en/api/core/#ChartModule"><span class="t-function">ChartModule</span></a>'
    );
    expect(page.html).toContain('<div class="api-member" id="DataApi.set">');
    expect(
      page.headings.filter((heading) => heading.level === 2).map((heading) => heading.text)
    ).toEqual(['Functions', 'Classes', 'Interfaces', 'Types', 'Variables']);
  });

  it('is pointed at by docs/api.md for readers on GitHub', () => {
    const text = readFileSync(join(config.repoRoot, 'docs/api.md'), 'utf8');

    for (const entry of entryFiles(config.repoRoot)) {
      expect(text).toContain(
        `[\`${entry.specifier}\`](../${relative(config.repoRoot, entry.file)})`
      );
    }
  });
});

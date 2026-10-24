import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractApi } from '../build/api/extract';
import type { ApiModel } from '../build/api/model';
import { siteConfig } from '../build/config';
import { formatProblem } from '../build/problems';
import { buildSite, NOT_FOUND_URL, type Site } from '../build/site';
import type { SearchIndex } from '../src/shared/search';

const config = siteConfig('site/test/fixtures/docs');
let api: ApiModel;
let site: Site;

beforeAll(async () => {
  api = extractApi(config.repoRoot);
  site = await buildSite(config, api);
});

function page(url: string): string {
  const html = site.pages.get(url);

  if (html === undefined) {
    throw new Error(`No page ${url}.`);
  }

  return html;
}

describe('the site of the test pages', () => {
  it('has every written page in every language, the API reference, the root and a 404 page', () => {
    expect([...site.pages.keys()].filter((url) => !url.includes('/api/'))).toEqual([
      '/zh-CN/',
      '/zh-CN/guide/',
      '/zh-CN/live/',
      '/zh-CN/frameworks/',
      '/en/',
      '/en/guide/',
      '/en/live/',
      '/en/frameworks/',
      '/ja/',
      '/ja/guide/',
      '/ja/live/',
      '/ja/frameworks/',
      '/ko/',
      '/ko/guide/',
      '/ko/live/',
      '/ko/frameworks/',
      '/',
      NOT_FOUND_URL
    ]);
    expect(site.pages.has('/zh-CN/api/')).toBe(true);
    expect(site.pages.has('/en/api/core/indicators/')).toBe(true);
  });

  it('warns about the page not written yet and the links to it', () => {
    const warnings = site.warnings.map((warning) => formatProblem(warning, config.repoRoot));
    expect(warnings).toContain(
      'site/test/fixtures/docs/nav.json: 1 page is not written yet and left out of the site: planned.md'
    );
    expect(warnings).toContain(
      'site/test/fixtures/docs/zh-CN/index.md:5: links to planned.md, which is not written yet'
    );
  });

  it('rewrites the links of the Markdown to the site, the API reference and GitHub', () => {
    const html = page('/zh-CN/guide/');
    expect(html).toContain(
      'href="/zh-CN/live/#%E6%8C%89%E6%88%90%E4%BA%A4%E7%94%9F%E6%88%90-k-%E7%BA%BF"'
    );
    expect(html).toContain('href="/zh-CN/api/core/#createChart"');
    expect(html).toContain('href="/zh-CN/api/core/#DataApi.set"');
    expect(html).toContain('href="/zh-CN/api/vue/#KumoChart"');
    expect(html).toContain(
      'href="https://github.com/ruoyu-lab/kumochart-sdk/blob/main/packages/core/src/index.ts"'
    );
    expect(html).toContain(
      'href="https://github.com/ruoyu-lab/kumochart-sdk/edit/main/site/test/fixtures/docs/zh-CN/guide.md"'
    );
  });

  it('shows an untranslated page in the source language with a note, linking within its language', () => {
    const html = page('/en/live/');
    expect(html).toContain('<article class="prose" lang="zh-CN">');
    expect(html).toContain('This page has not been translated yet; it is shown in Chinese.');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<link rel="alternate" hreflang="zh-CN" href="/zh-CN/live/" />');
    expect(page('/en/guide/')).not.toContain('class="notice"');
  });

  it('marks the current page in the sidebar and links the pages before and after it', () => {
    const html = page('/zh-CN/live/');
    expect(html).toContain('<a href="/zh-CN/live/" aria-current="page">可操作的图表</a>');
    expect(html).toContain(
      '<a class="pager-previous" href="/zh-CN/guide/" rel="prev"><span>上一页</span>写法示例</a>'
    );
    expect(html).toContain(
      '<a class="pager-next" href="/zh-CN/frameworks/" rel="next"><span>下一页</span>Vue 和 React</a>'
    );
    expect(html).toContain('<li class="toc-level-2"><a href="#周期合成">周期合成</a></li>');
  });

  it('runs each live example in a frame of its own, from the source page', () => {
    expect([...site.examplePages.keys()]).toEqual([
      '/examples/zh-CN/live/1.html',
      '/examples/zh-CN/live/2.html',
      '/examples/zh-CN/frameworks/1.html',
      '/examples/zh-CN/frameworks/2.html'
    ]);
    expect([...site.exampleModules.keys()]).toEqual([
      '/examples/zh-CN/live/1.ts',
      '/examples/zh-CN/live/2.ts',
      '/examples/zh-CN/frameworks/1.vue',
      '/examples/zh-CN/frameworks/1.entry.ts',
      '/examples/zh-CN/frameworks/2.tsx',
      '/examples/zh-CN/frameworks/2.entry.ts'
    ]);
    expect(page('/en/live/')).toContain(
      '<iframe class="live-frame" src="/examples/zh-CN/live/1.html" title="Live example" loading="lazy" style="height:360px">'
    );
    expect(page('/zh-CN/live/')).toContain('<details class="live-code">');
    expect(site.examplePages.get('/examples/zh-CN/live/1.html')).toContain(
      '<div id="chart"></div>'
    );
  });

  it('keeps the images of the pages', () => {
    const [url, file] = [...site.images][0] ?? [];
    expect(url).toMatch(/^\/docs-assets\/candles\.[0-9a-f]{10}\.svg$/);
    expect(file).toBe(join(config.docsDir, 'zh-CN/images/candles.svg'));
    expect(page('/zh-CN/guide/')).toContain(`<img src="${url ?? ''}" alt="三根 K 线">`);
  });

  it('builds a search index per language with the pages and the API', () => {
    const indexes = [...site.searchIndexes].map(
      ([url, json]) => [url, JSON.parse(json) as SearchIndex] as const
    );
    expect(indexes.map(([url]) => url.replace(/\.[0-9a-f]{10}\./, '.HASH.'))).toEqual([
      '/search/zh-CN.HASH.json',
      '/search/en.HASH.json',
      '/search/ja.HASH.json',
      '/search/ko.HASH.json'
    ]);
    const [, zh] = indexes[0]!;
    expect(zh.records.some(([, , , text]) => text.includes('均线指标'))).toBe(true);
    expect(zh.records.some(([, anchor]) => anchor === 'DataApi.set')).toBe(true);
    expect(page('/zh-CN/').match(/<meta name="docs-search-index" content="([^"]+)"/)?.[1]).toBe(
      indexes[0]?.[0]
    );
  });
});

describe('a site with mistakes', () => {
  const root = mkdtempSync(join(tmpdir(), 'kumochart-docs-'));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fails with every error at once', async () => {
    write(
      'nav.json',
      JSON.stringify({
        groups: [
          {
            title: { 'zh-CN': '页', en: 'Pages', ja: 'ページ', ko: '페이지' },
            items: [{ page: 'a.md', title: { 'zh-CN': 'A', en: 'A', ja: 'A', ko: 'A' } }]
          }
        ]
      })
    );
    write('api.md', '# API\n');
    write('zh-CN/index.md', '# 首页\n\n[坏链接](a.md#nope) [坏 API](../api.md#nothingAtAll)\n');
    write('zh-CN/a.md', 'No title.\n');
    write('zh-CN/orphan.md', '# Orphan\n');
    write('zh-CN/code.md', '# Code\n');
    write('en/extra.md', '# Extra\n');

    const at = (path: string) => relative(config.repoRoot, join(root, path));
    await expect(buildSite(siteConfig(root), api)).rejects.toThrow(
      [
        'The documentation has 6 errors:',
        `  ${at('zh-CN/code.md')}: the page is not in ${at('nav.json')}; add it to a group`,
        `  ${at('zh-CN/orphan.md')}: the page is not in ${at('nav.json')}; add it to a group`,
        `  ${at('en/extra.md')}: the translation has no zh-CN page zh-CN/extra.md`,
        `  ${at('zh-CN/a.md')}: a page starts with its title, a "# " heading`,
        `  ${at('zh-CN/index.md')}:3: there is no page zh-CN/a.md`,
        `  ${at('zh-CN/index.md')}:3: the API has no symbol nothingAtAll`
      ].join('\n')
    );
  });
});

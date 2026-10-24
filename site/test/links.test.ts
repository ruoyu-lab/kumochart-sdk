import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { siteConfig } from '../build/config';
import { resolveLink, type LinkSource, type LinkTargets } from '../build/links';

const config = siteConfig('site/test/fixtures/docs');
const repository = 'https://github.com/ruoyu-lab/kumochart-sdk';

const targets: LinkTargets = {
  anchors: (_language, file) =>
    file === 'live.md'
      ? new Set(['按成交生成-k-线'])
      : file === 'guide.md'
        ? new Set(['链接'])
        : null,
  written: (language, file) => language === 'zh-CN' || file === 'guide.md',
  planned: new Set(['planned.md']),
  api: (fragment, language) =>
    fragment === 'createChart' ? `/${language}/api/core/#createChart` : { error: `no ${fragment}` }
};

const guide: LinkSource = {
  language: 'zh-CN',
  contentLanguage: 'zh-CN',
  path: join(config.docsDir, 'zh-CN/guide.md'),
  anchors: new Set(['链接'])
};

const link = (href: string, source: LinkSource = guide) =>
  resolveLink(href, source, targets, config);

describe('the links of a page', () => {
  it('keep external addresses and check anchors of the page', () => {
    expect(link('https://data.binance.vision/')).toEqual({ href: 'https://data.binance.vision/' });
    expect(link('#%E9%93%BE%E6%8E%A5')).toEqual({ href: '#%E9%93%BE%E6%8E%A5' });
    expect(link('#nope')).toEqual({
      href: '#nope',
      error: 'there is no heading #nope on this page'
    });
  });

  it('turn links between pages into addresses of the site, with their anchors checked', () => {
    expect(link('live.md')).toEqual({ href: '/zh-CN/live/' });
    expect(link('./live.md#%E6%8C%89%E6%88%90%E4%BA%A4%E7%94%9F%E6%88%90-k-%E7%BA%BF')).toEqual({
      href: '/zh-CN/live/#%E6%8C%89%E6%88%90%E4%BA%A4%E7%94%9F%E6%88%90-k-%E7%BA%BF'
    });
    expect(link('../en/guide.md')).toEqual({ href: '/en/guide/' });
    expect(link('live.md#nope')).toEqual({
      href: 'live.md#nope',
      error: 'there is no heading #nope on zh-CN/live.md'
    });
    expect(link('missing.md')).toEqual({
      href: 'missing.md',
      error: 'there is no page zh-CN/missing.md'
    });
  });

  it('warn about pages not written or not translated yet', () => {
    expect(link('planned.md')).toEqual({
      href: '/zh-CN/planned/',
      warning: 'links to planned.md, which is not written yet'
    });

    const english = {
      ...guide,
      language: 'en',
      contentLanguage: 'en',
      path: join(config.docsDir, 'en/guide.md')
    } as const;
    expect(link('live.md', english)).toEqual({
      href: '/en/live/',
      warning:
        'links to en/live.md, which is not translated yet: a broken link on GitHub until it is'
    });
  });

  it('keep an untranslated page in the language it is shown in', () => {
    expect(link('live.md', { ...guide, language: 'en' })).toEqual({ href: '/en/live/' });
  });

  it('link the API reference through api.md', () => {
    expect(link('../api.md')).toEqual({ href: '/zh-CN/api/' });
    expect(link('../api.md#createChart')).toEqual({ href: '/zh-CN/api/core/#createChart' });
    expect(link('/site/test/fixtures/docs/api.md#createChart')).toEqual({
      href: '/zh-CN/api/core/#createChart'
    });
    expect(link('../api.md#nothing')).toEqual({ href: '../api.md#nothing', error: 'no nothing' });
  });

  it('send links to other files of the repository to GitHub', () => {
    expect(link('../../../../../packages/core/src/index.ts')).toEqual({
      href: `${repository}/blob/main/packages/core/src/index.ts`
    });
    expect(link('/packages/core/src/index.ts#L3')).toEqual({
      href: `${repository}/blob/main/packages/core/src/index.ts#L3`
    });
    expect(link('/packages/core')).toEqual({ href: `${repository}/tree/main/packages/core` });
    expect(link('/packages/core/missing.ts')).toEqual({
      href: '/packages/core/missing.ts',
      error: 'there is no file /packages/core/missing.ts in the repository'
    });
    expect(link('../../../../../../outside.md').error).toBe(
      'there is no file ../../../../../../outside.md in the repository'
    );
  });
});

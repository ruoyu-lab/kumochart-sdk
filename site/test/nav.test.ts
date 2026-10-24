import { describe, expect, it } from 'vitest';
import { navPages, parseNav } from '../build/nav';

/** Titles in every language: Chinese, and English in the other languages' places too. */
const title = (zh: string, en: string) => ({ 'zh-CN': zh, en, ja: en, ko: en });

describe('the navigation file', () => {
  it('lists groups of pages and the API reference in order', () => {
    const nav = parseNav({
      groups: [
        {
          title: title('开始', 'Getting started'),
          items: [
            { page: 'introduction.md', title: title('介绍', 'Introduction') },
            { page: 'guide/data.md', title: title('数据', 'Data') }
          ]
        },
        {
          title: title('参考', 'Reference'),
          items: [{ generated: 'api', title: title('API', 'API') }]
        }
      ]
    });

    expect(navPages(nav).map((page) => page.file)).toEqual(['introduction.md', 'guide/data.md']);
    expect(nav.groups[1]?.items[0]).toEqual({ kind: 'api', title: title('API', 'API') });
  });

  it('reports every problem with where it is', () => {
    expect(() =>
      parseNav({
        groups: [
          {
            title: { 'zh-CN': '开始' },
            items: [
              { page: 'Intro.MD', title: title('介绍', 'Introduction') },
              { page: 'data.md', title: title('数据', 'Data'), extra: true },
              { page: 'data.md', title: title('数据', 'Data') },
              { page: 'index.md', title: title('首页', 'Home') },
              { generated: 'search', title: title('搜索', 'Search') }
            ]
          }
        ]
      })
    ).toThrow(
      [
        'The navigation is invalid:',
        '- groups[0].title: needs a non-empty "en" title',
        '- groups[0].title: needs a non-empty "ja" title',
        '- groups[0].title: needs a non-empty "ko" title',
        '- groups[0].items[0].page: must be the path of a Markdown file in the language directory, in lower case with hyphens, such as "getting-started.md"',
        '- groups[0].items[1]: unknown key "extra" (expected page, title)',
        '- groups[0].items[2].page: data.md is listed twice',
        '- groups[0].items[3].page: index.md is the home page and is not part of the navigation',
        '- groups[0].items[4].generated: the only generated part is "api"'
      ].join('\n')
    );
  });

  it('must be an object with groups', () => {
    expect(() => parseNav([])).toThrow('The navigation must be an object with a "groups" array.');
  });
});

import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '../build/search-index';
import { prepareIndex, queryTerms, search, snippet } from '../src/shared/search';

const index = prepareIndex(
  buildSearchIndex([
    {
      title: '指标',
      url: '/zh-CN/indicators/',
      sections: [
        { anchor: '', heading: '指标', text: '图表自带常用的技术指标，比如均线和成交量。' },
        {
          anchor: '添加指标',
          heading: '添加指标',
          text: '用 chart.indicators.add() 添加一个均线指标。'
        }
      ]
    },
    {
      title: '数据',
      url: '/zh-CN/data/',
      sections: [
        { anchor: '', heading: '数据', text: '用 chart.data.set() 设置 K 线，周期由图表合成。' },
        { anchor: 'trades', heading: '逐笔成交', text: 'addTrades() folds trades into the bars.' }
      ]
    },
    {
      title: '@kumochart-sdk/core',
      url: '/zh-CN/api/core/',
      sections: [
        {
          anchor: 'DataApi.addTrades',
          heading: 'DataApi.addTrades',
          text: 'Streams trades, folded into the source bars.'
        }
      ]
    }
  ])
);

describe('the search', () => {
  it('finds Chinese words inside the text', () => {
    expect(search(index, '均线').map((result) => result.url)).toEqual([
      '/zh-CN/indicators/',
      '/zh-CN/indicators/#添加指标'
    ]);
    expect(search(index, '成交')[0]?.url).toBe('/zh-CN/data/#trades');
  });

  it('needs every word of the query and ranks headings first', () => {
    expect(search(index, '指标 添加').map((result) => result.url)).toEqual([
      '/zh-CN/indicators/#添加指标'
    ]);
    expect(search(index, 'addtrades').map((result) => result.url)).toEqual([
      '/zh-CN/api/core/#DataApi.addTrades',
      '/zh-CN/data/#trades'
    ]);
    expect(search(index, '均线 nothing')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });

  it('gives the page, the heading and the text around the match', () => {
    const [result] = search(index, '添加');
    expect(result).toMatchObject({ page: '指标', heading: '添加指标' });
    expect(result?.snippet).toEqual([
      { text: '…', match: false },
      { text: ' chart.indicators.add() ', match: false },
      { text: '添加', match: true },
      { text: '一个均线指标。', match: false }
    ]);
  });

  it('splits a query at any space and cuts long text around the first match', () => {
    expect(queryTerms('  Data　设置  ')).toEqual(['data', '设置']);
    const long = `${'a'.repeat(100)} target ${'b'.repeat(200)}`;
    const segments = snippet(long, ['target']);
    expect(segments[0]).toEqual({ text: '…', match: false });
    expect(segments.find((segment) => segment.match)?.text).toBe('target');
    expect(segments[segments.length - 1]).toEqual({ text: '…', match: false });
  });
});

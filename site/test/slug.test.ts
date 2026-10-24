import { describe, expect, it } from 'vitest';
import { Slugger, slugify } from '../build/slug';

describe('heading anchors', () => {
  it('are made as GitHub makes them', () => {
    expect(slugify('Getting started')).toBe('getting-started');
    expect(slugify('`chart.data.set()` and bars')).toBe('chartdataset-and-bars');
    expect(slugify('Timeframes & calendars: 1m → 1h')).toBe('timeframes--calendars-1m--1h');
    expect(slugify('snake_case stays')).toBe('snake_case-stays');
  });

  it('keep Chinese text and drop its punctuation', () => {
    expect(slugify('按成交生成 K 线')).toBe('按成交生成-k-线');
    expect(slugify('数据，周期和交易日历？')).toBe('数据周期和交易日历');
  });

  it('number repeated headings', () => {
    const slugger = new Slugger();
    expect(
      ['示例', '示例', 'Options', 'options', '示例-1'].map((text) => slugger.slug(text))
    ).toEqual(['示例', '示例-1', 'options', 'options-1', '示例-1-1']);
  });
});

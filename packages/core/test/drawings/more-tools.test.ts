import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { DRAWING_OPTIONS, drawingTexts } from '../../src/drawings/options';
import { createDefaultOptions } from '../../src/options/defaults';
import { MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, click } from '../helpers/chart';
import { canvasCalls } from '../setup';

function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

/** Texts painted on the objects layer. */
function objectTexts(chart: Chart): string[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
  const calls = canvas ? canvasCalls(canvas) : [];
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
}

const point = (index: number, price: number) => ({ time: T0 + index * MINUTE, price });

/** The words the drawings of a chart in `locale` paint. */
const textsIn = (locale: string) =>
  drawingTexts({ ...createDefaultOptions([DRAWING_OPTIONS]), locale });

describe('more drawing tools', () => {
  it('writes spans of time in the chart language', () => {
    const english = textsIn('en-US');
    const chinese = textsIn('zh-CN');

    expect(english.duration(0)).toBe('0s');
    expect(english.duration(90_000)).toBe('1m 30s');
    expect(english.duration(3.5 * 3_600_000)).toBe('3h 30m');
    expect(english.duration(-(3 * 86_400_000 + 4 * 3_600_000 + 60_000))).toBe('3d 4h');
    expect(chinese.duration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3天4小时');
    expect(chinese.duration(45 * 60_000)).toBe('45分钟');
  });

  it('writes Japanese and Korean for ja and ko locales', () => {
    const japanese = textsIn('ja-JP');
    const korean = textsIn('ko-KR');
    const span = 3 * 86_400_000 + 4 * 3_600_000;

    expect(japanese.duration(span)).toBe('3日4時間');
    expect(japanese.duration(90_000)).toBe('1分30秒');
    expect(japanese.bars(60)).toBe('60本');
    expect([japanese.text, japanese.target, japanese.stop, japanese.riskReward]).toEqual([
      'テキスト',
      '利確',
      '損切り',
      'RR比'
    ]);
    expect([japanese.open, japanese.targetHit, japanese.stopped]).toEqual([
      '保有中',
      '利確済み',
      '損切り済み'
    ]);
    expect(korean.duration(span)).toBe('3일 4시간');
    expect(korean.duration(0)).toBe('0초');
    expect(korean.bars(60)).toBe('캔들 60개');
    expect([korean.text, korean.target, korean.stop, korean.riskReward]).toEqual([
      '텍스트',
      '익절',
      '손절',
      '손익비'
    ]);
    expect([korean.open, korean.targetHit, korean.stopped]).toEqual([
      '보유 중',
      '익절 완료',
      '손절 완료'
    ]);
  });

  it('projects a Fibonacci extension from the third anchor', () => {
    const chart = chartWithBars(200);
    chart.drawings.add({
      id: 'ext',
      type: 'fib-extension',
      points: [point(140, 150), point(160, 170), point(170, 160)]
    });

    expect(chart.drawings.levels('ext')).toEqual([
      '0',
      '0.382',
      '0.618',
      '1',
      '1.272',
      '1.618',
      '2',
      '2.618'
    ]);
    // 1.618 of the 20-point move, from 160.
    expect(objectTexts(chart)).toContain('1.618  192.36');
  });

  it('labels date ranges with bars and time, and date and price ranges with both', () => {
    const chart = chartWithBars(200, { locale: 'en-US' });
    chart.drawings.add({ type: 'date-range', points: [point(130, 160), point(190, 170)] });
    chart.drawings.add({ type: 'date-price-range', points: [point(120, 150), point(150, 165)] });
    const texts = objectTexts(chart);

    expect(texts).toContain('60 bars · 1h');
    expect(texts.some((text) => /^\+15\.00 \(\+10\.00%\) · 30 bars · 30m$/.test(text))).toBe(true);

    chart.applyOptions({ locale: 'zh-CN' });
    expect(objectTexts(chart)).toContain('60 根 K 线 · 1小时');
    chart.applyOptions({ locale: 'ja-JP' });
    expect(objectTexts(chart)).toContain('60本 · 1時間');
    chart.applyOptions({ locale: 'ko-KR' });
    expect(objectTexts(chart)).toContain('캔들 60개 · 1시간');
  });

  it('draws a pitchfork that is hit on its lines and between its prongs', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'pitchfork',
      points: [point(120, 150), point(140, 172), point(150, 158)]
    });
    chart.select({ kind: 'drawing', id });
    const hits: Array<{ kind: string; part: string } | null> = [];
    chart.on('click', (event) => hits.push(event.target && { ...event.target }));
    // On the median line: from the pivot through the middle of the other two anchors.
    const [x0, y0] = at(chart, 120, 150);
    const [x1, y1] = at(chart, 145, 165);
    click(chart, (x0 + x1) / 2, (y0 + y1) / 2);

    expect(hits.at(-1)).toMatchObject({ kind: 'drawing', part: 'line' });
  });

  it('places a callout at a target, then edits its text at the box', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('callout');
    click(chart, ...at(chart, 150, 170));
    const [boxX, boxY] = at(chart, 170, 180);
    click(chart, boxX, boxY);
    const area = document.querySelector('textarea');

    if (!area) {
      throw new Error('No editor.');
    }

    // The editor opens at the box, the second anchor.
    expect(Math.abs(Number.parseFloat(area.style.left) - boxX)).toBeLessThan(10);
    area.value = 'Breakout';
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const callout = chart.drawings.list()[0];
    expect(callout).toMatchObject({ type: 'callout', text: 'Breakout' });
    const bounds = chart.drawings.bounds(callout?.id ?? '');
    const [targetX] = at(chart, 150, 170);
    expect(bounds?.x).toBeCloseTo(targetX, 0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThan(boxX);
    expect(objectTexts(chart)).toContain('Breakout');
  });

  it('checks where the text of a custom type starts', () => {
    const chart = chartWithBars(20);

    expect(() => {
      chart.drawings.register({
        type: 'note',
        points: 2,
        editableText: true,
        textAnchor: 2,
        paint: () => undefined,
        hitTest: () => null
      });
    }).toThrow('definition.textAnchor');
  });
});

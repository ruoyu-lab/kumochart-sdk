import { describe, expect, it } from 'vitest';
import { lightTheme } from '../../src/options/themes';
import type { LegendItem } from '../../src/options/types';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { chartWithBars, createTestChart } from '../helpers/chart';

describe('options left unset', () => {
  it('are null, and setting null again unsets them', () => {
    const chart = createTestChart();
    const unset = () => {
      const { locale, timeZone, legend, panes, texts } = chart.options();
      return {
        locale,
        timeZone,
        rows: legend.rows,
        buttons: legend.buttons,
        separatorColor: panes.separatorColor,
        separatorHoverColor: panes.separatorHoverColor,
        days: texts.days,
        legendOpen: texts.legendOpen
      };
    };
    const none = {
      locale: null,
      timeZone: null,
      rows: null,
      buttons: null,
      separatorColor: null,
      separatorHoverColor: null,
      days: null,
      legendOpen: null
    };

    expect(unset()).toEqual(none);

    chart.applyOptions({
      locale: 'de-DE',
      timeZone: 'Asia/Tokyo',
      legend: { rows: () => true, buttons: () => [] },
      panes: { separatorColor: '#123456', separatorHoverColor: '#654321' },
      texts: { days: (count) => `${count}T`, legendOpen: 'Eröffnung' }
    });
    expect(Object.values(unset()).every((value) => value !== null)).toBe(true);

    chart.applyOptions({
      locale: null,
      timeZone: null,
      legend: { rows: null, buttons: null },
      panes: { separatorColor: null, separatorHoverColor: null },
      texts: { days: null, legendOpen: null }
    });
    expect(unset()).toEqual(none);
  });

  it('take their defaults again once unset', () => {
    const chart = chartWithBars(50, { locale: 'de-DE', texts: { legendOpen: 'Eröffnung' } });
    const hidden: LegendItem[] = [];
    chart.applyOptions({
      legend: {
        rows: (item) => {
          hidden.push(item);
          return true;
        }
      }
    });
    chart.screenshot();
    chart.applyOptions({ locale: null, texts: { legendOpen: null }, legend: { rows: null } });
    hidden.length = 0;
    chart.screenshot();

    expect(chart.timeScale.barSpacing()).toBeGreaterThan(0);
    expect(hidden).toEqual([]);
    expect(() => {
      chart.applyOptions({ locale: undefined as unknown as null });
    }).not.toThrow();
  });

  it('drop the style overrides of a series type with null', () => {
    const chart = chartWithBars(50, {
      mainSeries: { styles: { candles: { upColor: '#00aaff', downColor: '#00aaff' } } }
    });
    const latest = () => {
      chart.applyOptions({});
      chart.screenshot();
      return chart.options().mainSeries.styles.candles;
    };

    expect(latest()).toEqual({ upColor: '#00aaff', downColor: '#00aaff' });

    chart.applyOptions({ mainSeries: { styles: { candles: null } } });
    expect(latest()).toBeNull();
  });

  it('tell formatters the locale and the time zone in effect', () => {
    const contexts: Array<{ locale: string; timeZone: string }> = [];
    const chart = createTestChart({
      timeScale: {
        formatter: (time, context) => {
          contexts.push({ locale: context.locale, timeZone: context.timeZone });
          return String(time);
        }
      }
    });
    chart.data.set(createBars(50, T0, MINUTE));
    chart.screenshot();

    expect(contexts[0]?.locale).toBe(new Intl.NumberFormat().resolvedOptions().locale);
    expect(contexts[0]?.timeZone).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);

    chart.applyOptions({ locale: 'de-DE', timeZone: 'Asia/Tokyo', theme: lightTheme });
    contexts.length = 0;
    chart.screenshot();
    expect(contexts[0]).toEqual({ locale: 'de-DE', timeZone: 'Asia/Tokyo' });
  });
});

import type { OptionsSection } from './resolve';
import { CHART_TEXTS, unsetTexts } from './texts';
import { lightTheme } from './themes';
import type { ChartOptions } from './types';

/** The default options, with the sections of the modules. */
export function createDefaultOptions(sections: readonly OptionsSection[] = []): ChartOptions {
  const modules = Object.fromEntries(sections.map((section) => [section.key, section.defaults()]));
  return {
    ...modules,
    autoSize: true,
    locale: null,
    timeZone: null,
    theme: lightTheme,
    font: {
      family:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 12
    },
    grid: {
      vertical: true,
      horizontal: true,
      style: 'solid'
    },
    crosshair: {
      mode: 'free',
      vertical: true,
      horizontal: true,
      labels: true,
      style: 'dashed'
    },
    mainSeries: {
      type: 'candles',
      source: 'close',
      styles: {},
      barColor: null
    },
    timeScale: {
      visible: true,
      height: 28,
      barSpacing: 8,
      minBarSpacing: 0.5,
      maxBarSpacing: 60,
      rightOffset: 60,
      loadMoreThreshold: 20,
      formatter: null
    },
    priceScale: {
      visible: true,
      margins: { top: 0.1, bottom: 0.08 },
      precision: 'auto',
      formatter: null,
      minWidth: 48
    },
    latestPrice: {
      line: true,
      label: true,
      countdown: false,
      style: 'dotted',
      color: null
    },
    legend: {
      visible: true,
      rows: null,
      buttons: null,
      hideValuesOnHover: true
    },
    texts: unsetTexts(CHART_TEXTS),
    interaction: {
      pan: true,
      wheelZoom: true,
      pinchZoom: true,
      axisScale: true,
      kineticScroll: true,
      keyboard: true,
      longPressMs: 300,
      touchMagnifier: true,
      hitTolerance: 6
    },
    panes: {
      defaultHeight: 120,
      minHeight: 40,
      separatorHeight: 5,
      separatorWidth: 2,
      separatorColor: null,
      separatorHoverColor: null
    },
    calendar: {
      timeZone: 'UTC',
      sessions: [],
      dayStart: '00:00',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      weekStart: 1,
      bucket: null
    },
    performance: {
      maxPixelRatio: 3,
      maxTrades: 100_000
    }
  };
}

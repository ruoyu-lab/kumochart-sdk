import { createChart, type Chart } from '@kumochart-sdk/core';
import { allModules } from '@kumochart-sdk/core/all';
import { sampleBars } from './data';

/** The events the end-to-end tests read. */
const EVENTS = ['orderDrag', 'drawingsChange', 'toolEnd', 'selectionChange'] as const;

/** What the end-to-end tests read: the chart, and the events it emitted. */
declare global {
  interface Window {
    /** The chart of the page, each page with its own modules. */
    chart: Chart | undefined;
    events: Array<{ type: (typeof EVENTS)[number]; payload: unknown }>;
  }
}

const container = document.getElementById('chart');

if (!container) {
  throw new Error('The page has no #chart element.');
}

const chart = createChart(container, { modules: allModules(), locale: 'en-US', timeZone: 'UTC' });

// The same bars on every run: 3,000 one-minute bars, exactly 50 hours from 13:00 UTC, shown as
// 15-minute bars.
chart.data.set(sampleBars(3000, Date.UTC(2024, 4, 2, 12, 59)), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ id: 'ma', type: 'MA', params: { periods: [5, 10, 20] } });
chart.indicators.add({ id: 'vol', type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });

const events: Window['events'] = [];

for (const type of EVENTS) {
  chart.on(type, (payload) => events.push({ type, payload }));
}

Object.assign(window, { chart, events });

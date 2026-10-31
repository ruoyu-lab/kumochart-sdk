import { createChart, lightTheme } from 'kumo-charts';
import { allDrawings, drawings } from 'kumo-charts/drawings';
import { indicators, MA, MACD, VOL } from 'kumo-charts/indicators';
import { sampleBars, streamTrades } from './data';

const container = document.getElementById('chart');

if (!container) {
  throw new Error('The page has no #chart element.');
}

// The core, three indicator types and every drawing tool.
const chart = createChart(container, {
  modules: [indicators([MA, VOL, MACD]), drawings(allDrawings)],
  theme: lightTheme,
  latestPrice: { countdown: true }
});

// One-minute bars, shown as 15-minute bars built in the browser.
chart.data.set(sampleBars(3000), { interval: '1m' });
chart.data.setTimeframe('15m');

chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20] } });
chart.indicators.add({ type: 'VOL', pane: 'main', scale: 'volume' });
chart.priceScale('main', 'volume').setMargins({ top: 0.8, bottom: 0 });
chart.indicators.add({ type: 'MACD' });

// Live trades fold into the latest bar.
streamTrades((trades) => chart.data.addTrades(trades));

const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-timeframe]')];

for (const button of buttons) {
  button.classList.toggle('active', button.dataset.timeframe === '15m');
  button.addEventListener('click', () => {
    chart.data.setTimeframe(button.dataset.timeframe ?? null);

    for (const other of buttons) {
      other.classList.toggle('active', other === button);
    }
  });
}

// Try the API from the browser console, e.g. `chart.drawings.startTool('trend-line')`.
Object.assign(window, { chart });

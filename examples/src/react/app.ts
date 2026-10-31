import {
  darkTheme,
  lightTheme,
  type Bar,
  type BarInput,
  type Chart,
  type ChartOptionsInput,
  type CrosshairMoveEvent
} from 'kumo-charts';
import { indicators, MA, MACD } from 'kumo-charts/indicators';
import { KumoChart } from '@kumo-charts/react';
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { sampleBars, streamTrades } from '../data';

const MODULES = [indicators([MA, MACD])] as const;

declare global {
  interface Window {
    /** The chart of the page, each page with its own modules. */
    chart: Chart | undefined;
  }
}

/** A minimal React page: the library driven through the React adapter. */
export function App() {
  const [dark, setDark] = useState(false);
  const [bars, setBars] = useState<BarInput[] | undefined>(undefined);
  const [hovered, setHovered] = useState<Bar | null>(null);
  const chart = useRef<Chart | null>(null);
  const options = useMemo<ChartOptionsInput>(
    () => ({ theme: dark ? darkTheme : lightTheme, latestPrice: { countdown: true } }),
    [dark]
  );

  useEffect(() => {
    // Loaded after mounting, as bars from a server would be.
    setBars(sampleBars(3000));
    // Simulated trades, folded by the chart into 1-minute source bars shown as 5-minute bars.
    return streamTrades((trades) => {
      if (chart.current?.data.last()) {
        chart.current.data.addTrades(trades);
      }
    });
  }, []);

  const onReady = (instance: Chart) => {
    const chart = instance as Chart<typeof MODULES>;
    chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20] } });
    chart.indicators.add({ type: 'MACD' });
    window.chart = chart;
  };

  const onCrosshairMove = (event: CrosshairMoveEvent) => {
    setHovered(event.visible ? event.bar : null);
  };

  return h(
    'div',
    { className: dark ? 'react-app dark' : 'react-app' },
    h(
      'header',
      null,
      h('strong', null, 'KumoChart · React · BTC/USDT'),
      h('span', { className: 'close' }, hovered ? `C ${hovered.close.toFixed(2)}` : ''),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setDark(!dark);
          }
        },
        dark ? 'Light' : 'Dark'
      )
    ),
    h(KumoChart, {
      ref: chart,
      modules: MODULES,
      className: 'react-chart',
      ...(bars ? { data: bars } : {}),
      interval: '1m',
      timeframe: '5m',
      options,
      onReady,
      onCrosshairMove
    })
  );
}

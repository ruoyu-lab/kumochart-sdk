import type { BarInput } from '../../src/data/types';
import type { Chart } from '../../src/chart/create-chart';
import { canvasCalls, type CanvasCall } from '../setup';

export const HOUR = 3_600_000;
/** Midnight UTC, the start of a trading day of a calendar in UTC. */
export const DAY_START = Date.UTC(2024, 0, 2);

/** Hourly bars from `start` swinging between 89 and 111, with volumes from 100 to 180. */
export function hourly(count: number, start = DAY_START): BarInput[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + 10 * Math.sin(index / 7);
    const close = 100 + 10 * Math.sin((index + 1) / 7);
    return {
      time: start + index * HOUR,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100 + (index % 5) * 20
    };
  });
}

/** What a layer of the chart paints once it repaints. */
export function layerCalls(chart: Chart, layer: 'scene' | 'objects'): CanvasCall[] {
  const canvas = chart.element.querySelector<HTMLCanvasElement>(`canvas[data-layer="${layer}"]`);

  if (!canvas) {
    throw new Error(`The chart has no ${layer} layer.`);
  }

  const calls = canvasCalls(canvas);
  calls.length = 0;
  chart.applyOptions({});
  chart.screenshot();
  return [...calls];
}

/** How many times a layer calls `name` once it repaints. */
export function count(chart: Chart, layer: 'scene' | 'objects', name: string): number {
  return layerCalls(chart, layer).filter((call) => call.name === name).length;
}

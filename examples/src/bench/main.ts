import { createChart, type BarInput, type Chart, type ChartPlugin } from 'kumo-charts';
import { allModules } from 'kumo-charts/all';

/** One measurement: a duration in milliseconds, or a rate. */
export interface BenchResult {
  readonly group: string;
  readonly name: string;
  readonly value: number;
  readonly unit: 'ms' | 'µs' | '/s';
}

const MINUTE = 60_000;
const T0 = Date.UTC(2024, 0, 1);

/** A deterministic random walk of one-minute bars. */
function minuteBars(count: number): BarInput[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let close = 40_000;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = Math.max(100, open + (random() - 0.5) * 60);
    return {
      time: T0 + index * MINUTE,
      open,
      high: Math.max(open, close) + random() * 20,
      low: Math.min(open, close) - random() * 20,
      close,
      volume: 1 + random() * 50
    };
  });
}

/**
 * A plugin as heavy as a typical analysis overlay: for every visible bar it walks the source
 * bars inside it and marks their price range under the series.
 */
const sourceRangePlugin: ChartPlugin = {
  name: 'source-ranges',
  paint(context) {
    const { ctx, layer, pane, bars, source, visible, barSpacing } = context;

    if (layer !== 'below' || pane.id !== 'main' || !visible) {
      return;
    }

    ctx.fillStyle = 'rgba(79, 70, 229, 0.08)';

    for (let index = visible.from; index <= visible.to; index += 1) {
      const end = index + 1 < bars.length ? bars.time(index + 1) : Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      let low = Number.POSITIVE_INFINITY;

      for (let at = source.lowerBound(bars.time(index)); at < source.length; at += 1) {
        if (source.time(at) >= end) {
          break;
        }

        high = Math.max(high, source.high(at));
        low = Math.min(low, source.low(at));
      }

      if (high >= low) {
        const top = pane.valueToY(high);
        const x = context.indexToX(index) - barSpacing / 2;
        ctx.fillRect(x, top, barSpacing, pane.valueToY(low) - top);
      }
    }
  }
};

function timed(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

/** Average milliseconds per call over `count` calls. */
function average(count: number, operation: (step: number) => void): number {
  const start = performance.now();

  for (let step = 0; step < count; step += 1) {
    operation(step);
  }

  return (performance.now() - start) / count;
}

/** Paints every layer at once; the time includes composing a screenshot (about a millisecond). */
function paint(chart: Chart): void {
  chart.screenshot();
}

/** Frames while scrolling `frames` times by `step` bars across `visible` bars. */
function scrollFrames(chart: Chart, visible: number, frames: number, step: number): number {
  const last = chart.data.length - 1;
  return average(frames, (frame) => {
    const to = last - frame * step;
    chart.timeScale.setVisibleLogicalRange({ from: to - visible, to });
    paint(chart);
  });
}

export function run(barCount: number): BenchResult[] {
  const results: BenchResult[] = [];
  const record = (group: string, name: string, value: number, unit: BenchResult['unit'] = 'ms') => {
    results.push({ group, name, value: Math.round(value * 1000) / 1000, unit });
  };
  const container = document.getElementById('chart');

  if (!container) {
    throw new Error('No container.');
  }

  const bars = minuteBars(barCount);
  const chart = createChart(container, { modules: allModules(), calendar: { timeZone: 'UTC' } });

  // ─── Data ──────────────────────────────────────────────────────────────────
  record(
    'data',
    `set ${barCount} one-minute bars`,
    timed(() => {
      chart.data.set(bars, { interval: '1m' });
    })
  );
  record(
    'data',
    'first paint',
    timed(() => {
      paint(chart);
    })
  );

  for (const timeframe of ['5m', '15m', '1h', '4h', '1D'] as const) {
    record(
      'data',
      `timeframe ${timeframe}`,
      timed(() => {
        chart.data.setTimeframe(timeframe);
        paint(chart);
      })
    );
  }

  chart.data.setTimeframe(null);

  // ─── Frames ────────────────────────────────────────────────────────────────
  record('frames', 'scroll, 150 bars visible', scrollFrames(chart, 150, 60, 3));
  record('frames', 'scroll, 2500 bars visible', scrollFrames(chart, 2500, 60, 40));

  // ─── Indicators ────────────────────────────────────────────────────────────
  const types = ['MA', 'EMA', 'BOLL', 'MACD', 'RSI', 'KDJ', 'ATR'];

  for (const type of [...types, 'VOL']) {
    const id = chart.indicators.add(
      type === 'VOL' ? { type, pane: 'main', scale: 'volume' } : { type }
    );
    record('per indicator', `${type}, 2500 bars visible`, scrollFrames(chart, 2500, 20, 40));
    chart.indicators.remove(id);
  }

  record(
    'indicators',
    `add ${types.length} indicators over every bar`,
    timed(() => {
      for (const type of types) {
        const id = chart.indicators.add({ type });
        chart.indicators.valuesAt(id);
      }

      chart.indicators.add({ id: 'vol', type: 'VOL', pane: 'main', scale: 'volume' });
      paint(chart);
    })
  );
  record('frames', 'scroll with 8 indicators', scrollFrames(chart, 150, 60, 3));
  record('frames', 'scroll with 8 indicators, 2500 bars', scrollFrames(chart, 2500, 60, 40));

  // ─── Streaming ─────────────────────────────────────────────────────────────
  for (let index = 0; index < 20; index += 1) {
    chart.alerts.add({
      id: `alert-${index}`,
      trigger: 'cross',
      value: (bars.at(-1)?.close ?? 0) + (index - 10) * 5,
      frequency: 'every-time'
    });
  }

  const lastTime = T0 + (barCount - 1) * MINUTE;
  let price = bars.at(-1)?.close ?? 40_000;
  const trades = 20_000;
  const perTrade = average(trades, (step) => {
    price += Math.sin(step / 7) * 3;
    chart.data.addTrades({ time: lastTime + MINUTE + step * 300, price, size: 0.5 });
  });
  record('streaming', 'one trade (8 indicators, 20 alerts)', perTrade * 1000, 'µs');
  record('streaming', 'trades per second', 1000 / perTrade, '/s');

  // ─── Transforms ────────────────────────────────────────────────────────────
  for (const type of ['heikin-ashi', 'renko', 'range'] as const) {
    record(
      'transforms',
      `${type} over every bar`,
      timed(() => {
        chart.transforms.set({ type });
        paint(chart);
      })
    );
  }

  chart.transforms.set({ type: 'renko' });
  const brickTrade = average(5000, (step) => {
    price += Math.sin(step / 5) * 20;
    chart.data.addTrades({ time: lastTime + MINUTE * 200 + step * 300, price, size: 0.5 });
  });
  record('transforms', 'one trade into renko', brickTrade * 1000, 'µs');
  chart.transforms.set(null);

  // ─── Replay ────────────────────────────────────────────────────────────────
  chart.replay.start(T0 + Math.floor(barCount / 2) * MINUTE, { step: 'source' });
  record('replay', 'one source step', average(2000, () => chart.replay.step()) * 1000, 'µs');
  chart.data.setTimeframe('1h');
  chart.replay.configure({ step: 'bar' });
  record('replay', 'one hourly step', average(500, () => chart.replay.step()) * 1000, 'µs');
  chart.replay.stop();

  // ─── Plugins ───────────────────────────────────────────────────────────────
  // Hourly bars, one-minute source: the plugin reads the 60 source bars of every visible hour.
  chart.plugins.add(sourceRangePlugin);
  record('plugins', 'source ranges, 150 hours scrolled', scrollFrames(chart, 150, 30, 3));
  chart.plugins.remove(sourceRangePlugin.name);
  chart.data.setTimeframe(null);

  // ─── Drawings ──────────────────────────────────────────────────────────────
  const end = barCount - 1;
  record(
    'drawings',
    'add 300 drawings',
    timed(() => {
      for (let index = 0; index < 300; index += 1) {
        const at = end - 150 + (index % 140);
        const type = index % 3 === 0 ? 'rectangle' : 'trend-line';
        chart.drawings.add({
          type,
          points: [
            { time: T0 + at * MINUTE, price: (bars[at]?.low ?? 0) - 10 },
            { time: T0 + (at + 8) * MINUTE, price: (bars[at + 8]?.high ?? 0) + 10 }
          ]
        });
      }
    })
  );
  record('frames', 'scroll with 300 drawings', scrollFrames(chart, 150, 60, 1));

  chart.destroy();
  return results;
}

Object.assign(window, { bench: { run } });

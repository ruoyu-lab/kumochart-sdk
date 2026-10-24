import { describe, expect, it } from 'vitest';
import type { BarsChangeEvent } from '../../src/chart/events';
import { createBars, MINUTE, T0 } from '../helpers/bars';
import { createTestChart } from '../helpers/chart';

function recordedChart() {
  const chart = createTestChart();
  const events: BarsChangeEvent[] = [];
  chart.on('barsChange', (event) => events.push(event));
  return { chart, events };
}

describe('barsChange', () => {
  it('tells which bars changed when data is set, streamed and prepended', () => {
    const { chart, events } = recordedChart();
    chart.data.set(createBars(10, T0 + 10 * MINUTE));
    expect(events).toEqual([{ change: { kind: 'reset' } }]);

    const last = createBars(20, T0)[19];

    if (!last) {
      throw new Error('missing bar');
    }

    chart.data.update({ ...last, close: last.close + 1 });
    expect(events.at(-1)).toEqual({ change: { kind: 'tail', from: 9 } });

    chart.data.update({ ...last, time: T0 + 20 * MINUTE });
    expect(events.at(-1)).toEqual({ change: { kind: 'tail', from: 10 } });

    chart.data.prepend(createBars(10, T0));
    expect(events.at(-1)).toEqual({ change: { kind: 'reset' } });
    expect(events).toHaveLength(4);
  });

  it('follows timeframe changes and replay', () => {
    const { chart, events } = recordedChart();
    chart.data.set(createBars(60), { interval: '1m' });
    chart.data.setTimeframe('5m');
    expect(events.at(-1)).toEqual({ change: { kind: 'reset' } });

    chart.replay.start(T0 + 30 * MINUTE);
    const count = events.length;
    chart.replay.step();
    expect(events.length).toBeGreaterThan(count);
    expect(events.at(-1)?.change.kind).toBe('tail');
  });

  it('stays quiet when nothing changed', () => {
    const { chart, events } = recordedChart();
    chart.data.set(createBars(10));
    chart.data.update([]);
    expect(events).toHaveLength(1);
  });
});

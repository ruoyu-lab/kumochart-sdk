import { describe, expect, it } from 'vitest';
import type { Chart } from '../helpers/chart';
import { BarStore } from '../../src/data/bar-store';
import { longPosition, positionOutcome, shortPosition } from '../../src/drawings/tools/position';
import type { Anchors } from '../../src/drawings/types';
import { MINUTE, T0, PLAIN_SPACE, PLAIN_STYLE } from '../helpers/bars';
import { chartWithBars, click, createTestChart, drag, pointer } from '../helpers/chart';
import { canvasCalls } from '../setup';

function at(chart: Chart, index: number, price: number): [number, number] {
  const x = chart.timeScale.timeToX(T0 + index * MINUTE);
  const y = chart.priceScale().priceToY(price);

  if (x === null || y === null) {
    throw new Error('Point is outside the chart.');
  }

  return [x, y];
}

/** Bars from `[low, high]` pairs, one minute apart from T0. */
function store(ranges: readonly (readonly [number, number])[]): BarStore {
  const bars = new BarStore();
  bars.set(
    ranges.map(([low, high], index) => ({
      time: T0 + index * MINUTE,
      open: (low + high) / 2,
      high,
      low,
      close: (low + high) / 2
    }))
  );
  return bars;
}

const point = (index: number, price: number) => ({ time: T0 + index * MINUTE, price });

const LEVELS = { start: T0, end: T0 + 10 * MINUTE, entry: 100, target: 110, stop: 95 };

describe('position tools', () => {
  it('places a position with two clicks, mirroring the stop', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('long-position');
    click(chart, ...at(chart, 150, 170));
    // The preview shows the whole position as soon as the pointer moves.
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const calls = objects ? canvasCalls(objects) : [];
    calls.length = 0;
    pointer(chart, 'pointermove', ...at(chart, 170, 180));
    chart.screenshot();
    expect(calls.filter((call) => call.name === 'fill').length).toBeGreaterThanOrEqual(2);

    // A click below the entry of a long position still sets the distance to the target.
    click(chart, ...at(chart, 170, 160));
    const [entry, target, stop] = chart.drawings.list()[0]?.points ?? [];

    expect(entry?.time).toBe(T0 + 150 * MINUTE);
    expect(target?.time).toBe(T0 + 170 * MINUTE);
    expect(stop?.time).toBe(target?.time);
    expect((target?.price ?? 0) - (entry?.price ?? 0)).toBeCloseTo(10, 0);
    expect((entry?.price ?? 0) - (stop?.price ?? 0)).toBeCloseTo(10, 0);
  });

  it('spans the bars between the clicks, placed from right to left too', () => {
    const chart = chartWithBars(200);
    chart.drawings.startTool('short-position');
    click(chart, ...at(chart, 170, 170));
    click(chart, ...at(chart, 150, 160));
    const [entry, target, stop] = chart.drawings.list()[0]?.points ?? [];

    expect([entry?.time, target?.time, stop?.time]).toEqual([
      T0 + 150 * MINUTE,
      T0 + 170 * MINUTE,
      T0 + 170 * MINUTE
    ]);
    // The entry is where the first click was.
    expect(entry?.price).toBeCloseTo(170, 0);
    expect(target?.price).toBeCloseTo(160, 0);
  });

  it('keeps every level on its side of the entry', () => {
    const long = longPosition;
    const short = shortPosition;
    const anchors: Anchors<3> = [
      { time: T0, price: 100 },
      { time: T0 + 5 * MINUTE, price: 104 },
      { time: T0 + 5 * MINUTE, price: 96 }
    ];

    expect(
      long.complete?.([
        { time: T0, price: 100 },
        { time: T0 + 5 * MINUTE, price: 104 }
      ])
    ).toEqual(anchors);
    expect(
      short
        .complete?.([
          { time: T0, price: 100 },
          { time: T0 + 5 * MINUTE, price: 104 }
        ])
        .map((anchor) => anchor.price)
    ).toEqual([100, 96, 104]);

    const moved = long.moveHandle?.(
      anchors,
      'target',
      { time: T0, price: 90 },
      PLAIN_SPACE,
      PLAIN_STYLE
    );
    expect(moved?.map((anchor) => anchor.price)).toEqual([100, 100, 96]);
    const shortened = long.moveHandle?.(
      anchors,
      'end',
      { time: T0 - MINUTE, price: 1 },
      PLAIN_SPACE,
      PLAIN_STYLE
    );
    expect(shortened?.[1]?.time).toBe(T0);
    // The entry line moves only the entry, between the stop and the target.
    const entry = long.moveHandle?.(
      anchors,
      'entry',
      { time: T0 + MINUTE, price: 101 },
      PLAIN_SPACE,
      PLAIN_STYLE
    );
    expect(entry?.map((anchor) => anchor.price)).toEqual([101, 104, 96]);
    expect(entry?.[0]?.time).toBe(T0);
    const capped = long.moveHandle?.(
      anchors,
      'entry',
      { time: T0, price: 120 },
      PLAIN_SPACE,
      PLAIN_STYLE
    );
    expect(capped?.map((anchor) => anchor.price)).toEqual([104, 104, 96]);
    // The left side moves the start only.
    const start = long.moveHandle?.(
      anchors,
      'start',
      { time: T0 + MINUTE, price: 1 },
      PLAIN_SPACE,
      PLAIN_STYLE
    );
    expect(start?.[0]).toEqual({ time: T0 + MINUTE, price: 100 });
  });

  it('drags the entry line and the edges up and down, the sides left and right', () => {
    const chart = chartWithBars(200);
    const id = chart.drawings.add({
      type: 'long-position',
      points: [point(140, 170), point(180, 180), point(180, 160)]
    });
    // A selected drawing shows its handles, as a hovered one does.
    chart.select({ kind: 'drawing', id });
    const dragBy = (from: [number, number], to: [number, number]) => {
      drag(chart, from, to);
    };
    const prices = () => chart.drawings.get(id)?.points.map((anchor) => anchor.price);
    const [left] = at(chart, 140, 170);
    const [right] = at(chart, 180, 170);
    const quarter = left + (right - left) / 4;

    // The entry line, grabbed away from its markers.
    dragBy([quarter, at(chart, 150, 170)[1]], [quarter, at(chart, 150, 172)[1]]);
    expect(prices()?.[0]).toBeCloseTo(172, 0);
    expect(prices()?.slice(1)).toEqual([180, 160]);

    // The target edge, anywhere along it.
    dragBy([quarter, at(chart, 150, 180)[1]], [quarter, at(chart, 150, 185)[1]]);
    expect(prices()?.[1]).toBeCloseTo(185, 0);

    // The right side stretches the position.
    const entryY = at(chart, 150, prices()?.[0] ?? 0)[1];
    dragBy([right, entryY], [at(chart, 190, 170)[0], entryY]);
    expect(chart.drawings.get(id)?.points[1]?.time).toBe(T0 + 190 * MINUTE);
    expect(chart.drawings.get(id)?.points[0]?.time).toBe(T0 + 140 * MINUTE);
  });

  it('closes at the target or the stop, whichever comes first', () => {
    // The entry bar itself is not evaluated.
    expect(
      positionOutcome(
        store([
          [80, 120],
          [99, 111]
        ]),
        LEVELS,
        true
      )
    ).toEqual({
      kind: 'target',
      entered: T0,
      time: T0 + MINUTE,
      price: 110
    });
    expect(
      positionOutcome(
        store([
          [99, 101],
          [94, 101],
          [99, 111]
        ]),
        LEVELS,
        true
      ).kind
    ).toBe('stop');
    // A bar reaching both counts as stopped out.
    expect(
      positionOutcome(
        store([
          [99, 101],
          [94, 111]
        ]),
        LEVELS,
        true
      ).kind
    ).toBe('stop');
    expect(
      positionOutcome(
        store([
          [99, 101],
          [98, 103]
        ]),
        LEVELS,
        true
      )
    ).toEqual({
      kind: 'open',
      entered: T0,
      time: T0 + MINUTE,
      price: 100.5
    });
    // Bars after the end are ignored.
    const late = store(
      Array.from({ length: 12 }, (_, index) => (index < 11 ? [99, 101] : [80, 120]))
    );
    expect(positionOutcome(late, LEVELS, true).kind).toBe('open');
    // A short wins below the entry.
    const short = { ...LEVELS, target: 90, stop: 105 };
    expect(
      positionOutcome(
        store([
          [99, 101],
          [89, 101]
        ]),
        short,
        false
      ).kind
    ).toBe('target');
  });

  it('opens where a bar reaches the entry, and closes after it', () => {
    // Above the entry of a long, it waits.
    expect(
      positionOutcome(
        store([
          [103, 106],
          [102, 105]
        ]),
        LEVELS,
        true
      )
    ).toEqual({ kind: 'pending', entered: null, time: T0, price: 100 });
    expect(
      positionOutcome(
        store([
          [103, 106],
          [102, 105],
          [99, 104],
          [98, 111]
        ]),
        LEVELS,
        true
      )
    ).toEqual({ kind: 'target', entered: T0 + 2 * MINUTE, time: T0 + 3 * MINUTE, price: 110 });
    // The bar reaching the entry does not close it, even reaching the stop: which came first is
    // not known.
    expect(
      positionOutcome(
        store([
          [103, 106],
          [94, 104],
          [99, 101]
        ]),
        LEVELS,
        true
      )
    ).toEqual({ kind: 'open', entered: T0 + MINUTE, time: T0 + 2 * MINUTE, price: 100 });
    // A short below its entry waits for price to come up to it.
    const short = { ...LEVELS, target: 90, stop: 105 };
    expect(
      positionOutcome(
        store([
          [95, 98],
          [96, 101],
          [89, 99]
        ]),
        short,
        false
      )
    ).toEqual({ kind: 'target', entered: T0 + MINUTE, time: T0 + 2 * MINUTE, price: 90 });
  });

  it('paints its zones under the bars', () => {
    const chart = chartWithBars(200);
    const scene = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
    const fills = () => {
      const calls = scene ? canvasCalls(scene) : [];
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter((call) => call.name === 'fill').length;
    };
    const without = fills();
    chart.drawings.add({
      type: 'short-position',
      points: [point(150, 170), point(190, 160), point(190, 175)]
    });

    // The reward, the risk and the band where the position was open.
    expect(fills() - without).toBeGreaterThanOrEqual(2);
  });

  it('paints its words in the chart locale, with overrides', () => {
    const chart = chartWithBars(200, { locale: 'zh-CN' });
    const id = chart.drawings.add({
      type: 'long-position',
      points: [
        { time: T0 + 150 * MINUTE, price: 170 },
        { time: T0 + 190 * MINUTE, price: 180 },
        { time: T0 + 190 * MINUTE, price: 165 }
      ]
    });
    chart.select({ kind: 'drawing', id });
    const texts = () => {
      const objects = chart.element.querySelector<HTMLCanvasElement>(
        'canvas[data-layer="objects"]'
      );
      const calls = objects ? canvasCalls(objects) : [];
      calls.length = 0;
      chart.applyOptions({});
      chart.screenshot();
      return calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    };

    expect(texts().some((text) => text.startsWith('止盈 '))).toBe(true);
    expect(texts().some((text) => text.startsWith('盈亏比 2.00'))).toBe(true);

    chart.applyOptions({ drawings: { texts: { target: 'TP', riskReward: 'RR' } } });
    expect(texts().some((text) => text.startsWith('TP '))).toBe(true);
    expect(texts().some((text) => text.startsWith('止损 '))).toBe(true);

    chart.applyOptions({ locale: 'en-US' });
    expect(texts().some((text) => text.startsWith('Stop '))).toBe(true);
    expect(texts().some((text) => text.startsWith('RR 2.00'))).toBe(true);

    expect(() => {
      chart.applyOptions({ drawings: { texts: { bars: 'bars' as never } } });
    }).toThrow('options.drawings.texts.bars must be a function');
    expect(() => {
      chart.applyOptions({ drawings: { texts: { stop: 1 as never } } });
    }).toThrow('options.drawings.texts.stop must be a string');
    expect(() => {
      chart.applyOptions({ drawings: { texts: { unknown: 'x' } as never } });
    }).toThrow('options.drawings.texts has no entry "unknown"');
    // The words of drawings are the drawings module's, not the core's.
    expect(() => {
      chart.applyOptions({ texts: { target: 'TP' } as never });
    }).toThrow('options.texts has no entry "target"');
  });

  it('shows the gain and the loss of a short as such', () => {
    const chart = createTestChart({ locale: 'en-US' });
    // Flat at 100 until bar 150, then down 1 a bar.
    chart.data.set(
      Array.from({ length: 200 }, (_, index) => {
        const close = index <= 150 ? 100 : 250 - index;
        return {
          time: T0 + index * MINUTE,
          open: close,
          high: close + 0.5,
          low: close - 0.5,
          close
        };
      })
    );
    const id = chart.drawings.add({
      type: 'short-position',
      points: [point(150, 100), point(190, 95), point(190, 104)]
    });
    chart.select({ kind: 'drawing', id });
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const calls = objects ? canvasCalls(objects) : [];
    calls.length = 0;
    chart.applyOptions({});
    chart.screenshot();
    const texts = calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);

    expect(texts).toContain('R:R 1.25 · Target hit +5.00%');
    expect(texts).toContain('Target 95.00 (+5.00%)');
    expect(texts).toContain('Stop 104.00 (-4.00%)');
  });

  it('closes on the bars it was built from, not on bars built from them', () => {
    const chart = createTestChart({ locale: 'en-US' });
    // Minutes at 100; at minute 5 price reaches 110, at minute 6 it falls to 95.
    const minute = (index: number) => {
      const high = index === 5 ? 110.5 : 100.5;
      const low = index === 6 ? 94.5 : 99.5;
      return { time: T0 + index * MINUTE, open: 100, high, low, close: 100 };
    };
    chart.data.set(
      Array.from({ length: 30 }, (_, index) => minute(index)),
      { interval: '1m' }
    );
    // Shown in 5-minute bars, the second of which reaches both the target and the stop.
    chart.data.setTimeframe('5m');
    const id = chart.drawings.add({
      type: 'long-position',
      points: [point(0, 100), point(25, 110), point(25, 95)]
    });
    chart.select({ kind: 'drawing', id });
    const objects = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const calls = objects ? canvasCalls(objects) : [];
    calls.length = 0;
    chart.applyOptions({});
    chart.screenshot();
    const texts = calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);

    expect(texts).toContain('R:R 2.00 · Target hit +10.00%');
  });

  it('checks the anchors of positions and of custom types that place fewer', () => {
    const chart = chartWithBars(50);

    expect(() => {
      chart.drawings.add({
        type: 'long-position',
        points: [
          { time: T0, price: 100 },
          { time: T0 + MINUTE, price: 110 }
        ]
      });
    }).toThrow('needs 3 points');
    expect(() => {
      chart.drawings.register({
        type: 'bad',
        points: 3,
        place: 2,
        paint: () => undefined,
        hitTest: () => null
      });
    }).toThrow('needs a fixed number of points and complete()');
    expect(() => {
      chart.drawings.register({
        type: 'worse',
        points: 2,
        place: 2,
        complete: (placed) => [...placed],
        paint: () => undefined,
        hitTest: () => null
      });
    }).toThrow('definition.place');
  });
});

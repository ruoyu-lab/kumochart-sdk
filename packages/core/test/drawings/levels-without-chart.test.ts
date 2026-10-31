import { describe, expect, it } from 'vitest';
import type { AlertTriggerEvent } from '../../src/alerts/types';
import type { Bar, BarsView } from '../../src/data/types';
import type { DrawingStyle } from '../../src/drawings/types';
import { allDrawings } from '../../src/drawings/all';
import {
  computeDrawingLevels,
  drawingLevels,
  drawingLevelValue,
  type DrawingLevelsInput
} from '../../src/drawings/headless';
import type { DrawingTypeDefinition } from '../../src/drawings/types';
import { ChartError } from '../../src/utils/errors';
import { createTestChart } from '../helpers/chart';
import { btcusdtHours } from '../helpers/market';

const BARS = btcusdtHours() as Bar[];

/** A drawing type of the library. */
function definitionOf(type: string): DrawingTypeDefinition {
  const definition = allDrawings.find((candidate) => candidate.type === type);

  if (!definition) {
    throw new Error(`Unknown drawing type ${type}.`);
  }

  return definition;
}

/** A drawing of a type: what the functions without a chart take, with its type. */
type TypedDrawing = DrawingLevelsInput & { readonly type: string };
/** Bars loaded before the alerts watch; the rest arrive one by one. */
const LOADED = 20;
const HOUR = 3_600_000;
/** The time of bar `index`, and of bars to come past the last. */
const time = (index: number) =>
  index < BARS.length
    ? (BARS[index]?.time ?? Number.NaN)
    : (BARS.at(-1)?.time ?? 0) + (index - BARS.length + 1) * HOUR;
const point = ([bar, price]: readonly [number, number]) => ({ time: time(bar), price });
const lowOf = (index: number) => BARS[index]?.low ?? Number.NaN;
const highOf = (index: number) => BARS[index]?.high ?? Number.NaN;
const low = lowOf(2);
const high = highOf(18);

/**
 * A drawing of each type with lines, on the bars: anchors on bars and between them, some past
 * the last bar, styles that extend them or show more levels.
 */
/** A drawing by its type, its anchors as bar and price, and its style. */
type Sketch = readonly [string, ReadonlyArray<readonly [number, number]>, Partial<DrawingStyle>?];

const SKETCHES: readonly Sketch[] = [
  [
    'trend-line',
    [
      [30, 84_000],
      [150, 86_000]
    ]
  ],
  [
    'trend-line',
    [
      [30, 84_000],
      [150, 86_000]
    ],
    { extendLeft: true }
  ],
  [
    'ray',
    [
      [30, 84_000],
      [120, 85_500]
    ]
  ],
  [
    'extended-line',
    [
      [60, 85_000],
      [250, 83_000]
    ]
  ],
  [
    'arrow',
    [
      [10, 82_000],
      [100, 86_000]
    ]
  ],
  ['horizontal-line', [[100, 85_000]]],
  ['horizontal-ray', [[100, 84_500]]],
  [
    'rectangle',
    [
      [60, 83_800],
      [200, 84_600]
    ],
    { extendRight: true }
  ],
  [
    'price-range',
    [
      [40, 83_000],
      [140, 86_000]
    ]
  ],
  [
    'date-price-range',
    [
      [180, 85_000],
      [50, 84_000]
    ]
  ],
  [
    'parallel-channel',
    [
      [20, 86_400],
      [220, 83_000],
      [20, 85_100]
    ]
  ],
  [
    'fib-retracement',
    [
      [2, low],
      [18, high]
    ],
    { extendRight: true }
  ],
  [
    'fib-retracement',
    [
      [60, highOf(60)],
      [80, lowOf(80)]
    ],
    {
      levels: [{ value: 0.382 }, { value: 0.65 }, { value: 1.272 }, { value: 0.5, visible: false }]
    }
  ],
  [
    'fib-extension',
    [
      [2, low],
      [18, high],
      [40, 85_000]
    ],
    { extendLeft: true }
  ],
  [
    'fib-channel',
    [
      [20, 86_400],
      [120, 84_000],
      [20, 85_400]
    ],
    { extendRight: true }
  ],
  [
    'fib-speed-fan',
    [
      [10, 81_000],
      [60, 87_000]
    ]
  ],
  [
    'gann-box',
    [
      [30, 82_000],
      [130, 87_000]
    ]
  ],
  [
    'gann-fan',
    [
      [10, 82_000],
      [60, 84_000]
    ],
    { levels: [{ value: 2 }, { value: 1 }, { value: 1 / 3 }, { value: 0.25, visible: false }] }
  ],
  [
    'info-line',
    [
      [30, 84_000],
      [150, 86_000]
    ],
    { extendRight: true }
  ],
  ['cross-line', [[100, 85_000]]],
  [
    'trend-angle',
    [
      [30, 84_000],
      [80, 85_000]
    ],
    { extendRight: true }
  ],
  [
    'head-and-shoulders',
    [
      [5, 81_400],
      [20, 86_900],
      [30, 85_300],
      [45, 87_400],
      [70, 85_200],
      [90, 86_200],
      [110, 84_000]
    ]
  ],
  [
    'regression-trend',
    [
      [20, 0],
      [200, 0]
    ]
  ],
  // Its second anchor is still ahead: the fit takes in each bar as it comes.
  [
    'regression-trend',
    [
      [150, 0],
      [260, 0]
    ],
    { extendRight: true, source: 'hl2' }
  ],
  ['anchored-vwap', [[30, 0]], { levels: [{ value: 1 }, { value: 2 }] }]
];

const DRAWINGS: readonly TypedDrawing[] = SKETCHES.map(([type, anchors, style]) => ({
  type,
  points: anchors.map(point),
  ...(style ? { style } : {})
}));

/** What a failure names a drawing by: its type and its style. */
function nameOf(drawing: TypedDrawing): string {
  return `${drawing.type}${drawing.style ? ` ${JSON.stringify(drawing.style)}` : ''}`;
}

/** The bars so far, as code without a chart keeps them: they grow, each change a revision. */
class Growing implements BarsView {
  length = 0;
  revision = 0;

  grow(): void {
    this.length += 1;
    this.revision += 1;
  }

  time = (index: number) => BARS[index]?.time ?? Number.NaN;
  open = (index: number) => BARS[index]?.open ?? Number.NaN;
  high = (index: number) => BARS[index]?.high ?? Number.NaN;
  low = (index: number) => BARS[index]?.low ?? Number.NaN;
  close = (index: number) => BARS[index]?.close ?? Number.NaN;
  volume = (index: number) => BARS[index]?.volume ?? Number.NaN;
  bar = (index: number) => (index < this.length ? (BARS[index] ?? null) : null);

  lowerBound(target: number): number {
    const at = BARS.slice(0, this.length).findIndex((bar) => bar.time >= target);
    return at < 0 ? this.length : at;
  }
}

/**
 * The value of each line at each bar as a chart's alerts read it while the bars come one by
 * one: an alert that the line is above any price fires on every bar the line reaches, with its
 * value there. `NaN` where it does not reach.
 */
function chartValues(drawing: TypedDrawing, scale: 'linear' | 'log'): Record<string, number[]> {
  const chart = createTestChart();
  chart.priceScale().setMode(scale === 'log' ? 'log' : 'normal');
  chart.data.set(BARS.slice(0, LOADED));
  const id = chart.drawings.add({ ...drawing, id: 'drawing' });
  const keys = chart.drawings.levels(id);
  const fired: AlertTriggerEvent[] = [];
  chart.on('alertTrigger', (event) => fired.push(event));
  chart.alerts.set(
    keys.map((key) => ({
      id: key,
      source: { kind: 'drawing', id, level: key },
      trigger: 'above',
      value: -1e12,
      frequency: 'every-time'
    }))
  );
  const values = Object.fromEntries(keys.map((key) => [key, [] as number[]]));

  for (let index = LOADED; index < BARS.length; index += 1) {
    chart.data.update(BARS[index] as Bar);

    for (const key of keys) {
      const event = fired.find((each) => each.id === key && each.time === time(index));
      values[key]?.push(event?.value ?? Number.NaN);
    }
  }

  chart.destroy();
  return values;
}

/** The same without a chart, on bars that grow as code without a chart keeps them. */
function streamedValues(drawing: TypedDrawing, scale: 'linear' | 'log'): Record<string, number[]> {
  const bars = new Growing();
  const values: Record<string, number[]> = {};

  for (let index = 0; index < BARS.length; index += 1) {
    bars.grow();

    for (const level of drawingLevels(definitionOf(drawing.type), drawing, bars, { scale })) {
      if (index >= LOADED) {
        (values[level.key] ??= []).push(drawingLevelValue(level, time(index), bars, { scale }));
      }
    }
  }

  return values;
}

/** The same over the bars up to each, as `computeDrawingLevels()` gives the values of a chart of them. */
function computedValues(drawing: TypedDrawing, scale: 'linear' | 'log'): Record<string, number[]> {
  const values: Record<string, number[]> = {};

  for (let index = LOADED; index < BARS.length; index += 1) {
    const lines = computeDrawingLevels(
      definitionOf(drawing.type),
      drawing,
      BARS.slice(0, index + 1),
      {
        scale
      }
    );

    for (const [key, column] of Object.entries(lines)) {
      (values[key] ??= []).push(column[index] ?? Number.NaN);
    }
  }

  return values;
}

describe('lines of drawings without a chart', () => {
  it('covers every type that has lines', () => {
    const covered = new Set(DRAWINGS.map((drawing) => drawing.type));
    const anchors = Array.from({ length: 7 }, (_, index) => point([index * 10, 85_000]));
    // With as many anchors as the type takes: one to seven.
    const hasLines = (type: string) =>
      [1, 2, 3, 5, 7].some((count) => {
        try {
          return drawingLevels(definitionOf(type), { points: anchors.slice(0, count) }).length > 0;
        } catch {
          return false;
        }
      });

    expect(
      allDrawings
        .map((definition) => definition.type)
        .filter(hasLines)
        .sort()
    ).toEqual([...covered].sort());
    expect(covered.size).toBe(22);
  });

  // Every drawing type bar by bar takes a few seconds, longer with coverage.
  for (const scale of ['linear', 'log'] as const) {
    it(`gives each line at each bar as a chart's alerts read it, bar by bar (${scale})`, () => {
      for (const drawing of DRAWINGS) {
        const expected = chartValues(drawing, scale);
        const keys = Object.keys(expected);
        const reached = Object.values(expected).flat().filter(Number.isFinite);

        expect(keys.length, nameOf(drawing)).toBeGreaterThan(0);
        expect(reached.length, nameOf(drawing)).toBeGreaterThan(20);
        expect(streamedValues(drawing, scale), nameOf(drawing)).toEqual(expected);
        expect(computedValues(drawing, scale), nameOf(drawing)).toEqual(expected);
      }
    }, 20_000);
  }

  it('names the lines without bars as with them', () => {
    for (const drawing of DRAWINGS) {
      const chart = createTestChart();
      chart.data.set(BARS);
      const id = chart.drawings.add(drawing);

      expect(
        drawingLevels(definitionOf(drawing.type), drawing).map((level) => level.key),
        nameOf(drawing)
      ).toEqual(chart.drawings.levels(id));
      chart.destroy();
    }
  });

  it('names the lines of a fan whose anchors share a time without bars as with them', () => {
    const fan = { type: 'fib-speed-fan', points: [point([40, 84_000]), point([40, 86_000])] };
    const chart = createTestChart();
    chart.data.set(BARS);
    const id = chart.drawings.add(fan);

    expect(drawingLevels(definitionOf(fan.type), fan).map((level) => level.key)).toEqual(
      chart.drawings.levels(id)
    );
  });

  it('watches the parallel of a channel through its third anchor, wherever it lies', () => {
    // The base rises from 84,000 at bar 20 to 86,000 at bar 120, so it is at 85,000 at bar 70,
    // where the third anchor is, 600 above it.
    const channel = {
      type: 'parallel-channel',
      points: [point([20, 84_000]), point([120, 86_000]), point([70, 85_600])]
    };
    const lines = computeDrawingLevels(definitionOf(channel.type), channel, BARS);

    expect(lines['base']?.[70]).toBeCloseTo(85_000, 6);
    expect(lines['parallel']?.[70]).toBeCloseTo(85_600, 6);
    expect(lines['parallel']?.[20]).toBeCloseTo(84_600, 6);
    expect(lines['middle']?.[120]).toBeCloseTo(86_300, 6);
  });

  it('has the lines of a regression trend before two bars lie between its anchors', () => {
    const ahead = { type: 'regression-trend', points: [point([300, 0]), point([320, 0])] };
    const chart = createTestChart();
    chart.data.set(BARS);
    const id = chart.drawings.add(ahead);

    expect(chart.drawings.levels(id)).toEqual(['2', '-2', '0']);
    expect(
      computeDrawingLevels(definitionOf(ahead.type), ahead, BARS)['2']?.every(Number.isNaN)
    ).toBe(true);
  });

  it('checks the drawing as the chart does', () => {
    const rays = [point([1, 1]), point([2, 2])];

    expect(() => drawingLevels({ type: 'scribble' } as never, { points: [] })).toThrow(
      'definition.points must be a finite number'
    );
    expect(() => drawingLevels(definitionOf('rectangle'), { points: [point([1, 1])] })).toThrow(
      'A "rectangle" drawing needs 2 points, received 1.'
    );
    expect(() =>
      drawingLevels(definitionOf('ray'), { points: rays, style: { extendLeft: 1 as never } })
    ).toThrow('style.extendLeft must be a boolean');
    expect(() =>
      drawingLevels(definitionOf('ray'), { points: rays }, undefined, { scale: 'percent' as never })
    ).toThrow(ChartError);
  });
});

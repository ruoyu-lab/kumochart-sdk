import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import { DRAWING_OPTIONS, drawingTexts } from '../../src/drawings/options';
import { createDefaultOptions } from '../../src/options/defaults';
import { allDrawings } from '../../src/drawings/all';
import { Registry } from '../../src/utils/registry';
import { distanceToSegment, type Segment } from '../../src/drawings/geometry';
import type {
  DrawingGeometry,
  DrawingPoint,
  DrawingSpace,
  DrawingStyle
} from '../../src/drawings/types';
import type { Point } from '../../src/interaction/types';
import { darkTheme } from '../../src/options/themes';
import { withAlpha } from '../../src/canvas/color';
import { PLAIN_SPACE, PLAIN_STYLE } from '../helpers/bars';

const registry = new Registry('drawing type', allDrawings);
const TOLERANCE = 4;
/** Width of every character measured by the fake context. */
const CHAR_WIDTH = 7;

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
  /** The context state when the call was made. */
  readonly state: Readonly<Record<string, unknown>>;
}

const RECORDED = [
  'beginPath',
  'moveTo',
  'lineTo',
  'closePath',
  'stroke',
  'fill',
  'fillRect',
  'strokeRect',
  'roundRect',
  'fillText',
  'save',
  'restore',
  'translate',
  'rotate'
];
const SETTABLE = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'font',
  'textAlign',
  'textBaseline'
];

/** A 2D context that records calls; using anything it does not implement throws. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { lineDash: [] };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    ...Object.fromEntries(
      RECORDED.map((method) => [
        method,
        (...args: unknown[]) => {
          calls.push({ method, args, state: { ...state } });
        }
      ])
    ),
    setLineDash: (segments) => {
      state.lineDash = segments;
    },
    measureText: (text) => ({ width: String(text).length * CHAR_WIDTH })
  };
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => {
        if (typeof key === 'string' && key in methods) {
          return methods[key];
        }

        if (typeof key === 'string' && key in state) {
          return state[key];
        }

        throw new Error(`The fake context does not implement ${String(key)}.`);
      },
      set: (_, key, value) => {
        if (typeof key !== 'string' || !SETTABLE.includes(key)) {
          throw new Error(`The fake context does not implement setting ${String(key)}.`);
        }

        state[key] = value;
        return true;
      }
    }
  );
  // The proxy stands in for the part of the 2D context that drawings use.
  return { ctx: ctx as CanvasRenderingContext2D, calls };
}

/** Geometry with anchors given as `[x, price]`; values map to y unchanged. */
function geometryOf(
  type: string,
  anchors: readonly (readonly [number, number])[],
  text = '',
  style: Partial<DrawingStyle> = {}
): DrawingGeometry {
  return {
    points: anchors.map(([x, price]) => ({ x, y: price })),
    anchors: anchors.map(([x, price]) => ({ time: x, price })),
    width: 400,
    height: 300,
    style: {
      color: darkTheme.accent,
      lineWidth: 1,
      lineStyle: 'solid',
      fill: true,
      fillColor: darkTheme.grid,
      textColor: darkTheme.text,
      fontSize: 12,
      bold: false,
      italic: false,
      textAlign: 'left',
      textPosition: 'top',
      extendLeft: false,
      extendRight: false,
      startArrow: false,
      endArrow: false,
      levels: [],
      timeLevels: [],
      source: 'close',
      degree: 'intermediate',
      ...registry.require(type).defaultStyle?.(darkTheme),
      ...style
    },
    text,
    theme: darkTheme,
    fontFamily: 'sans-serif',
    textFont: 'normal 12px sans-serif',
    valueToY: (value) => value,
    yToValue: (y) => y,
    timeToX: (time) => time,
    barIndex: (time) => time / 10,
    bars: new BarStore(),
    source: new BarStore(),
    texts: drawingTexts({ ...createDefaultOptions([DRAWING_OPTIONS]), locale: 'en-US' }),
    formatValue: (value) => value.toFixed(2),
    measureText: (text) => text.length * CHAR_WIDTH
  };
}

function paint(
  type: string,
  geometry: DrawingGeometry,
  { hovered = false, selected = false, editing = false } = {}
): Call[] {
  const { ctx, calls } = recordingContext();
  registry.require(type).paint({ ctx, pixelRatio: 1, geometry, hovered, selected, editing });
  return calls;
}

function hit(type: string, geometry: DrawingGeometry, x: number, y: number) {
  return registry.require(type).hitTest(geometry, { x, y }, TOLERANCE);
}

function pointOf(args: readonly unknown[]): Point {
  return { x: Number(args[0]), y: Number(args[1]) };
}

interface PaintedPath {
  readonly segments: readonly Segment[];
  readonly state: Readonly<Record<string, unknown>>;
}

/** The paths stroked (or filled) by `calls`, as straight segments. */
function pathsOf(calls: readonly Call[], paintMethod: 'stroke' | 'fill'): PaintedPath[] {
  const paths: PaintedPath[] = [];
  let segments: Segment[] = [];
  let start: Point | undefined;
  let current: Point | undefined;

  for (const { method, args, state } of calls) {
    if (method === 'beginPath') {
      segments = [];
    } else if (method === 'moveTo') {
      start = pointOf(args);
      current = start;
    } else if (method === 'lineTo' || method === 'closePath') {
      const next = method === 'lineTo' ? pointOf(args) : start;

      if (!current || !next) {
        throw new Error(`${method} without a current point.`);
      }

      segments.push([current, next]);
      current = next;
    } else if (method === paintMethod) {
      paths.push({ segments, state });
    }
  }

  return paths;
}

function isDashed(path: PaintedPath): boolean {
  return Array.isArray(path.state.lineDash) && path.state.lineDash.length > 0;
}

function textsOf(calls: readonly Call[]): unknown[] {
  return calls.filter(({ method }) => method === 'fillText').map(({ args }) => args[0]);
}

const segment = (x1: number, y1: number, x2: number, y2: number): Segment => [
  { x: x1, y: y1 },
  { x: x2, y: y2 }
];

describe('shape drawings', () => {
  it.each([
    ['rectangle', 2],
    ['parallel-channel', 3],
    ['fib-retracement', 2],
    ['text', 1],
    ['path', 0],
    ['price-range', 2]
  ])('registers %s with %i anchors', (type, points) => {
    expect(registry.require(type).points).toBe(points);
  });
});

describe('rectangle', () => {
  const geometry = geometryOf('rectangle', [
    [100, 100],
    [200, 50]
  ]);

  it('fills and strokes the box between opposite corners', () => {
    const calls = paint('rectangle', geometry);
    const edges = [
      segment(100, 100, 200, 100),
      segment(200, 100, 200, 50),
      segment(200, 50, 100, 50),
      segment(100, 50, 100, 100)
    ];
    const [fill] = pathsOf(calls, 'fill');
    const strokes = pathsOf(calls, 'stroke');

    expect(fill?.state.fillStyle).toBe(withAlpha(darkTheme.accent, 0.12));
    expect(fill?.segments).toEqual(edges);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.segments).toEqual(edges);
    expect(strokes[0]?.state.strokeStyle).toBe(darkTheme.accent);
    expect(strokes[0]?.state.lineWidth).toBe(1);
  });

  it('keeps its line width while hovered, where the chart shows its handles instead', () => {
    const [stroke] = pathsOf(paint('rectangle', geometry, { hovered: true }), 'stroke');
    expect(stroke?.state.lineWidth).toBe(1);
  });

  it('offers corner and edge handles with matching resize cursors', () => {
    const handles = registry.require('rectangle').handles?.(geometry) ?? [];

    expect(handles.map(({ id, x, y, cursor }) => [id, x, y, cursor])).toEqual([
      ['0', 100, 100, 'nesw-resize'],
      ['1', 200, 50, 'nesw-resize'],
      ['ab', 100, 50, 'nwse-resize'],
      ['ba', 200, 100, 'nwse-resize'],
      ['price-0', 150, 100, 'ns-resize'],
      ['price-1', 150, 50, 'ns-resize'],
      ['time-0', 100, 75, 'ew-resize'],
      ['time-1', 200, 75, 'ew-resize']
    ]);
  });

  it('moves one edge with an edge handle and two with a corner', () => {
    const definition = registry.require('rectangle');
    const move = (anchors: readonly DrawingPoint[], handle: string, to: DrawingPoint) =>
      definition.moveHandle?.(anchors, handle, to, PLAIN_SPACE, PLAIN_STYLE);
    const anchors = [
      { time: 1, price: 10 },
      { time: 2, price: 20 }
    ];
    const to = { time: 5, price: 50 };

    expect(move(anchors, 'price-1', to)).toEqual([anchors[0], { time: 2, price: 50 }]);
    expect(move(anchors, 'time-0', to)).toEqual([{ time: 5, price: 10 }, anchors[1]]);
    expect(move(anchors, 'ab', to)).toEqual([
      { time: 5, price: 10 },
      { time: 2, price: 50 }
    ]);
    expect(move(anchors, 'ba', to)).toEqual([
      { time: 1, price: 50 },
      { time: 5, price: 20 }
    ]);
  });

  it('hits the border as line and the inside as body', () => {
    expect(hit('rectangle', geometry, 150, 102)).toEqual({ part: 'line', distance: 2 });
    expect(hit('rectangle', geometry, 197, 75)).toEqual({ part: 'line', distance: 3 });
    expect(hit('rectangle', geometry, 150, 75)).toEqual({ part: 'body', distance: 0 });
    expect(hit('rectangle', geometry, 150, 110)).toBeNull();
    expect(hit('rectangle', geometry, 300, 300)).toBeNull();
  });
});

describe('parallel-channel', () => {
  const geometry = geometryOf('parallel-channel', [
    [0, 100],
    [100, 50],
    [50, 125]
  ]);

  it('draws the base line and a parallel through the third anchor', () => {
    const strokes = pathsOf(paint('parallel-channel', geometry), 'stroke');
    const solid = strokes.filter((path) => !isDashed(path));

    expect(solid).toHaveLength(1);
    expect(solid[0]?.segments).toEqual([segment(0, 100, 100, 50), segment(0, 150, 100, 100)]);

    const parallel = solid[0]?.segments[1];
    expect(parallel && distanceToSegment({ x: 50, y: 125 }, ...parallel)).toBe(0);
  });

  it('draws a dashed middle line and fills between the lines', () => {
    const calls = paint('parallel-channel', geometry);
    const dashed = pathsOf(calls, 'stroke').filter(isDashed);
    const [fill] = pathsOf(calls, 'fill');

    expect(dashed).toHaveLength(1);
    expect(dashed[0]?.segments).toEqual([segment(0, 125, 100, 75)]);
    expect(fill?.state.fillStyle).toBe(withAlpha(darkTheme.accent, 0.12));
    expect(fill?.segments.map(([start]) => start)).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 150 }
    ]);
  });

  it('shifts a vertical base line sideways', () => {
    const vertical = geometryOf('parallel-channel', [
      [50, 0],
      [50, 100],
      [80, 40]
    ]);
    const [stroke] = pathsOf(paint('parallel-channel', vertical), 'stroke');
    expect(stroke?.segments).toEqual([segment(50, 0, 50, 100), segment(80, 0, 80, 100)]);
  });

  it('offers six handles: both ends and the middle of both lines', () => {
    const handles = registry.require('parallel-channel').handles?.(geometry) ?? [];
    expect(handles.map(({ id }) => id)).toEqual(['0', '1', 'p0', 'p1', 'm0', 'm1']);
    expect(handles.filter(({ cursor }) => cursor === 'ns-resize').map(({ id }) => id)).toEqual([
      'm0',
      'm1'
    ]);
  });

  it('changes the height with a middle under the pointer on a logarithmic scale', () => {
    const definition = registry.require('parallel-channel');
    const log: DrawingSpace = {
      ...PLAIN_SPACE,
      toScale: (value) => Math.log10(value),
      fromScale: (scaled) => 10 ** scaled
    };
    const [start, end, through] =
      definition.moveHandle?.(
        [
          { time: 0, price: 100 },
          { time: 10, price: 1000 },
          { time: 0, price: 200 }
        ],
        'm1',
        { time: 5, price: 900 },
        log,
        PLAIN_STYLE
      ) ?? [];

    // The parallel line, straight on the log scale through the third anchor, meets the pointer.
    const parallelAt = (time: number) =>
      Math.log10(through?.price ?? 0) +
      (time / 10) * (Math.log10(end?.price ?? 0) - Math.log10(start?.price ?? 0));
    expect(parallelAt(5)).toBeCloseTo(Math.log10(900), 10);
  });

  it('moves and resizes with the ends at its height, and changes the height with the middles', () => {
    const definition = registry.require('parallel-channel');
    const move = (handle: string, to: DrawingPoint) =>
      definition.moveHandle?.(
        [
          { time: 0, price: 100 },
          { time: 10, price: 110 },
          { time: 5, price: 120 }
        ],
        handle,
        to,
        PLAIN_SPACE,
        PLAIN_STYLE
      );

    // The height is 120 - 105 = 15; the third anchor moves to the first anchor's time.
    expect(move('0', { time: 2, price: 90 })).toEqual([
      { time: 2, price: 90 },
      { time: 10, price: 110 },
      { time: 2, price: 105 }
    ]);
    expect(move('p1', { time: 12, price: 140 })).toEqual([
      { time: 0, price: 100 },
      { time: 12, price: 125 },
      { time: 0, price: 115 }
    ]);
    expect(move('m0', { time: 5, price: 100 })).toEqual([
      { time: 0, price: 95 },
      { time: 10, price: 105 },
      { time: 0, price: 115 }
    ]);
    expect(move('m1', { time: 5, price: 130 })).toEqual([
      { time: 0, price: 100 },
      { time: 10, price: 110 },
      { time: 0, price: 125 }
    ]);
  });

  it('hits both lines as line and the inside as body', () => {
    expect(hit('parallel-channel', geometry, 50, 77)?.part).toBe('line');
    expect(hit('parallel-channel', geometry, 50, 127)?.part).toBe('line');
    expect(hit('parallel-channel', geometry, 50, 110)).toEqual({ part: 'body', distance: 0 });
    expect(hit('parallel-channel', geometry, 50, 200)).toBeNull();
    expect(hit('parallel-channel', geometry, 150, 100)).toBeNull();
  });
});

describe('fib-retracement', () => {
  const geometry = geometryOf('fib-retracement', [
    [10, 100],
    [90, 200]
  ]);
  // The levels that show by default; 1.272, 1.414, 2, … 4.764 are there hidden.
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];

  it('draws the eleven levels shown in their colors between the anchors and a dashed diagonal', () => {
    const strokes = pathsOf(paint('fib-retracement', geometry), 'stroke');
    const lines = strokes.filter((path) => !isDashed(path));
    const dashed = strokes.filter(isDashed);

    // Level 0 where the move ended, the second anchor; 1 where it began, the first.
    expect(lines.map((line) => line.segments[0]?.[0].y)).toEqual(
      levels.map((level) => 200 + (100 - 200) * level)
    );
    expect(lines.every(({ segments: [line] }) => line?.[0].x === 10 && line[1].x === 90)).toBe(
      true
    );
    // 0 and 1 take the drawing's color, the others the palette in turn.
    expect(lines.map((line) => line.state.strokeStyle)).toEqual([
      darkTheme.accent,
      ...darkTheme.palette.slice(0, 5),
      darkTheme.accent,
      ...darkTheme.palette.slice(5, 8),
      darkTheme.palette[0]
    ]);
    expect(dashed).toHaveLength(1);
    expect(dashed[0]?.segments).toEqual([segment(10, 100, 90, 200)]);
  });

  it('covers its levels past the anchors, and their labels', () => {
    const box = registry.require('fib-retracement').bounds?.(geometry);
    // 4.236 lies 323.6 above level 1, as far as the labels' text from where the levels start.
    expect(box?.y).toBeCloseTo(200 - 100 * 4.236 - 12 - 4);
    expect(box?.height).toBeCloseTo(100 * 4.236 + 12 + 4);
    expect(box?.x).toBe(10);
    expect(box?.width).toBeGreaterThan(80);
  });

  it('labels each level with its ratio and price at the left', () => {
    const calls = paint('fib-retracement', geometry);

    expect(textsOf(calls)).toEqual([
      '0  200.00',
      '0.236  176.40',
      '0.382  161.80',
      '0.5  150.00',
      '0.618  138.20',
      '0.786  121.40',
      '1  100.00',
      '1.618  38.20',
      '2.618  -61.80',
      '3.618  -161.80',
      '4.236  -223.60'
    ]);
    expect(
      calls.filter(({ method }) => method === 'fillText').every(({ args }) => args[1] === 14)
    ).toBe(true);
  });

  it('labels the levels at the left edge of the plot as they extend there', () => {
    const extended = geometryOf(
      'fib-retracement',
      [
        [10, 100],
        [90, 200]
      ],
      '',
      { extendLeft: true }
    );
    const texts = paint('fib-retracement', extended).filter(({ method }) => method === 'fillText');

    expect(texts.every(({ args }) => args[1] === 4)).toBe(true);
  });

  it('tints each band with the color of the level it starts from', () => {
    const bands = paint('fib-retracement', geometry).filter(({ method }) => method === 'fillRect');

    expect(bands.map(({ state }) => state.fillStyle)).toEqual(
      [
        darkTheme.accent,
        ...darkTheme.palette.slice(0, 5),
        darkTheme.accent,
        ...darkTheme.palette.slice(5, 8)
      ].map((color) => withAlpha(color, 0.1))
    );
  });

  it('spans the x range of the anchors in either order', () => {
    const reversed = geometryOf('fib-retracement', [
      [90, 100],
      [10, 200]
    ]);
    const [line] = pathsOf(paint('fib-retracement', reversed), 'stroke');
    expect(line?.segments[0]).toEqual(segment(10, 200, 90, 200));
  });

  it('hits the level lines, and the bands between them where they are filled', () => {
    expect(hit('fib-retracement', geometry, 50, 152)).toEqual({ part: 'line', distance: 2 });
    expect(hit('fib-retracement', geometry, 50, 130)).toEqual({ part: 'body', distance: 0 });
    expect(hit('fib-retracement', geometry, 120, 150)).toBeNull();
    const unfilled = geometryOf(
      'fib-retracement',
      [
        [10, 100],
        [90, 200]
      ],
      '',
      { fill: false }
    );
    expect(hit('fib-retracement', unfilled, 50, 130)).toBeNull();
  });
});

describe('text', () => {
  const geometry = geometryOf('text', [[50, 60]], 'Hello');

  it('draws the text left-aligned at the anchor', () => {
    const calls = paint('text', geometry);
    const draw = calls.find(({ method }) => method === 'fillText');

    expect(draw?.args).toEqual(['Hello', 50, 60]);
    expect(draw?.state).toMatchObject({
      fillStyle: darkTheme.text,
      textAlign: 'left',
      textBaseline: 'middle',
      font: 'normal 12px sans-serif'
    });
    expect(calls.some(({ method }) => method === 'strokeRect')).toBe(false);
  });

  it('draws a placeholder for empty text', () => {
    expect(textsOf(paint('text', geometryOf('text', [[50, 60]])))).toEqual(['Text']);
  });

  it('outlines the text box while selected', () => {
    const border = paint('text', geometry, { selected: true }).find(
      ({ method }) => method === 'strokeRect'
    );
    // Line height 17 for 12px text, 4px padding, inset half a pixel.
    expect(border?.args).toEqual([46.5, 48, 5 * CHAR_WIDTH + 7, 24]);
  });

  it('paints several lines and nothing while edited in place', () => {
    const lines = geometryOf('text', [[50, 60]], 'One\nTwo');
    const draws = paint('text', lines).filter(({ method }) => method === 'fillText');

    expect(draws.map(({ args }) => args)).toEqual([
      ['One', 50, 60],
      ['Two', 50, 77]
    ]);
    expect(paint('text', lines, { editing: true })).toEqual([]);
    expect(registry.require('text').editableText).toBe(true);
  });

  it('hits the text box as body', () => {
    expect(hit('text', geometry, 70, 60)).toEqual({ part: 'body', distance: 0 });
    expect(hit('text', geometry, 92, 72)).toEqual({ part: 'body', distance: 0 });
    expect(hit('text', geometry, 100, 60)).toBeNull();
    expect(hit('text', geometry, 70, 80)).toBeNull();
  });
});

describe('path', () => {
  const geometry = geometryOf('path', [
    [0, 0],
    [50, 50],
    [100, 0]
  ]);

  it('strokes a polyline through every anchor', () => {
    const strokes = pathsOf(paint('path', geometry), 'stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.segments).toEqual([segment(0, 0, 50, 50), segment(50, 50, 100, 0)]);
  });

  it('paints a two-anchor preview while placing', () => {
    const preview = geometryOf('path', [
      [0, 0],
      [50, 50]
    ]);
    const [stroke] = pathsOf(paint('path', preview), 'stroke');
    expect(stroke?.segments).toEqual([segment(0, 0, 50, 50)]);
  });

  it('hits any segment as line', () => {
    expect(hit('path', geometry, 75, 27)?.part).toBe('line');
    expect(hit('path', geometry, 25, 27)?.part).toBe('line');
    expect(hit('path', geometry, 50, 0)).toBeNull();
  });
});

describe('price-range', () => {
  const rising = geometryOf('price-range', [
    [100, 100],
    [200, 110]
  ]);

  it('shows the change and percent change of a rise in the up color', () => {
    const calls = paint('price-range', rising);
    const [fill, head] = pathsOf(calls, 'fill');
    const [stroke] = pathsOf(calls, 'stroke');

    expect(textsOf(calls)).toEqual(['+10.00 (+10.00%) · 10 bars']);
    expect(fill?.state.fillStyle).toBe(withAlpha(darkTheme.up, 0.14));
    expect(stroke?.state.strokeStyle).toBe(darkTheme.up);
    // An arrow along the middle from the first value to the second, stopping inside its head.
    expect(stroke?.segments).toEqual([segment(150, 100, 150, 105)]);
    expect(head?.segments[0]?.[0]).toEqual({ x: 150, y: 110 });
    expect(head?.state.fillStyle).toBe(darkTheme.up);
  });

  it('shows a fall in the down color', () => {
    const falling = geometryOf('price-range', [
      [100, 100],
      [200, 90]
    ]);
    const calls = paint('price-range', falling);

    expect(textsOf(calls)).toEqual(['-10.00 (-10.00%) · 10 bars']);
    expect(pathsOf(calls, 'stroke')[0]?.state.strokeStyle).toBe(darkTheme.down);
  });

  it('labels the change beyond the second value, or on the other side without room there', () => {
    const labelY = (geometry: DrawingGeometry) =>
      paint('price-range', geometry).find(({ method }) => method === 'fillText')?.args[2];
    // Labels are 22 pixels high, 6 away from the box.
    expect(labelY(rising)).toBe(110 + 6 + 11 + 0.5);
    const toTop = geometryOf('price-range', [
      [100, 100],
      [200, 10]
    ]);
    expect(labelY(toTop)).toBe(100 + 6 + 11 + 0.5);
  });

  it('covers its label', () => {
    const box = registry.require('price-range').bounds?.(rising);
    expect(box?.y).toBe(100);
    expect(box?.height).toBe(110 + 6 + 22 - 100);
  });

  it('omits the percent change from a zero price', () => {
    const fromZero = geometryOf('price-range', [
      [100, 0],
      [200, 5]
    ]);
    expect(textsOf(paint('price-range', fromZero))).toEqual(['+5.00 · 10 bars']);
  });

  it('hits its arrow as line, its label and its box where it is filled as body', () => {
    expect(hit('price-range', rising, 151, 105)).toEqual({ part: 'line', distance: 1 });
    expect(hit('price-range', rising, 120, 105)).toEqual({ part: 'body', distance: 0 });
    // The label, below the box.
    expect(hit('price-range', rising, 150, 130)).toEqual({ part: 'body', distance: 0 });
    expect(hit('price-range', rising, 150, 160)).toBeNull();
    const unfilled = geometryOf(
      'price-range',
      [
        [100, 100],
        [200, 110]
      ],
      '',
      { fill: false }
    );
    // Its border is not drawn.
    expect(hit('price-range', unfilled, 101, 105)).toBeNull();
    expect(hit('price-range', unfilled, 120, 105)).toBeNull();
  });
});

describe('style options', () => {
  it('extends a trend line to the left and right edges of the plot as its style says', () => {
    const anchors = [
      [100, 100],
      [200, 150]
    ] as const;
    const line = (style: Partial<DrawingStyle>) =>
      pathsOf(paint('trend-line', geometryOf('trend-line', anchors, '', style)), 'stroke')[0]
        ?.segments[0];

    expect(line({})).toEqual(segment(100, 100, 200, 150));
    const right = line({ extendRight: true });
    expect(right?.[0]).toEqual({ x: 100, y: 100 });
    expect(right?.[1].x).toBeGreaterThan(400);
    const left = line({ extendLeft: true });
    expect(left?.[0].x).toBeLessThan(0);
    expect(left?.[1]).toEqual({ x: 200, y: 150 });
    // Extended, it is hit beyond its anchors too.
    expect(hit('trend-line', geometryOf('trend-line', anchors, '', {}), 300, 200)).toBeNull();
    expect(
      hit('trend-line', geometryOf('trend-line', anchors, '', { extendRight: true }), 300, 200)
        ?.distance
    ).toBeCloseTo(0);
  });

  it('puts arrowheads on the ends of a line, the arrow tool on its second anchor', () => {
    const anchors = [
      [100, 100],
      [200, 100]
    ] as const;
    const heads = (type: string, style: Partial<DrawingStyle> = {}) =>
      pathsOf(paint(type, geometryOf(type, anchors, '', style)), 'fill').map(
        ({ segments }) => segments[0]?.[0]
      );

    expect(heads('trend-line')).toEqual([]);
    expect(heads('arrow')).toEqual([{ x: 200, y: 100 }]);
    expect(heads('trend-line', { startArrow: true, endArrow: true })).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 }
    ]);
    // An end the line reaches past has no arrowhead.
    expect(heads('arrow', { extendRight: true })).toEqual([]);
    expect(heads('path', { endArrow: true })).toEqual([{ x: 200, y: 100 }]);
  });

  it('writes the text of a line along it, upright, above it in its font', () => {
    const calls = paint(
      'trend-line',
      geometryOf(
        'trend-line',
        [
          [200, 100],
          [100, 200]
        ],
        'Breakout',
        { bold: true }
      )
    );
    const rotate = calls.find(({ method }) => method === 'rotate');
    const text = calls.find(({ method }) => method === 'fillText');

    // From the left end, at the middle of the line, which rises to the right.
    expect(calls.find(({ method }) => method === 'translate')?.args).toEqual([100, 200]);
    expect(rotate?.args[0]).toBeCloseTo(-Math.PI / 4);
    expect(text?.args[0]).toBe('Breakout');
    expect(text?.args[1]).toBeCloseTo(Math.hypot(100, 100) / 2);
    expect(Number(text?.args[2])).toBeLessThan(0);
    expect(text?.state).toMatchObject({ textAlign: 'center', font: 'normal 12px sans-serif' });
  });

  it('leaves out the fill when the style turns it off', () => {
    const anchors = [
      [100, 100],
      [200, 50]
    ] as const;
    expect(pathsOf(paint('rectangle', geometryOf('rectangle', anchors)), 'fill')).toHaveLength(1);
    expect(
      pathsOf(paint('rectangle', geometryOf('rectangle', anchors, '', { fill: false })), 'fill')
    ).toHaveLength(0);
  });

  it('extends a rectangle to the edge of the plot without its side there', () => {
    const calls = paint(
      'rectangle',
      geometryOf(
        'rectangle',
        [
          [100, 100],
          [200, 50]
        ],
        '',
        { extendRight: true }
      )
    );
    const [fill] = pathsOf(calls, 'fill');
    const [stroke] = pathsOf(calls, 'stroke');

    expect(Math.max(...(fill?.segments.map(([from]) => from.x) ?? []))).toBe(400);
    expect(stroke?.segments).toEqual([
      segment(100, 50, 100, 100),
      segment(100, 100, 400, 100),
      segment(400, 50, 100, 50)
    ]);
  });

  it('writes the text of a rectangle inside it where its style places it', () => {
    const text = paint(
      'rectangle',
      geometryOf(
        'rectangle',
        [
          [100, 100],
          [200, 50]
        ],
        'Zone',
        { textAlign: 'right', textPosition: 'top' }
      )
    ).find(({ method }) => method === 'fillText');

    expect(text?.args[1]).toBe(196);
    expect(Number(text?.args[2])).toBeLessThan(75);
    expect(text?.state).toMatchObject({ textAlign: 'right' });
  });

  it('draws the Fibonacci levels its style gives, in their colors, as far as it extends them', () => {
    const geometry = geometryOf(
      'fib-retracement',
      [
        [10, 100],
        [90, 200]
      ],
      '',
      {
        levels: [
          { value: 0 },
          { value: 0.5, color: '#ff0000' },
          { value: 1.5 },
          { value: 1, visible: false }
        ],
        extendRight: true,
        fill: false
      }
    );
    const calls = paint('fib-retracement', geometry);
    const lines = pathsOf(calls, 'stroke').filter((path) => !isDashed(path));

    expect(lines.map((line) => line.segments[0]?.[0].y)).toEqual([200, 150, 50]);
    expect(lines.map((line) => line.state.strokeStyle)).toEqual([
      darkTheme.accent,
      '#ff0000',
      darkTheme.palette[1]
    ]);
    expect(lines.every(({ segments: [line] }) => line?.[1].x === 400)).toBe(true);
    expect(calls.some(({ method }) => method === 'fillRect')).toBe(false);
    expect(textsOf(calls)).toEqual(['0  200.00', '0.5  150.00', '1.5  50.00']);
  });

  it('aligns the lines of a text and paints its background when the style fills it', () => {
    const calls = paint(
      'text',
      geometryOf('text', [[50, 60]], 'Hello\nHi', { textAlign: 'center', fill: true })
    );
    const texts = calls.filter(({ method }) => method === 'fillText');

    expect(texts.map(({ args }) => args[1])).toEqual([50 + 17.5, 50 + 17.5]);
    expect(calls.find(({ method }) => method === 'fillRect')?.state.fillStyle).toBe(
      withAlpha(darkTheme.accent, 0.12)
    );
    expect(
      paint('text', geometryOf('text', [[50, 60]], 'Hello')).some(
        ({ method }) => method === 'fillRect'
      )
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { BarStore } from '../../src/data/bar-store';
import type { Bar, PriceSource } from '../../src/data/types';
import { fibChannel, fibRetracement } from '../../src/drawings/tools/fibonacci';
import { fibSpeedFan, gannBox } from '../../src/drawings/tools/gann';
import { screenAngle } from '../../src/drawings/tools/lines';
import { headAndShoulders, waveLabel, xabcdRatios } from '../../src/drawings/tools/patterns';
import { regression, regressionTrend } from '../../src/drawings/tools/regression';
import { anchoredVwap, vwapSeries } from '../../src/drawings/tools/vwap';
import { levelContext, levelValue } from '../../src/drawings/levels';
import { WAVE_DEGREES, resolveStyle } from '../../src/drawings/style';
import type {
  DrawingLevel,
  DrawingPoint,
  DrawingStyle,
  DrawingTypeDefinition,
  LevelScale
} from '../../src/drawings/types';
import { createCalendar } from '../../src/feed/calendar';
import { VWAP } from '../../src/indicators';
import { computeIndicator } from '../../src/indicators/headless';
import { createDefaultOptions } from '../../src/options/defaults';
import { BTCUSDT_1H } from '../helpers/real-bars';
import { createTestChart } from '../helpers/chart';
import { canvasCalls } from '../setup';

const HOUR = 3_600_000;
const LINEAR: LevelScale = { toScale: (value) => value, fromScale: (scaled) => scaled };
const LOG: LevelScale = {
  toScale: (value) => Math.log10(value),
  fromScale: (scaled) => 10 ** scaled
};

function storeOf(bars: readonly Bar[]): BarStore {
  const store = new BarStore();
  store.set(bars);
  return store;
}

const BARS = storeOf(BTCUSDT_1H);
const time = (index: number) => BTCUSDT_1H[index]?.time ?? Number.NaN;

function styleOf(definition: DrawingTypeDefinition, style: Partial<DrawingStyle> = {}) {
  return resolveStyle(createDefaultOptions(), definition, style);
}

/** The lines alerts watch of a drawing on the real bars. */
function levelsOf(
  definition: DrawingTypeDefinition,
  anchors: readonly DrawingPoint[],
  style: Partial<DrawingStyle> = {},
  scale = LINEAR
): readonly DrawingLevel[] {
  return (
    definition.levels?.(anchors, scale, styleOf(definition, style), levelContext(BARS, BARS)) ?? []
  );
}

function valueOf(levels: readonly DrawingLevel[], key: string, at: number, scale = LINEAR) {
  const level = levels.find((each) => each.key === key);

  if (!level) {
    throw new Error(`No level ${key}.`);
  }

  return levelValue(level, at, BARS, scale);
}

function price(bar: Bar, source: PriceSource): number {
  return source === 'close' ? bar.close : (bar.high + bar.low + bar.close) / 3;
}

/**
 * The linear regression of the regression trend tool, written out: bars counted back from the
 * last one, `per = i + 1`, the deviation of the prices from the line over `length - 1`, and
 * Pearson's R of the prices and the line's values.
 */
function referenceRegression(bars: readonly Bar[], source: PriceSource) {
  const back = [...bars].reverse().map((bar) => price(bar, source));
  const length = back.length;
  let sumX = 0;
  let sumY = 0;
  let sumXSqr = 0;
  let sumXY = 0;

  for (let i = 0; i < length; i += 1) {
    const val = back[i] ?? Number.NaN;
    const per = i + 1;
    sumX += per;
    sumY += val;
    sumXSqr += per * per;
    sumXY += val * per;
  }

  const slope = (length * sumXY - sumX * sumY) / (length * sumXSqr - sumX * sumX);
  const average = sumY / length;
  const intercept = average - (slope * sumX) / length + slope;
  const periods = length - 1;
  const daY = intercept + (slope * periods) / 2;
  let val = intercept;
  let stdDevAcc = 0;
  let dsxx = 0;
  let dsyy = 0;
  let dsxy = 0;

  for (let j = 0; j <= periods; j += 1) {
    let value = back[j] ?? Number.NaN;
    const dxt = value - average;
    const dyt = val - daY;
    value -= val;
    stdDevAcc += value * value;
    dsxx += dxt * dxt;
    dsyy += dyt * dyt;
    dsxy += dxt * dyt;
    val += slope;
  }

  return {
    // startPrice = i + s * (length - 1) at the first bar, endPrice = i at the last.
    start: intercept + slope * (length - 1),
    end: intercept,
    deviation: Math.sqrt(stdDevAcc / (periods === 0 ? 1 : periods)),
    pearson: dsxx === 0 || dsyy === 0 ? 0 : dsxy / Math.sqrt(dsxx * dsyy)
  };
}

function expectRelative(actual: number, expected: number, digits = 9) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * 10 ** -digits);
}

describe('regression trend', () => {
  it('fits the bars between its anchors as the reference does, on real bars', () => {
    for (const [from, to, source] of [
      [40, 140, 'close'],
      [150, 311, 'close'],
      [10, 60, 'hlc3'],
      [200, 201, 'close']
    ] as const) {
      const fit = regression(BARS, time(to), time(from), source);
      const reference = referenceRegression(BTCUSDT_1H.slice(from, to + 1), source);

      expect(fit).not.toBeNull();
      expect(fit?.first).toBe(from);
      expect(fit?.last).toBe(to);
      expectRelative(fit?.start ?? 0, reference.start);
      expectRelative((fit?.start ?? 0) + (fit?.slope ?? 0) * (to - from), reference.end);

      if (to - from > 1) {
        expectRelative(fit?.deviation ?? 0, reference.deviation, 7);
        expectRelative(fit?.pearson ?? 0, reference.pearson, 9);
      }
    }
  });

  it('matches an independent least squares fit and correlation', () => {
    const slice = BTCUSDT_1H.slice(40, 141).map((bar) => bar.close);
    const n = slice.length;
    const xs = slice.map((_, index) => index);
    const meanX = (n - 1) / 2;
    const meanY = slice.reduce((sum, value) => sum + value, 0) / n;
    const sxy = xs.reduce((sum, x, index) => sum + (x - meanX) * ((slice[index] ?? 0) - meanY), 0);
    const sxx = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    const syy = slice.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
    const slope = sxy / sxx;
    const residuals = slice.reduce(
      (sum, value, index) => sum + (value - (meanY + slope * (index - meanX))) ** 2,
      0
    );
    const fit = regression(BARS, time(40), time(140), 'close');

    expectRelative(fit?.slope ?? 0, slope, 7);
    expectRelative(fit?.start ?? 0, meanY - slope * meanX);
    expectRelative(fit?.deviation ?? 0, Math.sqrt(residuals / (n - 1)), 7);
    expectRelative(fit?.pearson ?? 0, Math.abs(sxy) / Math.sqrt(sxx * syy), 9);
  });

  it('watches the base line and the lines two deviations away by default', () => {
    const anchors = [
      { time: time(40), price: 1 },
      { time: time(140), price: 2 }
    ];
    const levels = levelsOf(regressionTrend, anchors);
    const reference = referenceRegression(BTCUSDT_1H.slice(40, 141), 'close');

    expect(levels.map((level) => level.key)).toEqual(['2', '-2', '0']);
    expectRelative(valueOf(levels, '0', time(40)), reference.start);
    expectRelative(valueOf(levels, '0', time(140)), reference.end);
    expectRelative(valueOf(levels, '2', time(140)), reference.end + 2 * reference.deviation, 8);
    expectRelative(valueOf(levels, '-2', time(40)), reference.start - 2 * reference.deviation, 8);
    // Not past the last anchor unless the lines are extended.
    expect(valueOf(levels, '0', time(141))).toBeNaN();
    const extended = levelsOf(regressionTrend, anchors, { extendRight: true });
    expectRelative(
      valueOf(extended, '0', time(150)),
      reference.end + ((reference.end - reference.start) / 100) * 10,
      8
    );
  });
});

describe('anchored VWAP', () => {
  const utc = createCalendar({ timeZone: 'UTC' });

  /** Where `anchor` periods start: the first bar of each day, week, … */
  function starts(anchor: string): number[] {
    return BTCUSDT_1H.flatMap((bar, index) => {
      const previous = BTCUSDT_1H[index - 1];
      return previous && utc.bucket(previous.time, anchor) === utc.bucket(bar.time, anchor)
        ? []
        : [index];
    });
  }

  it('equals the VWAP indicator over the same bars, its bands too', () => {
    for (const [param, period] of [
      [0, '1D'],
      [1, '1W']
    ] as const) {
      const indicator = computeIndicator(VWAP, BTCUSDT_1H, {
        calendar: utc,
        params: { anchor: param, band1: 1, band2: 2 }
      });
      const begins = starts(period);
      // Every whole period of the data, anchored at its first bar.
      const periods = begins.slice(1, -1).map((start, index) => [start, begins[index + 2] ?? 0]);

      expect(periods.length).toBeGreaterThan(0);

      for (const [start = 0, end = 0] of periods) {
        const anchor = { time: time(start), price: 0 };
        const levels = levelsOf(anchoredVwap, [anchor], {
          levels: [{ value: 1 }, { value: 2 }]
        });

        for (let index = start; index < end; index += 1) {
          // The levels of the drawing by the outputs of the indicator.
          for (const [key, output] of [
            ['vwap', 'vwap'],
            ['1', 'upperBand1'],
            ['-1', 'lowerBand1'],
            ['2', 'upperBand2'],
            ['-2', 'lowerBand2']
          ] as const) {
            expectRelative(valueOf(levels, key, time(index)), indicator[output]?.[index] ?? 0, 10);
          }
        }
      }
    }
  });

  it('is the volume-weighted average of hlc3 from the anchor bar on', () => {
    const series = vwapSeries(BARS, time(100) - HOUR / 2, 'hlc3');
    let volume = 0;
    let sum = 0;
    let squares = 0;

    expect(series.first).toBe(100);

    for (let index = 100; index < BTCUSDT_1H.length; index += 1) {
      const bar = BTCUSDT_1H[index] as Bar;
      const typical = (bar.high + bar.low + bar.close) / 3;
      volume += bar.volume;
      sum += typical * bar.volume;
      squares += typical * typical * bar.volume;
      const vwap = sum / volume;
      expectRelative(series.vwap[index - 100] ?? 0, vwap, 11);
      expectRelative(
        series.deviation[index - 100] ?? 0,
        Math.sqrt(squares / volume - vwap ** 2),
        5
      );
    }
  });

  it('watches the VWAP and the bands shown, from the anchor bar on', () => {
    const levels = levelsOf(anchoredVwap, [{ time: time(50), price: 0 }]);

    expect(levels.map((level) => level.key)).toEqual(['vwap', '1', '-1']);
    expect(valueOf(levels, 'vwap', time(49))).toBeNaN();
    // On the anchor bar the VWAP is the bar's typical price.
    const bar = BTCUSDT_1H[50] as Bar;
    expectRelative(valueOf(levels, 'vwap', time(50)), (bar.high + bar.low + bar.close) / 3, 12);
    expect(
      levelsOf(anchoredVwap, [{ time: time(50), price: 0 }], { source: 'close' })
    ).toHaveLength(3);
    expectRelative(
      valueOf(
        levelsOf(anchoredVwap, [{ time: time(50), price: 0 }], { source: 'close' }),
        'vwap',
        time(50)
      ),
      bar.close,
      12
    );
  });

  it('names each band by its deviations, whatever bands are hidden', () => {
    const anchor = { time: time(50), price: 0 };
    const all = levelsOf(anchoredVwap, [anchor], {
      levels: [{ value: 1 }, { value: 2 }]
    });
    const second = levelsOf(anchoredVwap, [anchor], {
      levels: [{ value: 1, visible: false }, { value: 2 }]
    });

    expect(second.map((level) => level.key)).toEqual(['vwap', '2', '-2']);

    for (const key of ['2', '-2']) {
      expect(valueOf(second, key, time(80))).toBe(valueOf(all, key, time(80)));
    }
  });

  it('fires alerts where price crosses it, at its value at that bar', () => {
    const chart = createTestChart();
    chart.data.set(BTCUSDT_1H.slice(0, 200));
    chart.drawings.add({
      id: 'vwap',
      type: 'anchored-vwap',
      points: [{ time: time(0), price: 0 }]
    });
    const fired: Array<{ time: number; threshold: number }> = [];
    chart.on('alertTrigger', (event) => {
      fired.push({ time: event.time, threshold: event.threshold });
    });
    chart.alerts.add({
      id: 'touch',
      trigger: 'cross',
      value: { kind: 'drawing', id: 'vwap', level: 'vwap' },
      frequency: 'every-time'
    });
    const series = vwapSeries(BARS, time(0), 'hlc3');

    for (let index = 200; index < 260; index += 1) {
      chart.data.update(BTCUSDT_1H[index] as Bar);
    }

    expect(fired.length).toBeGreaterThan(0);

    // Each alert compared the close with the VWAP of its bar.
    for (const { time: at, threshold } of fired) {
      expectRelative(threshold, series.vwap[BARS.lowerBound(at)] ?? 0, 10);
    }
  });
});

describe('Fibonacci time zones', () => {
  it('marks 0, 1, 2, 3, 5, 8, 13, … units of bars from the first anchor', () => {
    const chart = createTestChart({}, 2400, 500);
    chart.data.set(BTCUSDT_1H);
    chart.timeScale.fitContent();
    chart.drawings.add({
      type: 'fib-time-zone',
      points: [
        { time: time(20), price: 80_000 },
        { time: time(23), price: 81_000 }
      ]
    });
    const canvas = chart.element.querySelector<HTMLCanvasElement>('canvas[data-layer="objects"]');
    const calls = canvas ? canvasCalls(canvas) : [];
    calls.length = 0;
    chart.screenshot();
    const plot = chart.layout().panes[0]?.plot;
    // The zones are full-height lines: from the top of the plot to its bottom.
    const zones = calls.flatMap((call, index) => {
      const next = calls[index + 1];
      return call.name === 'moveTo' &&
        call.args[1] === 0 &&
        next?.name === 'lineTo' &&
        next.args[0] === call.args[0] &&
        next.args[1] === plot?.height
        ? [Number(call.args[0])]
        : [];
    });
    const expected = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].map(
      (count) => (chart.timeScale.timeToX(time(20 + 3 * count)) ?? 0) - (plot?.x ?? 0)
    );

    expect(zones).toHaveLength(expected.length);
    zones.forEach((x, index) => {
      expect(x).toBeCloseTo(expected[index] ?? 0, 6);
    });
  });
});

describe('Gann box and speed resistance fan', () => {
  const first = { time: time(100), price: 82_000 };
  const second = { time: time(160), price: 84_000 };

  it('divides a Gann box at 0, 0.25, 0.382, 0.5, 0.618, 0.75 and 1 from the first anchor', () => {
    const levels = levelsOf(gannBox, [first, second]);

    expect(levels.map((level) => level.key)).toEqual([
      '0',
      '0.25',
      '0.382',
      '0.5',
      '0.618',
      '0.75',
      '1'
    ]);

    for (const ratio of [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]) {
      expect(valueOf(levels, String(ratio), time(130))).toBeCloseTo(82_000 + 2_000 * ratio, 6);
    }

    // Divided as drawn: evenly on a logarithmic scale too.
    const log = levelsOf(gannBox, [first, second], {}, LOG);
    expect(valueOf(log, '0.5', time(130), LOG)).toBeCloseTo(Math.sqrt(82_000 * 84_000), 6);
    // Only across the box.
    expect(valueOf(levels, '0.5', time(161))).toBeNaN();
  });

  it('draws fan rays from the first anchor through the levels on the second anchor’s side', () => {
    const levels = levelsOf(fibSpeedFan, [first, second]);

    expect(levels.map((level) => level.key)).toEqual([
      '0',
      '0.25',
      '0.382',
      '0.5',
      '0.618',
      '0.75',
      '1',
      'time-0',
      'time-0.25',
      'time-0.382',
      'time-0.5',
      'time-0.618',
      'time-0.75'
    ]);

    // Price levels run from the second anchor (0) back to the first (1), at the second's time.
    for (const ratio of [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]) {
      const through = 84_000 - 2_000 * ratio;
      expect(valueOf(levels, String(ratio), time(160))).toBeCloseTo(through, 6);
      // A ray: on past the box at the same slope.
      expect(valueOf(levels, String(ratio), time(190))).toBeCloseTo(
        82_000 + ((through - 82_000) * 90) / 60,
        6
      );
    }

    // Time levels run from the second anchor's time back to the first's, at the second's price.
    for (const ratio of [0, 0.25, 0.382, 0.5, 0.618, 0.75]) {
      const bars = 60 * (1 - ratio);
      expect(valueOf(levels, `time-${ratio}`, time(100 + 30))).toBeCloseTo(
        82_000 + (2_000 * 30) / bars,
        6
      );
    }
  });
});

describe('Fibonacci channel', () => {
  it('moves the base line by each ratio of the way to the third anchor', () => {
    const anchors = [
      { time: time(100), price: 82_000 },
      { time: time(160), price: 83_000 },
      { time: time(120), price: 84_000 }
    ];
    const levels = levelsOf(fibChannel, anchors);

    expect(levels.map((level) => level.key)).toEqual([
      '0',
      '0.236',
      '0.382',
      '0.5',
      '0.618',
      '0.786',
      '1',
      '1.618',
      '2.618',
      '3.618',
      '4.236'
    ]);

    for (const ratio of [0, 0.5, 1, 1.618]) {
      // The line starts where the first anchor moved by the ratio, 20 bars and 2,000 per unit.
      const start = 100 + 20 * ratio;
      const value = 82_000 + 2_000 * ratio;
      expect(valueOf(levels, String(ratio), BARS.timeOfLogicalIndex(start))).toBeCloseTo(value, 6);
      expect(valueOf(levels, String(ratio), BARS.timeOfLogicalIndex(start + 30))).toBeCloseTo(
        value + 500,
        6
      );
    }
  });
});

describe('patterns', () => {
  it('measures the legs of an XABCD pattern as they are usually labeled', () => {
    const [x, a, b, c, d] = [
      { time: time(10), price: BTCUSDT_1H[10]?.low ?? 0 },
      { time: time(40), price: BTCUSDT_1H[40]?.high ?? 0 },
      { time: time(60), price: BTCUSDT_1H[60]?.low ?? 0 },
      { time: time(80), price: BTCUSDT_1H[80]?.high ?? 0 },
      { time: time(100), price: BTCUSDT_1H[100]?.low ?? 0 }
    ];
    const ratios = xabcdRatios([x, a, b, c, d]);

    expect(ratios.xb).toBeCloseTo(Math.abs(a.price - b.price) / Math.abs(a.price - x.price), 12);
    expect(ratios.ac).toBeCloseTo(Math.abs(c.price - b.price) / Math.abs(a.price - b.price), 12);
    expect(ratios.bd).toBeCloseTo(Math.abs(c.price - d.price) / Math.abs(c.price - b.price), 12);
    expect(ratios.xd).toBeCloseTo(Math.abs(a.price - d.price) / Math.abs(a.price - x.price), 12);
    // The help center's example: X 214, A 233, B 221, C 237.5, D 219.5.
    const example = xabcdRatios([
      { time: 0, price: 214 },
      { time: 1, price: 233 },
      { time: 2, price: 221 },
      { time: 3, price: 237.5 },
      { time: 4, price: 219.5 }
    ]);
    expect(example.xb).toBeCloseTo(0.632, 3);
    expect(example.bd).toBeCloseTo(1.091, 3);
    expect(example.xd).toBeCloseTo(0.711, 3);
  });

  it('watches the neckline of a head and shoulders through its two lows', () => {
    const anchors = [80_000, 82_000, 81_000, 83_000, 81_500, 82_200, 80_500].map(
      (value, index) => ({ time: time(100 + index * 10), price: value })
    );
    const levels = levelsOf(headAndShoulders, anchors);

    expect(levels.map((level) => level.key)).toEqual(['neckline']);
    expect(valueOf(levels, 'neckline', time(140))).toBeCloseTo(81_500, 6);
    // On past the second low, where a break is watched.
    expect(valueOf(levels, 'neckline', time(170))).toBeCloseTo(82_250, 6);
  });

  it('labels Elliott waves in the notation of each degree', () => {
    const labels = WAVE_DEGREES.map((degree) => {
      const label = waveLabel(degree, 3, false);
      return `${label.circled ? 'circled ' : ''}${label.text}`;
    });

    expect(labels).toEqual([
      'circled 3',
      '(3)',
      '3',
      'circled III',
      '(III)',
      'III',
      'circled 3',
      '(3)',
      '3',
      'circled iii',
      '(iii)',
      'iii',
      'circled 3',
      '(3)',
      '3'
    ]);
    expect(waveLabel('intermediate', 1, true).text).toBe('(A)');
    expect(waveLabel('minor', 3, true).text).toBe('C');
    expect(waveLabel('cycle', 2, true).text).toBe('b');
    expect(waveLabel('minuette', 1, true).text).toBe('(a)');
    expect(waveLabel('primary', 5, false)).toEqual({ text: '5', circled: true });
  });
});

describe('trend angle', () => {
  it('measures the angle on screen up from the horizontal', () => {
    expect(screenAngle({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45, 12);
    expect(screenAngle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(-45, 12);
    expect(screenAngle({ x: 0, y: 0 }, { x: -100, y: 0 })).toBeCloseTo(180, 12);
    // The help center's 23.17°: a rise of tan(23.17°) per pixel.
    const rise = Math.tan((23.17 * Math.PI) / 180) * 300;
    expect(screenAngle({ x: 0, y: rise }, { x: 300, y: 0 }).toFixed(2)).toBe('23.17');
  });
});

describe('channel alerts between the lines of the new tools', () => {
  const LOADED = 200;

  /** The bars an exit or an inside alert fires on as the bars after `LOADED` come in. */
  function fires(
    drawing: { type: string; points: DrawingPoint[]; style?: Partial<DrawingStyle> },
    bounds: readonly [string, string],
    trigger: 'exit-channel' | 'inside-channel'
  ): number[] {
    const chart = createTestChart();
    chart.data.set(BTCUSDT_1H.slice(0, LOADED));
    chart.drawings.add({ id: 'drawing', ...drawing });
    const fired: number[] = [];
    chart.on('alertTrigger', (event) => fired.push(BARS.lowerBound(event.time)));
    chart.alerts.add({
      id: 'channel',
      trigger,
      value: [
        { kind: 'drawing', id: 'drawing', level: bounds[0] },
        { kind: 'drawing', id: 'drawing', level: bounds[1] }
      ],
      frequency: 'every-time'
    });

    for (const bar of BTCUSDT_1H.slice(LOADED)) {
      chart.data.update(bar);
    }

    return fired;
  }

  /** The same, from the lines' values and the closes: crossing out of the channel, or inside. */
  function reference(
    definition: DrawingTypeDefinition,
    drawing: { points: DrawingPoint[]; style?: Partial<DrawingStyle> },
    bounds: readonly [string, string],
    trigger: 'exit-channel' | 'inside-channel'
  ): number[] {
    const levels = levelsOf(definition, drawing.points, drawing.style);
    const channel = (index: number) => {
      const values = bounds.map((key) => valueOf(levels, key, time(index)));
      return [Math.min(...values), Math.max(...values)] as const;
    };
    const close = (index: number) => BTCUSDT_1H[index]?.close ?? Number.NaN;
    return BTCUSDT_1H.slice(LOADED).flatMap((_, offset) => {
      const index = LOADED + offset;
      const [lower, upper] = channel(index);
      const [lowerBefore, upperBefore] = channel(index - 1);
      const meets =
        trigger === 'inside-channel'
          ? close(index) > lower && close(index) < upper
          : (close(index) < lower && close(index - 1) >= lowerBefore) ||
            (close(index) > upper && close(index - 1) <= upperBefore);
      return meets ? [index] : [];
    });
  }

  it('watches a regression trend between its outer lines, the first two', () => {
    const drawing = {
      type: 'regression-trend',
      points: [
        { time: time(120), price: 0 },
        { time: time(199), price: 0 }
      ],
      style: { extendRight: true, levels: [{ value: 1 }, { value: 0 }, { value: -1 }] }
    };
    const exits = fires(drawing, ['1', '-1'], 'exit-channel');

    expect(
      levelsOf(regressionTrend, drawing.points, drawing.style).map((each) => each.key)
    ).toEqual(['1', '-1', '0']);
    expect(exits.length).toBeGreaterThan(0);
    expect(exits).toEqual(reference(regressionTrend, drawing, ['1', '-1'], 'exit-channel'));
    expect(fires(drawing, ['1', '-1'], 'inside-channel')).toEqual(
      reference(regressionTrend, drawing, ['1', '-1'], 'inside-channel')
    );
  });

  it('watches the band of an anchored VWAP, a curve, and the levels of a Gann box', () => {
    const vwap = { type: 'anchored-vwap', points: [{ time: time(150), price: 0 }] };
    const exits = fires(vwap, ['1', '-1'], 'exit-channel');

    expect(exits.length).toBeGreaterThan(0);
    expect(exits).toEqual(reference(anchoredVwap, vwap, ['1', '-1'], 'exit-channel'));

    const box = {
      type: 'gann-box',
      points: [
        { time: time(190), price: 80_500 },
        { time: time(311), price: 83_500 }
      ]
    };
    const inside = fires(box, ['0.382', '0.618'], 'inside-channel');
    expect(inside.length).toBeGreaterThan(0);
    expect(inside).toEqual(reference(gannBox, box, ['0.382', '0.618'], 'inside-channel'));
  });
});

describe('the keys of the lines at levels', () => {
  it('name each line by its level, as its label writes it', () => {
    const keys = (definition: DrawingTypeDefinition, anchors: number[], style = {}) =>
      levelsOf(
        definition,
        anchors.map((index) => ({ time: time(index), price: 80_000 + index * 10 })),
        style
      ).map((level) => level.key);
    const ratios = { levels: [{ value: 0 }, { value: 0.70711 }, { value: -0.5 }] };

    expect(keys(fibRetracement, [100, 150], ratios)).toEqual(['0', '0.707', '-0.5']);
    expect(keys(gannBox, [100, 150], ratios)).toEqual(['0', '0.707', '-0.5']);
    expect(keys(regressionTrend, [100, 150])).toEqual(['2', '-2', '0']);
    expect(keys(anchoredVwap, [100])).toEqual(['vwap', '1', '-1']);
    expect(keys(fibSpeedFan, [100, 150], { ...ratios, timeLevels: [{ value: 0.5 }] })).toEqual([
      '0',
      '0.707',
      '-0.5',
      'time-0.5'
    ]);
  });
});

describe('the series a VWAP and a regression keep', () => {
  /** The real bars, counting the reads of `field`. */
  function counted(field: 'volume' | 'close'): { bars: BarStore; reads: () => number } {
    let reads = 0;
    const bars = new Proxy(storeOf(BTCUSDT_1H), {
      get: (target, key, receiver) => {
        const value: unknown = Reflect.get(target, key, receiver);

        if (key === field && typeof value === 'function') {
          return (index: number) => {
            reads += 1;
            return (value as (index: number) => number).call(target, index);
          };
        }

        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    return { bars, reads: () => reads };
  }

  /** The value at the last bar of the first line of a drawing anchored at `anchors`. */
  function read(definition: DrawingTypeDefinition, bars: BarStore, anchors: number[]): number {
    const [line] =
      definition.levels?.(
        anchors.map((index) => ({ time: time(index), price: 0 })),
        LINEAR,
        styleOf(definition),
        levelContext(bars, bars)
      ) ?? [];
    return line ? levelValue(line, time(BTCUSDT_1H.length - 1), bars, LINEAR) : Number.NaN;
  }

  it.each([
    ['an anchored VWAP', anchoredVwap, 'volume', (index: number) => [index]],
    ['a regression trend', regressionTrend, 'close', (index: number) => [index, index + 50]]
  ] as const)('keeps only so many of those of %s, the latest', (_, definition, field, anchors) => {
    const { bars, reads } = counted(field);
    read(definition, bars, anchors(10));
    const first = reads();

    expect(first).toBeGreaterThan(0);
    read(definition, bars, anchors(10));
    expect(reads()).toBe(first);

    // A tool previewing its drawing asks for one series a bar the pointer passes.
    for (let index = 11; index < 400; index += 1) {
      read(definition, bars, anchors(index));
    }

    const before = reads();
    read(definition, bars, anchors(10));
    expect(reads()).toBeGreaterThan(before);
  });
});

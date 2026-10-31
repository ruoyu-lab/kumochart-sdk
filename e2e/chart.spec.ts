import { expect, test, type Page } from '@playwright/test';
import type { Chart } from 'kumo-charts';
import type { AllModules } from 'kumo-charts/all';

declare global {
  interface Window {
    chart: Chart<AllModules> | undefined;
    events: Array<{ type: string; payload: unknown }>;
  }
}

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      collected.push(message.text());
    }
  });
  // A chart over the whole window with the same bars on every run (examples/src/test.ts).
  await page.goto('/test.html');
  await page.waitForFunction(() => (window.chart?.data.length ?? 0) > 0);
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/** The events of one type the chart emitted so far. */
async function events(page: Page, type: string): Promise<unknown[]> {
  return page.evaluate(
    (name) => window.events.filter((event) => event.type === name).map((event) => event.payload),
    type
  );
}

/** Center of the main pane in page coordinates. */
async function plotCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#chart').boundingBox();
  const layout = await page.evaluate(() => window.chart?.layout());

  if (!box || !layout?.panes[0]) {
    throw new Error('The chart has no layout.');
  }

  const main = layout.panes[0].plot;
  return { x: box.x + main.width / 2, y: box.y + main.y + main.height / 2 };
}

/** Page coordinates of a time and price on the main pane. */
async function pagePoint(
  page: Page,
  time: number,
  price: number
): Promise<{ x: number; y: number }> {
  const box = await page.locator('#chart').boundingBox();
  const local = await page.evaluate(
    ([t, p]) => ({
      x: window.chart?.timeScale.timeToX(t ?? 0) ?? null,
      y: window.chart?.priceScale().priceToY(p ?? 0) ?? null
    }),
    [time, price]
  );

  if (!box || local.x === null || local.y === null) {
    throw new Error('The point is not visible.');
  }

  return { x: box.x + local.x, y: box.y + local.y };
}

/** A rectangle over two recent bars, added through the API. */
async function addRectangle(page: Page, id: string) {
  return page.evaluate((key) => {
    const chart = window.chart;
    const bars = chart?.data.toArray() ?? [];
    const first = bars[bars.length - 60];
    const second = bars[bars.length - 30];

    if (!chart || !first || !second) {
      throw new Error('No bars.');
    }

    chart.drawings.add({
      id: key,
      type: 'rectangle',
      points: [
        { time: first.time, price: first.low },
        { time: second.time, price: second.high }
      ]
    });
    return chart.drawings.get(key)?.points ?? [];
  }, id);
}

/** Dispatches pointer events the way a touch screen would. */
async function touch(page: Page, type: string, id: number, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ type, id, x, y }) => {
      window.chart?.element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          clientX: x,
          clientY: y
        })
      );
    },
    { type, id, x, y }
  );
}

test('renders candles and indicators', async ({ page }) => {
  const colors = await page.evaluate(() => {
    const canvas = window.chart?.screenshot();
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return 0;
    }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();

    for (let index = 0; index < pixels.length; index += 4 * 97) {
      seen.add(
        ((pixels[index] ?? 0) << 16) | ((pixels[index + 1] ?? 0) << 8) | (pixels[index + 2] ?? 0)
      );
    }

    return seen.size;
  });

  expect(colors).toBeGreaterThan(20);
  // MA and volume share the main pane; volume has a scale of its own under the bars.
  expect(await page.evaluate(() => window.chart?.panes.list().length)).toBe(1);
  expect(await page.evaluate(() => window.chart?.indicators.get('vol')?.scale)).toBe('volume');
});

test('draws the Ichimoku cloud in the space after the latest bar', async ({ page }) => {
  const painted = await page.evaluate(() => {
    const chart = window.chart;

    if (!chart) {
      throw new Error('No chart.');
    }

    chart.indicators.add({ id: 'ichimoku', type: 'ICHIMOKU' });
    const last = chart.data.length - 1;
    chart.timeScale.scrollToIndex(last + 35, 'right');
    const canvas = chart.screenshot();
    const context = canvas.getContext('2d');
    const plot = chart.layout().panes[0]?.plot;

    if (!context || !plot) {
      throw new Error('Nothing painted.');
    }

    // Pixels of a column of the main pane that differ from the same rows 30 bars past the latest
    // bar, where nothing but the horizontal grid is drawn.
    const ratio = canvas.width / chart.element.clientWidth;
    const column = (index: number) => {
      const x = Math.round((chart.timeScale.indexToX(index) ?? 0) * ratio);
      return context.getImageData(x, Math.round(plot.y * ratio), 1, Math.round(plot.height * ratio))
        .data;
    };
    const empty = column(last + 30);
    const differing = (index: number) => {
      const pixels = column(index);
      let count = 0;

      for (let offset = 0; offset < pixels.length; offset += 4) {
        if ([0, 1, 2].some((channel) => pixels[offset + channel] !== empty[offset + channel])) {
          count += 1;
        }
      }

      return count;
    };

    return { cloud: differing(last + 15), beyond: differing(last + 28) };
  });

  // The cloud reaches 25 bars past the latest bar, and no further.
  expect(painted.cloud).toBeGreaterThan(10);
  expect(painted.beyond).toBe(0);
});

test('draws VWAP, SAR, SuperTrend and the Keltner and Donchian channels', async ({ page }) => {
  const result = await page.evaluate(() => {
    const chart = window.chart;

    if (!chart) {
      return null;
    }

    const ids = ['VWAP', 'SAR', 'SUPERTREND', 'KC', 'DC'].map((type) =>
      chart.indicators.add({ type })
    );
    chart.screenshot();
    // The chart's calendar is in UTC, so VWAP starts again with the bar at midnight.
    const midnight = chart.data.indexOf(Date.UTC(2024, 4, 2));
    const bar = chart.data.at(midnight);
    const vwap = chart.indicators.valuesAt(ids[0] ?? '', midnight)[0]?.value ?? null;
    return {
      drawn: ids.map((id) => chart.indicators.valuesAt(id).some((value) => value.value !== null)),
      offset: bar && vwap !== null ? Math.abs(vwap - (bar.high + bar.low + bar.close) / 3) : null
    };
  });

  expect(result?.drawn).toEqual([true, true, true, true, true]);
  expect(result?.offset).toBeLessThan(1e-9);
});

test('draws pivot levels, session boxes and volume candles', async ({ page }) => {
  const result = await page.evaluate(() => {
    const chart = window.chart;

    if (!chart) {
      throw new Error('No chart.');
    }

    // Columns of the main pane, as the screen shows them.
    const columns = (indices: readonly number[]) => {
      const canvas = chart.screenshot();
      const context = canvas.getContext('2d');
      const plot = chart.layout().panes[0]?.plot;

      if (!context || !plot) {
        throw new Error('Nothing painted.');
      }

      const ratio = canvas.width / chart.element.clientWidth;
      return indices.map((index) => {
        const x = Math.round((chart.timeScale.indexToX(index) ?? 0) * ratio);
        const height = Math.round(plot.height * ratio);
        return context.getImageData(x, Math.round(plot.y * ratio), 1, height).data.join();
      });
    };
    chart.indicators.remove('ma');
    chart.timeScale.fitContent();
    // The legend grows with the indicators added, and its text would change the columns compared.
    chart.applyOptions({ legend: { visible: false } });
    // The London session is 08:30 to 16:30 in London, 07:30 to 15:30 UTC in May: 10:00 UTC is
    // inside it and 22:00 outside every session.
    const at = (hour: number) =>
      chart.data.toArray().findIndex((bar) => new Date(bar.time).getUTCHours() === hour);
    const inside = at(10);
    const outside = at(22);
    const before = columns([inside, outside]);
    const sessions = chart.indicators.add({ type: 'SESSIONS' });
    const after = columns([inside, outside]);
    const values = chart.indicators.valuesAt(sessions, inside);
    // What the sessions hold at the bar outside them, and where its column changed, if it did.
    const outsideValues = chart.indicators
      .valuesAt(sessions, outside)
      .filter((value) => value.value !== null)
      .map((value) => `${value.key} ${value.text}`);
    const pixels = (column: string | undefined) => column?.split(',').map(Number) ?? [];
    // Rasterizers may round a pixel of what they paint again by a step or two.
    const TOLERANCE = 2;
    const differs = (left: number[], right: number[]) =>
      left.findIndex((channel, index) => Math.abs(channel - (right[index] ?? 0)) > TOLERANCE);
    const [was, now] = [pixels(before[1]), pixels(after[1])];
    const first = differs(was, now);
    const changed =
      first < 0
        ? null
        : {
            row: Math.floor(first / 4),
            rows: was.length / 4,
            was: was.slice(first - (first % 4), first - (first % 4) + 4),
            now: now.slice(first - (first % 4), first - (first % 4) + 4)
          };
    chart.indicators.remove(sessions);

    const pivots = chart.indicators.add({ type: 'PIVOTS' });
    const levels = chart.indicators.valuesAt(pivots).filter((value) => value.value !== null);
    chart.indicators.remove(pivots);

    // A body narrows on both sides of its center: compare all the columns of a few bars.
    const around = [-0.4, -0.25, 0.25, 0.4].map((offset) => inside + offset);
    const candles = columns(around).join();
    chart.applyOptions({ mainSeries: { type: 'volume-candles' } });
    const narrowed = columns(around).join();

    return {
      boxed: differs(pixels(before[0]), pixels(after[0])) >= 0,
      untouched: first < 0,
      outside: { time: chart.data.at(outside)?.time, values: outsideValues, changed },
      london: values.filter((value) => value.key.startsWith('london')).map((value) => value.value),
      levels: levels.map((value) => value.key),
      candles: candles !== narrowed
    };
  });

  expect(result.boxed).toBe(true);
  expect(result.untouched, JSON.stringify(result.outside)).toBe(true);
  expect(result.london.every((value) => typeof value === 'number')).toBe(true);
  expect(result.levels).toEqual(['p', 'r1', 's1', 'r2', 's2', 'r3', 's3', 'r4', 's4', 'r5', 's5']);
  expect(result.candles).toBe(true);
});

test('pans with the mouse and zooms with the wheel', async ({ page }) => {
  const center = await plotCenter(page);
  const before = await page.evaluate(() => window.chart?.timeScale.visibleLogicalRange());
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 120, center.y, { steps: 6 });
  await page.mouse.up();
  const panned = await page.evaluate(() => window.chart?.timeScale.visibleLogicalRange());

  expect(panned?.from ?? 0).toBeLessThan(before?.from ?? 0);

  const spacing = await page.evaluate(() => window.chart?.timeScale.barSpacing());
  await page.mouse.wheel(0, -400);
  await expect
    .poll(() => page.evaluate(() => window.chart?.timeScale.barSpacing()))
    .toBeGreaterThan(spacing ?? 0);
});

test('draws a trend line click by click', async ({ page }) => {
  const center = await plotCenter(page);
  await page.evaluate(() => window.chart?.drawings.startTool('trend-line'));
  await page.mouse.click(center.x - 100, center.y + 40);
  await page.mouse.click(center.x + 60, center.y - 40);

  await expect.poll(() => page.evaluate(() => window.chart?.drawings.list().length)).toBe(1);
  expect(await page.evaluate(() => window.chart?.drawings.list()[0]?.type)).toBe('trend-line');
  expect(await page.evaluate(() => window.chart?.drawings.activeTool())).toBeNull();
  expect(await events(page, 'toolEnd')).toEqual([{ type: 'trend-line', completed: true }]);
});

test('places a long position with a mirrored stop', async ({ page }) => {
  const center = await plotCenter(page);
  await page.evaluate(() => window.chart?.drawings.startTool('long-position'));
  await page.mouse.click(center.x - 120, center.y);
  await page.mouse.click(center.x + 40, center.y - 60);

  await expect.poll(() => page.evaluate(() => window.chart?.drawings.list().length)).toBe(1);
  const position = await page.evaluate(() => window.chart?.drawings.list()[0]);
  const [entry, target, stop] = position?.points ?? [];

  expect(position?.type).toBe('long-position');
  expect(target?.price).toBeGreaterThan(entry?.price ?? Number.POSITIVE_INFINITY);
  // The stop starts mirrored from the target.
  expect((entry?.price ?? 0) - (stop?.price ?? 0)).toBeCloseTo(
    (target?.price ?? 0) - (entry?.price ?? 0),
    6
  );
});

test('resizes one edge of a rectangle by its handle and deletes it with the keyboard', async ({
  page
}) => {
  const [first, second] = await addRectangle(page, 'box');

  if (!first || !second) {
    throw new Error('No rectangle.');
  }

  const inside = await pagePoint(
    page,
    (first.time + second.time) / 2,
    (first.price + second.price) / 2
  );
  await page.mouse.click(inside.x, inside.y);
  expect(await events(page, 'selectionChange')).toEqual([
    { selection: { kind: 'drawing', id: 'box' } }
  ]);

  const edge = await pagePoint(page, (first.time + second.time) / 2, second.price);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 30, edge.y - 40, { steps: 5 });
  await page.mouse.up();

  const [movedFirst, movedSecond] =
    (await page.evaluate(() => window.chart?.drawings.get('box')?.points)) ?? [];
  expect(movedFirst).toEqual(first);
  expect(movedSecond?.time).toBe(second.time);
  expect(movedSecond?.price).toBeGreaterThan(second.price);

  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.chart?.drawings.list().length)).toBe(0);
  expect(await events(page, 'drawingsChange')).toContainEqual({ reason: 'remove', ids: ['box'] });

  // Undo brings it back.
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.chart?.drawings.list().length)).toBe(1);
});

test('watches a line of a drawing with an alert', async ({ page }) => {
  await addRectangle(page, 'box');
  expect(await page.evaluate(() => window.chart?.drawings.levels('box'))).toEqual([
    'top',
    'bottom'
  ]);

  await page.evaluate(() =>
    window.chart?.alerts.add({
      id: 'breakdown',
      trigger: 'cross-down',
      value: { kind: 'drawing', id: 'box', level: 'bottom' }
    })
  );

  expect(await page.evaluate(() => window.chart?.alerts.get('breakdown')?.status)).toBe('active');
  expect(
    await page.evaluate(() => window.chart?.alerts.list().map((alert) => alert.value))
  ).toEqual([{ kind: 'drawing', id: 'box', level: 'bottom' }]);
});

test('writes text in place with the text tool', async ({ page }) => {
  const center = await plotCenter(page);
  await page.evaluate(() => window.chart?.drawings.startTool('text'));
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('#chart textarea')).toBeFocused();
  await page.keyboard.type('Support');
  await page.keyboard.press('Enter');

  await expect(page.locator('#chart textarea')).toHaveCount(0);
  expect(await page.evaluate(() => window.chart?.drawings.list()[0]?.text)).toBe('Support');
});

test('drags an order to a new price', async ({ page }) => {
  const price = await page.evaluate(() => {
    const close = window.chart?.data.last()?.close ?? 0;
    window.chart?.orders.add({ id: 'buy', side: 'buy', price: close, label: 'LIMIT' });
    return close;
  });
  const box = await page.locator('#chart').boundingBox();
  const y = await page.evaluate((value) => window.chart?.priceScale().priceToY(value), price);

  if (!box || y === undefined || y === null) {
    throw new Error('The order line is not visible.');
  }

  await page.mouse.move(box.x + 200, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + y - 30, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => window.chart?.orders.get('buy')?.price))
    .toBeGreaterThan(price);
  const phases = (await events(page, 'orderDrag')).map(
    (event) => (event as { phase: string }).phase
  );
  expect(phases[0]).toBe('start');
  expect(phases.at(-1)).toBe('end');
});

test('touch: a long press shows the crosshair, a quick swipe pans', async ({ page }) => {
  const center = await plotCenter(page);
  await touch(page, 'pointerdown', 1, center.x, center.y);
  await page.waitForTimeout(450);

  expect(await page.evaluate(() => window.chart?.crosshair.get() !== null)).toBe(true);

  await touch(page, 'pointerup', 1, center.x, center.y);
  expect(await page.evaluate(() => window.chart?.crosshair.get())).toBeNull();

  const before = await page.evaluate(() => window.chart?.timeScale.visibleLogicalRange());
  await touch(page, 'pointerdown', 1, center.x, center.y);
  await touch(page, 'pointermove', 1, center.x + 20, center.y);
  await touch(page, 'pointermove', 1, center.x + 60, center.y);
  await page.waitForTimeout(450);
  await touch(page, 'pointermove', 1, center.x + 90, center.y);
  await touch(page, 'pointerup', 1, center.x + 90, center.y);

  expect(await page.evaluate(() => window.chart?.crosshair.get())).toBeNull();
  const after = await page.evaluate(() => window.chart?.timeScale.visibleLogicalRange());
  expect(after?.from ?? 0).toBeLessThan(before?.from ?? 0);
});

test('touch: pinching zooms the time scale', async ({ page }) => {
  const center = await plotCenter(page);
  const spacing = await page.evaluate(() => window.chart?.timeScale.barSpacing() ?? 0);
  await touch(page, 'pointerdown', 1, center.x - 40, center.y);
  await touch(page, 'pointerdown', 2, center.x + 40, center.y);
  await touch(page, 'pointermove', 1, center.x - 80, center.y);
  await touch(page, 'pointermove', 2, center.x + 80, center.y);
  await touch(page, 'pointerup', 1, center.x - 80, center.y);
  await touch(page, 'pointerup', 2, center.x + 80, center.y);

  expect(await page.evaluate(() => window.chart?.timeScale.barSpacing() ?? 0)).toBeGreaterThan(
    spacing * 1.5
  );
});

test('builds every timeframe from the same source bars', async ({ page }) => {
  const shown = (timeframe: string) =>
    page.evaluate((value) => {
      window.chart?.data.setTimeframe(value);
      return {
        source: window.chart?.data.sourceInterval(),
        timeframe: window.chart?.data.timeframe(),
        length: window.chart?.data.length
      };
    }, timeframe);

  const fifteen = await shown('15m');
  const five = await shown('5m');
  const hour = await shown('1h');

  expect(fifteen.source).toEqual({ unit: 'minute', count: 1 });
  expect(hour.source).toEqual({ unit: 'minute', count: 1 });
  expect(five.timeframe).toEqual({ unit: 'minute', count: 5 });
  expect(hour.timeframe).toEqual({ unit: 'hour', count: 1 });
  // 3,000 one-minute bars starting on the hour: 600 of five minutes, 200 of 15, 50 hours.
  expect(five.length).toBe(600);
  expect(fifteen.length).toBe(200);
  expect(hour.length).toBe(50);
});

test('replays from a bar, steps forward and returns to live', async ({ page }) => {
  await page.evaluate(() => {
    const close = window.chart?.data.last()?.close ?? 0;
    window.chart?.orders.add({ id: 'sell', side: 'sell', price: close * 1.01 });
  });
  const length = await page.evaluate(() => window.chart?.data.length ?? 0);
  const start = await page.evaluate(() => {
    const bar = window.chart?.data.at(100);

    if (!bar) {
      throw new Error('No bars.');
    }

    window.chart?.replay.start(bar.time + 14 * 60_000);
    return bar.time;
  });

  expect(await page.evaluate(() => window.chart?.data.length)).toBe(101);
  await page.evaluate(() => window.chart?.replay.step());
  expect(await page.evaluate(() => window.chart?.replay.state()?.time)).toBe(start + 29 * 60_000);
  expect(await page.evaluate(() => window.chart?.data.length)).toBe(102);

  await page.evaluate(() => window.chart?.replay.stop());
  expect(await page.evaluate(() => window.chart?.replay.state())).toBeNull();
  expect(await page.evaluate(() => window.chart?.data.length)).toBe(length);
  // Orders belong to the application, not to the replay.
  expect(await page.evaluate(() => window.chart?.orders.list().length)).toBe(1);
});

test('switches to bars built by a transform and back', async ({ page }) => {
  const transform = (type: string | null) =>
    page.evaluate((value) => {
      window.chart?.transforms.set(value === null ? null : { type: value });
      return window.chart?.transforms.get()?.type ?? null;
    }, type);

  expect(await transform('renko')).toBe('renko');
  expect(await page.evaluate(() => window.chart?.options().mainSeries.type)).toBe('candles');
  expect(await transform('heikin-ashi')).toBe('heikin-ashi');
  expect(await transform(null)).toBeNull();
});

/** Whether every canvas bitmap pixel lands on exactly one screen pixel. */
async function canvasesPixelAligned(page: Page): Promise<boolean[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('#chart canvas')].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return (
        canvas.height > 0 &&
        Math.abs(rect.width * devicePixelRatio - canvas.width) < 0.01 &&
        Math.abs(rect.height * devicePixelRatio - canvas.height) < 0.01
      );
    })
  );
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`at device pixel ratio ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test('stays sharp in a container with a fractional size', async ({ page }) => {
      await page.locator('#chart').evaluate((element) => {
        Object.assign(element.style, {
          right: 'auto',
          bottom: 'auto',
          width: '700.5px',
          height: '400.5px'
        });
      });

      await expect.poll(() => canvasesPixelAligned(page)).toEqual([true, true, true]);
    });
  });
}

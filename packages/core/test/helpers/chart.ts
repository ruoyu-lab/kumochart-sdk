import { afterEach } from 'vitest';
import { allModules, type AllModules } from '../../src/all';
import {
  createChart,
  type Chart as ChartWith,
  type CreateChartOptions
} from '../../src/chart/create-chart';
import type { ChartModule } from '../../src/chart/modules';
import { createBars } from './bars';

/** A chart with every module, as the tests create them. */
export type Chart = ChartWith<AllModules>;

/** The options of a test chart: those of a chart with every module. */
export type TestChartOptions = Omit<CreateChartOptions<AllModules>, 'modules'>;

const charts: Array<{ destroy(): void }> = [];

afterEach(() => {
  charts.splice(0).forEach((chart) => {
    chart.destroy();
  });
  document.body.replaceChildren();
});

/** An 800 × 500 container in the document. */
export function testContainer(width = 800, height = 500): HTMLElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: height });
  document.body.appendChild(container);
  return container;
}

/** A chart with every module in an 800 × 500 container, destroyed after the test. */
export function createTestChart(options?: TestChartOptions, width = 800, height = 500): Chart {
  const chart = createChart(testContainer(width, height), { ...options, modules: allModules() });
  charts.push(chart);
  return chart;
}

/** A chart with the given modules only, destroyed after the test. */
export function createModularChart<const M extends readonly ChartModule[]>(
  options: CreateChartOptions<M>,
  width = 800,
  height = 500
): ChartWith<M> {
  const chart = createChart(testContainer(width, height), options);
  charts.push(chart);
  return chart;
}

export function chartWithBars(count = 200, options?: TestChartOptions): Chart {
  const chart = createTestChart(options);
  chart.data.set(createBars(count));
  return chart;
}

type PointerKind = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/** Dispatches a mouse pointer event at chart coordinates. */
export function pointer(
  chart: ChartWith,
  type: PointerKind,
  x: number,
  y: number,
  init: PointerEventInit = {}
): void {
  chart.element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      ...init
    })
  );
}

/** Presses, moves in steps and releases the mouse. */
export function drag(
  chart: ChartWith,
  from: [number, number],
  to: [number, number],
  steps = 4,
  init: PointerEventInit = {}
): void {
  pointer(chart, 'pointerdown', from[0], from[1], init);

  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    pointer(
      chart,
      'pointermove',
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
      init
    );
  }

  pointer(chart, 'pointerup', to[0], to[1], init);
}

export function click(chart: ChartWith, x: number, y: number): void {
  pointer(chart, 'pointerdown', x, y);
  pointer(chart, 'pointerup', x, y);
}

export function key(chart: ChartWith, keyName: string, init: KeyboardEventInit = {}): void {
  chart.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init })
  );
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

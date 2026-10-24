import { isolated } from '../canvas/canvas';
import type { BarStore } from '../data/bar-store';
import type { BarsView } from '../data/types';
import type { ChartOptions, Theme } from '../options/types';
import type { Frame, PaneFrame } from '../render/frame';
import type { TimeScale } from '../scales/time-scale';
import { fail, runEach } from '../utils/errors';
import { checkObject, checkString } from '../utils/validate';
import type { Chart } from './create-chart';

/** Where a plugin paints: under the series (after the grid) or over them (under the objects). */
export type PluginLayer = 'below' | 'above';

/** A pane as a plugin sees it. Coordinates are relative to the pane's plot. */
export interface PluginPane {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  valueToY(value: number): number;
  yToValue(y: number): number;
  /** Formats a value like the pane's price axis. */
  formatValue(value: number): string;
}

export interface PluginPaintContext {
  /** Clipped to the pane's plot and translated to its top left corner, in CSS pixels. */
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  readonly layer: PluginLayer;
  readonly pane: PluginPane;
  /** The displayed bars. */
  readonly bars: BarsView;
  /** The source bars a running replay has revealed (all of them otherwise). */
  readonly source: BarsView;
  /**
   * Source data after this time is hidden, as a replay hides what has not happened yet;
   * `Infinity` while the chart shows all of it.
   */
  readonly cutoff: number;
  /** Indices of the displayed bars intersecting the plot, or `null`. */
  readonly visible: { readonly from: number; readonly to: number } | null;
  readonly barSpacing: number;
  /** X of the center of the bar at a (continuous) index. */
  indexToX(index: number): number;
  xToIndex(x: number): number;
  /** X of a time, interpolated between bars and extrapolated outside them; `NaN` without bars. */
  timeToX(time: number): number;
  readonly theme: Theme;
  readonly font: { readonly family: string; readonly size: number };
}

/** What `attach()` receives. */
export interface PluginHost {
  readonly chart: Chart;
  readonly bars: BarsView;
  readonly source: BarsView;
  /** Repaints the chart in the next frame, e.g. after the plugin's settings changed. */
  repaint(): void;
}

/**
 * Extends a chart from the outside: paints in the panes and uses the public API, e.g. to
 * register drawing types or listen to events. Add it with `chart.plugins.add()`.
 */
export interface ChartPlugin {
  /** Unique among the chart's plugins. */
  readonly name: string;
  /** Called when the plugin is added. */
  attach?(host: PluginHost): void;
  /** Called when the plugin is removed or the chart is destroyed. */
  detach?(): void;
  /** Called for every pane, once per layer, whenever the chart repaints its series. */
  paint?(context: PluginPaintContext): void;
}

export interface PluginEnvironment {
  readonly bars: BarStore;
  /** What plugins see of the displayed bars. */
  readonly displayed: BarsView;
  readonly source: BarsView;
  readonly timeScale: TimeScale;
  /** Source data after this time is hidden; `Infinity` shows all. */
  cutoff(): number;
  options(): ChartOptions;
  formatValue(pane: PaneFrame, value: number): string;
  repaint(): void;
  chart(): Chart;
}

/** The plugins of one chart, painted in the order they were added. */
export class PluginSet {
  private readonly plugins = new Map<string, ChartPlugin>();

  constructor(private readonly environment: PluginEnvironment) {}

  add(plugin: ChartPlugin): void {
    checkObject('plugin', plugin);
    const name = checkString('plugin.name', plugin.name);

    for (const hook of ['attach', 'detach', 'paint'] as const) {
      if (plugin[hook] !== undefined && typeof plugin[hook] !== 'function') {
        fail(`plugin.${hook} must be a function.`);
      }
    }

    if (this.plugins.has(name)) {
      fail(`A plugin named "${name}" is already added.`);
    }

    const { environment } = this;
    plugin.attach?.({
      chart: environment.chart(),
      bars: environment.displayed,
      source: environment.source,
      repaint: () => {
        environment.repaint();
      }
    });
    this.plugins.set(name, plugin);
    environment.repaint();
  }

  remove(name: string): void {
    const plugin = this.plugins.get(name) ?? fail(`There is no plugin named "${name}".`);
    this.plugins.delete(name);
    this.environment.repaint();
    plugin.detach?.();
  }

  get(name: string): ChartPlugin | null {
    return this.plugins.get(name) ?? null;
  }

  list(): ChartPlugin[] {
    return [...this.plugins.values()];
  }

  /** Paints one layer of a pane; `ctx` is clipped and translated to its plot. */
  paint(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    pane: PaneFrame,
    layer: PluginLayer,
    pixelRatio: number
  ): void {
    const painters = [...this.plugins.values()].filter((plugin) => plugin.paint !== undefined);

    if (painters.length === 0) {
      return;
    }

    const { environment } = this;
    const { bars, timeScale } = environment;
    const options = environment.options();
    const context: PluginPaintContext = {
      ctx,
      pixelRatio,
      layer,
      pane: {
        id: pane.id,
        width: pane.plot.width,
        height: pane.plot.height,
        valueToY: (value) => pane.scale.valueToY(value),
        yToValue: (y) => pane.scale.yToValue(y),
        formatValue: (value) => environment.formatValue(pane, value)
      },
      bars: environment.displayed,
      source: environment.source,
      cutoff: environment.cutoff(),
      visible: frame.visible,
      barSpacing: timeScale.barSpacing,
      indexToX: (index) => timeScale.indexToX(index),
      xToIndex: (x) => timeScale.xToIndex(x),
      timeToX: (time) => timeScale.indexToX(bars.logicalIndexOf(time)),
      theme: options.theme,
      font: { family: options.font.family, size: options.font.size }
    };

    for (const plugin of painters) {
      isolated(ctx, () => {
        plugin.paint?.(context);
      });
    }
  }

  /**
   * Detaches every plugin, e.g. when the chart is destroyed, also those after one that fails to;
   * the first error is thrown once all are detached.
   */
  detachAll(): void {
    const plugins = [...this.plugins.values()];
    this.plugins.clear();
    runEach(plugins.map((plugin) => () => plugin.detach?.()));
  }
}

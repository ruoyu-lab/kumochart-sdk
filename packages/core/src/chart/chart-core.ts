import { BarStore } from '../data/bar-store';
import type { BarInput, TradeInput } from '../data/types';
import type { IntervalInput } from '../feed/interval';
import type { BarTransformInput } from '../feed/transform';
import { EventBus } from '../events/event-bus';
import { Formatter } from '../format/formatter';
import { createDefaultOptions } from '../options/defaults';
import { resolveOptions, type ChartOptionsInput, type OptionsSection } from '../options/resolve';
import type { ChartOptions } from '../options/types';
import { PaneStore } from '../panes/pane-store';
import { font } from '../canvas/canvas';
import { BufferPool } from '../render/contributors';
import { buildFrame, formatPaneValue, type AxisWidths, type Frame } from '../render/frame';
import { coveredTicks, crosshairCovers } from '../render/axis-covers';
import type { CrosshairView } from '../render/cursor-painter';
import { paintMagnifier } from '../render/magnifier';
import { paintScene, repaintAxes } from '../render/scene-painter';
import { FrameScheduler } from '../render/scheduler';
import { Surface, type LayerName } from '../render/surface';
import { TimeMarks } from '../scales/time-ticks';
import { TimeScale, type TimeScaleSettings } from '../scales/time-scale';
import { createSeriesRegistry } from '../series/built-in';
import { SeriesStore } from '../series/series-store';
import { InputController } from '../interaction/input-controller';
import type {
  ChartCommand,
  DragSession,
  HitTarget,
  LegendHit,
  Modifiers,
  Point,
  ToolSession
} from '../interaction/types';
import { ObjectsController } from '../objects/objects-controller';
import type { ObjectContext, Selection } from '../objects/types';
import type { BarChange } from '../data/types';
import { fail, runEach } from '../utils/errors';
import type { ContributorProvider } from '../render/contributors';
import type { PaneFrame } from '../render/frame';
import { Countdown } from './countdown';
import { CrosshairTracker, type ExternalCrosshair } from './crosshair-tracker';
import { crosshairView, type CrosshairState, type LegendProvider } from './cursor';
import { LegendState } from './legend';
import type { Chart } from './create-chart';
import type { ChartEventMap } from './events';
import { createInteractionHost } from './interaction-host';
import { MarketData } from './market-data';
import type { ModuleSpec } from './modules';
import { PricePrecision } from './price-precision';
import { PluginSet, type PluginLayer } from './plugins';
import type { StatePart } from './state';
import { Values } from './values';
import { ViewportWatcher } from './viewport-watcher';

function timeScaleSettings(options: ChartOptions): TimeScaleSettings {
  return {
    minBarSpacing: options.timeScale.minBarSpacing,
    maxBarSpacing: options.timeScale.maxBarSpacing,
    rightOffset: options.timeScale.rightOffset
  };
}

/** Paints a layer of a pane's plot in the scene; `ctx` is clipped and translated to the plot. */
export type ScenePainter = (
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  pane: PaneFrame,
  layer: PluginLayer,
  pixelRatio: number
) => void;

/** Runs a command of the keyboard or the context menu; returns whether it did anything. */
export type CommandHandler = (command: ChartCommand) => boolean;

/** What a module keeps in panes, such as indicators: their ids, and what goes with a pane. */
export interface PaneOccupants {
  occupants(paneId: string): string[];
  /** The pane was removed. */
  removed(paneId: string): void;
}

/**
 * Owns every model of one chart and the single update path: mutations invalidate, the scheduler
 * repaints in the next animation frame, and events are dispatched after each operation completes.
 * Modules join it through its extension points: objects, contributors, legend rows, scene
 * painters, commands, the tool, value sources, state parts and hooks.
 */
export class ChartCore {
  readonly bus = new EventBus<ChartEventMap>();
  readonly bars = new BarStore();
  readonly seriesTypes = createSeriesRegistry();
  readonly series = new SeriesStore(this.seriesTypes, () => this.currentOptions.theme);
  readonly values = new Values(this.bars, this.series);
  readonly surface: Surface;
  readonly timeScale: TimeScale;
  readonly panes: PaneStore;
  readonly objects = new ObjectsController();
  readonly market: MarketData;
  readonly plugins: PluginSet;
  /** What modules draw in the panes, in the order they joined. */
  readonly contributors: ContributorProvider[] = [];
  readonly legendRows: LegendProvider[] = [];
  readonly scenePainters: ScenePainter[] = [];
  readonly commands: CommandHandler[] = [];
  readonly paneOccupants: PaneOccupants[] = [];
  readonly stateParts: StatePart[] = [];
  /** The tool placing an object, such as a drawing, while one is active. */
  tool: (() => ToolSession | null) | null = null;
  /** Hooks of the modules. */
  readonly hooks = {
    /** The displayed bars changed; before `barsChange` is emitted. */
    barsChanged: [] as Array<(change: BarChange) => void>,
    /** The bars were cleared. */
    dataCleared: [] as Array<() => void>,
    /** The chart is being destroyed; its listeners are gone and the gesture in progress ended. */
    destroyed: [] as Array<() => void>
  };
  /** The namespaces the modules add to the public chart, by name. */
  readonly moduleApis: Readonly<Record<string, object>>;
  private readonly input: InputController;
  private currentOptions: ChartOptions;
  private formatterValue: Formatter;
  private marks: TimeMarks;
  private readonly scheduler: FrameScheduler;
  private readonly pool = new BufferPool();
  private frameValue: Frame | null = null;
  private geometryDirty = true;
  private axisWidths: AxisWidths = { right: 0, left: 0 };
  private readonly precision: PricePrecision;
  /** Where a finger places an anchor or drags an object, shown in a loupe. */
  private magnified: Point | null = null;
  private readonly tracker = new CrosshairTracker(this, () => {
    this.invalidateLayers('cursor');
  });
  private readonly viewport = new ViewportWatcher(this);
  /** The time left until the latest bar closes, under the latest price's label. */
  readonly countdown = new Countdown(this);
  /** The pane above the separator under the pointer or being dragged. */
  private hoveredSeparator: string | null = null;
  /** The ticks the crosshair's labels covered as the scene was last painted. */
  private coveredTicks = '';
  /** The legend as last painted, and its row under the pointer. */
  readonly legend = new LegendState();
  /** Source data after this time is hidden (replay); `Infinity` shows all. */
  private cutoffTime = Number.POSITIVE_INFINITY;
  private readonly optionSections: OptionsSection[];
  private destroyed = false;

  constructor(
    readonly view: Window,
    container: HTMLElement,
    options: ChartOptionsInput | undefined,
    modules: readonly ModuleSpec[],
    publicApi: () => Chart
  ) {
    this.optionSections = modules.flatMap((module) => (module.options ? [module.options] : []));
    this.currentOptions = resolveOptions(
      createDefaultOptions(this.optionSections),
      options,
      this.optionSections
    );
    this.market = new MarketData(this.bars, this.series, this.currentOptions);
    this.precision = new PricePrecision(this.market.feed.source);
    this.formatterValue = new Formatter(this.currentOptions.locale, this.currentOptions.timeZone);
    this.marks = new TimeMarks(this.bars, this.formatterValue.clock);
    this.timeScale = new TimeScale(
      timeScaleSettings(this.currentOptions),
      this.currentOptions.timeScale.barSpacing
    );
    this.panes = new PaneStore(
      this.currentOptions.panes.defaultHeight,
      this.currentOptions.priceScale.margins
    );
    this.surface = new Surface(
      view,
      container,
      this.currentOptions.performance.maxPixelRatio,
      () => {
        this.run(() => {
          this.invalidate();
        });
        // Resizing cleared the canvases; repaint before the browser shows them.
        this.scheduler.flush();
      }
    );
    this.scheduler = new FrameScheduler(view, (layers) => {
      this.paint(layers);
    });
    this.plugins = new PluginSet({
      bars: this.bars,
      displayed: this.market.displayed,
      source: this.market.revealed,
      timeScale: this.timeScale,
      cutoff: () => this.cutoffTime,
      options: () => this.currentOptions,
      formatValue: (pane, value) => formatPaneValue(this, pane, value),
      repaint: () => {
        this.invalidateLayers('scene');
      },
      chart: publicApi
    });
    this.input = new InputController(createInteractionHost(this), view);
    this.moduleApis = this.install(modules);
    this.axisWidths = { right: this.currentOptions.priceScale.minWidth, left: 0 };
    const size = this.surface.measureContainer();
    this.surface.resize(size.width, size.height);
    this.surface.setAutoSize(this.currentOptions.autoSize);
    this.surface.watchPixelRatio();
    this.invalidate();
  }

  /** Installs the modules; one that fails takes the chart down, leaving nothing in the page. */
  private install(modules: readonly ModuleSpec[]): Readonly<Record<string, object>> {
    const apis: Record<string, object> = {};

    try {
      for (const module of modules) {
        for (const [name, api] of Object.entries(module.install?.(this) ?? {})) {
          if (Object.hasOwn(apis, name)) {
            fail(`Two modules add chart.${name}.`);
          }

          apis[name] = api;
        }
      }
    } catch (error) {
      this.destroy();
      throw error;
    }

    return apis;
  }

  get options(): ChartOptions {
    return this.currentOptions;
  }

  get formatter(): Formatter {
    return this.formatterValue;
  }

  get barDuration(): number | null {
    return this.market.barDuration();
  }

  barEnd(time: number): number | null {
    return this.market.barEnd(time);
  }

  get timeBased(): boolean {
    return this.market.timeBased();
  }

  /** Source data after this time is hidden, as a replay hides it; `Infinity` shows all. */
  get cutoff(): number {
    return this.cutoffTime;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get replaying(): boolean {
    return this.cutoffTime !== Number.POSITIVE_INFINITY;
  }

  /** The bus with the events of a module, which it emits and the chart's listeners receive. */
  events<EventMap extends object>(): EventBus<EventMap> {
    return this.bus as unknown as EventBus<EventMap>;
  }

  /** The crosshair as of the current geometry. */
  get crosshair(): CrosshairState | null {
    this.tracker.sync(this.frame());
    return this.tracker.value;
  }

  // ─── Operations ────────────────────────────────────────────────────────────

  /** Runs an API operation: events it emits are dispatched once it completes. */
  run<T>(operation: () => T): T {
    if (this.destroyed) {
      fail('The chart has been destroyed.');
    }

    return this.bus.defer(operation);
  }

  /**
   * Applies option changes. Options that fail, such as a calendar the bars cannot be bucketed
   * with, change nothing.
   */
  applyOptions(patch: ChartOptionsInput): void {
    const previous = this.currentOptions;
    const next = resolveOptions(previous, patch, this.optionSections);
    this.seriesTypes.require(next.mainSeries.type);
    const calendar = this.market.tradingCalendar();
    const kept = this.rightEdgeTime();
    // The market data goes first: it is the part that can still fail.
    const rebucketed = this.market.configure(next);
    this.currentOptions = next;

    if (next.locale !== previous.locale || next.timeZone !== previous.timeZone) {
      this.formatterValue = new Formatter(next.locale, next.timeZone);
      this.marks = new TimeMarks(this.bars, this.formatterValue.clock);
    }

    this.timeScale.configure(timeScaleSettings(next));

    if (next.timeScale.barSpacing !== previous.timeScale.barSpacing) {
      this.timeScale.setBarSpacing(next.timeScale.barSpacing);
    }

    this.panes.configure(next.panes.defaultHeight, next.priceScale.margins);

    if (rebucketed) {
      // Bars cut by another calendar, as of another symbol, keep the view where it is in time.
      this.timeScale.setBarCount(this.bars.length, 'reset');
      this.placeRightEdge(kept);
      this.onBarsChanged({ kind: 'reset' });
    } else if (this.market.tradingCalendar() !== calendar) {
      // The same bars, but indicators that follow the calendar, such as VWAP, change.
      this.values.reset();
    }

    if (next.performance.maxPixelRatio !== previous.performance.maxPixelRatio) {
      this.surface.setMaxPixelRatio(next.performance.maxPixelRatio);
    }

    if (next.autoSize !== previous.autoSize) {
      this.surface.setAutoSize(next.autoSize);
    }

    this.precision.invalidate();
    this.invalidate();
    this.bus.emit('optionsChange', { options: next, previous });
  }

  resize(width: number, height: number): void {
    if (this.surface.resize(width, height)) {
      this.invalidate();
    }
  }

  setData(bars: readonly BarInput[], interval: IntervalInput | undefined): void {
    this.changeData('replace', () => {
      this.market.set(bars, interval);
    });
  }

  updateData(bars: readonly BarInput[]): void {
    this.changeData('tail', () => {
      this.market.update(bars);
    });
  }

  addTrades(trades: readonly TradeInput[]): number {
    return this.changeData('tail', () => this.market.addTrades(trades));
  }

  prependData(bars: readonly BarInput[]): number {
    return this.changeData('prepend', () => this.market.prepend(bars));
  }

  clearData(): void {
    this.cutoffTime = Number.POSITIVE_INFINITY;
    this.hooks.dataCleared.forEach((hook) => {
      hook();
    });
    this.changeData('reset', () => {
      this.market.clear();
    });
  }

  setTimeframe(timeframe: IntervalInput | null): void {
    this.changeData('replace', () => {
      this.market.setTimeframe(timeframe);
    });
  }

  setTransform(transform: BarTransformInput | null): void {
    this.changeData('replace', () => {
      this.market.setTransform(transform);
    });
  }

  /**
   * Shows the source data up to `time` (`Infinity` shows all), as a replay does; `follow`
   * scrolls to the latest revealed bar.
   */
  reveal(time: number, follow: boolean): void {
    this.cutoffTime = time;
    this.changeData(follow ? 'reset' : 'tail', () => {
      this.market.setCutoff(time);
    });
  }

  /**
   * Runs a data operation and lets the time scale, alerts and painting follow the bars. Series
   * may change without the main bars, so the chart repaints either way. Bars replaced, as by
   * another symbol, timeframe or transform, keep the view where it is in time unless it follows
   * the latest bar: the time at the right edge of the plot stays there, as far as the bars reach.
   */
  private changeData<T>(mode: 'reset' | 'replace' | 'prepend' | 'tail', operation: () => T): T {
    const revision = this.bars.revision;
    const kept = mode === 'replace' ? this.rightEdgeTime() : null;
    const result = operation();
    const change = this.bars.changesSince(revision);

    if (change) {
      this.timeScale.setBarCount(this.bars.length, mode === 'replace' ? 'reset' : mode);
      this.placeRightEdge(kept);

      this.onBarsChanged(mode === 'prepend' ? { kind: 'reset' } : change);
    } else {
      this.invalidate();
    }

    return result;
  }

  /** Puts a time kept from before the bars changed back at the right edge, as far as they reach. */
  private placeRightEdge(time: number | null): void {
    const index = time === null ? Number.NaN : this.bars.logicalIndexOf(time);

    if (Number.isFinite(index)) {
      this.timeScale.placeRightEdge(index);
    }
  }

  /** The time at the right edge of the plot, or `null` while the view follows the latest bar. */
  private rightEdgeTime(): number | null {
    if (this.timeScale.isFollowing() || this.bars.length === 0 || this.timeScale.plotWidth === 0) {
      return null;
    }

    const time = this.bars.timeOfLogicalIndex(this.timeScale.rightEdge());
    return Number.isFinite(time) ? time : null;
  }

  /** Creates a pane for an indicator or series placed in `new`; returns its id. */
  createAutoPane(owner: string): string {
    let id = owner;

    for (let suffix = 2; this.panes.get(id); suffix += 1) {
      id = `${owner}-${suffix}`;
    }

    this.panes.add({ id }, true);
    return id;
  }

  /** Ids of what is drawn in a pane: series, and what the modules keep there. */
  occupantsOf(paneId: string): string[] {
    return [
      ...this.paneOccupants.flatMap((owner) => owner.occupants(paneId)),
      ...this.series
        .list()
        .filter((entry) => entry.pane === paneId)
        .map((entry) => entry.id)
    ];
  }

  /** Removes a pane together with what the modules keep in it, such as drawings. */
  removePane(paneId: string): void {
    this.panes.remove(paneId);
    this.paneOccupants.forEach((owner) => {
      owner.removed(paneId);
    });
    this.objects.prune();
  }

  /** Removes an automatically created pane once nothing is drawn in it. */
  releasePane(paneId: string): void {
    const pane = this.panes.get(paneId);

    if (pane?.auto && this.occupantsOf(paneId).length === 0) {
      this.removePane(paneId);
    }
  }

  // ─── Crosshair ─────────────────────────────────────────────────────────────

  /** The user scrolls or zooms the bars under the pointer. */
  noteMotion(): void {
    this.tracker.noteMotion();
  }

  /** Marks the legend row and button under the pointer, which shows the row's buttons. */
  setLegendHover(hit: LegendHit | null): void {
    if (this.legend.setHover(hit)) {
      this.invalidateLayers('cursor');
    }
  }

  /** Marks the separator below `above` as under the pointer, or none with `null`. */
  setHoveredSeparator(above: string | null): void {
    if (this.hoveredSeparator !== above) {
      this.hoveredSeparator = above;
      this.invalidateLayers('scene');
    }
  }

  /** Moves the crosshair to a pointer position, or hides it with `null`. */
  setPointer(point: { x: number; y: number } | null): void {
    this.tracker.setPointer(point);
  }

  setExternalCrosshair(crosshair: ExternalCrosshair | null): void {
    this.tracker.setExternal(crosshair);
  }

  /** Shows the touch loupe at a point, or hides it with `null`. */
  magnify(point: Point | null): void {
    this.magnified = this.currentOptions.interaction.touchMagnifier ? point : null;
    this.invalidateLayers('cursor');
  }

  // ─── Objects ───────────────────────────────────────────────────────────────

  objectContext(frame: Frame = this.frame()): ObjectContext {
    return {
      frame,
      bars: this.bars,
      displayed: this.market.displayed,
      source: this.market.revealed,
      timeScale: this.timeScale,
      resolution: this.market.resolution(),
      options: this.currentOptions,
      formatter: this.formatterValue,
      selection: this.objects.selection,
      hovered: this.objects.hovered,
      cutoff: this.cutoffTime,
      scaleOf: (paneId, scaleId) => this.panes.findScale(paneId, scaleId)?.scale ?? null,
      measureText: (text, css) => this.measureText(text, css)
    };
  }

  /** Width of `text` in CSS pixels in a CSS `font`. */
  measureText(text: string, css: string): number {
    const ctx = this.surface.context('cursor');
    ctx.font = css;
    return ctx.measureText(text).width;
  }

  hitTest(point: Point): HitTarget | null {
    return this.objects.hitTest(this.objectContext(), point);
  }

  setHovered(target: HitTarget | null): void {
    if (this.objects.setHovered(target)) {
      this.invalidateLayers('objects');
    }
  }

  beginDrag(target: HitTarget, point: Point, modifiers: Modifiers): DragSession | null {
    return this.objects.beginDrag(this.objectContext(), target, point, modifiers);
  }

  /** Selection set through the API: no event. */
  select(selection: Selection | null): void {
    if (this.objects.select(selection)) {
      this.invalidateLayers('objects');
    }
  }

  /** Selection changed by the user: emits `selectionChange`. */
  selectByUser(selection: Selection | null): void {
    if (this.objects.select(selection)) {
      this.invalidateLayers('objects');
      this.bus.emit('selectionChange', { selection });
    }
  }

  activeTool(): ToolSession | null {
    return this.tool?.() ?? null;
  }

  /** Runs a command of the keyboard or the context menu; returns whether a module did anything. */
  runCommand(command: ChartCommand): boolean {
    return this.commands.some((handler) => handler(command));
  }

  // ─── Frame and painting ────────────────────────────────────────────────────

  /** Marks the geometry stale and repaints every layer. */
  invalidate(): void {
    this.geometryDirty = true;
    this.scheduler.request('scene', 'objects', 'cursor');
  }

  invalidateLayers(...layers: LayerName[]): void {
    this.scheduler.request(...layers);
  }

  /** Runs `task` in the next frame, before it paints, which then paints what the task changed. */
  beforePaint(task: () => void): void {
    this.scheduler.beforePaint(task);
  }

  /** The current frame geometry, rebuilt first when stale. */
  frame(): Frame {
    if (this.geometryDirty || !this.frameValue) {
      // Only a successful build clears the flag, so a throwing formatter is retried next time.
      this.frameValue = this.buildFrame();
      this.geometryDirty = false;
      const { axisWidth, leftAxisWidth } = this.frameValue.layout;
      this.axisWidths = { right: axisWidth, left: leftAxisWidth };
      this.countdown.sync();
      this.viewport.check();
    }

    return this.frameValue;
  }

  /**
   * The frame last built, which the chart shows until it paints again, or the current one before
   * the first is built. Input reads it, as it maps the pointer to what is on screen.
   */
  shownFrame(): Frame {
    return this.frameValue ?? this.frame();
  }

  /** Paints pending layers synchronously. */
  flush(): void {
    this.scheduler.flush();
  }

  private buildFrame(): Frame {
    const ctx = this.surface.context('cursor');
    ctx.font = font(this.currentOptions.font.size, this.currentOptions.font.family);

    return buildFrame(
      {
        options: this.currentOptions,
        formatter: this.formatterValue,
        bars: this.bars,
        timeScale: this.timeScale,
        marks: this.marks,
        panes: this.panes,
        series: this.series,
        contributors: this.contributors,
        values: this.values,
        seriesTypes: this.seriesTypes,
        transform: this.market.transformResolved(),
        live: this.market.livePrice(),
        countdown: this.countdown.text(Date.now()),
        pricePrecision: this.precision.get(this.currentOptions.priceScale.precision),
        measureText: (text) => ctx.measureText(text).width
      },
      { width: this.surface.width, height: this.surface.height },
      this.axisWidths,
      this.pool
    );
  }

  private paint(layers: ReadonlySet<LayerName>): void {
    this.bus.defer(() => {
      const frame = this.frame();
      const ratio = this.surface.pixelRatio;
      const origin = frame.layout.leftAxisWidth;
      const options = this.currentOptions;
      // A layer paints even when one before it failed, as the code of a plugin may; the first
      // error is rethrown once every layer is painted.
      const errors: unknown[] = [];
      const attempt = (paint: () => void) => {
        try {
          paint();
        } catch (error) {
          errors.push(error);
        }
      };
      let crosshair: CrosshairView | null = null;
      attempt(() => {
        this.tracker.sync(frame);
        crosshair = crosshairView(this, frame, this.tracker.value);
      });
      const labelFont = font(options.font.size, options.font.family);
      const covers = crosshairCovers(frame, options, crosshair, (text) =>
        this.measureText(text, labelFont)
      );
      // The ticks under the crosshair's labels are left out: the axes paint again as they change.
      const covered = coveredTicks(frame, options, covers);

      if (layers.has('scene')) {
        attempt(() => {
          this.coveredTicks = covered;
          paintScene(
            this.surface.begin('scene', origin),
            frame,
            options,
            ratio,
            this.timeScale.barSpacing,
            (ctx, pane, layer) => {
              this.plugins.paint(ctx, frame, pane, layer, ratio);
              this.scenePainters.forEach((painter) => {
                painter(ctx, frame, pane, layer, ratio);
              });
            },
            this.hoveredSeparator,
            covers
          );
        });
      } else if (covered !== this.coveredTicks) {
        attempt(() => {
          this.coveredTicks = covered;
          const scene = this.surface.over('scene', origin);
          repaintAxes(scene, frame, options, ratio, this.hoveredSeparator, covers);
        });
      }

      if (layers.has('objects')) {
        attempt(() => {
          this.objects.paint({
            ...this.objectContext(frame),
            ctx: this.surface.begin('objects', origin),
            pixelRatio: ratio
          });
        });
      }

      if (layers.has('cursor')) {
        attempt(() => {
          const cursor = this.surface.begin('cursor', origin);
          this.legend.paint(cursor, this, frame, this.tracker.value, crosshair, ratio);

          if (this.magnified) {
            const sources = [this.surface.canvas('scene'), this.surface.canvas('objects')];
            paintMagnifier(cursor, sources, this.magnified, frame.layout, ratio, options.theme);
          }
        });
      }

      if (errors.length > 0) {
        throw errors[0];
      }
    });
  }

  private onBarsChanged(change: BarChange): void {
    this.hooks.barsChanged.forEach((hook) => {
      hook(change);
    });
    this.invalidate();
    this.bus.emit('barsChange', { change });
  }

  /**
   * Releases everything the chart holds. Every step runs, also those after one that throws, such
   * as a plugin failing to detach; the first error is thrown once the chart is destroyed.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    runEach([
      // Plugins detach while the chart still works, so they can clean up through its API.
      () => {
        this.plugins.detachAll();
      },
      // Listeners are dropped next, so cancelling a gesture in progress notifies nobody.
      () => {
        this.bus.clear();
      },
      () => {
        this.input.destroy();
      },
      () => {
        this.destroyed = true;
        this.scheduler.destroy();
        this.countdown.stop();
        this.tracker.destroy();
      },
      ...this.hooks.destroyed,
      () => {
        this.surface.destroy();
      }
    ]);
  }
}

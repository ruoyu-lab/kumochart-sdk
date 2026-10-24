import { font } from '../canvas/canvas';
import { IconCache } from '../canvas/icon-cache';
import type { BarStore } from '../data/bar-store';
import type { ValueKind } from '../chart/values';
import type { BarChange, ValueSource } from '../data/types';
import type { DragSession, HitTarget, Point } from '../interaction/types';
import { withAlpha } from '../canvas/color';
import type { PaneFrame } from '../render/frame';
import {
  paneOf,
  type ObjectContext,
  type ObjectDomain,
  type ObjectHit,
  type ObjectPaintContext
} from '../objects/types';
import {
  draggedValue,
  hitPriceLines,
  layoutPriceLines,
  paintPriceLines,
  type PriceDragEvent,
  type PriceLineHost,
  type PriceLineLayout,
  type PriceLineView
} from '../objects/price-line';
import { replacement, type Collection } from '../chart/api/collection';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import { checkString } from '../utils/validate';
import type {
  Alert,
  AlertDragEvent,
  AlertInput,
  AlertStatus,
  AlertTrigger,
  AlertTriggerEvent,
  ChannelBounds
} from './types';
import { boundsOf, configInput, parseAlert, type AlertConfig, type ValueReader } from './config';

/** Triggers that look at one evaluation, not at how the values moved since the one before. */
const STATES: readonly AlertTrigger[] = ['above', 'below', 'inside-channel', 'outside-channel'];

export interface AlertsHost extends PriceLineHost {
  readonly reader: ValueReader;
  /** How many of the bars are final, the closed bars `once-per-bar-close` evaluates. */
  settled(): number;
  dragged(event: AlertDragEvent): void;
  triggered(event: Omit<AlertTriggerEvent, 'replay'>): void;
}

interface AlertState {
  config: AlertConfig;
  status: AlertStatus;
  triggeredAt: number | null;
  /** Source and thresholds (one, or a channel's two bounds) at the previous evaluation, and its bar. */
  last: number;
  lastThresholds: number[];
  lastIndex: number;
  /** For `once-per-bar-close`: the last final bar evaluated. */
  closedIndex: number;
}

/** A line an alert draws: at its fixed level, or at a bound of its channel that is a number. */
interface AlertLine {
  readonly id: string;
  /** The index of the bound in the channel's `value`; `null` for the level of a one-value alert. */
  readonly bound: number | null;
  readonly value: number;
}

/** The lines of an alert: its level, or the bounds of its channel that are numbers. */
function linesOf(config: AlertConfig): AlertLine[] {
  const { id, value } = config;

  if (typeof value === 'number') {
    return [{ id, bound: null, value }];
  }

  return Array.isArray(value)
    ? boundsOf(value).flatMap((bound, index): AlertLine[] =>
        typeof bound === 'number' ? [{ id, bound: index, value: bound }] : []
      )
    : [];
}

/** A part of a channel's line names its bound, as `line:1`; buttons act on the whole alert. */
function partOf(part: string, line: AlertLine): string {
  return line.bound === null || part.startsWith('button:') ? part : `${part}:${line.bound}`;
}

/** The bound a part of a line names, `null` for the line of a one-value alert. */
function boundOf(part: string): number | null {
  const bound = /^(?:line|label):(\d)$/.exec(part)?.[1];
  return bound === undefined ? null : Number(bound);
}

function sameCondition(left: AlertConfig, right: AlertConfig): boolean {
  const condition = (config: AlertConfig) =>
    JSON.stringify([config.source, config.trigger, config.value, config.frequency, config.enabled]);
  return condition(left) === condition(right);
}

/** Whether the alert still evaluates; firing a `once` alert ends its evaluation. */
function isActive(state: AlertState): boolean {
  return state.status === 'active';
}

/** The lower and the upper bound of a channel at a bar; one threshold is both. */
type Span = readonly [lower: number, upper: number];

function span(thresholds: readonly number[]): Span {
  return [Math.min(...thresholds), Math.max(...thresholds)];
}

/** From at or below `lastThreshold` to above `threshold`. */
function crossesUp(last: number, lastThreshold: number, value: number, threshold: number): boolean {
  return last <= lastThreshold && value > threshold;
}

/** From at or above `lastThreshold` to below `threshold`. */
function crossesDown(
  last: number,
  lastThreshold: number,
  value: number,
  threshold: number
): boolean {
  return last >= lastThreshold && value < threshold;
}

/** Strictly between the bounds of a channel. */
function inside(value: number, [lower, upper]: Span): boolean {
  return value > lower && value < upper;
}

/** Beyond a bound of a channel. */
function outside(value: number, [lower, upper]: Span): boolean {
  return value < lower || value > upper;
}

/**
 * Whether a trigger is met. Entering a channel is being inside it after being outside or on a
 * bound at the evaluation before, and exiting is being outside after being inside or on a bound:
 * a value leaping over the whole channel does neither.
 */
function meets(
  trigger: AlertTrigger,
  last: number,
  lastBounds: Span,
  value: number,
  bounds: Span
): boolean {
  const [lastLower, lastUpper] = lastBounds;
  const [lower, upper] = bounds;

  switch (trigger) {
    case 'above':
      return value > upper;
    case 'below':
      return value < lower;
    case 'cross-up':
      return crossesUp(last, lastUpper, value, upper);
    case 'cross-down':
      return crossesDown(last, lastLower, value, lower);
    case 'cross':
      return crossesUp(last, lastUpper, value, upper) || crossesDown(last, lastLower, value, lower);
    case 'enter-channel':
      return inside(value, bounds) && !inside(last, lastBounds);
    case 'exit-channel':
      return outside(value, bounds) && !outside(last, lastBounds);
    case 'inside-channel':
      return inside(value, bounds);
    case 'outside-channel':
      return outside(value, bounds);
  }
}

/**
 * The threshold an event reports: the value's, or of a channel the bound the source went
 * through, or nearest to it inside or outside.
 */
function reported(
  trigger: AlertTrigger,
  last: number,
  lastLower: number,
  value: number,
  [lower, upper]: Span
): number {
  if (trigger === 'enter-channel') {
    return last <= lastLower ? lower : upper;
  }

  if (trigger === 'inside-channel') {
    return value - lower <= upper - value ? lower : upper;
  }

  return value < lower ? lower : upper;
}

/** Price alerts: evaluated on every data change, drawn as lines when they watch a fixed level. */
export class AlertsDomain implements ObjectDomain, Collection<AlertInput, Alert> {
  readonly kind = 'alert';
  private states = new Map<string, AlertState>();
  private readonly ids = new IdSequence((id) => this.states.has(id));
  private readonly icons = new IconCache();

  constructor(
    private readonly bars: BarStore,
    private readonly host: AlertsHost
  ) {}

  has(id: string): boolean {
    return this.states.has(id);
  }

  list(): Alert[] {
    return [...this.states.values()].map((state) => this.info(state));
  }

  get(id: string): Alert | null {
    const state = this.states.get(id);
    return state ? this.info(state) : null;
  }

  /** The alerts reading sources of `kind` with `id`, and the sources they read. */
  uses(kind: ValueKind, id: string): Array<{ user: string; source: ValueSource }> {
    return [...this.states.values()].flatMap(({ config }) =>
      [config.source, ...boundsOf(config.value)].flatMap((source) =>
        typeof source !== 'number' && source.kind === kind && 'id' in source && source.id === id
          ? [{ user: config.id, source }]
          : []
      )
    );
  }

  /** Checks the sources of every alert, e.g. against those a chart state brings. */
  verify(check: (source: ValueSource, label: string) => void): void {
    this.states.forEach(({ config }) => {
      [config.source, ...boundsOf(config.value)].forEach((source) => {
        if (typeof source !== 'number') {
          check(source, `alert "${config.id}"`);
        }
      });
    });
  }

  /** Takes the current values as the reference of every alert, e.g. after an input was redefined. */
  rebaseline(): void {
    this.states.forEach((state) => {
      this.baseline(state);
    });
  }

  set(inputs: readonly AlertInput[]): void {
    const configs = replacement('alerts', inputs, this.ids, 'alert', (input, label) =>
      parseAlert(input, this.host.reader, label)
    );
    const next = new Map<string, AlertState>();

    configs.forEach((config, id) => {
      // An alert whose condition is unchanged keeps its status, e.g. when an app re-sends its list.
      const current = this.states.get(id);

      if (current && sameCondition(current.config, config)) {
        current.config = config;
        next.set(id, current);
      } else {
        next.set(id, this.createState(config));
      }
    });

    this.states = next;
  }

  add(input: AlertInput): string {
    const settings = parseAlert(input, this.host.reader);
    const id = input.id === undefined ? this.ids.next('alert') : checkString('alert.id', input.id);

    if (this.states.has(id)) {
      fail(`An alert with id "${id}" already exists.`);
    }

    this.states.set(id, this.createState({ id, ...settings }));
    this.ids.note(id);
    return id;
  }

  update(id: string, patch: Partial<Omit<AlertInput, 'id'>>): void {
    const state = this.require(id);
    const config: AlertConfig = {
      id,
      ...parseAlert({ ...configInput(state.config), ...patch }, this.host.reader)
    };
    // A new condition starts afresh, as `set()` starts an alert whose condition changed.
    const rearm = !sameCondition(state.config, config);
    state.config = config;

    if (!config.enabled) {
      state.status = 'disabled';
    } else if (rearm || state.status === 'disabled') {
      state.status = 'active';
    }

    this.baseline(state);
  }

  remove(id: string): void {
    this.require(id);
    this.states.delete(id);
  }

  /** Arms a triggered alert again. */
  rearm(id: string): void {
    const state = this.require(id);

    if (state.config.enabled) {
      state.status = 'active';
      state.triggeredAt = null;
      this.baseline(state);
    }
  }

  private require(id: string): AlertState {
    return this.states.get(id) ?? fail(`Unknown alert "${id}".`);
  }

  private info(state: AlertState): Alert {
    return { ...state.config, status: state.status, triggeredAt: state.triggeredAt };
  }

  private createState(config: AlertConfig): AlertState {
    const state: AlertState = {
      config,
      status: config.enabled ? 'active' : 'disabled',
      triggeredAt: null,
      last: Number.NaN,
      lastThresholds: [],
      lastIndex: -1,
      closedIndex: -1
    };
    this.baseline(state);
    return state;
  }

  /** The thresholds at bar `index`: the value's, or the two bounds of a channel. */
  private thresholds(config: AlertConfig, index: number): number[] {
    return boundsOf(config.value).map((bound) =>
      typeof bound === 'number' ? bound : this.host.reader.read(bound, index)
    );
  }

  /** Takes the current values as the reference for the next evaluation, without firing. */
  private baseline(state: AlertState): void {
    const { config } = state;
    const last = this.bars.length - 1;
    const closed = this.host.settled() - 1;
    const index = config.frequency === 'once-per-bar-close' ? closed : last;
    state.closedIndex = closed;
    state.lastIndex = index;
    state.last = index >= 0 ? this.host.reader.read(config.source, index) : Number.NaN;
    state.lastThresholds = index >= 0 ? this.thresholds(config, index) : [];
  }

  // ─── Evaluation ────────────────────────────────────────────────────────────

  /** Evaluates the alerts after the bars changed. History loads only re-baseline. */
  evaluate(change: BarChange): void {
    for (const state of this.states.values()) {
      if (change.kind === 'reset' || state.status !== 'active') {
        this.baseline(state);
        continue;
      }

      const last = this.bars.length - 1;

      if (state.config.frequency === 'once-per-bar-close') {
        const settled = this.host.settled();

        for (let index = state.closedIndex + 1; index < settled && isActive(state); index += 1) {
          this.step(state, index);
          state.closedIndex = index;
        }
      } else if (last >= 0) {
        // Bars before the last one evaluated were evaluated: a transform rebuilds its provisional
        // bars, such as Renko bricks, on every tick, and walking them again would compare the
        // latest value with older ones. Bricks it took back leave the last bar to compare.
        const from = Math.min(Math.max(change.from, state.lastIndex), last);

        for (let index = from; index <= last && isActive(state); index += 1) {
          this.step(state, index);
        }
      }
    }
  }

  private step(state: AlertState, index: number): void {
    const { config } = state;
    const value = this.host.reader.read(config.source, index);
    const thresholds = this.thresholds(config, index);
    const time = this.bars.time(index);
    // A source that moves with an object, such as the line of a drawing, is read where it is now
    // at the previous bar too, so moving it never counts as a crossing; only the price does.
    const now = (source: number | ValueSource, previous: number) =>
      typeof source !== 'number' && this.host.reader.movable(source) && state.lastIndex >= 0
        ? this.host.reader.read(source, state.lastIndex)
        : previous;
    const last = now(config.source, state.last);
    const lastThresholds = boundsOf(config.value).map((bound, at) =>
      now(bound, state.lastThresholds[at] ?? Number.NaN)
    );
    const compared = STATES.includes(config.trigger)
      ? [value, ...thresholds]
      : [value, ...thresholds, last, ...lastThresholds];
    const bounds = span(thresholds);
    const lastBounds = span(lastThresholds);
    const fire =
      compared.every(Number.isFinite) &&
      meets(config.trigger, last, lastBounds, value, bounds) &&
      !(config.frequency === 'once-per-bar' && state.triggeredAt === time);

    state.last = value;
    state.lastThresholds = thresholds;
    state.lastIndex = index;

    if (!fire) {
      return;
    }

    state.triggeredAt = time;

    if (config.frequency === 'once') {
      state.status = 'triggered';
    }

    this.host.triggered({
      id: config.id,
      time,
      value,
      threshold: reported(config.trigger, last, lastBounds[0], value, bounds),
      trigger: config.trigger
    });
  }

  // ─── Lines ─────────────────────────────────────────────────────────────────

  /**
   * The lines of the alerts by pane, each view named by its place in `lines`, as an alert can draw
   * two: the bounds of a channel.
   */
  private layouts(context: ObjectContext): {
    panes: Array<{ pane: PaneFrame; layouts: PriceLineLayout[] }>;
    lines: AlertLine[];
  } {
    const byPane = new Map<string, PriceLineView[]>();
    const lines: AlertLine[] = [];
    const { theme } = context.options;

    for (const { config, status } of this.states.values()) {
      const own = config.visible ? linesOf(config) : [];
      const paneId = own.length > 0 ? this.host.reader.paneOf(config.source) : null;
      const pane = paneId === null ? null : paneOf(context.frame, paneId);
      // The level is on the scale of the value it watches, such as volume at the bottom.
      const scale =
        paneId === null ? null : context.scaleOf(paneId, this.host.reader.scaleOf(config.source));

      if (paneId === null || !pane || !scale) {
        continue;
      }

      const color = config.color ?? theme.alert;
      const views = byPane.get(paneId) ?? [];

      for (const line of own) {
        views.push({
          id: String(lines.length),
          y: scale.valueToY(line.value),
          color: status === 'active' ? color : withAlpha(color, 0.45),
          text: config.label ?? '',
          axisText: this.host.formatValue({ ...pane, scale }, line.value),
          buttons: config.buttons,
          lineStyle: config.lineStyle,
          emphasized:
            (context.selection?.kind === 'alert' && context.selection.id === config.id) ||
            (context.hovered?.kind === 'alert' && context.hovered.id === config.id)
        });
        lines.push(line);
      }

      byPane.set(paneId, views);
    }

    const panes = [...byPane.entries()].flatMap(([paneId, views]) => {
      const pane = paneOf(context.frame, paneId);
      return pane
        ? [
            {
              pane,
              layouts: layoutPriceLines(
                views,
                pane.plot.width,
                pane.plot.height,
                context.options.font.size,
                (text, size) => context.measureText(text, font(size, context.options.font.family))
              )
            }
          ]
        : [];
    });
    return { panes, lines };
  }

  hitTest(context: ObjectContext, point: Point): ObjectHit | null {
    const { panes, lines } = this.layouts(context);

    for (const { pane, layouts } of panes) {
      if (point.y < pane.plot.y || point.y >= pane.plot.y + pane.plot.height) {
        continue;
      }

      const hit = hitPriceLines(
        layouts,
        { x: point.x, y: point.y - pane.plot.y },
        context.options.interaction.hitTolerance
      );
      const line = hit ? lines[Number(hit.id)] : undefined;
      const state = line ? this.states.get(line.id) : undefined;

      if (hit && line && state) {
        const draggable = state.config.draggable && !hit.part.startsWith('button:');
        return {
          target: {
            kind: 'alert',
            id: line.id,
            part: partOf(hit.part, line),
            cursor: draggable ? 'ns-resize' : 'pointer',
            draggable
          },
          priority: hit.priority,
          distance: hit.distance
        };
      }
    }

    return null;
  }

  /** Drags the alert's level, or the bound of its channel whose line the target is. */
  beginDrag(context: ObjectContext, target: HitTarget): DragSession | null {
    const state = this.states.get(target.id);
    const bound = boundOf(target.part);
    const line = state ? linesOf(state.config).find((each) => each.bound === bound) : undefined;

    if (!state || !line || !state.config.draggable) {
      return null;
    }

    const paneId = this.host.reader.paneOf(state.config.source);
    const scaleId = this.host.reader.scaleOf(state.config.source);

    if (!paneOf(context.frame, paneId) || !context.scaleOf(paneId, scaleId)) {
      return null;
    }

    const initialPrice = line.value;
    let price = initialPrice;
    const emit = (phase: PriceDragEvent['phase'], value: number) => {
      this.host.dragged({
        id: state.config.id,
        phase,
        price: value,
        initialPrice,
        bound
      });
    };
    const setValue = (value: number) => {
      const current = state.config.value;
      state.config = {
        ...state.config,
        value:
          bound === null || !Array.isArray(current)
            ? value
            : (boundsOf(current).map((each, index) =>
                index === bound ? value : each
              ) as unknown as ChannelBounds)
      };
      // Moving the level is not a crossing: evaluate the next tick against the new level.
      this.baseline(state);
      this.host.repaint();
    };
    emit('start', price);

    return {
      move: (point) => {
        const pane = paneOf(this.host.context().frame, paneId);

        if (!pane || !this.states.has(state.config.id)) {
          return;
        }

        const scale = this.host.context().scaleOf(paneId, scaleId);
        const next = scale ? draggedValue(scale, pane.format, point.y - pane.plot.y) : Number.NaN;

        if (Number.isFinite(next) && next !== price) {
          price = next;
          setValue(price);
          emit('move', price);
        }
      },
      end: () => {
        this.baseline(state);
        emit('end', price);
      },
      cancel: () => {
        setValue(initialPrice);
        emit('cancel', initialPrice);
      }
    };
  }

  paint(context: ObjectPaintContext): void {
    const { ctx } = context;

    for (const { pane, layouts } of this.layouts(context).panes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, pane.plot.y, context.frame.layout.width, pane.plot.height);
      ctx.clip();
      paintPriceLines(
        ctx,
        layouts,
        pane.plot,
        pane.axis,
        {
          fontSize: context.options.font.size,
          fontFamily: context.options.font.family,
          pixelRatio: context.pixelRatio,
          textColor: '#ffffff',
          showAxis: context.options.priceScale.visible
        },
        this.icons
      );
      ctx.restore();
    }
  }
}

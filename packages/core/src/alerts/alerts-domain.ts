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
import type { Collection } from '../chart/api/collection';
import { AlertBook, type AlertBookHost } from './alert-book';
import type { Alert, AlertDragEvent, AlertInput } from './types';
import { boundsOf, type AlertConfig } from './config';

export interface AlertsHost extends PriceLineHost, Omit<AlertBookHost, 'bars'> {
  dragged(event: AlertDragEvent): void;
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

/** Price alerts: evaluated on every data change, drawn as lines when they watch a fixed level. */
export class AlertsDomain implements ObjectDomain, Collection<AlertInput, Alert> {
  readonly kind = 'alert';
  /** The alerts and their evaluation, which the lines show. */
  private readonly book: AlertBook;
  private readonly icons = new IconCache();

  constructor(
    bars: BarStore,
    private readonly host: AlertsHost
  ) {
    this.book = new AlertBook({
      bars,
      reader: host.reader,
      settled: () => host.settled(),
      triggered: (event) => {
        host.triggered(event);
      }
    });
  }

  has(id: string): boolean {
    return this.book.has(id);
  }

  list(): Alert[] {
    return this.book.list();
  }

  get(id: string): Alert | null {
    return this.book.get(id);
  }

  /** The alerts reading sources of `kind` with `id`, and the sources they read. */
  uses(kind: ValueKind, id: string): Array<{ user: string; source: ValueSource }> {
    return this.book.uses(kind, id);
  }

  /** Checks the sources of every alert, e.g. against those a chart state brings. */
  verify(check: (source: ValueSource, label: string) => void): void {
    this.book.verify(check);
  }

  /** Takes the current values as the reference of every alert, e.g. after an input was redefined. */
  rebaseline(): void {
    this.book.rebaseline();
  }

  set(inputs: readonly AlertInput[]): void {
    this.book.set(inputs);
  }

  add(input: AlertInput): string {
    return this.book.add(input);
  }

  update(id: string, patch: Partial<Omit<AlertInput, 'id'>>): void {
    this.book.update(id, patch);
  }

  remove(id: string): void {
    this.book.remove(id);
  }

  /** Arms a triggered alert again. */
  rearm(id: string): void {
    this.book.rearm(id);
  }

  /** Evaluates the alerts after the bars changed. History loads only re-baseline. */
  evaluate(change: BarChange): void {
    this.book.evaluate(change);
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

    for (const { config, status } of this.book.all()) {
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
      const config = line ? this.book.config(line.id) : undefined;

      if (hit && line && config) {
        const draggable = config.draggable && !hit.part.startsWith('button:');
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
    const config = this.book.config(target.id);
    const bound = boundOf(target.part);
    const line = config ? linesOf(config).find((each) => each.bound === bound) : undefined;

    if (!config || !line || !config.draggable) {
      return null;
    }

    const { id } = config;
    const paneId = this.host.reader.paneOf(config.source);
    const scaleId = this.host.reader.scaleOf(config.source);

    if (!paneOf(context.frame, paneId) || !context.scaleOf(paneId, scaleId)) {
      return null;
    }

    const initialPrice = line.value;
    let price = initialPrice;
    const emit = (phase: PriceDragEvent['phase'], value: number) => {
      this.host.dragged({
        id,
        phase,
        price: value,
        initialPrice,
        bound
      });
    };
    const setValue = (value: number) => {
      // Moving the level is not a crossing: the next tick is evaluated against the new level. An
      // alert removed meanwhile, as through the API, has none to move.
      if (this.book.has(id)) {
        this.book.setLevel(id, bound, value);
      }

      this.host.repaint();
    };
    emit('start', price);

    return {
      move: (point) => {
        const pane = paneOf(this.host.context().frame, paneId);

        if (!pane || !this.book.has(id)) {
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
        if (this.book.has(id)) {
          this.book.settle(id);
        }

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

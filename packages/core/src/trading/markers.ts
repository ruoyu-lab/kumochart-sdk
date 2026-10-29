import { checkColor } from '../canvas/color';
import { toTime, type TimeInput } from '../data/time';
import type { DragSession, Point } from '../interaction/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import { applyStroke, font } from '../canvas/canvas';
import { MARKER_SHAPES, shapeDirection, traceShape, type MarkerShape } from '../canvas/shapes';
import {
  HitPriority,
  paneOf,
  type ObjectContext,
  type ObjectDomain,
  type ObjectHit,
  type ObjectPaintContext
} from '../objects/types';
import { replacement, type Collection } from '../chart/api/collection';
import { fail } from '../utils/errors';
import { IdSequence } from '../utils/ids';
import { checkFields, checkNumber, checkOneOf, checkString, fieldsOf } from '../utils/validate';

export type { MarkerShape };
export type MarkerPosition = 'above' | 'below' | 'price';

export interface MarkerInput {
  /** The chart numbers one, `marker-1` on, when it is left out. */
  id?: string;
  time: TimeInput;
  /** Above the bar's high, below its low, or at `price`. */
  position: MarkerPosition;
  /** Required with position `price`. */
  price?: number;
  shape: MarkerShape;
  /**
   * Defaults to the theme's buy color for upward shapes, its sell color for downward ones and its
   * text color for circles and squares.
   */
  color?: string;
  text?: string;
  /** Marker size in CSS pixels. Default 8. */
  size?: number;
  /**
   * The id of another marker to join with a dashed line in that one's color, such as a trade's
   * exit to its entry. The line shows while both are in the data, across bars out of view too.
   */
  link?: string;
}

export interface Marker {
  readonly id: string;
  readonly time: number;
  readonly position: MarkerPosition;
  readonly price: number | null;
  readonly shape: MarkerShape;
  readonly color: string | null;
  readonly text: string;
  readonly size: number;
  readonly link: string | null;
}

const POSITIONS = ['above', 'below', 'price'] as const;
const MARKER_FIELDS = fieldsOf<MarkerInput>({
  id: true,
  time: true,
  position: true,
  price: true,
  shape: true,
  color: true,
  text: true,
  size: true,
  link: true
});
const GAP = 4;

/** A marker but for its id, which the domain gives it. */
type MarkerSettings = Omit<Marker, 'id'>;

function parseMarker(input: MarkerInput, label = 'marker'): MarkerSettings {
  checkFields(label, input, MARKER_FIELDS);
  const position = checkOneOf(`${label}.position`, input.position, POSITIONS);

  if (position === 'price' && input.price === undefined) {
    fail(`${label}.price is required with position "price".`);
  }

  if (input.text !== undefined && typeof input.text !== 'string') {
    fail(`${label}.text must be a string.`);
  }

  return {
    time: toTime(input.time, `${label}.time`),
    position,
    price: input.price === undefined ? null : checkNumber(`${label}.price`, input.price),
    shape: checkOneOf(`${label}.shape`, input.shape, MARKER_SHAPES),
    color: input.color === undefined ? null : checkColor(`${label}.color`, input.color),
    text: input.text ?? '',
    size:
      input.size === undefined ? 8 : checkNumber(`${label}.size`, input.size, { min: 2, max: 40 }),
    link: input.link === undefined ? null : checkString(`${label}.link`, input.link)
  };
}

function markerInput(marker: Marker): MarkerInput {
  return {
    time: marker.time,
    position: marker.position,
    shape: marker.shape,
    text: marker.text,
    size: marker.size,
    ...(marker.price !== null ? { price: marker.price } : {}),
    ...(marker.color !== null ? { color: marker.color } : {}),
    ...(marker.link !== null ? { link: marker.link } : {})
  };
}

interface PlacedMarker {
  readonly marker: Marker;
  /** Center of the shape, plot-relative. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

/**
 * A marker's color: its own, else the theme's buy color for upward shapes, its sell color for
 * downward ones, its text color for the others.
 */
function colorOf(context: ObjectContext, marker: Marker): string {
  const direction = shapeDirection(marker.shape);
  const { theme } = context.options;
  return marker.color ?? (direction > 0 ? theme.buy : direction < 0 ? theme.sell : theme.text);
}

/** First index of `markers`, sorted by time, of a marker at or after `time`. */
function firstAt(markers: readonly Marker[], time: number): number {
  let low = 0;
  let high = markers.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((markers[middle]?.time ?? Number.NaN) < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/**
 * Trade executions and signals pinned to bars of the main pane. A marker sits on the bar its time
 * falls in; one after the period of the latest bar waits for its bar.
 */
export class MarkersDomain implements ObjectDomain, Collection<MarkerInput, Marker> {
  readonly kind = 'marker';
  private markers = new Map<string, Marker>();
  private readonly ids = new IdSequence((id) => this.markers.has(id));
  /** The markers by time, oldest first, to find those of the bars in view; built when needed. */
  private sorted: Marker[] | null = null;

  has(id: string): boolean {
    return this.markers.has(id);
  }

  list(): Marker[] {
    return [...this.markers.values()];
  }

  get(id: string): Marker | null {
    return this.markers.get(id) ?? null;
  }

  set(inputs: readonly MarkerInput[]): void {
    this.markers = replacement('markers', inputs, this.ids, 'marker', parseMarker);
    this.sorted = null;
  }

  add(input: MarkerInput): string {
    const marker = parseMarker(input);
    const id =
      input.id === undefined ? this.ids.next('marker') : checkString('marker.id', input.id);

    if (this.markers.has(id)) {
      fail(`A marker with id "${id}" already exists.`);
    }

    this.markers.set(id, { id, ...marker });
    this.ids.note(id);
    this.sorted = null;
    return id;
  }

  update(id: string, patch: Partial<Omit<MarkerInput, 'id'>>): void {
    const current = this.markers.get(id) ?? fail(`Unknown marker "${id}".`);
    this.markers.set(id, { id, ...parseMarker({ ...markerInput(current), ...patch }) });
    this.sorted = null;
  }

  remove(id: string): void {
    if (!this.markers.delete(id)) {
      fail(`Unknown marker "${id}".`);
    }

    this.sorted = null;
  }

  /**
   * The markers of the bars from `from` to `to`, by time: from the start of the first bar to the
   * end of the last. The latest bar ends a bar spacing after it starts; bars without time, such
   * as Renko bricks, take every later marker in the latest.
   */
  private between(context: ObjectContext, from: number, to: number): readonly Marker[] {
    const { bars } = context;
    const last = bars.length - 1;
    const spacing = context.resolution === 'untimed' ? null : bars.interval();
    const end =
      to < last
        ? bars.time(to + 1)
        : spacing === null
          ? Number.POSITIVE_INFINITY
          : bars.time(last) + spacing;
    this.sorted ??= [...this.markers.values()].sort((left, right) => left.time - right.time);
    return this.sorted.slice(firstAt(this.sorted, bars.time(from)), firstAt(this.sorted, end));
  }

  /**
   * Positions of the markers in view, and of the bar beside it on either side; markers on the
   * same bar stack away from it, the earliest nearest.
   */
  private place(context: ObjectContext): PlacedMarker[] {
    const pane = paneOf(context.frame, MAIN_PANE_ID);
    const visible = context.frame.visible;

    if (!pane || !visible || this.markers.size === 0) {
      return [];
    }

    const { bars, timeScale } = context;
    const from = Math.max(0, visible.from - 1);
    const to = Math.min(bars.length - 1, visible.to + 1);
    const stacks = new Map<string, number>();
    const placed: PlacedMarker[] = [];

    for (const marker of this.between(context, from, to)) {
      // Markers after the revealed data stay hidden, as a replay hides that data.
      if (marker.time > context.cutoff) {
        break;
      }

      const index = bars.indexAt(marker.time);

      // Markers belong to the bar their time falls in, so they sit on its center.
      const x = timeScale.indexToX(index);
      const key = `${index}:${marker.position}`;
      const offset = stacks.get(key) ?? 0;
      stacks.set(key, offset + marker.size * 2 + GAP);
      let y: number;

      if (marker.position === 'above') {
        y = pane.scale.valueToY(bars.high(index)) - GAP - marker.size - offset;
      } else if (marker.position === 'below') {
        y = pane.scale.valueToY(bars.low(index)) + GAP + marker.size + offset;
      } else {
        y = pane.scale.valueToY(marker.price ?? Number.NaN);
      }

      placed.push({ marker, x, y, color: colorOf(context, marker) });
    }

    return placed;
  }

  /**
   * The lines of the markers linked to others, from where each end is: placed in view, or on its
   * bar out of view (unstacked); none with an end not in the data or past the revealed data.
   */
  private links(
    context: ObjectContext,
    placed: readonly PlacedMarker[]
  ): Array<{ from: Point; to: Point; color: string }> {
    const pane = paneOf(context.frame, MAIN_PANE_ID);
    const { bars, timeScale } = context;

    if (!pane || bars.length === 0) {
      return [];
    }

    const shown = new Map(placed.map((each) => [each.marker.id, each]));
    const pointOf = (marker: Marker): Point | null => {
      const at = shown.get(marker.id);

      if (at) {
        return { x: at.x, y: at.y };
      }

      const index = bars.indexAt(marker.time);

      if (index < 0 || marker.time > context.cutoff) {
        return null;
      }

      const y =
        marker.position === 'above'
          ? pane.scale.valueToY(bars.high(index)) - GAP - marker.size
          : marker.position === 'below'
            ? pane.scale.valueToY(bars.low(index)) + GAP + marker.size
            : pane.scale.valueToY(marker.price ?? Number.NaN);
      return { x: timeScale.indexToX(index), y };
    };
    const lines: Array<{ from: Point; to: Point; color: string }> = [];

    for (const marker of this.markers.values()) {
      const other = marker.link === null ? undefined : this.markers.get(marker.link);
      const from = other && pointOf(other);
      const to = other && pointOf(marker);

      if (other && from && to) {
        lines.push({ from, to, color: shown.get(other.id)?.color ?? colorOf(context, other) });
      }
    }

    return lines;
  }

  hitTest(context: ObjectContext, point: Point): ObjectHit | null {
    const pane = paneOf(context.frame, MAIN_PANE_ID);

    if (!pane) {
      return null;
    }

    const local = { x: point.x - pane.plot.x, y: point.y - pane.plot.y };
    let best: ObjectHit | null = null;

    for (const placed of this.place(context)) {
      const distance = Math.hypot(local.x - placed.x, local.y - placed.y);

      if (distance <= placed.marker.size + 3 && (best === null || distance < best.distance)) {
        best = {
          target: {
            kind: 'marker',
            id: placed.marker.id,
            part: 'body',
            cursor: 'pointer',
            draggable: false
          },
          priority: HitPriority.body,
          distance
        };
      }
    }

    return best;
  }

  beginDrag(): DragSession | null {
    return null;
  }

  paint(context: ObjectPaintContext): void {
    const pane = paneOf(context.frame, MAIN_PANE_ID);

    if (!pane) {
      return;
    }

    const { ctx, options } = context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.plot.x, pane.plot.y, pane.plot.width, pane.plot.height);
    ctx.clip();
    ctx.translate(pane.plot.x, pane.plot.y);
    ctx.font = font(options.font.size - 1, options.font.family);
    ctx.textAlign = 'center';
    const placed = this.place(context);

    for (const { from, to, color } of this.links(context, placed)) {
      applyStroke(ctx, color, 1, 'dashed');
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    for (const { marker, x, y, color } of placed) {
      const selected =
        (context.selection?.kind === 'marker' && context.selection.id === marker.id) ||
        (context.hovered?.kind === 'marker' && context.hovered.id === marker.id);
      const size = marker.size * (selected ? 1.25 : 1);
      ctx.fillStyle = color;
      ctx.beginPath();
      traceShape(ctx, marker.shape, x, y, size);
      ctx.fill();

      if (marker.text) {
        const below = marker.position === 'below';
        ctx.textBaseline = below ? 'top' : 'bottom';
        ctx.fillText(marker.text, x, below ? y + size + 2 : y - size - 2);
      }
    }

    ctx.restore();
  }
}

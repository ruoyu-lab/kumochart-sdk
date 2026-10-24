import type { Point } from '../../interaction/types';
import { drawLabel, font } from '../../canvas/canvas';
import { withAlpha } from '../../canvas/color';
import type { BarsView } from '../../data/types';
import { segmentsOf } from '../geometry';
import type {
  Anchors,
  DrawingGeometry,
  DrawingHandle,
  DrawingPaintContext,
  DrawingPoint,
  DrawingTypeDefinition
} from '../types';
import { barsCache, fillArea, LABEL_GAP, shapeHit, strokeDrawing } from './shared';

/** The geometry of a position: its entry, target and stop. */
type Position = DrawingGeometry<Anchors<3>>;

/** Entry, target and stop of a position; target and stop share the end time. */
interface Levels {
  readonly start: number;
  readonly end: number;
  readonly entry: number;
  readonly target: number;
  readonly stop: number;
}

function levelsOf([entry, target, stop]: Anchors<3>): Levels {
  return {
    start: entry.time,
    end: target.time,
    entry: entry.price,
    target: target.price,
    stop: stop.price
  };
}

/** The anchors of `levels`, with the end after the start and each level on its side. */
function anchorsOf(levels: Levels, long: boolean): Anchors<3> {
  const side = long ? 1 : -1;
  const end = Math.max(levels.end, levels.start);
  const target = side * levels.target >= side * levels.entry ? levels.target : levels.entry;
  const stop = side * levels.stop <= side * levels.entry ? levels.stop : levels.entry;
  return [
    { time: levels.start, price: levels.entry },
    { time: end, price: target },
    { time: end, price: stop }
  ];
}

export interface PositionOutcome {
  /** `pending` until a bar reaches the entry. */
  readonly kind: 'target' | 'stop' | 'open' | 'pending';
  /** Time of the bar that reached the entry, which opened the position; `null` while pending. */
  readonly entered: number | null;
  /** Where the position closed, or the last close while it is open. */
  readonly time: number;
  readonly price: number;
}

/**
 * Walks the bars from the start until the end: the first bar reaching the entry opens the
 * position, and the first bar after it reaching the stop or the target closes it, the stop first
 * when a bar reaches both.
 */
export function positionOutcome(bars: BarsView, levels: Levels, long: boolean): PositionOutcome {
  const from = bars.lowerBound(levels.start);
  const to = Math.min(bars.lowerBound(levels.end + 1), bars.length);
  let entered: number | null = null;
  let last: PositionOutcome = {
    kind: 'pending',
    entered,
    time: levels.start,
    price: levels.entry
  };

  for (let index = from; index < to; index += 1) {
    const time = bars.time(index);

    // Which of the entry and the exits a bar reached first is not known: the bar reaching the
    // entry opens the position, the bars after it close it.
    if (entered === null) {
      if (bars.low(index) <= levels.entry && bars.high(index) >= levels.entry) {
        entered = time;
        last = { kind: 'open', entered, time, price: bars.close(index) };
      }

      continue;
    }

    const stopped = long ? bars.low(index) <= levels.stop : bars.high(index) >= levels.stop;
    const won = long ? bars.high(index) >= levels.target : bars.low(index) <= levels.target;

    if (stopped && levels.stop !== levels.entry) {
      return { kind: 'stop', entered, time, price: levels.stop };
    }

    if (won && levels.target !== levels.entry) {
      return { kind: 'target', entered, time, price: levels.target };
    }

    last = { kind: 'open', entered, time, price: bars.close(index) };
  }

  return last;
}

/** The gain of a position closed at `price`, in percent of its entry; negative for a loss. */
function gainPercent(entry: number, price: number, long: boolean): string {
  const gain = entry === 0 ? 0 : (((long ? 1 : -1) * (price - entry)) / Math.abs(entry)) * 100;
  return `${gain > 0 ? '+' : ''}${gain.toFixed(2)}%`;
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly entry: number;
  readonly target: number;
  readonly stop: number;
}

/** The box of the position, `null` while the bars give its times no place. */
function boxOf(geometry: Position): Box | null {
  const [entry, target, stop] = geometry.points;

  if ([entry.x, target.x].some((x) => Number.isNaN(x))) {
    return null;
  }

  return { left: entry.x, right: target.x, entry: entry.y, target: target.y, stop: stop.y };
}

function rect(left: number, right: number, top: number, bottom: number): Point[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
}

function paintLabel(
  context: DrawingPaintContext,
  text: string,
  x: number,
  y: number,
  background: string
): void {
  const { ctx, geometry } = context;
  const height = geometry.style.fontSize + 8;
  ctx.font = font(geometry.style.fontSize, geometry.fontFamily);
  drawLabel(ctx, text, x, Math.min(Math.max(y, height / 2), geometry.height - height / 2), {
    background,
    color: '#ffffff',
    paddingX: 6,
    height,
    align: 'center',
    radius: 3
  });
}

/** Where price went while the position was open, in plot coordinates. */
interface Trade {
  readonly outcome: PositionOutcome;
  /** The bar that opened it, the exit or the last close, and the price there. */
  readonly from: number;
  readonly to: number;
  readonly y: number;
  readonly gain: number;
}

/** Outcomes of the positions, which each frame paints under the bars and over them. */
const outcomeCache = /* @__PURE__ */ barsCache<PositionOutcome>(64);

/**
 * How the position went on the source bars, which charts such as Renko or Heikin-Ashi build
 * theirs from: real prices, in their order within a bar of a longer timeframe. Its last bar is
 * the displayed bar it ends on, every source bar of it.
 */
function outcomeOf(geometry: Position, levels: Levels, long: boolean): PositionOutcome {
  const { bars, source } = geometry;
  const after = bars.lowerBound(levels.end + 1);
  const end = after < bars.length ? bars.time(after) - 1 : Number.POSITIVE_INFINITY;
  const { start, entry, target, stop } = levels;
  return outcomeCache(source, `${start}:${end}:${entry}:${target}:${stop}:${long}`, () =>
    positionOutcome(source, { ...levels, end }, long)
  );
}

function tradeOf(geometry: Position, box: Box, levels: Levels, long: boolean): Trade | null {
  const outcome = outcomeOf(geometry, levels, long);

  if (outcome.entered === null) {
    return null;
  }

  const x = (time: number) => Math.min(Math.max(box.left, xOf(geometry, time)), box.right);
  return {
    outcome,
    from: x(outcome.entered),
    to: x(outcome.time),
    y: geometry.valueToY(outcome.price),
    gain: (long ? 1 : -1) * (outcome.price - levels.entry)
  };
}

/** The zones of the reward and the risk, and a darker band where the position was open. */
function paintZones(context: DrawingPaintContext<Anchors<3>>, long: boolean): void {
  const { ctx, geometry } = context;
  const box = boxOf(geometry);
  const levels = levelsOf(geometry.anchors);

  if (!box) {
    return;
  }

  const { theme } = geometry;
  fillArea(ctx, rect(box.left, box.right, box.entry, box.target), withAlpha(theme.up, 0.16));
  fillArea(ctx, rect(box.left, box.right, box.entry, box.stop), withAlpha(theme.down, 0.16));
  const trade = tradeOf(geometry, box, levels, long);

  if (trade) {
    fillArea(
      ctx,
      rect(trade.from, trade.to, box.entry, trade.y),
      withAlpha(trade.gain >= 0 ? theme.up : theme.down, 0.22)
    );
  }
}

/** The way price went, the entry line and the labels, over the bars. */
function paintPosition(context: DrawingPaintContext<Anchors<3>>, long: boolean): void {
  const { geometry } = context;
  const box = boxOf(geometry);
  const levels = levelsOf(geometry.anchors);

  if (!box) {
    return;
  }

  const { theme, style } = geometry;
  const trade = tradeOf(geometry, box, levels, long);

  if (trade) {
    strokeDrawing(
      context,
      (path) => {
        path.moveTo(trade.from, box.entry);
        path.lineTo(trade.to, trade.y);
      },
      { color: theme.textMuted, lineStyle: 'dashed' }
    );
  }

  strokeDrawing(context, (path) => {
    path.moveTo(box.left, box.entry);
    path.lineTo(box.right, box.entry);
  });

  const center = (box.left + box.right) / 2;
  const fontSize = style.fontSize;
  const reward = Math.abs(levels.target - levels.entry);
  const risk = Math.abs(levels.entry - levels.stop);
  const ratio = risk === 0 ? '—' : (reward / risk).toFixed(2);
  const { texts } = geometry;
  const status = trade
    ? ` · ${trade.outcome.kind === 'open' ? texts.open : trade.outcome.kind === 'target' ? texts.targetHit : texts.stopped} ${gainPercent(levels.entry, trade.outcome.price, long)}`
    : '';
  const statusColor = trade ? (trade.gain >= 0 ? theme.up : theme.down) : style.color;
  paintLabel(context, `${texts.riskReward} ${ratio}${status}`, center, box.entry, statusColor);

  if (context.hovered || context.selected) {
    const offset = fontSize / 2 + 4 + LABEL_GAP;
    const above = (y: number, other: number) => (y <= other ? y - offset : y + offset);
    paintLabel(
      context,
      `${texts.target} ${geometry.formatValue(levels.target)} (${gainPercent(levels.entry, levels.target, long)})`,
      center,
      above(box.target, box.entry),
      theme.up
    );
    paintLabel(
      context,
      `${texts.stop} ${geometry.formatValue(levels.stop)} (${gainPercent(levels.entry, levels.stop, long)})`,
      center,
      above(box.stop, box.entry),
      theme.down
    );
  }
}

/** X of a time through the bar index, which interpolates between bars. */
function xOf(geometry: Position, time: number): number {
  const [entry, target] = geometry.points;
  const [anchor, end] = geometry.anchors;
  const span = geometry.barIndex(end.time) - geometry.barIndex(anchor.time);

  if (span === 0) {
    return entry.x;
  }

  const fraction = (geometry.barIndex(time) - geometry.barIndex(anchor.time)) / span;
  return entry.x + fraction * (target.x - entry.x);
}

function positionHandles(geometry: Position): DrawingHandle[] {
  const box = boxOf(geometry);

  if (!box) {
    return [];
  }

  const center = (box.left + box.right) / 2;
  const across = (y: number): [Point, Point] => [
    { x: box.left, y },
    { x: box.right, y }
  ];
  // The sides stretch the position in time; the edges and the entry line move up and down.
  return [
    { id: 'start', x: box.left, y: box.entry, cursor: 'ew-resize' },
    { id: 'end', x: box.right, y: box.entry, cursor: 'ew-resize' },
    { id: 'target', x: center, y: box.target, cursor: 'ns-resize', line: across(box.target) },
    { id: 'stop', x: center, y: box.stop, cursor: 'ns-resize', line: across(box.stop) },
    {
      id: 'entry',
      x: center,
      y: box.entry,
      cursor: 'ns-resize',
      line: across(box.entry),
      marker: false
    }
  ];
}

function moveHandle(
  anchors: Anchors<3>,
  handle: string,
  to: DrawingPoint,
  long: boolean
): Anchors<3> {
  const levels = levelsOf(anchors);

  switch (handle) {
    case 'start':
      return anchorsOf({ ...levels, start: Math.min(to.time, levels.end) }, long);
    case 'entry': {
      // The entry moves between the stop and the target, which stay where they are.
      const low = Math.min(levels.target, levels.stop);
      const high = Math.max(levels.target, levels.stop);
      return anchorsOf({ ...levels, entry: Math.min(Math.max(to.price, low), high) }, long);
    }
    case 'target':
      return anchorsOf({ ...levels, target: to.price }, long);
    case 'stop':
      return anchorsOf({ ...levels, stop: to.price }, long);
    case 'end':
      return anchorsOf({ ...levels, end: to.time }, long);
    default:
      return anchors;
  }
}

/**
 * A long or short position: place the entry, then the other side and the distance to the
 * target; the stop starts mirrored from the target. The entry line and the target and stop edges
 * are dragged up and down, the sides left and right. The zones, under the bars, show the reward
 * and the risk; the bars after the start show when price reached the entry, and then whether it
 * reached the target or the stop first: the source bars, the real prices behind bars a chart
 * builds, such as Renko bricks or Heikin-Ashi bars.
 */
function position(type: string, long: boolean): DrawingTypeDefinition<Anchors<3>, Anchors<2>> {
  return {
    type,
    points: 3,
    place: 2,
    mainPane: true,
    fields: ['fontSize'],
    // The second click sets the other side, after the first or before it, and the distance to
    // the target; the stop mirrors it.
    complete: ([entry, second]) => {
      const distance = (long ? 1 : -1) * Math.abs(second.price - entry.price);
      return anchorsOf(
        {
          start: Math.min(entry.time, second.time),
          end: Math.max(entry.time, second.time),
          entry: entry.price,
          target: entry.price + distance,
          stop: entry.price - distance
        },
        long
      );
    },
    paintBelow: (context) => {
      paintZones(context, long);
    },
    paint: (context) => {
      paintPosition(context, long);
    },
    hitTest: (geometry, point, tolerance) => {
      const box = boxOf(geometry);

      if (!box) {
        return null;
      }

      // The zones are always painted.
      const area = rect(box.left, box.right, box.target, box.stop);
      return shapeHit(point, segmentsOf(area, true), area, tolerance, true);
    },
    // The labels above the target and below the stop count, so a toolbar does not cover them.
    bounds: (geometry) => {
      const box = boxOf(geometry);

      if (!box) {
        return null;
      }

      const label = geometry.style.fontSize + 8 + LABEL_GAP;
      const top = Math.min(box.target, box.stop) - label;
      const bottom = Math.max(box.target, box.stop) + label;
      return { x: box.left, y: top, width: box.right - box.left, height: bottom - top };
    },
    handles: positionHandles,
    moveHandle: (anchors, handle, to) => moveHandle(anchors, handle, to, long),
    axisMarks: (anchors) => {
      const levels = levelsOf(anchors);
      return {
        prices: [levels.target, levels.entry, levels.stop],
        times: [levels.start, levels.end]
      };
    }
  };
}

export const longPosition = /* @__PURE__ */ position('long-position', true);
export const shortPosition = /* @__PURE__ */ position('short-position', false);

import type { BarStore } from '../data/bar-store';
import type { Bar } from '../data/types';
import type { Formatter } from '../format/formatter';
import { formatValue } from '../format/value-format';
import { textsOf } from '../options/texts';
import type { ChartOptions, LegendItem, Theme } from '../options/types';
import { MAIN_PANE_ID } from '../panes/pane-store';
import type { CrosshairView, CursorView, LegendRow, LegendSegment } from '../render/cursor-painter';
import { paletteColor } from '../render/contributors';
import { formatPaneValue, type Frame, type PaneFrame } from '../render/frame';
import { seriesFormat } from '../render/series-contributor';
import type { TimeScale } from '../scales/time-scale';
import type { Countdown } from './countdown';
import type { SeriesEntry, SeriesStore } from '../series/series-store';

/** Where the crosshair points. */
export interface CrosshairState {
  /** CSS pixel position inside the chart. */
  readonly x: number;
  readonly y: number;
  /** Pane under the pointer, or `null` over the time axis. */
  readonly paneId: string | null;
  /** Logical bar index under the pointer; may lie beyond the data. */
  readonly index: number;
  readonly time: number | null;
  /** Value at `y` in the pane's scale, or `null` outside the panes. */
  readonly price: number | null;
  /** The hovered bar, or `null` outside the data. */
  readonly bar: Bar | null;
}

export interface CursorSources {
  readonly options: ChartOptions;
  readonly formatter: Formatter;
  readonly bars: BarStore;
  readonly timeScale: TimeScale;
  readonly series: SeriesStore;
  /** Rows modules add to the legend, after the main series' and before the series'. */
  readonly legendRows: readonly LegendProvider[];
  /** Fixed length of a bar from the timeframe, when known. */
  readonly barDuration: number | null;
  /** Whether bars stand for periods of time; Renko bricks, for example, do not. */
  readonly timeBased: boolean;
  /** The time left until the latest bar closes. */
  readonly countdown: Pick<Countdown, 'text'>;
}

function paneAt(frame: Frame, y: number): PaneFrame | null {
  return frame.panes.find((pane) => y >= pane.plot.y && y < pane.plot.y + pane.plot.height) ?? null;
}

/**
 * Resolves the crosshair for a pointer position, applying the magnet mode. Its vertical line goes
 * through the center of the bar under the pointer, or through the pointer itself with `snap`
 * `false`.
 */
export function crosshairAt(
  sources: CursorSources,
  frame: Frame,
  x: number,
  y: number,
  snap = true
): CrosshairState | null {
  const { bars, timeScale, options } = sources;

  if (bars.length === 0 || x < 0 || x > frame.layout.plotWidth) {
    return null;
  }

  const index = Math.round(timeScale.xToIndex(x));
  const time = bars.timeOfLogicalIndex(index);
  const bar = bars.bar(index);
  const pane = paneAt(frame, y);
  let price: number | null = null;
  let snappedY = y;

  if (pane) {
    price = pane.scale.yToValue(y - pane.plot.y);

    if (options.crosshair.mode === 'magnet' && pane.id === MAIN_PANE_ID && bar) {
      price = bar.close;
      snappedY = pane.plot.y + pane.scale.valueToY(price);
    }
  }

  return {
    x: snap ? timeScale.indexToX(index) : x,
    y: snappedY,
    paneId: pane?.id ?? null,
    index,
    time: Number.isNaN(time) ? null : time,
    price: price !== null && Number.isFinite(price) ? price : null,
    bar
  };
}

function mainLegend(sources: CursorSources, frame: Frame, index: number): LegendSegment[] {
  const { bars, options, formatter } = sources;
  const bar = bars.bar(index);

  if (!bar) {
    return [];
  }

  const { theme } = options;
  const previousClose = index > 0 ? bars.close(index - 1) : bar.open;
  const change = bar.close - previousClose;
  const color = change >= 0 ? theme.up : theme.down;
  const price = (value: number) => formatValue(formatter, value, frame.priceFormat);
  const percent = previousClose === 0 ? 0 : (change / previousClose) * 100;
  const sign = change >= 0 ? '+' : '';
  const texts = textsOf(options);

  return [
    { text: `${texts.legendOpen} ${price(bar.open)}`, color },
    { text: `${texts.legendHigh} ${price(bar.high)}`, color },
    { text: `${texts.legendLow} ${price(bar.low)}`, color },
    { text: `${texts.legendClose} ${price(bar.close)}`, color },
    { text: `${sign}${price(change)} (${sign}${formatter.number(percent, 2)}%)`, color },
    { text: `${texts.legendVolume} ${formatter.compact(bar.volume)}`, color: theme.textMuted }
  ];
}

/** The left scale's value at chart `y`, formatted like its axis. */
function leftValueText(sources: CursorSources, pane: PaneFrame, y: number): string | null {
  const left = pane.left;
  const value = left?.scale.yToValue(y - pane.plot.y) ?? Number.NaN;
  return left && Number.isFinite(value)
    ? formatPaneValue(sources, { id: pane.id, scale: left.scale, format: left.format }, value)
    : null;
}

/**
 * Rows a module adds to the legend at bar `index`, such as one per indicator; `segments` is only
 * called for the rows the `legend.rows` option lists.
 */
export type LegendProvider = (
  frame: Frame,
  index: number
) => ReadonlyArray<{ readonly item: LegendItem; segments(): LegendSegment[] }>;

/** The legend row under the pointer, and the button there. */
export interface LegendHover {
  readonly kind: LegendItem['kind'];
  readonly id: string;
  readonly button: string | null;
}

function buildLegends(
  sources: CursorSources,
  frame: Frame,
  index: number,
  hover: LegendHover | null
): LegendRow[] {
  const { options, series, formatter } = sources;
  const { theme } = options;
  const listed = options.legend.rows ?? ((item: LegendItem) => item.visible);
  const rows: LegendRow[] = [];
  const add = (item: LegendItem, segments: LegendSegment[]) => {
    const hovered = hover?.kind === item.kind && hover.id === item.id;
    rows.push({
      item,
      segments,
      buttons: hovered ? (options.legend.buttons?.(item) ?? []) : [],
      hoveredButton: hovered ? hover.button : null
    });
  };
  add(
    { kind: 'main', id: 'main', type: null, paneId: MAIN_PANE_ID, visible: true },
    mainLegend(sources, frame, index)
  );

  // The series added to the chart come next to the main series, as compared symbols do.
  const time = sources.bars.time(index);

  series.list().forEach((entry, position) => {
    const item: LegendItem = {
      kind: 'series',
      id: entry.id,
      type: null,
      paneId: entry.pane,
      visible: entry.visible
    };

    if (!listed(item)) {
      return;
    }

    const segments: LegendSegment[] = [{ text: entry.title, color: theme.textMuted }];
    const value = seriesValueAt(entry, time);

    if (value !== null) {
      segments.push({
        text: formatValue(formatter, value.value, seriesFormat(entry, frame.priceFormat)),
        color:
          value.up === null ? seriesColor(entry, theme, position) : value.up ? theme.up : theme.down
      });
    }

    add(item, segments);
  });

  // Then what modules add, such as the indicators.
  for (const provider of sources.legendRows) {
    for (const row of provider(frame, index)) {
      if (listed(row.item)) {
        add(row.item, row.segments());
      }
    }
  }

  return rows;
}

/** The series point at or before `time`: a value, or the close of a bar with its direction. */
function seriesValueAt(
  entry: SeriesEntry,
  time: number
): { value: number; up: boolean | null } | null {
  const store = entry.values ?? entry.bars;
  const at = store ? store.lowerBound(time + 1) - 1 : -1;

  if (at < 0) {
    return null;
  }

  if (entry.values) {
    const value = entry.values.value(at);
    return Number.isNaN(value) ? null : { value, up: null };
  }

  const bars = entry.bars;
  return bars ? { value: bars.close(at), up: bars.close(at) >= bars.open(at) } : null;
}

/** The color a value series is drawn in: its style's, or its palette color. */
function seriesColor(entry: SeriesEntry, theme: Theme, position: number): string {
  const color = entry.style.color;
  return typeof color === 'string' ? color : paletteColor(theme.palette, position + 1);
}

/** What the cursor layer paints: the legends, the countdown and the crosshair's labels. */
export function buildCursorView(
  sources: CursorSources,
  frame: Frame,
  crosshair: CrosshairState | null,
  view: CrosshairView | null,
  now: number,
  hover: LegendHover | null = null
): CursorView {
  const { bars, options } = sources;
  const index = crosshair?.bar && crosshair.index < bars.length ? crosshair.index : bars.length - 1;
  const legends =
    options.legend.visible && bars.length > 0 ? buildLegends(sources, frame, index, hover) : [];
  return { crosshair: view, legends, countdown: sources.countdown.text(now) };
}

/** The crosshair's lines and the texts of its labels. */
export function crosshairView(
  sources: CursorSources,
  frame: Frame,
  crosshair: CrosshairState | null
): CrosshairView | null {
  if (!crosshair) {
    return null;
  }

  const { bars, formatter, options } = sources;
  const interval = sources.timeBased ? (sources.barDuration ?? bars.interval()) : null;
  const pane = crosshair.paneId
    ? frame.panes.find((item) => item.id === crosshair.paneId)
    : undefined;
  const timeText =
    crosshair.time === null
      ? null
      : options.timeScale.formatter
        ? options.timeScale.formatter(crosshair.time, {
            kind: 'crosshair',
            unit: 'minute',
            locale: formatter.locale,
            timeZone: formatter.timeZone
          })
        : formatter.timeCrosshair(crosshair.time, interval);

  return {
    x: crosshair.x,
    y: pane ? crosshair.y : null,
    timeText,
    priceText:
      pane && crosshair.price !== null ? formatPaneValue(sources, pane, crosshair.price) : null,
    leftPriceText: pane?.left ? leftValueText(sources, pane, crosshair.y) : null
  };
}

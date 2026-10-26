import { blend } from '../canvas/color';
import type { BarStore } from '../data/bar-store';
import type { BarsView, ValueAccess } from '../data/types';
import type { Formatter } from '../format/formatter';
import { finerFormat, formatValue, type ValueFormat } from '../format/value-format';
import { computeLayout, type Layout, type Rect } from '../layout/layout';
import type { ChartOptions, LineStyle, TimeUnit } from '../options/types';
import {
  LEFT_SCALE,
  MAIN_PANE_ID,
  RIGHT_SCALE,
  type PaneEntry,
  type PaneStore
} from '../panes/pane-store';
import { emptyExtents, type Extents, type PriceScale } from '../scales/price-scale';
import { buildPriceTicks } from '../scales/price-ticks';
import { buildTimeTicks, type TimeMarks } from '../scales/time-ticks';
import type { TimeScale } from '../scales/time-scale';
import type { SeriesStore } from '../series/series-store';
import type { MarkerShape } from '../canvas/shapes';
import type { PointBuffer, SeriesTypeDefinition } from '../series/types';
import { fail } from '../utils/errors';
import type { Registry } from '../utils/registry';
import {
  collectContributors,
  type BufferPool,
  type Contributor,
  type ContributorProvider
} from './contributors';

const AXIS_PADDING = 10;
/** Absurd labels (e.g. an extreme manual zoom) are clipped rather than squeezing the plot. */
const MAX_AXIS_WIDTH = 160;
const TICK_SPACING_FACTOR = 2.6;

export type PlotJob =
  | {
      readonly kind: 'series';
      readonly definition: SeriesTypeDefinition<object>;
      readonly style: object;
      readonly points: PointBuffer;
      /** Where a value of the series goes, as its points were placed, such as a baseline's base. */
      readonly valueToY: (value: number) => number;
      /** The series' bars, which point `i` is bar `first + i` of; `null` for value series. */
      readonly bars: BarsView | null;
      readonly first: number;
      /** What the transform building the main series' bars reports, for its series type. */
      readonly transform: Readonly<Record<string, unknown>> | null;
    }
  | {
      readonly kind: 'fill';
      /** Colors where `from` is drawn above `to` and where below; the area splits where they cross. */
      readonly above: string;
      readonly below: string;
      readonly from: PointBuffer;
      readonly to: PointBuffer;
      /** Holds each value over its bar's slot, between `level` outputs, instead of joining them. */
      readonly steps: boolean;
    }
  /** A reference line across the plot, such as RSI 70. */
  | { readonly kind: 'reference'; readonly y: number; readonly color: string }
  | {
      readonly kind: 'boxes';
      /** In plot coordinates. */
      readonly boxes: readonly Rect[];
      readonly color: string;
    }
  | {
      readonly kind: 'segments';
      /** A horizontal line through each run of equal values (`value`), `NaN` where there is none. */
      readonly points: PointBuffer;
      readonly color: string;
      readonly lineWidth: number;
      readonly lineStyle: LineStyle;
    }
  | {
      readonly kind: 'columns';
      /** Where each column ends (`value`) and starts (`from`), `NaN` where there is none. */
      readonly points: PointBuffer;
      readonly from: PointBuffer;
      readonly color: string;
      /** Share of the bar spacing. */
      readonly width: number;
      readonly hollow: boolean;
    }
  | {
      readonly kind: 'markers';
      /** Where the markers sit (`value`), `NaN` on bars without one. */
      readonly points: PointBuffer;
      readonly color: string;
      readonly shape: MarkerShape | null;
      /** The text of every marker, or of each point. */
      readonly text: string | readonly string[];
      readonly size: number;
      /** Canvas font of the text. */
      readonly font: string;
    }
  | {
      readonly kind: 'labels';
      readonly labels: readonly PlotLabel[];
      /** Canvas font of the texts. */
      readonly font: string;
      /** From the top of a line of text to the top of the next. */
      readonly lineHeight: number;
    };

/** A text by a point of the plot, over it or under it; lines are split at `\n`. */
export interface PlotLabel {
  /** In plot coordinates. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly above: boolean;
  readonly color: string;
}

export interface PriceLabel {
  readonly y: number;
  readonly text: string;
}

/** The left axis of a pane: its scale, value format and labels. */
export interface AxisFrame {
  readonly axis: Rect;
  readonly scale: PriceScale;
  readonly format: ValueFormat;
  readonly ticks: readonly PriceLabel[];
}

/** A value marked on an axis of a pane, such as the latest value of a series. */
export interface AxisMark {
  readonly side: 'right' | 'left';
  /** In plot coordinates. */
  readonly y: number;
  readonly text: string;
  readonly color: string;
}

export interface PaneFrame {
  readonly id: string;
  readonly entry: PaneEntry;
  readonly plot: Rect;
  /** The right axis, of `scale`. */
  readonly axis: Rect;
  /** The right scale, which drawings, orders and alerts use. */
  readonly scale: PriceScale;
  readonly format: ValueFormat;
  readonly ticks: readonly PriceLabel[];
  /** The left axis, when something in the pane uses the left scale. */
  readonly left: AxisFrame | null;
  /** Values marked on the axes, in the order they are painted. */
  readonly marks: readonly AxisMark[];
  readonly jobs: readonly PlotJob[];
}

export interface TimeLabel {
  readonly x: number;
  readonly text: string;
  /** Of the text. */
  readonly width: number;
  readonly unit: TimeUnit;
}

export interface LatestPrice {
  readonly value: number;
  readonly y: number;
  readonly up: boolean;
  /** Of its line and label: as set, or as the main series colors a rising or falling bar. */
  readonly color: string;
  readonly text: string;
  /** The second line of its label: the time left until the bar closes, or `null` without one. */
  readonly countdown: string | null;
  /**
   * The real-time price where the bars end at another, as Renko bricks, Kagi lines or point &
   * figure columns do, labelled apart from the latest bar's in a lighter color,
   * of a rising bar above that close and of a falling one below it; `null` otherwise.
   */
  readonly live: AxisLabel | null;
}

export interface AxisLabel {
  readonly value: number;
  readonly y: number;
  readonly color: string;
  readonly text: string;
}

export interface Frame {
  readonly layout: Layout;
  /** Integer indices of the bars intersecting the plot, or `null`. */
  readonly visible: { readonly from: number; readonly to: number } | null;
  readonly timeTicks: readonly TimeLabel[];
  readonly panes: readonly PaneFrame[];
  readonly main: PaneFrame;
  readonly priceFormat: ValueFormat;
  readonly latest: LatestPrice | null;
}

export interface FrameSources {
  readonly options: ChartOptions;
  readonly formatter: Formatter;
  readonly bars: BarStore;
  readonly timeScale: TimeScale;
  readonly marks: TimeMarks;
  readonly panes: PaneStore;
  readonly series: SeriesStore;
  /** What modules draw in the panes, such as indicators. */
  readonly contributors: readonly ContributorProvider[];
  /** The values `mainSeries.barColor` reads. */
  readonly values: ValueAccess;
  readonly seriesTypes: Registry<SeriesTypeDefinition<object>>;
  /** What the transform building the main bars reports it builds them with, or `null`. */
  readonly transform: Readonly<Record<string, unknown>> | null;
  /** The price the bars were last built from, when a transform gives up time; `null` otherwise. */
  readonly live: number | null;
  /**
   * The time left until the latest bar closes, under the latest price's label, or `null` without
   * one: see `Countdown.text()`.
   */
  readonly countdown: string | null;
  readonly pricePrecision: number;
  measureText(text: string): number;
}

/** Formats a price-axis value of a pane, honouring percent and indexed scales. */
export function formatPaneValue(
  sources: Pick<FrameSources, 'options' | 'formatter'>,
  pane: Pick<PaneFrame, 'id' | 'scale' | 'format'>,
  value: number
): string {
  const { scale } = pane;
  const display = scale.displayValue(value);
  const mode = scale.mode;
  const custom = sources.options.priceScale.formatter;
  const precision = pane.format.kind === 'decimal' ? pane.format.precision : 0;

  if (custom) {
    return custom(display, { paneId: pane.id, mode, precision, locale: sources.formatter.locale });
  }

  if (mode === 'percent') {
    return `${formatValue(sources.formatter, display, { kind: 'decimal', precision: 2 })}%`;
  }

  if (mode === 'indexed') {
    return formatValue(sources.formatter, display, { kind: 'decimal', precision: 2 });
  }

  return formatValue(sources.formatter, display, pane.format);
}

/** Width an axis needs for `labels`, within the configured minimum and the absurd maximum. */
function axisWidthFor(sources: FrameSources, labels: readonly string[]): number {
  const widest = labels.reduce((max, text) => Math.max(max, sources.measureText(text)), 0);
  return Math.min(
    MAX_AXIS_WIDTH,
    Math.max(sources.options.priceScale.minWidth, Math.ceil(widest + AXIS_PADDING * 2))
  );
}

/** Widths the right and left axes need; the left one only when a pane uses the left scale. */
function measureAxes(
  sources: FrameSources,
  panes: readonly PaneFrame[],
  latest: LatestPrice | null
): AxisWidths {
  if (!sources.options.priceScale.visible) {
    return { right: 0, left: 0 };
  }

  const marked = (side: AxisMark['side']) =>
    panes.flatMap((pane) => pane.marks.flatMap((mark) => (mark.side === side ? [mark.text] : [])));
  const right = [
    ...panes.flatMap((pane) => pane.ticks.map((tick) => tick.text)),
    ...marked('right')
  ];
  const lefts = panes.flatMap((pane) => (pane.left ? [pane.left] : []));
  const latestTexts = latest
    ? [
        latest.text,
        ...(latest.countdown === null ? [] : [latest.countdown]),
        ...(latest.live ? [latest.live.text] : [])
      ]
    : [];
  return {
    right: axisWidthFor(sources, [...right, ...latestTexts]),
    left:
      lefts.length > 0
        ? axisWidthFor(sources, [
            ...lefts.flatMap((left) => left.ticks.map((tick) => tick.text)),
            ...marked('left')
          ])
        : 0
  };
}

export interface AxisWidths {
  readonly right: number;
  readonly left: number;
}

function layoutFor(sources: FrameSources, width: number, height: number, axes: AxisWidths): Layout {
  const { options, panes } = sources;
  return computeLayout({
    width,
    height,
    axisWidth: options.priceScale.visible ? axes.right : 0,
    leftAxisWidth: options.priceScale.visible ? axes.left : 0,
    timeAxisHeight: options.timeScale.visible ? options.timeScale.height : 0,
    separatorHeight: options.panes.separatorHeight,
    minPaneHeight: options.panes.minHeight,
    panes: panes.list().map((entry) => ({
      id: entry.id,
      height: entry.height,
      stretch: entry.id === MAIN_PANE_ID
    }))
  });
}

/** An axis grows at once and shrinks only by a noticeable amount, so it does not jitter. */
function settled(needed: number, current: number): boolean {
  return needed <= current && needed > current - 12;
}

/**
 * Computes the geometry of one frame: layout, visible bars, fitted price scales, ticks and the
 * render-ready points of everything plotted. Painting only reads the result. Coordinates are
 * relative to the left edge of the plots: a left axis lies at negative x.
 */
export function buildFrame(
  sources: FrameSources,
  size: { width: number; height: number },
  hint: AxisWidths,
  pool: BufferPool
): Frame {
  const priceFormat: ValueFormat = { kind: 'decimal', precision: sources.pricePrecision };
  let axes = hint;
  let frame = buildPass(sources, size, axes, priceFormat, pool);

  // The axis widths depend on the labels, which depend on the visible range.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const needed = measureAxes(sources, frame.panes, frame.latest);

    if (settled(needed.right, axes.right) && settled(needed.left, axes.left)) {
      break;
    }

    axes = {
      right: settled(needed.right, axes.right) ? axes.right : needed.right,
      left: settled(needed.left, axes.left) && needed.left > 0 ? axes.left : needed.left
    };
    frame = buildPass(sources, size, axes, priceFormat, pool);
  }

  sources.timeScale.settle();
  pool.sweep();
  return frame;
}

/** Contributors of one pane, grouped by price scale in their order of appearance. */
function byScale(contributors: readonly Contributor[]): Map<string, Contributor[]> {
  const groups = new Map<string, Contributor[]>();

  for (const contributor of contributors) {
    const group = groups.get(contributor.scale);

    if (group) {
      group.push(contributor);
    } else {
      groups.set(contributor.scale, [contributor]);
    }
  }

  return groups;
}

/**
 * Fits a scale to its contributors: the values of those that autoscale, else all they draw. On a
 * percent or indexed scale, those with a base of their own, such as compared symbols, are
 * measured against it, the others against the first contributor's.
 */
function fitScale(scale: PriceScale, group: readonly Contributor[]): void {
  const base = group[0]?.firstValue() ?? null;
  const mode = scale.relativeMode(base);

  if (mode && base !== null) {
    group.forEach((contributor) => {
      contributor.rebase?.(mode, base);
    });
  }

  scale.fit(extentsOf(group), base);
}

/** What a scale fits: the values of its contributors that autoscale, else all they draw. */
function extentsOf(group: readonly Contributor[]): Extents {
  const extents = emptyExtents();
  group.forEach((contributor) => {
    contributor.include(extents, false);
  });

  if (extents.min > extents.max) {
    group.forEach((contributor) => {
      contributor.include(extents, true);
    });
  }

  return extents;
}

function formatOf(group: readonly Contributor[], fallback: ValueFormat): ValueFormat {
  return (
    group.reduce<ValueFormat | null>(
      (current, contributor) => finerFormat(current, contributor.format),
      null
    ) ?? fallback
  );
}

function buildPass(
  sources: FrameSources,
  size: { width: number; height: number },
  axes: AxisWidths,
  priceFormat: ValueFormat,
  pool: BufferPool
): Frame {
  const { options, timeScale, bars, formatter } = sources;
  const layout = layoutFor(sources, size.width, size.height, axes);
  timeScale.setWidth(layout.plotWidth);
  const visible = timeScale.visibleBars();
  const contributors = visible ? collectContributors(sources, visible, priceFormat, pool) : [];
  const panes: PaneFrame[] = [];
  const tickSpacing = options.font.size * TICK_SPACING_FACTOR;

  for (const paneLayout of layout.panes) {
    const entry = sources.panes.require(paneLayout.id);
    const own = contributors.filter((contributor) => contributor.pane === entry.id);
    const groups = byScale(own);
    const scales = new Map<string, PriceScale>();

    for (const [scaleId, group] of groups) {
      const scale = sources.panes.ensureScale(entry.id, scaleId).scale;
      scale.setHeight(paneLayout.plot.height);
      fitScale(scale, group);
      scales.set(scaleId, scale);
    }

    // Without anything on the right scale it shows the left one, scaled by hand or not, which
    // drawings then share.
    const rightGroup = groups.get(RIGHT_SCALE) ?? groups.get(LEFT_SCALE) ?? [];
    const leftScale = scales.get(LEFT_SCALE);

    if (!groups.has(RIGHT_SCALE)) {
      entry.scale.setHeight(paneLayout.plot.height);

      if (leftScale) {
        entry.scale.follow(leftScale);
      } else {
        entry.scale.fit(emptyExtents(), null);
      }
    }

    const jobs: PlotJob[] = [];
    const marks: AxisMark[] = [];
    own.forEach((contributor) => {
      const scale = scales.get(contributor.scale) ?? entry.scale;
      contributor.emit(scale, jobs);
      const side =
        contributor.scale === RIGHT_SCALE
          ? 'right'
          : contributor.scale === LEFT_SCALE
            ? 'left'
            : null;
      const latest = side ? contributor.latest?.() : null;

      if (side && latest) {
        const pane = { id: entry.id, scale, format: contributor.format };
        marks.push({
          side,
          y: scale.valueToY(latest.value),
          text: formatPaneValue(sources, pane, latest.value),
          color: latest.color
        });
      }
    });
    const labelsOf = (scale: PriceScale, format: ValueFormat) => {
      const pane = { id: entry.id, scale, format };
      return buildPriceTicks(scale, tickSpacing).map((tick) => ({
        y: tick.y,
        text: formatPaneValue(sources, pane, tick.value)
      }));
    };
    const format = formatOf(rightGroup, priceFormat);
    const leftGroup = groups.get(LEFT_SCALE);
    const leftFormat = leftGroup ? formatOf(leftGroup, priceFormat) : priceFormat;
    panes.push({
      id: entry.id,
      entry,
      plot: paneLayout.plot,
      axis: paneLayout.axis,
      scale: entry.scale,
      format,
      ticks: labelsOf(entry.scale, format),
      // Measured even before the layout has room for it, so the axis can grow.
      left: leftScale
        ? {
            axis: paneLayout.leftAxis ?? { ...paneLayout.plot, x: 0, width: 0 },
            scale: leftScale,
            format: leftFormat,
            ticks: labelsOf(leftScale, leftFormat)
          }
        : null,
      marks,
      jobs
    });
  }

  // The pane store keeps the main pane first.
  const main = panes[0] ?? fail('The layout has no main pane.');

  const timeTicks = options.timeScale.visible
    ? buildTimeTicks(timeScale, bars, sources.marks, sources.measureText('00:00') + 24)
        .map((tick) => {
          const text = options.timeScale.formatter
            ? options.timeScale.formatter(tick.time, {
                kind: 'axis',
                unit: tick.unit,
                locale: formatter.locale,
                timeZone: formatter.timeZone
              })
            : formatter.timeTick(tick.time, tick.unit);
          return { x: tick.x, unit: tick.unit, text, width: sources.measureText(text) };
        })
        // Labels that would be cut off at the plot edges are dropped rather than clipped.
        .filter(
          (tick) => tick.x - tick.width / 2 >= 0 && tick.x + tick.width / 2 <= layout.plotWidth
        )
    : [];

  return {
    layout,
    visible,
    timeTicks,
    panes,
    main,
    priceFormat,
    latest: latestPrice(sources, main)
  };
}

/** How strongly the label of the real-time price takes its color, over the background. */
const LIVE_ALPHA = 0.4;

function latestPrice(sources: FrameSources, main: PaneFrame): LatestPrice | null {
  const { bars, options } = sources;

  if (bars.length === 0) {
    return null;
  }

  const last = bars.length - 1;
  const definition = sources.seriesTypes.require(options.mainSeries.type);
  const value =
    definition.input === 'ohlc' ? bars.close(last) : bars.price(last, options.mainSeries.source);
  const y = main.scale.valueToY(value);
  const up = bars.close(last) >= bars.open(last);
  const style = options.mainSeries.styles[options.mainSeries.type];
  // Bars of their own colors, as candles have; lines have one color, not rising or falling.
  const bar = style && 'upColor' in style ? style : undefined;
  const { theme } = options;
  const colorOf = (rising: boolean) =>
    options.latestPrice.color ??
    (rising ? (bar?.upColor ?? theme.up) : (bar?.downColor ?? theme.down));
  const live = sources.live;

  return {
    value,
    y,
    up,
    color: colorOf(up),
    text: formatPaneValue(sources, main, value),
    countdown: sources.countdown,
    live:
      live === null || live === value
        ? null
        : {
            value: live,
            y: main.scale.valueToY(live),
            color: blend(colorOf(live >= value), theme.background, LIVE_ALPHA),
            text: formatPaneValue(sources, main, live)
          }
  };
}

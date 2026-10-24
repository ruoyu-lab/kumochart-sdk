import { toTime, type TimeInput } from '../../data/time';
import type { LogicalRange, ViewAlign } from '../../scales/time-scale';
import { checkNumber, checkOneOf } from '../../utils/validate';
import type { ChartCore } from '../chart-core';
import type { TimeRange } from '../events';

const ALIGNS = ['left', 'center', 'right'] as const;
const ZOOM_STEP = 1.25;

export interface TimeScaleApi {
  /** Times of the first and last visible bars, or `null` when none is visible. */
  visibleRange(): TimeRange | null;
  /** Shows the bars between two times. */
  setVisibleRange(range: { from: TimeInput; to: TimeInput }): void;
  /** Logical indices at the left and right edges of the plot, or `null` without bars. */
  visibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
  scrollToTime(time: TimeInput, align?: ViewAlign): void;
  scrollToIndex(index: number, align?: ViewAlign): void;
  /** Moves back to the latest bar, at the configured right offset. */
  scrollToRealTime(): void;
  /** Whether the latest bar is in view, so new bars scroll into view as they arrive. */
  isFollowing(): boolean;
  fitContent(): void;
  /**
   * Widens the bars, keeping the latest bar in place while the view follows it, else the bar in
   * the middle of the plot.
   */
  zoomIn(): void;
  /** Narrows the bars, around the same bar as `zoomIn()`. */
  zoomOut(): void;
  /** Distance between the centers of two bars, in CSS pixels. */
  barSpacing(): number;
  setBarSpacing(spacing: number): void;
  /** Restores the configured bar spacing and the real-time position. */
  reset(): void;
  /** x of the bar at `time` (interpolated between bars), or `null` without data. */
  timeToX(time: TimeInput): number | null;
  xToTime(x: number): number | null;
  indexToX(index: number): number | null;
  /** Logical index at `x`; fractional between bar centers. */
  xToIndex(x: number): number | null;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function createTimeScaleApi(core: ChartCore): TimeScaleApi {
  const scale = core.timeScale;

  const mutate = (operation: () => void) => {
    core.run(() => {
      core.frame();
      operation();
      core.invalidate();
    });
  };

  return {
    visibleRange: () => {
      core.frame();
      const visible = scale.visibleBars();
      return visible
        ? { from: core.bars.time(visible.from), to: core.bars.time(visible.to) }
        : null;
    },
    setVisibleRange: ({ from, to }) => {
      const start = core.bars.logicalIndexOf(toTime(from, 'range.from'));
      const end = core.bars.logicalIndexOf(toTime(to, 'range.to'));

      if (Number.isFinite(start) && Number.isFinite(end)) {
        mutate(() => {
          scale.setLogicalRange({
            from: Math.min(start, end) - 0.5,
            to: Math.max(start, end) + 0.5
          });
        });
      }
    },
    visibleLogicalRange: () => {
      core.frame();
      return core.bars.length > 0 ? scale.logicalRange() : null;
    },
    setVisibleLogicalRange: (range) => {
      checkNumber('range.from', range.from);
      checkNumber('range.to', range.to);
      mutate(() => {
        scale.setLogicalRange(range);
      });
    },
    scrollToTime: (time, align = 'center') => {
      const index = core.bars.logicalIndexOf(toTime(time));
      checkOneOf('align', align, ALIGNS);

      if (Number.isFinite(index)) {
        mutate(() => {
          scale.scrollToIndex(index, align);
        });
      }
    },
    scrollToIndex: (index, align = 'center') => {
      checkNumber('index', index);
      checkOneOf('align', align, ALIGNS);
      mutate(() => {
        scale.scrollToIndex(index, align);
      });
    },
    scrollToRealTime: () => {
      mutate(() => {
        scale.scrollToRealTime();
      });
    },
    isFollowing: () => scale.isFollowing(),
    fitContent: () => {
      mutate(() => {
        scale.fitContent();
      });
    },
    zoomIn: () => {
      mutate(() => {
        scale.zoom(ZOOM_STEP, scale.zoomAnchor(null));
      });
    },
    zoomOut: () => {
      mutate(() => {
        scale.zoom(1 / ZOOM_STEP, scale.zoomAnchor(null));
      });
    },
    barSpacing: () => scale.barSpacing,
    setBarSpacing: (spacing) => {
      checkNumber('spacing', spacing, { min: 0, exclusiveMin: true });
      mutate(() => {
        scale.setBarSpacing(spacing);
      });
    },
    reset: () => {
      mutate(() => {
        scale.reset(core.options.timeScale.barSpacing);
      });
    },
    // Coordinates are from the chart's left edge; the scale counts from the plots' left edge.
    timeToX: (time) => {
      const origin = core.frame().layout.leftAxisWidth;
      return finiteOrNull(scale.indexToX(core.bars.logicalIndexOf(toTime(time))) + origin);
    },
    xToTime: (x) => {
      checkNumber('x', x);
      const origin = core.frame().layout.leftAxisWidth;
      return finiteOrNull(core.bars.timeOfLogicalIndex(scale.xToIndex(x - origin)));
    },
    indexToX: (index) => {
      checkNumber('index', index);
      const origin = core.frame().layout.leftAxisWidth;
      return core.bars.length > 0 ? scale.indexToX(index) + origin : null;
    },
    xToIndex: (x) => {
      checkNumber('x', x);
      const origin = core.frame().layout.leftAxisWidth;
      return core.bars.length > 0 ? scale.xToIndex(x - origin) : null;
    }
  };
}

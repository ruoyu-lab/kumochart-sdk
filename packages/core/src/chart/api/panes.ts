import type { PriceScaleMode } from '../../options/types';
import type { ScaleMargins } from '../../options/types';
import { MAIN_PANE_ID, type Pane, type PaneInput } from '../../panes/pane-store';
import type { PriceRange } from '../../scales/price-scale';
import { fail } from '../../utils/errors';
import { checkNumber } from '../../utils/validate';
import type { ChartCore } from '../chart-core';

/**
 * One price scale of a pane. Coordinates are relative to the chart's top-left corner. A right
 * scale with nothing of its own in a pane where the left one has something shows the left one:
 * setting its range or auto-scaling it changes the left one.
 */
export interface PriceScaleApi {
  /** Visible value range, or `null` when nothing is drawn in the pane. */
  range(): PriceRange | null;
  /** Fixes the range and turns auto-scaling off. */
  setRange(range: PriceRange): void;
  /** Turns auto-scaling back on. */
  autoScale(): void;
  isAutoScale(): boolean;
  /** The configured mode; percent/indexed/log fall back to normal while their base is unusable. */
  mode(): PriceScaleMode;
  setMode(mode: PriceScaleMode): void;
  isInverted(): boolean;
  setInverted(inverted: boolean): void;
  /** Space above and below the auto-scaled data, as fractions of the pane. */
  margins(): ScaleMargins;
  /** Sets the margins of this scale, e.g. `{ top: 0.8, bottom: 0 }` for volume at the bottom; `null` follows `priceScale.margins`. */
  setMargins(margins: ScaleMargins | null): void;
  priceToY(price: number): number | null;
  yToPrice(y: number): number | null;
}

export interface PanesApi {
  /** Panes from top to bottom; the main pane comes first. */
  list(): Pane[];
  /** The pane of an id, or `null`. */
  get(id: string): Pane | null;
  /** Adds a pane below the others and returns its id. */
  add(pane: PaneInput): string;
  /** Changes a pane's title or height. Throws for an unknown id. */
  update(id: string, patch: Omit<PaneInput, 'id'>): void;
  /**
   * Removes a pane and its drawings. Remove its indicators and series first; the main pane cannot
   * be removed. Throws for an unknown id.
   */
  remove(id: string): void;
  /** Moves a pane to position `index` (the main pane stays at 0). */
  move(id: string, index: number): void;
}

export function createPriceScaleApi(
  core: ChartCore,
  paneId: string,
  scaleId: string
): PriceScaleApi {
  // Reading a scale nothing uses yet reads its defaults, without creating it.
  const found = () => core.panes.findScale(paneId, scaleId);
  const entry = () => core.panes.ensureScale(paneId, scaleId);
  const plotTop = () => {
    const pane = core.frame().panes.find((item) => item.id === paneId);
    return pane?.plot.y ?? fail(`Unknown pane "${paneId}".`);
  };
  const mutate = (operation: () => void) => {
    core.run(() => {
      core.frame();
      operation();
      core.invalidate();
    });
  };

  return {
    range: () => {
      core.frame();
      return found()?.scale.valueRange() ?? null;
    },
    setRange: (range) => {
      checkNumber('range.min', range.min);
      checkNumber('range.max', range.max);

      if (!(range.max > range.min)) {
        fail(`range.max (${range.max}) must be greater than range.min (${range.min}).`);
      }

      mutate(() => {
        if (!entry().scale.lead.setValueRange(range)) {
          fail(
            `The range ${range.min}..${range.max} cannot be shown in ${entry().scale.mode} mode.`
          );
        }
      });
    },
    autoScale: () => {
      mutate(() => {
        found()?.scale.lead.resetAutoScale();
      });
    },
    isAutoScale: () => found()?.scale.lead.autoScale ?? true,
    mode: () => found()?.mode ?? 'normal',
    setMode: (mode) => {
      mutate(() => {
        core.panes.setScaleMode(paneId, scaleId, mode);
      });
    },
    isInverted: () => found()?.invert ?? false,
    setInverted: (inverted) => {
      mutate(() => {
        core.panes.setScaleInverted(paneId, scaleId, inverted);
      });
    },
    margins: () => ({ ...(found()?.margins ?? core.options.priceScale.margins) }),
    setMargins: (margins) => {
      mutate(() => {
        core.panes.setScaleMargins(paneId, scaleId, margins);
      });
    },
    priceToY: (price) => {
      checkNumber('price', price);
      const top = plotTop();
      const y = found()?.scale.valueToY(price) ?? Number.NaN;
      return Number.isFinite(y) ? top + y : null;
    },
    yToPrice: (y) => {
      checkNumber('y', y);
      const top = plotTop();
      const price = found()?.scale.yToValue(y - top) ?? Number.NaN;
      return Number.isFinite(price) ? price : null;
    }
  };
}

export function createPanesApi(core: ChartCore): PanesApi {
  return {
    list: () => core.panes.list().map((entry) => core.panes.info(entry)),
    get: (id) => {
      const entry = core.panes.get(id);
      return entry ? core.panes.info(entry) : null;
    },
    add: (pane) =>
      core.run(() => {
        const { id } = core.panes.add(pane, false);
        core.invalidate();
        return id;
      }),
    update: (id, patch) => {
      core.run(() => {
        core.panes.update(id, patch);
        core.invalidate();
      });
    },
    remove: (id) => {
      core.run(() => {
        if (id === MAIN_PANE_ID) {
          fail('The main pane cannot be removed.');
        }

        const occupants = core.occupantsOf(id);

        if (occupants.length > 0) {
          fail(`Pane "${id}" still contains ${occupants.map((item) => `"${item}"`).join(', ')}.`);
        }

        core.removePane(id);
        core.invalidate();
      });
    },
    move: (id, index) => {
      core.run(() => {
        core.panes.move(id, index);
        core.invalidate();
      });
    }
  };
}

import type { PriceScaleMode } from '../options/types';

export interface PriceRange {
  min: number;
  max: number;
}

/** Value extents of everything drawn in a pane; `minPositive` serves logarithmic scales. */
export interface Extents {
  min: number;
  max: number;
  minPositive: number;
}

export function emptyExtents(): Extents {
  return {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    minPositive: Number.POSITIVE_INFINITY
  };
}

export function includeValue(extents: Extents, value: number): void {
  if (!Number.isFinite(value)) {
    return;
  }

  if (value < extents.min) {
    extents.min = value;
  }

  if (value > extents.max) {
    extents.max = value;
  }

  if (value > 0 && value < extents.minPositive) {
    extents.minPositive = value;
  }
}

export interface PriceScaleSettings {
  mode: PriceScaleMode;
  invert: boolean;
  margins: { top: number; bottom: number };
}

type Transform =
  | { readonly mode: 'normal' }
  | { readonly mode: 'log' }
  | { readonly mode: 'percent'; readonly base: number }
  | { readonly mode: 'indexed'; readonly base: number };

const NORMAL: Transform = { mode: 'normal' };

/** Largest log10 magnitude a manual logarithmic range may reach. */
const LOG_LIMIT = 30;

/** Whether a manual range is reasonable to show: finite, ordered and not absurdly zoomed. */
function isShowable(range: PriceRange, mode: PriceScaleMode): boolean {
  const span = range.max - range.min;

  if (!Number.isFinite(span) || !(span > 0)) {
    return false;
  }

  if (mode === 'log') {
    return range.min > -LOG_LIMIT && range.max < LOG_LIMIT && span > 1e-6;
  }

  const magnitude = Math.max(1, Math.abs(range.min), Math.abs(range.max));
  return span > magnitude * 1e-9 && span < magnitude * 1e9;
}

function resolveTransform(mode: PriceScaleMode, base: number | null, extents: Extents): Transform {
  switch (mode) {
    case 'normal':
      return NORMAL;
    case 'log':
      return Number.isFinite(extents.minPositive) ? { mode } : NORMAL;
    case 'percent':
      return base !== null && base !== 0 ? { mode, base } : NORMAL;
    case 'indexed':
      return base !== null && base > 0 ? { mode, base } : NORMAL;
  }
}

/**
 * Maps values to y coordinates of one pane. Values are first converted into "scale space": the
 * value itself, its base-10 logarithm, or its change relative to the first visible value.
 * Auto-scaling fits the visible extents; manual scaling keeps a fixed range in scale space.
 *
 * Percent and indexed modes need a non-zero (indexed: positive) base value and logarithmic mode
 * needs positive data; otherwise the scale works in normal mode, reported by {@link mode}.
 */
export class PriceScale {
  private height = 0;
  private settings: PriceScaleSettings;
  private transform: Transform = NORMAL;
  /**
   * A manual range, in the scale space of the mode it was set in. While the scale temporarily
   * works in another mode (e.g. log without positive data) it auto-scales and keeps the range.
   */
  private manual: { readonly range: PriceRange; readonly mode: PriceScaleMode } | null = null;
  private range: PriceRange | null = null;
  /** The scale this one shows, as a right scale with nothing of its own shows the left one. */
  private leader: PriceScale | null = null;

  constructor(settings: PriceScaleSettings) {
    this.settings = settings;
  }

  /** The mode in effect for the last fit. */
  get mode(): PriceScaleMode {
    return this.transform.mode;
  }

  get autoScale(): boolean {
    return this.manual === null;
  }

  /**
   * The scale whose range this one shows: itself, or the one it follows. Scaling and moving the
   * range by hand goes to it.
   */
  get lead(): PriceScale {
    return this.leader ?? this;
  }

  /** Whether higher values are drawn lower. */
  get inverted(): boolean {
    return this.lead.settings.invert;
  }

  get plotHeight(): number {
    return this.height;
  }

  configure(settings: PriceScaleSettings): void {
    if (settings.mode !== this.settings.mode) {
      this.manual = null;
    }

    this.settings = settings;
  }

  setHeight(height: number): void {
    this.height = Math.max(0, height);
  }

  /**
   * The mode measuring values against a base that the scale takes as it is fitted with `base`:
   * percent or indexed, or `null` when it measures them as they are.
   */
  relativeMode(base: number | null): 'percent' | 'indexed' | null {
    const { mode } = resolveTransform(this.settings.mode, base, emptyExtents());
    return mode === 'percent' || mode === 'indexed' ? mode : null;
  }

  /** Fits the scale to the visible extents. `base` is the first visible value of the pane. */
  fit(extents: Extents, base: number | null): void {
    const transform = resolveTransform(this.settings.mode, base, extents);
    this.leader = null;
    this.transform = transform;

    if (this.manual?.mode === transform.mode) {
      this.range = this.manual.range;
      return;
    }

    const low = this.toScale(transform.mode === 'log' ? extents.minPositive : extents.min);
    const high = this.toScale(extents.max);

    if (low === null || high === null || high < low) {
      this.range = null;
      return;
    }

    const flat = high === low;
    // A flat line sits in the middle of a range of a hundredth of its value, or of 1 at zero,
    // where a hundredth of it would leave no room for ticks apart.
    const spread = flat ? (high === 0 ? 1 : Math.max(Math.abs(high) * 0.01, 1e-6)) : high - low;
    const { top, bottom } = this.settings.margins;
    const total = spread / (1 - top - bottom);
    const pad = flat ? spread / 2 : 0;
    this.range = {
      min: low - pad - bottom * total,
      max: high + pad + top * total
    };
  }

  /** Shows what `leader` shows, as fitted for this frame, for a scale with nothing of its own. */
  follow(leader: PriceScale): void {
    this.leader = leader;
    this.height = leader.height;
    this.transform = leader.transform;
    this.range = leader.range;
  }

  /** Current range in scale space, or `null` when nothing can be drawn. */
  scaleRange(): PriceRange | null {
    return this.range;
  }

  /** Current range converted back to values. */
  valueRange(): PriceRange | null {
    return this.range
      ? { min: this.fromScale(this.range.min), max: this.fromScale(this.range.max) }
      : null;
  }

  toScale(value: number): number | null {
    if (!Number.isFinite(value)) {
      return null;
    }

    const transform = this.transform;

    switch (transform.mode) {
      case 'normal':
        return value;
      case 'log':
        return value > 0 ? Math.log10(value) : null;
      case 'percent':
        return ((value - transform.base) / Math.abs(transform.base)) * 100;
      case 'indexed':
        return (value / transform.base) * 100;
    }
  }

  fromScale(scaled: number): number {
    const transform = this.transform;

    switch (transform.mode) {
      case 'normal':
        return scaled;
      case 'log':
        return 10 ** scaled;
      case 'percent':
        return transform.base + (scaled / 100) * Math.abs(transform.base);
      case 'indexed':
        return (scaled / 100) * transform.base;
    }
  }

  /** Figure shown on axis labels: the value itself in normal and log mode, else the scaled figure. */
  displayValue(value: number): number {
    return this.transform.mode === 'percent' || this.transform.mode === 'indexed'
      ? (this.toScale(value) ?? Number.NaN)
      : value;
  }

  valueToY(value: number): number {
    const scaled = this.toScale(value);
    return scaled === null ? Number.NaN : this.scaleToY(scaled);
  }

  scaleToY(scaled: number): number {
    const range = this.range;

    if (!range) {
      return Number.NaN;
    }

    const ratio = (scaled - range.min) / (range.max - range.min);
    return this.inverted ? ratio * this.height : (1 - ratio) * this.height;
  }

  yToScale(y: number): number {
    const range = this.range;

    if (!range || this.height === 0) {
      return Number.NaN;
    }

    const ratio = this.inverted ? y / this.height : 1 - y / this.height;
    return range.min + ratio * (range.max - range.min);
  }

  yToValue(y: number): number {
    return this.fromScale(this.yToScale(y));
  }

  /** Switches to manual scaling with a fixed range given in values. */
  setValueRange(range: PriceRange): boolean {
    const min = this.toScale(range.min);
    const max = this.toScale(range.max);

    if (min === null || max === null) {
      return false;
    }

    return this.setManual({ min, max });
  }

  /** Scales the range around the value under `anchorY`; `factor > 1` zooms in. */
  zoom(factor: number, anchorY: number): void {
    const range = this.range;

    if (!range || !(factor > 0)) {
      return;
    }

    const anchor = this.yToScale(anchorY);
    this.setManual({
      min: anchor - (anchor - range.min) / factor,
      max: anchor + (range.max - anchor) / factor
    });
  }

  /** Moves the range so that content follows a vertical drag of `deltaY` pixels. */
  pan(deltaY: number): void {
    const range = this.range;

    if (!range || this.height === 0) {
      return;
    }

    const delta = ((range.max - range.min) * deltaY) / this.height;
    const shift = this.settings.invert ? -delta : delta;
    this.setManual({ min: range.min + shift, max: range.max + shift });
  }

  resetAutoScale(): void {
    this.manual = null;
  }

  /** Manual range in the configured mode's scale space, for persistence. */
  manualRange(): PriceRange | null {
    return this.manual?.mode === this.settings.mode ? this.manual.range : null;
  }

  /** Restores a range saved by {@link manualRange}. */
  restoreManualRange(range: PriceRange | null): void {
    this.manual =
      range && isShowable(range, this.settings.mode) ? { range, mode: this.settings.mode } : null;
  }

  /** Keeps a manual range in the current mode; absurd ranges are refused. */
  private setManual(range: PriceRange): boolean {
    if (!isShowable(range, this.transform.mode)) {
      return false;
    }

    this.manual = { range, mode: this.transform.mode };
    this.range = range;
    return true;
  }
}

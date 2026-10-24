import { describe, expect, it } from 'vitest';
import { emptyExtents, includeValue, PriceScale } from '../../src/scales/price-scale';
import { buildPriceTicks } from '../../src/scales/price-ticks';
import type { PriceScaleMode } from '../../src/options/types';

function extentsOf(...values: number[]) {
  const extents = emptyExtents();
  values.forEach((value) => {
    includeValue(extents, value);
  });
  return extents;
}

function createScale(mode: PriceScaleMode = 'normal', invert = false): PriceScale {
  const scale = new PriceScale({ mode, invert, margins: { top: 0.1, bottom: 0.1 } });
  scale.setHeight(100);
  return scale;
}

describe('PriceScale', () => {
  it('fits the extents with margins', () => {
    const scale = createScale();
    scale.fit(extentsOf(10, 20), null);

    expect(scale.valueToY(20)).toBeCloseTo(10);
    expect(scale.valueToY(10)).toBeCloseTo(90);
    expect(scale.yToValue(50)).toBeCloseTo(15);
  });

  it('inverts the axis', () => {
    const scale = createScale('normal', true);
    scale.fit(extentsOf(10, 20), null);

    expect(scale.valueToY(20)).toBeCloseTo(90);
  });

  it('handles flat data', () => {
    const scale = createScale();
    scale.fit(extentsOf(5, 5), null);

    expect(scale.valueToY(5)).toBeCloseTo(50);
  });

  it('shows a line of zeros between ticks of whole steps', () => {
    const scale = createScale();
    scale.setHeight(300);
    scale.fit(extentsOf(0, 0), null);
    const texts = buildPriceTicks(scale, 30).map((tick) => tick.value.toFixed(2));

    expect(scale.valueToY(0)).toBeCloseTo(150);
    expect(texts).toContain('0.00');
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.every((text) => text !== '-0.00')).toBe(true);
  });

  it('has no range without data', () => {
    const scale = createScale();
    scale.fit(emptyExtents(), null);

    expect(scale.scaleRange()).toBeNull();
    expect(scale.valueToY(1)).toBeNaN();
  });

  it('maps percent changes relative to the base, also for negative bases', () => {
    const scale = createScale('percent');
    scale.fit(extentsOf(-6, -2), -4);

    expect(scale.mode).toBe('percent');
    expect(scale.displayValue(-2)).toBeCloseTo(50);
    expect(scale.displayValue(-6)).toBeCloseTo(-50);
    expect(scale.valueToY(-2)).toBeLessThan(scale.valueToY(-6));
  });

  it('falls back to normal mode when the base cannot be used', () => {
    const percent = createScale('percent');
    percent.fit(extentsOf(-1, 1), 0);
    expect(percent.mode).toBe('normal');

    const indexed = createScale('indexed');
    indexed.fit(extentsOf(-5, 5), -3);
    expect(indexed.mode).toBe('normal');
  });

  it('ignores non-positive values in log mode', () => {
    const scale = createScale('log');
    scale.fit(extentsOf(0, 10, 1000), null);

    expect(scale.mode).toBe('log');
    expect(scale.valueToY(1000)).toBeCloseTo(10);
    expect(scale.valueToY(10)).toBeCloseTo(90);
    expect(scale.valueToY(0)).toBeNaN();
  });

  it('switches to manual scaling on zoom and pan, and back with resetAutoScale', () => {
    const scale = createScale();
    scale.fit(extentsOf(10, 20), null);
    scale.zoom(2, 50);

    expect(scale.autoScale).toBe(false);
    expect(scale.valueToY(15)).toBeCloseTo(50);

    scale.fit(extentsOf(0, 100), null);
    expect(scale.valueToY(15)).toBeCloseTo(50);

    scale.pan(10);
    expect(scale.valueToY(15)).toBeCloseTo(60);

    scale.resetAutoScale();
    scale.fit(extentsOf(0, 100), null);
    expect(scale.autoScale).toBe(true);
    expect(scale.valueToY(100)).toBeCloseTo(10);
  });

  it('accepts a manual value range', () => {
    const scale = createScale();
    scale.fit(extentsOf(10, 20), null);

    expect(scale.setValueRange({ min: 0, max: 50 })).toBe(true);
    expect(scale.valueToY(50)).toBe(0);
    expect(scale.setValueRange({ min: 5, max: 5 })).toBe(false);
  });
});

describe('buildPriceTicks', () => {
  it('produces round values inside the pane', () => {
    const scale = createScale();
    scale.fit(extentsOf(101.3, 109.7), null);
    const ticks = buildPriceTicks(scale, 20);

    expect(ticks.length).toBeGreaterThan(2);
    ticks.forEach((tick) => {
      expect(tick.y).toBeGreaterThanOrEqual(0);
      expect(tick.y).toBeLessThanOrEqual(100);
      expect(Number.isInteger(tick.value * 2)).toBe(true);
    });
  });

  it('uses 1-2-5 decades in log mode', () => {
    const scale = createScale('log');
    scale.setHeight(400);
    scale.fit(extentsOf(1, 10_000), null);
    const values = buildPriceTicks(scale, 20).map((tick) => tick.value);

    expect(values).toContain(10);
    expect(values).toContain(1000);
    expect(values).toContain(500);
  });
});

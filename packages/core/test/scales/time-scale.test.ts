import { describe, expect, it } from 'vitest';
import { TimeScale } from '../../src/scales/time-scale';

const SETTINGS = { minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 20 };

function createScale(count: number, width = 400, spacing = 10): TimeScale {
  const scale = new TimeScale(SETTINGS, spacing);
  scale.setWidth(width);
  scale.setBarCount(count, 'reset');
  return scale;
}

describe('TimeScale', () => {
  it('places the latest bar at the real-time position', () => {
    const scale = createScale(100);

    // Latest bar center sits half a bar plus the right offset left of the edge.
    expect(scale.indexToX(99)).toBeCloseTo(400 - 20 - 5);
    expect(scale.isRealTime()).toBe(true);
    expect(scale.visibleBars()).toEqual({ from: 62, to: 99 });
  });

  it('round-trips x and logical index', () => {
    const scale = createScale(100);
    expect(scale.xToIndex(scale.indexToX(42.25))).toBeCloseTo(42.25);
  });

  it('keeps following new bars while the latest bar is visible', () => {
    const scale = createScale(100);
    scale.setBarCount(101, 'tail');

    expect(scale.indexToX(100)).toBeCloseTo(375);
    expect(scale.isFollowing()).toBe(true);
  });

  it('keeps the view on history when the latest bar is scrolled out', () => {
    const scale = createScale(100);
    scale.scrollBy(300);
    const before = scale.logicalRange();
    scale.setBarCount(105, 'tail');
    const after = scale.logicalRange();

    expect(scale.isFollowing()).toBe(false);
    expect(after.from).toBeCloseTo(before.from);
    expect(after.to).toBeCloseTo(before.to);
  });

  it('keeps the view when history is prepended', () => {
    const scale = createScale(100);
    scale.scrollBy(150);
    const x = scale.indexToX(50);
    scale.setBarCount(130, 'prepend');

    expect(scale.indexToX(80)).toBeCloseTo(x);
  });

  it('zooms around the anchor', () => {
    const scale = createScale(100);
    const anchorIndex = scale.xToIndex(200);
    scale.zoom(2, 200);

    expect(scale.barSpacing).toBe(20);
    expect(scale.xToIndex(200)).toBeCloseTo(anchorIndex);
  });

  it('clamps bar spacing and scrolling', () => {
    const scale = createScale(100);
    scale.zoom(100, 200);
    expect(scale.barSpacing).toBe(50);

    scale.scrollBy(1_000_000);
    expect(scale.visibleBars()?.from).toBe(0);
    scale.scrollBy(-1_000_000);
    expect(scale.visibleBars()?.to).toBe(99);
    expect(scale.visibleBars()?.from).toBeGreaterThan(96);
  });

  it('fits all bars', () => {
    const scale = createScale(38);
    scale.fitContent();

    expect(scale.visibleBars()).toEqual({ from: 0, to: 37 });
    expect(scale.isRealTime()).toBe(true);
  });

  it('shows an explicit logical range', () => {
    const scale = createScale(100);
    scale.setLogicalRange({ from: 10, to: 30 });

    expect(scale.barSpacing).toBe(20);
    expect(scale.logicalRange().from).toBeCloseTo(10);
    expect(scale.logicalRange().to).toBeCloseTo(30);
  });

  it('restores a saved view', () => {
    const scale = createScale(100);
    scale.scrollBy(120);
    scale.zoom(1.5, 100);
    const saved = scale.state();
    const other = createScale(100);
    other.restore(saved);

    expect(other.logicalRange()).toEqual(scale.logicalRange());
  });
});

import { describe, expect, it } from 'vitest';
import { computeLayout, type LayoutPaneInput } from '../../src/layout/layout';

function heights(height: number, panes: readonly LayoutPaneInput[], minPaneHeight = 40): number[] {
  return computeLayout({
    width: 800,
    height,
    axisWidth: 60,
    leftAxisWidth: 0,
    timeAxisHeight: 0,
    separatorHeight: 0,
    minPaneHeight,
    panes
  }).panes.map((pane) => Math.round(pane.plot.height * 1e6) / 1e6);
}

describe('pane heights', () => {
  it('keep the requested heights while they fit, the main pane taking the rest', () => {
    expect(
      heights(500, [
        { id: 'main', height: 0, stretch: true },
        { id: 'a', height: 120, stretch: false }
      ])
    ).toEqual([380, 120]);
  });

  it('shrink in proportion when they do not fit, keeping the main pane at the minimum', () => {
    expect(
      heights(500, [
        { id: 'main', height: 0, stretch: true },
        { id: 'a', height: 300, stretch: false },
        { id: 'b', height: 300, stretch: false }
      ])
    ).toEqual([40, 230, 230]);
  });

  it('keep the main pane at the minimum when a shrunk pane is held at it', () => {
    const [main, a, b] = heights(500, [
      { id: 'main', height: 0, stretch: true },
      { id: 'a', height: 600, stretch: false },
      { id: 'b', height: 20, stretch: false }
    ]);

    expect(main).toBe(40);
    expect(b).toBe(40);
    expect(a).toBe(420);
  });
});

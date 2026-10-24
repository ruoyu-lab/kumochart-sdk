import { describe, expect, it } from 'vitest';
import { draggedValue, layoutPriceLines, type PriceLineView } from '../../src/objects/price-line';

function view(id: string, y: number): PriceLineView {
  return {
    id,
    y,
    color: '#000000',
    text: id,
    axisText: '',
    buttons: [],
    lineStyle: 'solid',
    emphasized: false
  };
}

const measure = (text: string) => text.length * 6;

describe('price line labels', () => {
  it('move apart downwards from the top', () => {
    const labels = layoutPriceLines([view('a', 50), view('b', 52)], 400, 300, 12, measure);

    expect(labels.map((label) => label.labelY)).toEqual([50, 72]);
  });

  it('move up where they would leave the plot at the bottom, each above the next', () => {
    const labels = layoutPriceLines(
      [view('a', 290), view('b', 292), view('c', 294)],
      400,
      300,
      12,
      measure
    );
    const bottoms = labels.map((label) => label.label.y + label.label.height);

    expect(bottoms[2]).toBeLessThanOrEqual(300);
    expect(labels.map((label) => label.labelY)).toEqual([246, 268, 290]);
  });

  it('leave the labels of lines below the plot where they are', () => {
    const labels = layoutPriceLines([view('a', 290), view('b', 400)], 400, 300, 12, measure);

    expect(labels.map((label) => label.labelY)).toEqual([290, 400]);
  });
});

describe('a dragged value', () => {
  /** A scale on which each pixel down is worth `pixel` less, from `top` at y 0. */
  const scale = (top: number, pixel: number) => ({ yToValue: (y: number) => top - y * pixel });

  it('keeps the decimals of a pane that writes them', () => {
    expect(draggedValue(scale(100, 0.0371), { kind: 'decimal', precision: 2 }, 10)).toBe(99.63);
  });

  it('keeps the power of ten a pixel is worth where the pane writes compact numbers', () => {
    const compact = { kind: 'compact' } as const;

    expect(draggedValue(scale(1_234_567, 2500), compact, 0)).toBe(1_235_000);
    expect(draggedValue(scale(4.56789e-7, 3e-9), compact, 0)).toBe(4.57e-7);
    expect(draggedValue(scale(0, 0), compact, 0)).toBe(0);
  });
});

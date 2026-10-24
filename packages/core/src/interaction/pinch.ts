import type { InteractionHost, Point } from './types';

/**
 * Fingers closer than this across the chart do not zoom it: from fingers placed one above the
 * other, the ratio of their distances would jump to the largest or smallest bars at once.
 */
const MIN_SPAN = 40;

function spanOf(first: Point, second: Point): number | null {
  const span = Math.abs(first.x - second.x);
  return span >= MIN_SPAN ? span : null;
}

/**
 * Two fingers on the chart: it scrolls as far as their middle moves and zooms the bars by how
 * far they move apart across it, around their middle.
 */
export class Pinch {
  /** How far apart across the chart the fingers last zoomed it, or `null` while too close. */
  private span: number | null;
  private center: number;

  constructor(first: Point, second: Point) {
    this.span = spanOf(first, second);
    this.center = (first.x + second.x) / 2;
  }

  move(first: Point, second: Point, host: Pick<InteractionHost, 'scrollTime' | 'zoomTime'>): void {
    const span = spanOf(first, second);
    const center = (first.x + second.x) / 2;
    host.scrollTime(center - this.center);

    if (span !== null && this.span !== null) {
      host.zoomTime(span / this.span, center);
    }

    this.span = span;
    this.center = center;
  }
}

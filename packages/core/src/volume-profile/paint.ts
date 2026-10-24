import { withAlpha } from '../canvas/color';
import type { Theme } from '../options/types';
import type { VolumeProfileData } from './profile';

/** Colors given for a profile; the theme's where left out or `null`. */
export interface GivenColors {
  readonly upColor?: string | null;
  readonly downColor?: string | null;
  readonly pocColor?: string | null;
}

export interface ProfileColors {
  readonly up: string;
  readonly down: string;
  readonly poc: string;
}

export function profileColors(given: GivenColors, theme: Theme): ProfileColors {
  return {
    up: given.upColor ?? theme.up,
    down: given.downColor ?? theme.down,
    poc: given.pocColor ?? theme.palette[0]
  };
}

/** Where a profile is painted, in plot coordinates. */
export interface ProfileArea {
  /** The edge the rows grow from. */
  readonly x: number;
  /** Length of the row with the most volume; negative grows to the left. */
  readonly length: number;
  /** The line of the point of control goes from `x` to here. */
  readonly pocTo: number;
}

/** Opacity of the rows inside the value area, and of those outside. */
const INSIDE_ALPHA = 0.5;
const OUTSIDE_ALPHA = 0.22;

/**
 * Paints the rows growing from `area.x`, the rising bars' volume first, those of the value area
 * stronger, and the point of control as a line.
 */
export function paintProfile(
  ctx: CanvasRenderingContext2D,
  profile: VolumeProfileData,
  valueToY: (value: number) => number,
  area: ProfileArea,
  colors: ProfileColors
): void {
  const largest = profile.rows.reduce((max, row) => Math.max(max, row.up + row.down), 0);

  profile.rows.forEach((row, index) => {
    const top = valueToY(row.high);
    const bottom = valueToY(row.low);
    const height = Math.abs(bottom - top);
    // A pixel between rows keeps them apart once they are tall enough.
    const gap = height > 3 ? 1 : 0;
    const y = Math.min(top, bottom) + gap / 2;
    const inside = index >= profile.valueArea.low && index <= profile.valueArea.high;
    const alpha = inside ? INSIDE_ALPHA : OUTSIDE_ALPHA;
    const upLength = (row.up / largest) * area.length;
    const downLength = (row.down / largest) * area.length;
    const downStart = area.x + upLength;

    ctx.fillStyle = withAlpha(colors.up, alpha);
    ctx.fillRect(Math.min(area.x, downStart), y, Math.abs(upLength), height - gap);
    ctx.fillStyle = withAlpha(colors.down, alpha);
    ctx.fillRect(
      Math.min(downStart, downStart + downLength),
      y,
      Math.abs(downLength),
      height - gap
    );
  });

  const poc = profile.rows[profile.poc];

  if (poc) {
    const y = Math.round(valueToY((poc.low + poc.high) / 2)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.pocTo, y);
    ctx.strokeStyle = colors.poc;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

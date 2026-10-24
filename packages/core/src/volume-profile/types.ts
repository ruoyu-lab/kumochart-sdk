/**
 * - `visible`: one profile of the bars in view, along an edge of the plot.
 * - `session`: one profile for each trading day of the chart's calendar, from the start of the day.
 */
export type VolumeProfileMode = 'visible' | 'session';

/** The edge of the plot a profile of the bars in view grows from. */
export type VolumeProfilePlacement = 'left' | 'right';

export interface VolumeProfileInput {
  /** Generated when omitted. */
  id?: string;
  mode: VolumeProfileMode;
  /** Number of price rows, from 1 to 1000. Default 24. */
  rows?: number;
  /** Share of the volume in the value area, above 0 and at most 1. Default 0.7. */
  valueArea?: number;
  /**
   * Length of the row with the most volume, above 0 and at most 1: a share of the plot's width
   * (`visible`, default 0.25) or of the trading day's (`session`, default 0.7).
   */
  width?: number;
  /** The edge a profile of the bars in view grows from. Default `right`. */
  placement?: VolumeProfilePlacement;
  /** Volume of the bars that closed at or above their open. Default: the theme's `up`. */
  upColor?: string;
  /** Volume of the bars that closed below their open. Default: the theme's `down`. */
  downColor?: string;
  /** The line of the point of control. Default: the first color of the theme's palette. */
  pocColor?: string;
  /** Default `true`. */
  visible?: boolean;
}

/** A volume profile on the chart, as `chart.volumeProfiles` gives it. */
export interface VolumeProfile {
  readonly id: string;
  readonly mode: VolumeProfileMode;
  readonly rows: number;
  readonly valueArea: number;
  /** As given, or `null` for the default of the mode. */
  readonly width: number | null;
  readonly placement: VolumeProfilePlacement;
  /** As given, or `null` for the theme's color. */
  readonly upColor: string | null;
  readonly downColor: string | null;
  readonly pocColor: string | null;
  readonly visible: boolean;
}

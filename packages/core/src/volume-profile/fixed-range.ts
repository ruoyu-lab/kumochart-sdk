import { withAlpha } from '../canvas/color';
import type { BarsView } from '../data/types';
import type { Anchors, DrawingGeometry, DrawingTypeDefinition } from '../drawings/types';
import { LruCache } from '../utils/lru-cache';
import { checkFields, checkString, fieldsOf } from '../utils/validate';
import { paintProfile, profileColors } from './paint';
import {
  checkVolumeProfileOptions,
  checkShare,
  profileOf,
  type VolumeProfileData,
  type VolumeProfileOptions
} from './profile';

/** Options of {@link fixedRangeVolumeProfile}, for every drawing of the type. */
export interface FixedRangeVolumeProfileOptions extends VolumeProfileOptions {
  /** Length of the row with the most volume, as a share of the range's width. Default 0.6. */
  width?: number;
  /** Volume of the bars that closed at or above their open. Default: the theme's `up`. */
  upColor?: string;
  /** Volume of the bars that closed below their open. Default: the theme's `down`. */
  downColor?: string;
  /** The line of the point of control. Default: the first color of the theme's palette. */
  pocColor?: string;
}

const OPTION_FIELDS = fieldsOf<FixedRangeVolumeProfileOptions>({
  rows: true,
  valueArea: true,
  width: true,
  upColor: true,
  downColor: true,
  pocColor: true
});
const DEFAULT_WIDTH = 0.6;
/** Profiles of the ranges a chart's drawings of the type cover, or covered while dragged. */
const CACHE_SIZE = 64;
const FRAME_ALPHA = 0.5;
const BACKGROUND_ALPHA = 0.04;

/** Where a drawing paints, in plot coordinates, and its profile. */
interface Range {
  readonly profile: VolumeProfileData | null;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The fixed range volume profile, `fixed-range-volume-profile`: the volume traded at each price
 * of the bars from the first anchor's through the second's, computed from the source bars that a
 * running replay has revealed. The anchors set the time range, the bars the price range; without
 * volume there, the frame spans the anchors' prices. The rows are painted under the bars, and the
 * style's `color` paints the frame. Give it to the drawings module, as
 * `drawings([...allDrawings, fixedRangeVolumeProfile()])`; the options hold for every drawing of
 * the type.
 */
export function fixedRangeVolumeProfile(
  options: FixedRangeVolumeProfileOptions = {}
): DrawingTypeDefinition<Anchors<2>> {
  const label = 'fixedRangeVolumeProfile() options';
  checkFields(label, options, OPTION_FIELDS);
  const { rows, valueArea } = checkVolumeProfileOptions(options, label);
  const width =
    options.width === undefined ? DEFAULT_WIDTH : checkShare(`${label}.width`, options.width);

  for (const key of ['upColor', 'downColor', 'pocColor'] as const) {
    if (options[key] !== undefined) {
      checkString(`${label}.${key}`, options[key]);
    }
  }

  const cache = new WeakMap<
    BarsView,
    { revision: number; profiles: LruCache<string, VolumeProfileData | null> }
  >();

  /** The profile of the source bars `[start, end)`, kept until the bars change. */
  const profileOfRange = (source: BarsView, start: number, end: number) => {
    let entry = cache.get(source);

    if (entry?.revision !== source.revision) {
      entry = { revision: source.revision, profiles: new LruCache(CACHE_SIZE) };
      cache.set(source, entry);
    }

    return entry.profiles.getOrCreate(`${start}:${end}`, () =>
      profileOf(source, start, end, rows, valueArea)
    );
  };

  const rangeOf = (geometry: DrawingGeometry<Anchors<2>>): Range => {
    const [first, second] = geometry.anchors;
    const [from, to] = geometry.points;

    // From the displayed bar of the earlier anchor through that of the later one.
    const { bars, source } = geometry;
    const next = bars.lowerBound(Math.max(first.time, second.time) + 1);
    const profile = profileOfRange(
      source,
      source.lowerBound(Math.min(first.time, second.time)),
      next < bars.length ? source.lowerBound(bars.time(next)) : source.length
    );
    const lowest = profile?.rows[0]?.low ?? Math.min(first.price, second.price);
    const highest = profile?.rows.at(-1)?.high ?? Math.max(first.price, second.price);
    const ys = [geometry.valueToY(lowest), geometry.valueToY(highest)];
    return {
      profile,
      left: Math.min(from.x, to.x),
      right: Math.max(from.x, to.x),
      top: Math.min(...ys),
      bottom: Math.max(...ys)
    };
  };

  return {
    type: 'fixed-range-volume-profile',
    points: 2,
    mainPane: true,
    fields: ['color'],
    paintBelow: ({ ctx, geometry }) => {
      const { left, right, top, bottom, profile } = rangeOf(geometry);
      ctx.fillStyle = withAlpha(geometry.style.color, BACKGROUND_ALPHA);
      ctx.fillRect(left, top, right - left, bottom - top);

      if (profile) {
        paintProfile(
          ctx,
          profile,
          geometry.valueToY,
          { x: left, length: width * (right - left), pocTo: right },
          profileColors(options, geometry.theme)
        );
      }
    },
    paint: ({ ctx, geometry, hovered, selected }) => {
      const { left, right, top, bottom } = rangeOf(geometry);
      const { color } = geometry.style;
      ctx.strokeStyle = hovered || selected ? color : withAlpha(color, FRAME_ALPHA);
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, right - left, bottom - top);
    },
    hitTest: (geometry, point, tolerance) => {
      const { left, right, top, bottom } = rangeOf(geometry);
      const inside =
        point.x >= left - tolerance &&
        point.x <= right + tolerance &&
        point.y >= top - tolerance &&
        point.y <= bottom + tolerance;

      if (!inside) {
        return null;
      }

      const edge = Math.min(
        Math.abs(point.x - left),
        Math.abs(point.x - right),
        Math.abs(point.y - top),
        Math.abs(point.y - bottom)
      );
      return edge <= tolerance ? { part: 'line', distance: edge } : { part: 'body', distance: 0 };
    },
    // The anchors set the time range only, so their handles move sideways.
    handles: (geometry) => {
      const range = rangeOf(geometry);
      const middle = (range.top + range.bottom) / 2;
      return geometry.points.map((point, index) => ({
        id: String(index),
        x: point.x,
        y: middle,
        cursor: 'ew-resize'
      }));
    },
    axisMarks: (anchors) => ({ prices: [], times: anchors.map((anchor) => anchor.time) }),
    bounds: (geometry) => {
      const range = rangeOf(geometry);
      return {
        x: range.left,
        y: range.top,
        width: range.right - range.left,
        height: range.bottom - range.top
      };
    }
  };
}

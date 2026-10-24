import {
  arrow,
  crossLine,
  extendedLine,
  horizontalLine,
  horizontalRay,
  ray,
  trendAngle,
  trendLine,
  verticalLine
} from './tools/lines';
import { parallelChannel, path, rectangle, text } from './tools/shapes';
import { fibChannel, fibExtension, fibRetracement, fibTimeZone } from './tools/fibonacci';
import { brush } from './tools/brush';
import { callout } from './tools/callout';
import { circle, ellipse, triangle } from './tools/figures';
import { fibSpeedFan, gannBox } from './tools/gann';
import { flagMark, priceLabel } from './tools/marks';
import {
  elliottCorrection,
  elliottImpulse,
  headAndShoulders,
  xabcdPattern
} from './tools/patterns';
import { pitchfork } from './tools/pitchfork';
import { longPosition, shortPosition } from './tools/position';
import { datePriceRange, dateRange, priceRange } from './tools/ranges';
import { regressionTrend } from './tools/regression';
import { anchoredVwap } from './tools/vwap';
import type { DrawingTypeDefinition } from './types';

/**
 * Every drawing type of the SDK, for `drawings(allDrawings)`. Listed one by one, so that an
 * application picking a few ships only those.
 */
export const allDrawings: readonly DrawingTypeDefinition[] = [
  trendLine,
  ray,
  extendedLine,
  arrow,
  horizontalLine,
  horizontalRay,
  verticalLine,
  rectangle,
  parallelChannel,
  fibRetracement,
  text,
  path,
  priceRange,
  longPosition,
  shortPosition,
  pitchfork,
  fibExtension,
  dateRange,
  datePriceRange,
  callout,
  brush,
  crossLine,
  trendAngle,
  regressionTrend,
  fibChannel,
  fibTimeZone,
  fibSpeedFan,
  gannBox,
  circle,
  ellipse,
  triangle,
  priceLabel,
  flagMark,
  xabcdPattern,
  headAndShoulders,
  elliottImpulse,
  elliottCorrection,
  anchoredVwap
];

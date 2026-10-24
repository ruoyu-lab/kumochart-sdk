import { fail } from '../utils/errors';
import { checkFields, checkNumber, fieldsOf } from '../utils/validate';
import type { ScaleMargins } from './types';

const MARGIN_FIELDS = fieldsOf<ScaleMargins>({ top: true, bottom: true });

/** The most of a pane the margins take together: the data keeps a tenth of it at least. */
const MAX_MARGINS = 0.9;

/**
 * Checks margins of a price scale, the chart's or a scale's own: each at least 0, and together
 * at most 0.9 of the pane.
 */
export function checkMargins(label: string, margins: ScaleMargins): ScaleMargins {
  checkFields(label, margins, MARGIN_FIELDS);
  checkNumber(`${label}.top`, margins.top, { min: 0, max: MAX_MARGINS });
  checkNumber(`${label}.bottom`, margins.bottom, { min: 0, max: MAX_MARGINS });

  if (margins.top + margins.bottom > MAX_MARGINS) {
    fail(`${label}.top and ${label}.bottom must leave a tenth of the pane for the data.`);
  }

  return { top: margins.top, bottom: margins.bottom };
}

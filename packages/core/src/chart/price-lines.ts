import type { PriceDragEvent, PriceLineHost } from '../objects/price-line';
import { formatPaneValue } from '../render/frame';
import type { ChartCore } from './chart-core';

/** How price lines (orders, alerts) of a chart are drawn, dragged and reported. */
export function priceLineHost<Event extends PriceDragEvent>(
  core: ChartCore,
  dragged: (event: Event) => void
): PriceLineHost & { dragged(event: Event): void } {
  return {
    context: () => core.objectContext(),
    repaint: () => {
      core.invalidateLayers('objects');
    },
    formatValue: (pane, value) => formatPaneValue(core, pane, value),
    dragged
  };
}

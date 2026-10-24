import { collectionApi, type CollectionApi } from '../chart/api/collection';
import { defineModule, type ChartModule } from '../chart/modules';
import { priceLineHost } from '../chart/price-lines';
import { AlertsDomain } from './alerts-domain';
import type { Alert, AlertDragEvent, AlertInput, AlertTriggerEvent } from './types';

/** Alerts evaluated on every data update; fixed levels are drawn as draggable lines. */
export interface AlertsApi extends CollectionApi<AlertInput, Alert> {
  /** Arms an alert that fired with frequency `once` again. */
  rearm(id: string): void;
}

export interface AlertsEventMap {
  /**
   * The user drags an alert's level, or a bound of its channel; the alert follows immediately and
   * keeps the final value.
   */
  alertDrag: AlertDragEvent;
  alertTrigger: AlertTriggerEvent;
}

export type AlertsModule = ChartModule<{
  readonly api: { readonly alerts: AlertsApi };
  readonly events: AlertsEventMap;
}>;

/**
 * The alerts module: `chart.alerts`, alerts on the price, on series, and on indicators and
 * drawings when the chart has their modules.
 */
export function alerts(): AlertsModule {
  return defineModule({
    name: 'alerts',
    install: (core) => {
      const events = core.events<AlertsEventMap>();
      const domain = new AlertsDomain(core.bars, {
        ...priceLineHost(core, (event) => {
          events.emit('alertDrag', event);
        }),
        reader: core.values,
        settled: () => core.market.settled(),
        triggered: (event) => {
          core.invalidateLayers('objects');
          events.emit('alertTrigger', { ...event, replay: core.replaying });
        }
      });
      core.objects.add(domain, 30);
      core.values.use({
        noun: 'alert',
        uses: (kind, id) => domain.uses(kind, id),
        reset: () => {
          domain.rebaseline();
        },
        verify: (check) => {
          domain.verify(check);
        }
      });
      core.hooks.barsChanged.push((change) => {
        domain.evaluate(change);
      });
      return {
        alerts: {
          ...collectionApi(core, domain),
          rearm: (id: string) => {
            core.run(() => {
              domain.rearm(id);
              core.invalidateLayers('objects');
            });
          }
        }
      };
    }
  });
}

import { collectionApi, type CollectionApi } from '../chart/api/collection';
import { defineModule, type ChartModule } from '../chart/modules';
import { priceLineHost } from '../chart/price-lines';
import type { PriceDragEvent } from '../objects/price-line';
import { MarkersDomain, type Marker, type MarkerInput } from './markers';
import { OrdersDomain, type Order, type OrderInput } from './orders';

/** Orders drawn as price lines on the main pane. The application owns them; the chart only shows them. */
export type OrdersApi = CollectionApi<OrderInput, Order>;

/** Executions and signals pinned to bars. */
export type MarkersApi = CollectionApi<MarkerInput, Marker>;

export interface OrdersEventMap {
  /** The user drags an order line; the order follows immediately and keeps the final price. */
  orderDrag: PriceDragEvent;
}

export type OrdersModule = ChartModule<{
  readonly api: { readonly orders: OrdersApi };
  readonly events: OrdersEventMap;
}>;

export type MarkersModule = ChartModule<{
  readonly api: { readonly markers: MarkersApi };
}>;

/** The orders module: `chart.orders`, orders as draggable price lines on the main pane. */
export function orders(): OrdersModule {
  return defineModule({
    name: 'orders',
    install: (core) => {
      const events = core.events<OrdersEventMap>();
      const domain = new OrdersDomain(
        priceLineHost(core, (event) => {
          events.emit('orderDrag', event);
        })
      );
      core.objects.add(domain, 40);
      return { orders: collectionApi(core, domain) };
    }
  });
}

/** The markers module: `chart.markers`, executions and signals pinned to bars. */
export function markers(): MarkersModule {
  return defineModule({
    name: 'markers',
    install: (core) => {
      const domain = new MarkersDomain();
      core.objects.add(domain, 10);
      return { markers: collectionApi(core, domain) };
    }
  });
}

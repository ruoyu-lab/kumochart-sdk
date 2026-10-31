import { ALL_EVENTS, type AllEventMap } from 'kumo-charts/all';

/** The events of the chart and of its modules; those of a module the chart lacks never fire. */
export type KumoChartEventMap = AllEventMap;

/** The name of an event of the chart or of one of its modules. */
export type KumoChartEventName = keyof KumoChartEventMap;

/** Every event the component forwards, as the core lists them. */
export const EVENTS: readonly KumoChartEventName[] = ALL_EVENTS;

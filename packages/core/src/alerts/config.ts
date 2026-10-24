import { checkColor } from '../canvas/color';
import type { Values } from '../chart/values';
import { PRICE_SOURCES, type ValueSource } from '../data/types';
import { validateButtons } from '../objects/price-line';
import { LINE_STYLES, type LineStyle } from '../options/types';
import { fail } from '../utils/errors';
import {
  checkBoolean,
  checkFields,
  checkNumber,
  checkObject,
  checkOneOf,
  checkString,
  fieldsOf
} from '../utils/validate';
import type { Alert, AlertFrequency, AlertInput, AlertTrigger, ChannelBounds } from './types';

const TRIGGERS = [
  'cross',
  'cross-up',
  'cross-down',
  'above',
  'below',
  'enter-channel',
  'exit-channel',
  'inside-channel',
  'outside-channel'
] as const;
const FREQUENCIES = ['once', 'once-per-bar', 'once-per-bar-close', 'every-time'] as const;
const DEFAULT_SOURCE: ValueSource = { kind: 'price', field: 'close' };

/** Reads the values alerts watch. */
export type ValueReader = Pick<Values, 'check' | 'read' | 'paneOf' | 'scaleOf' | 'movable'>;

/** A value an alert compares with: a fixed level, another value, or the bounds of a channel. */
export type AlertValue = number | ValueSource | ChannelBounds;

export interface AlertConfig {
  readonly id: string;
  readonly source: ValueSource;
  readonly trigger: AlertTrigger;
  readonly value: AlertValue;
  readonly frequency: AlertFrequency;
  readonly enabled: boolean;
  readonly label: string | null;
  readonly color: string | null;
  readonly lineStyle: LineStyle;
  readonly draggable: boolean;
  readonly visible: boolean;
  readonly buttons: Alert['buttons'];
}

const ALERT_FIELDS = fieldsOf<AlertInput>({
  id: true,
  source: true,
  trigger: true,
  value: true,
  frequency: true,
  enabled: true,
  label: true,
  color: true,
  lineStyle: true,
  draggable: true,
  visible: true,
  buttons: true
});

/** The fields of a value source of each kind. */
const SOURCE_FIELDS = {
  price: fieldsOf<Extract<ValueSource, { kind: 'price' }>>({ kind: true, field: true }),
  indicator: fieldsOf<Extract<ValueSource, { kind: 'indicator' }>>({
    kind: true,
    id: true,
    key: true
  }),
  series: fieldsOf<Extract<ValueSource, { kind: 'series' }>>({ kind: true, id: true }),
  drawing: fieldsOf<Extract<ValueSource, { kind: 'drawing' }>>({
    kind: true,
    id: true,
    level: true
  })
};

function parseSource(source: ValueSource, label: string, reader: ValueReader): ValueSource {
  checkObject(label, source);

  if (Object.hasOwn(SOURCE_FIELDS, source.kind)) {
    checkFields(label, source, SOURCE_FIELDS[source.kind]);
  }

  switch (source.kind) {
    case 'price':
      return {
        kind: 'price',
        field:
          source.field === undefined
            ? 'close'
            : checkOneOf(`${label}.field`, source.field, PRICE_SOURCES)
      };
    case 'indicator':
      checkString(`${label}.id`, source.id);

      if (source.key !== undefined) {
        checkString(`${label}.key`, source.key);
      }

      reader.check(source, label);
      return {
        kind: 'indicator',
        id: source.id,
        ...(source.key !== undefined ? { key: source.key } : {})
      };
    case 'series':
      checkString(`${label}.id`, source.id);
      reader.check(source, label);
      return { kind: 'series', id: source.id };
    case 'drawing':
      checkString(`${label}.id`, source.id);

      if (source.level !== undefined) {
        checkString(`${label}.level`, source.level);
      }

      reader.check(source, label);
      return {
        kind: 'drawing',
        id: source.id,
        ...(source.level !== undefined ? { level: source.level } : {})
      };
    default:
      return fail(`${label}.kind must be "price", "indicator", "series" or "drawing".`);
  }
}

/** The values an alert compares with: its one value, or the two bounds of its channel. */
export function boundsOf(value: AlertValue): ReadonlyArray<number | ValueSource> {
  return Array.isArray(value) ? value : [value as number | ValueSource];
}

function parseBound(value: number | ValueSource, label: string, reader: ValueReader) {
  return typeof value === 'number' ? checkNumber(label, value) : parseSource(value, label, reader);
}

/** The channel triggers compare with two bounds, the others with one value. */
function parseValue(
  value: AlertValue,
  trigger: AlertTrigger,
  reader: ValueReader,
  label: string
): AlertValue {
  const channel = trigger.endsWith('-channel');

  if (Array.isArray(value) !== channel || (channel && (value as readonly unknown[]).length !== 2)) {
    fail(
      `${label} of a "${trigger}" alert must be ${channel ? "a channel's two bounds" : 'one value'}.`
    );
  }

  return channel
    ? ((value as ChannelBounds).map((bound, index) =>
        parseBound(bound, `${label}[${index}]`, reader)
      ) as unknown as ChannelBounds)
    : parseBound(value as number | ValueSource, label, reader);
}

/** An alert's configuration but for its id, which the domain gives it. */
export type AlertSettings = Omit<AlertConfig, 'id'>;

export function parseAlert(input: AlertInput, reader: ValueReader, label = 'alert'): AlertSettings {
  checkFields(label, input, ALERT_FIELDS);

  if (input.label !== undefined) {
    checkString(`${label}.label`, input.label);
  }

  const trigger = checkOneOf(`${label}.trigger`, input.trigger, TRIGGERS);

  return {
    source: parseSource(input.source ?? DEFAULT_SOURCE, `${label}.source`, reader),
    trigger,
    value: parseValue(input.value, trigger, reader, `${label}.value`),
    frequency:
      input.frequency === undefined
        ? 'once'
        : checkOneOf(`${label}.frequency`, input.frequency, FREQUENCIES),
    enabled: input.enabled === undefined ? true : checkBoolean(`${label}.enabled`, input.enabled),
    label: input.label ?? null,
    color: input.color === undefined ? null : checkColor(`${label}.color`, input.color),
    lineStyle:
      input.lineStyle === undefined
        ? 'solid'
        : checkOneOf(`${label}.lineStyle`, input.lineStyle, LINE_STYLES),
    draggable:
      input.draggable === undefined ? true : checkBoolean(`${label}.draggable`, input.draggable),
    visible: input.visible === undefined ? true : checkBoolean(`${label}.visible`, input.visible),
    buttons: validateButtons(input.buttons, `${label}.buttons`)
  };
}

export function configInput(config: AlertConfig): AlertInput {
  return {
    source: config.source,
    trigger: config.trigger,
    value: config.value,
    frequency: config.frequency,
    enabled: config.enabled,
    lineStyle: config.lineStyle,
    draggable: config.draggable,
    visible: config.visible,
    buttons: config.buttons.map((button) => ({ ...button })),
    ...(config.label !== null ? { label: config.label } : {}),
    ...(config.color !== null ? { color: config.color } : {})
  };
}

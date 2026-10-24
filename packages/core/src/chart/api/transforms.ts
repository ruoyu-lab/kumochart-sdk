import type {
  BarTransformDefinition,
  BarTransformInput,
  BarTransformState
} from '../../feed/transform';
import { fail } from '../../utils/errors';
import { checkBoolean, checkObject, checkString } from '../../utils/validate';
import type { ChartCore } from '../chart-core';

/**
 * The transform building the displayed bars from the bars of the timeframe, such as Renko bricks,
 * and the transform types the chart has.
 */
export interface TransformsApi {
  /**
   * Builds the displayed bars with a transform, e.g. `{ type: 'renko', params: { box: 50 } }`,
   * or shows the bars of the timeframe again with `null`.
   */
  set(transform: BarTransformInput | null): void;
  /**
   * The transform building the displayed bars, or `null` when they are the bars of the timeframe;
   * `resolved` holds what it builds with, such as the box size it worked out from the bars.
   */
  get(): BarTransformState | null;
  /** Adds a transform type to this chart, named by its `type`. */
  register<P extends object>(definition: BarTransformDefinition<P>): void;
  /** Removes a transform type. Fails while it builds the displayed bars. */
  unregister(type: string): void;
  /** Every transform type the chart has. */
  types(): string[];
  /** The definition of a type, or `null` for an unknown type. */
  definition(type: string): Readonly<BarTransformDefinition> | null;
}

/** Checks a transform definition before it joins a chart. */
export function validateTransformDefinition(definition: BarTransformDefinition<object>): void {
  checkObject('transform definition', definition);
  checkString('transform definition type', definition.type);
  checkString('transform definition name', definition.name);
  checkBoolean('transform definition keepsTime', definition.keepsTime);

  if (typeof definition.create !== 'function') {
    fail('A transform definition needs a create() function.');
  }
}

export function createTransformsApi(core: ChartCore): TransformsApi {
  const { transforms } = core.market;

  return {
    set: (transform) => {
      core.run(() => {
        core.setTransform(transform);
      });
    },
    get: () => core.market.transform(),
    register: (definition) => {
      core.run(() => {
        validateTransformDefinition(definition);
        transforms.register(definition as BarTransformDefinition);
        core.bus.emit('typesChange', {
          kind: 'transform',
          type: definition.type,
          registered: true
        });
      });
    },
    unregister: (type) => {
      core.run(() => {
        transforms.require(type);

        if (core.market.transform()?.type === type) {
          fail(`The "${type}" transform builds the displayed bars; set another one first.`);
        }

        transforms.unregister(type);
        core.bus.emit('typesChange', { kind: 'transform', type, registered: false });
      });
    },
    types: () => transforms.types(),
    definition: (type) => transforms.get(type) ?? null
  };
}

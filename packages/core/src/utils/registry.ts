import { fail } from './errors';
import { checkObject, checkString } from './validate';

/** A definition named by the type it defines, such as an indicator or a drawing type. */
export interface Typed {
  readonly type: string;
}

/**
 * The definitions of one kind (series types, bar transforms, indicators, drawing types) a chart
 * knows, by type. Fixed definitions can be neither replaced nor removed.
 */
export class Registry<Definition extends Typed> {
  private readonly definitions = new Map<string, Definition>();
  private readonly fixed: ReadonlySet<string>;

  constructor(
    /** What a definition defines, for messages, e.g. `indicator type`. */
    private readonly kind: string,
    fixed: readonly Definition[] = [],
    /** Appended to the message for an unknown type, e.g. how to register one. */
    private readonly hint = ''
  ) {
    fixed.forEach((definition) => {
      this.register(definition);
    });
    this.fixed = new Set(fixed.map((definition) => definition.type));
  }

  register(definition: Definition): void {
    checkObject(`${this.kind} definition`, definition);
    const type = checkString(`${this.kind} definition type`, definition.type);

    if (this.definitions.has(type)) {
      fail(`A ${this.kind} "${type}" is already registered.`);
    }

    this.definitions.set(type, definition);
  }

  unregister(type: string): void {
    checkString(this.kind, type);

    if (this.fixed.has(type)) {
      fail(`"${type}" is a ${this.kind} of every chart and cannot be unregistered.`);
    }

    this.require(type);
    this.definitions.delete(type);
  }

  get(type: string): Definition | undefined {
    return this.definitions.get(type);
  }

  require(type: string): Definition {
    return (
      this.definitions.get(type) ??
      fail(`Unknown ${this.kind} "${type}".${this.hint ? ` ${this.hint}` : ''}`)
    );
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }
}

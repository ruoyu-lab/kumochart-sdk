/** An id numbered after its prefix, such as `rsi-7`. */
const NUMBERED = /^(.+)-(\d+)$/;

/**
 * Ids such as `rsi-1` for what is added without one: numbered by type from 1, never given twice,
 * so an id that went with a removed object does not name a new one. The id of everything added is
 * noted, given or numbered, such as those of a saved layout: a number is used up once an object
 * has it, and none is numbered again after it is gone.
 */
export class IdSequence {
  private readonly counts: Map<string, number>;

  /**
   * `after` is the sequence of the objects that those of this one are to replace, as a staging
   * store checks them: it numbers on from there, so a replacement takes no id that went before.
   */
  constructor(
    private readonly taken: (id: string) => boolean,
    after?: IdSequence
  ) {
    this.counts = new Map(after?.counts);
  }

  /**
   * The id of the next object of `prefix` added without one. It is used up as the object is added
   * and its id noted, so one that fails to be added takes no number.
   */
  next(prefix: string): string {
    let count = this.counts.get(prefix) ?? 1;

    while (this.taken(`${prefix}-${count}`)) {
      count += 1;
    }

    return `${prefix}-${count}`;
  }

  /** Notes an id that names an object, so that the ids of its prefix go on after it. */
  note(id: string): void {
    const match = NUMBERED.exec(id);

    if (!match) {
      return;
    }

    const [, prefix = '', number = ''] = match;
    const count = Number(number) + 1;

    if (Number.isSafeInteger(count) && count > (this.counts.get(prefix) ?? 1)) {
      this.counts.set(prefix, count);
    }
  }

  /**
   * Notes the ids inputs added together give, before any of them is added, so that none is
   * numbered for one of the others first. An input that is not an object with a string id is left
   * for its own checks to report.
   */
  reserve(inputs: readonly unknown[]): void {
    inputs.forEach((input) => {
      const id =
        typeof input === 'object' && input !== null
          ? (input as { readonly id?: unknown }).id
          : undefined;

      if (typeof id === 'string') {
        this.note(id);
      }
    });
  }
}

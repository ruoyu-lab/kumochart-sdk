export type Listener<T> = (event: T) => void;
export type Unsubscribe = () => void;

/**
 * Typed event bus with deferred dispatch. While an operation runs inside {@link defer}, emitted
 * events are queued and dispatched only after the outermost operation completes, so listeners
 * never observe a half-applied state and can safely call back into the chart.
 *
 * Every listener is called even if another one throws; the first error is rethrown afterwards.
 */
export class EventBus<EventMap extends object> {
  private readonly listeners = new Map<keyof EventMap, Set<Listener<never>>>();
  private readonly queue: Array<{ type: keyof EventMap; event: unknown }> = [];
  private depth = 0;
  private flushing = false;

  on<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>): Unsubscribe {
    let set = this.listeners.get(type);

    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }

    set.add(listener);

    return () => {
      const current = this.listeners.get(type);
      current?.delete(listener);

      if (current?.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  /** Whether anyone listens to `type`; lets producers skip building expensive payloads. */
  has(type: keyof EventMap): boolean {
    return this.listeners.has(type);
  }

  emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    if (!this.listeners.has(type)) {
      return;
    }

    this.queue.push({ type, event });

    if (this.depth === 0) {
      this.flush();
    }
  }

  /** Runs `operation` and dispatches the events it emitted once it (and any outer operation) ends. */
  defer<T>(operation: () => T): T {
    this.depth += 1;

    try {
      return operation();
    } finally {
      this.depth -= 1;

      if (this.depth === 0) {
        this.flush();
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.queue.length = 0;
  }

  private flush(): void {
    if (this.flushing) {
      return;
    }

    this.flushing = true;
    const errors: unknown[] = [];

    try {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        const listeners = this.listeners.get(item.type);

        if (!listeners) {
          continue;
        }

        for (const listener of [...listeners]) {
          try {
            (listener as Listener<unknown>)(item.event);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      this.flushing = false;
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple chart event listeners threw.');
    }
  }
}

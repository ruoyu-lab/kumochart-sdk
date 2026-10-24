/** Fixed-capacity cache that evicts the least recently used entry. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);

    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }

    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);

    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();

      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
  }

  getOrCreate(key: K, create: () => V): V {
    const cached = this.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const value = create();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

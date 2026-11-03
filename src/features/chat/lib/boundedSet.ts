/**
 * Insertion-ordered bounded set. Recent membership is exact; the oldest IDs are
 * forgotten once the limit is exceeded so long-lived controllers do not grow
 * without bound. Used for "already deleted" fences, where forgetting an ancient
 * ID only loses a defensive check on a row the backend no longer returns.
 */
export class BoundedSet {
  private items = new Set<string>();
  constructor(private readonly limit = 512) {}

  add(id: string) {
    this.items.delete(id);
    this.items.add(id);
    while (this.items.size > this.limit) {
      const oldest = this.items.values().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }

  delete(id: string) {
    this.items.delete(id);
  }

  has(id: string) {
    return this.items.has(id);
  }

  get size() {
    return this.items.size;
  }
}

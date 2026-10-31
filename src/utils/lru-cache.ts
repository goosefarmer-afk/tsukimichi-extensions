interface LruCacheOptions {
  maxSize?: number;
}

export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize = 30;

  constructor(options?: LruCacheOptions) {
    if (options?.maxSize != null) {
      this.maxSize = options.maxSize;
    }
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  getOrSet(key: K, value: V): V {
    return this.cache.getOrInsert(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

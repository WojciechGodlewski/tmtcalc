/**
 * Simple in-memory TTL cache
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheOptions {
  /** Time to live in milliseconds */
  ttlMs: number;
  /** Maximum number of entries (LRU eviction) */
  maxSize?: number;
}

/**
 * Creates an in-memory cache with TTL support
 */
export function createCache<T>(options: CacheOptions) {
  const { ttlMs, maxSize = 1000 } = options;
  const cache = new Map<string, CacheEntry<T>>();

  /**
   * Normalize cache key (lowercase, trim, collapse whitespace)
   */
  function normalizeKey(key: string): string {
    return key.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Remove expired entries
   */
  function cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }

  /**
   * Evict oldest entries if cache is full
   */
  function evictIfNeeded(): void {
    if (cache.size >= maxSize) {
      // Delete first (oldest) entries
      const toDelete = Math.ceil(maxSize * 0.1); // Remove 10%
      let deleted = 0;
      for (const key of cache.keys()) {
        if (deleted >= toDelete) break;
        cache.delete(key);
        deleted++;
      }
    }
  }

  /**
   * Get value from cache
   */
  function get(key: string): T | undefined {
    const normalized = normalizeKey(key);
    const entry = cache.get(normalized);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      cache.delete(normalized);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set value in cache
   */
  function set(key: string, value: T): void {
    cleanup();
    evictIfNeeded();

    const normalized = normalizeKey(key);
    cache.set(normalized, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  function has(key: string): boolean {
    return get(key) !== undefined;
  }

  /**
   * Clear all entries
   */
  function clear(): void {
    cache.clear();
  }

  /**
   * Get current cache size
   */
  function size(): number {
    cleanup();
    return cache.size;
  }

  return { get, set, has, clear, size };
}

export type Cache<T> = ReturnType<typeof createCache<T>>;

/**
 * Cache TTL kecil untuk hasil pencarian/audit skills.sh (skills.sh sendiri
 * cache 30-60 detik). Ukuran dibatasi; saat penuh, entri tertua dibuang.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

export interface TtlCache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export function createTtlCache(now: () => number): TtlCache {
  const cache = new Map<string, { at: number; value: unknown }>();

  function get<T>(key: string): T | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  function set(key: string, value: unknown): void {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: now(), value });
  }

  return { get, set };
}

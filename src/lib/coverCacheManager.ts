/**
 * Mobile Cover Art Cache Manager with Bounded LRU Eviction Policy.
 * Prevents disk and memory bloat on mobile devices by bounding cached thumbnails.
 */

export interface CoverCacheStats {
  count: number;
  totalBytes: number;
  maxBytes: number;
  maxCount: number;
}

export interface CachedCoverEntry {
  url: string;
  blob: Blob;
  sizeBytes: number;
  cachedAt: number;
  lastAccessedAt: number;
  accessSeq: number;
}

const CACHE_NAME = "soundify-covers-v1";
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const DEFAULT_MAX_COUNT = 120; // Max 120 cached cover thumbnails
const MAX_ACTIVE_OBJECT_URLS = 40; // Max active blob Object URLs held in native memory

let maxCacheBytes = DEFAULT_MAX_BYTES;
let maxCacheCount = DEFAULT_MAX_COUNT;
let accessSequence = 0;

// In-memory fallback and fast URL lookup
const memoryCache = new Map<string, CachedCoverEntry>();
const memoryObjectUrls = new Map<string, string>();
const activeObjectUrlOrder: string[] = [];
const inFlightPrefetches = new Map<string, Promise<boolean>>();

export function configureCoverCache(config: { maxBytes?: number; maxCount?: number }): void {
  if (typeof config.maxBytes === "number" && config.maxBytes > 0) {
    maxCacheBytes = config.maxBytes;
  }
  if (typeof config.maxCount === "number" && config.maxCount > 0) {
    maxCacheCount = config.maxCount;
  }
}

export function getCoverCacheLimits(): { maxBytes: number; maxCount: number } {
  return { maxBytes: maxCacheBytes, maxCount: maxCacheCount };
}

export function isCoverCached(url: string): boolean {
  if (!url) return false;
  return memoryCache.has(url);
}

function hasCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function rememberObjectUrl(url: string, objUrl: string): void {
  // Evict oldest Object URL if over cap
  while (activeObjectUrlOrder.length >= MAX_ACTIVE_OBJECT_URLS) {
    const oldest = activeObjectUrlOrder.shift();
    if (oldest && oldest !== url) {
      const oldObj = memoryObjectUrls.get(oldest);
      if (oldObj && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try { URL.revokeObjectURL(oldObj); } catch {}
      }
      memoryObjectUrls.delete(oldest);
    }
  }

  const existingIdx = activeObjectUrlOrder.indexOf(url);
  if (existingIdx >= 0) {
    activeObjectUrlOrder.splice(existingIdx, 1);
  }
  activeObjectUrlOrder.push(url);
  memoryObjectUrls.set(url, objUrl);
}

/**
 * Retrieves a cached cover as an Object URL or data URL if available.
 */
export async function getCachedCoverUrl(url: string): Promise<string | null> {
  if (!url) return null;

  // 1. Check in-memory object URL
  if (memoryObjectUrls.has(url)) {
    touchAccess(url);
    const existingIdx = activeObjectUrlOrder.indexOf(url);
    if (existingIdx >= 0) {
      activeObjectUrlOrder.splice(existingIdx, 1);
    }
    activeObjectUrlOrder.push(url);
    return memoryObjectUrls.get(url)!;
  }

  // 2. Check in-memory blob cache
  const memEntry = memoryCache.get(url);
  if (memEntry) {
    touchAccess(url);
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      try {
        const objUrl = URL.createObjectURL(memEntry.blob);
        rememberObjectUrl(url, objUrl);
        return objUrl;
      } catch {}
    }
  }

  // 3. Check CacheStorage if supported
  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const res = await cache.match(url);
      if (res && res.ok) {
        const blob = await res.blob();
        touchAccess(url);
        memoryCache.set(url, {
          url,
          blob,
          sizeBytes: blob.size,
          cachedAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessSeq: ++accessSequence,
        });
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          const objUrl = URL.createObjectURL(blob);
          rememberObjectUrl(url, objUrl);
          return objUrl;
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Stores a cover image blob into cache and enforces bounded LRU capacity.
 */
export async function cacheCoverImage(url: string, blob: Blob): Promise<string | null> {
  if (!url || !blob) return null;

  const sizeBytes = blob.size;
  await enforceCoverCacheBudget(sizeBytes);

  const entry: CachedCoverEntry = {
    url,
    blob,
    sizeBytes,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessSeq: ++accessSequence,
  };

  memoryCache.set(url, entry);
  touchAccess(url);

  let objectUrl: string | null = null;
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const existing = memoryObjectUrls.get(url);
      if (existing) {
        try { URL.revokeObjectURL(existing); } catch {}
      }
      objectUrl = URL.createObjectURL(blob);
      rememberObjectUrl(url, objectUrl);
    } catch {}
  }

  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const res = new Response(blob, {
        headers: {
          "Content-Type": blob.type || "image/jpeg",
          "Content-Length": String(blob.size),
          "X-Cached-At": String(Date.now()),
        },
      });
      await cache.put(url, res);
    } catch {}
  }

  return objectUrl;
}

/**
 * Prefetches a cover image over the network and caches it in the background with deduplication.
 */
export async function prefetchCover(url: string): Promise<boolean> {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return false;

  // Already cached?
  if (memoryCache.has(url)) return true;

  // In-flight deduplication
  if (inFlightPrefetches.has(url)) {
    return inFlightPrefetches.get(url)!;
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, {
        priority: "low" as RequestPriority,
        cache: "force-cache",
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      await cacheCoverImage(url, blob);
      return true;
    } catch {
      return false;
    } finally {
      inFlightPrefetches.delete(url);
    }
  })();

  inFlightPrefetches.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * Enforces LRU eviction if cache exceeds maxBytes or maxCount.
 */
export async function enforceCoverCacheBudget(incomingBytes = 0): Promise<{ evictedCount: number; freedBytes: number }> {
  let evictedCount = 0;
  let freedBytes = 0;

  let totalSize = Array.from(memoryCache.values()).reduce((sum, e) => sum + e.sizeBytes, 0) + incomingBytes;
  let count = memoryCache.size + (incomingBytes > 0 ? 1 : 0);

  if (totalSize <= maxCacheBytes && count <= maxCacheCount) {
    return { evictedCount, freedBytes };
  }

  // Sort by LRU: lowest accessSeq / lastAccessedAt first
  const sorted = Array.from(memoryCache.values()).sort((a, b) => (a.accessSeq - b.accessSeq) || (a.lastAccessedAt - b.lastAccessedAt));

  for (const entry of sorted) {
    if (totalSize <= maxCacheBytes && count <= maxCacheCount) {
      break;
    }

    // Revoke object url if present
    const objUrl = memoryObjectUrls.get(entry.url);
    if (objUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try { URL.revokeObjectURL(objUrl); } catch {}
    }
    memoryObjectUrls.delete(entry.url);
    const orderIdx = activeObjectUrlOrder.indexOf(entry.url);
    if (orderIdx >= 0) activeObjectUrlOrder.splice(orderIdx, 1);

    memoryCache.delete(entry.url);

    if (hasCacheStorage()) {
      try {
        const cache = await window.caches.open(CACHE_NAME);
        await cache.delete(entry.url);
      } catch {}
    }

    totalSize -= entry.sizeBytes;
    freedBytes += entry.sizeBytes;
    count--;
    evictedCount++;
  }

  return { evictedCount, freedBytes };
}

function touchAccess(url: string): void {
  const entry = memoryCache.get(url);
  if (entry) {
    entry.lastAccessedAt = Date.now();
    entry.accessSeq = ++accessSequence;
  }
}

/**
 * Clears entire cover art cache and releases memory.
 */
export async function clearCoverCache(): Promise<void> {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const url of memoryObjectUrls.values()) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }
  memoryObjectUrls.clear();
  activeObjectUrlOrder.length = 0;
  memoryCache.clear();
  inFlightPrefetches.clear();
  accessSequence = 0;

  if (hasCacheStorage()) {
    try {
      await window.caches.delete(CACHE_NAME);
    } catch {}
  }
}

/**
 * Returns current stats of cover art cache.
 */
export async function getCoverCacheStats(): Promise<CoverCacheStats> {
  const totalBytes = Array.from(memoryCache.values()).reduce((sum, e) => sum + e.sizeBytes, 0);
  return {
    count: memoryCache.size,
    totalBytes,
    maxBytes: maxCacheBytes,
    maxCount: maxCacheCount,
  };
}

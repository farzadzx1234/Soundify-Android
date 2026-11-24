/**
 * Mobile Cover Art Cache Manager with Bounded LRU Eviction Policy.
 * Persists thumbnails in CacheStorage with a compact localStorage LRU index so
 * playlist and played track covers survive restarts without unbounded storage growth.
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

interface PersistedCoverMeta {
  url: string;
  sizeBytes: number;
  cachedAt: number;
  lastAccessedAt: number;
  accessSeq: number;
}

const CACHE_NAME = "soundify-covers-v1";
const INDEX_LS_KEY = "soundify_cover_cache_index_v1";
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const DEFAULT_MAX_COUNT = 120; // Max 120 cached cover thumbnails
const MAX_ACTIVE_OBJECT_URLS = 48; // Bounded active blob Object URLs in memory

let maxCacheBytes = DEFAULT_MAX_BYTES;
let maxCacheCount = DEFAULT_MAX_COUNT;
let accessSequence = 0;

const memoryCache = new Map<string, CachedCoverEntry>();
const persistedIndex = new Map<string, PersistedCoverMeta>();
const memoryObjectUrls = new Map<string, string>();
const activeObjectUrlOrder: string[] = [];
const inFlightPrefetches = new Map<string, Promise<boolean>>();
let indexHydrated = false;

function hydratePersistedIndex(): void {
  if (indexHydrated) return;
  indexHydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage?.getItem(INDEX_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedCoverMeta[];
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (item && typeof item.url === "string" && item.url && typeof item.sizeBytes === "number" && item.sizeBytes > 0) {
        persistedIndex.set(item.url, {
          url: item.url,
          sizeBytes: item.sizeBytes,
          cachedAt: Number(item.cachedAt) || Date.now(),
          lastAccessedAt: Number(item.lastAccessedAt) || Date.now(),
          accessSeq: Number(item.accessSeq) || ++accessSequence,
        });
        accessSequence = Math.max(accessSequence, Number(item.accessSeq) || 0);
      }
    }
  } catch {}
}

function persistIndexToStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(INDEX_LS_KEY, JSON.stringify(Array.from(persistedIndex.values())));
  } catch {}
}

function buildLookupCandidates(rawUrl: string): string[] {
  const url = (rawUrl || "").trim();
  if (!url) return [];
  const out = [url];
  try {
    const u = new URL(url, "https://soundify.invalid");
    if (u.pathname.startsWith("/api/")) {
      const rel = `${u.pathname}${u.search}`;
      if (rel !== url) out.push(rel);
    }
  } catch {}
  return out;
}

function isValidCacheableCoverBlob(blob: Blob | null | undefined): blob is Blob {
  if (!blob || blob.size <= 0) return false;
  const type = (blob.type || "").toLowerCase();
  if (type && (!type.startsWith("image/") || type.includes("svg"))) {
    return false;
  }
  return true;
}

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
  hydratePersistedIndex();
  for (const cand of buildLookupCandidates(url)) {
    if (memoryCache.has(cand) || persistedIndex.has(cand)) return true;
  }
  return false;
}

function hasCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function rememberObjectUrl(url: string, objUrl: string): void {
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
 * Retrieves a cached cover as an Object URL if available in memory or persistent CacheStorage.
 */
export async function getCachedCoverUrl(url: string): Promise<string | null> {
  if (!url) return null;
  hydratePersistedIndex();
  const candidates = buildLookupCandidates(url);

  for (const cand of candidates) {
    if (memoryObjectUrls.has(cand)) {
      touchAccess(cand);
      const existingIdx = activeObjectUrlOrder.indexOf(cand);
      if (existingIdx >= 0) {
        activeObjectUrlOrder.splice(existingIdx, 1);
      }
      activeObjectUrlOrder.push(cand);
      return memoryObjectUrls.get(cand)!;
    }

    const memEntry = memoryCache.get(cand);
    if (memEntry) {
      touchAccess(cand);
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        try {
          const objUrl = URL.createObjectURL(memEntry.blob);
          rememberObjectUrl(cand, objUrl);
          return objUrl;
        } catch {}
      }
    }
  }

  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      for (const cand of candidates) {
        const res = await cache.match(cand);
        if (res && res.ok) {
          const blob = await res.blob();
          if (!isValidCacheableCoverBlob(blob)) {
            await cache.delete(cand).catch(() => {});
            persistedIndex.delete(cand);
            persistIndexToStorage();
            continue;
          }
          const seq = ++accessSequence;
          const now = Date.now();
          memoryCache.set(cand, {
            url: cand,
            blob,
            sizeBytes: blob.size,
            cachedAt: now,
            lastAccessedAt: now,
            accessSeq: seq,
          });
          persistedIndex.set(cand, {
            url: cand,
            sizeBytes: blob.size,
            cachedAt: persistedIndex.get(cand)?.cachedAt ?? now,
            lastAccessedAt: now,
            accessSeq: seq,
          });
          persistIndexToStorage();
          if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            const objUrl = URL.createObjectURL(blob);
            rememberObjectUrl(cand, objUrl);
            return objUrl;
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Stores a cover image blob into persistent CacheStorage and enforces bounded LRU capacity.
 */
export async function cacheCoverImage(url: string, blob: Blob): Promise<string | null> {
  if (!url || !isValidCacheableCoverBlob(blob)) return null;
  hydratePersistedIndex();

  const sizeBytes = blob.size;
  await enforceCoverCacheBudget(sizeBytes);

  const now = Date.now();
  const seq = ++accessSequence;
  const entry: CachedCoverEntry = {
    url,
    blob,
    sizeBytes,
    cachedAt: now,
    lastAccessedAt: now,
    accessSeq: seq,
  };

  memoryCache.set(url, entry);
  persistedIndex.set(url, {
    url,
    sizeBytes,
    cachedAt: now,
    lastAccessedAt: now,
    accessSeq: seq,
  });
  persistIndexToStorage();

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
          "X-Cached-At": String(now),
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
  hydratePersistedIndex();

  if (isCoverCached(url)) return true;

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
      if (!isValidCacheableCoverBlob(blob)) return false;
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
 * Concurrency-bounded batch prefetcher for playlist tracks and queues so covers cache smoothly.
 */
export async function prefetchCoverBatch(
  urls: string[],
  options: { concurrency?: number; maxItems?: number } = {},
): Promise<number> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const maxItems = Math.max(1, options.maxItems ?? 40);
  const queue = Array.from(
    new Set(
      urls
        .map((u) => (u || "").trim())
        .filter((u) => u && !u.startsWith("data:") && !u.startsWith("blob:") && !u.startsWith("/covers/") && !u.startsWith("/icons/") && !isCoverCached(u)),
    ),
  ).slice(0, maxItems);

  if (queue.length === 0) return 0;

  let index = 0;
  let cachedCount = 0;
  const worker = async () => {
    while (index < queue.length) {
      const target = queue[index++];
      if (!target) break;
      const ok = await prefetchCover(target).catch(() => false);
      if (ok) cachedCount++;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return cachedCount;
}

/**
 * Enforces bounded LRU eviction across both memory and persistent CacheStorage.
 */
export async function enforceCoverCacheBudget(incomingBytes = 0): Promise<{ evictedCount: number; freedBytes: number }> {
  hydratePersistedIndex();
  let evictedCount = 0;
  let freedBytes = 0;

  // Union of persistedIndex and memoryCache metadata for accurate cross-session totals
  const merged = new Map<string, PersistedCoverMeta>();
  for (const [k, v] of persistedIndex.entries()) {
    merged.set(k, v);
  }
  for (const [k, v] of memoryCache.entries()) {
    merged.set(k, {
      url: k,
      sizeBytes: v.sizeBytes,
      cachedAt: v.cachedAt,
      lastAccessedAt: v.lastAccessedAt,
      accessSeq: v.accessSeq,
    });
  }

  let totalSize = Array.from(merged.values()).reduce((sum, e) => sum + e.sizeBytes, 0) + incomingBytes;
  let count = merged.size + (incomingBytes > 0 ? 1 : 0);

  if (totalSize <= maxCacheBytes && count <= maxCacheCount) {
    return { evictedCount, freedBytes };
  }

  const sorted = Array.from(merged.values()).sort(
    (a, b) => a.accessSeq - b.accessSeq || a.lastAccessedAt - b.lastAccessedAt,
  );

  let cache: Cache | null = null;
  if (hasCacheStorage()) {
    try {
      cache = await window.caches.open(CACHE_NAME);
    } catch {}
  }

  for (const entry of sorted) {
    if (totalSize <= maxCacheBytes && count <= maxCacheCount) {
      break;
    }

    const objUrl = memoryObjectUrls.get(entry.url);
    if (objUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try { URL.revokeObjectURL(objUrl); } catch {}
    }
    memoryObjectUrls.delete(entry.url);
    const orderIdx = activeObjectUrlOrder.indexOf(entry.url);
    if (orderIdx >= 0) activeObjectUrlOrder.splice(orderIdx, 1);

    memoryCache.delete(entry.url);
    persistedIndex.delete(entry.url);

    if (cache) {
      try {
        await cache.delete(entry.url);
      } catch {}
    }

    totalSize -= entry.sizeBytes;
    freedBytes += entry.sizeBytes;
    count--;
    evictedCount++;
  }

  if (evictedCount > 0) {
    persistIndexToStorage();
  }

  return { evictedCount, freedBytes };
}

function touchAccess(url: string): void {
  const now = Date.now();
  const seq = ++accessSequence;
  const entry = memoryCache.get(url);
  if (entry) {
    entry.lastAccessedAt = now;
    entry.accessSeq = seq;
  }
  const meta = persistedIndex.get(url);
  if (meta) {
    meta.lastAccessedAt = now;
    meta.accessSeq = seq;
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
  persistedIndex.clear();
  inFlightPrefetches.clear();
  accessSequence = 0;
  indexHydrated = true;

  if (typeof window !== "undefined") {
    try {
      window.localStorage?.removeItem(INDEX_LS_KEY);
    } catch {}
  }

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
  hydratePersistedIndex();
  const countMap = new Map<string, number>();
  for (const [k, v] of persistedIndex.entries()) countMap.set(k, v.sizeBytes);
  for (const [k, v] of memoryCache.entries()) countMap.set(k, v.sizeBytes);
  const totalBytes = Array.from(countMap.values()).reduce((sum, bytes) => sum + bytes, 0);
  return {
    count: countMap.size,
    totalBytes,
    maxBytes: maxCacheBytes,
    maxCount: maxCacheCount,
  };
}

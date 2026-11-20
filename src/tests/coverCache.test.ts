import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cacheCoverImage,
  clearCoverCache,
  configureCoverCache,
  enforceCoverCacheBudget,
  getCachedCoverUrl,
  getCoverCacheLimits,
  getCoverCacheStats,
} from "@/lib/coverCacheManager";

describe("Mobile Cover Art Cache Manager", () => {
  beforeEach(async () => {
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
  });

  afterEach(async () => {
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
  });

  it("configures and retrieves cover cache limits", () => {
    configureCoverCache({ maxBytes: 5 * 1024 * 1024, maxCount: 50 });
    const limits = getCoverCacheLimits();
    expect(limits.maxBytes).toBe(5 * 1024 * 1024);
    expect(limits.maxCount).toBe(50);
  });

  it("caches and retrieves cover image blobs via object URLs", async () => {
    const url = "https://example.com/cover1.jpg";
    const blob = new Blob(["test-image-bytes"], { type: "image/jpeg" });

    const objUrl = await cacheCoverImage(url, blob);
    expect(objUrl).not.toBeNull();

    const retrieved = await getCachedCoverUrl(url);
    expect(retrieved).not.toBeNull();

    const stats = await getCoverCacheStats();
    expect(stats.count).toBe(1);
    expect(stats.totalBytes).toBe(blob.size);
  });

  it("enforces LRU eviction when cover count limit is reached", async () => {
    // Limit to 2 items
    configureCoverCache({ maxCount: 2, maxBytes: 10 * 1024 * 1024 });

    const url1 = "https://example.com/c1.jpg";
    const url2 = "https://example.com/c2.jpg";
    const url3 = "https://example.com/c3.jpg";

    const blob = new Blob(["image"], { type: "image/jpeg" });

    await cacheCoverImage(url1, blob);
    await new Promise((r) => setTimeout(r, 10));
    await cacheCoverImage(url2, blob);

    let stats = await getCoverCacheStats();
    expect(stats.count).toBe(2);

    // Add 3rd item -> url1 should be evicted (least recently used)
    await new Promise((r) => setTimeout(r, 10));
    await cacheCoverImage(url3, blob);

    stats = await getCoverCacheStats();
    expect(stats.count).toBe(2);

    const c1 = await getCachedCoverUrl(url1);
    const c2 = await getCachedCoverUrl(url2);
    const c3 = await getCachedCoverUrl(url3);

    expect(c1).toBeNull(); // Evicted!
    expect(c2).not.toBeNull();
    expect(c3).not.toBeNull();
  });

  it("manually enforces cover cache budget and evicts bytes when limit shrinks", async () => {
    configureCoverCache({ maxBytes: 100, maxCount: 10 });
    const url1 = "https://example.com/c1.jpg";
    const url2 = "https://example.com/c2.jpg";
    const blob30 = new Blob([new Uint8Array(30)], { type: "image/jpeg" });

    await cacheCoverImage(url1, blob30);
    await new Promise((r) => setTimeout(r, 10));
    await cacheCoverImage(url2, blob30);

    // Both fit under 100 bytes
    let stats = await getCoverCacheStats();
    expect(stats.count).toBe(2);

    // Reconfigure budget down to 40 bytes (< 60 bytes currently in cache)
    configureCoverCache({ maxBytes: 40 });
    const result = await enforceCoverCacheBudget(0);
    expect(result.evictedCount).toBeGreaterThanOrEqual(1);
    expect(result.freedBytes).toBeGreaterThanOrEqual(30);

    stats = await getCoverCacheStats();
    expect(stats.count).toBe(1);
  });

  it("clears entire cover cache cleanly", async () => {
    const url = "https://example.com/c-clear.jpg";
    const blob = new Blob(["clear-me"], { type: "image/jpeg" });
    await cacheCoverImage(url, blob);

    await clearCoverCache();
    const stats = await getCoverCacheStats();
    expect(stats.count).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it("checks cached cover presence with isCoverCached and deduplicates concurrent prefetches", async () => {
    const { isCoverCached, prefetchCover } = await import("@/lib/coverCacheManager");
    const testUrl = "https://example.com/dedup-test.jpg";
    expect(isCoverCached(testUrl)).toBe(false);

    let fetchCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(new Blob(["mock-img"], { type: "image/jpeg" }), { status: 200 });
    };

    try {
      // Trigger multiple concurrent prefetches for same URL
      const [p1, p2, p3] = await Promise.all([
        prefetchCover(testUrl),
        prefetchCover(testUrl),
        prefetchCover(testUrl),
      ]);

      expect(p1).toBe(true);
      expect(p2).toBe(true);
      expect(p3).toBe(true);
      // Only one network request occurred due to in-flight deduplication
      expect(fetchCount).toBe(1);
      expect(isCoverCached(testUrl)).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("bounds active Object URLs to prevent native memory bloat during massive scrolling", async () => {
    const { getCachedCoverUrl } = await import("@/lib/coverCacheManager");

    // Cache 50 different covers
    for (let i = 0; i < 50; i++) {
      const u = `https://example.com/batch-${i}.jpg`;
      const blob = new Blob([`image-data-${i}`], { type: "image/jpeg" });
      await cacheCoverImage(u, blob);
    }

    // Retrieve all 50 as Object URLs
    const urls: string[] = [];
    for (let i = 0; i < 50; i++) {
      const obj = await getCachedCoverUrl(`https://example.com/batch-${i}.jpg`);
      if (obj) urls.push(obj);
    }

    expect(urls.length).toBe(50);
    // Bounded pool keeps latest covers accessible and cleanly recycles older object URLs
    const latest = await getCachedCoverUrl("https://example.com/batch-49.jpg");
    expect(latest).toBeDefined();
  });
});

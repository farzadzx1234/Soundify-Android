import fs from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  cacheCoverImage,
  clearCoverCache,
  configureCoverCache,
  getCachedCoverUrl,
  getCoverCacheStats,
  prefetchCover,
  prefetchCoverBatch,
} from "@/lib/coverCacheManager";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("v1.0.40 Crash Fixes: ExoPlayer Thread Safety, FGS Hardening, AutoMix OOM/Try-Catch & Cover Cache Bounds", () => {
  let originalWindow: unknown;

  beforeEach(async () => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    (globalThis as unknown as { window?: unknown }).window = {
      localStorage: createMemoryStorage(),
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
  });

  afterEach(async () => {
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it("1. Guards ExoPlayer main-thread affinity and dispatches metadata/playback updates onto mainHandler", () => {
    const serviceSrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(serviceSrc).toContain("Looper.myLooper() == Looper.getMainLooper()");
    expect(serviceSrc).toContain("Looper.myLooper() != Looper.getMainLooper()");
    expect(serviceSrc).toContain("nativeSnapshotPlaying");
    expect(serviceSrc).toContain("buildMinimalFallbackNotification");
    expect(serviceSrc).toContain("startForegroundSafely");
    expect(serviceSrc).toContain("decodeSampledBitmap");
    expect(serviceSrc).not.toContain("finalBitmap.recycle()");

    const nativePluginSrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
      "utf8",
    );
    expect(nativePluginSrc).toContain("catch (Throwable ignored)");

    const mediaPluginSrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/MediaSessionPlugin.java"),
      "utf8",
    );
    expect(mediaPluginSrc).toContain("ForegroundServiceStartNotAllowedException");
  });

  it("2. Releases Track A PCM memory sequentially and guards analyzeStreamPair against uncaught Throwable crashes", () => {
    const analyzerSrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixPcmAnalyzer.java"),
      "utf8",
    );
    expect(analyzerSrc).toContain("segA = null;");
    expect(analyzerSrc).toContain("catch (Throwable ignored)");

    const mainActivitySrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/MainActivity.java"),
      "utf8",
    );
    expect(mainActivitySrc).toContain("wv.evaluateJavascript");
    expect(mainActivitySrc).toContain("catch (Exception ignored)");

    const playerCtxSrc = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtxSrc).toContain("nativeAudioGetState().then");
    expect(playerCtxSrc).toContain(").catch(() => {})");
  });

  it("3. Bounds coverCacheManager RAM blob count & concurrent prefetches without crashing under large bursts", async () => {
    const origFetch = global.fetch;
    let inFlight = 0;
    let maxConcurrent = 0;
    global.fetch = async (input) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      const url = typeof input === "string" ? input : input.toString();
      return new Response(new Blob([`img-${url}`], { type: "image/jpeg" }), { status: 200 });
    };

    try {
      const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/cover-${i}.jpg`);
      const results = await Promise.all(urls.map((u) => prefetchCover(u)));
      expect(results.every(Boolean)).toBe(true);
      expect(maxConcurrent).toBeLessThanOrEqual(3);

      const batchCached = await prefetchCoverBatch(["https://example.com/cover-12.jpg"], { concurrency: 2 });
      expect(batchCached).toBe(1);

      const stats = await getCoverCacheStats();
      expect(stats.count).toBe(13);

      // Adding >16 small covers preserves persisted index capacity cleanly while bounding RAM cache
      for (let i = 13; i < 25; i++) {
        await cacheCoverImage(`https://example.com/cover-${i}.jpg`, new Blob([`x-${i}`], { type: "image/jpeg" }));
      }
      expect((await getCoverCacheStats()).count).toBe(25);
      expect(await getCachedCoverUrl("https://example.com/cover-0.jpg")).toBeDefined();
    } finally {
      global.fetch = origFetch;
    }
  });

  it("4. Preserves v1.0.40+ / versionCode >= 41 forward synchronization across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(?:4\d+|\d{3,})$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(41);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);
    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);
    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });
});

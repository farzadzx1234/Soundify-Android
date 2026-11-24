import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { api } from "@/lib/api";
import { djCrossfadeGains } from "@/lib/smartAutoMix";

describe("Soundify v1.0.26 Upfront DJ AutoMix UI, 60fps Curve & Global Search Pagination", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("synchronizes v1.0.26+ / versionCode >= 27 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(2[6-9]|[3-9]\d)/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(27);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toBe(APP_VERSION);

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });

  it("computes silky monotonic DJ S-curve crossfade gains with exact 0..1 endpoints", () => {
    expect(djCrossfadeGains(0)).toEqual({ outGain: 1, inGain: 0 });
    expect(djCrossfadeGains(-0.5)).toEqual({ outGain: 1, inGain: 0 });
    expect(djCrossfadeGains(1)).toEqual({ outGain: 0, inGain: 1 });
    expect(djCrossfadeGains(1.5)).toEqual({ outGain: 0, inGain: 1 });

    const mid = djCrossfadeGains(0.5);
    expect(mid.inGain).toBeGreaterThan(0.75);
    expect(mid.inGain).toBeLessThan(0.95);
    expect(mid.outGain).toBeGreaterThan(0.55);
    expect(mid.outGain).toBeLessThan(0.75);

    let prevIn = 0;
    let prevOut = 1;
    for (let i = 1; i <= 10; i++) {
      const p = i / 10;
      const g = djCrossfadeGains(p);
      expect(g.inGain).toBeGreaterThanOrEqual(prevIn);
      expect(g.outGain).toBeLessThanOrEqual(prevOut);
      prevIn = g.inGain;
      prevOut = g.outGain;
    }
  });

  it("wires upfront deck swap, 60fps crossfade ticker, crossfadeFromTrack & artwork dissolve UI", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("mainHandler.postDelayed(this, 16L);");
    expect(service).toContain("outgoingDeck.removeListener(primaryPlayerListener);");
    const startCrossfadeBlock = service.match(/private void executeReadyNativeCrossfade\([\s\S]*?public void cancelNativeCrossfade/);
    expect(startCrossfadeBlock?.[0] ?? "").toContain("nativePlayer = incomingDeck;");
    expect(startCrossfadeBlock?.[0] ?? "").toContain("updateMetadata(");

    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("crossfadeFromTrack");
    expect(playerCtx).toContain("djCrossfadeGains");
    expect(playerCtx).toContain("autoMixRafRef");
    expect(playerCtx).toContain("requestAnimationFrame");

    const overlay = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toContain("sf-automix-dissolve-out");
    expect(overlay).toContain("sf-automix-artwork-in");
    expect(overlay).toContain("crossfadeFromTrack");

    const dock = fs.readFileSync(
      path.resolve(__dirname, "../components/PlayerDock.tsx"),
      "utf8",
    );
    expect(dock).toContain("isCrossfading");

    const css = fs.readFileSync(
      path.resolve(__dirname, "../app/globals.css"),
      "utf8",
    );
    expect(css).toContain("@keyframes sf-automix-dissolve-out");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("supports page >= 2 query expansion, forceRefresh cache-bypass, and Refresh / Load More controls in Search", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      requestedUrls.push(urlStr);
      const u = new URL(urlStr, "https://soundify.mashhad-ix.ir");
      const qParam = u.searchParams.get("q") || "";
      const src = u.searchParams.get("source") || "youtube";
      const key = qParam.replace(/\s+/g, "_");
      return new Response(
        JSON.stringify({
          query: qParam,
          source: src,
          results: [
            {
              id: `ext-${src}-${key}-1`,
              title: `${qParam} Result 1`,
              artistName: "Artist",
              source: src,
              pageUrl: `https://${src}.example/${encodeURIComponent(key)}/1`,
              audioUrl: `/api/stream/external?id=ext-${src}-${key}-1`,
            },
          ],
          total: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const page2 = await api.searchExternal("shadmehr", "all", 36, { page: 2 });
    expect(page2.results.length).toBe(3);
    expect(requestedUrls.some((u) => u.includes("shadmehr+official"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("shadmehr+remix"))).toBe(true);

    requestedUrls.length = 0;
    await api.searchExternal("shadmehr", "youtube", 32, { page: 1, forceRefresh: true });
    expect(requestedUrls.some((u) => u.includes("_r="))).toBe(true);

    const searchPage = fs.readFileSync(
      path.resolve(__dirname, "../app/search/page.tsx"),
      "utf8",
    );
    expect(searchPage).toContain("handleRefreshExternalSearch");
    expect(searchPage).toContain("handleLoadMoreExternal");
    expect(searchPage).toContain("بروزرسانی");
    expect(searchPage).toContain("بارگذاری آهنگ‌های بیشتر");
  });
});

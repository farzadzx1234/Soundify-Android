import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { api } from "@/lib/api";
import { extractTrackReleaseInfo, sortExternalTracksByReleaseDate } from "@/lib/externalSort";
import type { Track } from "@/lib/types";

function makeExtTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: `Track ${overrides.id}`,
    titleFa: `قطعه ${overrides.id}`,
    artistId: "artist-ext",
    artistName: "Artist",
    artistNameFa: "هنرمند",
    artistAvatarColor: "#ef4444",
    album: "YouTube Music",
    albumFa: "یوتیوب موزیک",
    genre: "Pop",
    mood: "Energetic",
    durationSec: 200,
    audioUrl: `/api/stream/external?id=${overrides.id}`,
    coverUrl: `/api/stream/external-cover?id=${overrides.id}`,
    accentColor: "#ef4444",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 0,
    likesCount: 0,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: null,
    source: "youtube",
    ...overrides,
  };
}

describe("Soundify v1.0.25 Global Search Playback, Limit Expansion & Release Date Sorting", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("synchronizes v1.0.25+ / versionCode >= 26 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(2[5-9]|[3-9]\d)/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(26);

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
    expect(gradle).toMatch(/versionCode\s+(2[6-9]|[3-9]\d)/);
    expect(gradle).toMatch(/versionName\s+"1\.0\.(2[5-9]|[3-9]\d)"/);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });

  it("sorts tracks by newest release date across ISO metadata, YYYYMMDD uploadDate, Gregorian/Jalali title years, and SoundCloud IDs", () => {
    const nowMs = Date.UTC(2026, 10, 23, 17, 0, 0);

    const oldest = makeExtTrack({
      id: "ext-youtube-old2019",
      title: "Classic Track (2019)",
      createdAt: new Date(nowMs).toISOString(), // synthetic current timestamp must be ignored
    });
    const ymdTrack = makeExtTrack({
      id: "ext-youtube-ymd2024",
      title: "Track August 2024",
      uploadDate: "20240815",
      createdAt: new Date(nowMs).toISOString(),
    });
    const jalaliPersianTrack = makeExtTrack({
      id: "ext-youtube-jalali1404",
      title: "آهنگ جدید ۱۴۰۴",
      titleFa: "آهنگ جدید ۱۴۰۴",
      createdAt: new Date(nowMs).toISOString(),
    });
    const newestIso = makeExtTrack({
      id: "ext-youtube-iso2026",
      title: "Fresh Drop",
      releaseDate: "2026-09-01T12:00:00Z",
    });
    const scOlder = makeExtTrack({
      id: "ext-soundcloud-1400000000",
      source: "soundcloud",
      title: "SoundCloud Earlier",
    });
    const scNewer = makeExtTrack({
      id: "ext-soundcloud-2150000000",
      source: "soundcloud",
      title: "SoundCloud Recent",
    });
    const undated = makeExtTrack({
      id: "ext-youtube-nodate",
      title: "Untitled Demo",
      createdAt: new Date(nowMs - 10_000).toISOString(), // within 5 min -> synthetic, ignored
    });

    expect(extractTrackReleaseInfo(ymdTrack, nowMs)).toMatchObject({
      displayYear: 2024,
      source: "metadata",
    });
    expect(extractTrackReleaseInfo(jalaliPersianTrack, nowMs)).toMatchObject({
      displayYear: 2025,
      source: "titleYear",
    });
    expect(extractTrackReleaseInfo(scNewer, nowMs).displayYear).toBeNull();
    expect(extractTrackReleaseInfo(scNewer, nowMs).source).toBe("soundcloudId");
    expect(extractTrackReleaseInfo(undated, nowMs)).toEqual({
      timestampMs: null,
      displayYear: null,
      source: "none",
    });

    const sorted = sortExternalTracksByReleaseDate(
      [oldest, undated, scOlder, ymdTrack, jalaliPersianTrack, scNewer, newestIso],
      nowMs,
    );
    expect(sorted[0].id).toBe("ext-youtube-iso2026");
    expect(sorted.indexOf(scNewer)).toBeLessThan(sorted.indexOf(scOlder));
    expect(sorted.indexOf(jalaliPersianTrack)).toBeLessThan(sorted.indexOf(ymdTrack));
    expect(sorted.indexOf(ymdTrack)).toBeLessThan(sorted.indexOf(oldest));
    expect(sorted[sorted.length - 1].id).toBe("ext-youtube-nodate");
  });

  it("fans out parallel provider searches for 'all' to return 30+ unique results and preserves 403 access errors", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      requestedUrls.push(urlStr);
      const u = new URL(urlStr, "https://soundify.mashhad-ix.ir");
      const src = u.searchParams.get("source") || "all";
      const makeBatch = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, i) =>
          makeExtTrack({
            id: `ext-${prefix}-${i + 1}`,
            source: prefix,
            title: `${prefix} Track ${i + 1}`,
            pageUrl: `https://${prefix}.example/track/${i + 1}`,
            audioUrl: `/api/stream/external?id=ext-${prefix}-${i + 1}`,
          }),
        );

      const results =
        src === "youtube"
          ? makeBatch("youtube", 18)
          : src === "soundcloud"
            ? makeBatch("soundcloud", 18)
            : src === "spotify"
              ? makeBatch("spotify", 8)
              : [];

      return new Response(
        JSON.stringify({ query: "shayan", source: src, results, total: results.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const res = await api.searchExternal("shayan", "all", 48);
    expect(res.results.length).toBe(44);
    expect(requestedUrls.some((u) => u.includes("source=youtube&limit=32"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("source=soundcloud&limit=32"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("source=spotify&limit=16"))).toBe(true);

    // Ensure 403 GLOBAL_SEARCH_ACCESS_REQUIRED propagates cleanly when all=48 fan-out runs
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          statusCode: 403,
          error: "Forbidden",
          code: "GLOBAL_SEARCH_ACCESS_REQUIRED",
          message: "دسترسی به جستجوی شبکه‌های جهانی نیازمند تایید مدیر است.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    });
    const denied = await api.searchExternal("shayan", "all", 48);
    expect(denied.code).toBe("GLOBAL_SEARCH_ACCESS_REQUIRED");
    expect(denied.results).toEqual([]);
  });

  it("prevents pause glitches on native track switching and recovers across audio elements", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("isSwitchingNativeTrack");
    expect(service).toContain(".setReadTimeoutMs(60_000)");
    expect(service).toContain("boolean effectivePlaying = nativePlayer.getPlayWhenReady()");

    const playNativeBlock = service.match(/public void playNativeStream\([\s\S]*?public void prepareNextNativeStream/);
    expect(playNativeBlock?.[0] ?? "").not.toContain("nativePlayer.stop()");

    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("function stripFastStartParam");
    expect(playerCtx).toContain('if (isDownloaded || (!nativeAudioActiveRef.current && audio.src.startsWith("blob:"))) return false;');
    expect(playerCtx).toContain("void audioCtxRef.current.suspend().catch(() => {});");
  });
});

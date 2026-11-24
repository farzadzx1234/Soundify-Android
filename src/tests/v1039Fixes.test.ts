import fs from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { areTracksSameIdentity } from "@/lib/trackIdentity";
import {
  addTrackToCustomPlaylist,
  clearCustomPlaylists,
  createCustomPlaylist,
  isTrackInCustomPlaylist,
  removeTrackFromCustomPlaylist,
} from "@/lib/customPlaylists";
import {
  cacheCoverImage,
  clearCoverCache,
  configureCoverCache,
  getCachedCoverUrl,
  getCoverCacheStats,
  isCoverCached,
  prefetchCover,
  prefetchCoverBatch,
} from "@/lib/coverCacheManager";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track>): Track {
  const id = overrides.id ?? "ext-youtube-abc12345678";
  const title = overrides.title ?? "Kam Kam";
  const artistName = overrides.artistName ?? "Shayan Yo";
  return {
    id,
    title,
    titleFa: overrides.titleFa ?? title,
    artistId: "artist-1",
    artistName,
    artistNameFa: overrides.artistNameFa ?? artistName,
    artistAvatarColor: "#6366f1",
    album: "Single",
    albumFa: "تک‌آهنگ",
    genre: "Pop",
    mood: "Chill",
    durationSec: 184,
    audioUrl: `/api/stream/external?id=${encodeURIComponent(id)}`,
    coverUrl: `/api/stream/external-cover?id=${encodeURIComponent(id)}`,
    accentColor: "#6366f1",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 0,
    likesCount: 0,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("v1.0.39 Fixes: Library Remove Modal, Cross-Source Playlist Identity & Bounded Cover Cache", () => {
  let originalWindow: unknown;

  beforeEach(async () => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const storage = createMemoryStorage();
    (globalThis as unknown as { window?: unknown }).window = {
      localStorage: storage,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    clearCustomPlaylists();
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
  });

  afterEach(async () => {
    clearCustomPlaylists();
    await clearCoverCache();
    configureCoverCache({ maxBytes: 25 * 1024 * 1024, maxCount: 120 });
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it("1. Renders Library delete/remove confirmation dialogs via createPortal into document.body", () => {
    const librarySrc = fs.readFileSync(path.resolve(__dirname, "../app/library/page.tsx"), "utf8");
    expect(librarySrc).toContain('import { createPortal } from "react-dom"');
    expect(librarySrc).toContain("confirm-remove-download-title");
    expect(librarySrc).toContain("confirm-remove-playlist-title");
    expect(librarySrc).toContain("createPortal(");
    expect(librarySrc).toContain("document.body");
  });

  it("2. Matches downloaded and device tracks with playlist items across IDs, YouTube IDs, and normalized metadata", () => {
    const onlineTrack = makeTrack({
      id: "ext-youtube-dQw4w9WgXcQ",
      title: "Kam Kam (Official Audio)",
      artistName: "Shayan Yo",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    const downloadedDeviceTrack = makeTrack({
      id: "device-shayan-yo-kam-kam",
      title: "Kam Kam",
      artistName: "Shayan Yo",
      pageUrl: undefined,
      audioUrl: "content://media/external/audio/123",
    });
    const differentTrack = makeTrack({
      id: "ext-soundcloud-999999",
      title: "Different Song",
      artistName: "Another Artist",
      pageUrl: "https://soundcloud.com/other/different-song",
    });

    expect(areTracksSameIdentity(onlineTrack, downloadedDeviceTrack)).toBe(true);
    expect(areTracksSameIdentity(onlineTrack, differentTrack)).toBe(false);

    const created = createCustomPlaylist({ title: "خودم", initialTracks: [onlineTrack] });
    expect(isTrackInCustomPlaylist(created, downloadedDeviceTrack)).toBe(true);
    expect(isTrackInCustomPlaylist(created, differentTrack)).toBe(false);

    // Adding the downloaded variant should NOT create a duplicate entry
    const dupRes = addTrackToCustomPlaylist(created.id, downloadedDeviceTrack);
    expect(dupRes.added).toBe(false);
    expect(dupRes.playlist?.tracks.length).toBe(1);

    // Removing via the downloaded copy removes the matching playlist track cleanly
    const afterRemove = removeTrackFromCustomPlaylist(created.id, downloadedDeviceTrack);
    expect(afterRemove?.tracks.length).toBe(0);
  });

  it("3. Rejects fallback SVG images in cover cache, supports bounded concurrency batch prefetch, and wires UI components", async () => {
    const svgUrl = "https://example.com/fallback-cover.svg";
    const svgRes = await cacheCoverImage(svgUrl, new Blob(["<svg></svg>"], { type: "image/svg+xml" }));
    expect(svgRes).toBeNull();
    expect(isCoverCached(svgUrl)).toBe(false);

    const originalFetch = global.fetch;
    let fetchedCount = 0;
    global.fetch = async (input) => {
      fetchedCount++;
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("broken-svg")) {
        return new Response(new Blob(["<svg/>"], { type: "image/svg+xml" }), { status: 200 });
      }
      return new Response(new Blob([`jpeg-${url}`], { type: "image/jpeg" }), { status: 200 });
    };

    try {
      const okSvg = await prefetchCover("https://example.com/broken-svg");
      expect(okSvg).toBe(false);

      const cached = await prefetchCoverBatch(
        [
          "https://example.com/p1.jpg",
          "https://example.com/p2.jpg",
          "https://example.com/p1.jpg",
          "data:image/png;base64,AAAA",
          "blob:http://localhost/123",
        ],
        { concurrency: 2 },
      );
      expect(cached).toBe(2);
      expect(fetchedCount).toBe(3); // broken-svg + p1 + p2
      expect(await getCachedCoverUrl("https://example.com/p1.jpg")).not.toBeNull();
      const stats = await getCoverCacheStats();
      expect(stats.count).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }

    const optImgSrc = fs.readFileSync(path.resolve(__dirname, "../components/OptimizedTrackImage.tsx"), "utf8");
    expect(optImgSrc).toContain("prefetchCover");
    expect(optImgSrc).toContain("getCachedCoverUrl(httpTarget)");

    const plClientSrc = fs.readFileSync(path.resolve(__dirname, "../app/playlist/[id]/PlaylistClient.tsx"), "utf8");
    expect(plClientSrc).toContain("prefetchCoverBatch");
    expect(plClientSrc).toContain("areTracksSameIdentity");

    const nowPlayingSrc = fs.readFileSync(path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"), "utf8");
    expect(nowPlayingSrc).toContain("isTrackInCustomPlaylist");
  });

  it("4. Synchronizes v1.0.39 / versionCode 40 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toBe("1.0.39");
    expect(APP_BUILD_NUMBER).toBe(40);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe("1.0.39");
    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain("soundify-v1.0.39-b40");
    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain("versionCode 40");
    expect(gradle).toContain('versionName "1.0.39"');
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain('APP_USER_AGENT = "Soundify-Android/1.0.39"');
    expect(service).toContain('APP_VERSION_HEADER = "1.0.39"');
  });
});

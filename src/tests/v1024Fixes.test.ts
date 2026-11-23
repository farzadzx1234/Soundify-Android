import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  clearCustomPlaylists,
  createCustomPlaylist,
  customRecordToPlaylist,
  getCustomPlaylists,
} from "@/lib/customPlaylists";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: `Track ${overrides.id}`,
    titleFa: `قطعه ${overrides.id}`,
    artistId: "artist-1",
    artistName: "Artist",
    artistNameFa: "هنرمند",
    artistAvatarColor: "#6366f1",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Energetic",
    durationSec: 200,
    audioUrl: `/api/tracks/${overrides.id}/stream`,
    coverUrl: `/api/tracks/${overrides.id}/cover`,
    accentColor: "#6366f1",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 10,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
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

describe("Soundify v1.0.24 Smooth AutoMix Handoff & Playlist Cover Fixes", () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const storage = createMemoryStorage();
    (globalThis as unknown as { window?: unknown }).window = {
      localStorage: storage,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    clearCustomPlaylists();
  });

  afterEach(() => {
    clearCustomPlaylists();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it("synchronizes v1.0.24+ / versionCode >= 25 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.2[4-9]/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(25);

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
    expect(gradle).toMatch(/versionCode\s+2[5-9]/);
    expect(gradle).toMatch(/versionName\s+"1\.0\.2[4-9]"/);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });

  it("never stores /covers/track-01.jpg for downloaded tracks and self-heals legacy corrupted playlists", () => {
    const scDownloaded = makeTrack({
      id: "ext-sc-kamkam",
      source: "soundcloud",
      title: "Kam Kam",
      coverUrl: "blob:https://localhost/fake-blob-1",
    });
    const ytDownloaded = makeTrack({
      id: "ext-yt-kirginim",
      source: "youtube",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      coverUrl: "blob:https://localhost/fake-blob-2",
    });

    const created = createCustomPlaylist({
      title: "My Mix",
      initialTracks: [scDownloaded, ytDownloaded],
    });

    expect(created.tracks[0].coverUrl).toBe("");
    expect(created.tracks[1].coverUrl).toContain("/api/stream/external-cover");
    expect(JSON.stringify(created)).not.toContain("/covers/track-01.jpg");

    // Seed a corrupted v1.0.22/v1.0.23 localStorage playlist where both downloaded tracks got overwritten with /covers/track-01.jpg
    const legacyPayload = [
      {
        id: "cpl-legacy-1",
        title: "خودم",
        titleFa: "خودم",
        description: "",
        descriptionFa: "",
        accentColor: "#6366f1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        tracks: [
          makeTrack({ id: "ext-sc-1", coverUrl: "/covers/track-01.jpg" }),
          makeTrack({
            id: "ext-yt-2",
            pageUrl: "https://youtu.be/dQw4w9WgXcQ",
            coverUrl: "/covers/track-01.jpg",
          }),
          makeTrack({ id: "track-01", coverUrl: "/covers/track-01.jpg" }),
        ],
      },
    ];
    window.localStorage.setItem("soundify_custom_playlists_v1", JSON.stringify(legacyPayload));

    const healed = getCustomPlaylists();
    expect(healed).toHaveLength(1);
    expect(healed[0].tracks[0].coverUrl).toBe("");
    expect(healed[0].tracks[1].coverUrl).toContain("dQw4w9WgXcQ");
    expect(healed[0].tracks[2].coverUrl).toBe("/covers/track-01.jpg");

    const asPlaylist = customRecordToPlaylist(healed[0]);
    expect(asPlaylist.coverUrls.some((u) => u === "/covers/track-01.jpg")).toBe(true);
    expect(asPlaylist.coverUrls.filter((u) => u === "/covers/track-01.jpg")).toHaveLength(1);
  });

  it("resolves offline cover blobs by trackId in PlaylistMosaic without hardcoded track-01 fallbacks", () => {
    const mosaic = fs.readFileSync(
      path.resolve(__dirname, "../components/PlaylistMosaic.tsx"),
      "utf8",
    );
    expect(mosaic).toContain("tracks?: PlaylistMosaicTrack[]");
    expect(mosaic).toContain("getCachedCoverBlobUrl");
    expect(mosaic).toContain("getDownloadedCoverBlobUrl");
    expect(mosaic).toContain("resolveMediaUrl");
    expect(mosaic).not.toContain("/covers/track-02.jpg");
    expect(mosaic).not.toContain("track-0${");
  });

  it("prevents stale deckA listeners and ensures smooth dual-deck handoff in Web & Native AutoMix", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("if (audio !== getSingletonAudio()) return;");
    expect(playerCtx).toContain("if (autoMixStartedRef.current && !userPausedIntentRef.current) return;");
    expect(playerCtx).toContain("finalizeWebAutoMixRef");
    expect(playerCtx).toContain('state.event === "crossfadeFailed"');

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain('emitNativeState("crossfadeFailed"');
    expect(service).toContain("outgoingEnded");
    expect(service).toContain("nativePlayer.setPlayWhenReady(true);");
    expect(service).toContain("nativePlayer.play();");

    const bridge = fs.readFileSync(
      path.resolve(__dirname, "../lib/nativeAudioBridge.ts"),
      "utf8",
    );
    expect(bridge).toContain('"crossfadeFailed"');
  });
});

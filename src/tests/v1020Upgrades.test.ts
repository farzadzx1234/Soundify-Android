import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { api } from "@/lib/api";
import { APP_VERSION, APP_BUILD_NUMBER } from "@/lib/appVersion";
import {
  clearExportedTrackMemory,
  exportTrackToDeviceStorage,
} from "@/lib/mediaExport";
import {
  clearAllDownloadedTracks,
  saveDownloadedTrack,
} from "@/lib/offlineAudioStorage";
import {
  buildPersonalizedMixes,
  clearListeningProfile,
  getListeningProfile,
  recordListeningEvent,
} from "@/lib/listeningPersonalization";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: `Track ${overrides.id}`,
    titleFa: `قطعه ${overrides.id}`,
    artistId: "artist-1",
    artistName: "Test Artist",
    artistNameFa: "هنرمند آزمایشی",
    artistAvatarColor: "#6366f1",
    album: "Test Album",
    albumFa: "آلبوم آزمایشی",
    genre: "Pop",
    mood: "Chill",
    durationSec: 195,
    audioUrl: `/api/tracks/${overrides.id}/stream`,
    coverUrl: `/api/tracks/${overrides.id}/cover`,
    accentColor: "#6366f1",
    waveform: [0.2, 0.5, 0.7, 0.4],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 5,
    repostsCount: 1,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: "admin",
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

describe("Soundify v1.0.20 Upgrades & Regression Suite", () => {
  let originalWindow: unknown;
  let originalFetch: unknown;

  beforeEach(async () => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    originalFetch = globalThis.fetch;
    await clearAllDownloadedTracks();
    clearExportedTrackMemory();
    clearListeningProfile();
  });

  afterEach(async () => {
    await clearAllDownloadedTracks();
    clearExportedTrackMemory();
    clearListeningProfile();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
    globalThis.fetch = originalFetch as typeof fetch;
    vi.restoreAllMocks();
  });

  describe("1. Version Synchronization (>= 1.0.20 / build >= 21)", () => {
    it("exports synchronized semver and build number across app constants and native configs", () => {
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(21);

      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
      );
      expect(pkg.version).toBe(APP_VERSION);

      const gradle = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/build.gradle"),
        "utf8",
      );
      expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
      expect(gradle).toContain(`versionName "${APP_VERSION}"`);
    });
  });

  describe("2. Strict Liked Tracks Filtering (Empty by Default)", () => {
    it("never returns unliked catalog/fallback tracks when liked=true offline", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Offline")) as unknown as typeof fetch;
      const res = await api.getTracks({ liked: true });
      expect(Array.isArray(res.tracks)).toBe(true);
      expect(res.tracks.length).toBe(0);
    });

    it("filters out tracks with likedByMe=false even if returned by API", async () => {
      const samplePayload = [
        makeTrack({ id: "t-unliked", likedByMe: false }),
        makeTrack({ id: "t-liked", likedByMe: true }),
      ];
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tracks: samplePayload }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch;

      const res = await api.getTracks({ liked: true });
      expect(res.tracks.map((t) => t.id)).toEqual(["t-liked"]);
    });
  });

  describe("3. Duplicate Phone Storage Export Prevention", () => {
    it("returns alreadyExists=true on second export without calling native plugin again", async () => {
      const track = makeTrack({ id: "dup-export-1", title: "Unique Song" });
      await saveDownloadedTrack(track, new Blob(["audio-bytes"], { type: "audio/mpeg" }));

      const mockSaveAudio = vi.fn().mockResolvedValue({
        success: true,
        path: "Music/Soundify/Test Artist - Unique Song.mp3",
      });

      const localStorageMock = createMemoryStorage();
      (globalThis as unknown as { window?: unknown }).window = {
        location: { protocol: "capacitor:", origin: "capacitor://localhost" },
        localStorage: localStorageMock,
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaStorePlugin: {
              saveAudioToDevice: mockSaveAudio,
            },
          },
        },
      };

      const first = await exportTrackToDeviceStorage(track);
      expect(first.success).toBe(true);
      expect(first.alreadyExists).toBeFalsy();
      expect(mockSaveAudio).toHaveBeenCalledTimes(1);

      const second = await exportTrackToDeviceStorage(track);
      expect(second.success).toBe(true);
      expect(second.alreadyExists).toBe(true);
      expect(mockSaveAudio).toHaveBeenCalledTimes(1);
    });

    it("includes MediaStore duplicate detection in native MediaStorePlugin.java", () => {
      const javaCode = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/MediaStorePlugin.java"),
        "utf8",
      );
      expect(javaCode).toContain("alreadyExists");
      expect(javaCode).toContain("MediaStore.Audio.Media");
    });
  });

  describe("4. Spotify-Style Taste Personalization Engine", () => {
    it("records listening events and generates personalized mixes", () => {
      const localStorageMock = createMemoryStorage();
      (globalThis as unknown as { window?: unknown }).window = {
        localStorage: localStorageMock,
      };

      const favArtistTrack = makeTrack({
        id: "fav-1",
        artistId: "artist-fav",
        artistName: "Shayan",
        artistNameFa: "شایان",
        genre: "Hip-Hop",
        mood: "Energetic",
      });
      const similarTrack = makeTrack({
        id: "sim-1",
        artistId: "artist-fav",
        artistName: "Shayan",
        artistNameFa: "شایان",
        genre: "Hip-Hop",
        mood: "Energetic",
      });
      const otherTrack = makeTrack({
        id: "oth-1",
        artistId: "artist-other",
        artistName: "Other",
        artistNameFa: "دیگر",
        genre: "Jazz",
        mood: "Calm",
      });

      recordListeningEvent(favArtistTrack);
      recordListeningEvent(favArtistTrack);

      const profile = getListeningProfile();
      expect(profile.totalListens).toBe(2);
      expect(profile.tracks["fav-1"]?.plays).toBe(2);

      const mixes = buildPersonalizedMixes(
        [otherTrack, similarTrack, favArtistTrack],
        [favArtistTrack],
        [],
        "fa",
        profile,
      );
      expect(mixes.length).toBeGreaterThanOrEqual(2);
      expect(mixes[0].id).toBe("mix-on-repeat");
      expect(mixes[0].tracks[0].id).toBe("fav-1");
      expect(mixes.some((m) => m.id === "mix-daily-1")).toBe(true);
    });
  });

  describe("5. Library, Search & Home Layout Contracts", () => {
    it("defaults Library tab to downloaded and uses delete confirmation modal", () => {
      const libCode = fs.readFileSync(
        path.resolve(__dirname, "../app/library/page.tsx"),
        "utf8",
      );
      expect(libCode).toMatch(/useState<[^>]*>\(\s*["']downloaded["']\s*\)/);
      expect(libCode).toContain("trackPendingDelete");
    });

    it("uses 2-column mobile grid on VirtualizedTrackGrid and fullWidth on Search source switcher", () => {
      const gridCode = fs.readFileSync(
        path.resolve(__dirname, "../components/VirtualizedTrackGrid.tsx"),
        "utf8",
      );
      expect(gridCode).toContain("grid-cols-2");

      const searchCode = fs.readFileSync(
        path.resolve(__dirname, "../app/search/page.tsx"),
        "utf8",
      );
      expect(searchCode).toContain("fullWidth");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  clusterTracksByArtist,
  extractTrueArtist,
} from "@/lib/artistResolver";
import {
  buildPersonalizedMixes,
  clearListeningProfile,
  recordListeningEvent,
} from "@/lib/listeningPersonalization";
import {
  addTrackToCustomPlaylist,
  clearCustomPlaylists,
  createCustomPlaylist,
  deleteCustomPlaylist,
  getCustomPlaylistById,
  getCustomPlaylists,
  removeTrackFromCustomPlaylist,
  updateCustomPlaylist,
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
    waveform: [0.3, 0.6, 0.4],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 10,
    likesCount: 2,
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

describe("Soundify v1.0.21 Upgrades & Regression Suite", () => {
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
    clearListeningProfile();
    clearCustomPlaylists();
  });

  afterEach(() => {
    clearListeningProfile();
    clearCustomPlaylists();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  describe("1. Version Synchronization (v1.0.21 / build 22)", () => {
    it("matches v1.0.21 and build 22 across TypeScript, package.json, and Gradle", () => {
      expect(APP_VERSION).toBe("1.0.21");
      expect(APP_BUILD_NUMBER).toBe(22);

      const gradle = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/build.gradle"),
        "utf8",
      );
      expect(gradle).toContain("versionCode 22");
      expect(gradle).toContain('versionName "1.0.21"');
    });
  });

  describe("2. Smart Cross-Platform Artist Identity Resolver", () => {
    it("unifies BLOK3 tracks across YouTube channels, Persian numerals, and Spotify", () => {
      const ytTrack1 = makeTrack({
        id: "ext-youtube-1",
        title: "BLOK3 - Kırgınım",
        artistName: "OğuzCan",
        source: "youtube",
      });
      const ytTrack2 = makeTrack({
        id: "ext-youtube-2",
        title: "BLOK3 - KAYIP KALP",
        artistName: "EXXEN® Music",
        source: "youtube",
      });
      const scTrack = makeTrack({
        id: "ext-soundcloud-3",
        title: "SEBEBİ YAR",
        artistName: "Blok۳",
        source: "soundcloud",
      });

      const a1 = extractTrueArtist(ytTrack1);
      const a2 = extractTrueArtist(ytTrack2);
      const a3 = extractTrueArtist(scTrack);

      expect(a1.canonicalKey).toBe("blok3");
      expect(a2.canonicalKey).toBe("blok3");
      expect(a3.canonicalKey).toBe("blok3");

      const clusters = clusterTracksByArtist([ytTrack1, ytTrack2, scTrack]);
      expect(clusters.length).toBe(1);
      expect(clusters[0].tracks.length).toBe(3);
    });

    it("unifies Persian & Latin artist aliases across platforms (Shayan Yo / شایان یو)", () => {
      const sc = makeTrack({
        id: "ext-sc-shayan",
        title: "Kam Kam",
        artistName: "Shayan Yo",
        source: "soundcloud",
      });
      const yt = makeTrack({
        id: "ext-yt-shayan",
        title: "شایان یو - منم بلدم (Official Audio)",
        artistName: "Radio Javan",
        source: "youtube",
      });

      const r1 = extractTrueArtist(sc);
      const r2 = extractTrueArtist(yt);
      expect(r1.canonicalKey).toBe("shayan_yo");
      expect(r2.canonicalKey).toBe("shayan_yo");
    });

    it("clusters unlisted transliterated Persian and Latin artist names together via phonetic skeletons", () => {
      const faTrack = makeTrack({
        id: "tr-fa-unlisted",
        title: "شب بارانی",
        artistName: "فرزاد علیزاده",
        artistNameFa: "فرزاد علیزاده",
      });
      const enTrack = makeTrack({
        id: "tr-en-unlisted",
        title: "Shabe Barooni",
        artistName: "Farzad Alizadeh",
      });

      const clusters = clusterTracksByArtist([faTrack, enTrack]);
      expect(clusters.length).toBe(1);
      expect(clusters[0].tracks.length).toBe(2);
    });

    it("builds automatic Artist Mixes uniting external listened tracks and downloads", () => {
      const t1 = makeTrack({
        id: "ext-youtube-b1",
        title: "BLOK3 - Kırgınım",
        artistName: "OğuzCan",
        source: "youtube",
      });
      const t2 = makeTrack({
        id: "ext-soundcloud-b2",
        title: "SEBEBİ YAR",
        artistName: "Blok3",
        source: "soundcloud",
      });

      recordListeningEvent(t1);
      recordListeningEvent(t1);

      const mixes = buildPersonalizedMixes([], [t2], [], "fa");
      const artistMix = mixes.find((m) => m.id.startsWith("mix-artist-blok3"));
      expect(artistMix).toBeDefined();
      expect(artistMix?.tracks.map((t) => t.id)).toContain("ext-youtube-b1");
      expect(artistMix?.tracks.map((t) => t.id)).toContain("ext-soundcloud-b2");
    });
  });

  describe("3. Spotify-Style Custom Playlists CRUD", () => {
    it("creates, renames, adds/dedupes external tracks, removes tracks, and deletes playlists", () => {
      const extTrack = makeTrack({
        id: "ext-yt-custom-1",
        title: "External Track",
        artistName: "Shayan Yo",
        source: "youtube",
        coverUrl: "blob:https://localhost/temp-cover",
      });

      const created = createCustomPlaylist({
        title: "Late Night Vibes",
        accentColor: "#ec4899",
      });
      expect(created.id.startsWith("cpl-")).toBe(true);
      expect(getCustomPlaylists().length).toBe(1);

      const firstAdd = addTrackToCustomPlaylist(created.id, extTrack);
      expect(firstAdd.added).toBe(true);
      expect(firstAdd.playlist?.tracks.length).toBe(1);

      // Duplicate add rejected cleanly
      const secondAdd = addTrackToCustomPlaylist(created.id, extTrack);
      expect(secondAdd.added).toBe(false);
      expect(secondAdd.playlist?.tracks.length).toBe(1);

      updateCustomPlaylist(created.id, { title: "Midnight Drive" });
      expect(getCustomPlaylistById(created.id)?.title).toBe("Midnight Drive");

      removeTrackFromCustomPlaylist(created.id, extTrack.id);
      expect(getCustomPlaylistById(created.id)?.tracks.length).toBe(0);

      expect(deleteCustomPlaylist(created.id)).toBe(true);
      expect(getCustomPlaylists().length).toBe(0);
    });
  });

  describe("4. Zero Click-Bounce Animation Contract", () => {
    it("removes vertical bounce transforms from cards, pages, and external cards", () => {
      const css = fs.readFileSync(
        path.resolve(__dirname, "../app/globals.css"),
        "utf8",
      );
      expect(css).not.toContain("transform: translate3d(0, 8px, 0) scale3d(0.992");
      expect(css).not.toContain(".sf-content-card:active");
      expect(css).toContain(".sf-row-press");
      expect(css).toContain(".sf-collapse");

      const extCard = fs.readFileSync(
        path.resolve(__dirname, "../components/ExternalTrackCard.tsx"),
        "utf8",
      );
      expect(extCard).not.toMatch(/<article[^>]*sf-press/);
    });
  });

  describe("5. Native Media3 ExoPlayer Streaming Integration", () => {
    it("wires Media3 dependencies, NativeAudioPlugin, MainActivity registration, and PlayerContext bridge", () => {
      const gradle = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/build.gradle"),
        "utf8",
      );
      expect(gradle).toContain("androidx.media3:media3-exoplayer:");
      expect(gradle).toContain("androidx.media3:media3-exoplayer-hls:");

      const pluginPath = path.resolve(
        __dirname,
        "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java",
      );
      expect(fs.existsSync(pluginPath)).toBe(true);

      const mainActivity = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/MainActivity.java"),
        "utf8",
      );
      expect(mainActivity).toContain("registerPlugin(NativeAudioPlugin.class);");

      const service = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
        "utf8",
      );
      expect(service).toContain("playNativeStream");
      expect(service).toContain("ExoPlayer.Builder");

      const bridge = fs.readFileSync(
        path.resolve(__dirname, "../lib/nativeAudioBridge.ts"),
        "utf8",
      );
      expect(bridge).toContain("nativeAudioPlayStream");

      const playerCtx = fs.readFileSync(
        path.resolve(__dirname, "../context/PlayerContext.tsx"),
        "utf8",
      );
      expect(playerCtx).toContain("isNativeAudioAvailable");
      expect(playerCtx).toContain("startNativeStreamForTrack");
    });
  });
});

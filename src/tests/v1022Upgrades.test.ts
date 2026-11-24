import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  AUTOMIX_STORAGE_KEY,
  computeAutoMixPlan,
  equalPowerGains,
  getAutoMixEnabled,
  setAutoMixEnabled,
} from "@/lib/smartAutoMix";
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
    waveform: Array.from({ length: 64 }, () => 0.65),
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

describe("Soundify v1.0.22 Upgrades & Regression Suite", () => {
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
  });

  afterEach(() => {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  describe("1. Version Synchronization (>= v1.0.22 / build 23)", () => {
    it("matches synced version and build across TS, package.json, sw.js, Gradle, and Java service", () => {
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(23);

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
      expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
    });
  });

  describe("2. UI Bugfixes (Cloud Icon Removal, Viewport-Clamped Menu, Top-Layer PlaylistPickerSheet)", () => {
    it("removes CloudArrowDown admin import button from ExternalTrackCard", () => {
      const extCard = fs.readFileSync(
        path.resolve(__dirname, "../components/ExternalTrackCard.tsx"),
        "utf8",
      );
      expect(extCard).not.toContain("CloudArrowDownIcon");
      expect(extCard).not.toContain("handleAdminImport");
      expect(extCard).toContain("openPlaylistPicker");
    });

    it("portals GlassControls Menu with fixed viewport-clamped coordinates and simplifies TrackCard menu", () => {
      const controls = fs.readFileSync(
        path.resolve(__dirname, "../components/GlassControls.tsx"),
        "utf8",
      );
      expect(controls).toContain("createPortal(");
      expect(controls).toContain('position: "fixed"');
      expect(controls).toContain("Math.max(12, Math.min(vw - menuW - 12");

      const trackCard = fs.readFileSync(
        path.resolve(__dirname, "../components/TrackCard.tsx"),
        "utf8",
      );
      expect(trackCard).not.toContain("editablePlaylists");
      expect(trackCard).toContain("openPlaylistPicker(activeTrack)");
    });

    it("renders PlaylistPickerSheet inside a native modal <dialog> so it stacks above NowPlayingOverlay", () => {
      const picker = fs.readFileSync(
        path.resolve(__dirname, "../components/PlaylistPickerSheet.tsx"),
        "utf8",
      );
      expect(picker).toContain("<dialog");
      expect(picker).toContain("dialog.showModal()");
      expect(picker).toContain("sf-picker-dialog");
      expect(picker).not.toContain("createPortal");

      const css = fs.readFileSync(
        path.resolve(__dirname, "../app/globals.css"),
        "utf8",
      );
      expect(css).toContain("dialog.sf-picker-dialog");
      expect(css).toContain("dialog.sf-picker-dialog::backdrop");
    });
  });

  describe("3. Curated Playlists Moved to Explore + Hero Badge & Daily Plays Sorting", () => {
    it("renames heroBadge to Today's Soundify Pick / منتخب امروز ساندیفای", () => {
      const i18n = fs.readFileSync(
        path.resolve(__dirname, "../context/I18nContext.tsx"),
        "utf8",
      );
      expect(i18n).toContain('heroBadge: "منتخب امروز ساندیفای"');
      expect(i18n).toContain(`heroBadge: "Today's Soundify Pick"`);
    });

    it("removes Curated Playlists section from Home and sorts featured track by dailyPlaysCount", () => {
      const home = fs.readFileSync(
        path.resolve(__dirname, "../app/page.tsx"),
        "utf8",
      );
      expect(home).not.toContain('t("curatedPlaylists")');
      expect(home).toContain("getDailyPlaysScore");
      expect(home).toContain("dailyPlaysCount");

      const types = fs.readFileSync(
        path.resolve(__dirname, "../lib/types.ts"),
        "utf8",
      );
      expect(types).toContain("dailyPlaysCount?: number");
    });

    it("displays Curated Playlists with PlaylistMosaic in Explore", () => {
      const explore = fs.readFileSync(
        path.resolve(__dirname, "../app/explore/page.tsx"),
        "utf8",
      );
      expect(explore).toContain('t("curatedPlaylists")');
      expect(explore).toContain("<PlaylistMosaic");
      expect(explore).toContain("getCachedCatalogPlaylists");
    });
  });

  describe("4. Deterministic Playlist AutoMix Engine & Dual-Deck Crossfade", () => {
    it("persists AutoMix toggle preference safely in localStorage (default false)", () => {
      expect(getAutoMixEnabled()).toBe(false);
      setAutoMixEnabled(true);
      expect(getAutoMixEnabled()).toBe(true);
      expect(window.localStorage.getItem(AUTOMIX_STORAGE_KEY)).toBe("true");
      setAutoMixEnabled(false);
      expect(getAutoMixEnabled()).toBe(false);
    });

    it("maintains constant loudness equal-power crossfade gains (cos^2 + sin^2 === 1)", () => {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const { outGain, inGain } = equalPowerGains(p);
        expect(outGain * outGain + inGain * inGain).toBeCloseTo(1, 5);
      }
      expect(equalPowerGains(0).outGain).toBeCloseTo(1, 5);
      expect(equalPowerGains(0).inGain).toBeCloseTo(0, 5);
      expect(equalPowerGains(1).outGain).toBeCloseTo(0, 5);
      expect(equalPowerGains(1).inGain).toBeCloseTo(1, 5);
    });

    it("detects outgoing outro drop and skips silent intro bars deterministically", () => {
      // 64 bars over 192s (3s per bar): bars 59..63 fade gently at ~177s
      const outWave = Array.from({ length: 64 }, (_, i) => (i >= 59 ? 0.15 : 0.75));
      // 64 bars over 200s (3.125s per bar): first 2 bars silent (<0.18), bar 2 hits 0.65 (~6.25s -> cue ~5.85s)
      const inWave = Array.from({ length: 64 }, (_, i) => (i < 2 ? 0.05 : 0.7));

      const outgoing = makeTrack({ id: "t-out", durationSec: 192, waveform: outWave });
      const incoming = makeTrack({ id: "t-in", durationSec: 200, waveform: inWave });

      const plan = computeAutoMixPlan(outgoing, incoming, 192);
      expect(plan.mixOutSec).toBeGreaterThanOrEqual(175);
      expect(plan.mixOutSec).toBeLessThan(190);
      expect(plan.mixInSec).toBeGreaterThan(2);
      expect(plan.mixInSec).toBeLessThanOrEqual(10);
      expect(plan.crossfadeSec).toBeGreaterThanOrEqual(3.5);
      expect(plan.crossfadeSec).toBeLessThanOrEqual(7.5);
    });

    it("wires AutoMix toggle in Settings and dual-deck crossfade across Native ExoPlayer + PlayerContext", () => {
      const settings = fs.readFileSync(
        path.resolve(__dirname, "../app/settings/page.tsx"),
        "utf8",
      );
      expect(settings).toContain("ساندیفای میکس");
      expect(settings).toContain("useAutoMixEnabled");

      const service = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
        "utf8",
      );
      expect(service).toContain("prepareNextNativeStream");
      expect(service).toContain("startNativeCrossfade");
      expect(service).toContain("cancelNativeCrossfade");
      expect(service).toContain("nextDeckPlayer");
      expect(service).toContain("crossfadeComplete");

      const plugin = fs.readFileSync(
        path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
        "utf8",
      );
      expect(plugin).toContain("prepareNextStream");
      expect(plugin).toContain("startCrossfade");
      expect(plugin).toContain("cancelCrossfade");

      const playerCtx = fs.readFileSync(
        path.resolve(__dirname, "../context/PlayerContext.tsx"),
        "utf8",
      );
      expect(playerCtx).toContain("computeAutoMixPlan");
      expect(playerCtx).toMatch(/equalPowerGains|djCrossfadeGains/);
      expect(playerCtx).toContain("soundify-crossfade-audio");
      expect(playerCtx).toContain("isCrossfading");
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_SOUNDIFY_URL,
  checkBackendHealth,
  getBackendUrl,
  resolveApiUrl,
  resolveMediaUrl,
  setBackendUrl,
} from "../lib/mobileBackend";
import { normalizePlaylist, normalizeTrack } from "../lib/api";
import type { Playlist, Track } from "../lib/types";

function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

describe("Mobile Backend Resolution & Android Connectivity", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    globalThis.localStorage = mockStorage;
    // @ts-expect-error test mock
    globalThis.window = {
      localStorage: mockStorage,
    };
    setBackendUrl(null);
  });

  describe("getBackendUrl and setBackendUrl", () => {
    it("returns empty string by default in browser environment to preserve website rewrites", () => {
      expect(getBackendUrl()).toBe("");
    });

    it("persists custom server URL and strips trailing slashes", () => {
      setBackendUrl("http://192.168.1.50:4100///");
      expect(getBackendUrl()).toBe("http://192.168.1.50:4100");
      expect(localStorage.getItem("soundify_server_url")).toBe("http://192.168.1.50:4100");
    });

    it("resets to empty string when cleared in web mode", () => {
      setBackendUrl("http://10.0.2.2:4100");
      expect(getBackendUrl()).toBe("http://10.0.2.2:4100");

      setBackendUrl(null);
      expect(getBackendUrl()).toBe("");
      expect(localStorage.getItem("soundify_server_url")).toBeNull();
    });

    it("resets to PRODUCTION_SOUNDIFY_URL when cleared on Android native wrapper", () => {
      (globalThis.window as unknown as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      };

      setBackendUrl("http://192.168.1.100:4100");
      expect(getBackendUrl()).toBe("http://192.168.1.100:4100");

      setBackendUrl(null);
      expect(getBackendUrl()).toBe(PRODUCTION_SOUNDIFY_URL);

      // Cleanup mock
      delete (globalThis.window as unknown as { Capacitor?: unknown }).Capacitor;
      setBackendUrl(null);
    });

    it("respects explicit offline standalone mode even on Android native", () => {
      (globalThis.window as unknown as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      };

      setBackendUrl("offline");
      expect(getBackendUrl()).toBe("");
      expect(localStorage.getItem("soundify_server_url")).toBe("offline");

      // Cleanup mock
      delete (globalThis.window as unknown as { Capacitor?: unknown }).Capacitor;
      setBackendUrl(null);
    });
  });

  describe("resolveApiUrl", () => {
    it("leaves absolute HTTP/HTTPS URLs untouched regardless of configured backend", () => {
      setBackendUrl("http://10.0.2.2:4100");
      expect(resolveApiUrl("https://api.external.com/v1/tracks")).toBe("https://api.external.com/v1/tracks");
      expect(resolveApiUrl("http://localhost:3000/api/status")).toBe("http://localhost:3000/api/status");
    });

    it("leaves relative paths untouched when backend URL is empty (web mode)", () => {
      setBackendUrl(null);
      expect(resolveApiUrl("/api/tracks")).toBe("/api/tracks");
      expect(resolveApiUrl("/api/auth/me")).toBe("/api/auth/me");
    });

    it("prefixes relative paths with the configured backend URL on mobile", () => {
      setBackendUrl("http://10.0.2.2:4100");
      expect(resolveApiUrl("/api/tracks")).toBe("http://10.0.2.2:4100/api/tracks");
      expect(resolveApiUrl("api/user/sync")).toBe("http://10.0.2.2:4100/api/user/sync");
    });
  });

  describe("resolveMediaUrl", () => {
    it("handles null, undefined and empty strings safely", () => {
      expect(resolveMediaUrl(null)).toBe("");
      expect(resolveMediaUrl(undefined)).toBe("");
      expect(resolveMediaUrl("")).toBe("");
    });

    it("preserves external HTTP, HTTPS, blob, and data URLs", () => {
      setBackendUrl("http://10.0.2.2:4100");
      expect(resolveMediaUrl("https://cdn.example.com/audio.mp3")).toBe("https://cdn.example.com/audio.mp3");
      expect(resolveMediaUrl("blob:http://localhost/123-abc")).toBe("blob:http://localhost/123-abc");
      expect(resolveMediaUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    it("prefixes relative audio stream and cover URLs with mobile backend URL", () => {
      setBackendUrl("http://10.0.2.2:4100");
      expect(resolveMediaUrl("/api/tracks/track-01/stream")).toBe("http://10.0.2.2:4100/api/tracks/track-01/stream");
      expect(resolveMediaUrl("/api/tracks/track-01/cover")).toBe("http://10.0.2.2:4100/api/tracks/track-01/cover");
    });

    it("leaves relative media paths untouched in web mode", () => {
      setBackendUrl(null);
      expect(resolveMediaUrl("/api/tracks/track-01/stream")).toBe("/api/tracks/track-01/stream");
    });
  });

  describe("checkBackendHealth", () => {
    it("pings health endpoint and measures latency on success", async () => {
      const mockStatus = {
        status: "ok",
        app: "Soundify Mobile",
        version: "1.0.0",
        apiLevel: 2,
        timestamp: Date.now(),
        features: {
          audioStream206: true,
          lrcLyrics: true,
          deviceSync: true,
          userSync: true,
          offlineCache: true,
          translucentGlass: true,
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockStatus,
      } as Response);

      const res = await checkBackendHealth("http://10.0.2.2:4100");
      expect(res.ok).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(res.info?.status).toBe("ok");
      expect(res.info?.features.audioStream206).toBe(true);

      globalThis.fetch = originalFetch;
    });

    it("reports failure when server responds with non-200 code", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const res = await checkBackendHealth("http://10.0.2.2:4100");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("HTTP 503");

      globalThis.fetch = originalFetch;
    });

    it("reports failure when fetch throws a network error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const res = await checkBackendHealth("http://10.0.2.2:4100");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("Connection refused");

      globalThis.fetch = originalFetch;
    });
  });

  describe("normalizeTrack and normalizePlaylist", () => {
    it("prefixes track audioUrl and coverUrl with mobile origin when configured", () => {
      setBackendUrl("http://10.0.2.2:4100");
      const track: Track = {
        id: "trk-1",
        title: "Test Track",
        titleFa: "ترک تستی",
        artistId: "art-1",
        artistName: "Test Artist",
        artistNameFa: "هنرمند تستی",
        artistAvatarColor: "#6366f1",
        album: "Test Album",
        albumFa: "آلبوم تستی",
        genre: "Pop",
        mood: "Happy",
        durationSec: 180,
        audioUrl: "/api/tracks/trk-1/stream",
        coverUrl: "/api/tracks/trk-1/cover",
        accentColor: "#4f46e5",
        waveform: [0.1, 0.5, 0.9],
        hasLyrics: true,
        lyricsSource: "lrclib",
        playsCount: 10,
        likesCount: 5,
        repostsCount: 2,
        likedByMe: true,
        repostedByMe: false,
        uploadedBy: null,
        createdAt: "2026-01-01",
      };

      const normalized = normalizeTrack(track);
      expect(normalized.audioUrl).toBe("http://10.0.2.2:4100/api/tracks/trk-1/stream");
      expect(normalized.coverUrl).toBe("http://10.0.2.2:4100/api/tracks/trk-1/cover");
    });

    it("normalizes playlist coverUrls array", () => {
      setBackendUrl("http://10.0.2.2:4100");
      const playlist: Playlist = {
        id: "pl-1",
        title: "Workout",
        titleFa: "ورزش",
        description: "Beats for gym",
        descriptionFa: "آهنگ ورزشی",
        ownerId: "user-1",
        isFeatured: true,
        accentColor: "#10b981",
        trackCount: 3,
        coverUrls: ["/api/tracks/1/cover", "/api/tracks/2/cover"],
      };

      const normalized = normalizePlaylist(playlist);
      expect(normalized.coverUrls).toEqual([
        "http://10.0.2.2:4100/api/tracks/1/cover",
        "http://10.0.2.2:4100/api/tracks/2/cover",
      ]);
    });
  });
});

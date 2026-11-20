import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  getApiToken,
  getRefreshToken,
  onAuthTokensChanged,
  setApiTokens,
} from "../lib/api";
import {
  clearAllDownloadedTracks,
  getDownloadedTrackBlobUrl,
  saveDownloadedTrack,
  validateOfflineLicense,
} from "../lib/offlineAudioStorage";
import {
  clearPendingOfflineLikes,
  flushOfflineLikes,
  getPendingOfflineLikes,
} from "../lib/mobileSync";
import { parseRemoteCommand } from "../lib/typeGuards";
import type { OfflineLicense, Track } from "../lib/types";

describe("Mobile REST API Specification v1 Conformity", () => {
  beforeEach(() => {
    setApiTokens(null, null);
    vi.restoreAllMocks();
  });

  describe("Authentication Flow & Token Refresh", () => {
    it("handles login, stores token and refreshToken properly", async () => {
      const mockLoginResponse = {
        user: {
          id: "usr-1",
          username: "farzad",
          email: "farzad@example.com",
          displayName: "Farzad",
          displayNameFa: "فرزاد",
          role: "user" as const,
          avatarColor: "#4F46E5",
          isActive: true,
        },
        token: "access-jwt-token-123",
        refreshToken: "refresh-jwt-token-456",
        tokenType: "Bearer",
        expiresIn: 604800,
      };

      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init?.method || "GET";
        requestedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify(mockLoginResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.login("farzad", "password123");
      expect(requestedUrl).toContain("/api/mobile/v1/auth/login");
      expect(requestedMethod).toBe("POST");
      expect(requestedBody).toEqual({ identifier: "farzad", password: "password123" });
      expect(res.token).toBe("access-jwt-token-123");
      expect(res.refreshToken).toBe("refresh-jwt-token-456");

      setApiTokens(res.token, res.refreshToken);
      expect(getApiToken()).toBe("access-jwt-token-123");
      expect(getRefreshToken()).toBe("refresh-jwt-token-456");
    });

    it("registers user via /api/mobile/v1/auth/register", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            user: { id: "u-2", username: "new_user" },
            token: "tok-new",
            refreshToken: "ref-new",
            tokenType: "Bearer",
            expiresIn: 604800,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await api.register({
        username: "new_user",
        email: "new@example.com",
        displayName: "New User",
        password: "securePassword1!",
      });
      expect(requestedUrl).toContain("/api/mobile/v1/auth/register");
      expect(res.token).toBe("tok-new");
    });

    it("automatically attempts token refresh when receiving HTTP 401 on protected routes", async () => {
      setApiTokens("expired-access-token", "valid-refresh-token");

      let fetchCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCount++;
        if (url.includes("/api/mobile/v1/auth/refresh")) {
          return new Response(
            JSON.stringify({
              token: "brand-new-access-token",
              refreshToken: "brand-new-refresh-token",
              tokenType: "Bearer",
              expiresIn: 604800,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/mobile/v1/auth/me") && fetchCount === 1) {
          // First attempt fails with 401
          return new Response(JSON.stringify({ error: "Token expired" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/mobile/v1/auth/me") && fetchCount > 1) {
          // Second attempt succeeds with new token
          return new Response(JSON.stringify({ user: { id: "u-1", username: "farzad" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const meRes = await api.me();
      expect(meRes.user?.username).toBe("farzad");
      expect(getApiToken()).toBe("brand-new-access-token");
      expect(getRefreshToken()).toBe("brand-new-refresh-token");
    });

    it("deduplicates simultaneous 401 responses on parallel requests to exactly one refresh call", async () => {
      setApiTokens("expired-access-token", "valid-refresh-token");

      let refreshCalls = 0;
      let meCalls = 0;
      let tracksCalls = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/mobile/v1/auth/refresh")) {
          refreshCalls++;
          // Simulate slight network delay during refresh
          await new Promise((r) => setTimeout(r, 20));
          return new Response(
            JSON.stringify({
              token: "refreshed-shared-access-token",
              refreshToken: "refreshed-shared-refresh-token",
              tokenType: "Bearer",
              expiresIn: 604800,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/mobile/v1/auth/me")) {
          meCalls++;
          if (meCalls === 1) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ user: { id: "u-1", username: "parallel_user" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/mobile/v1/tracks")) {
          tracksCalls++;
          if (tracksCalls === 1) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ tracks: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // Dispatch 2 requests simultaneously while token is expired
      const [resMe, resTracks] = await Promise.all([
        api.me(),
        api.getTracks(),
      ]);

      expect(resMe.user?.username).toBe("parallel_user");
      expect(resTracks.tracks).toEqual([]);
      // Crucial: exactly one POST /api/mobile/v1/auth/refresh request was executed!
      expect(refreshCalls).toBe(1);
      expect(getApiToken()).toBe("refreshed-shared-access-token");
    });

    it("notifies onAuthTokensChanged listener when refresh fails and tokens are cleared", async () => {
      setApiTokens("expired-token", "invalid-refresh-token");

      let tokenClearedNotified = false;
      const unsubscribe = onAuthTokensChanged((hasToken) => {
        if (!hasToken) {
          tokenClearedNotified = true;
        }
      });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/mobile/v1/auth/refresh")) {
          return new Response(JSON.stringify({ error: "Invalid refresh token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/mobile/v1/playlists")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      await expect(api.deletePlaylist("pl-test")).rejects.toThrow();
      expect(getApiToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
      expect(tokenClearedNotified).toBe(true);
      unsubscribe();
    });

    it("returns user: null on api.me() without making network request when no tokens exist", async () => {
      setApiTokens(null, null);
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const res = await api.me();
      expect(res.user).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Bootstrap & Delta Synchronization", () => {
    it("fetches single-roundtrip bootstrap via /api/mobile/v1/sync/bootstrap", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            user: { id: "u-1", username: "farzad" },
            likedTrackIds: ["trk-1", "trk-2"],
            likedTracks: [
              {
                id: "trk-1",
                title: "Tariki",
                titleFa: "تاریکی",
                artistName: "Sajad Shahi",
                durationSec: 194,
                audioUrl: "/api/mobile/v1/tracks/trk-1/stream",
                coverUrl: "/api/tracks/trk-1/cover",
                waveform: [1, 2, 3],
                playsCount: 100,
                likesCount: 10,
                likedByMe: true,
              },
            ],
            playlists: [],
            recentHistory: [],
            featuredTracks: [],
            featuredPlaylists: [],
            devices: [],
            playbackState: {
              activeDeviceId: null,
              trackId: null,
              track: null,
              isPlaying: false,
              currentTime: 0,
              duration: 0,
              volume: 1,
              repeat: "off",
              shuffle: false,
              updatedAt: Date.now(),
            },
            serverTime: 1731760000000,
            syncVersion: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const boot = await api.getBootstrap();
      expect(requestedUrl).toContain("/api/mobile/v1/sync/bootstrap");
      expect(boot.user?.id).toBe("u-1");
      expect(boot.likedTrackIds).toContain("trk-1");
      expect(boot.likedTracks[0].id).toBe("trk-1");
    });

    it("fetches delta sync since specified timestamp", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            since: 1731750000000,
            serverTime: 1731760000000,
            newLikedTrackIds: ["trk-new"],
            newPlaylistIds: ["pl-new"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const delta = await api.getDeltaSync(1731750000000);
      expect(requestedUrl).toContain("/api/mobile/v1/sync/delta?since=1731750000000");
      expect(delta.newLikedTrackIds).toContain("trk-new");
    });

    it("getUserSync returns bootstrap data for guest without calling /api/user/sync or throwing", async () => {
      setApiTokens(null, null);
      let bootstrapCalled = false;
      let userSyncCalled = false;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/mobile/v1/sync/bootstrap")) {
          bootstrapCalled = true;
          return new Response(
            JSON.stringify({
              user: null,
              likedTrackIds: [],
              likedTracks: [],
              playlists: [],
              recentHistory: [],
              featuredTracks: [{ id: "feat-1", title: "Featured 1" }],
              featuredPlaylists: [],
              devices: [],
              playbackState: null,
              serverTime: 1731760000000,
              syncVersion: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/user/sync")) {
          userSyncCalled = true;
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        return new Response("Not found", { status: 404 });
      });

      const syncRes = await api.getUserSync();
      expect(bootstrapCalled).toBe(true);
      expect(userSyncCalled).toBe(false);
      expect(syncRes.user).toBeNull();
      expect(syncRes.featuredTracks?.[0]?.id).toBe("feat-1");
    });
  });

  describe("Playlists CRUD", () => {
    it("lists playlists with /api/mobile/v1/playlists", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ playlists: [{ id: "pl-1", title: "Gym Motivation" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.getPlaylists();
      expect(requestedUrl).toContain("/api/mobile/v1/playlists?all=true");
      expect(res.playlists[0].id).toBe("pl-1");
    });

    it("supports update, reorder and delete on playlists", async () => {
      const calls: Array<{ url: string; method: string }> = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || "GET" });
        return new Response(JSON.stringify({ ok: true, id: "pl-1", deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await api.updatePlaylist("pl-1", { title: "New Title" });
      await api.reorderPlaylistTracks("pl-1", ["trk-1", "trk-2"]);
      await api.deletePlaylist("pl-1");

      expect(calls.some((c) => c.url.includes("/api/mobile/v1/playlists/pl-1") && c.method === "PUT")).toBe(true);
      expect(calls.some((c) => c.url.includes("/api/mobile/v1/playlists/pl-1/tracks/reorder") && c.method === "PUT")).toBe(true);
      expect(calls.some((c) => c.url.includes("/api/mobile/v1/playlists/pl-1") && c.method === "DELETE")).toBe(true);
    });
  });

  describe("Library Likes & Batch Sync", () => {
    it("toggles likes using /api/mobile/v1/library/likes", async () => {
      let requestedUrl = "";
      let requestedBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ ok: true, trackId: "trk-1", liked: true, likesCount: 42 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.toggleLike("trk-1");
      expect(requestedUrl).toContain("/api/mobile/v1/library/likes");
      expect(requestedBody).toEqual({ trackId: "trk-1" });
      expect(res.liked).toBe(true);
      expect(res.likesCount).toBe(42);
    });

    it("explicitly unlikes via DELETE /api/mobile/v1/library/likes/:trackId", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init?.method || "GET";
        return new Response(JSON.stringify({ ok: true, trackId: "trk-1", liked: false, likesCount: 41 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.unlikeTrack("trk-1");
      expect(requestedUrl).toContain("/api/mobile/v1/library/likes/trk-1");
      expect(requestedMethod).toBe("DELETE");
      expect(res.liked).toBe(false);
    });

    it("batch syncs offline likes from local storage", async () => {
      let requestedUrl = "";
      let requestedBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ ok: true, likedTrackIds: ["trk-1", "trk-2"], syncedCount: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.syncOfflineLikesBatch({
        likedTrackIds: ["trk-1", "trk-2"],
        unlikedTrackIds: ["trk-3"],
      });

      expect(requestedUrl).toContain("/api/mobile/v1/library/likes/batch");
      expect(requestedBody).toEqual({
        likedTrackIds: ["trk-1", "trk-2"],
        unlikedTrackIds: ["trk-3"],
      });
      expect(res.ok).toBe(true);
      expect(res.syncedCount).toBe(2);
    });

    it("queues offline likes when offline and batch syncs via flushOfflineLikes when returning online", async () => {
      clearPendingOfflineLikes();

      // 1. User is offline
      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

      try {
        const optimisticRes = await api.toggleLike("trk-offline-101", { likesCount: 5 });
        expect(optimisticRes.liked).toBe(true);
        expect(optimisticRes.likesCount).toBe(6);

        // Verify it was queued in localStorage
        const pending = getPendingOfflineLikes();
        expect(pending.likedTrackIds).toContain("trk-offline-101");

        // 2. User returns online
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

        let batchSynced = false;
        globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes("/api/mobile/v1/library/likes/batch")) {
            batchSynced = true;
            return new Response(
              JSON.stringify({
                ok: true,
                likedTrackIds: ["trk-offline-101"],
                syncedCount: 1,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("Not found", { status: 404 });
        });

        await flushOfflineLikes();
        expect(batchSynced).toBe(true);

        // Pending queue should be emptied
        const afterFlush = getPendingOfflineLikes();
        expect(afterFlush.likedTrackIds).toHaveLength(0);
      } finally {
        Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
        clearPendingOfflineLikes();
      }
    });

    it("queues likes offline when network fetch fails even if navigator.onLine is true", async () => {
      clearPendingOfflineLikes();

      // Simulate network socket drop / timeout while WiFi is technically connected
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const res = await api.toggleLike("trk-socket-drop", { likesCount: 10 });
      expect(res.liked).toBe(true);
      expect(res.likesCount).toBe(11);

      const pending = getPendingOfflineLikes();
      expect(pending.likedTrackIds).toContain("trk-socket-drop");
      clearPendingOfflineLikes();
    });
  });

  describe("Offline Licenses & ExoPlayer Verification", () => {
    it("requests offline license via /api/mobile/v1/tracks/:id/offline-license", async () => {
      let requestedUrl = "";
      const dummyLicense: OfflineLicense = {
        trackId: "trk-license-test",
        userId: "usr-1",
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600 * 24 * 30, // 30 days
        audioChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        audioSize: 4612300,
        audioMime: "audio/mpeg",
        playbackPolicy: {
          allowOffline: true,
          renewIntervalHours: 720,
        },
        signature: "cryptographic_hmac_sha256_sig",
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            ok: true,
            trackId: "trk-license-test",
            title: "Tariki",
            downloadUrl: "/api/mobile/v1/tracks/trk-license-test/stream",
            coverUrl: "/api/tracks/trk-license-test/cover",
            license: dummyLicense,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await api.getOfflineLicense("trk-license-test");
      expect(requestedUrl).toContain("/api/mobile/v1/tracks/trk-license-test/offline-license");
      expect(res.ok).toBe(true);
      expect(res.license.audioChecksum).toBe(dummyLicense.audioChecksum);

      // Validate offline license client helper
      expect(validateOfflineLicense(res.license)).toBe(true);

      // An expired license must be rejected
      const expiredLicense: OfflineLicense = {
        ...res.license,
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      };
      expect(validateOfflineLicense(expiredLicense)).toBe(false);
    });

    it("verifies offline license via POST /api/mobile/v1/tracks/:id/offline-license/verify", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody: OfflineLicense | null = null;

      const dummyLicense: OfflineLicense = {
        trackId: "trk-verify-1",
        userId: "usr-1",
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        audioChecksum: "abc123checksum",
        audioSize: 10240,
        audioMime: "audio/mpeg",
        playbackPolicy: { allowOffline: true, renewIntervalHours: 720 },
        signature: "hmac_sig",
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init?.method || "GET";
        requestedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            valid: true,
            trackId: "trk-verify-1",
            expiresAt: dummyLicense.expiresAt,
            isExpired: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await api.verifyOfflineLicense("trk-verify-1", dummyLicense);
      expect(requestedUrl).toContain("/api/mobile/v1/tracks/trk-verify-1/offline-license/verify");
      expect(requestedMethod).toBe("POST");
      expect((requestedBody as OfflineLicense | null)?.audioChecksum).toBe("abc123checksum");
      expect(res.valid).toBe(true);
      expect(res.isExpired).toBe(false);
    });

    it("automatically renews expired license when online and authorized", async () => {
      await clearAllDownloadedTracks();
      setApiTokens("valid-token", "valid-refresh");

      const testTrack: Track = {
        id: "trk-auto-renew",
        title: "Renewable Track",
        titleFa: "ترک تمدیدپذیر",
        artistId: "artist-renew",
        artistName: "Test Artist",
        artistNameFa: "هنرمند آزمایشی",
        artistAvatarColor: "#4F46E5",
        album: "Test Album",
        albumFa: "آلبوم آزمایشی",
        genre: "Rap",
        mood: "Dark",
        durationSec: 180,
        audioUrl: "/api/mobile/v1/tracks/trk-auto-renew/stream",
        coverUrl: "/api/tracks/trk-auto-renew/cover",
        playsCount: 10,
        likesCount: 5,
        repostsCount: 0,
        likedByMe: false,
        repostedByMe: false,
        accentColor: "#4F46E5",
        waveform: [0.1, 0.5, 0.8],
        hasLyrics: false,
        lyricsSource: "lrclib",
        createdAt: "2026-11-16T12:00:00Z",
      };

      const expiredLicense: OfflineLicense = {
        trackId: "trk-auto-renew",
        userId: "u-1",
        issuedAt: Math.floor(Date.now() / 1000) - 200,
        expiresAt: Math.floor(Date.now() / 1000) - 100, // expired
        audioChecksum: "orig-checksum",
        audioSize: 2048,
        audioMime: "audio/mpeg",
        playbackPolicy: { allowOffline: true, renewIntervalHours: 720 },
        signature: "orig-sig",
      };

      const audioBlob = new Blob(["test-audio-renew"], { type: "audio/mpeg" });
      await saveDownloadedTrack(testTrack, audioBlob, undefined, undefined, expiredLicense);

      let renewCalled = false;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/mobile/v1/tracks/trk-auto-renew/offline-license")) {
          renewCalled = true;
          return new Response(
            JSON.stringify({
              ok: true,
              trackId: "trk-auto-renew",
              license: {
                ...expiredLicense,
                expiresAt: Math.floor(Date.now() / 1000) + 3600 * 24 * 30, // renewed
                signature: "new-renewed-sig",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const blobUrl = await getDownloadedTrackBlobUrl("trk-auto-renew");
      expect(renewCalled).toBe(true);
      expect(blobUrl).not.toBeNull();
    });

    it("refuses getDownloadedTrackBlobUrl when offline DRM license has expired", async () => {
      await clearAllDownloadedTracks();

      const testTrack: Track = {
        id: "trk-drm-test",
        title: "Test DRM Track",
        titleFa: "ترک آزمایشی",
        artistId: "artist-drm",
        artistName: "Test Artist",
        artistNameFa: "هنرمند آزمایشی",
        artistAvatarColor: "#4F46E5",
        album: "Test Album",
        albumFa: "آلبوم آزمایشی",
        genre: "Rap",
        mood: "Dark",
        durationSec: 180,
        audioUrl: "/api/mobile/v1/tracks/trk-drm-test/stream",
        coverUrl: "/api/tracks/trk-drm-test/cover",
        playsCount: 10,
        likesCount: 5,
        repostsCount: 0,
        likedByMe: false,
        repostedByMe: false,
        accentColor: "#4F46E5",
        waveform: [0.1, 0.5, 0.8],
        hasLyrics: false,
        lyricsSource: "lrclib",
        createdAt: "2026-11-16T12:00:00Z",
      };

      const validLicense: OfflineLicense = {
        trackId: "trk-drm-test",
        userId: "u-1",
        issuedAt: Math.floor(Date.now() / 1000) - 100,
        expiresAt: Math.floor(Date.now() / 1000) + 3600 * 24 * 30, // valid for 30 days
        audioChecksum: "fake-checksum",
        audioSize: 1024,
        audioMime: "audio/mpeg",
        playbackPolicy: { allowOffline: true, renewIntervalHours: 720 },
        signature: "fake-sig",
      };

      const audioBlob = new Blob(["dummy-audio-bytes"], { type: "audio/mpeg" });
      await saveDownloadedTrack(testTrack, audioBlob, undefined, undefined, validLicense);

      // 1. With valid license, blob URL is generated successfully
      const validBlobUrl = await getDownloadedTrackBlobUrl("trk-drm-test");
      expect(validBlobUrl).not.toBeNull();

      // 2. With expired license, playback MUST be refused and return null
      const expiredLicense: OfflineLicense = {
        ...validLicense,
        expiresAt: Math.floor(Date.now() / 1000) - 60, // expired 60 seconds ago
      };
      await saveDownloadedTrack(testTrack, audioBlob, undefined, undefined, expiredLicense);

      const expiredBlobUrl = await getDownloadedTrackBlobUrl("trk-drm-test");
      expect(expiredBlobUrl).toBeNull();
    });
  });

  describe("Spotify Connect Real-Time Device Sync", () => {
    it("registers mobile device via /api/mobile/v1/connect/devices/register", async () => {
      let requestedUrl = "";
      const intercepted: { id?: string; brand?: string } = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        if (init?.body) {
          Object.assign(intercepted, JSON.parse(init.body as string));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            deviceId: "android_test_device",
            devices: [],
            activeDeviceId: "android_test_device",
            state: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await api.registerDevice({
        deviceId: "android_test_device",
        name: "Pixel 8 Pro",
        type: "smartphone",
        brand: "Google",
        model: "Pixel 8 Pro",
        osVersion: "Android 15",
        appVersion: "1.0.0",
      });

      expect(requestedUrl).toContain("/api/mobile/v1/connect/devices/register");
      expect(intercepted.id).toBe("android_test_device");
      expect(intercepted.brand).toBe("Google");
      expect(res.ok).toBe(true);
    });

    it("sends heartbeat via /api/mobile/v1/connect/heartbeat", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ ok: true, timestamp: Date.now() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.mobileHeartbeat({
        deviceId: "android_test_device",
        isPlaying: true,
        currentTime: 30.5,
      });

      expect(requestedUrl).toContain("/api/mobile/v1/connect/heartbeat");
      expect(res.ok).toBe(true);
    });

    it("dispatches remote commands via /api/mobile/v1/connect/command", async () => {
      let requestedUrl = "";
      const intercepted: { command?: string; targetDeviceId?: string } = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        if (init?.body) {
          Object.assign(intercepted, JSON.parse(init.body as string));
        }
        return new Response(JSON.stringify({ ok: true, command: "PLAY", params: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await api.sendDeviceCommand({
        command: "PLAY",
        targetDeviceId: "target-device-123",
        fromDeviceId: "my-device-123",
      });

      expect(requestedUrl).toContain("/api/mobile/v1/connect/command");
      expect(intercepted.command).toBe("play");
      expect(intercepted.targetDeviceId).toBe("target-device-123");
      expect(res.ok).toBe(true);
    });

    it("normalizes high-level commands (PLAY_TRACK, SET_VOLUME, SEEK) to conform to mobileConnectCommandSchema", async () => {
      let sentCommand = "";
      let sentParams: Record<string, unknown> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const body = JSON.parse(init.body as string);
          sentCommand = body.command;
          sentParams = body.params;
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      // 1. PLAY_TRACK -> "play" with trackId in params
      await api.sendDeviceCommand({
        command: "PLAY_TRACK",
        payload: { track: { id: "trk-remote-42" } },
        fromDeviceId: "phone-1",
      });
      expect(sentCommand).toBe("play");
      expect(sentParams.trackId).toBe("trk-remote-42");

      // 2. SET_VOLUME -> "volume" with volume in params
      await api.sendDeviceCommand({
        command: "SET_VOLUME",
        payload: { volume: 0.75 },
        fromDeviceId: "phone-1",
      });
      expect(sentCommand).toBe("volume");
      expect(sentParams.volume).toBe(0.75);

      // 3. SEEK -> "seek" with positionSec in params
      await api.sendDeviceCommand({
        command: "SEEK",
        payload: { seconds: 45.5 },
        fromDeviceId: "phone-1",
      });
      expect(sentCommand).toBe("seek");
      expect(sentParams.positionSec).toBe(45.5);
    });

    it("correctly parses server-broadcast SSE command formats via parseRemoteCommand", () => {
      // 1. Backend broadcast command: "VOLUME" with payload { volume: 0.6 }
      const volCmd = parseRemoteCommand("VOLUME", { volume: 0.6 });
      expect(volCmd).toEqual({ type: "SET_VOLUME", volume: 0.6 });

      // 2. Backend broadcast command: "SEEK" with payload { positionSec: 92.5 }
      const seekSecCmd = parseRemoteCommand("SEEK", { positionSec: 92.5 });
      expect(seekSecCmd).toEqual({ type: "SEEK", seconds: 92.5 });

      // 3. Backend broadcast command: "SEEK" with payload { positionMs: 45000 }
      const seekMsCmd = parseRemoteCommand("SEEK", { positionMs: 45000 });
      expect(seekMsCmd).toEqual({ type: "SEEK", seconds: 45 });

      // 4. Backend broadcast command: "PLAY" with payload { trackId: "trk-remote-100" }
      const playTrackCmd = parseRemoteCommand("PLAY", { trackId: "trk-remote-100" });
      expect(playTrackCmd?.type).toBe("PLAY_TRACK");
      if (playTrackCmd?.type === "PLAY_TRACK") {
        expect(playTrackCmd.trackId).toBe("trk-remote-100");
      }

      // 5. Backend broadcast command: "TRANSFER_PLAYBACK"
      const transferCmd = parseRemoteCommand("TRANSFER_PLAYBACK", { targetDeviceId: "device-target-99" });
      expect(transferCmd?.type).toBe("TRANSFER");
      if (transferCmd?.type === "TRANSFER") {
        expect(transferCmd.targetDeviceId).toBe("device-target-99");
      }
    });
  });
});

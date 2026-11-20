import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { APP_VERSION } from "../lib/appVersion";
import {
  clearCachedUserSync,
  getCachedUserSync,
  getOrCreateDeviceId,
  registerCurrentDevice,
  saveCachedUserSync,
  syncUserData,
} from "../lib/mobileSync";
import type { UserSyncData } from "../lib/types";

const mockSyncData: UserSyncData = {
  user: {
    id: "user-test-1",
    username: "mobile_listener",
    email: "mobile@soundify.app",
    displayName: "Mobile Listener",
    displayNameFa: "شنونده موبایل",
    role: "user",
    avatarColor: "#4F46E5",
    isActive: true,
  },
  likedTrackIds: ["track-01", "track-02"],
  likedTracks: [],
  repostedTrackIds: [],
  followedArtistIds: ["artist-shajarian"],
  playlists: [],
  recentHistory: [],
  activeDevices: [],
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
  preferences: {
    audioQuality: "high",
    theme: "dark",
  },
  serverTime: Date.now(),
  syncVersion: 2,
};

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

describe("Mobile User & Database Synchronization", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    globalThis.localStorage = mockStorage;
    // @ts-expect-error test mock
    globalThis.window = {
      localStorage: mockStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.restoreAllMocks();
  });

  describe("getOrCreateDeviceId", () => {
    it("generates and persists a device ID in localStorage", () => {
      const id1 = getOrCreateDeviceId();
      expect(typeof id1).toBe("string");
      expect(id1.length).toBeGreaterThan(5);

      const id2 = getOrCreateDeviceId();
      expect(id2).toBe(id1);
      expect(localStorage.getItem("soundify_device_id")).toBe(id1);
    });

    it("migrates legacy soundify_mobile_device_id to soundify_device_id if present", () => {
      localStorage.setItem("soundify_mobile_device_id", "legacy-mobile-999");
      const id = getOrCreateDeviceId();
      expect(id).toBe("legacy-mobile-999");
      expect(localStorage.getItem("soundify_device_id")).toBe("legacy-mobile-999");
    });

    it("generates user-scoped device IDs preventing cross-account collision", () => {
      const userAId = getOrCreateDeviceId("usr-alice-777");
      const userBId = getOrCreateDeviceId("usr-bob-888");

      expect(userAId).not.toBe(userBId);
      expect(userAId).toMatch(/^android-usralice-/);
      expect(userBId).toMatch(/^android-usrbob88-/);

      expect(localStorage.getItem("soundify_device_id_usr-alice-777")).toBe(userAId);
      expect(localStorage.getItem("soundify_device_id_usr-bob-888")).toBe(userBId);

      // Subsequent call for user A returns the same persistent ID
      expect(getOrCreateDeviceId("usr-alice-777")).toBe(userAId);
    });
  });

  describe("Cached User Sync Snapshot", () => {
    it("returns null when cache is empty", () => {
      expect(getCachedUserSync()).toBeNull();
    });

    it("saves and retrieves user sync snapshot from localStorage", () => {
      saveCachedUserSync(mockSyncData);
      const retrieved = getCachedUserSync();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.user?.id).toBe("user-test-1");
      expect(retrieved?.likedTrackIds).toEqual(["track-01", "track-02"]);
      expect(retrieved?.preferences.audioQuality).toBe("high");
    });

    it("clears cached user sync data on logout", () => {
      saveCachedUserSync(mockSyncData);
      expect(getCachedUserSync()).not.toBeNull();

      clearCachedUserSync();
      expect(getCachedUserSync()).toBeNull();
    });
  });

  describe("syncUserData", () => {
    it("fetches fresh data from /api/user/sync and caches it", async () => {
      vi.spyOn(api, "getUserSync").mockResolvedValue(mockSyncData);

      const result = await syncUserData();
      expect(result.fromCache).toBe(false);
      expect(result.data?.user?.username).toBe("mobile_listener");

      // Verify it was stored in localStorage
      expect(getCachedUserSync()?.user?.id).toBe("user-test-1");
    });

    it("falls back to local cached snapshot when network request fails", async () => {
      saveCachedUserSync(mockSyncData);
      vi.spyOn(api, "getUserSync").mockRejectedValue(new Error("Network timeout"));

      const result = await syncUserData();
      expect(result.fromCache).toBe(true);
      expect(result.data?.user?.id).toBe("user-test-1");
      expect(result.error).toBe("Network timeout");
    });
  });

  describe("registerCurrentDevice", () => {
    it("calls api.registerMobileDevice with persistent device ID and metadata", async () => {
      const registerSpy = vi.spyOn(api, "registerMobileDevice").mockResolvedValue({
        ok: true,
        deviceId: "device-1",
      });

      const success = await registerCurrentDevice();
      expect(success).toBe(true);
      expect(registerSpy).toHaveBeenCalledOnce();
      const callArg = registerSpy.mock.calls[0][0];
      expect(callArg.id).toBeDefined();
      expect(callArg.appVersion).toBe(APP_VERSION);
    });
  });
});

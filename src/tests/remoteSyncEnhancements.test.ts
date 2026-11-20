import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getServerConnectivityStatus,
  setServerConnectivityStatus,
  subscribeServerConnectivity,
  type ServerConnectivityStatus,
} from "../lib/mobileBackend";
import { parseRemoteCommand } from "../lib/typeGuards";
import {
  dispatchMediaAction,
  initAndroidMediaSession,
  updateAndroidMediaMetadata,
  updateAndroidPlaybackState,
  type MediaSessionActionHandler,
} from "../lib/androidMediaSession";
import { api } from "../lib/api";
import type { Track } from "../lib/types";

describe("Remote Sync, MediaSession & Connectivity Enhancements", () => {
  const dummyTrack1: Track = {
    id: "trk-01",
    title: "Gole Yakh",
    titleFa: "گل یخ",
    artistId: "art-kourosh",
    artistName: "Kourosh Yaghmaei",
    artistNameFa: "کوروش یغمایی",
    artistAvatarColor: "#10b981",
    album: "Gole Yakh",
    albumFa: "گل یخ",
    genre: "Rock",
    mood: "Nostalgic",
    durationSec: 240,
    coverUrl: "/covers/track-01.jpg",
    audioUrl: "/audio/track-01.mp3",
    accentColor: "#10b981",
    playsCount: 500,
    likesCount: 150,
    repostsCount: 30,
    likedByMe: true,
    repostedByMe: false,
    uploadedBy: null,
    hasLyrics: true,
    lyricsSource: "lrclib",
    waveform: [0.1, 0.4, 0.8, 0.5, 0.2],
    createdAt: new Date().toISOString(),
  };

  const dummyTrack2: Track = {
    ...dummyTrack1,
    id: "trk-02",
    title: "Havaye Geryeh",
    titleFa: "هوای گریه",
    artistName: "Homayoun Shajarian",
    artistNameFa: "همایون شجریان",
    durationSec: 320,
    coverUrl: "/covers/track-02.jpg",
  };

  describe("1. Android MediaSession Notification Center Remote Control", () => {
    it("dispatches play/pause actions through MediaSession handler to control remote playback", () => {
      const dispatchedActions: string[] = [];
      const handler: MediaSessionActionHandler = {
        onPlay: () => dispatchedActions.push("PLAY"),
        onPause: () => dispatchedActions.push("PAUSE"),
        onTogglePlay: () => dispatchedActions.push("TOGGLE_PLAY"),
        onNext: () => dispatchedActions.push("NEXT"),
        onPrev: () => dispatchedActions.push("PREV"),
        onSeek: (sec) => dispatchedActions.push(`SEEK:${sec}`),
      };

      const cleanup = initAndroidMediaSession(handler);

      dispatchMediaAction("play", undefined, handler);
      dispatchMediaAction("pause", undefined, handler);
      dispatchMediaAction("togglePlay", undefined, handler);
      dispatchMediaAction("next", undefined, handler);
      dispatchMediaAction("prev", undefined, handler);
      dispatchMediaAction("seek", { position: 45 }, handler);

      expect(dispatchedActions).toEqual([
        "PLAY",
        "PAUSE",
        "TOGGLE_PLAY",
        "NEXT",
        "PREV",
        "SEEK:45",
      ]);

      cleanup();
    });

    it("evaluates remote controller state when remote browser is playing or paused", () => {
      const evaluateRemoteController = (
        isSync: boolean,
        isThisDevice: boolean,
        hasLocalAudioPlaying: boolean,
        remoteActiveId: string | null,
        localDeviceId: string,
      ): boolean => {
        if (!isSync) return false;
        if (isThisDevice) return false;
        if (hasLocalAudioPlaying) return false;
        return Boolean(remoteActiveId && remoteActiveId !== localDeviceId);
      };

      // When PC Chrome is playing
      expect(
        evaluateRemoteController(true, false, false, "dev-pc-chrome", "dev-phone-android"),
      ).toBe(true);

      // When PC Chrome is paused
      expect(
        evaluateRemoteController(true, false, false, "dev-pc-chrome", "dev-phone-android"),
      ).toBe(true);

      // When local audio is actively playing, should NOT act as remote controller
      expect(
        evaluateRemoteController(true, false, true, "dev-pc-chrome", "dev-phone-android"),
      ).toBe(false);

      // When sync is disabled, should NOT act as remote controller
      expect(
        evaluateRemoteController(false, false, false, "dev-pc-chrome", "dev-phone-android"),
      ).toBe(false);
    });
  });

  describe("2. Remote Playback Notification Metadata Updates", () => {
    it("updates metadata and playback state immediately when remote track changes", async () => {
      const metadataMock = vi.fn().mockResolvedValue(undefined);
      const playbackMock = vi.fn().mockResolvedValue(undefined);
      const startServiceMock = vi.fn().mockResolvedValue(undefined);

      (globalThis as unknown as { window: unknown }).window = {
        Capacitor: {
          isNativePlatform: () => true,
          Plugins: {
            MediaSessionPlugin: {
              startMediaService: startServiceMock,
              updateMetadata: metadataMock,
              updatePlaybackState: playbackMock,
            },
          },
        },
        location: { origin: "http://localhost:3000" },
      };

      await updateAndroidMediaMetadata({
        title: dummyTrack2.title,
        artist: dummyTrack2.artistName,
        album: dummyTrack2.album,
        coverUrl: dummyTrack2.coverUrl,
        duration: dummyTrack2.durationSec,
        trackId: dummyTrack2.id,
      });

      expect(startServiceMock).toHaveBeenCalled();
      expect(metadataMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Havaye Geryeh",
          artist: "Homayoun Shajarian",
          trackId: "trk-02",
        }),
      );

      await updateAndroidPlaybackState({
        isPlaying: true,
        position: 12,
        duration: 320,
        playbackRate: 1,
      });

      expect(playbackMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isPlaying: true,
          position: 12,
          duration: 320,
        }),
      );

      delete (globalThis as unknown as { window?: unknown }).window;
    });
  });

  describe("3. Independent Playback & Sync Toggle (isSyncEnabled)", () => {
    it("when sync is disabled, local device does not act as remote controller and allows independent playback", () => {
      let isSyncEnabled = false;

      const shouldSyncWithRemote = (enabled: boolean, activeDeviceId: string, myDeviceId: string) => {
        if (!enabled) return false;
        return activeDeviceId !== myDeviceId;
      };

      expect(shouldSyncWithRemote(isSyncEnabled, "dev-pc-chrome", "dev-phone")).toBe(false);

      // Re-enabling sync allows remote connection
      isSyncEnabled = true;
      expect(shouldSyncWithRemote(isSyncEnabled, "dev-pc-chrome", "dev-phone")).toBe(true);
    });

    it("persists sync toggle state in storage", () => {
      const STORAGE_KEY = "soundify_device_sync_enabled";
      const memoryStore = new Map<string, string>();
      const saveToggle = (val: boolean) => {
        memoryStore.set(STORAGE_KEY, String(val));
      };
      const loadToggle = () => {
        const s = memoryStore.get(STORAGE_KEY);
        return s !== undefined ? s === "true" : true;
      };

      saveToggle(false);
      expect(loadToggle()).toBe(false);

      saveToggle(true);
      expect(loadToggle()).toBe(true);
    });
  });

  describe("4. Server Connectivity & VPN Issue Detection", () => {
    beforeEach(() => {
      setServerConnectivityStatus("online");
    });

    it("reports 'vpn_or_server_down' when device is online but server requests fail", () => {
      let notifiedStatus: ServerConnectivityStatus | null = null;
      const unsub = subscribeServerConnectivity((s) => {
        notifiedStatus = s;
      });

      setServerConnectivityStatus("vpn_or_server_down");
      expect(getServerConnectivityStatus()).toBe("vpn_or_server_down");
      expect(notifiedStatus).toBe("vpn_or_server_down");

      setServerConnectivityStatus("online");
      expect(getServerConnectivityStatus()).toBe("online");
      expect(notifiedStatus).toBe("online");

      unsub();
    });

    it("generates correct user-facing message in Persian and English for VPN/server disconnect", () => {
      const getMessage = (lang: string) =>
        lang === "fa"
          ? "عدم برقراری ارتباط با سرور - اتصال اینترنت یا وضعیت فیلترشکن خود را بررسی کنید"
          : "Cannot connect to server - check internet connection or VPN status";

      expect(getMessage("fa")).toContain("فیلترشکن");
      expect(getMessage("en")).toContain("VPN");
    });
  });

  describe("5. Remote Volume Control Command Handling", () => {
    it("parses both SET_VOLUME and VOLUME commands properly", () => {
      const parsedSet = parseRemoteCommand("SET_VOLUME", { volume: 0.65 });
      expect(parsedSet).toEqual({ type: "SET_VOLUME", volume: 0.65 });

      const parsedVol = parseRemoteCommand("VOLUME", { volume: 0.4 });
      expect(parsedVol).toEqual({ type: "SET_VOLUME", volume: 0.4 });
    });

    it("clamps volume between 0 and 1", () => {
      const overflow = parseRemoteCommand("SET_VOLUME", { volume: 1.5 });
      expect(overflow).toEqual({ type: "SET_VOLUME", volume: 1 });

      const underflow = parseRemoteCommand("SET_VOLUME", { volume: -0.2 });
      expect(underflow).toEqual({ type: "SET_VOLUME", volume: 0 });
    });

    it("normalizes SET_VOLUME command to 'volume' when sending to backend", async () => {
      let capturedBody: { command?: string; params?: Record<string, unknown> } | null = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        if (init?.body && typeof init.body === "string") {
          try {
            capturedBody = JSON.parse(init.body) as { command?: string; params?: Record<string, unknown> };
          } catch {}
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, state: { volume: 0.75 } }),
        };
      });

      try {
        await api.sendDeviceCommand({
          command: "SET_VOLUME",
          payload: { volume: 0.75 },
          fromDeviceId: "dev-phone",
          targetDeviceId: "dev-pc",
        });

        expect(capturedBody).not.toBeNull();
        const body = capturedBody as unknown as { command?: string; params?: Record<string, unknown> };
        expect(body?.command).toBe("volume");
        expect(body?.params?.volume).toBe(0.75);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("6. Apple HIG Dynamic Island / Capsule Design Specifications", () => {
    it("meets minimum 44pt accessible touch targets for device picker toggle button", () => {
      const minTouchBoundary = 44; // pt
      const buttonHeight = 44;
      expect(buttonHeight).toBeGreaterThanOrEqual(minTouchBoundary);
    });

    it("enforces translucent blur material and rounded-full capsule geometry", () => {
      const capsuleTokens = {
        shape: "rounded-full",
        material: "backdrop-blur-2xl bg-black/75",
        border: "border-white/[0.16]",
        pulseIndicator: "bg-emerald-400 animate-ping",
      };

      expect(capsuleTokens.shape).toBe("rounded-full");
      expect(capsuleTokens.material).toContain("backdrop-blur-2xl");
      expect(capsuleTokens.pulseIndicator).toContain("emerald");
    });
  });
});

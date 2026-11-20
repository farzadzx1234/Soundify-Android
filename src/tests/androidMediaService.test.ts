import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  dispatchMediaAction,
  initAndroidMediaSession,
  isNativeMediaPluginAvailable,
  updateAndroidMediaMetadata,
  updateAndroidPlaybackState,
  startNativeMediaService,
  stopNativeMediaService,
  requestNativeAudioFocus,
  abandonNativeAudioFocus,
  acquireBackgroundWakeLock,
  releaseBackgroundWakeLock,
  getMediaSessionSnapshot,
  resetMediaSessionInternalState,
  type MediaSessionActionHandler,
} from "@/lib/androidMediaSession";

interface MockWindow {
  Capacitor?: {
    isNativePlatform: () => boolean;
    getPlatform: () => string;
    Plugins: {
      MediaSessionPlugin?: Record<string, unknown>;
    };
  };
  location?: { origin: string };
  navigator?: {
    mediaSession?: unknown;
  };
}

function setMockWindow(mock: MockWindow) {
  (globalThis as unknown as { window: unknown }).window = mock;
}

function clearMockWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe("Native Android Media Service, Lockscreen Controls & Audio Focus (Phase 8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetMediaSessionInternalState();
  });

  afterEach(() => {
    resetMediaSessionInternalState();
    clearMockWindow();
  });

  describe("Native Plugin Availability & Detection", () => {
    it("detects native media service when Capacitor Android environment is active", () => {
      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              updateMetadata: vi.fn(),
              updatePlaybackState: vi.fn(),
            },
          },
        },
      });

      expect(isNativeMediaPluginAvailable()).toBe(true);
    });

    it("returns false when running on standard browser / web platform", () => {
      setMockWindow({
        location: { origin: "https://soundify.app" },
        navigator: {},
      });

      expect(isNativeMediaPluginAvailable()).toBe(false);
    });
  });

  describe("Metadata Synchronization", () => {
    it("forwards track metadata to native MediaSessionPlugin when running natively", async () => {
      const updateMetadataMock = vi.fn().mockResolvedValue(undefined);
      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              updateMetadata: updateMetadataMock,
            },
          },
        },
      });

      await updateAndroidMediaMetadata({
        title: "Tehran Nights",
        artist: "Shervin",
        album: "Persian Wave",
        coverUrl: "https://soundify.app/covers/1.jpg",
        duration: 215,
        trackId: "track-101",
      });

      expect(updateMetadataMock).toHaveBeenCalledWith({
        title: "Tehran Nights",
        artist: "Shervin",
        album: "Persian Wave",
        coverUrl: "https://soundify.app/covers/1.jpg",
        duration: 215,
        trackId: "track-101",
      });

      const snapshot = getMediaSessionSnapshot();
      expect(snapshot.cachedLastMetadata?.title).toBe("Tehran Nights");
    });

    it("updates browser navigator.mediaSession metadata when in web browser", async () => {
      const mediaSessionMock = {
        metadata: null as unknown,
        setActionHandler: vi.fn(),
      };

      (globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata = class MockMediaMetadata {
        title: string;
        artist: string;
        album: string;
        artwork: Array<{ src: string }>;
        constructor(init: { title: string; artist: string; album: string; artwork: Array<{ src: string }> }) {
          this.title = init.title;
          this.artist = init.artist;
          this.album = init.album;
          this.artwork = init.artwork;
        }
      };

      setMockWindow({
        location: { origin: "https://soundify.app" },
        navigator: {
          mediaSession: mediaSessionMock,
        },
      });

      await updateAndroidMediaMetadata({
        title: "Gol-e Yakh",
        artist: "Kourosh Yaghmaei",
        album: "Back from the Brink",
        coverUrl: "/covers/kourosh.png",
        duration: 310,
        trackId: "track-202",
      });

      const meta = mediaSessionMock.metadata as { title: string; artist: string; artwork: Array<{ src: string }> };
      expect(meta.title).toBe("Gol-e Yakh");
      expect(meta.artist).toBe("Kourosh Yaghmaei");
      expect(meta.artwork[0].src).toBe("https://soundify.app/covers/kourosh.png");
    });
  });

  describe("Playback State Synchronization", () => {
    it("notifies native plugin of play/pause, position, and playback speed", async () => {
      const updatePlaybackStateMock = vi.fn().mockResolvedValue(undefined);
      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              updatePlaybackState: updatePlaybackStateMock,
            },
          },
        },
      });

      await updateAndroidPlaybackState({
        isPlaying: true,
        position: 45.5,
        duration: 180,
        playbackRate: 1.25,
      });

      expect(updatePlaybackStateMock).toHaveBeenCalledWith({
        isPlaying: true,
        position: 45.5,
        duration: 180,
        playbackRate: 1.25,
      });

      const snapshot = getMediaSessionSnapshot();
      expect(snapshot.cachedLastPlaybackState?.isPlaying).toBe(true);
      expect(snapshot.cachedLastPlaybackState?.position).toBe(45.5);
    });

    it("syncs with web navigator.mediaSession.playbackState and setPositionState", async () => {
      const setPositionStateMock = vi.fn();
      const mediaSessionMock = {
        playbackState: "none",
        setPositionState: setPositionStateMock,
        setActionHandler: vi.fn(),
      };

      setMockWindow({
        location: { origin: "https://soundify.app" },
        navigator: {
          mediaSession: mediaSessionMock,
        },
      });

      await updateAndroidPlaybackState({
        isPlaying: true,
        position: 60,
        duration: 200,
        playbackRate: 1.0,
      });

      expect(mediaSessionMock.playbackState).toBe("playing");
      expect(setPositionStateMock).toHaveBeenCalledWith({
        duration: 200,
        playbackRate: 1.0,
        position: 60,
      });
    });
  });

  describe("Lockscreen Controls & Media Button Dispatching", () => {
    it("routes native media button and notification events to registered handlers", () => {
      const handler: MediaSessionActionHandler = {
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onSeek: vi.fn(),
        onStop: vi.fn(),
      };

      initAndroidMediaSession(handler);

      dispatchMediaAction("play");
      expect(handler.onPlay).toHaveBeenCalledTimes(1);

      dispatchMediaAction("pause");
      expect(handler.onPause).toHaveBeenCalledTimes(1);

      dispatchMediaAction("next");
      expect(handler.onNext).toHaveBeenCalledTimes(1);

      dispatchMediaAction("prev");
      expect(handler.onPrev).toHaveBeenCalledTimes(1);

      dispatchMediaAction("seek", { position: 124.5 });
      expect(handler.onSeek).toHaveBeenCalledWith(124.5);

      dispatchMediaAction("stop");
      expect(handler.onStop).toHaveBeenCalledTimes(1);
    });

    it("falls back to onTogglePlay if onPlay or onPause are not defined", () => {
      const onTogglePlay = vi.fn();
      initAndroidMediaSession({ onTogglePlay });

      dispatchMediaAction("play");
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      dispatchMediaAction("pause");
      expect(onTogglePlay).toHaveBeenCalledTimes(2);

      dispatchMediaAction("togglePlay");
      expect(onTogglePlay).toHaveBeenCalledTimes(3);
    });
  });

  describe("Becoming Noisy (Headphone / Bluetooth Disconnection)", () => {
    it("immediately triggers onBecomingNoisy when headphones are unplugged", () => {
      const onBecomingNoisy = vi.fn();
      const onPause = vi.fn();

      initAndroidMediaSession({ onBecomingNoisy, onPause });

      dispatchMediaAction("becomingNoisy");

      expect(onBecomingNoisy).toHaveBeenCalledTimes(1);
      expect(onPause).not.toHaveBeenCalled();
    });

    it("falls back to onPause to protect against audio blast if onBecomingNoisy is omitted", () => {
      const onPause = vi.fn();

      initAndroidMediaSession({ onPause });

      dispatchMediaAction("becomingNoisy");

      expect(onPause).toHaveBeenCalledTimes(1);
    });
  });

  describe("Audio Focus State Machine", () => {
    it("handles incoming phone call (transient loss): pauses and marks resume flag", async () => {
      const onPause = vi.fn();
      const onPlay = vi.fn();
      const onAudioFocusChange = vi.fn();

      initAndroidMediaSession({ onPause, onPlay, onAudioFocusChange });

      // Simulate that the app is currently playing music
      await updateAndroidPlaybackState({
        isPlaying: true,
        position: 30,
        duration: 180,
      });

      // Phone call arrives -> transient loss
      dispatchMediaAction("audioFocusChange", { state: "transientLoss" });

      expect(onPause).toHaveBeenCalledTimes(1);
      expect(onAudioFocusChange).toHaveBeenCalledWith("transientLoss", false);

      const snapshotAfterCall = getMediaSessionSnapshot();
      expect(snapshotAfterCall.wasPlayingBeforeTransientLoss).toBe(true);

      // Call ends -> audio focus gained
      dispatchMediaAction("audioFocusChange", { state: "gain" });

      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(onAudioFocusChange).toHaveBeenCalledWith("gain", false);

      const snapshotAfterResume = getMediaSessionSnapshot();
      expect(snapshotAfterResume.wasPlayingBeforeTransientLoss).toBe(false);
    });

    it("does not auto-resume on focus gain if track was already paused before the call", async () => {
      const onPause = vi.fn();
      const onPlay = vi.fn();

      initAndroidMediaSession({ onPause, onPlay });

      // App was paused by user before phone call
      await updateAndroidPlaybackState({
        isPlaying: false,
        position: 10,
        duration: 180,
      });

      // Incoming phone call
      dispatchMediaAction("audioFocusChange", { state: "transientLoss" });
      expect(onPause).toHaveBeenCalledTimes(1);

      // Call ends
      dispatchMediaAction("audioFocusChange", { state: "gain", shouldResume: false });
      expect(onPlay).not.toHaveBeenCalled();
    });

    it("handles transient ducking (navigation prompts) and restores volume", () => {
      const onVolumeDuck = vi.fn();
      const onAudioFocusChange = vi.fn();

      initAndroidMediaSession({ onVolumeDuck, onAudioFocusChange });

      // Voice prompt begins -> duck
      dispatchMediaAction("audioFocusChange", { state: "duck" });
      expect(onVolumeDuck).toHaveBeenCalledWith(true);
      expect(getMediaSessionSnapshot().isCurrentlyDucked).toBe(true);

      // Voice prompt finishes -> focus restored
      dispatchMediaAction("audioFocusChange", { state: "gain" });
      expect(onVolumeDuck).toHaveBeenCalledWith(false);
      expect(getMediaSessionSnapshot().isCurrentlyDucked).toBe(false);
    });

    it("handles permanent audio focus loss (another media player started)", async () => {
      const onPause = vi.fn();
      const onPlay = vi.fn();

      initAndroidMediaSession({ onPause, onPlay });

      await updateAndroidPlaybackState({
        isPlaying: true,
        position: 50,
        duration: 180,
      });

      // Spotify / YouTube started on device -> permanent loss
      dispatchMediaAction("audioFocusChange", { state: "loss" });
      expect(onPause).toHaveBeenCalledTimes(1);

      // Later, focus is regained -> Soundify should NOT resume over the other player
      dispatchMediaAction("audioFocusChange", { state: "gain" });
      expect(onPlay).not.toHaveBeenCalled();
    });
  });

  describe("Native Service Control Helpers", () => {
    it("requests and abandons audio focus via native plugin", async () => {
      const requestAudioFocusMock = vi.fn().mockResolvedValue({ granted: true });
      const abandonAudioFocusMock = vi.fn().mockResolvedValue(undefined);

      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              requestAudioFocus: requestAudioFocusMock,
              abandonAudioFocus: abandonAudioFocusMock,
            },
          },
        },
      });

      const granted = await requestNativeAudioFocus();
      expect(granted).toBe(true);
      expect(requestAudioFocusMock).toHaveBeenCalledTimes(1);

      await abandonNativeAudioFocus();
      expect(abandonAudioFocusMock).toHaveBeenCalledTimes(1);
    });

    it("acquires and releases mobile wake lock via native plugin", async () => {
      const acquireWakeLockMock = vi.fn().mockResolvedValue(undefined);
      const releaseWakeLockMock = vi.fn().mockResolvedValue(undefined);

      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              acquireWakeLock: acquireWakeLockMock,
              releaseWakeLock: releaseWakeLockMock,
            },
          },
        },
      });

      await acquireBackgroundWakeLock();
      expect(acquireWakeLockMock).toHaveBeenCalledTimes(1);

      await releaseBackgroundWakeLock();
      expect(releaseWakeLockMock).toHaveBeenCalledTimes(1);
    });

    it("starts and stops foreground media service via native plugin", async () => {
      const startMediaServiceMock = vi.fn().mockResolvedValue(undefined);
      const stopMediaServiceMock = vi.fn().mockResolvedValue(undefined);

      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              startMediaService: startMediaServiceMock,
              stopMediaService: stopMediaServiceMock,
            },
          },
        },
      });

      await startNativeMediaService();
      expect(startMediaServiceMock).toHaveBeenCalledTimes(1);

      await stopNativeMediaService();
      expect(stopMediaServiceMock).toHaveBeenCalledTimes(1);
    });

    it("cleans up previous listener when re-initializing media session", () => {
      const removeMock = vi.fn();
      const addListenerMock = vi.fn().mockReturnValue({ remove: removeMock });

      setMockWindow({
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              addListener: addListenerMock,
            },
          },
        },
      });

      initAndroidMediaSession({});
      expect(addListenerMock).toHaveBeenCalledTimes(1);

      // Re-init should clean up previous registration
      initAndroidMediaSession({});
      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(addListenerMock).toHaveBeenCalledTimes(2);
    });

    it("ignores unknown actions and handles non-numeric seek safely", () => {
      const onSeek = vi.fn();
      initAndroidMediaSession({ onSeek });

      dispatchMediaAction("unknownAction");
      dispatchMediaAction("seek", { position: "invalid" as unknown as number });
      expect(onSeek).toHaveBeenCalledWith(0);
    });
  });
});

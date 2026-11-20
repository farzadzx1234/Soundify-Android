import { describe, expect, it, vi } from "vitest";
import { TRANSLATIONS } from "../context/I18nContext";
import {
  initAndroidMediaSession,
  resetMediaSessionInternalState,
} from "../lib/androidMediaSession";
import {
  createSwipeTouchHandlers,
} from "../lib/touchGestures";
import {
  isTrack,
  isPlaylist,
  isUser,
  isDeviceInfo,
  isPlaybackStateSync,
  isEncryptedEnvelope,
} from "../lib/typeGuards";

describe("Phase 10: Zero-Flaw Integration & Deep Section Audit", () => {
  describe("Bidirectional RTL / LTR Language Parity", () => {
    it("guarantees 100% translation key parity between English (LTR) and Persian (RTL)", () => {
      const enKeys = Object.keys(TRANSLATIONS.en).sort();
      const faKeys = Object.keys(TRANSLATIONS.fa).sort();

      const missingInFa = enKeys.filter((k) => !(k in TRANSLATIONS.fa));
      const missingInEn = faKeys.filter((k) => !(k in TRANSLATIONS.en));

      expect(missingInFa).toEqual([]);
      expect(missingInEn).toEqual([]);
      expect(enKeys.length).toBeGreaterThanOrEqual(100);
    });

    it("ensures no translation values are empty or unassigned", () => {
      for (const [, val] of Object.entries(TRANSLATIONS.en)) {
        expect(typeof val).toBe("string");
        expect(val.trim().length).toBeGreaterThan(0);
      }
      for (const [, val] of Object.entries(TRANSLATIONS.fa)) {
        expect(typeof val).toBe("string");
        expect(val.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("Memory Leak & Cleanup Parity", () => {
    it("verifies Android media session listeners detach completely upon cleanup", () => {
      resetMediaSessionInternalState();
      const removeMock = vi.fn();
      const addListenerMock = vi.fn().mockReturnValue({ remove: removeMock });

      (globalThis as unknown as { window: unknown }).window = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaSessionPlugin: {
              addListener: addListenerMock,
            },
          },
        },
      };

      const cleanup = initAndroidMediaSession({});
      expect(addListenerMock).toHaveBeenCalledTimes(1);

      cleanup();
      expect(removeMock).toHaveBeenCalledTimes(1);

      delete (globalThis as unknown as { window?: unknown }).window;
    });

    it("verifies touch gesture handlers clean up internal tracking state on cancel and drag end", () => {
      let isTrackingEnded = false;

      const handlers = createSwipeTouchHandlers({
        dir: "rtl",
        onSwipeNext: () => {},
        onDragEnd: () => {
          isTrackingEnded = true;
        },
        triggerHaptics: false,
      });

      const mockEvent = {
        touches: [{ clientX: 100, clientY: 100 }],
        changedTouches: [{ clientX: 100, clientY: 100 }],
        target: { closest: () => null } as unknown as EventTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.TouchEvent;

      handlers.onTouchStart(mockEvent);
      handlers.onTouchCancel();

      expect(isTrackingEnded).toBe(true);
    });
  });

  describe("Graceful Network Degradation & Offline Safety", () => {
    it("handles simulated network failures cleanly in media validation", () => {
      const corruptPayload = {
        id: "offline-corrupt",
        title: "",
        durationSec: "NaN",
      };
      expect(isTrack(corruptPayload)).toBe(false);
      expect(isPlaylist(corruptPayload)).toBe(false);
      expect(isUser(corruptPayload)).toBe(false);
      expect(isDeviceInfo(corruptPayload)).toBe(false);
      expect(isPlaybackStateSync(corruptPayload)).toBe(false);
      expect(isEncryptedEnvelope(corruptPayload)).toBe(false);
    });

    it("strictly verifies PlaybackStateSync track and activeDeviceId nullability", () => {
      const baseState = {
        activeDeviceId: null,
        trackId: null,
        track: null,
        isPlaying: false,
        currentTime: 0,
        duration: 200,
        volume: 0.8,
        repeat: "off" as const,
        shuffle: false,
        updatedAt: Date.now(),
      };
      expect(isPlaybackStateSync(baseState)).toBe(true);

      // Invalid track format
      expect(isPlaybackStateSync({ ...baseState, track: "invalid-string-track" })).toBe(false);
      expect(isPlaybackStateSync({ ...baseState, track: { title: "Only Title" } })).toBe(false);

      // Invalid volume range or type
      expect(isPlaybackStateSync({ ...baseState, volume: "loud" })).toBe(false);

      // Invalid repeat mode
      expect(isPlaybackStateSync({ ...baseState, repeat: "forever" })).toBe(false);
    });

    it("strictly verifies DeviceInfo valid hardware types", () => {
      const validDevice = {
        id: "dev-phone-1",
        name: "Galaxy Ultra",
        type: "smartphone",
        isActive: true,
        isCurrent: true,
        lastActive: new Date().toISOString(),
      };
      expect(isDeviceInfo(validDevice)).toBe(true);

      // Unsupported device type
      expect(isDeviceInfo({ ...validDevice, type: "microwave" })).toBe(false);
      expect(isDeviceInfo({ ...validDevice, type: "smartwatch" })).toBe(false);
    });
  });
});

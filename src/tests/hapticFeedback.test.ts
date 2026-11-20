import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { triggerHapticFeedback, hapticFeedback } from "@/lib/hapticFeedback";

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    vibrate: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: {
    Light: "LIGHT",
    Medium: "MEDIUM",
    Heavy: "HEAVY",
  },
  NotificationType: {
    Success: "SUCCESS",
    Warning: "WARNING",
    Error: "ERROR",
  },
}));

describe("Haptic Feedback Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error clean mock
    delete globalThis.window;
  });

  describe("Capacitor Native Platform Integration", () => {
    beforeEach(() => {
      // @ts-expect-error mock window with Capacitor
      globalThis.window = {
        Capacitor: {
          isNativePlatform: () => true,
        },
      };
    });

    it("triggers Light impact for tap, selection, and dismiss", async () => {
      await triggerHapticFeedback("tap");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });

      await triggerHapticFeedback("selection");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });

      await triggerHapticFeedback("dismiss");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });
    });

    it("triggers Medium impact for playPause, trackSkip, and refresh", async () => {
      await triggerHapticFeedback("playPause");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });

      await triggerHapticFeedback("trackSkip");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });

      await triggerHapticFeedback("refresh");
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });
    });

    it("triggers Success notification for downloadComplete", async () => {
      await triggerHapticFeedback("downloadComplete");
      expect(Haptics.notification).toHaveBeenCalledWith({ type: NotificationType.Success });
    });

    it("adjusts likeToggle impact based on liked state", async () => {
      await triggerHapticFeedback("likeToggle", { liked: true });
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });

      await triggerHapticFeedback("likeToggle", { liked: false });
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });
    });

    it("invokes convenience methods on hapticFeedback helper", async () => {
      await hapticFeedback.playPause();
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });

      await hapticFeedback.downloadComplete();
      expect(Haptics.notification).toHaveBeenCalledWith({ type: NotificationType.Success });
    });
  });

  describe("HTML5 Vibration API Web / WebView Fallback", () => {
    let vibrateMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vibrateMock = vi.fn();
      Object.defineProperty(navigator, "vibrate", {
        value: vibrateMock,
        configurable: true,
        writable: true,
      });

      // @ts-expect-error mock window without Capacitor native
      globalThis.window = {
        Capacitor: {
          isNativePlatform: () => false,
        },
      };
    });

    it("calls navigator.vibrate with light duration for tap and selection", async () => {
      await triggerHapticFeedback("tap");
      expect(vibrateMock).toHaveBeenCalledWith(10);

      await triggerHapticFeedback("selection");
      expect(vibrateMock).toHaveBeenCalledWith(10);
    });

    it("calls navigator.vibrate with medium duration for playPause, refresh, and trackSkip", async () => {
      await triggerHapticFeedback("playPause");
      expect(vibrateMock).toHaveBeenCalledWith(22);

      await triggerHapticFeedback("refresh");
      expect(vibrateMock).toHaveBeenCalledWith(22);

      await triggerHapticFeedback("trackSkip");
      expect(vibrateMock).toHaveBeenCalledWith(22);
    });

    it("calls navigator.vibrate pattern for like toggle", async () => {
      await triggerHapticFeedback("likeToggle", { liked: true });
      expect(vibrateMock).toHaveBeenCalledWith([14, 40, 24]);

      await triggerHapticFeedback("likeToggle", { liked: false });
      expect(vibrateMock).toHaveBeenCalledWith(10);
    });

    it("calls navigator.vibrate for downloadComplete", async () => {
      await triggerHapticFeedback("downloadComplete");
      expect(vibrateMock).toHaveBeenCalledWith(40);
    });

    it("safely degrades when navigator.vibrate throws or is unsupported", async () => {
      // @ts-expect-error delete vibrate for test
      delete navigator.vibrate;

      await expect(triggerHapticFeedback("playPause")).resolves.not.toThrow();
    });
  });
});

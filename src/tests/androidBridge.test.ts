import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  dispatchAndroidBack,
  isAndroidDevice,
  isAndroidNative,
  registerBackButtonHandler,
  triggerHaptic,
} from "@/lib/androidBridge";

describe("Android Native Bridge & Platform Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.window;
  });

  describe("Platform Detection", () => {
    it("correctly identifies Android user agent", () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      );

      expect(isAndroidDevice()).toBe(true);
    });

    it("identifies non-Android user agent", () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      );

      expect(isAndroidDevice()).toBe(false);
    });

    it("identifies Capacitor native Android platform", () => {
      // @ts-expect-error mock window
      globalThis.window = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
        },
      };

      expect(isAndroidNative()).toBe(true);
    });

    it("returns false for web platform", () => {
      // @ts-expect-error mock window
      globalThis.window = {
        Capacitor: {
          isNativePlatform: () => false,
          getPlatform: () => "web",
        },
      };

      expect(isAndroidNative()).toBe(false);
    });
  });

  describe("Hardware Back Button Handler Stack", () => {
    it("handles back button in LIFO priority order", () => {
      const order: string[] = [];

      const unreg1 = registerBackButtonHandler(() => {
        order.push("handler1");
        return false;
      });

      const unreg2 = registerBackButtonHandler(() => {
        order.push("handler2");
        return true; // consumes the event
      });

      const handled = dispatchAndroidBack();

      expect(handled).toBe(true);
      expect(order).toEqual(["handler2"]);

      unreg1();
      unreg2();
    });

    it("propagates to lower handlers when top handler does not consume", () => {
      const order: string[] = [];

      const unreg1 = registerBackButtonHandler(() => {
        order.push("handler1");
        return true;
      });

      const unreg2 = registerBackButtonHandler(() => {
        order.push("handler2");
        return false; // does not consume
      });

      const handled = dispatchAndroidBack();

      expect(handled).toBe(true);
      expect(order).toEqual(["handler2", "handler1"]);

      unreg1();
      unreg2();
    });

    it("returns false if no handler consumes back press", () => {
      const unreg = registerBackButtonHandler(() => false);
      const handled = dispatchAndroidBack();

      expect(handled).toBe(false);
      unreg();
    });

    it("properly unregisters handlers", () => {
      const fn = vi.fn(() => true);
      const unregister = registerBackButtonHandler(fn);

      unregister();
      const handled = dispatchAndroidBack();

      expect(handled).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("Haptic Feedback", () => {
    it("calls navigator.vibrate with correct vibration duration on Android", () => {
      const vibrateMock = vi.fn();
      Object.defineProperty(navigator, "vibrate", {
        value: vibrateMock,
        configurable: true,
        writable: true,
      });

      triggerHaptic("light");
      expect(vibrateMock).toHaveBeenCalledWith(10);

      triggerHaptic("medium");
      expect(vibrateMock).toHaveBeenCalledWith(22);

      triggerHaptic("heavy");
      expect(vibrateMock).toHaveBeenCalledWith(40);
    });

    it("safely handles environments without navigator.vibrate", () => {
      // @ts-expect-error delete vibrate for test
      delete navigator.vibrate;

      expect(() => triggerHaptic("light")).not.toThrow();
    });
  });
});

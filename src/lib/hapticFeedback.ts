/**
 * Haptic Feedback Service for Soundify Mobile & Web
 *
 * Implements tactile haptic feedback:
 * 1. Native Capacitor Haptics (via window.Capacitor.Plugins.Haptics) on Android native runtime
 * 2. HTML5 Vibration API (navigator.vibrate) fallback for WebViews and mobile browsers
 * 3. Graceful degradation when running in headless / SSR / desktop environments
 */

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticType =
  | "tap"
  | "selection"
  | "playPause"
  | "likeToggle"
  | "modeToggle"
  | "trackSkip"
  | "downloadComplete"
  | "refresh"
  | "dismiss"
  | "light"
  | "medium"
  | "heavy";

export interface HapticFeedbackOptions {
  liked?: boolean;
}

interface CapacitorHapticsPlugin {
  impact: (opts: { style: string }) => Promise<void>;
  notification: (opts: { type: string }) => Promise<void>;
}

interface WindowWithCapacitor extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Haptics?: CapacitorHapticsPlugin;
    };
  };
}

/**
 * Triggers tactile haptic feedback matching the interaction context.
 */
export async function triggerHapticFeedback(
  type: HapticType = "tap",
  options?: HapticFeedbackOptions,
): Promise<void> {
  let handledByCapacitor = false;

  // 1. Try Capacitor Native Haptics Plugin
  try {
    const win = typeof window !== "undefined" ? (window as WindowWithCapacitor) : null;
    const isNative =
      typeof win?.Capacitor?.isNativePlatform === "function" &&
      win.Capacitor.isNativePlatform();

    if (isNative) {
      const plugin = win?.Capacitor?.Plugins?.Haptics || Haptics;
      switch (type) {
        case "tap":
        case "selection":
        case "dismiss":
        case "light":
          await plugin.impact({ style: ImpactStyle.Light });
          handledByCapacitor = true;
          break;
        case "playPause":
        case "trackSkip":
        case "refresh":
        case "medium":
          await plugin.impact({ style: ImpactStyle.Medium });
          handledByCapacitor = true;
          break;
        case "modeToggle":
          await plugin.impact({ style: ImpactStyle.Light });
          handledByCapacitor = true;
          break;
        case "heavy":
          await plugin.impact({ style: ImpactStyle.Heavy });
          handledByCapacitor = true;
          break;
        case "likeToggle":
          if (options?.liked !== false) {
            await plugin.impact({ style: ImpactStyle.Medium });
          } else {
            await plugin.impact({ style: ImpactStyle.Light });
          }
          handledByCapacitor = true;
          break;
        case "downloadComplete":
          await plugin.notification({ type: NotificationType.Success });
          handledByCapacitor = true;
          break;
      }
    }
  } catch {
    handledByCapacitor = false;
  }

  // 2. Fallback to HTML5 Vibration API for Android WebViews & Mobile Browsers
  if (!handledByCapacitor) {
    try {
      if (
        typeof navigator !== "undefined" &&
        "vibrate" in navigator &&
        typeof navigator.vibrate === "function"
      ) {
        switch (type) {
          case "tap":
          case "selection":
          case "dismiss":
          case "light":
            navigator.vibrate(10);
            break;
          case "medium":
          case "playPause":
          case "trackSkip":
          case "refresh":
            navigator.vibrate(22);
            break;
          case "heavy":
          case "downloadComplete":
            navigator.vibrate(40);
            break;
          case "modeToggle":
            navigator.vibrate(15);
            break;
          case "likeToggle":
            if (options?.liked !== false) {
              navigator.vibrate([14, 40, 24]);
            } else {
              navigator.vibrate(10);
            }
            break;
        }
      }
    } catch {
      // Ignored if vibration is disabled or not allowed without direct gesture
    }
  }
}

/**
 * Convenience methods for common mobile interactions
 */
export const hapticFeedback = {
  tap: () => triggerHapticFeedback("tap"),
  selection: () => triggerHapticFeedback("selection"),
  playPause: () => triggerHapticFeedback("playPause"),
  likeToggle: (liked?: boolean) => triggerHapticFeedback("likeToggle", { liked }),
  modeToggle: () => triggerHapticFeedback("modeToggle"),
  trackSkip: () => triggerHapticFeedback("trackSkip"),
  downloadComplete: () => triggerHapticFeedback("downloadComplete"),
  refresh: () => triggerHapticFeedback("refresh"),
  dismiss: () => triggerHapticFeedback("dismiss"),
};

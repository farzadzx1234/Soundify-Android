/**
 * Android Native Bridge & Platform Utilities for Soundify
 *
 * Provides deep native Android integration:
 * - Hardware back button handling for modals, full-screen player, and navigation
 * - Native haptic feedback for player controls and scrubbers
 * - Translucent system status bar and navigation bar tinting
 * - Platform detection and safe area adaptation
 */

export interface AndroidBridgeState {
  isNative: boolean;
  isAndroid: boolean;
  hasHardwareBack: boolean;
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: Record<string, unknown>;
    };
  }
}

function getWindow(): (Window & typeof globalThis) | undefined {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return (globalThis as unknown as { window: Window & typeof globalThis }).window;
  }
  return undefined;
}

function getNavigator(): Navigator | undefined {
  if (typeof navigator !== "undefined") return navigator;
  if (typeof globalThis !== "undefined" && "navigator" in globalThis) {
    return (globalThis as unknown as { navigator: Navigator }).navigator;
  }
  return undefined;
}

/**
 * Checks whether the application is running inside the native Android wrapper.
 */
export function isAndroidNative(): boolean {
  try {
    const win = getWindow();
    if (!win) return false;
    const isCapNative = win.Capacitor?.isNativePlatform?.() ?? false;
    const platform = win.Capacitor?.getPlatform?.();
    if (isCapNative && platform === "android") return true;

    // Check Capacitor native schemes and Android WebView origins
    const loc = win.location;
    if (loc) {
      if (loc.protocol === "capacitor:" || loc.origin === "capacitor://localhost") {
        return true;
      }
      // On Android Capacitor with androidScheme: "https", origin is https://localhost without port
      if (loc.origin === "https://localhost" && (!loc.port || loc.port === "443" || loc.port === "")) {
        return true;
      }
    }

    const nav = getNavigator();
    const ua = nav?.userAgent || "";
    const isAndroidUa = /Android/i.test(ua);
    if (isAndroidUa) {
      if (Boolean(win.Capacitor) || /wv/i.test(ua) || (loc && (!loc.port || loc.port === ""))) {
        return true;
      }
    }

    return Boolean(win.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * Checks whether the device is an Android device (browser or native app).
 */
export function isAndroidDevice(): boolean {
  try {
    const nav = getNavigator();
    return /Android/i.test(nav?.userAgent || "");
  } catch {
    return false;
  }
}

import { triggerHapticFeedback, type HapticType } from "./hapticFeedback";

export { triggerHapticFeedback, hapticFeedback } from "./hapticFeedback";

/**
 * Native Haptic Feedback for interactive controls (play/pause, seek, tab change).
 * Integrates Capacitor Native Haptics with HTML5 Vibration API fallback.
 */
export function triggerHaptic(type: "light" | "medium" | "heavy" | "selection" = "light"): void {
  const map: Record<string, HapticType> = {
    light: "tap",
    selection: "selection",
    medium: "playPause",
    heavy: "downloadComplete",
  };
  void triggerHapticFeedback(map[type] ?? "tap");
}

export type BackButtonHandler = () => boolean;

const backHandlers: BackButtonHandler[] = [];

/**
 * Register a hardware back button handler.
 * If the handler returns `true`, the back action is considered consumed.
 * Handlers are executed in LIFO (stack) order.
 */
export function registerBackButtonHandler(handler: BackButtonHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.indexOf(handler);
    if (idx !== -1) {
      backHandlers.splice(idx, 1);
    }
  };
}

/**
 * Executes registered back button handlers.
 * Returns true if an overlay/modal consumed the back press.
 */
export function dispatchAndroidBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    const handler = backHandlers[i];
    if (handler && handler()) {
      return true;
    }
  }
  return false;
}

let appForegroundState = true;
const appStateListeners = new Set<(isActive: boolean) => void>();

/**
 * Checks whether the app is currently actively visible and in the foreground.
 * Evaluates document visibility, documentElement data attributes, and Capacitor app state.
 */
export function isAppInForeground(): boolean {
  if (typeof document !== "undefined") {
    if (document.hidden) return false;
    if (document.documentElement.getAttribute("data-app-state") === "background") return false;
  }
  return appForegroundState;
}

/**
 * Updates the foreground/background state and notifies active visualizers and tickers.
 */
export function setAppForegroundState(isActive: boolean): void {
  appForegroundState = isActive;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-app-state", isActive ? "active" : "background");
  }
  for (const listener of appStateListeners) {
    try {
      listener(isActive);
    } catch {}
  }
}

/**
 * Subscribes a visualizer or ticker to app state changes.
 */
export function subscribeToAppState(callback: (isActive: boolean) => void): () => void {
  appStateListeners.add(callback);
  return () => appStateListeners.delete(callback);
}

// Global hook for Android MainActivity to communicate backgrounding immediately
if (typeof window !== "undefined") {
  (window as unknown as { __soundifySetBackground?: (isBg: boolean) => void }).__soundifySetBackground = (isBg: boolean) => {
    setAppForegroundState(!isBg);
  };
}

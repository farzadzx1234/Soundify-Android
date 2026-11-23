/**
 * Soundify Native Android Media Service & Web MediaSession Bridge
 *
 * Provides:
 * - Integration with native Android Foreground Service & MediaSessionPlugin
 * - Lockscreen and notification shade controls (Play/Pause, Next, Prev, Seek)
 * - Hardware media buttons, Bluetooth AVRCP and smartwatch controls
 * - Audio Focus state machine (transient pausing for phone calls, ducking for navigation, resume on gain)
 * - Becoming Noisy broadcast handling (auto-pause on headphone disconnect)
 * - Seamless fallback to standard W3C navigator.mediaSession on browser / desktop
 */

import { isAndroidNative } from "./androidBridge";

export interface AndroidMediaMetadata {
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  duration?: number;
  trackId?: string;
}

export interface AndroidPlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
  playbackRate?: number;
}

export type AudioFocusState = "loss" | "transientLoss" | "duck" | "gain";

export interface MediaSessionActionHandler {
  onPlay?: () => void;
  onPause?: () => void;
  onTogglePlay?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSeek?: (seconds: number) => void;
  onStop?: () => void;
  onBecomingNoisy?: () => void;
  onAudioFocusChange?: (state: AudioFocusState, shouldResume?: boolean) => void;
  onVolumeDuck?: (duck: boolean) => void;
}

export interface NativeMediaSessionPluginInterface {
  startMediaService?: () => Promise<void>;
  stopMediaService?: () => Promise<void>;
  updateMetadata?: (meta: AndroidMediaMetadata) => Promise<void>;
  updatePlaybackState?: (state: AndroidPlaybackState) => Promise<void>;
  requestAudioFocus?: () => Promise<{ granted: boolean }>;
  abandonAudioFocus?: () => Promise<void>;
  acquireWakeLock?: () => Promise<void>;
  releaseWakeLock?: () => Promise<void>;
  addListener?: (
    eventName: "mediaAction",
    listener: (event: { action: string; data?: Record<string, unknown> }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
}

// Global state trackers for Audio Focus and Ducking
let wasPlayingBeforeTransientLoss = false;
let isCurrentlyDucked = false;
let activeHandler: MediaSessionActionHandler | null = null;
let nativeSubscriptionCleanup: (() => void) | null = null;
let cachedLastMetadata: AndroidMediaMetadata | null = null;
let cachedLastPlaybackState: AndroidPlaybackState | null = null;

function getWindow(): Window | undefined {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return (globalThis as unknown as { window: Window }).window;
  }
  return undefined;
}

function getNativePlugin(): NativeMediaSessionPluginInterface | null {
  const win = getWindow();
  if (!win) return null;
  const plugins = (win as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins;
  if (plugins && "MediaSessionPlugin" in plugins) {
    return plugins.MediaSessionPlugin as NativeMediaSessionPluginInterface;
  }
  return null;
}

/**
 * Checks whether the native Android MediaSessionPlugin is available in the current environment.
 */
export function isNativeMediaPluginAvailable(): boolean {
  return isAndroidNative() && Boolean(getNativePlugin());
}

/**
 * Handles incoming native media action events.
 */
export function dispatchMediaAction(
  action: string,
  data?: Record<string, unknown>,
  handler: MediaSessionActionHandler | null = activeHandler,
): void {
  if (!handler) return;

  switch (action) {
    case "play":
      if (handler.onPlay) handler.onPlay();
      else if (handler.onTogglePlay) handler.onTogglePlay();
      break;

    case "pause":
      if (handler.onPause) handler.onPause();
      else if (handler.onTogglePlay) handler.onTogglePlay();
      break;

    case "togglePlay":
      if (handler.onTogglePlay) handler.onTogglePlay();
      break;

    case "next":
      if (handler.onNext) handler.onNext();
      break;

    case "prev":
      if (handler.onPrev) handler.onPrev();
      break;

    case "seek": {
      const pos = typeof data?.position === "number" ? data.position : 0;
      if (handler.onSeek) handler.onSeek(pos);
      break;
    }

    case "stop":
      if (handler.onStop) handler.onStop();
      break;

    case "becomingNoisy":
      if (handler.onBecomingNoisy) {
        handler.onBecomingNoisy();
      } else if (handler.onPause) {
        handler.onPause();
      } else if (handler.onTogglePlay) {
        handler.onTogglePlay();
      }
      break;

    case "audioFocusChange": {
      const state = (data?.state as AudioFocusState) || "loss";
      const shouldResume = Boolean(data?.shouldResume);

      if (state === "transientLoss") {
        wasPlayingBeforeTransientLoss = Boolean(cachedLastPlaybackState?.isPlaying);
        if (handler.onPause) handler.onPause();
      } else if (state === "gain") {
        if (isCurrentlyDucked) {
          isCurrentlyDucked = false;
          if (handler.onVolumeDuck) handler.onVolumeDuck(false);
        }
        const mustResume = wasPlayingBeforeTransientLoss || shouldResume;
        wasPlayingBeforeTransientLoss = false;
        if (mustResume && handler.onPlay) {
          handler.onPlay();
        }
      } else if (state === "duck") {
        isCurrentlyDucked = true;
        if (handler.onVolumeDuck) handler.onVolumeDuck(true);
      } else if (state === "loss") {
        wasPlayingBeforeTransientLoss = false;
        if (isCurrentlyDucked) {
          isCurrentlyDucked = false;
          if (handler.onVolumeDuck) handler.onVolumeDuck(false);
        }
        if (handler.onPause) handler.onPause();
      }

      if (handler.onAudioFocusChange) {
        handler.onAudioFocusChange(state, shouldResume);
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Initializes the MediaSession controller and bi-directional listeners.
 * Configures both Native Android Foreground Service and Web navigator.mediaSession.
 */
export function initAndroidMediaSession(handler: MediaSessionActionHandler): () => void {
  activeHandler = handler;

  if (nativeSubscriptionCleanup) {
    try {
      nativeSubscriptionCleanup();
    } catch {}
    nativeSubscriptionCleanup = null;
  }

  // Automatically start native foreground media service if available
  void startNativeMediaService();

  // 1. Native Android Plugin listener registration
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.addListener) {
    try {
      const res = nativePlugin.addListener("mediaAction", (event) => {
        dispatchMediaAction(event.action, event.data, handler);
      });

      nativeSubscriptionCleanup = () => {
        if (res && "then" in res) {
          void (res as Promise<{ remove: () => Promise<void> }>).then((handle) => handle.remove()).catch(() => {});
        } else if (res && "remove" in res) {
          (res as { remove: () => void }).remove();
        }
      };
    } catch {
      nativeSubscriptionCleanup = null;
    }
  }

  // 2. W3C navigator.mediaSession setup (for browser / desktop / PWA)
  const win = getWindow();
  if (win && win.navigator && "mediaSession" in win.navigator && win.navigator.mediaSession) {
    const ms = win.navigator.mediaSession;

    try {
      ms.setActionHandler("play", () => dispatchMediaAction("play", undefined, handler));
      ms.setActionHandler("pause", () => dispatchMediaAction("pause", undefined, handler));
      ms.setActionHandler("previoustrack", () => dispatchMediaAction("prev", undefined, handler));
      ms.setActionHandler("nexttrack", () => dispatchMediaAction("next", undefined, handler));
      ms.setActionHandler("stop", () => dispatchMediaAction("stop", undefined, handler));

      ms.setActionHandler("seekto", (details) => {
        if (details.seekTime != null) {
          dispatchMediaAction("seek", { position: details.seekTime }, handler);
        }
      });

      ms.setActionHandler("seekbackward", (details) => {
        const skip = details.seekOffset || 10;
        const current = cachedLastPlaybackState?.position || 0;
        dispatchMediaAction("seek", { position: Math.max(0, current - skip) }, handler);
      });

      ms.setActionHandler("seekforward", (details) => {
        const skip = details.seekOffset || 10;
        const current = cachedLastPlaybackState?.position || 0;
        dispatchMediaAction("seek", { position: current + skip }, handler);
      });
    } catch {
      // Some browsers might not support all action handlers
    }
  }

  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
    if (nativeSubscriptionCleanup) {
      nativeSubscriptionCleanup();
      nativeSubscriptionCleanup = null;
    }
  };
}

/**
 * Converts a local blob: URL (such as an offline cached album cover) into a compact
 * JPEG data URI so Android MediaSessionService can decode it directly without network
 * or WebView-isolated blob:// restrictions.
 */
export async function blobUrlToJpegDataUrl(blobUrl: string, maxDim = 256): Promise<string | null> {
  if (!blobUrl || !blobUrl.startsWith("blob:") || typeof window === "undefined") {
    return null;
  }

  // Primary path: scale cleanly onto a tiny offscreen canvas (<20 KB JPEG, safe for Binder IPC)
  try {
    if (typeof Image !== "undefined" && typeof document !== "undefined") {
      const scaledDataUrl = await new Promise<string | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width || maxDim;
            const h = img.naturalHeight || img.height || maxDim;
            const scale = Math.min(1, maxDim / Math.max(w, h, 1));
            const targetW = Math.max(1, Math.round(w * scale));
            const targetH = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement("canvas");
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, targetW, targetH);
            const encoded = canvas.toDataURL("image/jpeg", 0.82);
            resolve(encoded && encoded.startsWith("data:image/") ? encoded : null);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = blobUrl;
      });
      if (scaledDataUrl) return scaledDataUrl;
    }
  } catch {}

  // Fallback path: read raw blob bytes directly when small (< 400 KB)
  try {
    const res = await fetch(blobUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 400 * 1024 || typeof FileReader === "undefined") return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const out = typeof reader.result === "string" ? reader.result : null;
        resolve(out && out.startsWith("data:image/") ? out : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Updates track metadata in the native MediaSession & Notification shade,
 * and syncs with browser navigator.mediaSession.
 */
export async function updateAndroidMediaMetadata(metadata: AndroidMediaMetadata): Promise<void> {
  cachedLastMetadata = metadata;

  // 1. Native Android Plugin
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.updateMetadata) {
    try {
      if (nativePlugin.startMediaService) {
        await nativePlugin.startMediaService();
      }
      await nativePlugin.updateMetadata(metadata);
    } catch {
      // Safe fallback
    }
  }

  // 2. Web navigator.mediaSession
  const win = getWindow();
  if (win && win.navigator && "mediaSession" in win.navigator && win.navigator.mediaSession && typeof MediaMetadata !== "undefined") {
    try {
      let artworkSrc = metadata.coverUrl || "";
      if (artworkSrc.startsWith("/")) {
        try {
          artworkSrc = new URL(artworkSrc, win.location.origin).toString();
        } catch {
          // fallback
        }
      }

      win.navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artwork: artworkSrc
          ? [
              { src: artworkSrc, sizes: "96x96", type: "image/png" },
              { src: artworkSrc, sizes: "128x128", type: "image/png" },
              { src: artworkSrc, sizes: "192x192", type: "image/png" },
              { src: artworkSrc, sizes: "256x256", type: "image/png" },
              { src: artworkSrc, sizes: "384x384", type: "image/png" },
              { src: artworkSrc, sizes: "512x512", type: "image/png" },
            ]
          : [],
      });
    } catch {
      // metadata error handling
    }
  }
}

/**
 * Synchronizes playback state (playing/paused, position, duration, rate)
 * with the native MediaSession, notification widget, and browser navigator.mediaSession.
 */
export async function updateAndroidPlaybackState(state: AndroidPlaybackState): Promise<void> {
  cachedLastPlaybackState = state;

  // 1. Native Android Plugin
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.updatePlaybackState) {
    try {
      await nativePlugin.updatePlaybackState(state);
    } catch {
      // Safe fallback
    }
  }

  // 2. Web navigator.mediaSession
  const win = getWindow();
  if (win && win.navigator && "mediaSession" in win.navigator && win.navigator.mediaSession) {
    try {
      win.navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";

      if ("setPositionState" in win.navigator.mediaSession && state.duration > 0) {
        win.navigator.mediaSession.setPositionState({
          duration: Math.max(state.duration, 0),
          playbackRate: state.playbackRate || 1,
          position: Math.min(Math.max(state.position, 0), state.duration),
        });
      }
    } catch {
      // ignore browser-specific setPositionState exceptions
    }
  }
}

/**
 * Starts the native Android Foreground Media Service.
 */
export async function startNativeMediaService(): Promise<void> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.startMediaService) {
    try {
      await nativePlugin.startMediaService();
    } catch {
      // Safe fallback
    }
  }
}

/**
 * Stops the native Android Foreground Media Service and cleans up notifications.
 */
export async function stopNativeMediaService(): Promise<void> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.stopMediaService) {
    try {
      await nativePlugin.stopMediaService();
    } catch {
      // Safe fallback
    }
  }
}

/**
 * Requests native Android audio focus.
 */
export async function requestNativeAudioFocus(): Promise<boolean> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.requestAudioFocus) {
    try {
      const res = await nativePlugin.requestAudioFocus();
      return Boolean(res.granted);
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * Abandons native Android audio focus.
 */
export async function abandonNativeAudioFocus(): Promise<void> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.abandonAudioFocus) {
    try {
      await nativePlugin.abandonAudioFocus();
    } catch {
      // Safe fallback
    }
  }
}

/**
 * Acquires wake lock to guarantee background audio decoding on mobile.
 */
export async function acquireBackgroundWakeLock(): Promise<void> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.acquireWakeLock) {
    try {
      await nativePlugin.acquireWakeLock();
    } catch {
      // Safe fallback
    }
  }
}

/**
 * Releases mobile background wake lock.
 */
export async function releaseBackgroundWakeLock(): Promise<void> {
  const nativePlugin = getNativePlugin();
  if (nativePlugin?.releaseWakeLock) {
    try {
      await nativePlugin.releaseWakeLock();
    } catch {
      // Safe fallback
    }
  }
}

/**
 * Returns current debug snapshot for tests.
 */
export function getMediaSessionSnapshot() {
  return {
    wasPlayingBeforeTransientLoss,
    isCurrentlyDucked,
    hasActiveHandler: Boolean(activeHandler),
    cachedLastMetadata,
    cachedLastPlaybackState,
  };
}

/**
 * Resets internal state for test harnesses.
 */
export function resetMediaSessionInternalState(): void {
  wasPlayingBeforeTransientLoss = false;
  isCurrentlyDucked = false;
  activeHandler = null;
  nativeSubscriptionCleanup = null;
  cachedLastMetadata = null;
  cachedLastPlaybackState = null;
}

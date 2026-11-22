/**
 * Mobile Backend Resolver & Android Connectivity Service
 *
 * Provides dynamic server endpoint resolution, health checks,
 * and seamless bridging between the Android app and the Soundify backend.
 */

import { isAndroidNative } from "./androidBridge";
import { APP_VERSION } from "./appVersion";
import { secureStorage } from "./secureStorage";
import type { MobileHealthDiagnostic, MobileStatus } from "./types";

let mediaAuthToken: string | null = null;

export function setMediaAuthToken(token: string | null): void {
  mediaAuthToken = token || null;
}

export function getMediaAuthToken(): string | null {
  if (mediaAuthToken) return mediaAuthToken;
  try {
    return secureStorage.getItemSync("soundify_token");
  } catch {
    return null;
  }
}

export const PRODUCTION_SOUNDIFY_URL =
  process.env.NEXT_PUBLIC_SOUNDIFY_URL || "https://soundify.mashhad-ix.ir";
export const DEFAULT_ANDROID_EMULATOR_URL = "http://10.0.2.2:4100";
export const MOBILE_V1_PREFIX = "/api/mobile/v1";
export const MOBILE_API_VERSION = "v1";
const STORAGE_KEY_SERVER_URL = "soundify_server_url";

let cachedBackendUrl: string | null = null;

/**
 * Gets the current configured backend server origin.
 *
 * - On standard web browsers: defaults to "" (relative URL, preserves Next.js rewrites & proxying).
 * - On Android Native (Capacitor): defaults to https://soundify.mashhad-ix.ir (live production website backend)
 *   so tracks, playlists, users, and streaming are 100% synchronized with the website.
 */
export function getBackendUrl(): string {
  if (typeof window === "undefined") {
    return process.env.SOUNDIFY_BACKEND_URL || PRODUCTION_SOUNDIFY_URL;
  }

  // If a valid non-empty URL was cached, return it
  if (cachedBackendUrl && cachedBackendUrl.length > 0) {
    return cachedBackendUrl;
  }

  try {
    let saved = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    if (saved === "offline") {
      cachedBackendUrl = "";
      return "";
    }
    // Auto-heal: If an existing physical Android install had legacy emulator IP 10.0.2.2:4100 saved,
    // upgrade it so the app automatically connects to the real live website!
    if (saved === DEFAULT_ANDROID_EMULATOR_URL && isAndroidNative()) {
      try {
        localStorage.removeItem(STORAGE_KEY_SERVER_URL);
      } catch {}
      saved = null;
    }
    if (saved && saved.trim()) {
      cachedBackendUrl = saved.trim().replace(/\/+$/, "");
      return cachedBackendUrl;
    }
  } catch {
    // Storage access may be restricted
  }

  // On Android Native wrapper, default to live production website backend
  if (isAndroidNative()) {
    cachedBackendUrl = PRODUCTION_SOUNDIFY_URL;
    return cachedBackendUrl;
  }

  // On standard web browsers without native wrapper, default to empty string to preserve relative Next.js proxying.
  // Note: We do NOT lock cachedBackendUrl to "" here, allowing late-initialized Capacitor/Android bridges to resolve.
  return "";
}

/**
 * Sets a custom backend server origin (e.g. from mobile settings).
 */
export function setBackendUrl(url: string | null): void {
  const sanitized = url ? url.trim().replace(/\/+$/, "") : "";

  if (typeof window !== "undefined") {
    try {
      if (sanitized) {
        localStorage.setItem(STORAGE_KEY_SERVER_URL, sanitized);
      } else {
        localStorage.removeItem(STORAGE_KEY_SERVER_URL);
      }
    } catch {
      // Ignore storage errors
    }
  }

  // Invalidate in-memory cache so subsequent getBackendUrl calls
  // cleanly re-evaluate persistent storage and platform defaults.
  cachedBackendUrl = null;
}

/**
 * Resolves an API path (e.g. /api/tracks) to a fully qualified URL when running on mobile.
 */
export function resolveApiUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const base = getBackendUrl();
  if (base) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  return path;
}

/**
 * Resolves a Mobile v1 API endpoint to a fully qualified URL on Android.
 */
export function resolveMobileV1Url(subPath: string): string {
  const cleanSub = subPath.startsWith("/") ? subPath : `/${subPath}`;
  if (cleanSub.startsWith(MOBILE_V1_PREFIX)) {
    return resolveApiUrl(cleanSub);
  }
  return resolveApiUrl(`${MOBILE_V1_PREFIX}${cleanSub}`);
}

/**
 * Resolves media stream URLs and cover art images for audio playback on Android.
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return "";

  // Helper to ensure external audio stream URLs include appVersion (HTTP 426 gate) and token (HTTP 403 cross-origin <audio> auth)
  const ensureAppVersion = (target: string): string => {
    if (!target.includes("/api/stream/external")) {
      return target;
    }
    let next = target;
    if (!next.includes("appVersion=")) {
      const sep = next.includes("?") ? "&" : "?";
      next = `${next}${sep}appVersion=${APP_VERSION}`;
    }
    if (!next.includes("token=")) {
      const tok = getMediaAuthToken();
      if (tok) {
        const sep = next.includes("?") ? "&" : "?";
        next = `${next}${sep}token=${encodeURIComponent(tok)}`;
      }
    }
    return next;
  };

  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  ) {
    return ensureAppVersion(url);
  }

  // Preserve local bundled static assets so they load directly from APK / public assets
  if (
    url.startsWith("/covers/") ||
    url.startsWith("/audio/") ||
    url.startsWith("/icons/") ||
    url.startsWith("/images/") ||
    url.startsWith("/fonts/")
  ) {
    return url;
  }

  const base = getBackendUrl();
  if (base) {
    const cleanPath = url.startsWith("/") ? url : `/${url}`;
    return ensureAppVersion(`${base}${cleanPath}`);
  }

  return ensureAppVersion(url);
}

export interface BackendHealthResult {
  ok: boolean;
  latencyMs: number;
  url: string;
  info?: MobileStatus;
  diagnostic?: MobileHealthDiagnostic;
  error?: string;
}

export type ServerConnectivityStatus = "online" | "offline" | "vpn_or_server_down";

let currentConnectivityStatus: ServerConnectivityStatus =
  typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online";

const connectivityListeners = new Set<(status: ServerConnectivityStatus) => void>();

export function getServerConnectivityStatus(): ServerConnectivityStatus {
  return currentConnectivityStatus;
}

export function setServerConnectivityStatus(status: ServerConnectivityStatus): void {
  if (currentConnectivityStatus === status) return;
  currentConnectivityStatus = status;
  for (const listener of connectivityListeners) {
    try {
      listener(status);
    } catch {}
  }
}

export function subscribeServerConnectivity(listener: (status: ServerConnectivityStatus) => void): () => void {
  connectivityListeners.add(listener);
  return () => {
    connectivityListeners.delete(listener);
  };
}

/**
 * Performs deep diagnostics against the /api/mobile/health endpoint,
 * evaluating database latency, SQLite engine parameters, active devices, and storage.
 */
export async function checkDeepBackendHealth(
  targetUrl?: string,
): Promise<{ ok: boolean; latencyMs: number; url: string; diagnostic?: MobileHealthDiagnostic; error?: string }> {
  const cleanTarget = targetUrl !== undefined ? targetUrl.trim().replace(/\/+$/, "") : undefined;
  const base = cleanTarget !== undefined && cleanTarget.length > 0 ? cleanTarget : getBackendUrl();
  const pingUrl = base ? `${base}/api/mobile/health` : "/api/mobile/health";
  const start = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(pingUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "X-App-Version": APP_VERSION,
      },
    });
    clearTimeout(timer);

    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        url: base || "relative",
        error: `HTTP ${res.status}`,
      };
    }

    const diagnostic = (await res.json()) as MobileHealthDiagnostic;
    return {
      ok: diagnostic.status === "healthy" || diagnostic.status === "degraded",
      latencyMs,
      url: base || "relative",
      diagnostic,
    };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs,
      url: base || "relative",
      error: err instanceof Error ? err.message : "Health check failed",
    };
  }
}

/**
 * Resolves the canonical public share URL for a track on the live production website.
 * Always returns https://soundify.mashhad-ix.ir/track/:id instead of localhost.
 */
export function getTrackShareUrl(trackId: string): string {
  if (!trackId) return PRODUCTION_SOUNDIFY_URL;
  return `${PRODUCTION_SOUNDIFY_URL}/track/${encodeURIComponent(trackId)}`;
}

/**
 * Resolves the static-export-safe internal app href for the Track Detail & Comments page.
 */
export function getTrackDetailHref(trackId: string): string {
  return `/track/default?id=${encodeURIComponent(trackId)}`;
}

/**
 * Resolves the static-export-safe internal app href for the Playlist Detail page.
 */
export function getPlaylistDetailHref(playlistId: string): string {
  return `/playlist/default?id=${encodeURIComponent(playlistId)}`;
}

/**
 * Verifies backend connectivity and measures latency in milliseconds.
 */
export async function checkBackendHealth(targetUrl?: string): Promise<BackendHealthResult> {
  const cleanTarget = targetUrl !== undefined ? targetUrl.trim().replace(/\/+$/, "") : undefined;
  const base = cleanTarget !== undefined && cleanTarget.length > 0 ? cleanTarget : getBackendUrl();
  const pingUrl = base ? `${base}/api/health` : "/api/health";
  const start = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    let res = await fetch(pingUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "X-App-Version": APP_VERSION,
      },
    });

    if (!res.ok) {
      // Fallback check against /api/mobile/status
      const fallbackUrl = base ? `${base}/api/mobile/status` : "/api/mobile/status";
      res = await fetch(fallbackUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "X-App-Version": APP_VERSION,
        },
      });
    }

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const isDeviceOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      setServerConnectivityStatus(isDeviceOnline ? "vpn_or_server_down" : "offline");
      return {
        ok: false,
        latencyMs,
        url: base || "relative",
        error: `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as MobileStatus;
    setServerConnectivityStatus("online");
    return {
      ok: true,
      latencyMs,
      url: base || "relative",
      info: data,
    };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    const isDeviceOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    setServerConnectivityStatus(isDeviceOnline ? "vpn_or_server_down" : "offline");
    return {
      ok: false,
      latencyMs,
      url: base || "relative",
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

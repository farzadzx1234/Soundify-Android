/**
 * Mobile User & Database Synchronization Service
 *
 * Implements offline-first caching, background delta sync,
 * device registration, and heartbeat for Android devices.
 */

import { api } from "./api";
import { isAndroidNative } from "./androidBridge";
import { APP_VERSION } from "./appVersion";
import type { MobileDeviceRegistrationPayload, UserSyncData } from "./types";

const STORAGE_KEY_SYNC_CACHE = "soundify_cached_sync";
const STORAGE_KEY_DEVICE_ID = "soundify_device_id";
const STORAGE_KEY_OFFLINE_LIKES = "soundify_pending_offline_likes";

export interface PendingOfflineLikes {
  likedTrackIds: string[];
  unlikedTrackIds: string[];
}

let memoryLikesFallback: PendingOfflineLikes | null = null;

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") return localStorage;
  } catch {}
  return null;
}

export function getPendingOfflineLikes(): PendingOfflineLikes {
  const store = getStorageSafe();
  if (!store) {
    return memoryLikesFallback
      ? { likedTrackIds: [...memoryLikesFallback.likedTrackIds], unlikedTrackIds: [...memoryLikesFallback.unlikedTrackIds] }
      : { likedTrackIds: [], unlikedTrackIds: [] };
  }
  try {
    const raw = store.getItem(STORAGE_KEY_OFFLINE_LIKES);
    if (!raw) {
      return memoryLikesFallback
        ? { likedTrackIds: [...memoryLikesFallback.likedTrackIds], unlikedTrackIds: [...memoryLikesFallback.unlikedTrackIds] }
        : { likedTrackIds: [], unlikedTrackIds: [] };
    }
    const parsed = JSON.parse(raw) as Partial<PendingOfflineLikes>;
    return {
      likedTrackIds: Array.isArray(parsed.likedTrackIds) ? parsed.likedTrackIds : [],
      unlikedTrackIds: Array.isArray(parsed.unlikedTrackIds) ? parsed.unlikedTrackIds : [],
    };
  } catch {
    return { likedTrackIds: [], unlikedTrackIds: [] };
  }
}

export function clearPendingOfflineLikes(): void {
  memoryLikesFallback = { likedTrackIds: [], unlikedTrackIds: [] };
  const store = getStorageSafe();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY_OFFLINE_LIKES);
  } catch {}
}

export function queueOfflineLike(trackId: string, liked: boolean): void {
  if (!trackId) return;
  const queue = getPendingOfflineLikes();
  if (liked) {
    queue.unlikedTrackIds = queue.unlikedTrackIds.filter((id) => id !== trackId);
    if (!queue.likedTrackIds.includes(trackId)) {
      queue.likedTrackIds.push(trackId);
    }
  } else {
    queue.likedTrackIds = queue.likedTrackIds.filter((id) => id !== trackId);
    if (!queue.unlikedTrackIds.includes(trackId)) {
      queue.unlikedTrackIds.push(trackId);
    }
  }
  memoryLikesFallback = {
    likedTrackIds: [...queue.likedTrackIds],
    unlikedTrackIds: [...queue.unlikedTrackIds],
  };
  const store = getStorageSafe();
  if (store) {
    try {
      store.setItem(STORAGE_KEY_OFFLINE_LIKES, JSON.stringify(queue));
    } catch {}
  }

  // Optimistically update cached user sync
  const cached = getCachedUserSync();
  if (cached) {
    let nextLiked = cached.likedTrackIds || [];
    if (liked && !nextLiked.includes(trackId)) {
      nextLiked = [trackId, ...nextLiked];
    } else if (!liked) {
      nextLiked = nextLiked.filter((id) => id !== trackId);
    }
    cached.likedTrackIds = nextLiked;
    saveCachedUserSync(cached);
  }
}

export async function flushOfflineLikes(): Promise<void> {
  const pending = getPendingOfflineLikes();
  if (pending.likedTrackIds.length === 0 && pending.unlikedTrackIds.length === 0) {
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return;
  }

  try {
    const res = await api.syncOfflineLikesBatch(pending);
    if (res && res.ok) {
      clearPendingOfflineLikes();
      const cached = getCachedUserSync();
      if (cached && Array.isArray(res.likedTrackIds)) {
        cached.likedTrackIds = res.likedTrackIds;
        saveCachedUserSync(cached);
      }
    }
  } catch {
    // Retry on next online transition
  }
}

/**
 * Returns a persistent device ID unique to this installation/browser and user account.
 */
export function getOrCreateDeviceId(userId?: string): string {
  if (typeof window === "undefined") return "server-device";

  try {
    const storageKey = userId ? `soundify_device_id_${userId}` : "soundify_device_id_guest";
    let id = localStorage.getItem(storageKey);

    if (!id && !userId) {
      // Legacy migration fallback for guest or unmigrated client
      const legacy =
        localStorage.getItem(STORAGE_KEY_DEVICE_ID) ||
        localStorage.getItem("soundify_mobile_device_id");
      if (legacy) {
        id = legacy;
      }
    }

    if (!id) {
      const userPrefix = userId ? userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) : "anon";
      const random =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 12)
          : Math.random().toString(36).slice(2, 14);
      id = `android-${userPrefix}-${random}`;
    }

    localStorage.setItem(storageKey, id);
    if (!userId) {
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
    }
    return id;
  } catch {
    return "temp-device-fallback";
  }
}

/**
 * Retrieves the locally cached user snapshot for instant offline startup.
 */
export function getCachedUserSync(): UserSyncData | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_CACHE);
    if (!raw) return null;
    return JSON.parse(raw) as UserSyncData;
  } catch {
    return null;
  }
}

/**
 * Persists the user snapshot to local storage for offline use.
 */
export function saveCachedUserSync(data: UserSyncData): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY_SYNC_CACHE, JSON.stringify(data));
  } catch {
    // Quota exceeded or private browsing
  }
}

/**
 * Clears cached user data on logout.
 */
export function clearCachedUserSync(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEY_SYNC_CACHE);
  } catch {
    // Ignore
  }
}

/**
 * Synchronizes user data with the website database:
 * Fetches fresh snapshot from /api/user/sync, updates cache, and handles offline fallback.
 */
export async function syncUserData(): Promise<{
  data: UserSyncData | null;
  fromCache: boolean;
  error?: string;
}> {
  try {
    void flushOfflineLikes();
    const fresh = await api.getUserSync();
    saveCachedUserSync(fresh);
    return { data: fresh, fromCache: false };
  } catch (err) {
    const cached = getCachedUserSync();
    return {
      data: cached,
      fromCache: true,
      error: err instanceof Error ? err.message : "Sync failed",
    };
  }
}

/**
 * Registers this Android or mobile client with the backend database.
 */
export async function registerCurrentDevice(userId?: string): Promise<boolean> {
  const resolvedUserId = userId || getCachedUserSync()?.user?.id;
  const deviceId = getOrCreateDeviceId(resolvedUserId);
  const isNative = isAndroidNative();

  let brand = "Generic";
  const model = isNative ? "Android Device" : "Web Client";
  const osVersion = isNative ? "Android 15" : "Web";

  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent;
    if (/Pixel/i.test(ua)) brand = "Google";
    else if (/Samsung|SM-/i.test(ua)) brand = "Samsung";
    else if (/Xiaomi|Redmi/i.test(ua)) brand = "Xiaomi";
    else if (/Huawei/i.test(ua)) brand = "Huawei";
    else if (/OnePlus/i.test(ua)) brand = "OnePlus";
  }

  const payload: MobileDeviceRegistrationPayload = {
    id: deviceId,
    name: isNative ? `${brand} ${model}` : "Soundify Web Player",
    type: isNative ? "smartphone" : "browser",
    brand,
    model,
    osVersion,
    appVersion: APP_VERSION,
  };

  try {
    await api.registerMobileDevice(payload);
    return true;
  } catch {
    return false;
  }
}

export interface SyncLoopOptions {
  onSync?: (data: UserSyncData) => void;
  intervalMs?: number;
}

/**
 * Starts a background sync and heartbeat loop for the mobile client.
 */
export function startMobileSyncLoop(options: SyncLoopOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};

  const intervalMs = options.intervalMs ?? 60_000;
  let active = true;

  const performSync = async () => {
    if (!active) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const res = await syncUserData();
    if (res.data && options.onSync) {
      options.onSync(res.data);
    }
  };

  // Immediate registration and initial sync
  void registerCurrentDevice().then(() => {
    void performSync();
  });

  const timer = setInterval(() => {
    void performSync();
  }, intervalMs);

  const onOnline = () => {
    void flushOfflineLikes();
    void registerCurrentDevice();
    void performSync();
  };

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void performSync();
    }
  };

  window.addEventListener("online", onOnline);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    active = false;
    clearInterval(timer);
    window.removeEventListener("online", onOnline);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

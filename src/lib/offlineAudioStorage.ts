import type { LyricLine, OfflineLicense, Track } from "./types";
import { parseLrc } from "./lrc";
import { isOfflineDecryptionPermitted } from "./mobileSecurityIntegrity";
import { clearCoverCache, getCoverCacheStats } from "./coverCacheManager";
import { api, getApiToken } from "./api";

export interface DownloadedLyrics {
  lines: LyricLine[];
  source: string;
  lyricsOffsetMs?: number;
}

export interface DownloadedTrackRecord {
  trackId: string;
  track: Track;
  audioBlob: Blob;
  lyrics?: DownloadedLyrics;
  coverBlob?: Blob;
  license?: OfflineLicense;
  downloadedAt: number;
  lastAccessedAt?: number;
  accessCount?: number;
  sizeBytes: number;
}

export interface StorageEstimateResult {
  usageBytes: number;
  quotaBytes: number;
  trackCount: number;
  songsBytes?: number;
  cacheBytes?: number;
}

export interface StorageBudgetConfig {
  maxStorageBytes: number;
  maxTracks: number;
}

export interface StorageBudgetInfo {
  usageBytes: number;
  maxStorageBytes: number;
  trackCount: number;
  maxTracks: number;
  usagePercent: number;
  songsBytes: number;
  cacheBytes: number;
}

const DB_NAME = "soundify_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "downloaded_tracks";

// Default storage limits: Unlimited by default (no artificial quotas)
export const DEFAULT_MAX_STORAGE_BYTES = Number.MAX_SAFE_INTEGER;
export const DEFAULT_MAX_TRACKS = Number.MAX_SAFE_INTEGER;

const currentBudget: StorageBudgetConfig = {
  maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
  maxTracks: DEFAULT_MAX_TRACKS,
};

export function initStoredBudget(): void {
  if (typeof window === "undefined") return;
  try {
    // Purge legacy storage caps to ensure downloads are completely unlimited without artificial quotas
    const storedBytes = window.localStorage?.getItem("soundify_storage_budget_bytes");
    if (storedBytes && Number(storedBytes) < Number.MAX_SAFE_INTEGER) {
      window.localStorage?.removeItem("soundify_storage_budget_bytes");
    }
    const storedTracks = window.localStorage?.getItem("soundify_storage_budget_tracks");
    if (storedTracks && Number(storedTracks) < Number.MAX_SAFE_INTEGER) {
      window.localStorage?.removeItem("soundify_storage_budget_tracks");
    }
  } catch {}
  currentBudget.maxStorageBytes = DEFAULT_MAX_STORAGE_BYTES;
  currentBudget.maxTracks = DEFAULT_MAX_TRACKS;
}

if (typeof window !== "undefined") {
  initStoredBudget();
}

// Eviction listeners
type EvictionListener = (evictedTrackIds: string[]) => void;
const evictionListeners = new Set<EvictionListener>();

export function registerEvictionListener(listener: EvictionListener): () => void {
  evictionListeners.add(listener);
  return () => evictionListeners.delete(listener);
}

function notifyEvictionListeners(evictedTrackIds: string[]): void {
  for (const listener of evictionListeners) {
    try {
      listener(evictedTrackIds);
    } catch {}
  }
}

// Bounded LRU Object URL caches to protect memory during extended sessions
// Safe limits: 64 concurrent audio streams and 512 cover artworks to avoid revoking visible library covers
const MAX_ACTIVE_AUDIO_BLOB_URLS = 64;
const MAX_ACTIVE_COVER_BLOB_URLS = 512;
const activeAudioBlobUrls = new Map<string, string>();
const activeCoverBlobUrls = new Map<string, string>();
let audioUrlAccessOrder: string[] = [];
let coverUrlAccessOrder: string[] = [];
let currentlyPlayingTrackId: string | null = null;
const pendingRevocations = new Set<string>();
const lastTouchTimes = new Map<string, number>();

export function setCurrentlyPlayingTrackId(trackId: string | null): void {
  const previous = currentlyPlayingTrackId;
  currentlyPlayingTrackId = trackId;

  // Execute deferred blob URL revocation when the previous track has stopped playing
  if (previous && previous !== trackId && pendingRevocations.has(previous)) {
    pendingRevocations.delete(previous);
    executeRevokeBlobUrls(previous);
  }
}

export function getCurrentlyPlayingTrackId(): string | null {
  return currentlyPlayingTrackId;
}

// In-memory fallback store for SSR, Vitest/Node, or unsupported browser environments
const memoryFallbackStore = new Map<string, DownloadedTrackRecord>();

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return (
      window.indexedDB ||
      (window as unknown as { mozIndexedDB?: IDBFactory }).mozIndexedDB ||
      (window as unknown as { webkitIndexedDB?: IDBFactory }).webkitIndexedDB
    );
  } catch {
    return undefined;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDatabase(): Promise<IDBDatabase> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.reject(new Error("IndexedDB is not available in current environment"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "trackId" });
          store.createIndex("downloadedAt", "downloadedAt", { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };

      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("IndexedDB opening was blocked"));
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });

  return dbPromise;
}

export function setStorageBudget(config: Partial<StorageBudgetConfig>): void {
  if (typeof config.maxStorageBytes === "number" && config.maxStorageBytes > 0) {
    currentBudget.maxStorageBytes = config.maxStorageBytes;
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem("soundify_storage_budget_bytes", String(config.maxStorageBytes));
      } catch {}
    }
  }
  if (typeof config.maxTracks === "number" && config.maxTracks > 0) {
    currentBudget.maxTracks = config.maxTracks;
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem("soundify_storage_budget_tracks", String(config.maxTracks));
      } catch {}
    }
  }
}

/**
 * Clears temporary cached blob URLs and resets memory buffer, freeing RAM immediately
 * while preserving downloaded track records in IndexedDB.
 */
export function clearOfflineCache(): void {
  revokeAllBlobUrls();
  void clearCoverCache().catch(() => {});
}

export function getStorageBudget(): StorageBudgetConfig {
  return { ...currentBudget };
}

export async function getStorageBudgetInfo(): Promise<StorageBudgetInfo> {
  const allTracks = await getAllDownloadedTracks();
  const trackCount = allTracks.length;
  const songsBytes = allTracks.reduce((sum, tr) => sum + (tr.sizeBytes || tr.audioBlob?.size || 0), 0);
  let cacheBytes = 0;
  try {
    const coverStats = await getCoverCacheStats();
    cacheBytes = coverStats.totalBytes || 0;
  } catch {}
  const usageBytes = songsBytes + cacheBytes;
  const isBudgetBounded = currentBudget.maxStorageBytes > 0 && currentBudget.maxStorageBytes < Number.MAX_SAFE_INTEGER;
  const usagePercent = isBudgetBounded ? Math.min(100, Math.round((usageBytes / currentBudget.maxStorageBytes) * 100)) : 0;

  return {
    usageBytes,
    maxStorageBytes: currentBudget.maxStorageBytes,
    trackCount,
    maxTracks: currentBudget.maxTracks,
    usagePercent,
    songsBytes,
    cacheBytes,
  };
}

/**
 * Enforces storage budget via LRU (Least Recently Used) eviction policy.
 * Frees tracks whose last access timestamp is oldest until both size and count fit.
 */
export async function enforceStorageBudget(
  incomingSizeBytes = 0,
  incomingTrackId?: string,
): Promise<{ evictedTrackIds: string[]; freedBytes: number }> {
  const allTracks = await getAllDownloadedTracks();
  const evictedTrackIds: string[] = [];
  let freedBytes = 0;

  // If budget is unbounded / unlimited, do not evict any tracks
  if (
    currentBudget.maxStorageBytes >= Number.MAX_SAFE_INTEGER &&
    currentBudget.maxTracks >= Number.MAX_SAFE_INTEGER
  ) {
    return { evictedTrackIds, freedBytes };
  }

  const existingTrack = incomingTrackId ? allTracks.find((t) => t.trackId === incomingTrackId) : undefined;
  const existingSize = existingTrack ? (existingTrack.sizeBytes || existingTrack.audioBlob?.size || 0) : 0;

  let totalSize = allTracks.reduce((sum, tr) => sum + (tr.sizeBytes || tr.audioBlob?.size || 0), 0) + incomingSizeBytes - existingSize;
  let trackCount = allTracks.length + (existingTrack ? 0 : (incomingSizeBytes > 0 ? 1 : 0));

  if (totalSize <= currentBudget.maxStorageBytes && trackCount <= currentBudget.maxTracks) {
    return { evictedTrackIds, freedBytes };
  }

  // Sort by LRU: lowest (lastAccessedAt ?? downloadedAt) first
  const sorted = [...allTracks].sort((a, b) => {
    const timeA = a.lastAccessedAt ?? a.downloadedAt ?? 0;
    const timeB = b.lastAccessedAt ?? b.downloadedAt ?? 0;
    return timeA - timeB;
  });

  for (const item of sorted) {
    if (incomingTrackId && item.trackId === incomingTrackId) {
      continue;
    }
    if (totalSize <= currentBudget.maxStorageBytes && trackCount <= currentBudget.maxTracks) {
      break;
    }
    const itemSize = item.sizeBytes || item.audioBlob?.size || 0;
    const removed = await removeDownloadedTrack(item.trackId);
    if (removed) {
      evictedTrackIds.push(item.trackId);
      freedBytes += itemSize;
      totalSize -= itemSize;
      trackCount--;
    }
  }

  if (evictedTrackIds.length > 0) {
    notifyEvictionListeners(evictedTrackIds);
  }

  return { evictedTrackIds, freedBytes };
}

/**
 * Updates lastAccessedAt and increments accessCount for a track.
 */
export async function touchTrackAccess(trackId: string): Promise<void> {
  if (!trackId) return;
  const now = Date.now();
  const lastTouch = lastTouchTimes.get(trackId) || 0;
  if (now - lastTouch < 5000) return;
  lastTouchTimes.set(trackId, now);

  const memRec = memoryFallbackStore.get(trackId);
  if (memRec) {
    memRec.lastAccessedAt = now;
    memRec.accessCount = (memRec.accessCount || 0) + 1;
  }

  try {
    const db = await openOfflineDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(trackId);
      getReq.onsuccess = () => {
        const record = getReq.result as DownloadedTrackRecord | undefined;
        if (record) {
          record.lastAccessedAt = now;
          record.accessCount = (record.accessCount || 0) + 1;
          store.put(record);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Saves a track, audio blob, optional lyrics, and optional cover blob into offline storage.
 * Enforces LRU storage budget before saving.
 */
/**
 * Validates a cryptographic offline playback license based on expiration and presence of signature/checksum.
 */
export function validateOfflineLicense(license: OfflineLicense | undefined | null): boolean {
  if (!license) return false;
  if (!license.signature || !license.audioChecksum) return false;
  if (license.playbackPolicy && license.playbackPolicy.allowOffline === false) {
    return false;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof license.expiresAt === "number" && license.expiresAt <= nowSec) {
    return false;
  }
  return true;
}

export async function saveDownloadedTrack(
  track: Track,
  audioBlob: Blob,
  lyrics?: DownloadedLyrics | string,
  coverBlob?: Blob,
  license?: OfflineLicense,
): Promise<DownloadedTrackRecord> {
  if (!track || !track.id) {
    throw new Error("Invalid track provided to saveDownloadedTrack");
  }
  if (!audioBlob || !(audioBlob instanceof Blob)) {
    throw new Error("Invalid audio blob provided to saveDownloadedTrack");
  }

  const audioBytes = audioBlob.size || 0;
  const coverBytes = coverBlob instanceof Blob ? coverBlob.size : 0;
  const sizeBytes = audioBytes + coverBytes;

  // Enforce storage budget before writing
  await enforceStorageBudget(sizeBytes, track.id);

  let cleanAudioUrl = track.audioUrl || "";
  if (cleanAudioUrl.startsWith("blob:")) {
    cleanAudioUrl = `/api/mobile/v1/tracks/${track.id}/stream`;
  }
  let cleanCoverUrl = track.coverUrl || "";
  if (cleanCoverUrl.startsWith("blob:")) {
    cleanCoverUrl = `/api/tracks/${track.id}/cover`;
  }

  let formattedLyrics: DownloadedLyrics | undefined;
  if (lyrics) {
    if (typeof lyrics === "string") {
      const parsedLines = parseLrc(lyrics);
      if (parsedLines.length > 0) {
        formattedLyrics = {
          lines: parsedLines,
          source: "lrc",
          lyricsOffsetMs: 0,
        };
      } else {
        const plainLines: LyricLine[] = lyrics
          .split(/\r?\n/)
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text, idx) => ({ timeMs: idx * 3000, text }));
        formattedLyrics = {
          lines: plainLines,
          source: "plain",
          lyricsOffsetMs: 0,
        };
      }
    } else {
      formattedLyrics = {
        ...lyrics,
        lines: Array.isArray(lyrics.lines) ? [...lyrics.lines] : [],
        lyricsOffsetMs: lyrics.lyricsOffsetMs ?? 0,
      };
    }
  }

  const hasLyricsResolved = Boolean(
    (formattedLyrics?.lines && formattedLyrics.lines.length > 0) || track.hasLyrics
  );
  const lyricsSourceResolved =
    formattedLyrics?.source || track.lyricsSource || (hasLyricsResolved ? "offline" : "none");

  const now = Date.now();
  const record: DownloadedTrackRecord = {
    trackId: track.id,
    track: {
      ...track,
      hasLyrics: hasLyricsResolved,
      lyricsSource: lyricsSourceResolved,
      audioUrl: cleanAudioUrl,
      coverUrl: cleanCoverUrl,
    },
    audioBlob,
    lyrics: formattedLyrics,
    coverBlob: coverBlob instanceof Blob ? coverBlob : undefined,
    license: license || undefined,
    downloadedAt: now,
    lastAccessedAt: now,
    accessCount: 1,
    sizeBytes,
  };

  // Revoke any existing active blob URLs for this track before overwriting
  revokeBlobUrlsForTrack(track.id);

  try {
    const db = await openOfflineDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Error writing track to IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  } catch {
    // Transparently store in memory fallback if IDB fails or is unavailable
    memoryFallbackStore.set(track.id, record);
  }

  // Request persistent PWA storage if available
  if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.persist === "function") {
    void navigator.storage.persist().catch(() => {});
  }

  return record;
}

/**
 * Retrieves a single downloaded track record by ID.
 */
export async function getDownloadedTrack(trackId: string): Promise<DownloadedTrackRecord | null> {
  if (!trackId) return null;
  if (!isOfflineDecryptionPermitted()) {
    throw new Error("SECURITY_INTEGRITY_VIOLATION: Offline media decryption blocked on compromised device");
  }

  try {
    const db = await openOfflineDatabase();
    const rec = await new Promise<DownloadedTrackRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trackId);

      req.onsuccess = () => {
        const result = req.result as DownloadedTrackRecord | undefined;
        resolve(result || null);
      };
      req.onerror = () => reject(req.error || new Error("Error reading track from IndexedDB"));
    });
    if (rec) {
      void touchTrackAccess(trackId);
    }
    return rec;
  } catch {
    const memRec = memoryFallbackStore.get(trackId) || null;
    if (memRec) {
      void touchTrackAccess(trackId);
    }
    return memRec;
  }
}

/**
 * Retrieves the persisted offline lyrics for a track ID.
 */
export async function getDownloadedLyrics(trackId: string): Promise<DownloadedLyrics | null> {
  if (!trackId) return null;
  const track = await getDownloadedTrack(trackId);
  return track?.lyrics || null;
}

/**
 * Updates or sets lyrics for an already downloaded track without re-saving audio blobs.
 */
export async function updateDownloadedLyrics(
  trackId: string,
  lyrics: DownloadedLyrics | string,
): Promise<boolean> {
  if (!trackId || !lyrics) return false;

  let formattedLyrics: DownloadedLyrics;
  if (typeof lyrics === "string") {
    const parsedLines = parseLrc(lyrics);
    if (parsedLines.length > 0) {
      formattedLyrics = {
        lines: parsedLines,
        source: "lrc",
        lyricsOffsetMs: 0,
      };
    } else {
      const plainLines: LyricLine[] = lyrics
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, idx) => ({ timeMs: idx * 3000, text }));
      formattedLyrics = {
        lines: plainLines,
        source: "plain",
        lyricsOffsetMs: 0,
      };
    }
  } else {
    formattedLyrics = {
      ...lyrics,
      lines: Array.isArray(lyrics.lines) ? [...lyrics.lines] : [],
      lyricsOffsetMs: lyrics.lyricsOffsetMs ?? 0,
    };
  }

  // Update memory fallback
  const memRec = memoryFallbackStore.get(trackId);
  if (memRec) {
    memRec.lyrics = formattedLyrics;
    if (formattedLyrics.lines.length > 0) {
      memRec.track.hasLyrics = true;
      memRec.track.lyricsSource = formattedLyrics.source || "offline";
    }
  }

  try {
    const db = await openOfflineDatabase();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(trackId);

      getReq.onsuccess = () => {
        const record = getReq.result as DownloadedTrackRecord | undefined;
        if (!record) {
          resolve(Boolean(memRec));
          return;
        }
        record.lyrics = formattedLyrics;
        if (formattedLyrics.lines.length > 0) {
          record.track.hasLyrics = true;
          record.track.lyricsSource = formattedLyrics.source || "offline";
        }
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => resolve(false);
      };
      getReq.onerror = () => resolve(Boolean(memRec));
    });
  } catch {
    return Boolean(memRec);
  }
}

/**
 * Checks whether a track is currently stored in offline storage.
 */
export async function isTrackDownloaded(trackId: string): Promise<boolean> {
  if (!trackId) return false;
  try {
    const db = await openOfflineDatabase();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.count(trackId);

      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error || new Error("Error checking track count in IndexedDB"));
    });
  } catch {
    return memoryFallbackStore.has(trackId);
  }
}

/**
 * Retrieves all downloaded track records, sorted newest first.
 */
export async function getAllDownloadedTracks(): Promise<DownloadedTrackRecord[]> {
  try {
    const db = await openOfflineDatabase();
    return await new Promise<DownloadedTrackRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const results = (req.result as DownloadedTrackRecord[]) || [];
        results.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));

        // Security Policy Enforcement: Bar access to decrypted audio blobs when device is compromised
        if (!isOfflineDecryptionPermitted()) {
          const sanitized = results.map((r) => ({
            ...r,
            audioBlob: new Blob([], { type: "audio/mpeg" }),
          }));
          return resolve(sanitized);
        }

        resolve(results);
      };
      req.onerror = () => reject(req.error || new Error("Error reading all tracks from IndexedDB"));
    });
  } catch {
    const list = Array.from(memoryFallbackStore.values());
    list.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
    if (!isOfflineDecryptionPermitted()) {
      return list.map((r) => ({
        ...r,
        audioBlob: new Blob([], { type: "audio/mpeg" }),
      }));
    }
    return list;
  }
}

/**
 * Removes a downloaded track and frees its cached blob URLs.
 */
export async function removeDownloadedTrack(trackId: string): Promise<boolean> {
  if (!trackId) return false;

  revokeBlobUrlsForTrack(trackId);
  const memoryDeleted = memoryFallbackStore.delete(trackId);

  let success = false;
  try {
    const db = await openOfflineDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(trackId);

      req.onsuccess = () => {
        success = true;
        resolve();
      };
      req.onerror = () => reject(req.error || new Error("Error deleting track from IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  } catch {
    success = memoryDeleted;
  }

  return success;
}

/**
 * Returns a cached or newly created Object URL for the downloaded audio blob.
 * Reuses the existing Object URL to prevent memory leaks and evicts in LRU order.
 */
export async function getDownloadedTrackBlobUrl(trackId: string): Promise<string | null> {
  if (!trackId) return null;
  if (!isOfflineDecryptionPermitted()) {
    return null;
  }

  const record = await getDownloadedTrack(trackId);
  if (!record || !record.audioBlob) return null;

  // Cryptographic offline DRM license validation (Spotify architecture)
  if (record.license && !validateOfflineLicense(record.license)) {
    const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
    const token = getApiToken();
    if (isOnline && token) {
      try {
        const renewed = await api.getOfflineLicense(trackId);
        if (renewed?.ok && renewed.license && validateOfflineLicense(renewed.license)) {
          record.license = renewed.license;
          try {
            const db = await openOfflineDatabase();
            await new Promise<void>((resolve) => {
              const tx = db.transaction(STORE_NAME, "readwrite");
              const store = tx.objectStore(STORE_NAME);
              store.put(record);
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
            });
          } catch {
            memoryFallbackStore.set(trackId, record);
          }
        }
      } catch {
        // Renewal failed
      }
    }

    if (!validateOfflineLicense(record.license)) {
      revokeBlobUrlsForTrack(trackId);
      return null;
    }
  }

  if (activeAudioBlobUrls.has(trackId)) {
    audioUrlAccessOrder = audioUrlAccessOrder.filter((id) => id !== trackId);
    audioUrlAccessOrder.push(trackId);
    void touchTrackAccess(trackId);
    return activeAudioBlobUrls.get(trackId)!;
  }

  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      if (audioUrlAccessOrder.length >= MAX_ACTIVE_AUDIO_BLOB_URLS) {
        // Protect currently playing track from eviction during playback
        const evictIndex = audioUrlAccessOrder.findIndex((id) => id !== currentlyPlayingTrackId);
        const oldestId = evictIndex >= 0 ? audioUrlAccessOrder.splice(evictIndex, 1)[0] : audioUrlAccessOrder.shift();
        if (oldestId) {
          const oldUrl = activeAudioBlobUrls.get(oldestId);
          if (oldUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
            try {
              URL.revokeObjectURL(oldUrl);
            } catch {}
          }
          activeAudioBlobUrls.delete(oldestId);
        }
      }

      const url = URL.createObjectURL(record.audioBlob);
      activeAudioBlobUrls.set(trackId, url);
      audioUrlAccessOrder.push(trackId);
      void touchTrackAccess(trackId);
      return url;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Returns a cached or newly created Object URL for the downloaded cover image blob.
 * Enforces LRU bound.
 */
export async function getDownloadedCoverBlobUrl(trackId: string): Promise<string | null> {
  if (!trackId) return null;

  if (activeCoverBlobUrls.has(trackId)) {
    coverUrlAccessOrder = coverUrlAccessOrder.filter((id) => id !== trackId);
    coverUrlAccessOrder.push(trackId);
    return activeCoverBlobUrls.get(trackId)!;
  }

  const record = await getDownloadedTrack(trackId);
  if (!record || !record.coverBlob) return null;

  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      if (coverUrlAccessOrder.length >= MAX_ACTIVE_COVER_BLOB_URLS) {
        const oldestId = coverUrlAccessOrder.shift();
        if (oldestId) {
          const oldUrl = activeCoverBlobUrls.get(oldestId);
          if (oldUrl && typeof URL.revokeObjectURL === "function") {
            try {
              URL.revokeObjectURL(oldUrl);
            } catch {}
          }
          activeCoverBlobUrls.delete(oldestId);
        }
      }

      const url = URL.createObjectURL(record.coverBlob);
      activeCoverBlobUrls.set(trackId, url);
      coverUrlAccessOrder.push(trackId);
      return url;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Synchronously retrieves a cached Object URL for an audio blob if already created.
 */
export function getCachedAudioBlobUrl(trackId: string): string | null {
  if (!trackId) return null;
  return activeAudioBlobUrls.get(trackId) || null;
}

/**
 * Synchronously retrieves a cached Object URL for a cover image blob if already created.
 */
export function getCachedCoverBlobUrl(trackId: string): string | null {
  if (!trackId) return null;
  return activeCoverBlobUrls.get(trackId) || null;
}

/**
 * Internal worker to revoke blob URLs and purge access tracking for a track.
 */
function executeRevokeBlobUrls(trackId: string): void {
  audioUrlAccessOrder = audioUrlAccessOrder.filter((id) => id !== trackId);
  coverUrlAccessOrder = coverUrlAccessOrder.filter((id) => id !== trackId);

  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    const audioUrl = activeAudioBlobUrls.get(trackId);
    if (audioUrl) {
      try {
        URL.revokeObjectURL(audioUrl);
      } catch {}
      activeAudioBlobUrls.delete(trackId);
    }

    const coverUrl = activeCoverBlobUrls.get(trackId);
    if (coverUrl) {
      try {
        URL.revokeObjectURL(coverUrl);
      } catch {}
      activeCoverBlobUrls.delete(trackId);
    }
  } else {
    activeAudioBlobUrls.delete(trackId);
    activeCoverBlobUrls.delete(trackId);
  }
}

/**
 * Revokes and cleans up active Object URLs for a single track.
 * If the track is actively playing, revocation is safely deferred until the track changes or stops,
 * preventing unhandled playback crashes.
 */
export function revokeBlobUrlsForTrack(trackId: string): void {
  if (!trackId) return;

  if (currentlyPlayingTrackId === trackId) {
    pendingRevocations.add(trackId);
    return;
  }

  executeRevokeBlobUrls(trackId);
}

/**
 * Revokes all active Object URLs across all downloaded tracks.
 */
export function revokeAllBlobUrls(): void {
  audioUrlAccessOrder = [];
  coverUrlAccessOrder = [];
  pendingRevocations.clear();

  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const url of activeAudioBlobUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    for (const url of activeCoverBlobUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
  }
  activeAudioBlobUrls.clear();
  activeCoverBlobUrls.clear();
}

/**
 * Clears all downloaded tracks from storage and revokes all blob URLs.
 */
export async function clearAllDownloadedTracks(): Promise<void> {
  revokeAllBlobUrls();
  memoryFallbackStore.clear();

  try {
    const db = await openOfflineDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Error clearing IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  } catch {}
}

/**
 * Estimates storage usage by querying navigator.storage, summing offline track sizes, and cover cache.
 */
export async function estimateStorageUsage(): Promise<StorageEstimateResult> {
  const allTracks = await getAllDownloadedTracks();
  const trackCount = allTracks.length;
  const songsBytes = allTracks.reduce((sum, tr) => sum + (tr.sizeBytes || tr.audioBlob?.size || 0), 0);
  let cacheBytes = 0;
  try {
    const coverStats = await getCoverCacheStats();
    cacheBytes = coverStats.totalBytes || 0;
  } catch {}
  const usageBytes = songsBytes + cacheBytes;

  let quotaBytes = 1024 * 1024 * 1024; // Default fallback: 1GB

  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.estimate === "function"
  ) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.quota === "number") {
        quotaBytes = estimate.quota;
      }
    } catch {}
  }

  return {
    usageBytes,
    quotaBytes,
    trackCount,
    songsBytes,
    cacheBytes,
  };
}

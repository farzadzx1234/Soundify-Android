"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { triggerHapticFeedback } from "./hapticFeedback";
import { parseLrc } from "./lrc";
import { isAndroidNative } from "./androidBridge";
import { exportTrackToDeviceStorage } from "./mediaExport";
import { api, extractYouTubeIdClient, getApiToken, resolveMediaUrl } from "./api";
import {
  clearAllDownloadedTracks,
  clearOfflineCache,
  estimateStorageUsage,
  getAllDownloadedTracks,
  getDownloadedCoverBlobUrl,
  getStorageBudgetInfo,
  isTrackDownloaded,
  registerEvictionListener,
  removeDownloadedTrack,
  saveDownloadedTrack,
  type DownloadedLyrics,
  type DownloadedTrackRecord,
  type StorageBudgetInfo,
  type StorageEstimateResult,
} from "./offlineAudioStorage";
import type { OfflineLicense, Track } from "./types";

export type TrackDownloadStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "downloaded"
  | "failed"
  | "error";

export interface TrackDownloadState {
  trackId: string;
  status: TrackDownloadStatus;
  progress: number; // 0 - 100
  error?: string;
}

interface ActiveDownloadSession {
  abortController: AbortController;
  progress: number;
}

interface DeferredDownload {
  resolve: (val: boolean) => void;
  reject: (err: unknown) => void;
  promise: Promise<boolean>;
}

export const MAX_CONCURRENT_DOWNLOADS = 2;

// Global state caches
const activeDownloads = new Map<string, ActiveDownloadSession>();
const downloadQueue: Track[] = [];
const pausedTrackIds = new Set<string>();
const downloadedTrackIds = new Set<string>();
const errorStates = new Map<string, string>();
const pendingDeferreds = new Map<string, DeferredDownload>();
const listeners = new Set<() => void>();
const storeChangeListeners = new Set<() => void>();
const snapshotCache = new Map<string, TrackDownloadState>();
const EMPTY_SNAPSHOT: TrackDownloadState = Object.freeze({ trackId: "", status: "idle", progress: 0 });
let initialized = false;
let initPromise: Promise<void> | null = null;

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

function notifyStoreChangeListeners() {
  notifyListeners();
  for (const listener of storeChangeListeners) {
    try {
      listener();
    } catch {}
  }
}

/**
 * Subscribes to database/store level changes (tracks saved, removed, cleared).
 */
export function subscribeToStoreChanges(callback: () => void): () => void {
  storeChangeListeners.add(callback);
  return () => {
    storeChangeListeners.delete(callback);
  };
}

/**
 * Resets internal in-memory caches (useful for testing or cache clearing).
 */
export function resetDownloadManagerState(): void {
  for (const session of activeDownloads.values()) {
    try {
      session.abortController.abort();
    } catch {}
  }
  for (const def of pendingDeferreds.values()) {
    try {
      def.resolve(false);
    } catch {}
  }
  pendingDeferreds.clear();
  downloadQueue.length = 0;
  pausedTrackIds.clear();
  activeDownloads.clear();
  downloadedTrackIds.clear();
  errorStates.clear();
  snapshotCache.clear();
  initialized = false;
  initPromise = null;
  notifyStoreChangeListeners();
}

/**
 * Initializes the downloaded tracks cache from storage.
 */
export async function initializeDownloadManager(force = false): Promise<void> {
  if (initialized && !force) return;
  if (initPromise && !force) return initPromise;

  initPromise = (async () => {
    try {
      const records = await getAllDownloadedTracks();
      downloadedTrackIds.clear();
      for (const rec of records) {
        if (rec.trackId) {
          downloadedTrackIds.add(rec.trackId);
        }
      }
      initialized = true;
      notifyListeners();
    } catch {
      initialized = true;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// Listen for storage budget evictions to keep download state strictly synchronized
registerEvictionListener((evictedTrackIds) => {
  for (const id of evictedTrackIds) {
    downloadedTrackIds.delete(id);
    activeDownloads.delete(id);
    errorStates.delete(id);
    pausedTrackIds.delete(id);
  }
  notifyStoreChangeListeners();
});

// Auto-trigger initialization on client-side import and bind network listeners
if (typeof window !== "undefined") {
  void initializeDownloadManager();

  window.addEventListener("online", () => {
    // Automatically resume processing pending queued downloads when internet reconnects
    processDownloadQueue();
    notifyListeners();
  });

  window.addEventListener("offline", () => {
    notifyListeners();
  });
}

/**
 * Returns the current synchronous snapshot of download state for a track ID.
 * Returns a stable, cached object reference when properties are unchanged to prevent
 * infinite re-render loops in useSyncExternalStore (React Error #185).
 */
export function getTrackDownloadSnapshot(trackId: string): TrackDownloadState {
  if (!trackId) {
    return EMPTY_SNAPSHOT;
  }

  let currentStatus: TrackDownloadStatus = "idle";
  let currentProgress = 0;
  let currentError: string | undefined = undefined;

  const active = activeDownloads.get(trackId);
  if (active) {
    currentStatus = "downloading";
    currentProgress = active.progress;
  } else if (downloadQueue.some((t) => t.id === trackId)) {
    currentStatus = "queued";
    currentProgress = 0;
  } else if (pausedTrackIds.has(trackId)) {
    currentStatus = "paused";
    currentProgress = 0;
  } else if (errorStates.has(trackId)) {
    currentStatus = "error";
    currentProgress = 0;
    currentError = errorStates.get(trackId);
  } else if (downloadedTrackIds.has(trackId)) {
    currentStatus = "downloaded";
    currentProgress = 100;
  }

  const cached = snapshotCache.get(trackId);
  if (
    cached &&
    cached.status === currentStatus &&
    cached.progress === currentProgress &&
    cached.error === currentError
  ) {
    return cached;
  }

  const nextSnapshot: TrackDownloadState = {
    trackId,
    status: currentStatus,
    progress: currentProgress,
    error: currentError,
  };
  snapshotCache.set(trackId, nextSnapshot);
  return nextSnapshot;
}

/**
 * Subscribes to changes in download manager state.
 */
export function subscribeToDownloads(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Pulls next pending track from the download queue when active slots are free.
 * Suspends queue draining if the device is offline to protect queued tracks from immediate failure.
 */
export function processDownloadQueue(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return;
  }

  while (activeDownloads.size < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const nextTrack = downloadQueue.shift();
    if (!nextTrack) break;
    const trackId = nextTrack.id;
    if (downloadedTrackIds.has(trackId) || activeDownloads.has(trackId) || pausedTrackIds.has(trackId)) {
      continue;
    }
    const abortController = new AbortController();
    activeDownloads.set(trackId, { abortController, progress: 0 });
    notifyListeners();
    void runDownloadPipeline(nextTrack, abortController);
  }
}

/**
 * Internal worker that executes network fetching, blob assembly, and persistence.
 */
async function runDownloadPipeline(track: Track, abortController: AbortController): Promise<boolean> {
  const trackId = track.id;
  const signal = abortController.signal;

  try {
    if (signal.aborted) {
      activeDownloads.delete(trackId);
      const def = pendingDeferreds.get(trackId);
      if (def) {
        pendingDeferreds.delete(trackId);
        def.resolve(false);
      }
      notifyListeners();
      processDownloadQueue();
      return false;
    }

    const alreadyStored = await isTrackDownloaded(trackId);
    if (alreadyStored) {
      activeDownloads.delete(trackId);
      downloadedTrackIds.add(trackId);
      const def = pendingDeferreds.get(trackId);
      if (def) {
        pendingDeferreds.delete(trackId);
        def.resolve(true);
      }
      notifyListeners();
      processDownloadQueue();
      return true;
    }

    if (signal.aborted) {
      activeDownloads.delete(trackId);
      const def = pendingDeferreds.get(trackId);
      if (def) {
        pendingDeferreds.delete(trackId);
        def.resolve(false);
      }
      notifyListeners();
      processDownloadQueue();
      return false;
    }

    const rawAudioUrl = track.audioUrl;
    if (!rawAudioUrl) {
      throw new Error("Track has no valid audio URL");
    }

    const resolvedAudioUrl = resolveMediaUrl(rawAudioUrl);
    const token = getApiToken();
    const headers: Record<string, string> = { Accept: "audio/*, */*" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let audioRes = await fetch(resolvedAudioUrl, {
      signal,
      headers,
      credentials: "same-origin",
    });

    if (!audioRes.ok) {
      // If it's an external YouTube track and initial fetch failed, attempt refreshing the stream token
      const isExternal =
        track.id.startsWith("ext-") ||
        track.source === "youtube" ||
        rawAudioUrl.includes("/api/stream/external");

      if (isExternal) {
        try {
          const refreshRes = await api.refreshStreamUrl(track.id, track.pageUrl || rawAudioUrl);
          if (refreshRes && refreshRes.ok && refreshRes.audioUrl) {
            const refreshedMediaUrl = resolveMediaUrl(refreshRes.audioUrl);
            audioRes = await fetch(refreshedMediaUrl, {
              signal,
              headers,
              credentials: "same-origin",
            });
          }
        } catch {}
      }

      if (!audioRes.ok) {
        throw new Error(`Failed to download audio (${audioRes.status} ${audioRes.statusText})`);
      }
    }

    const contentLength = audioRes.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    let receivedBytes = 0;
    let audioBlob: Blob;

    if (audioRes.body && typeof audioRes.body.getReader === "function") {
      const reader = audioRes.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          const effectiveTotal =
            totalBytes > 0
              ? totalBytes
              : track.durationSec
                ? track.durationSec * 16000
                : 3.5 * 1024 * 1024;
          const pct = Math.min(95, Math.round((receivedBytes / effectiveTotal) * 90));
          const currentSession = activeDownloads.get(trackId);
          if (currentSession && currentSession.progress !== pct) {
            currentSession.progress = pct;
            notifyListeners();
          }
        }
      }

      const contentType = audioRes.headers.get("content-type") || "audio/mpeg";
      audioBlob = new Blob(chunks as BlobPart[], { type: contentType });
    } else {
      const currentSession = activeDownloads.get(trackId);
      if (currentSession) {
        currentSession.progress = 60;
        notifyListeners();
      }
      audioBlob = await audioRes.blob();
    }

    // Download cover image if present
    let coverBlob: Blob | undefined;
    if (track.coverUrl) {
      try {
        let coverUrlToFetch = resolveMediaUrl(track.coverUrl);
        // If it's an external URL (e.g. YouTube), proxy it through external-cover to bypass CORS
        if (track.coverUrl.startsWith("http://") || track.coverUrl.startsWith("https://")) {
          const ytId =
            extractYouTubeIdClient(track.coverUrl) ||
            extractYouTubeIdClient(track.pageUrl || "") ||
            extractYouTubeIdClient(track.id);
          if (ytId) {
            coverUrlToFetch = resolveMediaUrl(
              `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}&id=${encodeURIComponent(track.id)}`,
            );
          }
        }
        const coverRes = await fetch(coverUrlToFetch, { signal });
        if (coverRes.ok) {
          coverBlob = await coverRes.blob();
        }
      } catch {
        // Non-fatal if cover cannot be fetched
      }
    }

    // Download synced / plain lyrics if present
    let lyricsData: DownloadedLyrics | undefined;
    try {
      const lyricsRes = await api.getLyrics(trackId);
      if (lyricsRes && Array.isArray(lyricsRes.lines) && lyricsRes.lines.length > 0) {
        lyricsData = {
          lines: lyricsRes.lines,
          source: lyricsRes.source || "lrclib",
          lyricsOffsetMs: lyricsRes.lyricsOffsetMs || 0,
        };
      }
    } catch {
      // Non-fatal if primary lyrics cannot be fetched
    }

    // Comprehensive fallback: Try autoFetchLyrics if primary fetch returned no lines
    if (!lyricsData || lyricsData.lines.length === 0) {
      try {
        const autoRes = await api.autoFetchLyrics(trackId, {
          queryTitle: track.title,
          queryArtist: track.artistName,
          durationSec: track.durationSec,
        });
        if (autoRes && autoRes.found && Array.isArray(autoRes.lines) && autoRes.lines.length > 0) {
          lyricsData = {
            lines: autoRes.lines,
            source: autoRes.source || "lrclib",
            lyricsOffsetMs: 0,
          };
        } else if (autoRes?.lrcContent) {
          const parsed = parseLrc(autoRes.lrcContent);
          if (parsed.length > 0) {
            lyricsData = {
              lines: parsed,
              source: autoRes.source || "lrclib",
              lyricsOffsetMs: 0,
            };
          } else {
            const plainLines = autoRes.lrcContent
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .map((text, idx) => ({ timeMs: idx * 3000, text }));
            if (plainLines.length > 0) {
              lyricsData = {
                lines: plainLines,
                source: autoRes.source || "plain",
                lyricsOffsetMs: 0,
              };
            }
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }

    // Fallback to track.lyrics if available
    if (!lyricsData || lyricsData.lines.length === 0) {
      const inlineLyrics = (track as unknown as { lyrics?: string }).lyrics;
      if (typeof inlineLyrics === "string" && inlineLyrics.trim()) {
        const parsed = parseLrc(inlineLyrics);
        if (parsed.length > 0) {
          lyricsData = {
            lines: parsed,
            source: "embedded",
            lyricsOffsetMs: 0,
          };
        } else {
          const plainLines = inlineLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((text, idx) => ({ timeMs: idx * 3000, text }));
          if (plainLines.length > 0) {
            lyricsData = {
              lines: plainLines,
              source: "embedded",
              lyricsOffsetMs: 0,
            };
          }
        }
      }
    }

    // Fetch cryptographic offline download license (Spotify architecture) if user is authenticated
    let license: OfflineLicense | undefined;
    if (token) {
      try {
        const licRes = await api.getOfflineLicense(trackId);
        if (licRes && licRes.ok && licRes.license) {
          license = licRes.license;
        }
      } catch {
        // Non-fatal if offline license cannot be issued
      }
    }

    // Save record to IndexedDB
    await saveDownloadedTrack(track, audioBlob, lyricsData, coverBlob, license);

    // Auto-export to phone's public MediaStore on native Android so external music players discover it
    if (isAndroidNative()) {
      try {
        await exportTrackToDeviceStorage(track, audioBlob);
      } catch (autoExpErr) {
        console.warn("Auto-export to native device storage non-fatal error:", autoExpErr);
      }
    }

    activeDownloads.delete(trackId);
    downloadedTrackIds.add(trackId);
    notifyStoreChangeListeners();
    void triggerHapticFeedback("downloadComplete");

    const def = pendingDeferreds.get(trackId);
    if (def) {
      pendingDeferreds.delete(trackId);
      def.resolve(true);
    }

    processDownloadQueue();
    return true;
  } catch (err: unknown) {
    activeDownloads.delete(trackId);

    if (signal.aborted) {
      const def = pendingDeferreds.get(trackId);
      if (def) {
        pendingDeferreds.delete(trackId);
        def.resolve(false);
      }
      notifyListeners();
      processDownloadQueue();
      return false;
    }

    const isOfflineNow = typeof navigator !== "undefined" && navigator.onLine === false;
    const errorMsg = isOfflineNow
      ? "اتصال اینترنت برای دانلود قطعه برقرار نیست"
      : err instanceof Error ? err.message : "Download failed";
    errorStates.set(trackId, errorMsg);
    notifyListeners();

    const def = pendingDeferreds.get(trackId);
    if (def) {
      pendingDeferreds.delete(trackId);
      def.resolve(false);
    }

    if (!isOfflineNow) {
      processDownloadQueue();
    }
    return false;
  }
}

/**
 * Initiates or queues the download of audio, cover, and lyrics for a given track.
 */
export function startTrackDownload(track: Track): Promise<boolean> {
  if (!track || !track.id) return Promise.resolve(false);
  const trackId = track.id;

  // Already downloaded?
  if (downloadedTrackIds.has(trackId)) {
    return Promise.resolve(true);
  }

  // Already downloading?
  const existingActive = activeDownloads.get(trackId);
  if (existingActive) {
    const existingDef = pendingDeferreds.get(trackId);
    return existingDef ? existingDef.promise : Promise.resolve(true);
  }

  // Already in download queue?
  if (downloadQueue.some((t) => t.id === trackId)) {
    const existingDef = pendingDeferreds.get(trackId);
    return existingDef ? existingDef.promise : Promise.resolve(true);
  }

  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.onLine === false) {
    errorStates.set(trackId, "اتصال اینترنت برای دانلود قطعه برقرار نیست");
    notifyListeners();
    return Promise.resolve(false);
  }

  errorStates.delete(trackId);
  pausedTrackIds.delete(trackId);

  let resolveDeferred!: (val: boolean) => void;
  let rejectDeferred!: (err: unknown) => void;
  const promise = new Promise<boolean>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  pendingDeferreds.set(trackId, { resolve: resolveDeferred, reject: rejectDeferred, promise });

  if (activeDownloads.size >= MAX_CONCURRENT_DOWNLOADS) {
    downloadQueue.push(track);
    notifyListeners();
    return promise;
  }

  const abortController = new AbortController();
  activeDownloads.set(trackId, {
    abortController,
    progress: 0,
  });
  notifyListeners();

  void runDownloadPipeline(track, abortController);
  return promise;
}

/**
 * Pauses an ongoing or queued download for a track.
 */
export function pauseTrackDownload(trackId: string): void {
  const session = activeDownloads.get(trackId);
  if (session) {
    try {
      session.abortController.abort();
    } catch {}
    activeDownloads.delete(trackId);
  }

  const qIdx = downloadQueue.findIndex((t) => t.id === trackId);
  if (qIdx >= 0) {
    downloadQueue.splice(qIdx, 1);
  }

  pausedTrackIds.add(trackId);
  errorStates.delete(trackId);

  const def = pendingDeferreds.get(trackId);
  if (def) {
    pendingDeferreds.delete(trackId);
    def.resolve(false);
  }

  notifyListeners();
  processDownloadQueue();
}

/**
 * Resumes a paused track download.
 */
export function resumeTrackDownload(track: Track): Promise<boolean> {
  if (!track || !track.id) return Promise.resolve(false);
  pausedTrackIds.delete(track.id);
  errorStates.delete(track.id);
  notifyListeners();
  return startTrackDownload(track);
}

/**
 * Retries a failed track download.
 */
export function retryTrackDownload(track: Track): Promise<boolean> {
  if (!track || !track.id) return Promise.resolve(false);
  errorStates.delete(track.id);
  pausedTrackIds.delete(track.id);
  notifyListeners();
  return startTrackDownload(track);
}

/**
 * Enqueues a batch of tracks to download.
 */
export function batchDownloadTracks(tracks: Track[]): Promise<boolean[]> {
  return Promise.all(tracks.map((t) => startTrackDownload(t)));
}

/**
 * Cancels an ongoing or queued download session for a track.
 */
export function cancelTrackDownload(trackId: string): void {
  const session = activeDownloads.get(trackId);
  if (session) {
    try {
      session.abortController.abort();
    } catch {}
    activeDownloads.delete(trackId);
  }

  const qIdx = downloadQueue.findIndex((t) => t.id === trackId);
  if (qIdx >= 0) {
    downloadQueue.splice(qIdx, 1);
  }

  pausedTrackIds.delete(trackId);
  errorStates.delete(trackId);

  const def = pendingDeferreds.get(trackId);
  if (def) {
    pendingDeferreds.delete(trackId);
    def.resolve(false);
  }

  notifyListeners();
  processDownloadQueue();
}

/**
 * Removes a downloaded track from offline storage and cache.
 */
export async function removeTrackDownload(trackId: string): Promise<boolean> {
  cancelTrackDownload(trackId);
  errorStates.delete(trackId);
  pausedTrackIds.delete(trackId);

  const success = await removeDownloadedTrack(trackId);
  downloadedTrackIds.delete(trackId);
  notifyStoreChangeListeners();
  return success;
}

/**
 * Atomically deletes a list of track IDs from offline storage and cache.
 */
export async function batchDeleteTracks(trackIds: string[]): Promise<boolean> {
  if (!Array.isArray(trackIds) || trackIds.length === 0) return true;

  for (const id of trackIds) {
    cancelTrackDownload(id);
    errorStates.delete(id);
    pausedTrackIds.delete(id);
  }

  let allSuccess = true;
  for (const id of trackIds) {
    const ok = await removeDownloadedTrack(id);
    if (!ok) allSuccess = false;
    downloadedTrackIds.delete(id);
  }

  notifyStoreChangeListeners();
  return allSuccess;
}

/**
 * Clears all downloaded tracks and resets all download manager state.
 */
export async function clearAllDownloads(): Promise<void> {
  for (const session of activeDownloads.values()) {
    try {
      session.abortController.abort();
    } catch {}
  }
  for (const def of pendingDeferreds.values()) {
    try {
      def.resolve(false);
    } catch {}
  }
  pendingDeferreds.clear();
  downloadQueue.length = 0;
  pausedTrackIds.clear();
  activeDownloads.clear();
  downloadedTrackIds.clear();
  errorStates.clear();
  await clearAllDownloadedTracks();
  notifyStoreChangeListeners();
}

/**
 * Hook to monitor and control download state for a specific track.
 */
export function useTrackDownload(track: Track | null | undefined) {
  const trackId = track?.id || "";

  // Subscribe to changes in download manager
  const state = useSyncExternalStore(
    subscribeToDownloads,
    () => getTrackDownloadSnapshot(trackId),
    () => getTrackDownloadSnapshot(trackId),
  );

  const isDownloaded = state.status === "downloaded" || state.status === "completed";
  const isDownloading = state.status === "downloading";
  const isQueued = state.status === "queued";
  const isPaused = state.status === "paused";
  const isFailed = state.status === "error" || state.status === "failed";

  const download = async (): Promise<boolean> => {
    if (!track) return false;
    return startTrackDownload(track);
  };

  const pause = (): void => {
    if (!trackId) return;
    pauseTrackDownload(trackId);
  };

  const resume = async (): Promise<boolean> => {
    if (!track) return false;
    return resumeTrackDownload(track);
  };

  const retry = async (): Promise<boolean> => {
    if (!track) return false;
    return retryTrackDownload(track);
  };

  const remove = async (): Promise<boolean> => {
    if (!trackId) return false;
    return removeTrackDownload(trackId);
  };

  const cancel = (): void => {
    if (!trackId) return;
    cancelTrackDownload(trackId);
  };

  return {
    status: state.status,
    progress: state.progress,
    error: state.error,
    isDownloaded,
    isDownloading,
    isQueued,
    isPaused,
    isFailed,
    download,
    pause,
    resume,
    retry,
    remove,
    cancel,
  };
}

/**
 * Hook to access all downloaded tracks and storage metrics for the Library tab and Settings.
 */
export function useDownloadedTracks() {
  const [tracks, setTracks] = useState<DownloadedTrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateResult>({
    usageBytes: 0,
    quotaBytes: 1024 * 1024 * 1024,
    trackCount: 0,
    songsBytes: 0,
    cacheBytes: 0,
  });
  const [storageBudgetInfo, setStorageBudgetInfo] = useState<StorageBudgetInfo>({
    usageBytes: 0,
    maxStorageBytes: 250 * 1024 * 1024,
    trackCount: 0,
    maxTracks: 50,
    usagePercent: 0,
    songsBytes: 0,
    cacheBytes: 0,
  });

  const refresh = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const all = await getAllDownloadedTracks();
      const enriched = await Promise.all(
        all.map(async (rec) => {
          if (rec.coverBlob) {
            const coverUrl = await getDownloadedCoverBlobUrl(rec.trackId);
            if (coverUrl) {
              return {
                ...rec,
                track: {
                  ...rec.track,
                  coverUrl,
                },
              };
            }
          }
          return rec;
        }),
      );
      setTracks(enriched);

      // Keep cache in sync
      downloadedTrackIds.clear();
      for (const rec of all) {
        if (rec.trackId) downloadedTrackIds.add(rec.trackId);
      }

      const [estimate, budget] = await Promise.all([
        estimateStorageUsage(),
        getStorageBudgetInfo(),
      ]);
      setStorageEstimate(estimate);
      setStorageBudgetInfo(budget);
    } catch {
      // ignore
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void refresh(true);
    });

    const unsubscribe = subscribeToStoreChanges(() => {
      if (mounted) void refresh(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const removeTrack = async (trackId: string): Promise<boolean> => {
    const ok = await removeTrackDownload(trackId);
    if (ok) {
      await refresh();
    }
    return ok;
  };

  const batchDelete = async (trackIds: string[]): Promise<boolean> => {
    const ok = await batchDeleteTracks(trackIds);
    await refresh();
    return ok;
  };

  const clearCache = (): void => {
    clearOfflineCache();
    notifyStoreChangeListeners();
  };

  const clearAll = async (): Promise<void> => {
    await clearAllDownloads();
    await refresh();
  };

  const totalSizeBytes = tracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);

  return {
    downloadedTracks: tracks,
    loading,
    totalSizeBytes,
    storageEstimate,
    storageBudgetInfo,
    refresh,
    removeTrack,
    batchDeleteTracks: batchDelete,
    clearCache,
    clearAll,
  };
}

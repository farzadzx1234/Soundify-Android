"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { triggerHapticFeedback } from "./hapticFeedback";
import { parseLrc } from "./lrc";
import {
  deleteNativeOfflineFiles,
  exportTrackToDeviceStorage,
  listDeviceSoundifyAudioFiles,
  type DeviceSoundifyAudioFile,
} from "./mediaExport";
import {
  APP_VERSION,
  MIN_SERVER_SUPPORTED_VERSION,
  triggerAppUpdateRequired,
} from "./appVersion";
import {
  api,
  extractCanonicalExternalUrl,
  extractYouTubeIdClient,
  getApiToken,
  isExternalTrack,
  resolveMediaUrl,
} from "./api";
import { extractCleanTitleAndArtist, normalizePersianChars } from "./lyricsCleaner";
import {
  clearAllDownloadedTracks,
  clearOfflineCache,
  estimateStorageUsage,
  getAllDownloadedTrackMeta,
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
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
}

export interface ActiveDownloadProgress {
  trackId: string;
  track?: Track;
  progress: number;
  bytesDownloaded?: number;
  totalBytes?: number;
}

interface ActiveDownloadSession {
  abortController: AbortController;
  progress: number;
  track?: Track;
  bytesDownloaded?: number;
  totalBytes?: number;
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
const downloadedByPageUrl = new Map<string, string>();
const downloadedByFingerprint = new Map<string, string>();
const downloadedMetaById = new Map<
  string,
  { id: string; title: string; artistName: string; pageUrl?: string; pageUrlKey?: string; fingerprints: string[] }
>();
const deviceAudioUriByTrackId = new Map<string, string>();
const deviceAudioUriByFingerprint = new Map<string, string>();
const deviceCoverUriByTrackId = new Map<string, string>();
const deviceCoverUriByFingerprint = new Map<string, string>();
const discoveredDeviceFiles: DeviceSoundifyAudioFile[] = [];
const DOWNLOADED_INDEX_LS_KEY = "soundify_downloaded_index_v2";
const errorStates = new Map<string, string>();
const pendingDeferreds = new Map<string, DeferredDownload>();
const listeners = new Set<() => void>();
const storeChangeListeners = new Set<() => void>();
const snapshotCache = new Map<string, TrackDownloadState>();
const canonicalSnapshotCache = new Map<string, TrackDownloadState>();
const EMPTY_SNAPSHOT: TrackDownloadState = Object.freeze({ trackId: "", status: "idle", progress: 0 });
let initialized = false;
let initPromise: Promise<void> | null = null;

function normalizeCanonicalDownloadPageUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const ytId = extractYouTubeIdClient(trimmed);
  if (ytId) return `youtube:${ytId.toLowerCase()}`;
  const canonical = extractCanonicalExternalUrl(trimmed);
  return canonical ? canonical.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() : "";
}

function foldDownloadKeyPart(s: string): string {
  return normalizePersianChars(s)
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "i")
    .replace(/[\u015F\u015E]/g, "s")
    .replace(/[\u011F\u011E]/g, "g")
    .replace(/[\u00FC\u00DC]/g, "u")
    .replace(/[\u00F6\u00D6]/g, "o")
    .replace(/[\u00E7\u00C7]/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function computeTrackDownloadFingerprints(
  track: Pick<Track, "title" | "artistName"> | null | undefined,
): string[] {
  if (!track) return [];
  const results = new Set<string>();
  const addPair = (a: string, t: string) => {
    const normA = foldDownloadKeyPart(a);
    const normT = foldDownloadKeyPart(t);
    if (normA.length >= 2 && normT.length >= 2) {
      results.add(`${normA}::${normT}`);
    }
  };
  const primary = extractCleanTitleAndArtist(track.title || "", track.artistName || "");
  addPair(primary.artist || track.artistName || "", primary.title || track.title || "");
  const titleParsed = extractCleanTitleAndArtist(track.title || "", "");
  if (titleParsed.artist && titleParsed.title) {
    addPair(titleParsed.artist, titleParsed.title);
  }
  return Array.from(results);
}

export function computeTrackDownloadFingerprint(
  track: Pick<Track, "title" | "artistName"> | null | undefined,
): string {
  return computeTrackDownloadFingerprints(track)[0] || "";
}

function persistDownloadedIndexToLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Array.from(downloadedMetaById.values()).map((m) => ({
      id: m.id,
      title: m.title,
      artistName: m.artistName,
      ...(m.pageUrl ? { pageUrl: m.pageUrl } : {}),
    }));
    window.localStorage?.setItem(DOWNLOADED_INDEX_LS_KEY, JSON.stringify(entries));
  } catch {}
}

function hydrateDownloadedIndexFromLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage?.getItem(DOWNLOADED_INDEX_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{
      id?: string;
      title?: string;
      artistName?: string;
      pageUrl?: string;
    }>;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (item && typeof item.id === "string" && item.id) {
        registerDownloadedTrackIndex({
          id: item.id,
          title: item.title || "",
          artistName: item.artistName || "",
          pageUrl: item.pageUrl,
        });
      }
    }
  } catch {}
}

function registerDownloadedTrackIndex(
  track: Pick<Track, "id" | "title" | "artistName" | "pageUrl"> | null | undefined,
): void {
  if (!track?.id) return;
  const trackId = track.id;
  downloadedTrackIds.add(trackId);
  const pageUrlKey = normalizeCanonicalDownloadPageUrl(track.pageUrl);
  const fingerprints = computeTrackDownloadFingerprints(track);
  downloadedMetaById.set(trackId, {
    id: trackId,
    title: track.title || "",
    artistName: track.artistName || "",
    pageUrl: track.pageUrl,
    pageUrlKey: pageUrlKey || undefined,
    fingerprints,
  });
  if (pageUrlKey) {
    downloadedByPageUrl.set(pageUrlKey, trackId);
  }
  for (const fp of fingerprints) {
    downloadedByFingerprint.set(fp, trackId);
  }
}

function unregisterDownloadedTrackIndex(trackId: string): void {
  if (!trackId) return;
  downloadedTrackIds.delete(trackId);
  deviceAudioUriByTrackId.delete(trackId);
  deviceCoverUriByTrackId.delete(trackId);
  const meta = downloadedMetaById.get(trackId);
  if (meta) {
    if (meta.pageUrlKey && downloadedByPageUrl.get(meta.pageUrlKey) === trackId) {
      downloadedByPageUrl.delete(meta.pageUrlKey);
    }
    for (const fp of meta.fingerprints) {
      if (downloadedByFingerprint.get(fp) === trackId) {
        downloadedByFingerprint.delete(fp);
      }
      deviceAudioUriByFingerprint.delete(fp);
      deviceCoverUriByFingerprint.delete(fp);
    }
    downloadedMetaById.delete(trackId);
  }
}

export function registerDeviceLocalAudioFile(file: DeviceSoundifyAudioFile): void {
  if (!file || !file.uri) return;
  const stem = (file.fileName || "")
    .replace(/\.(?:mp3|m4a|aac|ogg|opus|wav|flac)$/i, "")
    .trim();
  let parsedArtist = file.artist || "";
  let parsedTitle = file.title || stem;
  const dashIdx = stem.indexOf(" - ");
  if (dashIdx > 0) {
    parsedArtist = stem.slice(0, dashIdx).trim();
    parsedTitle = stem.slice(dashIdx + 3).trim();
  }
  const canonicalId =
    file.trackId && file.trackId.trim()
      ? file.trackId.trim()
      : `device-${foldDownloadKeyPart(stem || file.fileName).replace(/\s+/g, "-") || "track"}`;

  if (!discoveredDeviceFiles.some((d) => d.uri === file.uri)) {
    discoveredDeviceFiles.push(file);
  }

  registerDownloadedTrackIndex({
    id: canonicalId,
    title: parsedTitle || stem,
    artistName: parsedArtist,
  });

  deviceAudioUriByTrackId.set(canonicalId, file.uri);
  if (file.coverUri) {
    deviceCoverUriByTrackId.set(canonicalId, file.coverUri);
  }

  const allFingerprints = new Set<string>(
    computeTrackDownloadFingerprints({
      title: parsedTitle || stem,
      artistName: parsedArtist,
    }),
  );
  if (file.title || file.artist) {
    for (const fp of computeTrackDownloadFingerprints({
      title: file.title || stem,
      artistName: file.artist || parsedArtist,
    })) {
      allFingerprints.add(fp);
    }
  }
  for (const fp of allFingerprints) {
    downloadedByFingerprint.set(fp, canonicalId);
    deviceAudioUriByFingerprint.set(fp, file.uri);
    if (file.coverUri) {
      deviceCoverUriByFingerprint.set(fp, file.coverUri);
    }
  }
}

export function resolveLocalDeviceAudioUri(
  track: Pick<Track, "id" | "title" | "artistName" | "pageUrl"> | null | undefined,
): string | null {
  if (!track) return null;
  if (track.id && deviceAudioUriByTrackId.has(track.id)) {
    return deviceAudioUriByTrackId.get(track.id) || null;
  }
  const dlId = resolveDownloadedTrackId(track);
  if (dlId && deviceAudioUriByTrackId.has(dlId)) {
    return deviceAudioUriByTrackId.get(dlId) || null;
  }
  for (const fp of computeTrackDownloadFingerprints(track)) {
    const uri = deviceAudioUriByFingerprint.get(fp);
    if (uri) return uri;
  }
  return null;
}

export function resolveLocalDeviceCoverUri(
  track: Pick<Track, "id" | "title" | "artistName" | "pageUrl"> | null | undefined,
): string | null {
  if (!track) return null;
  if (track.id && deviceCoverUriByTrackId.has(track.id)) {
    return deviceCoverUriByTrackId.get(track.id) || null;
  }
  const dlId = resolveDownloadedTrackId(track);
  if (dlId && deviceCoverUriByTrackId.has(dlId)) {
    return deviceCoverUriByTrackId.get(dlId) || null;
  }
  for (const fp of computeTrackDownloadFingerprints(track)) {
    const uri = deviceCoverUriByFingerprint.get(fp);
    if (uri) return uri;
  }
  return null;
}

export function resolveDownloadedTrackId(
  track: Pick<Track, "id" | "title" | "artistName" | "pageUrl"> | null | undefined,
  options: { matchFingerprint?: boolean } = {},
): string | null {
  if (!track) return null;
  if (track.id && downloadedTrackIds.has(track.id)) {
    return track.id;
  }
  const pageUrlKey = normalizeCanonicalDownloadPageUrl(track.pageUrl);
  if (pageUrlKey) {
    const matchedByUrl = downloadedByPageUrl.get(pageUrlKey);
    if (matchedByUrl && downloadedTrackIds.has(matchedByUrl)) {
      return matchedByUrl;
    }
  }
  if (options.matchFingerprint !== false) {
    for (const fingerprint of computeTrackDownloadFingerprints(track)) {
      const matchedByFp = downloadedByFingerprint.get(fingerprint);
      if (matchedByFp && downloadedTrackIds.has(matchedByFp)) {
        return matchedByFp;
      }
    }
  }
  return null;
}

export async function resolveDownloadedTrackIdAsync(
  track: Pick<Track, "id" | "title" | "artistName" | "pageUrl"> | null | undefined,
): Promise<string | null> {
  if (!track) return null;
  const syncMatch = resolveDownloadedTrackId(track);
  if (syncMatch) return syncMatch;
  if (!initialized) {
    try {
      await initializeDownloadManager();
    } catch {}
  }
  const cachedMatch = resolveDownloadedTrackId(track);
  if (cachedMatch) return cachedMatch;
  if (track.id) {
    try {
      if (await isTrackDownloaded(track.id)) {
        registerDownloadedTrackIndex(track);
        persistDownloadedIndexToLocalStorage();
        notifyListeners();
        return track.id;
      }
    } catch {}
  }
  return null;
}

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
  downloadedByPageUrl.clear();
  downloadedByFingerprint.clear();
  downloadedMetaById.clear();
  deviceAudioUriByTrackId.clear();
  deviceAudioUriByFingerprint.clear();
  deviceCoverUriByTrackId.clear();
  deviceCoverUriByFingerprint.clear();
  discoveredDeviceFiles.length = 0;
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(DOWNLOADED_INDEX_LS_KEY);
    }
  } catch {}
  errorStates.clear();
  snapshotCache.clear();
  canonicalSnapshotCache.clear();
  initialized = false;
  initPromise = null;
  notifyStoreChangeListeners();
}

/**
 * Initializes the downloaded tracks cache from storage using lightweight cursor metadata
 * (zero multi-MB audio blob allocation) while preserving the instant localStorage mirror.
 */
export async function initializeDownloadManager(force = false): Promise<void> {
  if (initialized && !force) return;
  if (initPromise && !force) return initPromise;

  initPromise = (async () => {
    try {
      const [metas, deviceFiles] = await Promise.all([
        getAllDownloadedTrackMeta(),
        listDeviceSoundifyAudioFiles().catch(() => [] as DeviceSoundifyAudioFile[]),
      ]);
      if (metas.length === 0 && deviceFiles.length === 0 && downloadedTrackIds.size > 0) {
        const sampleId = downloadedTrackIds.values().next().value;
        const confirmedPresent = sampleId ? await isTrackDownloaded(sampleId).catch(() => true) : false;
        if (confirmedPresent) {
          initialized = true;
          notifyListeners();
          return;
        }
      }
      downloadedTrackIds.clear();
      downloadedByPageUrl.clear();
      downloadedByFingerprint.clear();
      downloadedMetaById.clear();
      deviceAudioUriByTrackId.clear();
      deviceAudioUriByFingerprint.clear();
      deviceCoverUriByTrackId.clear();
      deviceCoverUriByFingerprint.clear();
      discoveredDeviceFiles.length = 0;
      for (const meta of metas) {
        if (meta.trackId) {
          registerDownloadedTrackIndex({
            id: meta.trackId,
            title: meta.title || "",
            artistName: meta.artistName || "",
            pageUrl: meta.pageUrl,
          });
        }
      }
      for (const df of deviceFiles) {
        registerDeviceLocalAudioFile(df);
      }
      persistDownloadedIndexToLocalStorage();
      initialized = true;
      notifyListeners();
    } catch {
      hydrateDownloadedIndexFromLocalStorage();
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
    unregisterDownloadedTrackIndex(id);
    activeDownloads.delete(id);
    errorStates.delete(id);
    pausedTrackIds.delete(id);
  }
  persistDownloadedIndexToLocalStorage();
  notifyStoreChangeListeners();
});

// Synchronously hydrate cached checkmark index & kick off background IDB reconciliation on client import
if (typeof window !== "undefined") {
  hydrateDownloadedIndexFromLocalStorage();
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
  let currentBytesDownloaded: number | undefined = undefined;
  let currentTotalBytes: number | undefined = undefined;
  let currentError: string | undefined = undefined;

  const active = activeDownloads.get(trackId);
  if (active) {
    currentStatus = "downloading";
    currentProgress = active.progress;
    currentBytesDownloaded = active.bytesDownloaded;
    currentTotalBytes = active.totalBytes;
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
    cached.bytesDownloaded === currentBytesDownloaded &&
    cached.totalBytes === currentTotalBytes &&
    cached.error === currentError
  ) {
    return cached;
  }

  const nextSnapshot: TrackDownloadState = {
    trackId,
    status: currentStatus,
    progress: currentProgress,
    bytesDownloaded: currentBytesDownloaded,
    totalBytes: currentTotalBytes,
    error: currentError,
  };
  snapshotCache.set(trackId, nextSnapshot);
  return nextSnapshot;
}

export function getTrackDownloadSnapshotForTrack(
  track: Track | null | undefined,
): TrackDownloadState {
  if (!track?.id) {
    return EMPTY_SNAPSHOT;
  }
  const direct = getTrackDownloadSnapshot(track.id);
  if (direct.status !== "idle") {
    return direct;
  }
  const canonicalId = resolveDownloadedTrackId(track);
  if (canonicalId && canonicalId !== track.id) {
    const cached = canonicalSnapshotCache.get(track.id);
    if (cached && cached.status === "downloaded" && cached.progress === 100) {
      return cached;
    }
    const nextSnapshot: TrackDownloadState = {
      trackId: track.id,
      status: "downloaded",
      progress: 100,
    };
    canonicalSnapshotCache.set(track.id, nextSnapshot);
    return nextSnapshot;
  }
  return direct;
}

let activeDownloadsSnapshotCache: ActiveDownloadProgress[] = [];
let activeDownloadsCacheKey = "";

export function getActiveDownloadsSnapshot(): ActiveDownloadProgress[] {
  const result: ActiveDownloadProgress[] = [];
  let key = "";
  for (const [trackId, session] of activeDownloads.entries()) {
    result.push({
      trackId,
      track: session.track,
      progress: session.progress,
      bytesDownloaded: session.bytesDownloaded,
      totalBytes: session.totalBytes,
    });
    key += `${trackId}:${session.progress}:${session.bytesDownloaded || 0};`;
  }
  if (key === activeDownloadsCacheKey) {
    return activeDownloadsSnapshotCache;
  }
  activeDownloadsCacheKey = key;
  activeDownloadsSnapshotCache = result;
  return result;
}

export function useActiveDownloads(): ActiveDownloadProgress[] {
  return useSyncExternalStore(
    subscribeToDownloads,
    getActiveDownloadsSnapshot,
    () => []
  );
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
    activeDownloads.set(trackId, {
      abortController,
      progress: 0,
      track: nextTrack,
      bytesDownloaded: 0,
      totalBytes: 0,
    });
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

    const alreadyResolvedId = resolveDownloadedTrackId(track, { matchFingerprint: false });
    const alreadyStored = Boolean(alreadyResolvedId) || (await isTrackDownloaded(trackId));
    if (alreadyStored) {
      activeDownloads.delete(trackId);
      registerDownloadedTrackIndex(track);
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

    let rawAudioUrl = track.audioUrl;
    if (!rawAudioUrl) {
      throw new Error("Track has no valid audio URL");
    }

    if (rawAudioUrl.includes("/api/stream/external") && !rawAudioUrl.includes("fastStart=")) {
      const sep = rawAudioUrl.includes("?") ? "&" : "?";
      rawAudioUrl = `${rawAudioUrl}${sep}fastStart=true`;
    }

    const resolvedAudioUrl = resolveMediaUrl(rawAudioUrl);
    const token = getApiToken();
    const headers: Record<string, string> = {
      Accept: "audio/*, */*",
      "X-App-Version": APP_VERSION,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let audioRes = await fetch(resolvedAudioUrl, {
      signal,
      headers,
      credentials: "same-origin",
    });

    if (!audioRes.ok) {
      if (audioRes.status === 426) {
        try {
          const errData = (await audioRes.clone().json()) as { error?: string; errorFa?: string; errorEn?: string; code?: string; message?: string; minSupportedVersion?: string };
          triggerAppUpdateRequired({
            minSupportedVersion: errData?.minSupportedVersion || MIN_SERVER_SUPPORTED_VERSION,
            message: errData?.message,
            messageFa: errData?.errorFa || errData?.message,
            messageEn: errData?.errorEn || errData?.message,
          });
        } catch {
          triggerAppUpdateRequired({
            minSupportedVersion: MIN_SERVER_SUPPORTED_VERSION,
          });
        }
      }
      // If it's an external track (YouTube / SoundCloud / Spotify) and initial fetch failed, attempt refreshing the stream token
      const isExternal =
        isExternalTrack(track) ||
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
          const pct = Math.min(95, Math.max(1, Math.round((receivedBytes / effectiveTotal) * 90)));
          const currentSession = activeDownloads.get(trackId);
          if (currentSession && (currentSession.progress !== pct || currentSession.bytesDownloaded !== receivedBytes)) {
            currentSession.progress = pct;
            currentSession.bytesDownloaded = receivedBytes;
            currentSession.totalBytes = totalBytes > 0 ? totalBytes : effectiveTotal;
            notifyListeners();
          }
        }
      }

      const currentSession = activeDownloads.get(trackId);
      if (currentSession) {
        currentSession.progress = 96;
        currentSession.bytesDownloaded = receivedBytes;
        currentSession.totalBytes = totalBytes > 0 ? totalBytes : receivedBytes;
        notifyListeners();
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

    // Fast concurrent resolution of auxiliary assets (cover, lyrics, license)
    // with a strict timeout so downloads finish in seconds and never hang on external lyrics providers
    let coverBlob: Blob | undefined;
    let lyricsData: DownloadedLyrics | undefined;
    let license: OfflineLicense | undefined;

    const auxController = new AbortController();
    const auxTimer = setTimeout(() => auxController.abort(), 5500);

    const coverFetchPromise = (async () => {
      if (!track.coverUrl || track.coverUrl.startsWith("blob:")) return;
      try {
        const auxHeaders: Record<string, string> = {
          Accept: "image/*, */*",
          "X-App-Version": APP_VERSION,
        };
        if (token) {
          auxHeaders["Authorization"] = `Bearer ${token}`;
        }

        const candidateUrls: string[] = [];
        if (track.coverUrl.startsWith("http://") || track.coverUrl.startsWith("https://")) {
          const ytId =
            extractYouTubeIdClient(track.coverUrl) ||
            extractYouTubeIdClient(track.pageUrl || "") ||
            extractYouTubeIdClient(track.id);
          const externalSourceUrl = ytId
            ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
            : track.coverUrl;
          candidateUrls.push(
            resolveMediaUrl(
              `/api/stream/external-cover?url=${encodeURIComponent(externalSourceUrl)}&id=${encodeURIComponent(track.id)}`,
            ),
          );
          if (track.coverUrl !== candidateUrls[0]) {
            candidateUrls.push(resolveMediaUrl(track.coverUrl));
          }
        } else {
          candidateUrls.push(resolveMediaUrl(track.coverUrl));
        }

        for (const candidateUrl of candidateUrls) {
          try {
            const isSameApi = !candidateUrl.startsWith("http") || candidateUrl.includes("/api/");
            const coverRes = await fetch(candidateUrl, {
              signal: auxController.signal,
              ...(isSameApi ? { headers: auxHeaders, credentials: "same-origin" as RequestCredentials } : {}),
            });
            if (coverRes.ok) {
              const candidateBlob = await coverRes.blob();
              if (
                candidateBlob instanceof Blob &&
                candidateBlob.size > 0 &&
                (!candidateBlob.type || candidateBlob.type.startsWith("image/") || candidateBlob.type === "application/octet-stream")
              ) {
                coverBlob = candidateBlob;
                return;
              }
            }
          } catch {}
        }
      } catch {}
    })();

    const lyricsFetchPromise = (async () => {
      try {
        const lyricsRes = await api.getLyrics(trackId);
        if (lyricsRes && Array.isArray(lyricsRes.lines) && lyricsRes.lines.length > 0) {
          lyricsData = {
            lines: lyricsRes.lines,
            source: lyricsRes.source || "lrclib",
            lyricsOffsetMs: lyricsRes.lyricsOffsetMs || 0,
          };
          return;
        }
      } catch {}

      // Fast fallback to embedded or quick auto-fetch
      const inlineLyrics = (track as unknown as { lyrics?: string }).lyrics;
      if (typeof inlineLyrics === "string" && inlineLyrics.trim()) {
        const parsed = parseLrc(inlineLyrics);
        if (parsed.length > 0) {
          lyricsData = {
            lines: parsed,
            source: "embedded",
            lyricsOffsetMs: 0,
          };
          return;
        }
      }

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
          }
        }
      } catch {}
    })();

    const licenseFetchPromise = (async () => {
      if (!token) return;
      try {
        const licRes = await api.getOfflineLicense(trackId);
        if (licRes && licRes.ok && licRes.license) {
          license = licRes.license;
        }
      } catch {}
    })();

    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([
      Promise.allSettled([coverFetchPromise, lyricsFetchPromise, licenseFetchPromise]),
      timeoutPromise,
    ]);
    clearTimeout(auxTimer);

    const savingSession = activeDownloads.get(trackId);
    if (savingSession) {
      savingSession.progress = 98;
      notifyListeners();
    }

    // Save record to IndexedDB (commits on tx.oncomplete)
    await saveDownloadedTrack(track, audioBlob, lyricsData, coverBlob, license);
    activeDownloads.delete(trackId);
    registerDownloadedTrackIndex(track);
    persistDownloadedIndexToLocalStorage();
    notifyStoreChangeListeners();
    void triggerHapticFeedback("downloadComplete");

    // Export to device public Music/Soundify + permanent private offline dir immediately
    try {
      const expRes = await exportTrackToDeviceStorage(track, audioBlob, coverBlob);
      const localUri = expRes.privateUri || expRes.uri;
      if (expRes.success && localUri) {
        registerDeviceLocalAudioFile({
          uri: localUri,
          fileName: `${track.artistName || "Soundify"} - ${track.title || track.id}.mp3`,
          title: track.title || "",
          artist: track.artistName || "",
          trackId: track.id,
          durationSec: track.durationSec,
          sizeBytes: audioBlob.size,
        });
      }
    } catch (autoExpErr) {
      console.warn("Auto-export to device storage non-fatal error:", autoExpErr);
    }

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

  // Already downloaded (exact ID or canonical pageUrl/artist+title match)?
  if (resolveDownloadedTrackId(track)) {
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
    track,
    bytesDownloaded: 0,
    totalBytes: 0,
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
  void deleteNativeOfflineFiles(trackId);
  unregisterDownloadedTrackIndex(trackId);
  persistDownloadedIndexToLocalStorage();
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
    unregisterDownloadedTrackIndex(id);
  }

  persistDownloadedIndexToLocalStorage();
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
  downloadedByPageUrl.clear();
  downloadedByFingerprint.clear();
  downloadedMetaById.clear();
  deviceAudioUriByTrackId.clear();
  deviceAudioUriByFingerprint.clear();
  deviceCoverUriByTrackId.clear();
  deviceCoverUriByFingerprint.clear();
  discoveredDeviceFiles.length = 0;
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(DOWNLOADED_INDEX_LS_KEY);
    }
  } catch {}
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
    () => getTrackDownloadSnapshotForTrack(track),
    () => getTrackDownloadSnapshotForTrack(track),
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
          if (rec.track.coverUrl && !rec.track.coverUrl.startsWith("blob:")) {
            return {
              ...rec,
              track: {
                ...rec.track,
                coverUrl: resolveMediaUrl(rec.track.coverUrl),
              },
            };
          }
          return rec;
        }),
      );
      setTracks(enriched);

      // Keep canonical download index in sync (ID, pageUrl, device Music/Soundify files, and artist+title fingerprints)
      downloadedTrackIds.clear();
      downloadedByPageUrl.clear();
      downloadedByFingerprint.clear();
      downloadedMetaById.clear();
      for (const rec of all) {
        if (rec.trackId) {
          registerDownloadedTrackIndex(rec.track);
        }
      }
      for (const df of discoveredDeviceFiles) {
        registerDeviceLocalAudioFile(df);
      }
      persistDownloadedIndexToLocalStorage();

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

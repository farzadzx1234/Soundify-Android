/**
 * Media Export Service for Soundify Android
 *
 * Saves/exports audio tracks directly to the phone's public storage
 * (Android MediaStore / Music folder or Download folder via browser download trigger)
 * so that native Android music players (Samsung Music, Mi Music, VLC, Google Files, etc.)
 * can discover, index, and play them offline.
 */

import { isAndroidNative } from "./androidBridge";
import { getDownloadedTrack } from "./offlineAudioStorage";
import { resolveMediaUrl } from "./api";
import { triggerHapticFeedback } from "./hapticFeedback";
import type { Track } from "./types";

export interface ExportResult {
  success: boolean;
  alreadyExists?: boolean;
  path?: string;
  uri?: string;
  privateUri?: string;
  method: "native-mediastore" | "web-download";
  error?: string;
}

export interface DeviceSoundifyAudioFile {
  uri: string;
  fileName: string;
  title: string;
  artist: string;
  trackId?: string;
  durationSec?: number;
  sizeBytes?: number;
  coverUri?: string;
  source?: string;
}

function getMediaStorePluginNative(): {
  saveAudioToDevice?: (options: Record<string, unknown>) => Promise<{
    success: boolean;
    alreadyExists?: boolean;
    path?: string;
    uri?: string;
    privateUri?: string;
  }>;
  listDeviceSoundifyAudio?: () => Promise<{ files?: DeviceSoundifyAudioFile[] }>;
  getLocalCoverDataUrl?: (options: { trackId?: string; audioUri?: string }) => Promise<{ dataUrl?: string | null }>;
  saveLocalCover?: (options: { trackId: string; coverBase64: string }) => Promise<{ success?: boolean; coverUri?: string }>;
  saveLocalLyrics?: (options: { trackId: string; lyricsJson: string }) => Promise<{ success?: boolean }>;
  getLocalLyrics?: (options: { trackId: string }) => Promise<{ lyricsJson?: string | null }>;
  deleteOfflineFiles?: (options: { trackId: string }) => Promise<void>;
} | null {
  if (!isAndroidNative()) return null;
  const win =
    typeof window !== "undefined"
      ? window
      : (globalThis as unknown as { window?: Window & typeof globalThis }).window;
  const plugins = win?.Capacitor?.Plugins as Record<string, unknown> | undefined;
  return (plugins?.MediaStorePlugin as ReturnType<typeof getMediaStorePluginNative>) || null;
}

const localCoverDataUrlCache = new Map<string, string>();
const MAX_LOCAL_COVER_DATA_URLS = 180;

export function getCachedLocalDeviceCoverDataUrl(trackId?: string): string | null {
  if (!trackId) return null;
  return localCoverDataUrlCache.get(trackId) || null;
}

export async function listDeviceSoundifyAudioFiles(): Promise<DeviceSoundifyAudioFile[]> {
  try {
    const plugin = getMediaStorePluginNative();
    if (!plugin?.listDeviceSoundifyAudio) return [];
    const res = await plugin.listDeviceSoundifyAudio();
    return Array.isArray(res?.files) ? res.files.filter((f) => Boolean(f?.uri && f?.fileName)) : [];
  } catch {
    return [];
  }
}

export async function getLocalDeviceCoverDataUrl(opts: {
  trackId?: string;
  audioUri?: string;
}): Promise<string | null> {
  if (!opts.trackId && !opts.audioUri) return null;
  if (opts.trackId && localCoverDataUrlCache.has(opts.trackId)) {
    return localCoverDataUrlCache.get(opts.trackId) || null;
  }
  try {
    const plugin = getMediaStorePluginNative();
    if (!plugin?.getLocalCoverDataUrl) return null;
    const res = await plugin.getLocalCoverDataUrl(opts);
    const dataUrl =
      typeof res?.dataUrl === "string" && res.dataUrl.startsWith("data:image/") ? res.dataUrl : null;
    if (dataUrl && opts.trackId) {
      if (localCoverDataUrlCache.size >= MAX_LOCAL_COVER_DATA_URLS) {
        const oldest = localCoverDataUrlCache.keys().next().value;
        if (oldest) localCoverDataUrlCache.delete(oldest);
      }
      localCoverDataUrlCache.set(opts.trackId, dataUrl);
    }
    return dataUrl;
  } catch {
    return null;
  }
}

export async function saveLocalDeviceCover(
  trackId: string,
  coverBlob: Blob,
): Promise<string | null> {
  if (!trackId || !(coverBlob instanceof Blob) || coverBlob.size <= 0 || coverBlob.size > 2 * 1024 * 1024) {
    return null;
  }
  try {
    const plugin = getMediaStorePluginNative();
    if (!plugin?.saveLocalCover) return null;
    const coverBase64 = await blobToBase64(coverBlob);
    if (!coverBase64) return null;
    const res = await plugin.saveLocalCover({ trackId, coverBase64 });
    return res?.success && res.coverUri ? res.coverUri : null;
  } catch {
    return null;
  }
}

export async function saveLocalDeviceLyrics(trackId: string, lyrics: unknown): Promise<boolean> {
  if (!trackId || !lyrics) return false;
  try {
    const plugin = getMediaStorePluginNative();
    if (!plugin?.saveLocalLyrics) return false;
    const res = await plugin.saveLocalLyrics({
      trackId,
      lyricsJson: JSON.stringify(lyrics),
    });
    return Boolean(res?.success);
  } catch {
    return false;
  }
}

export async function getLocalDeviceLyrics<T>(trackId: string): Promise<T | null> {
  if (!trackId) return null;
  try {
    const plugin = getMediaStorePluginNative();
    if (!plugin?.getLocalLyrics) return null;
    const res = await plugin.getLocalLyrics({ trackId });
    if (typeof res?.lyricsJson === "string" && res.lyricsJson.trim()) {
      return JSON.parse(res.lyricsJson) as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function deleteNativeOfflineFiles(trackId: string): Promise<void> {
  if (!trackId) return;
  try {
    const plugin = getMediaStorePluginNative();
    if (plugin?.deleteOfflineFiles) {
      await plugin.deleteOfflineFiles({ trackId });
    }
  } catch {}
}

const EXPORTED_TRACKS_STORAGE_KEY = "soundify_exported_track_ids";
const memoryExportedSet = new Set<string>();

/**
 * Returns the set of track IDs that have been exported/saved to device storage.
 */
export function getExportedTrackIds(): Set<string> {
  const combined = new Set<string>(memoryExportedSet);
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(EXPORTED_TRACKS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const id of arr) {
            combined.add(String(id));
          }
        }
      }
    }
  } catch {}
  return combined;
}

/**
 * Checks whether a track was previously exported to device storage.
 */
export function isTrackExported(trackId: string): boolean {
  if (!trackId) return false;
  return getExportedTrackIds().has(trackId);
}

/**
 * Marks a track as exported in local storage.
 */
export function markTrackAsExported(trackId: string): void {
  if (!trackId) return;
  memoryExportedSet.add(trackId);
  try {
    if (typeof localStorage !== "undefined") {
      const set = getExportedTrackIds();
      set.add(trackId);
      localStorage.setItem(EXPORTED_TRACKS_STORAGE_KEY, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

/**
 * Clears exported tracking memory (useful for testing or cache resets).
 */
export function clearExportedTrackMemory(): void {
  memoryExportedSet.clear();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(EXPORTED_TRACKS_STORAGE_KEY);
    }
  } catch {}
}

/**
 * Converts a Blob to a standard Base64 string.
 * Supports modern Blob.arrayBuffer() across both Browser and Node runtimes,
 * with fallback to FileReader when available.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === "function") {
    const arrayBuffer = await blob.arrayBuffer();
    if (typeof Buffer !== "undefined") {
      return Buffer.from(arrayBuffer).toString("base64");
    }
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(bytes.byteLength, i + chunkSize))));
    }
    const binary = chunks.join("");
    if (typeof btoa === "function") {
      return btoa(binary);
    }
  }

  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        if (res) {
          // Strip data URI scheme prefix (e.g. "data:audio/mpeg;base64,...")
          const commaIdx = res.indexOf(",");
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        } else {
          reject(new Error("Failed to convert blob to base64"));
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Blob reading failed"));
      reader.readAsDataURL(blob);
    });
  }

  throw new Error("Neither Blob.arrayBuffer nor FileReader is available");
}

/**
 * Sanitizes a track title and artist name into a safe file name.
 */
export function getExportFileName(track: Track): string {
  const artist = (track.artistName || track.artistNameFa || "Soundify")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_");
  const title = (track.title || track.titleFa || `Track_${track.id}`)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_");
  return `${artist} - ${title}.mp3`;
}

/**
 * Triggers standard browser download fallback for Web / PWA / Browser environments.
 */
function triggerWebBlobDownload(blob: Blob, fileName: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exports a track to the device's public storage.
 *
 * 1. Resolves the audio Blob (from local IndexedDB storage or network stream).
 * 2. If running inside native Android APK wrapper, uses MediaStorePlugin to write
 *    directly into Android's public Music/Soundify directory and triggers MediaScanner.
 * 3. In Web/PWA or upon native failure, initiates a standard browser file download
 *    which saves directly to the user's phone "Download" directory.
 */
export async function exportTrackToDeviceStorage(
  track: Track,
  providedBlob?: Blob,
  providedCoverBlob?: Blob,
): Promise<ExportResult> {
  if (!track || !track.id) {
    return { success: false, method: "web-download", error: "Invalid track data" };
  }

  const fileName = getExportFileName(track);

  // Prevent duplicate exports only if NOT saving initial permanent offline copy or if already exported cleanly
  if (isTrackExported(track.id) && !providedCoverBlob) {
    return {
      success: true,
      alreadyExists: true,
      method: isAndroidNative() ? "native-mediastore" : "web-download",
      path: `Music/Soundify/${fileName}`,
    };
  }

  // 1. Resolve Audio Blob
  let audioBlob: Blob | undefined = providedBlob;
  if (!audioBlob) {
    try {
      const record = await getDownloadedTrack(track.id);
      if (record && record.audioBlob instanceof Blob && record.audioBlob.size > 0) {
        audioBlob = record.audioBlob;
      }
    } catch {}
  }

  // If still not available from offline storage, attempt fetching from network
  if (!audioBlob && track.audioUrl) {
    try {
      const streamUrl = resolveMediaUrl(track.audioUrl);
      const res = await fetch(streamUrl);
      if (res.ok) {
        audioBlob = await res.blob();
      }
    } catch {}
  }

  if (!audioBlob) {
    return {
      success: false,
      method: "web-download",
      error: "Could not retrieve audio stream for this track",
    };
  }

  // 2. If running in native Android APK, attempt direct MediaStore + permanent app-private insertion
  if (isAndroidNative()) {
    try {
      const mediaStorePlugin = getMediaStorePluginNative();

      if (mediaStorePlugin && typeof mediaStorePlugin.saveAudioToDevice === "function") {
        const base64Data = await blobToBase64(audioBlob);
        let coverBase64 = "";
        if (providedCoverBlob instanceof Blob && providedCoverBlob.size > 0 && providedCoverBlob.size <= 1.5 * 1024 * 1024) {
          try {
            coverBase64 = await blobToBase64(providedCoverBlob);
          } catch {}
        }
        const result = await mediaStorePlugin.saveAudioToDevice({
          base64: base64Data,
          fileName,
          trackId: track.id,
          coverBase64,
          title: track.title || "",
          artist: track.artistName || "",
          album: "Soundify",
          mimeType: "audio/mpeg",
        });

        if (result && result.success) {
          markTrackAsExported(track.id);
          if (!result.alreadyExists) {
            void triggerHapticFeedback("downloadComplete");
          }
          return {
            success: true,
            alreadyExists: Boolean(result.alreadyExists),
            method: "native-mediastore",
            path: result.path || `Music/Soundify/${fileName}`,
            uri: result.uri,
            privateUri: result.privateUri,
          };
        }
      }
    } catch (nativeErr) {
      // Fallback to web blob download if native plugin throws
      console.warn("Native MediaStore export failed, falling back to web download:", nativeErr);
    }
  }

  // 3. Web / PWA / Fallback Download Trigger
  const webSuccess = triggerWebBlobDownload(audioBlob, fileName);
  if (webSuccess) {
    markTrackAsExported(track.id);
    void triggerHapticFeedback("downloadComplete");
    return {
      success: true,
      method: "web-download",
      path: fileName,
    };
  }

  return {
    success: false,
    method: "web-download",
    error: "Browser blocked or failed file download",
  };
}

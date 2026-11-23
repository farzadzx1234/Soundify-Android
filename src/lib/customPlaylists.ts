/**
 * User Custom Playlists Store (Spotify-style Online + Offline Persistent Playlists)
 *
 * Works with ALL Soundify track sources: YouTube, SoundCloud, Spotify, Offline Downloads,
 * and Soundify Catalog tracks. Persists locally in localStorage so user playlists are instant,
 * offline-capable, and never lost on app restarts.
 */

import { useSyncExternalStore } from "react";
import { api, extractYouTubeIdClient } from "./api";
import type { Playlist, Track } from "./types";
import type { PersonalizedMix } from "./listeningPersonalization";

const CUSTOM_PLAYLISTS_KEY = "soundify_custom_playlists_v1";
const CUSTOM_PLAYLISTS_EVENT = "soundify-custom-playlists-changed";

export interface CustomPlaylistRecord {
  id: string;
  title: string;
  titleFa: string;
  description: string;
  descriptionFa: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
  tracks: Track[];
}

const EMPTY_LIST: CustomPlaylistRecord[] = [];
let cachedRawJson: string | null = null;
let cachedParsedList: CustomPlaylistRecord[] = EMPTY_LIST;

function notifyChange(): void {
  cachedRawJson = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CUSTOM_PLAYLISTS_EVENT));
  }
}

export function isCorruptedOrBlobCover(trackId: string, coverUrl?: string): boolean {
  if (!coverUrl || !coverUrl.trim()) return true;
  if (coverUrl.startsWith("blob:")) return true;
  if (trackId !== "track-01" && coverUrl === "/covers/track-01.jpg") return true;
  return false;
}

export function sanitizeStoredCoverUrl(track: Track): string {
  if (!isCorruptedOrBlobCover(track.id, track.coverUrl)) {
    return track.coverUrl;
  }
  const ytId = extractYouTubeIdClient(track.pageUrl || track.id);
  if (ytId) {
    return `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}&id=${encodeURIComponent(track.id)}`;
  }
  if (track.id && !track.id.startsWith("ext-")) {
    return `/api/tracks/${track.id}/cover`;
  }
  return "";
}

function readCustomPlaylists(): CustomPlaylistRecord[] {
  if (typeof window === "undefined") return EMPTY_LIST;
  try {
    const raw = window.localStorage.getItem(CUSTOM_PLAYLISTS_KEY) || "";
    if (raw === cachedRawJson && cachedRawJson !== null) {
      return cachedParsedList;
    }
    if (!raw) {
      cachedRawJson = "";
      cachedParsedList = EMPTY_LIST;
      return cachedParsedList;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedRawJson = raw;
      cachedParsedList = EMPTY_LIST;
      return cachedParsedList;
    }
    let healedAny = false;
    const validRecords: CustomPlaylistRecord[] = [];
    for (const p of parsed) {
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.id !== "string" ||
        typeof p.title !== "string" ||
        !Array.isArray(p.tracks)
      ) {
        continue;
      }
      let recordHealed = false;
      const healedTracks = p.tracks.map((tr: Track) => {
        if (tr && typeof tr === "object" && isCorruptedOrBlobCover(tr.id, tr.coverUrl)) {
          const fixedCover = sanitizeStoredCoverUrl(tr);
          if (fixedCover !== tr.coverUrl) {
            recordHealed = true;
            healedAny = true;
            return { ...tr, coverUrl: fixedCover };
          }
        }
        return tr;
      });
      validRecords.push(recordHealed ? { ...p, tracks: healedTracks } : (p as CustomPlaylistRecord));
    }
    if (healedAny) {
      try {
        const reserialized = JSON.stringify(validRecords);
        window.localStorage.setItem(CUSTOM_PLAYLISTS_KEY, reserialized);
        cachedRawJson = reserialized;
        cachedParsedList = validRecords;
        return cachedParsedList;
      } catch {}
    }
    cachedRawJson = raw;
    cachedParsedList = validRecords;
    return cachedParsedList;
  } catch {
    return EMPTY_LIST;
  }
}

function writeCustomPlaylists(list: CustomPlaylistRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(list);
    window.localStorage.setItem(CUSTOM_PLAYLISTS_KEY, serialized);
    cachedRawJson = serialized;
    cachedParsedList = list;
    window.dispatchEvent(new Event(CUSTOM_PLAYLISTS_EVENT));
  } catch {
    notifyChange();
  }
}

export function subscribeCustomPlaylists(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocal = () => onStoreChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === CUSTOM_PLAYLISTS_KEY) {
      cachedRawJson = null;
      onStoreChange();
    }
  };
  window.addEventListener(CUSTOM_PLAYLISTS_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CUSTOM_PLAYLISTS_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCustomPlaylists(): CustomPlaylistRecord[] {
  return useSyncExternalStore(
    subscribeCustomPlaylists,
    readCustomPlaylists,
    () => EMPTY_LIST,
  );
}

export function getCustomPlaylists(): CustomPlaylistRecord[] {
  return readCustomPlaylists();
}

export function getCustomPlaylistById(id: string): CustomPlaylistRecord | null {
  if (!id) return null;
  return readCustomPlaylists().find((p) => p.id === id) ?? null;
}

export function customRecordToPlaylist(record: CustomPlaylistRecord): Playlist {
  const coverUrls = record.tracks
    .filter((t) => !isCorruptedOrBlobCover(t.id, t.coverUrl))
    .map((t) => t.coverUrl)
    .slice(0, 4);

  return {
    id: record.id,
    title: record.title,
    titleFa: record.titleFa || record.title,
    description: record.description,
    descriptionFa: record.descriptionFa || record.description,
    ownerId: "local-user",
    isFeatured: false,
    accentColor: record.accentColor || "#6366f1",
    trackCount: record.tracks.length,
    coverUrls,
    createdAt: record.createdAt,
  };
}

function sanitizeTrackForStorage(track: Track): Track {
  return {
    ...track,
    // Drop non-persistent blob URLs & waveforms so custom playlists stay compact & valid across restarts
    waveform: [],
    coverUrl: sanitizeStoredCoverUrl(track),
  };
}

export function createCustomPlaylist(input: {
  title: string;
  description?: string;
  accentColor?: string;
  initialTracks?: Track[];
}): CustomPlaylistRecord {
  const cleanTitle = input.title.trim() || "My Playlist";
  const cleanDesc = (input.description || "").trim();
  const now = new Date().toISOString();
  const uniqueTracks: Track[] = [];
  const seen = new Set<string>();
  for (const tr of input.initialTracks || []) {
    if (!tr || !tr.id || seen.has(tr.id)) continue;
    seen.add(tr.id);
    uniqueTracks.push(sanitizeTrackForStorage(tr));
  }

  const record: CustomPlaylistRecord = {
    id: `cpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    titleFa: cleanTitle,
    description: cleanDesc,
    descriptionFa: cleanDesc,
    accentColor: input.accentColor || "#6366f1",
    createdAt: now,
    updatedAt: now,
    tracks: uniqueTracks,
  };

  const current = readCustomPlaylists();
  writeCustomPlaylists([record, ...current]);
  return record;
}

export function updateCustomPlaylist(
  id: string,
  updates: { title?: string; description?: string; accentColor?: string },
): CustomPlaylistRecord | null {
  const current = readCustomPlaylists();
  const idx = current.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const existing = current[idx];
  const nextTitle = updates.title !== undefined && updates.title.trim() ? updates.title.trim() : existing.title;
  const nextDesc = updates.description !== undefined ? updates.description.trim() : existing.description;

  const updated: CustomPlaylistRecord = {
    ...existing,
    title: nextTitle,
    titleFa: nextTitle,
    description: nextDesc,
    descriptionFa: nextDesc,
    accentColor: updates.accentColor || existing.accentColor,
    updatedAt: new Date().toISOString(),
  };

  const nextList = [...current];
  nextList[idx] = updated;
  writeCustomPlaylists(nextList);
  return updated;
}

export function deleteCustomPlaylist(id: string): boolean {
  const current = readCustomPlaylists();
  const next = current.filter((p) => p.id !== id);
  if (next.length === current.length) return false;
  writeCustomPlaylists(next);
  return true;
}

export function addTrackToCustomPlaylist(
  playlistId: string,
  track: Track,
): { added: boolean; playlist: CustomPlaylistRecord | null } {
  const current = readCustomPlaylists();
  const idx = current.findIndex((p) => p.id === playlistId);
  if (idx === -1) return { added: false, playlist: null };

  const existing = current[idx];
  if (existing.tracks.some((t) => t.id === track.id)) {
    return { added: false, playlist: existing };
  }

  const updated: CustomPlaylistRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    tracks: [...existing.tracks, sanitizeTrackForStorage(track)],
  };

  const nextList = [...current];
  nextList[idx] = updated;
  writeCustomPlaylists(nextList);

  // Best-effort cloud sync if playlist & track are remote catalog IDs
  if (!playlistId.startsWith("cpl-") && !track.id.startsWith("ext-")) {
    void api.addTrackToPlaylist(playlistId, track.id).catch(() => {});
  }
  return { added: true, playlist: updated };
}

export function removeTrackFromCustomPlaylist(playlistId: string, trackId: string): CustomPlaylistRecord | null {
  const current = readCustomPlaylists();
  const idx = current.findIndex((p) => p.id === playlistId);
  if (idx === -1) return null;

  const existing = current[idx];
  const updated: CustomPlaylistRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    tracks: existing.tracks.filter((t) => t.id !== trackId),
  };

  const nextList = [...current];
  nextList[idx] = updated;
  writeCustomPlaylists(nextList);
  return updated;
}

export function savePersonalizedMixAsCustomPlaylist(
  mix: PersonalizedMix,
  lang: "fa" | "en" = "fa",
): CustomPlaylistRecord {
  return createCustomPlaylist({
    title: lang === "fa" ? mix.titleFa : mix.title,
    description: lang === "fa" ? mix.subtitleFa : mix.subtitle,
    accentColor: mix.accentColor || "#8b5cf6",
    initialTracks: mix.tracks,
  });
}

export function clearCustomPlaylists(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CUSTOM_PLAYLISTS_KEY);
    cachedRawJson = "";
    cachedParsedList = EMPTY_LIST;
    window.dispatchEvent(new Event(CUSTOM_PLAYLISTS_EVENT));
  } catch {}
}

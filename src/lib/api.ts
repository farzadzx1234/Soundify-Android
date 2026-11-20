import type {
  AdminStats,
  AdminUser,
  AdminUserDetails,
  Artist,
  AuthResponse,
  BootstrapSyncData,
  ChangePasswordPayload,
  DeltaSyncResponse,
  DeviceInfo,
  EncryptedEnvelope,
  ExternalMusicSource,
  ExternalTrackCandidate,
  LibraryLikesBatchPayload,
  LibraryLikesBatchResponse,
  LyricLine,
  LyricsSourceCandidate,
  MobileDeviceRegistrationPayload,
  MobileHealthDiagnostic,
  MobileStatus,
  OfflineLicense,
  OfflineLicenseResponse,
  OfflineLicenseVerifyResponse,
  PlaybackStateSync,
  Playlist,
  PlaylistCreatePayload,
  PlaylistTracksReorderPayload,
  PlaylistUpdatePayload,
  TokenRefreshResponse,
  Track,
  TrackComment,
  User,
  UserProfileUpdatePayload,
  UserSyncData,
} from "./types";
import {
  checkBackendHealth,
  checkDeepBackendHealth,
  getBackendUrl,
  getPlaylistDetailHref,
  getTrackDetailHref,
  getTrackShareUrl,
  resolveApiUrl,
  resolveMediaUrl,
  resolveMobileV1Url,
  setBackendUrl,
  setServerConnectivityStatus,
  MOBILE_V1_PREFIX,
} from "./mobileBackend";
import { reportNetworkFailure, reportNetworkSuccess } from "./networkResilience";
import {
  FALLBACK_ARTISTS,
  FALLBACK_PLAYLISTS,
  FALLBACK_TRACKS,
  getFallbackLyrics,
} from "./fallbackSeedData";
import { secureStorage } from "./secureStorage";
import { parseLrc } from "./lrc";
import {
  encryptPayload,
  decryptPayload,
  performClientHandshake,
} from "./mobileCrypto";
import { getCachedUserSync, queueOfflineLike } from "./mobileSync";

export {
  checkBackendHealth,
  checkDeepBackendHealth,
  getBackendUrl,
  getPlaylistDetailHref,
  getTrackDetailHref,
  getTrackShareUrl,
  resolveApiUrl,
  resolveMediaUrl,
  resolveMobileV1Url,
  setBackendUrl,
  MOBILE_V1_PREFIX,
};

/**
 * Client-side YouTube ID extractor supporting URLs, queries, and prefixed IDs.
 */
export function extractYouTubeIdClient(input: string): string | null {
  if (!input) return null;
  let str = input.trim();
  if (!str) return null;

  try {
    if (str.includes("%")) {
      str = decodeURIComponent(str);
      if (str.includes("%")) str = decodeURIComponent(str);
    }
  } catch {}

  const vParamMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})(?:[&?]|$)/);
  if (vParamMatch) return vParamMatch[1];

  const watchMatch = str.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (watchMatch) return watchMatch[1];

  const viMatch = str.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})(?:[\/?.]|$)/i);
  if (viMatch) return viMatch[1];

  const extMatch = str.match(/(?:^|[?&=/])(?:ext[-_])?(?:youtube[-_])+([a-zA-Z0-9_-]{11})(?:[&?.\/]|$)/i);
  if (extMatch) return extMatch[1];

  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }

  return null;
}

let authToken: string | null = null;
let currentRefreshToken: string | null = null;
let refreshInProgress: Promise<string | null> | null = null;

export type AuthTokenListener = (hasToken: boolean) => void;
const authTokenListeners = new Set<AuthTokenListener>();

export function onAuthTokensChanged(listener: AuthTokenListener): () => void {
  authTokenListeners.add(listener);
  return () => {
    authTokenListeners.delete(listener);
  };
}

export function setApiTokens(token: string | null, newRefreshToken?: string | null) {
  authToken = token;
  if (token) {
    void secureStorage.setItem("soundify_token", token);
  } else {
    void secureStorage.removeItem("soundify_token");
  }

  if (newRefreshToken !== undefined) {
    currentRefreshToken = newRefreshToken;
    if (newRefreshToken) {
      void secureStorage.setItem("soundify_refresh_token", newRefreshToken);
    } else {
      void secureStorage.removeItem("soundify_refresh_token");
    }
  }

  const hasToken = Boolean(token);
  for (const listener of authTokenListeners) {
    try {
      listener(hasToken);
    } catch {}
  }
}

export function setApiToken(token: string | null) {
  setApiTokens(token);
}

export function getApiToken(): string | null {
  if (authToken) return authToken;
  authToken = secureStorage.getItemSync("soundify_token");
  return authToken;
}

export async function getApiTokenAsync(): Promise<string | null> {
  if (authToken) return authToken;
  authToken = await secureStorage.getItem("soundify_token");
  return authToken;
}

export function getRefreshToken(): string | null {
  if (currentRefreshToken) return currentRefreshToken;
  currentRefreshToken = secureStorage.getItemSync("soundify_refresh_token");
  return currentRefreshToken;
}

export async function getRefreshTokenAsync(): Promise<string | null> {
  if (currentRefreshToken) return currentRefreshToken;
  currentRefreshToken = await secureStorage.getItem("soundify_refresh_token");
  return currentRefreshToken;
}

async function attemptTokenRefresh(): Promise<string | null> {
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    try {
      const refreshTokenValue = await getRefreshTokenAsync();
      if (!refreshTokenValue) {
        setApiTokens(null, null);
        return null;
      }

      const refreshUrl = resolveApiUrl("/api/mobile/v1/auth/refresh");
      const res = await fetch(refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "Android",
        },
        body: JSON.stringify({ refreshToken: refreshTokenValue }),
      });

      if (!res.ok) {
        setApiTokens(null, null);
        return null;
      }

      const data = (await res.json()) as TokenRefreshResponse;
      if (data?.token) {
        setApiTokens(data.token, data.refreshToken || refreshTokenValue);
        return data.token;
      }
      setApiTokens(null, null);
      return null;
    } catch {
      return null;
    } finally {
      refreshInProgress = null;
    }
  })();

  return refreshInProgress;
}

const CATALOG_CACHE_PREFIX = "soundify_catalog_swr_v1:";
const memoryCatalogCache = new Map<string, { ts: number; data: unknown }>();
const inFlightGetRequests = new Map<string, Promise<unknown>>();

function readCatalogCache<T>(key: string, maxAgeMs = 15 * 60 * 1000): T | null {
  const mem = memoryCatalogCache.get(key);
  if (mem && Date.now() - mem.ts <= maxAgeMs) {
    return mem.data as T;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${CATALOG_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: T };
    if (parsed && typeof parsed.ts === "number" && Date.now() - parsed.ts <= maxAgeMs && parsed.data !== undefined) {
      memoryCatalogCache.set(key, { ts: parsed.ts, data: parsed.data });
      return parsed.data;
    }
  } catch {}
  return null;
}

function writeCatalogCache<T>(key: string, data: T): void {
  const entry = { ts: Date.now(), data };
  memoryCatalogCache.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${CATALOG_CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Ignore storage quota errors
  }
}

export function getCachedCatalogTracks(): Track[] | null {
  const cached = readCatalogCache<Track[]>("tracks");
  return Array.isArray(cached) && cached.length > 0 ? cached.map(normalizeTrack) : null;
}

export function getCachedCatalogPlaylists(): Playlist[] | null {
  const cached = readCatalogCache<Playlist[]>("playlists");
  return Array.isArray(cached) && cached.length > 0 ? cached.map(normalizePlaylist) : null;
}

export function getCachedCatalogArtists(): Artist[] | null {
  const cached = readCatalogCache<Artist[]>("artists");
  return Array.isArray(cached) && cached.length > 0 ? cached : null;
}

async function executeFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const fullUrl = resolveApiUrl(path);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signal = init.signal;
  if (!signal) {
    const controller = new AbortController();
    signal = controller.signal;
    const isTestEnv = typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || Boolean(process.env?.VITEST));
    timeoutId = setTimeout(() => controller.abort(), isTestEnv ? 2000 : 8500);
  }

  try {
    const res = await fetch(fullUrl, {
      cache: init.cache ?? "no-store",
      ...init,
      signal,
      headers,
      credentials: "include",
    });
    return res;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // If a token refresh is currently in progress, wait for it before dispatching new protected requests
  if (
    refreshInProgress &&
    !path.includes("/auth/login") &&
    !path.includes("/auth/refresh") &&
    !path.includes("/auth/register")
  ) {
    try {
      await refreshInProgress;
    } catch {}
  }

  const token = await getApiTokenAsync();
  const method = (init.method || "GET").toUpperCase();
  const canDeduplicate = method === "GET" && !init.signal;
  const dedupKey = canDeduplicate ? `${resolveApiUrl(path)}::${token ? "auth" : "anon"}` : "";

  if (canDeduplicate) {
    const existing = inFlightGetRequests.get(dedupKey);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const runRequest = async (): Promise<T> => {
    try {
      let res = await executeFetch(path, init, token);

      // Auto-refresh access token on 401 Unauthorized for protected endpoints
      if (
        res.status === 401 &&
        !path.includes("/auth/login") &&
        !path.includes("/auth/refresh") &&
        !path.includes("/auth/register")
      ) {
        const refreshedToken = await attemptTokenRefresh();
        if (refreshedToken) {
          res = await executeFetch(path, init, refreshedToken);
        }
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string; errorFa?: string };
          errMsg = data.error || errMsg;
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      reportNetworkSuccess();
      setServerConnectivityStatus("online");
      return (await res.json()) as T;
    } catch (err: unknown) {
      const isNetworkErr =
        (typeof navigator !== "undefined" && navigator.onLine === false) ||
        (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network") || err.message.includes("Failed"))) ||
        (err as Error)?.name === "AbortError" ||
        String((err as Error)?.message || "").toLowerCase().includes("offline") ||
        String((err as Error)?.message || "").toLowerCase().includes("networkerror") ||
        String((err as Error)?.message || "").toLowerCase().includes("econnrefused") ||
        String((err as Error)?.message || "").toLowerCase().includes("etimedout");

      if (isNetworkErr) {
        const isDeviceOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        setServerConnectivityStatus(isDeviceOnline ? "vpn_or_server_down" : "offline");
        reportNetworkFailure();
        const offlineErr = new Error("Network offline");
        Object.assign(offlineErr, { isOffline: true, originalError: err });
        throw offlineErr;
      }
      throw err;
    }
  };

  if (!canDeduplicate) {
    return runRequest();
  }

  const promise = runRequest().finally(() => {
    inFlightGetRequests.delete(dedupKey);
  });
  inFlightGetRequests.set(dedupKey, promise);
  return promise;
}

export function normalizeTrack(track: Track): Track {
  if (!track) return track;
  return {
    ...track,
    audioUrl: resolveMediaUrl(track.audioUrl),
    coverUrl: resolveMediaUrl(track.coverUrl),
  };
}

export function normalizePlaylist(playlist: Playlist): Playlist {
  if (!playlist) return playlist;
  return {
    ...playlist,
    coverUrls: Array.isArray(playlist.coverUrls)
      ? playlist.coverUrls.map((u) => resolveMediaUrl(u))
      : [],
  };
}

export const api = {
  async getTracks(params?: { q?: string; genre?: string; mood?: string; sort?: string; liked?: boolean; reposted?: boolean; limit?: number }) {
    try {
      const qs = new URLSearchParams();
      if (params?.q) qs.set("q", params.q);
      if (params?.genre && params.genre !== "all") qs.set("genre", params.genre);
      if (params?.mood && params.mood !== "all") qs.set("mood", params.mood);
      if (params?.sort) qs.set("sort", params.sort);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.liked) qs.set("liked", "true");
      if (params?.reposted) qs.set("reposted", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await apiFetch<{ tracks: Track[] }>(`/api/mobile/v1/tracks${suffix}`);
      if (res?.tracks && Array.isArray(res.tracks)) {
        const normalized = res.tracks.map(normalizeTrack);
        if (!suffix && normalized.length > 0) {
          writeCatalogCache("tracks", normalized);
        }
        return { tracks: normalized };
      }
    } catch {
      // Backend unreachable or offline: try cached live server catalog before bundled fallback
    }

    const cachedLiveTracks = !params?.q && (!params?.genre || params.genre === "all") && (!params?.mood || params.mood === "all") && !params?.liked && !params?.reposted
      ? getCachedCatalogTracks()
      : null;
    if (cachedLiveTracks) {
      return { tracks: cachedLiveTracks };
    }

    let filtered = [...FALLBACK_TRACKS];
    if (params?.q) {
      const q = params.q.toLowerCase().trim();
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.titleFa?.toLowerCase().includes(q) ||
          t.artistName.toLowerCase().includes(q) ||
          t.artistNameFa?.toLowerCase().includes(q),
      );
    }
    if (params?.genre && params.genre !== "all") {
      filtered = filtered.filter((t) => t.genre.toLowerCase() === params.genre!.toLowerCase());
    }
    if (params?.mood && params.mood !== "all") {
      filtered = filtered.filter((t) => t.mood.toLowerCase() === params.mood!.toLowerCase());
    }
    return { tracks: filtered.map(normalizeTrack) };
  },
  async searchExternal(q: string, source: "all" | "youtube" | "soundcloud" | "spotify" = "all", limit = 16) {
    try {
      const sp = new URLSearchParams({ q, source, limit: String(limit) });
      const res = await apiFetch<{
        query: string;
        source: string;
        results: Track[];
        total: number;
        error?: string;
      }>(`/api/external/search?${sp.toString()}`);
      if (res?.results && Array.isArray(res.results)) {
        return { ...res, results: res.results.map(normalizeTrack) };
      }
    } catch {
      // Graceful offline search over bundled catalog
    }

    const qLower = q.toLowerCase().trim();
    const matches = FALLBACK_TRACKS.filter(
      (t) =>
        t.title.toLowerCase().includes(qLower) ||
        t.titleFa?.toLowerCase().includes(qLower) ||
        t.artistName.toLowerCase().includes(qLower) ||
        t.artistNameFa?.toLowerCase().includes(qLower) ||
        t.album.toLowerCase().includes(qLower),
    );
    return {
      query: q,
      source: "offline-bundle",
      results: matches.slice(0, limit).map(normalizeTrack),
      total: matches.length,
    };
  },
  async getTrack(id: string) {
    try {
      const res = await apiFetch<{ track: Track }>(`/api/mobile/v1/tracks/${encodeURIComponent(id)}`);
      if (res?.track) {
        return { track: normalizeTrack(res.track) };
      }
    } catch {
      // Fallback
    }
    const found = FALLBACK_TRACKS.find((t) => t.id === id) || FALLBACK_TRACKS[0];
    return { track: normalizeTrack(found) };
  },
  deleteTrack(id: string) {
    return apiFetch<{ deleted: boolean }>(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  recordPlay(id: string) {
    return apiFetch<{ playsCount: number }>(`/api/tracks/${encodeURIComponent(id)}/play`, { method: "POST" });
  },
  async toggleLike(id: string, metadata?: Partial<Track> | Record<string, unknown>) {
    const payload = metadata ? { trackId: id, ...metadata } : { trackId: id };
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

    if (isOffline) {
      const cached = getCachedUserSync();
      const currentLiked = cached?.likedTrackIds?.includes(id) ?? false;
      const willLike = !currentLiked;
      queueOfflineLike(id, willLike);
      const curCount = (metadata?.likesCount as number) ?? 0;
      return {
        liked: willLike,
        likesCount: willLike ? curCount + 1 : Math.max(0, curCount - 1),
      };
    }

    try {
      const res = await apiFetch<{ ok?: boolean; liked: boolean; likesCount: number; trackId?: string }>(
        "/api/mobile/v1/library/likes",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      return { liked: res.liked, likesCount: res.likesCount };
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { isOffline?: boolean }).isOffline) {
        const cached = getCachedUserSync();
        const currentLiked = cached?.likedTrackIds?.includes(id) ?? false;
        const willLike = !currentLiked;
        queueOfflineLike(id, willLike);
        const curCount = (metadata?.likesCount as number) ?? 0;
        return {
          liked: willLike,
          likesCount: willLike ? curCount + 1 : Math.max(0, curCount - 1),
        };
      }
      return apiFetch<{ liked: boolean; likesCount: number }>(`/api/tracks/${encodeURIComponent(id)}/like`, {
        method: "POST",
        body: metadata ? JSON.stringify(metadata) : undefined,
      });
    }
  },
  async unlikeTrack(trackId: string) {
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (isOffline) {
      queueOfflineLike(trackId, false);
      return { ok: true, trackId, liked: false, likesCount: 0 };
    }
    try {
      return await apiFetch<{ ok: boolean; trackId: string; liked: boolean; likesCount: number }>(
        `/api/mobile/v1/library/likes/${encodeURIComponent(trackId)}`,
        { method: "DELETE" },
      );
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { isOffline?: boolean }).isOffline) {
        queueOfflineLike(trackId, false);
        return { ok: true, trackId, liked: false, likesCount: 0 };
      }
      throw err;
    }
  },
  async getLikedTracks() {
    const res = await apiFetch<{ likedTrackIds: string[]; tracks: Track[]; total: number }>(
      "/api/mobile/v1/library/likes",
    );
    return {
      ...res,
      tracks: Array.isArray(res.tracks) ? res.tracks.map(normalizeTrack) : [],
    };
  },
  syncOfflineLikesBatch(payload: LibraryLikesBatchPayload) {
    return apiFetch<LibraryLikesBatchResponse>("/api/mobile/v1/library/likes/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getOfflineLicense(id: string) {
    return apiFetch<OfflineLicenseResponse>(`/api/mobile/v1/tracks/${encodeURIComponent(id)}/offline-license`);
  },
  verifyOfflineLicense(id: string, license: OfflineLicense) {
    return apiFetch<OfflineLicenseVerifyResponse>(
      `/api/mobile/v1/tracks/${encodeURIComponent(id)}/offline-license/verify`,
      {
        method: "POST",
        body: JSON.stringify(license),
      },
    );
  },
  refreshStreamUrl(id: string, url?: string) {
    return apiFetch<{ ok: boolean; streamUrl: string; audioUrl: string; canonicalUrl: string }>(
      "/api/external/refresh-stream",
      {
        method: "POST",
        body: JSON.stringify({ id, url }),
      },
    );
  },
  toggleRepost(id: string) {
    return apiFetch<{ reposted: boolean; repostsCount: number }>(`/api/tracks/${encodeURIComponent(id)}/repost`, { method: "POST" });
  },
  async uploadTrack(formData: FormData) {
    const res = await apiFetch<{ track: Track }>("/api/tracks", { method: "POST", body: formData });
    return { track: normalizeTrack(res.track) };
  },
  async getLyrics(id: string) {
    try {
      const res = await apiFetch<{
        trackId: string;
        source: string;
        lrcContent: string;
        lyricsOffsetMs?: number;
        lines: LyricLine[];
      }>(`/api/tracks/${encodeURIComponent(id)}/lyrics`);
      if (res) {
        let lines = Array.isArray(res.lines) ? res.lines : [];
        if (lines.length === 0 && res.lrcContent) {
          lines = parseLrc(res.lrcContent);
        }
        if (lines.length > 0) {
          return {
            ...res,
            lines,
            lyricsOffsetMs: res.lyricsOffsetMs ?? 0,
          };
        }
      }
    } catch {
      // Offline fallback
    }
    return getFallbackLyrics(id);
  },
  updateLyricsOffset(id: string, offsetMs: number) {
    return apiFetch<{
      trackId: string;
      lyricsOffsetMs: number;
      lines: LyricLine[];
    }>(`/api/tracks/${encodeURIComponent(id)}/lyrics/offset`, {
      method: "POST",
      body: JSON.stringify({ offsetMs }),
    });
  },
  getLyricsSources(id: string) {
    return apiFetch<{
      trackId: string;
      currentSource: string;
      lyricsOffsetMs: number;
      sources: LyricsSourceCandidate[];
    }>(`/api/tracks/${encodeURIComponent(id)}/lyrics/sources`);
  },
  applyLyricsSource(id: string, source: string, lrcContent: string) {
    return apiFetch<{
      trackId: string;
      source: string;
      lrcContent: string;
      lyricsOffsetMs: number;
      lines: LyricLine[];
    }>(`/api/tracks/${encodeURIComponent(id)}/lyrics/apply-source`, {
      method: "POST",
      body: JSON.stringify({ source, lrcContent }),
    });
  },
  saveLyrics(id: string, lrcContent: string, source: "manual" | "lrclib" | "auto-synced" = "manual") {
    return apiFetch<{ trackId: string; source: string; lrcContent: string; lines: LyricLine[] }>(
      `/api/tracks/${encodeURIComponent(id)}/lyrics`,
      { method: "PUT", body: JSON.stringify({ lrcContent, source }) },
    );
  },
  autoFetchLyrics(id: string, params?: { queryTitle?: string; queryArtist?: string; forceRefresh?: boolean; durationSec?: number }) {
    return apiFetch<{
      found: boolean;
      source: string;
      lrcContent: string;
      lines: LyricLine[];
      providerTrackName?: string;
      providerArtistName?: string;
    }>(`/api/tracks/${encodeURIComponent(id)}/lyrics/auto-fetch`, {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  },
  autoSyncPlainLyrics(plainLyrics: string, durationSec: number, title?: string, artist?: string) {
    return apiFetch<{ lrcContent: string; lines: LyricLine[] }>("/api/lyrics/auto-sync", {
      method: "POST",
      body: JSON.stringify({ plainLyrics, durationSec, title, artist }),
    });
  },
  async getComments(trackId: string) {
    try {
      const res = await apiFetch<{ comments: TrackComment[] }>(`/api/tracks/${encodeURIComponent(trackId)}/comments`);
      return res;
    } catch {
      return { comments: [] as TrackComment[] };
    }
  },
  addComment(trackId: string, body: string, timestampSec: number) {
    return apiFetch<{ comment: TrackComment }>(`/api/tracks/${encodeURIComponent(trackId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, timestampSec }),
    });
  },
  async getPlaylists(mine = false) {
    try {
      const suffix = mine ? "" : "?all=true";
      const res = await apiFetch<{ playlists: Playlist[] }>(`/api/mobile/v1/playlists${suffix}`);
      if (res?.playlists && Array.isArray(res.playlists)) {
        const normalized = res.playlists.map(normalizePlaylist);
        if (!mine && normalized.length > 0) {
          writeCatalogCache("playlists", normalized);
        }
        return { playlists: normalized };
      }
    } catch {
      // Offline fallback
    }
    const cachedPlaylists = !mine ? getCachedCatalogPlaylists() : null;
    if (cachedPlaylists) {
      return { playlists: cachedPlaylists };
    }
    return { playlists: FALLBACK_PLAYLISTS.map(normalizePlaylist) };
  },
  async getPlaylist(id: string) {
    try {
      const res = await apiFetch<{ playlist: Playlist; tracks: Track[] }>(`/api/mobile/v1/playlists/${encodeURIComponent(id)}`);
      if (res?.playlist) {
        return {
          playlist: normalizePlaylist(res.playlist),
          tracks: Array.isArray(res.tracks) ? res.tracks.map(normalizeTrack) : [],
        };
      }
    } catch {
      // Fallback
    }
    const pl = FALLBACK_PLAYLISTS.find((p) => p.id === id) || FALLBACK_PLAYLISTS[0];
    const tracks = FALLBACK_TRACKS.slice(0, pl.trackCount || 4);
    return {
      playlist: normalizePlaylist(pl),
      tracks: tracks.map(normalizeTrack),
    };
  },
  createPlaylist(payload: PlaylistCreatePayload) {
    return apiFetch<{ playlist: Playlist }>("/api/mobile/v1/playlists", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updatePlaylist(id: string, payload: PlaylistUpdatePayload) {
    return apiFetch<{ ok: boolean; id: string; title: string; titleFa: string }>(
      `/api/mobile/v1/playlists/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },
  addTrackToPlaylist(playlistId: string, trackId: string) {
    return apiFetch<{ ok: boolean; playlistId: string; trackId: string }>(
      `/api/mobile/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ trackId }),
      },
    );
  },
  removeTrackFromPlaylist(playlistId: string, trackId: string) {
    return apiFetch<{ ok: boolean; playlistId: string; trackId: string }>(
      `/api/mobile/v1/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
      { method: "DELETE" },
    );
  },
  reorderPlaylistTracks(playlistId: string, trackIds: PlaylistTracksReorderPayload["trackIds"]) {
    return apiFetch<{ ok: boolean; playlistId: string; totalReordered: number }>(
      `/api/mobile/v1/playlists/${encodeURIComponent(playlistId)}/tracks/reorder`,
      {
        method: "PUT",
        body: JSON.stringify({ trackIds }),
      },
    );
  },
  deletePlaylist(id: string) {
    return apiFetch<{ ok: boolean; deleted: boolean; id: string }>(
      `/api/mobile/v1/playlists/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },
  async getArtists() {
    try {
      const res = await apiFetch<{ artists: Artist[] }>("/api/artists");
      if (res?.artists && Array.isArray(res.artists)) {
        if (res.artists.length > 0) {
          writeCatalogCache("artists", res.artists);
        }
        return { artists: res.artists };
      }
    } catch {
      // Offline fallback
    }
    const cachedArtists = getCachedCatalogArtists();
    if (cachedArtists) {
      return { artists: cachedArtists };
    }
    return { artists: FALLBACK_ARTISTS };
  },
  async getArtist(id: string) {
    try {
      const res = await apiFetch<{ artist: Artist; tracks: Track[] }>(`/api/artists/${encodeURIComponent(id)}`);
      if (res?.artist) {
        return { artist: res.artist, tracks: res.tracks.map(normalizeTrack) };
      }
    } catch {
      // Fallback
    }
    const artist = FALLBACK_ARTISTS.find((a) => a.id === id) || FALLBACK_ARTISTS[0];
    const tracks = FALLBACK_TRACKS.filter((t) => t.artistId === artist.id);
    return {
      artist,
      tracks: (tracks.length > 0 ? tracks : FALLBACK_TRACKS.slice(0, 3)).map(normalizeTrack),
    };
  },
  toggleFollowArtist(id: string) {
    return apiFetch<{ followed: boolean; followersCount: number }>(`/api/artists/${encodeURIComponent(id)}/follow`, {
      method: "POST",
    });
  },
  async getHistory() {
    try {
      const res = await apiFetch<{ tracks: Track[] }>("/api/history");
      return { tracks: res?.tracks ? res.tracks.map(normalizeTrack) : [] };
    } catch {
      return { tracks: [] as Track[] };
    }
  },
  async me() {
    const hasToken = Boolean(getApiToken() || (await getApiTokenAsync()) || getRefreshToken() || (await getRefreshTokenAsync()));
    if (!hasToken) {
      return { user: null };
    }
    return apiFetch<{ user: User | null }>("/api/mobile/v1/auth/me");
  },
  login(identifier: string, password: string) {
    return apiFetch<AuthResponse>("/api/mobile/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
  },
  register(payload: { username: string; email: string; displayName: string; displayNameFa?: string; password: string }) {
    return apiFetch<AuthResponse>("/api/mobile/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  refresh(refreshTokenValue: string) {
    return apiFetch<TokenRefreshResponse>("/api/mobile/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: refreshTokenValue }),
    });
  },
  logout() {
    return apiFetch<{ ok: boolean }>("/api/mobile/v1/auth/logout", { method: "POST" });
  },
  adminExternalSearch(q: string, source: ExternalMusicSource = "all", limit = 20) {
    const sp = new URLSearchParams({ q, source, limit: String(limit) });
    return apiFetch<{
      query: string;
      source: ExternalMusicSource;
      results: ExternalTrackCandidate[];
      errors: Record<string, string>;
    }>(`/api/admin/external-search?${sp.toString()}`);
  },
  adminExternalResolve(url: string) {
    return apiFetch<{
      audioUrl: string | null;
      coverUrl: string | null;
      title?: string;
      artistName?: string;
      qualityLabel?: string;
    }>(`/api/admin/external-resolve?url=${encodeURIComponent(url)}`);
  },
  adminImportTrack(payload: {
    title: string;
    titleFa?: string;
    artistName: string;
    artistNameFa?: string;
    album?: string;
    albumFa?: string;
    genre?: string;
    mood?: string;
    accentColor?: string;
    audioUrl?: string;
    pageUrl?: string;
    coverUrl?: string;
    durationSec?: number;
    autoFetchLyrics?: boolean;
    lrcContent?: string;
  }) {
    return apiFetch<{ track: Track; lyricsFetched: boolean; lyricsSource: string }>("/api/admin/import-track", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  adminGetTracks(q = "") {
    const sp = q ? `?q=${encodeURIComponent(q)}` : "";
    return apiFetch<{ tracks: Track[]; stats: AdminStats }>(`/api/admin/tracks${sp}`);
  },
  adminUpdateTrack(
    id: string,
    payload: {
      title?: string;
      titleFa?: string;
      artistName?: string;
      artistNameFa?: string;
      album?: string;
      albumFa?: string;
      genre?: string;
      mood?: string;
      accentColor?: string;
    },
  ) {
    return apiFetch<{ track: Track }>(`/api/admin/tracks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  adminDeleteTrack(id: string) {
    return apiFetch<{ deleted: boolean; id: string }>(`/api/admin/tracks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  adminGetProxy() {
    return apiFetch<{ proxy: string }>("/api/admin/settings/proxy");
  },
  adminSaveProxy(proxy: string) {
    return apiFetch<{ success: boolean; proxy: string }>("/api/admin/settings/proxy", {
      method: "POST",
      body: JSON.stringify({ proxy }),
    });
  },
  adminTestProxy(proxy?: string) {
    return apiFetch<{ ok: boolean; message: string; latencyMs?: number }>("/api/admin/settings/proxy/test", {
      method: "POST",
      body: JSON.stringify({ proxy }),
    });
  },
  adminYtDlpSearch(q: string, source: "youtube" | "soundcloud" | "spotify" = "youtube", limit = 15) {
    const sp = new URLSearchParams({ q, source, limit: String(limit) });
    return apiFetch<{ query: string; source: string; results: ExternalTrackCandidate[]; error?: string }>(
      `/api/admin/ytdlp-search?${sp.toString()}`,
    );
  },
  adminYtDlpImport(payload: {
    url: string;
    source?: "youtube" | "soundcloud" | "spotify";
    title?: string;
    titleFa?: string;
    artistName?: string;
    artistNameFa?: string;
    album?: string;
    albumFa?: string;
    genre?: string;
    mood?: string;
    accentColor?: string;
    autoFetchLyrics?: boolean;
    lrcContent?: string;
  }) {
    return apiFetch<{ track: Track; lyricsFetched: boolean; lyricsSource: string }>("/api/admin/ytdlp-import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  adminPreviewResolve(url: string) {
    return apiFetch<{ audioUrl: string | null; isPreview?: boolean; coverUrl?: string; title?: string; artistName?: string }>(
      `/api/admin/preview-resolve?url=${encodeURIComponent(url)}`,
    );
  },
  adminStartImport(payload: { candidate: ExternalTrackCandidate; draft?: Record<string, unknown> }) {
    return apiFetch<{ jobId: string; status: string; job: unknown }>("/api/admin/start-import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  adminGetImportJob(jobId: string) {
    return apiFetch<{
      job: {
        id: string;
        candidateId?: string;
        status: "queued" | "downloading" | "processing" | "lyrics" | "completed" | "error";
        progress: number;
        stageFa: string;
        error?: string;
        track?: Track;
      };
    }>(`/api/admin/import-job/${encodeURIComponent(jobId)}`);
  },
  adminBatchImport(items: Array<{ candidate: ExternalTrackCandidate; draft?: Record<string, unknown> }>) {
    return apiFetch<{ jobs: Array<{ jobId: string; candidateId?: string }>; jobIds: string[]; count: number }>("/api/admin/batch-import", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },

  // Admin User Management
  adminGetUsers(params?: { q?: string; role?: string; limit?: number; offset?: number }) {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.role && params.role !== "all") sp.set("role", params.role);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    return apiFetch<{ users: AdminUser[]; total: number }>(`/api/admin/users${suffix}`);
  },
  adminGetUserDetails(id: string) {
    return apiFetch<AdminUserDetails>(`/api/admin/users/${encodeURIComponent(id)}`);
  },
  adminUpdateUserRole(id: string, role: "user" | "creator" | "admin") {
    return apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  },
  adminUpdateUserStatus(id: string, isActive: boolean) {
    return apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    });
  },
  adminDeleteUser(id: string) {
    return apiFetch<{ deleted: boolean; id: string }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  // Spotify Connect Multi-Device Playback Sync
  async registerDevice(payload: {
    deviceId?: string;
    id?: string;
    name: string;
    type?: "desktop" | "smartphone" | "tablet" | "browser" | "speaker";
    isActive?: boolean;
    brand?: string;
    model?: string;
    osVersion?: string;
    appVersion?: string;
    fcmToken?: string;
  }) {
    const id = payload.id || payload.deviceId || "unknown-device";
    const body = {
      deviceId: id,
      id,
      name: payload.name,
      type: payload.type || "smartphone",
      ...(typeof payload.isActive === "boolean" ? { isActive: payload.isActive } : {}),
      brand: payload.brand || "Android",
      model: payload.model || "Smartphone",
      osVersion: payload.osVersion || "Android",
      appVersion: payload.appVersion || "1.0.0",
      fcmToken: payload.fcmToken,
    };

    try {
      const res = await apiFetch<{
        ok: boolean;
        deviceId: string;
        devices: DeviceInfo[];
        activeDeviceId: string | null;
        state: PlaybackStateSync;
      }>("/api/mobile/v1/connect/devices/register", {
        method: "POST",
        body: JSON.stringify(body),
      }).catch(() =>
        apiFetch<{
          ok: boolean;
          deviceId: string;
          devices: DeviceInfo[];
          activeDeviceId: string | null;
          state: PlaybackStateSync;
        }>("/api/devices/register", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
      return {
        ...res,
        state: res.state
          ? { ...res.state, track: res.state.track ? normalizeTrack(res.state.track) : null }
          : res.state,
      };
    } catch {
      return {
        ok: false,
        deviceId: id,
        devices: [] as DeviceInfo[],
        activeDeviceId: null,
        state: null as unknown as PlaybackStateSync,
      };
    }
  },
  async getDevices(currentDeviceId?: string) {
    const qs = currentDeviceId ? `?currentDeviceId=${encodeURIComponent(currentDeviceId)}` : "";
    try {
      const res = await apiFetch<{
        devices: DeviceInfo[];
        activeDeviceId: string | null;
        state?: PlaybackStateSync;
      }>(`/api/devices${qs}`).catch(() =>
        apiFetch<{
          devices: DeviceInfo[];
          activeDeviceId: string | null;
          state?: PlaybackStateSync;
        }>(`/api/mobile/v1/devices${qs ? qs.replace("currentDeviceId=", "deviceId=") : ""}`)
      );

      let stateRes = res.state ?? null;
      if (!stateRes) {
        const stateData = await apiFetch<{ state: PlaybackStateSync }>(`/api/devices/state${qs}`)
          .catch(() => apiFetch<{ state: PlaybackStateSync }>("/api/mobile/v1/devices/state"))
          .catch(() => null);
        stateRes = stateData?.state ?? null;
      }

      return {
        devices: res.devices || [],
        activeDeviceId: res.activeDeviceId,
        state: stateRes
          ? { ...stateRes, track: stateRes.track ? normalizeTrack(stateRes.track) : null }
          : (null as unknown as PlaybackStateSync),
      };
    } catch {
      return {
        devices: [] as DeviceInfo[],
        activeDeviceId: null,
        state: null as unknown as PlaybackStateSync,
      };
    }
  },
  async unregisterDevice(deviceId: string) {
    return apiFetch<{ ok: boolean; deletedDeviceId: string }>(
      `/api/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    ).catch(() =>
      apiFetch<{ ok: boolean; deletedDeviceId: string }>(
        `/api/mobile/v1/devices/${encodeURIComponent(deviceId)}`,
        { method: "DELETE" },
      )
    );
  },
  async getPlaybackState(currentDeviceId?: string) {
    const qs = currentDeviceId ? `?currentDeviceId=${encodeURIComponent(currentDeviceId)}` : "";
    try {
      const res = await apiFetch<{
        state: PlaybackStateSync;
        devices?: DeviceInfo[];
        activeDeviceId: string | null;
      }>(`/api/devices/state${qs}`).catch(() =>
        apiFetch<{
          state: PlaybackStateSync;
          devices?: DeviceInfo[];
          activeDeviceId: string | null;
        }>(`/api/mobile/v1/devices/state${qs ? qs.replace("currentDeviceId=", "deviceId=") : ""}`)
      );
      return {
        state: res.state
          ? { ...res.state, track: res.state.track ? normalizeTrack(res.state.track) : null }
          : res.state,
        devices: res.devices || [],
        activeDeviceId: res.activeDeviceId,
      };
    } catch {
      const devRes = await api.getDevices(currentDeviceId);
      return {
        state: devRes.state,
        devices: devRes.devices,
        activeDeviceId: devRes.activeDeviceId,
      };
    }
  },
  async updatePlaybackState(payload: {
    deviceId: string;
    trackId?: string | null;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
    volume?: number;
    repeat?: "off" | "all" | "one";
    shuffle?: boolean;
    takeover?: boolean;
  }) {
    const body = {
      deviceId: payload.deviceId,
      activeDeviceId: payload.deviceId,
      trackId: payload.trackId,
      isPlaying: payload.isPlaying,
      currentTime: payload.currentTime,
      duration: payload.duration,
      volume: payload.volume,
      repeat: payload.repeat,
      repeatMode: payload.repeat,
      shuffle: payload.shuffle,
      takeover: payload.takeover,
    };
    try {
      const res = await apiFetch<{ ok: boolean; state: PlaybackStateSync }>("/api/devices/state", {
        method: "PUT",
        body: JSON.stringify(body),
      }).catch(() =>
        apiFetch<{ ok: boolean; state: PlaybackStateSync }>("/api/mobile/v1/devices/state", {
          method: "PUT",
          body: JSON.stringify(body),
        })
      );
      return {
        ...res,
        state: res.state
          ? { ...res.state, track: res.state.track ? normalizeTrack(res.state.track) : null }
          : res.state,
      };
    } catch {
      return {
        ok: false,
        state: null as unknown as PlaybackStateSync,
      };
    }
  },
  async sendDeviceCommand(payload: {
    command: string;
    payload?: unknown;
    fromDeviceId?: string;
    targetDeviceId?: string;
  }) {
    const rawCmd = (payload.command || "").trim().toUpperCase();
    let normalizedCmd = rawCmd.toLowerCase();
    const rawParams = (typeof payload.payload === "object" && payload.payload !== null
      ? { ...(payload.payload as Record<string, unknown>) }
      : { value: payload.payload }) as Record<string, unknown>;

    const params: Record<string, unknown> = {
      ...rawParams,
      fromDeviceId: payload.fromDeviceId,
    };

    if (rawCmd === "PLAY_TRACK") {
      normalizedCmd = "play";
      const trk = rawParams.track as { id?: string } | undefined;
      if (trk?.id) params.trackId = trk.id;
      else if (typeof rawParams.trackId === "string") params.trackId = rawParams.trackId;
    } else if (rawCmd === "SET_VOLUME" || rawCmd === "VOLUME") {
      normalizedCmd = "volume";
      if (typeof rawParams.volume === "number") {
        params.volume = rawParams.volume;
      }
    } else if (rawCmd === "SEEK") {
      normalizedCmd = "seek";
      if (typeof rawParams.seconds === "number") {
        params.positionSec = rawParams.seconds;
        params.seconds = rawParams.seconds;
      }
    } else if (rawCmd === "TOGGLE_PLAY") {
      normalizedCmd = "toggle_play";
    } else if (rawCmd === "PREV") {
      normalizedCmd = "prev";
    } else if (rawCmd === "NEXT") {
      normalizedCmd = "next";
    } else if (rawCmd === "SET_REPEAT" || rawCmd === "REPEAT") {
      normalizedCmd = "repeat";
    } else if (rawCmd === "SET_SHUFFLE" || rawCmd === "SHUFFLE") {
      normalizedCmd = "shuffle";
    } else if (rawCmd === "TRANSFER" || rawCmd === "TRANSFER_PLAYBACK") {
      normalizedCmd = "transfer";
    }

    try {
      const res = await apiFetch<{
        ok: boolean;
        command?: string;
        activeDeviceId?: string;
        targetDeviceId?: string;
        params?: unknown;
        state?: PlaybackStateSync;
        devices?: DeviceInfo[];
        transferredTo?: string;
      }>("/api/mobile/v1/connect/command", {
        method: "POST",
        body: JSON.stringify({
          command: normalizedCmd,
          targetDeviceId: payload.targetDeviceId,
          fromDeviceId: payload.fromDeviceId,
          params,
          payload: params,
        }),
      }).catch(() =>
        apiFetch<{
          ok: boolean;
          command?: string;
          activeDeviceId?: string;
          state?: PlaybackStateSync;
          devices?: DeviceInfo[];
          transferredTo?: string;
        }>("/api/devices/command", {
          method: "POST",
          body: JSON.stringify({
            command: rawCmd,
            payload: params,
            fromDeviceId: payload.fromDeviceId,
            targetDeviceId: payload.targetDeviceId,
          }),
        })
      );

      return {
        ok: res.ok,
        command: res.command || payload.command,
        activeDeviceId: ("transferredTo" in res && typeof res.transferredTo === "string" ? res.transferredTo : undefined) ||
          ("activeDeviceId" in res && typeof res.activeDeviceId === "string" ? res.activeDeviceId : undefined) ||
          payload.targetDeviceId ||
          null,
        state: res.state
          ? { ...res.state, track: res.state.track ? normalizeTrack(res.state.track) : null }
          : (null as unknown as PlaybackStateSync),
        devices: ("devices" in res ? (res.devices as DeviceInfo[]) : undefined),
      };
    } catch {
      return {
        ok: false,
        command: payload.command,
        activeDeviceId: payload.targetDeviceId || null,
        state: null as unknown as PlaybackStateSync,
        devices: undefined as DeviceInfo[] | undefined,
      };
    }
  },
  async getBootstrap(): Promise<BootstrapSyncData> {
    const res = await apiFetch<BootstrapSyncData>("/api/mobile/v1/sync/bootstrap");
    return {
      ...res,
      likedTracks: (res.likedTracks || []).map(normalizeTrack),
      recentHistory: (res.recentHistory || []).map(normalizeTrack),
      featuredTracks: (res.featuredTracks || []).map(normalizeTrack),
      playlists: (res.playlists || []).map(normalizePlaylist),
      featuredPlaylists: (res.featuredPlaylists || []).map(normalizePlaylist),
      playbackState: res.playbackState
        ? {
            ...res.playbackState,
            track: res.playbackState.track ? normalizeTrack(res.playbackState.track) : null,
          }
        : res.playbackState,
    };
  },
  getDeltaSync(since: number) {
    return apiFetch<DeltaSyncResponse>(`/api/mobile/v1/sync/delta?since=${since}`);
  },
  async getUserSync(): Promise<UserSyncData> {
    try {
      const boot = await api.getBootstrap();
      if (boot) {
        return {
          user: boot.user,
          likedTrackIds: boot.likedTrackIds || [],
          likedTracks: boot.likedTracks || [],
          repostedTrackIds: [],
          followedArtistIds: [],
          playlists: boot.playlists || [],
          recentHistory: boot.recentHistory || [],
          activeDevices: boot.devices || [],
          devices: boot.devices || [],
          featuredTracks: boot.featuredTracks || [],
          featuredPlaylists: boot.featuredPlaylists || [],
          playbackState: boot.playbackState,
          preferences: {},
          serverTime: boot.serverTime,
          syncVersion: boot.syncVersion,
        };
      }
    } catch {
      // Fallback
    }

    const hasToken = Boolean(getApiToken() || (await getApiTokenAsync()));
    if (hasToken) {
      try {
        const res = await apiFetch<UserSyncData>("/api/user/sync");
        return {
          ...res,
          likedTracks: (res.likedTracks || []).map(normalizeTrack),
          recentHistory: (res.recentHistory || []).map(normalizeTrack),
          playlists: (res.playlists || []).map(normalizePlaylist),
          playbackState: res.playbackState
            ? {
                ...res.playbackState,
                track: res.playbackState.track ? normalizeTrack(res.playbackState.track) : null,
              }
            : res.playbackState,
        };
      } catch {
        // Fallback to offline defaults
      }
    }

    return {
      user: null,
      likedTrackIds: [],
      likedTracks: [],
      repostedTrackIds: [],
      followedArtistIds: [],
      playlists: [],
      recentHistory: [],
      activeDevices: [],
      devices: [],
      featuredTracks: [],
      featuredPlaylists: [],
      playbackState: null as unknown as PlaybackStateSync,
      preferences: {},
      serverTime: Date.now(),
      syncVersion: 1,
    };
  },
  updateUserProfile(payload: UserProfileUpdatePayload) {
    return apiFetch<{ user: User }>("/api/user/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  changePassword(payload: ChangePasswordPayload) {
    return apiFetch<{ ok: boolean; message: string; messageFa: string }>("/api/user/change-password", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getUserPreferences() {
    return apiFetch<{ preferences: Record<string, unknown> }>("/api/user/preferences");
  },
  updateUserPreferences(preferences: Record<string, unknown>) {
    return apiFetch<{ ok: boolean; preferences: Record<string, unknown> }>("/api/user/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    });
  },
  async registerMobileDevice(payload: MobileDeviceRegistrationPayload): Promise<{ ok: boolean; deviceId: string }> {
    try {
      const res = await api.registerDevice({
        deviceId: payload.id,
        name: payload.name,
        type: payload.type,
        brand: payload.brand,
        model: payload.model,
        osVersion: payload.osVersion,
        appVersion: payload.appVersion,
        fcmToken: payload.fcmToken,
      });
      return { ok: res.ok, deviceId: res.deviceId };
    } catch {
      return apiFetch<{ ok: boolean; deviceId: string }>("/api/mobile/devices/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  },
  async mobileHeartbeat(payload: {
    deviceId: string;
    trackId?: string | null;
    isPlaying?: boolean;
    currentTime?: number;
  }) {
    try {
      const res = await apiFetch<{ ok: boolean; isActivePlayer?: boolean; activeDeviceId?: string | null; timestamp: number }>(
        "/api/mobile/v1/connect/heartbeat",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ).catch(() =>
        apiFetch<{ ok: boolean; isActivePlayer?: boolean; activeDeviceId?: string | null; timestamp: number }>(
          "/api/mobile/v1/devices/heartbeat",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
        )
      );
      return { ok: res.ok, isActivePlayer: res.isActivePlayer, activeDeviceId: res.activeDeviceId, timestamp: res.timestamp };
    } catch {
      const res = await apiFetch<{ ok: boolean; timestamp: number }>("/api/mobile/devices/heartbeat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { ok: res.ok, timestamp: res.timestamp };
    }
  },
  getMobileStatus() {
    return apiFetch<MobileStatus>("/api/mobile/status");
  },
  getMobileHealth() {
    return apiFetch<MobileHealthDiagnostic>("/api/mobile/health");
  },
  performSecurityHandshake(deviceId?: string) {
    const base = getBackendUrl();
    return performClientHandshake(base, deviceId);
  },
  async sendEncryptedEnvelope<T = unknown>(action: string, data: unknown): Promise<T> {
    const envelope = await encryptPayload({ action, data });
    const resEnvelope = await apiFetch<EncryptedEnvelope>("/api/mobile/sec/envelope", {
      method: "POST",
      body: JSON.stringify(envelope),
    });
    return decryptPayload<T>(resEnvelope);
  },
  verifyTransportSignature(payload: {
    method: string;
    path: string;
    timestamp: number;
    nonce: string;
    body?: string;
    signature: string;
  }) {
    return apiFetch<{ valid: boolean; serverTime: number; reason?: string }>("/api/mobile/sec/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

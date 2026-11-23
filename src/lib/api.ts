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
  setMediaAuthToken,
  setServerConnectivityStatus,
  MOBILE_V1_PREFIX,
} from "./mobileBackend";
import {
  APP_VERSION,
  MIN_SERVER_SUPPORTED_VERSION,
  triggerAppUpdateRequired,
} from "./appVersion";
import { reportNetworkFailure, reportNetworkSuccess } from "./networkResilience";
import {
  FALLBACK_ARTISTS,
  FALLBACK_PLAYLISTS,
  FALLBACK_TRACKS,
  getFallbackLyrics,
} from "./fallbackSeedData";
import { secureStorage } from "./secureStorage";
import { parseLrc } from "./lrc";
import { filterSensitiveTracks, isSearchQuerySensitive } from "./contentFilter";
import {
  calculateTitleSimilarity,
  extractCleanTitleAndArtist,
  fetchLrclibDirectly,
} from "./lyricsCleaner";
import {
  encryptPayload,
  decryptPayload,
  performClientHandshake,
} from "./mobileCrypto";
import { getCachedUserSync, queueOfflineLike } from "./mobileSync";
import { isNativeAudioAvailable } from "./nativeAudioBridge";

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

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

  const watchMatch = str.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[&?.\/]|$)/i);
  if (watchMatch) return watchMatch[1];

  const viMatch = str.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})(?:[\/?.]|$)/i);
  if (viMatch) return viMatch[1];

  const extMatch = str.match(/(?:^|[?&=/])(?:ext[-_])?(?:youtube[-_]|yt[-_]|spotify[-_])+([a-zA-Z0-9_-]{11})(?:[&?.\/]|$)/i);
  if (extMatch) return extMatch[1];

  // Check embedded url parameter e.g. /api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D...
  const urlParamMatch = str.match(/[?&]url=([^&]+)/i);
  if (urlParamMatch) {
    let extracted = urlParamMatch[1];
    try {
      extracted = decodeURIComponent(extracted);
    } catch {}
    if (extracted && extracted !== str) {
      const nestedId = extractYouTubeIdClient(extracted);
      if (nestedId) return nestedId;
    }
  }

  // Check embedded id parameter e.g. /api/stream/external?id=ext-youtube-...
  const idParamMatch = str.match(/[?&]id=([^&]+)/i);
  if (idParamMatch) {
    let extracted = idParamMatch[1];
    try {
      extracted = decodeURIComponent(extracted);
    } catch {}
    if (extracted && extracted !== str) {
      const nestedId = extractYouTubeIdClient(extracted);
      if (nestedId) return nestedId;
    }
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }

  return null;
}

/**
 * Checks whether a track object or ID string represents an external media resource
 * (YouTube, SoundCloud, Spotify, or proxy stream URL).
 */
export function isExternalTrack(trackOrId: Track | string | null | undefined): boolean {
  if (!trackOrId) return false;
  if (typeof trackOrId === "object") {
    const t = trackOrId;
    if (
      t.source === "youtube" ||
      t.source === "soundcloud" ||
      t.source === "spotify" ||
      t.source === "external"
    ) {
      return true;
    }
    if (
      typeof t.audioUrl === "string" &&
      (t.audioUrl.includes("/api/stream/external") ||
        t.audioUrl.includes("/api/external/stream") ||
        t.audioUrl.includes("googlevideo.com") ||
        t.audioUrl.includes("sndcdn.com") ||
        t.audioUrl.includes("spotifycdn.com"))
    ) {
      return true;
    }
    return isExternalTrack(t.id) || (Boolean(t.pageUrl) && isExternalTrack(t.pageUrl));
  }

  const str = trackOrId.trim();
  if (!str) return false;

  if (
    str.startsWith("ext-") ||
    str.startsWith("youtube-") ||
    str.startsWith("soundcloud-") ||
    str.startsWith("spotify-") ||
    str.startsWith("yt-") ||
    str.startsWith("sc-")
  ) {
    return true;
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return true;
  }

  if (
    str.includes("/api/stream/external") ||
    str.includes("/api/external/stream") ||
    str.includes("watch?v=") ||
    str.includes("youtu.be/") ||
    str.includes("soundcloud.com") ||
    str.includes("open.spotify.com") ||
    str.includes("spotify:track:") ||
    /(?:youtube\.com|youtu\.be|soundcloud\.com|spotify\.com|spotify:)/i.test(str)
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts the canonical original external media / page URL from any raw URL or track ID.
 * Unpacks proxy URLs (/api/stream/external?url=...) and canonicalizes YouTube / SoundCloud / Spotify.
 */
export function extractCanonicalExternalUrl(inputUrl?: string | null, trackId?: string | null): string {
  const ytId = extractYouTubeIdClient(inputUrl || "") || extractYouTubeIdClient(trackId || "");
  if (ytId) {
    return `https://www.youtube.com/watch?v=${ytId}`;
  }
  if (!inputUrl && !trackId) return "";

  let candidate = (inputUrl || "").trim();
  if (!candidate && trackId) {
    candidate = trackId.trim();
  }

  // Check if candidate contains an embedded url= parameter (e.g. /api/stream/external?url=...)
  const urlParamMatch = candidate.match(/[?&]url=([^&]+)/i);
  if (urlParamMatch) {
    let extracted = urlParamMatch[1];
    try {
      extracted = decodeURIComponent(extracted);
    } catch {}
    const nestedYt = extractYouTubeIdClient(extracted);
    if (nestedYt) return `https://www.youtube.com/watch?v=${nestedYt}`;
    if (extracted.startsWith("http://") || extracted.startsWith("https://")) {
      return extracted;
    }
  }

  // SoundCloud canonicalization: support numeric track IDs (api.soundcloud.com/tracks/...) and slugs
  if (
    candidate.includes("soundcloud") ||
    candidate.startsWith("ext-sc-") ||
    candidate.startsWith("sc-") ||
    (trackId && (trackId.includes("soundcloud") || trackId.startsWith("ext-sc-") || trackId.startsWith("sc-")))
  ) {
    const rawTarget = candidate || trackId || "";
    if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://")) {
      return rawTarget;
    }
    const slug = rawTarget.replace(/^(?:ext-)?(?:soundcloud|sc)-/, "").trim();
    if (slug) {
      if (/^\d+$/.test(slug)) {
        return `https://api.soundcloud.com/tracks/${slug}`;
      }
      return `https://soundcloud.com/${slug}`;
    }
  }

  // Spotify canonicalization: support open.spotify.com and track IDs
  if (
    candidate.includes("spotify") ||
    (trackId && trackId.includes("spotify"))
  ) {
    const rawTarget = candidate || trackId || "";
    const spotifyUrlMatch = rawTarget.match(/https?:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i);
    if (spotifyUrlMatch) {
      return `https://open.spotify.com/track/${spotifyUrlMatch[1]}`;
    }
    const spotifyUriMatch = rawTarget.match(/spotify:track:([a-zA-Z0-9]+)/i);
    if (spotifyUriMatch) {
      return `https://open.spotify.com/track/${spotifyUriMatch[1]}`;
    }
    const slug = rawTarget.replace(/^(?:ext-)?spotify-/, "").trim();
    if (slug && /^[a-zA-Z0-9]{16,32}$/.test(slug)) {
      return `https://open.spotify.com/track/${slug}`;
    }
  }

  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }

  return candidate;
}

/**
 * In-memory cache for recent external tracks discovered via search or playback.
 */
export const externalTracksCache = new Map<string, Track>();
const streamResolutionCache = new Map<string, { track: Track; resolvedAt: number }>();
const STREAM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generates synthetic smooth waveform bars for external tracks when missing.
 */
export function generateExternalWaveform(seed: string): number[] {
  const bars: number[] = [];
  let h = 0.5;
  for (let i = 0; i < 64; i++) {
    const charCode = seed.charCodeAt(i % seed.length) || 42;
    const delta = ((charCode * 17 + i * 31) % 100) / 100 - 0.5;
    h = Math.max(0.15, Math.min(0.95, h + delta * 0.4));
    bars.push(Math.round(h * 100) / 100);
  }
  return bars;
}

/**
 * Synthesizes a valid, fully formed external Track object from an external ID.
 */
export function synthesizeExternalTrack(id: string, partial?: Partial<Track>): Track {
  const cleanId = id.trim();
  let source: "youtube" | "soundcloud" | "spotify" = "youtube";
  if (cleanId.includes("soundcloud") || cleanId.startsWith("ext-sc-") || cleanId.startsWith("sc-")) {
    source = "soundcloud";
  } else if (cleanId.includes("spotify")) {
    source = "spotify";
  }

  const ytId = extractYouTubeIdClient(cleanId) || extractYouTubeIdClient(partial?.pageUrl || "") || extractYouTubeIdClient(partial?.audioUrl || "");
  const canonical = ytId
    ? `https://www.youtube.com/watch?v=${ytId}`
    : extractCanonicalExternalUrl(partial?.pageUrl || partial?.audioUrl, id);

  const accentColor = source === "youtube" ? "#EF4444" : source === "soundcloud" ? "#F97316" : "#1DB954";
  const defaultTitle = source === "youtube" ? "YouTube Music" : source === "soundcloud" ? "SoundCloud Track" : "Spotify Stream";
  const defaultArtist = source === "youtube" ? "YouTube" : source === "soundcloud" ? "SoundCloud" : "Spotify";

  const directCover = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : "";
  const coverUrl = directCover
    ? `/api/stream/external-cover?url=${encodeURIComponent(directCover)}&id=${encodeURIComponent(cleanId)}`
    : partial?.coverUrl || (source === "youtube"
        ? "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80"
        : source === "soundcloud"
          ? "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80"
          : "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80");

  const rawTitle = partial?.title || defaultTitle;
  const rawArtist = partial?.artistName || defaultArtist;

  const audioUrl =
    partial?.audioUrl && !partial.audioUrl.includes("fallback-preview.mp3")
      ? partial.audioUrl
      : `/api/stream/external?url=${encodeURIComponent(canonical || cleanId)}&id=${encodeURIComponent(cleanId)}&title=${encodeURIComponent(rawTitle)}&artist=${encodeURIComponent(rawArtist)}&fastStart=true&appVersion=${APP_VERSION}`;

  const track: Track = {
    id: cleanId,
    title: partial?.title || defaultTitle,
    titleFa: partial?.titleFa || partial?.title || defaultTitle,
    artistId: partial?.artistId || `ext-artist-${source}`,
    artistName: partial?.artistName || defaultArtist,
    artistNameFa: partial?.artistNameFa || partial?.artistName || defaultArtist,
    artistAvatarColor: accentColor,
    album: partial?.album || (source === "youtube" ? "YouTube Audio" : source === "soundcloud" ? "SoundCloud" : "Spotify"),
    albumFa: partial?.albumFa || (source === "youtube" ? "صوتی یوتیوب" : source === "soundcloud" ? "ساندکلود" : "اسپاتیفای"),
    genre: partial?.genre || (source === "youtube" ? "YouTube Stream" : source === "soundcloud" ? "SoundCloud Stream" : "Spotify Stream"),
    mood: partial?.mood || "Energetic",
    durationSec: partial?.durationSec || 210,
    audioUrl: resolveMediaUrl(audioUrl),
    coverUrl: resolveMediaUrl(coverUrl),
    accentColor,
    waveform: generateExternalWaveform(cleanId + (partial?.title || defaultTitle)),
    hasLyrics: false,
    lyricsSource: "none",
    lyricsOffsetMs: 0,
    playsCount: 0,
    likesCount: 0,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: null,
    createdAt: new Date().toISOString(),
    source,
    pageUrl: canonical || undefined,
    qualityLabel: source === "youtube" ? "YouTube High" : source === "soundcloud" ? "SoundCloud HQ" : "Spotify Stream",
    ...partial,
  };

  externalTracksCache.set(cleanId, track);
  return track;
}

/**
 * Resolves a Spotify track to a playable stream by mapping title & artist to a matching YouTube stream.
 * If the track metadata is synthetic or generic, queries Spotify oEmbed to discover real track name and artwork.
 */
export async function resolveSpotifyTrackStream(track: Track): Promise<Track> {
  if (track.source !== "spotify") return track;

  // Check in-memory stream resolution cache
  const cachedStream = streamResolutionCache.get(track.id);
  if (cachedStream && Date.now() - cachedStream.resolvedAt < STREAM_CACHE_TTL_MS) {
    return cachedStream.track;
  }

  // If already mapped to a verified YouTube stream proxy
  if (
    track.audioUrl &&
    track.audioUrl.includes("/api/stream/external") &&
    track.pageUrl &&
    (track.pageUrl.includes("youtube.com") || track.pageUrl.includes("youtu.be"))
  ) {
    streamResolutionCache.set(track.id, { track, resolvedAt: Date.now() });
    return track;
  }

  let effectiveTitle = track.title;
  const effectiveArtist = track.artistName;
  let effectiveCover = track.coverUrl;

  const isInitiallyGenericTitle =
    !effectiveTitle ||
    effectiveTitle === "External Track" ||
    effectiveTitle === "Spotify Stream" ||
    effectiveTitle === "Spotify Track" ||
    effectiveTitle.startsWith("Track ") ||
    effectiveTitle.startsWith("ext-spotify-") ||
    effectiveTitle.startsWith("spotify-");
  const isInitiallyGenericArtist =
    !effectiveArtist || effectiveArtist === "Spotify Artist" || effectiveArtist === "Artist";

  // Try extracting Spotify track URL to query Spotify oEmbed
  let spotifyTrackUrl = "";
  if (track.pageUrl && track.pageUrl.includes("open.spotify.com/track/")) {
    spotifyTrackUrl = track.pageUrl;
  } else {
    const rawId = track.id.replace(/^(?:ext-)?(?:spotify-)?/, "");
    if (/^[a-zA-Z0-9]{16,32}$/.test(rawId)) {
      spotifyTrackUrl = `https://open.spotify.com/track/${rawId}`;
    }
  }

  let foundOembedTitle = false;
  if (spotifyTrackUrl && (isInitiallyGenericTitle || isInitiallyGenericArtist)) {
    try {
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyTrackUrl)}`);
      if (oembedRes.ok) {
        const odata = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
        if (odata.title) {
          effectiveTitle = odata.title;
          foundOembedTitle = true;
          if (odata.thumbnail_url) {
            effectiveCover = odata.thumbnail_url;
          }
        }
      }
    } catch {}
  }

  const queryParts = [
    effectiveArtist && !isInitiallyGenericArtist ? effectiveArtist : "",
    effectiveTitle && (!isInitiallyGenericTitle || foundOembedTitle) ? effectiveTitle : "",
  ].filter(Boolean);
  const query = queryParts.join(" ").replace(/Spotify\s*Stream/i, "").trim() || effectiveTitle;
  if (!query) return track;

  try {
    const searchRes = await api.searchExternal(query, "youtube", 3);
    if (searchRes.results && searchRes.results.length > 0) {
      const bestMatch = searchRes.results[0];
      const resolved: Track = {
        ...track,
        title: foundOembedTitle || !isInitiallyGenericTitle ? effectiveTitle : bestMatch.title,
        artistName: effectiveArtist && !isInitiallyGenericArtist ? effectiveArtist : bestMatch.artistName,
        coverUrl: effectiveCover && !effectiveCover.includes("unsplash") ? effectiveCover : bestMatch.coverUrl,
        audioUrl: bestMatch.audioUrl,
        pageUrl: bestMatch.pageUrl || track.pageUrl,
        qualityLabel: "Spotify High",
        durationSec: bestMatch.durationSec || track.durationSec,
        waveform: bestMatch.waveform || track.waveform,
      };
      externalTracksCache.set(track.id, resolved);
      streamResolutionCache.set(track.id, { track: resolved, resolvedAt: Date.now() });
      return resolved;
    }
  } catch {}

  return track;
}

/**
 * Resolves SoundCloud track metadata if generic via SoundCloud oEmbed.
 */
export async function resolveSoundCloudTrackStream(track: Track): Promise<Track> {
  if (track.source !== "soundcloud") return track;
  const isGeneric =
    !track.title ||
    track.title === "External Track" ||
    track.title.startsWith("Track ") ||
    track.artistName === "SoundCloud Artist" ||
    track.artistName === "Artist";

  if (!isGeneric) return track;

  const targetUrl = track.pageUrl || (track.audioUrl ? extractCanonicalExternalUrl(track.audioUrl, track.id) : "");
  if (targetUrl && targetUrl.includes("soundcloud.com/")) {
    try {
      const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(targetUrl)}`);
      if (res.ok) {
        const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        const resolved: Track = {
          ...track,
          title: data.title || track.title,
          artistName: data.author_name || track.artistName,
          coverUrl: data.thumbnail_url || track.coverUrl,
        };
        externalTracksCache.set(track.id, resolved);
        return resolved;
      }
    } catch {}
  }
  return track;
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
  setMediaAuthToken(token);
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
  if (authToken) setMediaAuthToken(authToken);
  return authToken;
}

export async function getApiTokenAsync(): Promise<string | null> {
  if (authToken) return authToken;
  authToken = await secureStorage.getItem("soundify_token");
  if (authToken) setMediaAuthToken(authToken);
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
          "X-App-Version": APP_VERSION,
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
  headers.set("X-App-Version", APP_VERSION);
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
    const isExternalLongOp =
      path.includes("/api/external/") ||
      path.includes("/api/mobile/v1/external") ||
      path.includes("/api/mobile/v1/youtube") ||
      path.includes("/api/mobile/v1/soundcloud") ||
      path.includes("/api/mobile/v1/spotify") ||
      path.includes("/api/youtube") ||
      path.includes("/api/soundcloud") ||
      path.includes("/api/spotify") ||
      path.includes("/api/stream/") ||
      path.includes("/api/admin/external") ||
      path.includes("/api/admin/ytdlp");
    const defaultTimeout = isTestEnv ? 2000 : isExternalLongOp ? 35000 : 8500;
    timeoutId = setTimeout(() => controller.abort(), defaultTimeout);
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
        let errCode: string | undefined;
        let errData: unknown;
        try {
          const data = (await res.json()) as { error?: string; errorFa?: string; errorEn?: string; code?: string; message?: string; minSupportedVersion?: string };
          errData = data;
          errCode = data.code;
          errMsg = data.message || data.error || data.errorFa || errMsg;
        } catch {
          // ignore
        }

        if (res.status === 426 || errCode === "APP_UPDATE_REQUIRED") {
          const typedData = errData as { error?: string; errorFa?: string; errorEn?: string; code?: string; message?: string; minSupportedVersion?: string } | undefined;
          triggerAppUpdateRequired({
            minSupportedVersion: typedData?.minSupportedVersion || MIN_SERVER_SUPPORTED_VERSION,
            message: errMsg,
            messageFa: typedData?.errorFa || typedData?.message,
            messageEn: typedData?.errorEn || typedData?.message,
          });
        }

        throw new ApiError(errMsg, res.status, errCode, errData);
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
    if (params?.q && isSearchQuerySensitive(params.q)) {
      return { tracks: [] };
    }
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
        let filtered = filterSensitiveTracks(normalized);
        if (params?.liked) {
          filtered = filtered.filter((t) => Boolean(t.likedByMe));
        }
        if (params?.reposted) {
          filtered = filtered.filter((t) => Boolean(t.repostedByMe));
        }
        if (!suffix && filtered.length > 0) {
          writeCatalogCache("tracks", filtered);
        }
        return { tracks: filtered };
      }
    } catch {
      // Backend unreachable or offline: try cached live server catalog before bundled fallback
    }

    const cachedLiveTracks = !params?.q && (!params?.genre || params.genre === "all") && (!params?.mood || params.mood === "all") && !params?.liked && !params?.reposted
      ? getCachedCatalogTracks()
      : null;
    if (cachedLiveTracks) {
      return { tracks: filterSensitiveTracks(cachedLiveTracks) };
    }

    let filtered = [...FALLBACK_TRACKS];
    if (params?.liked) {
      filtered = filtered.filter((t) => Boolean(t.likedByMe));
    }
    if (params?.reposted) {
      filtered = filtered.filter((t) => Boolean(t.repostedByMe));
    }
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
    const filteredTracks = filterSensitiveTracks(filtered);
    return { tracks: filteredTracks.map(normalizeTrack) };
  },
  async searchExternal(
    q: string,
    source: "all" | "youtube" | "soundcloud" | "spotify" = "all",
    limit = 32,
  ): Promise<{
    query: string;
    source: string;
    results: Track[];
    total: number;
    error?: string;
    code?: string;
  }> {
    const cleanQ = q.trim();
    if (!cleanQ || cleanQ.length < 2) {
      return { query: q, source, results: [], total: 0 };
    }

    // Gracefully filter out politically sensitive keywords to protect user & app owner
    if (isSearchQuerySensitive(cleanQ)) {
      return { query: q, source, results: [], total: 0 };
    }

    // Direct Spotify Track URL resolution: fetch metadata via Spotify oEmbed and map to YouTube
    let effectiveQuery = cleanQ;
    let spotifyTitle: string | null = null;
    let spotifyCover: string | null = null;
    const isSpotifyUrl = /https?:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i.test(cleanQ);

    if (isSpotifyUrl) {
      try {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanQ)}`;
        const oembedRes = await fetch(oembedUrl);
        if (oembedRes.ok) {
          const odata = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
          if (odata.title) {
            spotifyTitle = odata.title;
            effectiveQuery = odata.title;
            spotifyCover = odata.thumbnail_url || null;
          }
        }
      } catch {}
    }

    // Re-check after Spotify metadata resolution
    if (isSearchQuerySensitive(effectiveQuery)) {
      return { query: q, source, results: [], total: 0 };
    }

    const isBlockingAccessOrVersionErr = (err: unknown): boolean =>
      (err instanceof ApiError && (err.status === 403 || err.status === 426 || err.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" || err.code === "APP_UPDATE_REQUIRED")) ||
      (err as { code?: string })?.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" ||
      (err as { code?: string })?.code === "APP_UPDATE_REQUIRED" ||
      String(err).includes("GLOBAL_SEARCH_ACCESS_REQUIRED") ||
      String(err).includes("APP_UPDATE_REQUIRED");

    try {
      const targetSource = isSpotifyUrl ? "youtube" : source;
      const backendLimit = Math.max(8, Math.min(limit, 32));
      const useNativeAudio = isNativeAudioAvailable();

      const normalizeExternalResults = (items: Track[], forcedSourceOverride?: "youtube" | "soundcloud" | "spotify"): Track[] => {
        const normalized = items.map((tr) => {
          const norm = normalizeTrack(tr);
          if (norm.audioUrl && norm.audioUrl.includes("/api/stream/external")) {
            if (useNativeAudio) {
              norm.audioUrl = norm.audioUrl
                .replace(/([?&])fastStart=[^&]*&?/gi, "$1")
                .replace(/[?&]$/, "")
                .replace(/\?&/, "?");
            } else if (!norm.audioUrl.includes("fastStart=")) {
              norm.audioUrl = `${norm.audioUrl}${norm.audioUrl.includes("?") ? "&" : "?"}fastStart=true`;
            }
          }
          if (source === "spotify" || forcedSourceOverride === "spotify" || (isSpotifyUrl && spotifyTitle)) {
            norm.source = "spotify";
            norm.album = "Spotify";
            norm.albumFa = "اسپاتیفای";
            norm.qualityLabel = "Spotify High";
            if (isSpotifyUrl && spotifyCover && (!norm.coverUrl || norm.coverUrl.includes("unsplash"))) {
              norm.coverUrl = spotifyCover;
            }
          }
          externalTracksCache.set(norm.id, norm);
          return norm;
        });
        return filterSensitiveTracks(normalized);
      };

      type ExternalSearchPayload = {
        query: string;
        source: string;
        results: Track[];
        total: number;
        error?: string;
      };

      const fetchSourceBatch = (qStr: string, src: string, lim: number) => {
        const params = new URLSearchParams({
          q: qStr,
          source: src,
          limit: String(lim),
        });
        return apiFetch<ExternalSearchPayload>(`/api/external/search?${params.toString()}`);
      };

      let res: ExternalSearchPayload | undefined;

      // Parallel multi-provider fan-out for "all" searches when >20 results requested
      if (targetSource === "all" && !isSpotifyUrl && limit > 20) {
        const settled = await Promise.allSettled([
          fetchSourceBatch(effectiveQuery, "youtube", 32),
          fetchSourceBatch(effectiveQuery, "soundcloud", 32),
          fetchSourceBatch(effectiveQuery, "spotify", 16),
        ]);

        for (const item of settled) {
          if (item.status === "rejected" && isBlockingAccessOrVersionErr(item.reason)) {
            throw item.reason;
          }
        }

        const ytItems = settled[0].status === "fulfilled" && Array.isArray(settled[0].value.results) ? settled[0].value.results : [];
        const scItems = settled[1].status === "fulfilled" && Array.isArray(settled[1].value.results) ? settled[1].value.results : [];
        const spItems = settled[2].status === "fulfilled" && Array.isArray(settled[2].value.results) ? normalizeExternalResults(settled[2].value.results, "spotify") : [];

        const merged: Track[] = [];
        const seenKeys = new Set<string>();
        const pushUnique = (tr: Track) => {
          const canonPage = (tr.pageUrl || "").split("?")[0].toLowerCase();
          if (seenKeys.has(tr.id) || (canonPage && seenKeys.has(canonPage))) return;
          seenKeys.add(tr.id);
          if (canonPage) seenKeys.add(canonPage);
          merged.push(tr);
        };

        const maxLen = Math.max(ytItems.length, scItems.length, spItems.length);
        for (let i = 0; i < maxLen; i++) {
          if (ytItems[i]) pushUnique(ytItems[i]);
          if (scItems[i]) pushUnique(scItems[i]);
          if (spItems[i]) pushUnique(spItems[i]);
          if (merged.length >= limit) break;
        }

        if (merged.length > 0) {
          res = {
            query: effectiveQuery,
            source: "all",
            results: merged.slice(0, limit),
            total: merged.length,
          };
        } else {
          const allRejected = settled.every((s) => s.status === "rejected");
          const firstRejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
          if (allRejected && firstRejected) {
            throw firstRejected.reason;
          }
        }
      }

      if (!res) {
        res = await fetchSourceBatch(effectiveQuery, targetSource, backendLimit);
      }

      // Fast secondary alias fallback if specific source returned empty results (e.g. SoundCloud/YouTube/Spotify)
      if ((!res?.results || res.results.length === 0) && targetSource !== "all") {
        try {
          const aliasPath =
            targetSource === "soundcloud"
              ? `/api/mobile/v1/soundcloud/search?q=${encodeURIComponent(effectiveQuery)}&limit=${backendLimit}`
              : targetSource === "spotify"
                ? `/api/mobile/v1/spotify/search?q=${encodeURIComponent(effectiveQuery)}&limit=${backendLimit}`
                : `/api/mobile/v1/youtube/search?q=${encodeURIComponent(effectiveQuery)}&limit=${backendLimit}`;
          const aliasRes = await apiFetch<ExternalSearchPayload>(aliasPath);
          if (aliasRes?.results && aliasRes.results.length > 0) {
            res = aliasRes;
          } else if (source === "spotify") {
            const ytFallbackRes = await apiFetch<ExternalSearchPayload>(
              `/api/mobile/v1/youtube/search?q=${encodeURIComponent(effectiveQuery)}&limit=${backendLimit}`,
            );
            if (ytFallbackRes?.results && ytFallbackRes.results.length > 0) {
              res = ytFallbackRes;
            }
          }
        } catch (aliasErr) {
          if (isBlockingAccessOrVersionErr(aliasErr)) {
            throw aliasErr;
          }
          // Keep original response unless auth/version gate rejected
        }
      }

      // Single best-effort enrichment pass for specific-provider searches returning few results
      if (
        res?.results &&
        res.results.length > 0 &&
        res.results.length < 14 &&
        targetSource !== "all" &&
        !isSpotifyUrl &&
        limit >= 20 &&
        !/\b(?:music|remix)\b/i.test(effectiveQuery)
      ) {
        try {
          const enrichRes = await fetchSourceBatch(`${effectiveQuery} music`, targetSource, 20);
          if (enrichRes?.results && enrichRes.results.length > 0) {
            const seenKeys = new Set<string>();
            for (const existing of res.results) {
              seenKeys.add(existing.id);
              const canon = (existing.pageUrl || "").split("?")[0].toLowerCase();
              if (canon) seenKeys.add(canon);
            }
            const combined = [...res.results];
            for (const candidate of enrichRes.results) {
              const canon = (candidate.pageUrl || "").split("?")[0].toLowerCase();
              if (seenKeys.has(candidate.id) || (canon && seenKeys.has(canon))) continue;
              seenKeys.add(candidate.id);
              if (canon) seenKeys.add(canon);
              combined.push(candidate);
              if (combined.length >= limit) break;
            }
            res = { ...res, results: combined, total: combined.length };
          }
        } catch {
          // Best-effort enrichment must never lose primary results
        }
      }

      if (res?.results && Array.isArray(res.results)) {
        const sanitizedResults = normalizeExternalResults(res.results);
        return { ...res, results: sanitizedResults, total: sanitizedResults.length };
      }
      if (res?.error) {
        return { query: q, source, results: [], total: 0, error: res.error };
      }
    } catch (err: unknown) {
      if (
        (err instanceof ApiError && (err.status === 426 || err.code === "APP_UPDATE_REQUIRED")) ||
        (err as { code?: string })?.code === "APP_UPDATE_REQUIRED" ||
        String(err).includes("APP_UPDATE_REQUIRED")
      ) {
        return {
          query: q,
          source,
          results: [],
          total: 0,
          error: err instanceof Error ? err.message : "به‌روزرسانی الزامی برنامه",
          code: "APP_UPDATE_REQUIRED",
        };
      }

      if (
        (err instanceof ApiError && (err.status === 403 || err.code === "GLOBAL_SEARCH_ACCESS_REQUIRED")) ||
        (err as { code?: string })?.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" ||
        String(err).includes("GLOBAL_SEARCH_ACCESS_REQUIRED")
      ) {
        return {
          query: q,
          source,
          results: [],
          total: 0,
          error: err instanceof Error ? err.message : "دسترسی به جستجوی شبکه‌های جهانی نیازمند تایید مدیر است.",
          code: "GLOBAL_SEARCH_ACCESS_REQUIRED",
        };
      }

      // If user searched a specific external provider (youtube/soundcloud/spotify), do NOT pollute with local seed tracks!
      if (source !== "all") {
        return {
          query: q,
          source,
          results: [],
          total: 0,
          error: err instanceof Error ? err.message : "Failed to load external music streams",
        };
      }

      // Graceful offline fallback over bundled catalog for broad "all" searches
      const qLower = cleanQ.toLowerCase();
      const matches = filterSensitiveTracks(FALLBACK_TRACKS).filter(
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
    }

    return {
      query: q,
      source,
      results: [],
      total: 0,
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

    // 1. Check in-memory external tracks cache
    const cachedExt = externalTracksCache.get(id);
    if (cachedExt) {
      if (cachedExt.source === "spotify" && (!cachedExt.pageUrl || !cachedExt.pageUrl.includes("youtube"))) {
        try {
          const resolved = await resolveSpotifyTrackStream(cachedExt);
          return { track: normalizeTrack(resolved) };
        } catch {
          return { track: normalizeTrack(cachedExt) };
        }
      }
      return { track: normalizeTrack(cachedExt) };
    }

    // 2. Check catalog cache
    const catalogTracks = getCachedCatalogTracks();
    const inCatalog = catalogTracks?.find((t) => t.id === id);
    if (inCatalog) {
      return { track: inCatalog };
    }

    // 3. Exact match in fallback seeds
    const found = FALLBACK_TRACKS.find((t) => t.id === id);
    if (found) {
      return { track: normalizeTrack(found) };
    }

    // 4. If ID is an external track (ext-..., youtube-..., soundcloud-..., spotify-..., or direct URL), reconstruct valid external track
    if (isExternalTrack(id)) {
      const synth = synthesizeExternalTrack(id);
      if (synth.source === "spotify") {
        try {
          const resolved = await resolveSpotifyTrackStream(synth);
          return { track: resolved };
        } catch {
          return { track: synth };
        }
      }
      if (synth.source === "soundcloud") {
        try {
          const resolved = await resolveSoundCloudTrackStream(synth);
          return { track: resolved };
        } catch {
          return { track: synth };
        }
      }
      return { track: synth };
    }

    // If ID is not found anywhere, throw an explicit error so callers/UI know the track is missing instead of playing the wrong track
    throw new Error(`Track not found: ${id}`);
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
  async refreshStreamUrl(id: string, url?: string, title?: string, artist?: string) {
    let canonical = extractCanonicalExternalUrl(url, id);

    // If target is a Spotify track, resolve it to YouTube stream URL first because backend yt-dlp cannot stream Spotify DRM
    if (id.includes("spotify") || (canonical && canonical.includes("spotify"))) {
      try {
        const cached = externalTracksCache.get(id);
        const baseTrack = cached || synthesizeExternalTrack(id, { pageUrl: canonical || undefined });
        const resolved = await resolveSpotifyTrackStream(baseTrack);
        if (resolved.pageUrl && !resolved.pageUrl.includes("spotify")) {
          canonical = resolved.pageUrl;
        }
      } catch {}
    }

    return apiFetch<{ ok: boolean; streamUrl: string; audioUrl: string; canonicalUrl: string }>(
      "/api/external/refresh-stream",
      {
        method: "POST",
        body: JSON.stringify({ id, url: canonical || url, title, artist }),
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
  async autoFetchLyrics(id: string, params?: { queryTitle?: string; queryArtist?: string; forceRefresh?: boolean; durationSec?: number }) {
    const rawTitle = (params?.queryTitle || "").trim();
    const rawArtist = (params?.queryArtist || "").trim();
    const { title: cleanTitle, artist: cleanArtist } = extractCleanTitleAndArtist(rawTitle, rawArtist);

    // If query has no meaningful title, return empty result to avoid showing random mismatched tracks
    if (!cleanTitle && !id.startsWith("track-")) {
      return {
        found: false,
        source: "none",
        lrcContent: "",
        lines: [] as LyricLine[],
      };
    }

    try {
      const res = await apiFetch<{
        found: boolean;
        source: string;
        lrcContent: string;
        lines: LyricLine[];
        providerTrackName?: string;
        providerArtistName?: string;
      }>(`/api/tracks/${encodeURIComponent(id)}/lyrics/auto-fetch`, {
        method: "POST",
        body: JSON.stringify({
          ...params,
          queryTitle: cleanTitle || params?.queryTitle,
          queryArtist: cleanArtist || params?.queryArtist,
        }),
      });

      if (res && res.found && res.lines && res.lines.length > 0) {
        // If provider returned a track name and we have a clean title, verify similarity
        if (cleanTitle && res.providerTrackName) {
          const sim = calculateTitleSimilarity(cleanTitle, res.providerTrackName);
          if (sim < 0.4) {
            // Mismatched track lyrics from different song by same artist! Discard!
            return {
              found: false,
              source: "none",
              lrcContent: "",
              lines: [] as LyricLine[],
            };
          }
        }
        return res;
      }
    } catch {
      // Backend unavailable or error
    }

    // Direct client-side LRCLIB cascade fallback
    if (cleanTitle) {
      try {
        const direct = await fetchLrclibDirectly(cleanTitle, cleanArtist, params?.durationSec);
        if (direct && direct.found && direct.lines.length > 0) {
          return direct;
        }
      } catch {}
    }

    return {
      found: false,
      source: "none",
      lrcContent: "",
      lines: [] as LyricLine[],
    };
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
  adminUpdateUserPermissions(id: string, permissions: { canAccessGlobalSearch: boolean }) {
    return apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}/permissions`, {
      method: "PATCH",
      body: JSON.stringify(permissions),
    });
  },
  adminDeleteUser(id: string) {
    return apiFetch<{ deleted: boolean; id: string }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  // Soundify Connect Multi-Device Playback Sync
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

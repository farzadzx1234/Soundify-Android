import { clusterTracksByArtist, extractTrueArtist } from "./artistResolver";
import type { Track } from "./types";

const LISTENING_PROFILE_KEY = "soundify_listening_profile_v1";

export interface TrackListenStat {
  trackId: string;
  title: string;
  titleFa?: string;
  artistName: string;
  artistNameFa?: string;
  canonicalArtistKey?: string;
  genre?: string;
  mood?: string;
  coverUrl?: string;
  accentColor?: string;
  plays: number;
  lastPlayedAt: number;
  trackSnapshot?: Track;
}

export interface ListeningProfile {
  tracks: Record<string, TrackListenStat>;
  artists: Record<string, number>;
  genres: Record<string, number>;
  moods: Record<string, number>;
  totalListens: number;
}

export interface PersonalizedMix {
  id: string;
  title: string;
  titleFa: string;
  subtitle: string;
  subtitleFa: string;
  badge: string;
  badgeFa: string;
  accentColor: string;
  coverUrls: string[];
  tracks: Track[];
}

const cachedMixesById = new Map<string, PersonalizedMix>();

export function registerGeneratedMixes(mixes: PersonalizedMix[]): void {
  for (const mix of mixes) {
    cachedMixesById.set(mix.id, mix);
  }
}

export function getCachedPersonalizedMix(id: string): PersonalizedMix | null {
  return cachedMixesById.get(id) ?? null;
}

function createEmptyProfile(): ListeningProfile {
  return {
    tracks: {},
    artists: {},
    genres: {},
    moods: {},
    totalListens: 0,
  };
}

export function getListeningProfile(): ListeningProfile {
  if (typeof window === "undefined") return createEmptyProfile();
  try {
    const raw = window.localStorage.getItem(LISTENING_PROFILE_KEY);
    if (!raw) return createEmptyProfile();
    const parsed = JSON.parse(raw) as Partial<ListeningProfile>;
    return {
      tracks: parsed.tracks && typeof parsed.tracks === "object" ? parsed.tracks : {},
      artists: parsed.artists && typeof parsed.artists === "object" ? parsed.artists : {},
      genres: parsed.genres && typeof parsed.genres === "object" ? parsed.genres : {},
      moods: parsed.moods && typeof parsed.moods === "object" ? parsed.moods : {},
      totalListens: typeof parsed.totalListens === "number" ? parsed.totalListens : 0,
    };
  } catch {
    return createEmptyProfile();
  }
}

export function saveListeningProfile(profile: ListeningProfile): void {
  if (typeof window === "undefined") return;
  try {
    // Keep most recent 120 tracks and snapshots on most recent 60 tracks
    const entries = Object.entries(profile.tracks);
    if (entries.length > 60) {
      entries.sort((a, b) => (b[1].lastPlayedAt || 0) - (a[1].lastPlayedAt || 0));
      for (let i = 60; i < entries.length; i++) {
        entries[i][1] = { ...entries[i][1], trackSnapshot: undefined };
      }
      if (entries.length > 120) {
        profile.tracks = Object.fromEntries(entries.slice(0, 120));
      } else {
        profile.tracks = Object.fromEntries(entries);
      }
    }
    window.localStorage.setItem(LISTENING_PROFILE_KEY, JSON.stringify(profile));
  } catch {}
}

export function clearListeningProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LISTENING_PROFILE_KEY);
  } catch {}
}

/**
 * Records a user playback event (>=3s listened) into the local taste graph
 * using cross-platform artist resolution so Spotify/YouTube/SoundCloud plays
 * unify cleanly under the same artist identity.
 */
export function recordListeningEvent(track: Track | null | undefined): ListeningProfile {
  const profile = getListeningProfile();
  if (!track || !track.id) return profile;

  const artistInfo = extractTrueArtist(track);
  const existing = profile.tracks[track.id];

  // Store a compact snapshot without massive base64 or waveforms
  const compactSnapshot: Track = {
    ...track,
    waveform: [],
  };

  profile.tracks[track.id] = {
    trackId: track.id,
    title: track.title || existing?.title || "Track",
    titleFa: track.titleFa || existing?.titleFa,
    artistName: artistInfo.displayName || track.artistName || existing?.artistName || "Artist",
    artistNameFa: artistInfo.displayNameFa || track.artistNameFa || existing?.artistNameFa,
    canonicalArtistKey: artistInfo.canonicalKey,
    genre: track.genre || existing?.genre,
    mood: track.mood || existing?.mood,
    coverUrl: track.coverUrl && !track.coverUrl.startsWith("blob:") ? track.coverUrl : existing?.coverUrl,
    accentColor: track.accentColor || existing?.accentColor,
    plays: (existing?.plays || 0) + 1,
    lastPlayedAt: Date.now(),
    trackSnapshot: compactSnapshot,
  };

  const artistBucket = artistInfo.canonicalKey && artistInfo.canonicalKey !== "unknown"
    ? artistInfo.canonicalKey
    : (track.artistName || "").trim().toLowerCase();
  if (artistBucket) {
    profile.artists[artistBucket] = (profile.artists[artistBucket] || 0) + 1;
  }

  const genreKey = (track.genre || "").trim().toLowerCase();
  if (genreKey && genreKey !== "all" && genreKey !== "external") {
    profile.genres[genreKey] = (profile.genres[genreKey] || 0) + 1;
  }

  const moodKey = (track.mood || "").trim().toLowerCase();
  if (moodKey && moodKey !== "all" && moodKey !== "external") {
    profile.moods[moodKey] = (profile.moods[moodKey] || 0) + 1;
  }

  profile.totalListens += 1;
  saveListeningProfile(profile);
  return profile;
}

function dedupeTracks(list: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const item of list) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function formatArtistSubtitle(tracks: Track[], lang: "fa" | "en"): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const info = extractTrueArtist(t);
    const label = (lang === "fa" ? info.displayNameFa || info.displayName : info.displayName || info.displayNameFa || "").trim();
    const key = info.canonicalKey || label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      names.push(label);
    }
    if (names.length >= 3) break;
  }
  if (names.length === 0) {
    return lang === "fa" ? "گلچین اختصاصی بر اساس سلیقه شما" : "Curated for your listening taste";
  }
  if (lang === "fa") {
    return names.length >= 2 ? `${names.slice(0, 2).join("، ")} و دیگران` : `${names[0]} و آثار مشابه`;
  }
  return names.length >= 2 ? `${names.slice(0, 2).join(", ")} and more` : `${names[0]} & similar vibes`;
}

/**
 * Generates up to 4 Spotify-style personalized playlists derived from actual
 * listening history, cross-platform artist clustering (YouTube/SoundCloud/Spotify),
 * liked tracks, downloaded tracks, and catalog similarity.
 */
export function buildPersonalizedMixes(
  catalogTracks: Track[],
  downloadedTracks: Track[],
  likedTracks: Track[],
  _lang: "fa" | "en" = "fa",
  profileOverride?: ListeningProfile,
): PersonalizedMix[] {
  const profile = profileOverride ?? getListeningProfile();
  const listenedSnapshots: Track[] = Object.values(profile.tracks)
    .map((stat) => stat.trackSnapshot)
    .filter((tr): tr is Track => Boolean(tr && tr.id));

  const pool = dedupeTracks([
    ...likedTracks,
    ...downloadedTracks,
    ...listenedSnapshots,
    ...catalogTracks,
  ]);
  if (pool.length === 0) return [];

  const poolMap = new Map<string, Track>();
  for (const item of pool) {
    poolMap.set(item.id, item);
  }

  const mixes: PersonalizedMix[] = [];
  const listenedStats = Object.values(profile.tracks).sort(
    (a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt,
  );

  // 1. On Repeat Mix — most replayed, liked & downloaded tracks
  const repeatCandidates: Track[] = [];
  for (const stat of listenedStats) {
    const matched = poolMap.get(stat.trackId);
    if (matched) repeatCandidates.push(matched);
  }
  for (const lt of likedTracks) repeatCandidates.push(lt);
  for (const dt of downloadedTracks) repeatCandidates.push(dt);

  const onRepeatTracks = dedupeTracks(repeatCandidates).slice(0, 20);
  if (onRepeatTracks.length > 0) {
    mixes.push({
      id: "mix-on-repeat",
      title: "On Repeat",
      titleFa: "پرتکرارهای شما",
      subtitle: formatArtistSubtitle(onRepeatTracks, "en"),
      subtitleFa: formatArtistSubtitle(onRepeatTracks, "fa"),
      badge: "Made For You",
      badgeFa: "ساخته‌شده برای شما",
      accentColor: onRepeatTracks[0].accentColor || "#6366f1",
      coverUrls: onRepeatTracks.slice(0, 4).map((t) => t.coverUrl).filter(Boolean),
      tracks: onRepeatTracks,
    });
  }

  // 2. Smart Cross-Platform Artist Mixes (unites YouTube / SoundCloud / Spotify / Local)
  const artistClusters = clusterTracksByArtist(pool);
  const scoredClusters = artistClusters
    .map((cluster) => {
      let weight = 0;
      for (const tr of cluster.tracks) {
        const stat = profile.tracks[tr.id];
        if (stat) weight += stat.plays * 4;
        if (tr.likedByMe) weight += 5;
        if (downloadedTracks.some((d) => d.id === tr.id)) weight += 3;
      }
      weight += profile.artists[cluster.key] || 0;
      return { cluster, weight };
    })
    .filter((entry) => entry.weight > 0 && entry.cluster.tracks.length >= 1)
    .sort((a, b) => b.weight - a.weight || b.cluster.tracks.length - a.cluster.tracks.length);

  for (const { cluster } of scoredClusters.slice(0, 2)) {
    const artistTitleEn = cluster.displayName;
    const artistTitleFa = cluster.displayNameFa || cluster.displayName;
    const safeSlug = encodeURIComponent(cluster.key).replace(/%/g, "_");
    const tracksForArtist = cluster.tracks.slice(0, 25);

    mixes.push({
      id: `mix-artist-${safeSlug}`,
      title: `${artistTitleEn} Mix`,
      titleFa: `میکس اختصاصی ${artistTitleFa}`,
      subtitle: `Cross-platform picks for ${artistTitleEn}`,
      subtitleFa: `گلچین تمام آثار ${artistTitleFa} از دانلودها و پخش‌های شما`,
      badge: "Artist Mix",
      badgeFa: "میکس خواننده",
      accentColor: tracksForArtist[0]?.accentColor || "#8b5cf6",
      coverUrls: tracksForArtist.slice(0, 4).map((t) => t.coverUrl).filter(Boolean),
      tracks: tracksForArtist,
    });
  }

  // Determine top genre & mood
  const topGenre = Object.entries(profile.genres).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topMood = Object.entries(profile.moods).sort((a, b) => b[1] - a[1])[0]?.[0];

  // 3. Daily Mix 1 — affinity-scored blend uniting favorite cross-platform artists & genres
  const dailyScored = [...pool]
    .map((tr) => {
      let score = 0;
      const info = extractTrueArtist(tr);
      const aKey = info.canonicalKey;
      const g = (tr.genre || "").trim().toLowerCase();
      const m = (tr.mood || "").trim().toLowerCase();
      score += (profile.artists[aKey] || 0) * 5;
      score += (profile.genres[g] || 0) * 3;
      score += (profile.moods[m] || 0) * 2;
      if (profile.tracks[tr.id]) score += 3;
      if (tr.likedByMe) score += 4;
      score += Math.min(3, Math.log10((tr.playsCount || 0) + 1));
      return { tr, score };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.tr);

  const dailyTracks = dedupeTracks(dailyScored).slice(0, 20);
  if (dailyTracks.length > 0) {
    mixes.push({
      id: "mix-daily-1",
      title: "Daily Mix 1",
      titleFa: "میکس روزانه ۱",
      subtitle: formatArtistSubtitle(dailyTracks, "en"),
      subtitleFa: formatArtistSubtitle(dailyTracks, "fa"),
      badge: "Daily Mix",
      badgeFa: "میکس روزانه",
      accentColor: dailyTracks[0].accentColor || "#ec4899",
      coverUrls: dailyTracks.slice(0, 4).map((t) => t.coverUrl).filter(Boolean),
      tracks: dailyTracks,
    });
  }

  // 4. Discovery Mix if fewer than 4 mixes so far
  if (mixes.length < 4 && pool.length >= 4) {
    const moodCandidates = pool.filter((tr) => {
      const m = (tr.mood || "").trim().toLowerCase();
      const g = (tr.genre || "").trim().toLowerCase();
      return (topMood && m === topMood) || (topGenre && g === topGenre);
    });
    const discoveryTracks = dedupeTracks([
      ...moodCandidates.filter((tr) => !profile.tracks[tr.id]),
      ...moodCandidates,
      ...pool.filter((tr) => !onRepeatTracks.some((r) => r.id === tr.id)),
      ...pool,
    ]).slice(0, 20);

    if (discoveryTracks.length > 0) {
      mixes.push({
        id: "mix-discovery",
        title: topGenre ? `${topGenre.toUpperCase()} Discovery` : "Fresh Discovery Mix",
        titleFa: "کشف تازه‌های هم‌سلیقه",
        subtitle: formatArtistSubtitle(discoveryTracks, "en"),
        subtitleFa: formatArtistSubtitle(discoveryTracks, "fa"),
        badge: "Taste Match",
        badgeFa: "هم‌راستا با سلیقه شما",
        accentColor: discoveryTracks[0].accentColor || "#10b981",
        coverUrls: discoveryTracks.slice(0, 4).map((t) => t.coverUrl).filter(Boolean),
        tracks: discoveryTracks,
      });
    }
  }

  const finalMixes = mixes.slice(0, 4);
  registerGeneratedMixes(finalMixes);
  return finalMixes;
}

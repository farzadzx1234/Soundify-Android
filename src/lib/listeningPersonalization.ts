import type { Track } from "./types";

const LISTENING_PROFILE_KEY = "soundify_listening_profile_v1";

export interface TrackListenStat {
  trackId: string;
  title: string;
  titleFa?: string;
  artistName: string;
  artistNameFa?: string;
  genre?: string;
  mood?: string;
  coverUrl?: string;
  accentColor?: string;
  plays: number;
  lastPlayedAt: number;
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
    // Keep most recent 120 tracks to keep localStorage tiny and fast
    const entries = Object.entries(profile.tracks);
    if (entries.length > 120) {
      entries.sort((a, b) => (b[1].lastPlayedAt || 0) - (a[1].lastPlayedAt || 0));
      profile.tracks = Object.fromEntries(entries.slice(0, 120));
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
 * so Spotify-style personalized mixes reflect real listening behavior.
 */
export function recordListeningEvent(track: Track | null | undefined): ListeningProfile {
  const profile = getListeningProfile();
  if (!track || !track.id) return profile;

  const existing = profile.tracks[track.id];
  profile.tracks[track.id] = {
    trackId: track.id,
    title: track.title || existing?.title || "Track",
    titleFa: track.titleFa || existing?.titleFa,
    artistName: track.artistName || existing?.artistName || "Artist",
    artistNameFa: track.artistNameFa || existing?.artistNameFa,
    genre: track.genre || existing?.genre,
    mood: track.mood || existing?.mood,
    coverUrl:
      track.coverUrl && !track.coverUrl.startsWith("blob:")
        ? track.coverUrl
        : existing?.coverUrl,
    accentColor: track.accentColor || existing?.accentColor,
    plays: (existing?.plays || 0) + 1,
    lastPlayedAt: Date.now(),
  };

  const artistKey = (track.artistName || "").trim().toLowerCase();
  if (artistKey) {
    profile.artists[artistKey] = (profile.artists[artistKey] || 0) + 1;
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
    const label = (lang === "fa" ? t.artistNameFa || t.artistName : t.artistName || t.artistNameFa || "").trim();
    const key = label.toLowerCase();
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
 * Generates up to 3 Spotify-style personalized playlists derived from actual
 * listening history, liked tracks, downloaded tracks, and catalog similarity.
 */
export function buildPersonalizedMixes(
  catalogTracks: Track[],
  downloadedTracks: Track[],
  likedTracks: Track[],
  lang: "fa" | "en" = "fa",
  profileOverride?: ListeningProfile,
): PersonalizedMix[] {
  const profile = profileOverride ?? getListeningProfile();
  const pool = dedupeTracks([...likedTracks, ...downloadedTracks, ...catalogTracks]);
  if (pool.length === 0) return [];

  const poolMap = new Map<string, Track>();
  for (const item of pool) {
    poolMap.set(item.id, item);
  }

  const mixes: PersonalizedMix[] = [];
  const listenedStats = Object.values(profile.tracks).sort(
    (a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt,
  );

  // 1. On Repeat Mix — most replayed & liked tracks
  const repeatCandidates: Track[] = [];
  for (const stat of listenedStats) {
    const matched = poolMap.get(stat.trackId);
    if (matched) repeatCandidates.push(matched);
  }
  for (const lt of likedTracks) {
    repeatCandidates.push(lt);
  }
  for (const dt of downloadedTracks) {
    repeatCandidates.push(dt);
  }
  const onRepeatTracks = dedupeTracks(repeatCandidates).slice(0, 15);
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

  // Determine top artists, genres, and moods
  const topArtist = Object.entries(profile.artists).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topGenre = Object.entries(profile.genres).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topMood = Object.entries(profile.moods).sort((a, b) => b[1] - a[1])[0]?.[0];

  // 2. Daily Mix 1 — affinity-scored blend by favorite artist + genre
  const dailyScored = [...pool]
    .map((tr) => {
      let score = 0;
      const a = (tr.artistName || "").trim().toLowerCase();
      const g = (tr.genre || "").trim().toLowerCase();
      const m = (tr.mood || "").trim().toLowerCase();
      score += (profile.artists[a] || 0) * 5;
      score += (profile.genres[g] || 0) * 3;
      score += (profile.moods[m] || 0) * 2;
      if (profile.tracks[tr.id]) score += 3;
      if (tr.likedByMe) score += 4;
      score += Math.min(3, Math.log10((tr.playsCount || 0) + 1));
      return { tr, score };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.tr);

  const dailyTracks = dedupeTracks(dailyScored).slice(0, 15);
  if (dailyTracks.length > 0) {
    const artistHeadline = topArtist
      ? pool.find((t) => (t.artistName || "").trim().toLowerCase() === topArtist)
      : undefined;
    const displayArtist = artistHeadline
      ? lang === "fa"
        ? artistHeadline.artistNameFa || artistHeadline.artistName
        : artistHeadline.artistName
      : undefined;

    mixes.push({
      id: "mix-daily-1",
      title: "Daily Mix 1",
      titleFa: "میکس روزانه ۱",
      subtitle: displayArtist
        ? `${displayArtist} & similar picks`
        : formatArtistSubtitle(dailyTracks, "en"),
      subtitleFa: displayArtist
        ? `با محوریت ${displayArtist} و آثار هم‌سبک`
        : formatArtistSubtitle(dailyTracks, "fa"),
      badge: "Daily Mix",
      badgeFa: "میکس روزانه",
      accentColor: dailyTracks[0].accentColor || "#ec4899",
      coverUrls: dailyTracks.slice(0, 4).map((t) => t.coverUrl).filter(Boolean),
      tracks: dailyTracks,
    });
  }

  // 3. Mood / Genre Discovery Mix — tracks matching dominant mood/genre the user hasn't overplayed
  if (pool.length >= 4) {
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
    ]).slice(0, 15);

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

  return mixes.slice(0, 3);
}

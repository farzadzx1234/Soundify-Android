import { extractYouTubeIdClient } from "./api";
import { extractCleanTitleAndArtist } from "./lyricsCleaner";
import type { Track } from "./types";

export type TrackIdentityLike = Partial<
  Pick<Track, "id" | "title" | "titleFa" | "artistName" | "artistNameFa" | "pageUrl" | "audioUrl" | "coverUrl" | "durationSec">
>;

const GENERIC_ARTIST_TOKENS = new Set(["", "artist", "soundify", "unknown", "unknown artist", "هنرمند", "ناشناس"]);

/**
 * Normalizes Persian/Arabic/Latin characters into stable matching tokens.
 */
export function foldIdentityPart(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u064b-\u065f\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Normalizes external track page URLs so query variations and mobile/short links resolve identically.
 */
export function normalizeCanonicalPageUrl(rawUrl?: string | null): string {
  const input = (rawUrl || "").trim();
  if (!input) return "";

  const ytId = extractYouTubeIdClient(input);
  if (ytId) {
    return `https://www.youtube.com/watch?v=${ytId}`;
  }

  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${host}${cleanPath}`.toLowerCase();
  } catch {
    return input.replace(/^https?:\/\/(www\.)?/i, "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Generates normalized artist::title fingerprints for a track across clean title/artist variations.
 */
export function computeCanonicalTrackFingerprints(
  track: Pick<TrackIdentityLike, "title" | "titleFa" | "artistName" | "artistNameFa"> | null | undefined,
): string[] {
  if (!track) return [];
  const results = new Set<string>();
  const addPair = (a: string, t: string) => {
    const normA = foldIdentityPart(a);
    const normT = foldIdentityPart(t);
    if (normA.length >= 2 && normT.length >= 2 && !GENERIC_ARTIST_TOKENS.has(normA)) {
      results.add(`${normA}::${normT}`);
    }
  };

  const titleCandidates = [track.title || "", track.titleFa || ""].filter(Boolean);
  const artistCandidates = [track.artistName || "", track.artistNameFa || ""].filter(Boolean);
  const primaryArtist = artistCandidates[0] || "";

  for (const t of titleCandidates) {
    for (const a of (artistCandidates.length > 0 ? artistCandidates : [""])) {
      addPair(a, t);
      const cleaned = extractCleanTitleAndArtist(t, a);
      addPair(cleaned.artist || a, cleaned.title || t);
    }
    const parsedFromTitle = extractCleanTitleAndArtist(t, "");
    if (parsedFromTitle.artist && parsedFromTitle.title) {
      addPair(parsedFromTitle.artist, parsedFromTitle.title);
    }
    // Handle reversed "Title - Artist" metadata when file/tag order swaps
    const dashMatch = t.split(/\s+[-–—]\s+/);
    if (dashMatch.length === 2 && primaryArtist && GENERIC_ARTIST_TOKENS.has(foldIdentityPart(primaryArtist))) {
      addPair(dashMatch[0], dashMatch[1]);
      addPair(dashMatch[1], dashMatch[0]);
    }
  }

  return Array.from(results);
}

function stripExternalPrefix(id?: string): string {
  const clean = (id || "").trim();
  if (!clean) return "";
  return clean.replace(/^ext-/, "").replace(/^(youtube|soundcloud|spotify)-/i, "");
}

function extractTrackYouTubeId(track: TrackIdentityLike): string | null {
  const pageUrl = (track.pageUrl || "").trim();
  const id = (track.id || "").trim();
  const pageYt = extractYouTubeIdClient(pageUrl);
  if (pageYt) return pageYt;
  const idYt = extractYouTubeIdClient(id);
  if (idYt) return idYt;
  // Do not infer YouTube ID from cover/audio if the track explicitly identifies a non-YouTube page or ID
  if (pageUrl && /^https?:\/\//i.test(pageUrl)) return null;
  return extractYouTubeIdClient(track.audioUrl || "") || extractYouTubeIdClient(track.coverUrl || "");
}

function buildTrackSlugForms(track: TrackIdentityLike): string[] {
  const out = new Set<string>();
  const id = (track.id || "").trim();
  if (id.startsWith("device-")) {
    const slug = foldIdentityPart(id.slice("device-".length));
    if (slug.length >= 4) out.add(slug);
  }
  const t = foldIdentityPart(track.title || track.titleFa || "");
  const a = foldIdentityPart(track.artistName || track.artistNameFa || "");
  if (a && t && !GENERIC_ARTIST_TOKENS.has(a)) {
    out.add(`${a} ${t}`);
    out.add(`${t} ${a}`);
  } else if (t && t.length >= 4) {
    out.add(t);
  }
  const cleaned = extractCleanTitleAndArtist(track.title || "", track.artistName || "");
  const ca = foldIdentityPart(cleaned.artist);
  const ct = foldIdentityPart(cleaned.title);
  if (ca && ct && !GENERIC_ARTIST_TOKENS.has(ca)) {
    out.add(`${ca} ${ct}`);
    out.add(`${ct} ${ca}`);
  }
  return Array.from(out);
}

/**
 * Canonical cross-source track identity comparator.
 * Matches tracks across catalog IDs, external YouTube/SoundCloud IDs, normalized pageUrls,
 * and clean artist+title metadata (including local device-scanned filenames).
 */
export function areTracksSameIdentity(
  a: TrackIdentityLike | null | undefined,
  b: TrackIdentityLike | null | undefined,
): boolean {
  if (!a || !b) return false;

  const idA = (a.id || "").trim();
  const idB = (b.id || "").trim();
  if (idA && idB && idA === idB) return true;

  const ytA = extractTrackYouTubeId(a);
  const ytB = extractTrackYouTubeId(b);
  if (ytA && ytB && ytA === ytB) return true;

  const strippedA = stripExternalPrefix(idA);
  const strippedB = stripExternalPrefix(idB);
  if (
    strippedA &&
    strippedB &&
    strippedA === strippedB &&
    !idA.startsWith("device-") &&
    !idB.startsWith("device-") &&
    (idA.startsWith("ext-") || idB.startsWith("ext-") || ytA !== null || ytB !== null)
  ) {
    return true;
  }

  const pageA = normalizeCanonicalPageUrl(a.pageUrl);
  const pageB = normalizeCanonicalPageUrl(b.pageUrl);
  if (pageA && pageB && pageA === pageB) return true;

  // Guard duration mismatch when comparing purely by text metadata
  if (
    typeof a.durationSec === "number" &&
    typeof b.durationSec === "number" &&
    a.durationSec > 30 &&
    b.durationSec > 30 &&
    Math.abs(a.durationSec - b.durationSec) > 20
  ) {
    return false;
  }

  const fpA = computeCanonicalTrackFingerprints(a);
  const fpB = computeCanonicalTrackFingerprints(b);
  if (fpA.length > 0 && fpB.length > 0) {
    const setB = new Set(fpB);
    if (fpA.some((fp) => setB.has(fp))) return true;
  }

  // Fallback for device-scanned files whose artist tag wasn't embedded cleanly ("device-artist-title")
  if (idA.startsWith("device-") || idB.startsWith("device-")) {
    const slugsA = buildTrackSlugForms(a);
    const slugsB = new Set(buildTrackSlugForms(b));
    if (slugsA.some((s) => slugsB.has(s))) return true;
  }

  return false;
}

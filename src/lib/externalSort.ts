import type { Track } from "./types";

export interface TrackReleaseInfo {
  timestampMs: number | null;
  displayYear: number | null;
  source: "metadata" | "createdAt" | "titleYear" | "soundcloudId" | "none";
}

function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
}

function isReasonableYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1950 && year <= 2035;
}

function parseReleaseTimestampMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const year = new Date(ms).getUTCFullYear();
    return isReasonableYear(year) ? ms : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = normalizeDigits(raw).trim();
  if (!trimmed) return null;

  // Match yt-dlp YYYYMMDD format (e.g. "20250412")
  const ymd = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) {
    const yr = Number(ymd[1]);
    const mo = Number(ymd[2]);
    const dy = Number(ymd[3]);
    if (isReasonableYear(yr) && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      return Date.UTC(yr, mo - 1, dy, 12, 0, 0);
    }
  }

  // Match plain 4-digit year string (e.g. "2025")
  const plainYr = trimmed.match(/^(\d{4})$/);
  if (plainYr) {
    const yr = Number(plainYr[1]);
    return isReasonableYear(yr) ? Date.UTC(yr, 5, 15) : null;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    const yr = new Date(parsed).getUTCFullYear();
    if (isReasonableYear(yr)) return parsed;
  }
  return null;
}

function extractYearFromText(text: string): { gregorianYear: number; timestampMs: number } | null {
  const norm = normalizeDigits(text);
  if (!norm.trim()) return null;

  const gregorianMatches = Array.from(norm.matchAll(/(?:^|[^\d])((?:19[5-9]\d)|(?:20[0-2]\d)|203[0-5])(?!\d)/g));
  if (gregorianMatches.length > 0) {
    const bestGreg = Math.max(...gregorianMatches.map((m) => Number(m[1])));
    if (isReasonableYear(bestGreg)) {
      return {
        gregorianYear: bestGreg,
        timestampMs: Date.UTC(bestGreg, 5, 15),
      };
    }
  }

  const jalaliMatches = Array.from(norm.matchAll(/(?:^|[^\d])(13[4-9]\d|140\d|1410)(?!\d)/g));
  if (jalaliMatches.length > 0) {
    const bestJalali = Math.max(...jalaliMatches.map((m) => Number(m[1])));
    const gregYear = bestJalali + 621;
    if (isReasonableYear(gregYear)) {
      return {
        gregorianYear: gregYear,
        timestampMs: Date.UTC(gregYear, 5, 15),
      };
    }
  }

  return null;
}

function extractSoundCloudNumericId(track: Track): number | null {
  const isSc =
    track.source === "soundcloud" ||
    /(?:soundcloud|sc)[-_]/i.test(track.id || "") ||
    (track.pageUrl || "").includes("soundcloud.com");
  if (!isSc) return null;

  const idMatch = (track.id || "").match(/^(?:ext-)?(?:soundcloud|sc)[-_](\d{6,11})$/i);
  if (idMatch) {
    const n = Number(idMatch[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (/^\d{6,11}$/.test(track.id || "")) {
    const n = Number(track.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Extracts release timestamp & display year for external tracks cleanly:
 * 1. Explicit release/upload metadata (`releaseTimestamp`, `releaseDate`, `uploadDate`, `publishedAt`).
 * 2. Historical `createdAt` (ignoring live synthetic timestamps within 5 minutes of `referenceNowMs`).
 * 3. Gregorian (1950..2035) or Jalali (1340..1410) release year mentioned in title/album.
 * 4. SoundCloud monotonic numeric track ID ordering (without guessing a visible year badge).
 */
export function extractTrackReleaseInfo(
  track: Track,
  referenceNowMs = Date.now(),
): TrackReleaseInfo {
  const metaCandidates: unknown[] = [
    track.releaseTimestamp,
    track.releaseDate,
    track.uploadDate,
    track.publishedAt,
  ];
  for (const candidate of metaCandidates) {
    const ts = parseReleaseTimestampMs(candidate);
    if (ts !== null) {
      return {
        timestampMs: ts,
        displayYear: new Date(ts).getUTCFullYear(),
        source: "metadata",
      };
    }
  }

  if (track.createdAt) {
    const createdMs = parseReleaseTimestampMs(track.createdAt);
    if (createdMs !== null && createdMs < referenceNowMs - 5 * 60 * 1000) {
      return {
        timestampMs: createdMs,
        displayYear: new Date(createdMs).getUTCFullYear(),
        source: "createdAt",
      };
    }
  }

  const combinedText = [track.title, track.titleFa, track.album, track.albumFa]
    .filter(Boolean)
    .join(" ");
  const textYear = extractYearFromText(combinedText);
  if (textYear) {
    return {
      timestampMs: textYear.timestampMs,
      displayYear: textYear.gregorianYear,
      source: "titleYear",
    };
  }

  const scNumId = extractSoundCloudNumericId(track);
  if (scNumId !== null) {
    const startMs = Date.UTC(2010, 0, 1);
    const endMs = Date.UTC(2026, 11, 31);
    const ratio = Math.max(0, Math.min(1, scNumId / 2_400_000_000));
    return {
      timestampMs: Math.round(startMs + ratio * (endMs - startMs)),
      displayYear: null,
      source: "soundcloudId",
    };
  }

  return { timestampMs: null, displayYear: null, source: "none" };
}

/**
 * Sorts external search results by newest release date first while preserving
 * original relevance order for ties and tracks without detectable release dates.
 */
export function sortExternalTracksByReleaseDate(
  tracks: Track[],
  referenceNowMs = Date.now(),
): Track[] {
  if (!Array.isArray(tracks) || tracks.length <= 1) return tracks;

  return tracks
    .map((track, idx) => ({
      track,
      idx,
      ts: extractTrackReleaseInfo(track, referenceNowMs).timestampMs,
    }))
    .sort((a, b) => {
      if (a.ts !== null && b.ts !== null && a.ts !== b.ts) {
        return b.ts - a.ts;
      }
      if (a.ts !== null && b.ts === null) return -1;
      if (a.ts === null && b.ts !== null) return 1;
      return a.idx - b.idx;
    })
    .map((entry) => entry.track);
}

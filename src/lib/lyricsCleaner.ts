/**
 * Lyrics Cleaning, Query Sanitization & Cascade Verification
 *
 * Ensures lyrics lookups are accurate, preventing wrong track matches
 * (such as matching artist but showing completely different track lyrics)
 * and stripping promotional/video noise tags from queries.
 */

import { parseLrc } from "./lrc";
import type { LyricLine } from "./types";

// Noise patterns commonly present in YouTube / external track titles
const NOISE_PATTERNS = [
  /\([^)]*(?:official|audio|video|music\s*video|lyric\s*video|clip|lyrics?|remix|hd|4k)[^)]*\)/gi,
  /\[[^\]]*(?:official|audio|video|music\s*video|lyric\s*video|clip|lyrics?|remix|hd|4k)[^\]]*\]/gi,
  /\b(?:official\s*(?:audio|video|music\s*video|lyric\s*video))\b/gi,
  /\b(?:music\s*video|video\s*clip|lyric\s*video)\b/gi,
  /\b(?:320|128)\s*(?:kbps)?\b/gi,
  /(?:^|\s)(?:ریمیکس|موزیک ویدیو|ویدیو رسمی|صوتی رسمی|کیفیت 320|کیفیت 128)(?:\s|$)/gu,
  /\((?:feat\.?|ft\.?)\s*[^)]+\)/gi,
  /\[(?:feat\.?|ft\.?)\s*[^\]]+\]/gi,
  /\b(?:feat\.?|ft\.?)\s+[^\s\-–—]+(?:\s+[^\s\-–—]+)?/gi,
  /\b(?:full\s*track|extended\s*mix|original\s*mix)\b/gi,
  /\s{2,}/g,
];

/**
 * Normalizes Persian characters and removes diacritics.
 */
export function normalizePersianChars(str: string): string {
  if (!str) return "";
  return str
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/[\u0622\u0623\u0625]/g, "ا")
    .replace(/[ـ\-_،,.;:!?؟()[\]{}'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitizes a title string by removing video tags, quality indicators, and collaboration markers.
 */
export function cleanTitleString(title: string): string {
  if (!title) return "";
  let cleaned = title;
  for (const pat of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Extracts true title and artist when title is formatted as "Artist - Song Title" or "Song Title - Artist".
 */
export function extractCleanTitleAndArtist(
  rawTitle: string,
  rawArtist?: string,
): { title: string; artist: string } {
  let title = cleanTitleString(rawTitle || "");
  let artist = (rawArtist || "").trim();

  // If artist is generic / placeholder
  let isGenericArtist =
    !artist ||
    artist.toLowerCase() === "artist" ||
    artist.toLowerCase() === "youtube" ||
    artist.toLowerCase() === "soundcloud" ||
    artist.toLowerCase() === "spotify" ||
    artist === "هنرمند" ||
    artist === "خواننده";

  // Check if title has a separator like " - " or " – " or " — "
  const dashMatch = title.split(/\s*[-–—:]\s*/);
  if (dashMatch.length >= 2) {
    const left = dashMatch[0].trim();
    const right = dashMatch.slice(1).join(" - ").trim();

    // Case 1: artist already matches left part
    if (artist && normalizePersianChars(left).toLowerCase() === normalizePersianChars(artist).toLowerCase()) {
      title = right;
    } else if (isGenericArtist && left.length > 1 && right.length > 1) {
      // e.g. "Hoossein - Be Mola" where artist was generic
      artist = left;
      title = right;
      isGenericArtist = false;
    } else if (artist && normalizePersianChars(right).toLowerCase() === normalizePersianChars(artist).toLowerCase()) {
      // e.g. "Be Mola - Hoossein"
      title = left;
    }
  }

  // Double-clean any leftover noise
  title = cleanTitleString(title);

  return {
    title: title || rawTitle,
    artist: isGenericArtist ? "" : artist,
  };
}

/**
 * Calculates word-overlap similarity to ensure candidate lyrics belong to the requested track.
 */
export function calculateTitleSimilarity(targetTitle: string, candidateTitle: string): number {
  const normTarget = normalizePersianChars(cleanTitleString(targetTitle)).toLowerCase();
  const normCandidate = normalizePersianChars(cleanTitleString(candidateTitle)).toLowerCase();

  if (normTarget === normCandidate) return 1.0;
  if (normCandidate.includes(normTarget) || normTarget.includes(normCandidate)) return 0.85;

  const targetWords = normTarget.split(" ").filter((w) => w.length > 1);
  const candidateWords = new Set(normCandidate.split(" ").filter((w) => w.length > 1));

  if (targetWords.length === 0 || candidateWords.size === 0) return 0;

  let matches = 0;
  for (const word of targetWords) {
    if (candidateWords.has(word)) {
      matches++;
    }
  }

  return matches / targetWords.length;
}

export interface DirectLyricsResult {
  found: boolean;
  source: string;
  lrcContent: string;
  lines: LyricLine[];
  providerTrackName?: string;
  providerArtistName?: string;
}

/**
 * Direct client-side LRCLIB fetcher with strict title verification.
 * Serves as resilient fallback when backend endpoint is unreachable or misses.
 */
export async function fetchLrclibDirectly(
  title: string,
  artist?: string,
  durationSec?: number,
): Promise<DirectLyricsResult> {
  const { title: cleanTitle, artist: cleanArtist } = extractCleanTitleAndArtist(title, artist);

  // Rule: NEVER search without title
  if (!cleanTitle || cleanTitle.length < 2) {
    return { found: false, source: "none", lrcContent: "", lines: [] };
  }

  // 1. Try exact get if artist is present
  if (cleanArtist) {
    try {
      const sp = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist,
      });
      if (typeof durationSec === "number" && durationSec > 0) {
        sp.set("duration", String(Math.round(durationSec)));
      }
      const res = await fetch(`https://lrclib.net/api/get?${sp.toString()}`, {
        headers: {
          "L-User-Agent": "Soundify-Android/1.0 (+https://github.com/farzadzx1234/Soundify-Android)",
        },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          syncedLyrics?: string;
          plainLyrics?: string;
          trackName?: string;
          artistName?: string;
        };
        const lrc = data.syncedLyrics || "";
        if (lrc && lrc.trim().length > 0) {
          const lines = parseLrc(lrc);
          if (lines.length > 0) {
            return {
              found: true,
              source: "lrclib-direct",
              lrcContent: lrc,
              lines,
              providerTrackName: data.trackName,
              providerArtistName: data.artistName,
            };
          }
        }
      }
    } catch {
      // fall through to search
    }
  }

  // 2. Fallback: Search with query string
  try {
    const q = `${cleanArtist ? `${cleanArtist} ` : ""}${cleanTitle}`.trim();
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: {
        "L-User-Agent": "Soundify-Android/1.0 (+https://github.com/farzadzx1234/Soundify-Android)",
      },
    });

    if (res.ok) {
      const list = (await res.json()) as Array<{
        trackName?: string;
        artistName?: string;
        syncedLyrics?: string;
        plainLyrics?: string;
        duration?: number;
      }>;

      if (Array.isArray(list) && list.length > 0) {
        // Filter candidates that have synced lyrics and STRICT title similarity >= 0.5
        for (const item of list) {
          if (!item.syncedLyrics || !item.trackName) continue;
          const similarity = calculateTitleSimilarity(cleanTitle, item.trackName);
          if (similarity >= 0.5) {
            const lines = parseLrc(item.syncedLyrics);
            if (lines.length > 0) {
              return {
                found: true,
                source: "lrclib-direct",
                lrcContent: item.syncedLyrics,
                lines,
                providerTrackName: item.trackName,
                providerArtistName: item.artistName,
              };
            }
          }
        }
      }
    }
  } catch {}

  return { found: false, source: "none", lrcContent: "", lines: [] };
}

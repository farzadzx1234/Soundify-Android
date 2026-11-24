import { extractCleanTitleAndArtist, normalizePersianChars } from "./lyricsCleaner";

const FALLBACK_NOISE_TOKENS = new Set([
  "official",
  "audio",
  "video",
  "music",
  "lyrics",
  "lyric",
  "clip",
  "hd",
  "4k",
  "mp3",
  "visualizer",
  "live",
  "feat",
  "ft",
  "prod",
  "topic",
  "vevo",
  "version",
  "single",
  "full",
  "track",
  "original",
  "extended",
  "موزیک",
  "ویدیو",
  "آهنگ",
  "اهنگ",
  "جدید",
  "اصلی",
  "صوتی",
  "رسمی",
  "کیفیت",
]);

function foldDiacriticsAndTurkish(str: string): string {
  return normalizePersianChars(str)
    .replace(/\u0131/g, "i") // Turkish dotless ı
    .replace(/\u0130/g, "i") // Turkish dotted İ
    .replace(/[\u015F\u015E]/g, "s") // ş / Ş
    .replace(/[\u011F\u011E]/g, "g") // ğ / Ğ
    .replace(/[\u00FC\u00DC]/g, "u") // ü / Ü
    .replace(/[\u00F6\u00D6]/g, "o") // ö / Ö
    .replace(/[\u00E7\u00C7]/g, "c") // ç / Ç
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function stripFallbackDecorators(title: string): string {
  return title
    .replace(/\((?:prod\.?|feat\.?|ft\.?|explicit|official|audio|video|lyrics?|slowed|reverb)[^)]*\)/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\|.*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSongTitle(raw: string, artistTokens: Set<string>): string[] {
  const folded = foldDiacriticsAndTurkish(stripFallbackDecorators(raw));
  if (!folded) return [];
  const rawTokens = folded
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FALLBACK_NOISE_TOKENS.has(w));
  const withoutArtist = rawTokens.filter((w) => !artistTokens.has(w));
  // If stripping artist tokens removes everything (e.g. candidate was ONLY the artist name), return empty so it is rejected unless explicitly an artist self-titled comparison below.
  return withoutArtist;
}

/**
 * Verifies that an external mirror candidate (SoundCloud / YouTube) actually represents
 * the same requested song title rather than a different track by the same artist.
 */
export function isMatchingExternalFallback(
  targetTitle: string,
  targetArtist: string,
  candidateTitle: string,
  candidateArtist?: string,
  targetDurationSec?: number,
  candidateDurationSec?: number,
): boolean {
  if (
    typeof targetDurationSec === "number" &&
    typeof candidateDurationSec === "number" &&
    Number.isFinite(targetDurationSec) &&
    Number.isFinite(candidateDurationSec) &&
    targetDurationSec > 20 &&
    candidateDurationSec > 20 &&
    Math.abs(targetDurationSec - candidateDurationSec) > 30
  ) {
    return false;
  }

  const { title: cleanTargetTitle, artist: cleanTargetArtist } = extractCleanTitleAndArtist(
    stripFallbackDecorators(targetTitle),
    targetArtist,
  );
  const { title: cleanCandidateTitle, artist: cleanCandArtist } = extractCleanTitleAndArtist(
    stripFallbackDecorators(candidateTitle),
    candidateArtist || cleanTargetArtist,
  );

  // Also strip shared leading "Artist - " prefix OR resolve reversed "Song - Artist" oEmbed headers using candidateArtist
  let resolvedTarget = cleanTargetTitle;
  let resolvedCand = cleanCandidateTitle;
  const targetDash = stripFallbackDecorators(targetTitle).split(/\s*[-–—:]\s*/);
  const candDash = stripFallbackDecorators(candidateTitle).split(/\s*[-–—:]\s*/);
  const sharedDashPrefix =
    targetDash.length >= 2 &&
    candDash.length >= 2 &&
    foldDiacriticsAndTurkish(targetDash[0]) === foldDiacriticsAndTurkish(candDash[0]) &&
    foldDiacriticsAndTurkish(targetDash[0]).length > 1
      ? foldDiacriticsAndTurkish(targetDash[0])
      : "";

  const rawNormTargetArtist = foldDiacriticsAndTurkish(targetArtist || "");
  const isGenericRawTargetArtist =
    !rawNormTargetArtist ||
    /^(?:spotify|spotify artist|artist|youtube|soundcloud)$/.test(rawNormTargetArtist);

  let inferredTargetArtist = cleanTargetArtist || targetArtist || "";
  if (sharedDashPrefix) {
    resolvedTarget = targetDash.slice(1).join(" ").trim();
    resolvedCand = candDash.slice(1).join(" ").trim();
  } else if (targetDash.length >= 2 && isGenericRawTargetArtist) {
    const candA = foldDiacriticsAndTurkish(cleanCandArtist || candidateArtist || "");
    const left = foldDiacriticsAndTurkish(targetDash[0]);
    const right = foldDiacriticsAndTurkish(targetDash.slice(1).join(" "));
    if (candA && right === candA && left.length > 1) {
      resolvedTarget = targetDash[0].trim();
      inferredTargetArtist = targetDash.slice(1).join(" ").trim();
    } else if (candA && left === candA && right.length > 1) {
      resolvedTarget = targetDash.slice(1).join(" ").trim();
      inferredTargetArtist = targetDash[0].trim();
    }
  }

  const normTargetArtist = foldDiacriticsAndTurkish(inferredTargetArtist);
  const normCandidateArtist = foldDiacriticsAndTurkish(cleanCandArtist || candidateArtist || "");

  const normTargetRaw = foldDiacriticsAndTurkish(resolvedTarget || cleanTargetTitle);
  const normCandRaw = foldDiacriticsAndTurkish(resolvedCand || cleanCandidateTitle);

  if (!normTargetRaw || !normCandRaw) {
    return false;
  }

  // Prevent matching when candidate's cleaned title is merely the artist's own name
  if (
    normTargetArtist &&
    (normCandRaw === normTargetArtist ||
      (normTargetArtist.split(/\s+/).length >= 1 &&
        normCandRaw === normTargetArtist &&
        normTargetRaw !== normTargetArtist))
  ) {
    return false;
  }

  // Strict artist identity check: never play a random song from a completely unrelated artist
  // when targetArtist is a real artist name (not a generic platform tag).
  const candidateIdentityHaystack = `${normCandidateArtist} ${foldDiacriticsAndTurkish(candidateTitle)}`.trim();
  const candidateCompact = candidateIdentityHaystack.replace(/\s+/g, "");
  const expectedArtistPhrases = [normTargetArtist, sharedDashPrefix]
    .concat(
      targetDash.length >= 2 && foldDiacriticsAndTurkish(targetDash[0]).length >= 2
        ? [foldDiacriticsAndTurkish(targetDash[0])]
        : [],
    )
    .filter((p) => p.length >= 2 && !/^(?:spotify|spotify artist|artist|youtube|soundcloud)$/.test(p));

  if (expectedArtistPhrases.length > 0 && candidateIdentityHaystack) {
    const artistTokens = new Set<string>();
    for (const phrase of expectedArtistPhrases) {
      for (const tok of phrase.split(/\s+/)) {
        if (tok.length >= 2 && !FALLBACK_NOISE_TOKENS.has(tok)) {
          artistTokens.add(tok);
        }
      }
    }
    const longTokens = Array.from(artistTokens).filter((t) => t.length >= 3);
    const tokensToCheck = longTokens.length > 0 ? longTokens : Array.from(artistTokens);
    const matchesArtist =
      expectedArtistPhrases.some((p) => candidateCompact.includes(p.replace(/\s+/g, ""))) ||
      tokensToCheck.some((tok) => candidateIdentityHaystack.includes(tok));
    if (!matchesArtist) {
      return false;
    }
  }

  const artistTokenSet = new Set<string>();
  for (const aStr of [normTargetArtist, normCandidateArtist, sharedDashPrefix]) {
    if (!aStr) continue;
    for (const tok of aStr.split(/\s+/)) {
      if (tok.length > 1) artistTokenSet.add(tok);
    }
  }

  // Build non-artist song tokens for target and candidate
  let targetTokens = tokenizeSongTitle(resolvedTarget || cleanTargetTitle, artistTokenSet);
  let candTokens = tokenizeSongTitle(resolvedCand || cleanCandidateTitle, artistTokenSet);

  // Edge case: if target song title itself equals artist words (self-titled track), allow exact comparison without stripping
  if (targetTokens.length === 0) {
    const rawTargetToks = normTargetRaw
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FALLBACK_NOISE_TOKENS.has(w));
    const rawCandToks = normCandRaw
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FALLBACK_NOISE_TOKENS.has(w));
    if (rawTargetToks.length === 0 || rawCandToks.length === 0) return false;
    // Only allow if candidate isn't solely the bare artist name for a different title
    if (normCandidateArtist && normCandRaw === normCandidateArtist && normTargetRaw !== normCandidateArtist) {
      return false;
    }
    targetTokens = rawTargetToks;
    candTokens = rawCandToks;
  }

  if (candTokens.length === 0) {
    return false;
  }

  const targetJoin = targetTokens.join(" ");
  const candJoin = candTokens.join(" ");
  if (targetJoin === candJoin) {
    return true;
  }

  const tSet = new Set(targetTokens);
  const cSet = new Set(candTokens);

  let overlap = 0;
  for (const w of tSet) {
    if (cSet.has(w)) overlap++;
  }

  // Single-word song title: must appear in candidate AND candidate must have at most 2 song tokens
  // (e.g., "Kırgınım" matches "Kırgınım Acoustic" / "Kırgınım Remix", NOT "Kırgınım Sevmeyi Denemedin").
  if (tSet.size === 1) {
    const onlyWord = targetTokens[0];
    return cSet.has(onlyWord) && cSet.size <= 2;
  }

  const recall = overlap / tSet.size;
  const f1 = (2 * overlap) / (tSet.size + cSet.size);
  return recall >= 0.75 && f1 >= 0.75;
}

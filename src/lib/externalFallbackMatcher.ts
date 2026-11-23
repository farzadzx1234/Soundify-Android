import {
  calculateTitleSimilarity,
  extractCleanTitleAndArtist,
  normalizePersianChars,
} from "./lyricsCleaner";

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

/**
 * Verifies that an external mirror candidate (SoundCloud / YouTube) actually represents
 * the same requested song title rather than a different track by the same artist.
 */
export function isMatchingExternalFallback(
  targetTitle: string,
  targetArtist: string,
  candidateTitle: string,
  candidateArtist?: string,
): boolean {
  const { title: cleanTargetTitle, artist: cleanTargetArtist } = extractCleanTitleAndArtist(
    stripFallbackDecorators(targetTitle),
    targetArtist,
  );
  const { title: cleanCandidateTitle } = extractCleanTitleAndArtist(
    stripFallbackDecorators(candidateTitle),
    candidateArtist || cleanTargetArtist,
  );

  const normTargetTitle = foldDiacriticsAndTurkish(cleanTargetTitle);
  const normCandTitle = foldDiacriticsAndTurkish(cleanCandidateTitle);
  const normRawCandTitle = foldDiacriticsAndTurkish(candidateTitle);

  if (!normTargetTitle || (!normCandTitle && !normRawCandTitle)) {
    return false;
  }

  // Prevent matching when candidate's cleaned title is merely the artist's own name
  const normTargetArtist = foldDiacriticsAndTurkish(cleanTargetArtist || targetArtist || "");
  if (
    normTargetArtist &&
    normCandTitle === normTargetArtist &&
    normTargetTitle !== normTargetArtist
  ) {
    return false;
  }

  // Also strip target artist from raw candidate if candidate artist header differed (e.g. YouTube channel name)
  let strippedCandTitle = cleanCandidateTitle || candidateTitle;
  if (normTargetArtist && normRawCandTitle.includes(normTargetArtist)) {
    const parts = strippedCandTitle.split(/\s*[-–—:|]\s*/);
    if (parts.length >= 2) {
      const filteredParts = parts.filter(
        (p) => foldDiacriticsAndTurkish(p) !== normTargetArtist,
      );
      if (filteredParts.length > 0) {
        strippedCandTitle = filteredParts.join(" ").trim();
      }
    }
  }

  const foldedCand = foldDiacriticsAndTurkish(strippedCandTitle);
  const score = Math.max(
    calculateTitleSimilarity(normTargetTitle, normCandTitle),
    calculateTitleSimilarity(normTargetTitle, foldedCand),
  );

  return score >= 0.6;
}

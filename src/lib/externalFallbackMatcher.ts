import {
  calculateTitleSimilarity,
  extractCleanTitleAndArtist,
  normalizePersianChars,
} from "./lyricsCleaner";

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
    targetTitle,
    targetArtist,
  );
  const { title: cleanCandidateTitle } = extractCleanTitleAndArtist(
    candidateTitle,
    candidateArtist || cleanTargetArtist,
  );

  const normTargetTitle = normalizePersianChars(cleanTargetTitle).toLowerCase().trim();
  const normCandTitle = normalizePersianChars(cleanCandidateTitle).toLowerCase().trim();
  const normRawCandTitle = normalizePersianChars(candidateTitle).toLowerCase().trim();

  if (!normTargetTitle || (!normCandTitle && !normRawCandTitle)) {
    return false;
  }

  // Prevent matching when candidate's cleaned title is merely the artist's own name
  const normTargetArtist = normalizePersianChars(cleanTargetArtist || targetArtist || "")
    .toLowerCase()
    .trim();
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
        (p) => normalizePersianChars(p).toLowerCase().trim() !== normTargetArtist,
      );
      if (filteredParts.length > 0) {
        strippedCandTitle = filteredParts.join(" ").trim();
      }
    }
  }

  const score = Math.max(
    calculateTitleSimilarity(cleanTargetTitle, cleanCandidateTitle),
    calculateTitleSimilarity(cleanTargetTitle, strippedCandTitle),
  );

  return score >= 0.65;
}

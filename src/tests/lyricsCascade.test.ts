import { describe, expect, it } from "vitest";
import {
  calculateTitleSimilarity,
  cleanTitleString,
  convertPlainLyricsToLines,
  extractCleanTitleAndArtist,
  normalizePersianChars,
} from "@/lib/lyricsCleaner";

describe("Lyrics Cleaning & Cascade Logic", () => {
  it("strips YouTube video tags, audio labels, and noise terms", () => {
    expect(cleanTitleString("Putak - Helia (Official Audio)")).toBe("Putak - Helia");
    expect(cleanTitleString("حصین - به مولا [Official Video]")).toBe("حصین - به مولا");
    expect(cleanTitleString("Shayea - Mamele feat. Putak 320")).toBe("Shayea - Mamele");
    expect(cleanTitleString("ریمیکس هلیا (Music Video)")).toBe("هلیا");
  });

  it("extracts clean title and artist when title includes artist prefix", () => {
    const res1 = extractCleanTitleAndArtist("Putak - Helia (Official Audio)", "Putak");
    expect(res1.title).toBe("Helia");
    expect(res1.artist).toBe("Putak");

    const res2 = extractCleanTitleAndArtist("Hoossein - Be Mola [Official Video]", "YouTube");
    expect(res2.title).toBe("Be Mola");
    expect(res2.artist).toBe("Hoossein");

    const res3 = extractCleanTitleAndArtist("پوتک - هلیا", "پوتک");
    expect(res3.title).toBe("هلیا");
    expect(res3.artist).toBe("پوتک");
  });

  it("calculates title similarity accurately to prevent cross-track lyrics mismatches", () => {
    // Exact or high similarity
    expect(calculateTitleSimilarity("Helia", "Helia")).toBe(1.0);
    expect(calculateTitleSimilarity("Be Mola", "Be Mola (Remix)")).toBeGreaterThanOrEqual(0.85);

    // Completely different track from same artist: must have 0 similarity!
    expect(calculateTitleSimilarity("Helia", "Chiriki")).toBe(0);
    expect(calculateTitleSimilarity("Be Mola", "Sangin")).toBe(0);
  });

  it("normalizes Persian characters for resilient matching", () => {
    expect(normalizePersianChars("يگانه")).toBe("یگانه");
    expect(normalizePersianChars("كافه")).toBe("کافه");
    expect(normalizePersianChars("آهنگِ شاد")).toBe("اهنگ شاد");
  });

  it("converts plain lyrics into timed line entries for unsynced LRCLIB tracks", () => {
    const plain = "خط اول ترانه\nخط دوم ترانه\nخط سوم ترانه";
    const res = convertPlainLyricsToLines(plain, 120);
    expect(res.lines).toHaveLength(3);
    expect(res.lines[0].text).toBe("خط اول ترانه");
    expect(res.lines[0].timeMs).toBe(0);
    expect(res.lines[1].timeMs).toBe(30000);
    expect(res.lrcContent).toContain("[00:00.00] خط اول ترانه");
  });
});

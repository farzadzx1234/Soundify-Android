/**
 * Sensitive Content & Political Moderation Filter for Soundify
 *
 * Prevents political slogans, protest chants, sensitive regime-critical terms,
 * and political protest music from appearing in search queries or music catalog results,
 * protecting the platform and app owner from regulatory and legal liabilities.
 */

import type { Track } from "./types";

/**
 * Normalizes text by removing diacritics, extra spaces, and Persian/Arabic character variations.
 */
function normalizeForFilter(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove arabic/persian harakat (vowel marks)
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/[\u0622\u0623\u0625]/g, "ا")
    .replace(/[ـ\-_،,.;:!?؟()[\]{}'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Blacklist of sensitive political terms, slogans, and protest keywords.
 */
const SENSITIVE_KEYWORDS: readonly string[] = [
  // Persian political protest & sensitive slogans
  "زن زندگی ازادی",
  "زن زندگی آزادی",
  "مهسا امینی",
  "ژینا امینی",
  "شاهزاده",
  "رضا پهلوی",
  "پهلوی",
  "براندازی",
  "برانداز",
  "سرنگونی",
  "خامنه ای",
  "مرگ بر دیکتاتور",
  "مرگ بر خامنه ای",
  "مرگ بر کل نظام",
  "قیام سراسری",
  "اعتراضات سراسری",
  "اعتصابات سراسری",
  "انقلاب زن زندگی آزادی",
  "انقلاب ۱۴۰۱",
  "انقلاب 1401",
  "توماج صالحی",
  "توماج",
  "شاهین نجفی",
  "ولایت فقیه",
  "ضد ولایت فقیه",
  "سپاه تروریستی",
  "مجاهدین خلق",
  "منافقین",
  "مریم رجوی",
  "مسعود رجوی",
  "فرح دیبا",
  "فرح پهلوی",
  "شهدای قیام",
  "کشته شدگان اعتراضات",
  "خیزش انقلابی",
  "شعار شبانه",
  "سوگند به خون یاران",
  "برای آزادی",
  "برای...",
  "شروین حاجی پور برای",
  "سر اومد زمستون",
  "مرگ بر جمهوری اسلامی",
  "نه به جمهوری اسلامی",
  "کشتار آبان",
  "آبان ۹۸",
  "آبان 98",
  "هواپیمای اوکراینی",

  // English equivalents & transliterations
  "woman life freedom",
  "mahsa amini",
  "zhina amini",
  "reza pahlavi",
  "pahlavi",
  "barandazi",
  "khamenei",
  "down with khamenei",
  "down with dictator",
  "down with islamic republic",
  "no to islamic republic",
  "iran revolution",
  "iran protests",
  "toomaj salehi",
  "toomaj",
  "shahin najafi",
  "regime change iran",
  "free iran",
  "anti regime iran",
  "mojahidin khalq",
  "maryam rajavi",
  "masoud rajavi",
  "baraye",
  "shervin baraye",
  "sar oumad zemestoon",
  "ps752",
];

// Pre-normalized set for fast lookup
const NORMALIZED_SENSITIVE_KEYWORDS = SENSITIVE_KEYWORDS.map(normalizeForFilter);

/**
 * Checks whether a given string contains sensitive political or protest terms.
 */
export function isPoliticallySensitive(text: string | null | undefined): boolean {
  if (!text) return false;
  const norm = normalizeForFilter(text);
  if (!norm) return false;

  for (const keyword of NORMALIZED_SENSITIVE_KEYWORDS) {
    if (norm.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a search query is politically sensitive.
 */
export function isSearchQuerySensitive(query: string | null | undefined): boolean {
  return isPoliticallySensitive(query);
}

/**
 * Filters out any tracks matching politically sensitive keywords from search results.
 */
export function filterSensitiveTracks<T extends Partial<Track>>(tracks: T[] | null | undefined): T[] {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return [];
  }

  return tracks.filter((track) => {
    if (!track) return false;
    if (isPoliticallySensitive(track.title)) return false;
    if (isPoliticallySensitive(track.titleFa)) return false;
    if (isPoliticallySensitive(track.artistName)) return false;
    if (isPoliticallySensitive(track.artistNameFa)) return false;
    if (isPoliticallySensitive(track.album)) return false;
    if (isPoliticallySensitive(track.albumFa)) return false;
    return true;
  });
}

/**
 * Smart Cross-Platform Artist Identity Resolver
 *
 * Unifies artist identities across YouTube, SoundCloud, Spotify, and local catalog
 * tracks despite channel/uploader noise ("EXXEN Music", "OğuzCan", "- Topic"),
 * Persian/Arabic vs Latin script differences ("شایان یو" vs "Shayan Yo"),
 * and regional numerals/diacritics ("BLOK۳" vs "Blok3").
 */

import { cleanTitleString, normalizePersianChars } from "./lyricsCleaner";
import type { Track } from "./types";

const PERSIAN_ARABIC_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const TURKISH_LATIN_MAP: Record<string, string> = {
  "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g", "ş": "s", "Ş": "s",
  "ç": "c", "Ç": "c", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u",
  "ß": "ss", "æ": "ae", "œ": "oe",
};

const AGGREGATOR_CHANNEL_SET = new Set([
  "youtube",
  "soundcloud",
  "spotify",
  "artist",
  "various artists",
  "various",
  "unknown",
  "exxen",
  "exxen music",
  "radio javan",
  "radiojavan",
  "rj",
  "pmc",
  "pmc music",
  "bia2",
  "bia2music",
  "nex1",
  "nex1music",
  "navahang",
  "melobit",
  "rapfarsi",
  "persian rap",
  "vevo",
  "music",
  "records",
  "tv",
  "هنرمند",
  "خواننده",
  "ناشناس",
  "نامشخص",
  "رادیو جوان",
]);

interface KnownArtistEntry {
  key: string;
  en: string;
  fa: string;
  aliases: string[];
}

const KNOWN_ARTIST_DICTIONARY: KnownArtistEntry[] = [
  { key: "shayan_yo", en: "Shayan Yo", fa: "شایان یو", aliases: ["shayan yo", "shayanyo", "شایان یو"] },
  { key: "ho3ein", en: "Ho3ein", fa: "حصین", aliases: ["ho3ein", "hosein", "hossein", "حصین", "حسین"] },
  { key: "shayea", en: "Shayea", fa: "شایع", aliases: ["shayea", "mohammadreza shayea", "شایع", "محمدرضا شایع"] },
  { key: "yas", en: "Yas", fa: "یاس", aliases: ["yas", "yastunes", "یاس"] },
  { key: "reza_pishro", en: "Reza Pishro", fa: "رضا پیشرو", aliases: ["reza pishro", "pishro", "رضا پیشرو", "پیشرو"] },
  { key: "dorcci", en: "Dorcci", fa: "دورچی", aliases: ["dorcci", "dorci", "دورچی"] },
  { key: "mehrad_hidden", en: "Mehrad Hidden", fa: "مهراد هیدن", aliases: ["mehrad hidden", "hidden", "مهراد هیدن"] },
  { key: "homayoun_shajarian", en: "Homayoun Shajarian", fa: "همایون شجریان", aliases: ["homayoun shajarian", "homayoun", "همایون شجریان"] },
  { key: "sajad_shahi", en: "Sajad Shahi", fa: "سجاد شاهی", aliases: ["sajad shahi", "sajjad shahi", "سجاد شاهی"] },
  { key: "amir_tataloo", en: "Amir Tataloo", fa: "امیر تتلو", aliases: ["amir tataloo", "tataloo", "امیر تتلو", "تتلو"] },
  { key: "ali_sorena", en: "Ali Sorena", fa: "علی سورنا", aliases: ["ali sorena", "sorena", "علی سورنا", "سورنا"] },
  { key: "bahram", en: "Bahram", fa: "بهرام", aliases: ["bahram", "bahram nouraei", "بهرام", "بهرام نورایی"] },
  { key: "putak", en: "Pooria Putak", fa: "پوریا پوتک", aliases: ["putak", "pooria putak", "پوتک", "پوریا پوتک"] },
  { key: "hichkas", en: "Hichkas", fa: "هیچکس", aliases: ["hichkas", "soroush lashkari", "هیچکس"] },
  { key: "mohsen_chavoshi", en: "Mohsen Chavoshi", fa: "محسن چاوشی", aliases: ["mohsen chavoshi", "chavoshi", "محسن چاوشی", "چاوشی"] },
  { key: "mohsen_yeganeh", en: "Mohsen Yeganeh", fa: "محسن یگانه", aliases: ["mohsen yeganeh", "محسن یگانه"] },
  { key: "mohsen_ebrahimzadeh", en: "Mohsen Ebrahimzadeh", fa: "محسن ابراهیم‌زاده", aliases: ["mohsen ebrahimzadeh", "محسن ابراهیم زاده"] },
  { key: "haamim", en: "Haamim", fa: "حامیم", aliases: ["haamim", "hamim", "حامیم"] },
  { key: "siavash_ghomayshi", en: "Siavash Ghomayshi", fa: "سیاوش قمیشی", aliases: ["siavash ghomayshi", "ghomayshi", "سیاوش قمیشی", "قمیشی"] },
  { key: "shadmehr", en: "Shadmehr Aghili", fa: "شادمهر عقیلی", aliases: ["shadmehr", "shadmehr aghili", "شادمهر", "شادمهر عقیلی"] },
  { key: "ebi", en: "Ebi", fa: "ابی", aliases: ["ebi", "ebrahim hamedi", "ابی"] },
  { key: "moein", en: "Moein", fa: "معین", aliases: ["moein", "nasrollah moein", "معین"] },
  { key: "dariush", en: "Dariush", fa: "داریوش", aliases: ["dariush", "dariush eghbali", "داریوش"] },
  { key: "hayedeh", en: "Hayedeh", fa: "هایده", aliases: ["hayedeh", "haydeh", "هایده"] },
  { key: "mahasti", en: "Mahasti", fa: "مهستی", aliases: ["mahasti", "مهستی"] },
  { key: "googoosh", en: "Googoosh", fa: "گوگوش", aliases: ["googoosh", "گوگوش"] },
  { key: "chaartaar", en: "Chaartaar", fa: "چارتار", aliases: ["chaartaar", "chartar", "چارتار"] },
  { key: "macan_band", en: "Macan Band", fa: "ماکان بند", aliases: ["macan band", "macan", "ماکان بند"] },
  { key: "garsha_rezaei", en: "Garsha Rezaei", fa: "گرشا رضایی", aliases: ["garsha rezaei", "گرشا رضایی"] },
  { key: "sirvan_khosravi", en: "Sirvan Khosravi", fa: "سیروان خسروی", aliases: ["sirvan khosravi", "sirvan", "سیروان خسروی", "سیروان"] },
  { key: "alireza_talischi", en: "Alireza Talischi", fa: "علیرضا طلیسچی", aliases: ["alireza talischi", "talischi", "علیرضا طلیسچی", "طلیسچی"] },
  { key: "khalse", en: "Sepehr Khalse", fa: "سپهر خلسه", aliases: ["khalse", "sepehr khalse", "خلسه", "سپهر خلسه"] },
  { key: "behzad_leito", en: "Behzad Leito", fa: "بهزاد لیتو", aliases: ["behzad leito", "leito", "بهزاد لیتو", "لیتو"] },
  { key: "sohrab_mj", en: "Sohrab MJ", fa: "سهراب ام‌جی", aliases: ["sohrab mj", "mj", "سهراب ام جی"] },
  { key: "sijal", en: "Sijal", fa: "سیجل", aliases: ["sijal", "سیجل"] },
  { key: "alireza_jj", en: "Alireza JJ", fa: "علیرضا جی‌جی", aliases: ["alireza jj", "jj", "علیرضا جی جی"] },
  { key: "wantons", en: "The Wantons", fa: "وانتونز", aliases: ["wantons", "the wantons", "وانتونز"] },
  { key: "zedbazi", en: "Zedbazi", fa: "زدبازی", aliases: ["zedbazi", "زدبازی"] },
  { key: "blok3", en: "BLOK3", fa: "BLOK3", aliases: ["blok3", "blok 3", "بلوک ۳", "بلوک 3"] },
];

const ALIAS_LOOKUP = new Map<string, KnownArtistEntry>();
for (const entry of KNOWN_ARTIST_DICTIONARY) {
  for (const alias of entry.aliases) {
    ALIAS_LOOKUP.set(canonicalizeArtistString(alias), entry);
  }
}

export function canonicalizeArtistString(raw: string): string {
  if (!raw) return "";
  let s = raw
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_ARABIC_DIGITS[ch] ?? ch)
    .replace(/[ıİğĞşŞçÇöÖüÜßæœ]/g, (ch) => TURKISH_LATIN_MAP[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, " ")
    .replace(/\u200c/g, " ");

  s = normalizePersianChars(s).toLowerCase();
  return s.replace(/\s+/g, " ").trim();
}

export function cleanSingleArtistToken(raw: string): string {
  if (!raw) return "";
  let s = raw
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .replace(/\b(?:official\s*(?:channel|music|audio|video)?|channel|records|music\s*group|رسمی)\b/giu, " ")
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Keep only the primary artist before collaboration separators
  const primaryMatch = s.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|with|x|و)\s+|\s*[,،&×]\s*/i);
  if (primaryMatch[0] && primaryMatch[0].trim().length >= 2) {
    s = primaryMatch[0].trim();
  }
  return s;
}

export function isAggregatorOrGenericChannel(rawName: string): boolean {
  const norm = canonicalizeArtistString(rawName);
  if (!norm || norm.length <= 1) return true;
  if (AGGREGATOR_CHANNEL_SET.has(norm)) return true;
  if (
    /\b(?:radio\s*javan|exxen|vevo|topic|lyrics?|fan\s*page|remix|slowed|reverb|records|entertainment|channel|official\s*(?:tv|channel)|music\s*(?:tv|hub|world|channel))\b/i.test(
      norm,
    )
  ) {
    return true;
  }
  return false;
}

const PERSIAN_CONSONANTS: Record<string, string> = {
  ب: "b", پ: "p", ت: "t", ط: "t", ث: "s", س: "s", ص: "s",
  ج: "j", چ: "ch", ح: "h", ه: "h", خ: "kh", د: "d",
  ذ: "z", ز: "z", ر: "r", ژ: "zh", ش: "sh", ظ: "z", ض: "z",
  ع: "a", غ: "gh", ق: "gh", ف: "f", ک: "k", گ: "g",
  ل: "l", م: "m", ن: "n", و: "v", ی: "y", ا: "a",
};

export function toPhoneticSkeleton(raw: string): string {
  const norm = canonicalizeArtistString(cleanSingleArtistToken(raw));
  if (!norm) return "";

  const known = ALIAS_LOOKUP.get(norm);
  if (known) return known.key;

  let out = "";
  for (const ch of norm) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (ch >= "a" && ch <= "z") {
      out += ch;
    } else if (PERSIAN_CONSONANTS[ch]) {
      out += PERSIAN_CONSONANTS[ch];
    }
  }
  // Collapse doubled characters and vowel differences ("aa"->"a", "ee"->"i", "oo"->"u", drop internal weak vowels)
  const unified = out
    .replace(/([a-z0-9])\1+/g, "$1")
    .replace(/ph/g, "f")
    .replace(/qu|ck/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/[aeiou]/g, "");

  return unified.length >= 2 ? unified : out;
}

export function extractTrueArtist(
  track: Pick<Track, "title" | "titleFa" | "artistName" | "artistNameFa">,
): {
  displayName: string;
  displayNameFa?: string;
  canonicalKey: string;
} {
  const rawArtist = cleanSingleArtistToken(track.artistName || "");
  const rawArtistFa = cleanSingleArtistToken(track.artistNameFa || "");
  const cleanTitle = cleanTitleString(track.title || "");
  const cleanTitleFa = cleanTitleString(track.titleFa || "");

  let resolvedDisplay = rawArtist || rawArtistFa;
  let resolvedDisplayFa = rawArtistFa || undefined;

  // Check if title follows "Artist - Song" (common across YouTube, SoundCloud, Telegram/web mirrors)
  const titleParts = cleanTitle.split(/\s*[-–—|:]\s*/);
  if (titleParts.length >= 2) {
    const leftRaw = cleanSingleArtistToken(titleParts[0] || "");
    const rightRaw = cleanSingleArtistToken(titleParts.slice(1).join(" - "));
    const leftNorm = canonicalizeArtistString(leftRaw);
    const rightNorm = canonicalizeArtistString(rightRaw);
    const artistNorm = canonicalizeArtistString(rawArtist);

    const isLeftKnown = ALIAS_LOOKUP.has(leftNorm);
    const isLeftValidHeader =
      leftRaw.length >= 2 &&
      leftRaw.length <= 28 &&
      leftRaw.split(/\s+/).length <= 3 &&
      !/^(?:part|ep|track|vol|remix|intro|outro)\b/i.test(leftRaw);

    if (artistNorm && leftNorm && artistNorm === leftNorm) {
      resolvedDisplay = rawArtist;
    } else if (artistNorm && rightNorm && artistNorm === rightNorm) {
      resolvedDisplay = rightRaw;
    } else if (isAggregatorOrGenericChannel(rawArtist)) {
      if (isLeftValidHeader) {
        resolvedDisplay = leftRaw;
      }
    } else if (
      isLeftValidHeader &&
      (isLeftKnown ||
        (!artistNorm.includes(leftNorm) &&
          !leftNorm.includes(artistNorm) &&
          Boolean(rightRaw) &&
          !/^\d+$/.test(rightRaw) &&
          // Typical YouTube uploader channel override check (single handle/camelCase or channel marker)
          (/[®™©]|music|tv|channel|official|audio/i.test(track.artistName || "") ||
            /^[^\s]+$/.test((track.artistName || "").trim()) && /^[A-Za-z0-9]+$/.test(leftRaw.trim()))))
    ) {
      resolvedDisplay = leftRaw;
    }
  }

  // Also check titleFa if title had no split
  if (isAggregatorOrGenericChannel(resolvedDisplay) && cleanTitleFa.includes("-")) {
    const faParts = cleanTitleFa.split(/\s*[-–—|:]\s*/);
    const faLeft = cleanSingleArtistToken(faParts[0] || "");
    if (faLeft.length >= 2 && faLeft.length <= 28) {
      resolvedDisplay = faLeft;
      resolvedDisplayFa = faLeft;
    }
  }

  const finalNorm = canonicalizeArtistString(resolvedDisplay);
  const known = ALIAS_LOOKUP.get(finalNorm) || ALIAS_LOOKUP.get(canonicalizeArtistString(resolvedDisplayFa || ""));
  if (known) {
    return {
      displayName: known.en,
      displayNameFa: known.fa,
      canonicalKey: known.key,
    };
  }

  const skeleton = toPhoneticSkeleton(resolvedDisplay || resolvedDisplayFa || "");
  return {
    displayName: resolvedDisplay || resolvedDisplayFa || "Artist",
    displayNameFa: resolvedDisplayFa || resolvedDisplay || undefined,
    canonicalKey: skeleton || finalNorm || "unknown",
  };
}

function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      matches++;
      bigramsA.set(bg, count - 1);
    }
  }
  return (2 * matches) / (a.length + b.length - 2);
}

export interface ArtistCluster {
  key: string;
  displayName: string;
  displayNameFa?: string;
  tracks: Track[];
}

/**
 * Groups tracks belonging to the same underlying artist across scripts/platforms,
 * merging phonetic skeletons with Dice similarity >= 0.80.
 */
export function clusterTracksByArtist(tracks: Track[]): ArtistCluster[] {
  const clusters: ArtistCluster[] = [];

  for (const track of tracks) {
    const info = extractTrueArtist(track);
    if (!info.canonicalKey || info.canonicalKey === "unknown") continue;

    let target = clusters.find(
      (c) =>
        c.key === info.canonicalKey ||
        diceSimilarity(c.key, info.canonicalKey) >= 0.80,
    );

    if (!target) {
      target = {
        key: info.canonicalKey,
        displayName: info.displayName,
        displayNameFa: info.displayNameFa,
        tracks: [],
      };
      clusters.push(target);
    } else {
      // Prefer Persian display name when encountered across mixed script tracks
      if (!target.displayNameFa && info.displayNameFa) {
        target.displayNameFa = info.displayNameFa;
      }
      if (/^[^\x00-\x7F]+$/.test(target.displayName) && /^[\x20-\x7E]+$/.test(info.displayName)) {
        target.displayName = info.displayName;
      }
    }

    if (!target.tracks.some((t) => t.id === track.id)) {
      target.tracks.push(track);
    }
  }

  return clusters;
}

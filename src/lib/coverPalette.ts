import { resolveMediaUrl } from "./mobileBackend";

export interface CoverPalette {
  primaryHex: string;
  secondaryHex: string;
  ambientLeft: string;
  ambientRight: string;
  haloRgba: string;
  glassTint: string;
  isFallback: boolean;
}

const DEFAULT_FALLBACK_PALETTE: CoverPalette = {
  primaryHex: "#334155",
  secondaryHex: "#1E293B",
  ambientLeft: "rgba(22, 34, 30, 0.55)",
  ambientRight: "rgba(30, 26, 18, 0.50)",
  haloRgba: "rgba(255, 255, 255, 0.14)",
  glassTint: "rgba(12, 16, 18, 0.44)",
  isFallback: true,
};

const GENERIC_INDIGO_HEXES = new Set(["#6366f1", "#4f46e5", "#6366f1ff"]);
const paletteCache = new Map<string, CoverPalette>();
const MAX_CACHE_ENTRIES = 64;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const lig = clamp01(l);

  if (sat === 0) {
    const v = Math.round(lig * 255);
    return [v, v, v];
  }

  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const toChannel = (tInput: number): number => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return Math.round((p + (q - p) * 6 * t) * 255);
    if (t < 1 / 2) return Math.round(q * 255);
    if (t < 2 / 3) return Math.round((p + (q - p) * (2 / 3 - t) * 6) * 255);
    return Math.round(p * 255);
  };

  const hk = hue / 360;
  return [toChannel(hk + 1 / 3), toChannel(hk), toChannel(hk - 1 / 3)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

export function isGenericFallbackAccent(accent: string | undefined | null): boolean {
  if (!accent) return true;
  return GENERIC_INDIGO_HEXES.has(accent.trim().toLowerCase());
}

function buildPaletteFromHsls(
  primaryHsl: [number, number, number],
  secondaryHsl: [number, number, number],
  isFallback = false
): CoverPalette {
  const [h1, s1] = primaryHsl;
  const [h2, s2] = secondaryHsl;

  const pRgb = hslToRgb(h1, Math.min(0.86, Math.max(0.42, s1)), 0.44);
  const sRgb = hslToRgb(h2, Math.min(0.82, Math.max(0.36, s2)), 0.42);

  // Deep atmospheric stops for Apple-style Liquid Glass backdrop (high mood, zero chalky wash)
  const leftBg = hslToRgb(h1, Math.min(0.8, Math.max(0.42, s1 * 0.96)), 0.155);
  const rightBg = hslToRgb(h2, Math.min(0.76, Math.max(0.38, s2 * 0.92)), 0.165);
  const glassRgb = hslToRgb(h1, Math.min(0.58, Math.max(0.28, s1 * 0.75)), 0.13);

  return {
    primaryHex: rgbToHex(...pRgb),
    secondaryHex: rgbToHex(...sRgb),
    ambientLeft: `rgba(${leftBg[0]}, ${leftBg[1]}, ${leftBg[2]}, 0.82)`,
    ambientRight: `rgba(${rightBg[0]}, ${rightBg[1]}, ${rightBg[2]}, 0.78)`,
    haloRgba: `rgba(${pRgb[0]}, ${pRgb[1]}, ${pRgb[2]}, 0.48)`,
    glassTint: `rgba(${glassRgb[0]}, ${glassRgb[1]}, ${glassRgb[2]}, 0.44)`,
    isFallback,
  };
}

export function buildPaletteFromHex(accentHex: string | undefined | null): CoverPalette {
  if (isGenericFallbackAccent(accentHex)) {
    return DEFAULT_FALLBACK_PALETTE;
  }
  const rgb = hexToRgb(accentHex!);
  if (!rgb) return DEFAULT_FALLBACK_PALETTE;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.08) return DEFAULT_FALLBACK_PALETTE;
  const companionHue = (h + 38) % 360;
  return buildPaletteFromHsls([h, s, l], [companionHue, Math.max(0.28, s * 0.75), l], true);
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function extractPaletteFromPixels(rgba: Uint8ClampedArray): CoverPalette {
  if (!rgba || rgba.length < 4) return DEFAULT_FALLBACK_PALETTE;

  const BINS = 24;
  const binWeights = new Float64Array(BINS);
  const binHueSum = new Float64Array(BINS);
  const binSatSum = new Float64Array(BINS);
  const binLigSum = new Float64Array(BINS);
  const binCount = new Float64Array(BINS);

  const totalPixels = Math.floor(rgba.length / 4);
  const step = totalPixels > 2500 ? 4 : 1;

  let weightedNeutralSumL = 0;
  let neutralCount = 0;

  for (let p = 0; p < totalPixels; p += step) {
    const i = p * 4;
    const a = rgba[i + 3];
    if (a < 128) continue;

    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);

    // Reject only pitch-black crushed noise or pure blown-out white glare
    if (l < 0.04 || l > 0.94) continue;

    if (s < 0.14) {
      weightedNeutralSumL += l;
      neutralCount += 1;
      continue;
    }

    // Favour deeper rich area colors (greens, teals, navies, crimsons) cleanly alongside bright highlights
    const lumBell = 1 - Math.abs(l - 0.36) * 0.85;
    const weight = Math.pow(s, 0.72) * Math.max(0.4, lumBell) * (a / 255);
    const bin = Math.min(BINS - 1, Math.floor((h / 360) * BINS));

    binWeights[bin] += weight;
    binHueSum[bin] += h * weight;
    binSatSum[bin] += s * weight;
    binLigSum[bin] += l * weight;
    binCount[bin] += weight;
  }

  let bestBin = -1;
  let bestWeight = 0;
  for (let b = 0; b < BINS; b++) {
    if (binWeights[b] > bestWeight) {
      bestWeight = binWeights[b];
      bestBin = b;
    }
  }

  if (bestBin === -1 || bestWeight <= 0) {
    if (neutralCount > 0) {
      const avgL = weightedNeutralSumL / neutralCount;
      const monoLevel = Math.round(14 + avgL * 18);
      return {
        primaryHex: rgbToHex(monoLevel + 28, monoLevel + 32, monoLevel + 36),
        secondaryHex: rgbToHex(monoLevel + 18, monoLevel + 20, monoLevel + 22),
        ambientLeft: `rgba(${monoLevel}, ${monoLevel + 4}, ${monoLevel + 8}, 0.72)`,
        ambientRight: `rgba(${monoLevel + 6}, ${monoLevel + 6}, ${monoLevel + 4}, 0.68)`,
        haloRgba: "rgba(255, 255, 255, 0.18)",
        glassTint: "rgba(18, 20, 22, 0.44)",
        isFallback: false,
      };
    }
    return DEFAULT_FALLBACK_PALETTE;
  }

  const h1 = binHueSum[bestBin] / binCount[bestBin];
  const s1 = binSatSum[bestBin] / binCount[bestBin];
  const l1 = binLigSum[bestBin] / binCount[bestBin];

  // Pick a secondary hue cluster distinct from primary (>= 34deg apart) so dual-tone covers breathe naturally
  let secondBin = -1;
  let secondWeight = 0;
  for (let b = 0; b < BINS; b++) {
    if (binWeights[b] <= 0) continue;
    const candHue = binHueSum[b] / binCount[b];
    if (circularHueDistance(h1, candHue) >= 34 && binWeights[b] > secondWeight) {
      secondWeight = binWeights[b];
      secondBin = b;
    }
  }

  if (secondBin !== -1 && secondWeight >= bestWeight * 0.12) {
    const h2 = binHueSum[secondBin] / binCount[secondBin];
    const s2 = binSatSum[secondBin] / binCount[secondBin];
    const l2 = binLigSum[secondBin] / binCount[secondBin];
    // Anchor cooler / deeper tones on ambientLeft (behind white Lyrics) and warmer/brighter tones on ambientRight
    const isCoolHue = (hue: number) => hue >= 105 && hue <= 285;
    if (!isCoolHue(h1) && isCoolHue(h2)) {
      return buildPaletteFromHsls([h2, s2, l2], [h1, s1, l1], false);
    }
    return buildPaletteFromHsls([h1, s1, l1], [h2, s2, l2], false);
  }

  const shiftedHue = (h1 + 28) % 360;
  return buildPaletteFromHsls([h1, s1, l1], [shiftedHue, s1 * 0.72, l1 * 0.9], false);
}

export function clearCoverPaletteCache(): void {
  paletteCache.clear();
}

export async function extractCoverPalette(coverUrl: string): Promise<CoverPalette | null> {
  if (!coverUrl || typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const cached = paletteCache.get(coverUrl);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (result: CoverPalette | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const fullCoverUrl = resolveMediaUrl(coverUrl);
    try {
      const resolvedUrl = new URL(fullCoverUrl, window.location.origin);
      if (resolvedUrl.origin !== window.location.origin) {
        img.crossOrigin = "anonymous";
      }
    } catch {
      // Relative or malformed URLs load directly as same-origin
    }

    img.decoding = "async";
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const palette = extractPaletteFromPixels(imageData.data);
        if (paletteCache.size >= MAX_CACHE_ENTRIES) {
          const oldest = paletteCache.keys().next().value;
          if (oldest) paletteCache.delete(oldest);
        }
        paletteCache.set(coverUrl, palette);
        finish(palette);
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = fullCoverUrl;
  });
}

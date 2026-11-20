import { describe, expect, it } from "vitest";
import {
  buildPaletteFromHex,
  extractPaletteFromPixels,
  isGenericFallbackAccent,
  rgbToHsl,
} from "../lib/coverPalette";

function makePixelBlock(pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], idx) => {
    buf[idx * 4] = r;
    buf[idx * 4 + 1] = g;
    buf[idx * 4 + 2] = b;
    buf[idx * 4 + 3] = a;
  });
  return buf;
}

describe("coverPalette", () => {
  it("detects generic indigo fallback accent cleanly", () => {
    expect(isGenericFallbackAccent("#6366F1")).toBe(true);
    expect(isGenericFallbackAccent("#6366f1")).toBe(true);
    expect(isGenericFallbackAccent("")).toBe(true);
    expect(isGenericFallbackAccent("#059669")).toBe(false);
  });

  it("avoids turning generic #6366F1 fallback into purple ambient wash", () => {
    const palette = buildPaletteFromHex("#6366F1");
    expect(palette.isFallback).toBe(true);
    expect(palette.ambientLeft).not.toContain("99, 102, 241");
    expect(palette.glassTint).not.toContain("99, 102, 241");
  });

  it("builds emerald ambient palette from curated emerald track hex", () => {
    const palette = buildPaletteFromHex("#059669");
    expect(palette.isFallback).toBe(true);
    expect(palette.ambientLeft).toMatch(/^rgba\(/);
    // Primary hue should remain in emerald-green family (~140..170deg)
    const clean = palette.primaryHex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const [hue] = rgbToHsl(r, g, b);
    expect(hue).toBeGreaterThan(125);
    expect(hue).toBeLessThan(180);
  });

  it("extracts distinct emerald & warm amber clusters from Bezan-Baran-like pixel mix", () => {
    const pixels: Array<[number, number, number, number?]> = [];
    // Dark background foliage (crushed shadows should not override emerald/yellow)
    for (let i = 0; i < 40; i++) pixels.push([8, 12, 10, 255]);
    // Emerald poster tones
    for (let i = 0; i < 60; i++) pixels.push([28, 118, 66, 255]);
    // Warm golden shirt / title highlights
    for (let i = 0; i < 45; i++) pixels.push([222, 184, 38, 255]);

    const palette = extractPaletteFromPixels(makePixelBlock(pixels));
    expect(palette.isFallback).toBe(false);

    const parseHue = (hex: string) => {
      const c = hex.replace("#", "");
      return rgbToHsl(
        parseInt(c.slice(0, 2), 16),
        parseInt(c.slice(2, 4), 16),
        parseInt(c.slice(4, 6), 16)
      )[0];
    };

    const h1 = parseHue(palette.primaryHex);
    const h2 = parseHue(palette.secondaryHex);
    // Green ~145deg and Gold ~48deg
    expect(h1).toBeGreaterThan(110);
    expect(h1).toBeLessThan(175);
    expect(h2).toBeGreaterThan(25);
    expect(h2).toBeLessThan(75);
  });

  it("keeps cool emerald tone anchored on ambientLeft even when warm shirt pixels dominate saturation", () => {
    const pixels: Array<[number, number, number, number?]> = [];
    for (let i = 0; i < 65; i++) pixels.push([230, 195, 34, 255]); // Bright yellow shirt
    for (let i = 0; i < 40; i++) pixels.push([20, 108, 62, 255]);  // Emerald background

    const palette = extractPaletteFromPixels(makePixelBlock(pixels));
    const clean = palette.primaryHex.replace("#", "");
    const [primaryHue] = rgbToHsl(
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    );
    expect(primaryHue).toBeGreaterThan(105);
    expect(primaryHue).toBeLessThan(185);
  });

  it("handles empty or transparent pixel buffers safely", () => {
    expect(extractPaletteFromPixels(new Uint8ClampedArray(0)).isFallback).toBe(true);
    const transparent = makePixelBlock([
      [255, 0, 0, 0],
      [0, 255, 0, 20],
    ]);
    expect(extractPaletteFromPixels(transparent).isFallback).toBe(true);
  });

  it("handles monochrome artwork gracefully without crashing", () => {
    const mono = makePixelBlock([
      [60, 60, 60, 255],
      [140, 140, 140, 255],
      [180, 180, 180, 255],
    ]);
    const palette = extractPaletteFromPixels(mono);
    expect(palette.isFallback).toBe(false);
    expect(palette.ambientLeft).toMatch(/^rgba\(/);
  });
});

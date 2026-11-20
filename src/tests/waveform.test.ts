import { describe, expect, it } from "vitest";
import {
  computeWaveformBarCount,
  downsamplePeaks,
  generateFallbackWave,
} from "../lib/waveform";

describe("Waveform peak downsampling utilities", () => {
  it("generates bounded fallback bars when peaks array is empty", () => {
    const wave = downsamplePeaks([], 40);
    expect(wave).toHaveLength(40);
    for (const v of wave) {
      expect(v).toBeGreaterThanOrEqual(0.22);
      expect(v).toBeLessThanOrEqual(0.95);
    }
    expect(generateFallbackWave(1)).toHaveLength(1);
  });

  it("downsamples dense 72-peak track data cleanly into dock bar counts", () => {
    const dense = Array.from({ length: 72 }, (_, i) => (i % 4 === 0 ? 0.9 : 0.4));
    const mobileBars = downsamplePeaks(dense, computeWaveformBarCount(290, true));
    const desktopBars = downsamplePeaks(dense, computeWaveformBarCount(360, true));

    expect(mobileBars.length).toBeGreaterThanOrEqual(34);
    expect(mobileBars.length).toBeLessThanOrEqual(45);
    expect(desktopBars.length).toBeGreaterThanOrEqual(44);
    expect(desktopBars.length).toBeLessThanOrEqual(54);

    for (const v of [...mobileBars, ...desktopBars]) {
      expect(v).toBeGreaterThanOrEqual(0.22);
      expect(v).toBeLessThanOrEqual(0.98);
    }
  });

  it("handles sparse, zero, and malformed peak arrays without NaN or overflow", () => {
    const zeros = downsamplePeaks([0, 0, 0, 0], 16, 0.2);
    expect(zeros).toHaveLength(16);
    expect(zeros.every((v) => v === 0.2)).toBe(true);

    const malformed = downsamplePeaks([Number.NaN, -5, 10, 0.5], 20);
    expect(malformed).toHaveLength(20);
    for (const v of malformed) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0.22);
      expect(v).toBeLessThanOrEqual(0.98);
    }

    const single = downsamplePeaks([0.8], 10);
    expect(single).toHaveLength(10);
  });

  it("reveals musical phrasing on brickwalled tracks with a quiet fade-out bar", () => {
    // 71 loud samples in 0.88..0.99 plus 1 fade-out bar at 0.22 (matches Bezan Baran pattern)
    const brickwalled = Array.from({ length: 72 }, (_, i) =>
      i === 71 ? 0.22 : 0.88 + 0.11 * (0.5 + 0.5 * Math.sin(i * 0.45)),
    );
    const bars = downsamplePeaks(brickwalled, 44, 0.22);
    expect(bars).toHaveLength(44);
    const minBar = Math.min(...bars);
    const maxBar = Math.max(...bars);
    expect(maxBar - minBar).toBeGreaterThanOrEqual(0.45);
  });

  it("preserves phrase dynamics on low-RMS tracks dominated by a single transient spike", () => {
    // One 1.0 spike at index 0 while body phrases oscillate in 0.22..0.34 (matches Chera Rafti pattern)
    const highCrest = Array.from({ length: 72 }, (_, i) =>
      i === 0 ? 1.0 : 0.22 + 0.12 * (0.5 + 0.5 * Math.cos(i * 0.5)),
    );
    const bars = downsamplePeaks(highCrest, 44, 0.22);
    expect(bars).toHaveLength(44);
    const bodyBars = bars.slice(2);
    const spread = Math.max(...bodyBars) - Math.min(...bodyBars);
    expect(spread).toBeGreaterThanOrEqual(0.35);
  });
});

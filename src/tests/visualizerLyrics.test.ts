import { describe, expect, it } from "vitest";
import {
  computeSculptedWaveBar,
  shapeLiveSpectrumTargets,
} from "@/components/SpectrumVisualizer";
import {
  computeCenteredScrollTop,
  pickLyricScrollBehavior,
  shouldRunAutoScroll,
  shouldScrollContainerToTop,
} from "@/components/LyricsPanel";

describe("SpectrumVisualizer wave contour & 1/f spectral shaping", () => {
  it("produces multi-peak resting wave across left, middle, and right bars without monotonic ramp", () => {
    for (const barCount of [20, 24, 28]) {
      const bars = Array.from({ length: barCount }, (_, i) =>
        computeSculptedWaveBar(i, barCount, 0.95)
      );

      const third = Math.floor(barCount / 3);
      const leftMax = Math.max(...bars.slice(0, third));
      const midMax = Math.max(...bars.slice(third, third * 2));
      const rightMax = Math.max(...bars.slice(third * 2));

      expect(leftMax).toBeGreaterThan(0.5);
      expect(midMax).toBeGreaterThan(0.5);
      expect(rightMax).toBeGreaterThan(0.5);

      const dotsCount = bars.filter((v) => v <= 0.05).length;
      expect(dotsCount).toBeGreaterThan(0);

      // Should not be monotonically decreasing left-to-right
      const isMonotonicDesc = bars.every((v, idx) => idx === 0 || v <= bars[idx - 1] + 0.02);
      expect(isMonotonicDesc).toBe(false);
    }
  });

  it("shapes realistic 1/f decaying music FFT bins into an undulating multi-crest contour", () => {
    const fftBins = new Uint8Array(64);
    for (let k = 0; k < fftBins.length; k++) {
      // Heavy bass left bins (0..4 ~220), weaker upper frequencies (25..63 ~18..48)
      fftBins[k] = Math.max(10, Math.round(230 * Math.exp(-k / 11)));
    }

    const bandPeaks = new Float32Array([0.28, 0.26, 0.24, 0.22, 0.2]);
    let targets: number[] = [];
    // Simulate a few frames so AGC settles like live playback
    for (let frame = 0; frame < 8; frame++) {
      targets = shapeLiveSpectrumTargets(fftBins, 24, 0.95 + frame * 0.085, bandPeaks);
    }

    expect(targets).toHaveLength(24);
    for (const val of targets) {
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0.04);
      expect(val).toBeLessThanOrEqual(0.96);
    }

    const leftMax = Math.max(...targets.slice(0, 8));
    const midMax = Math.max(...targets.slice(8, 16));
    const rightMax = Math.max(...targets.slice(16, 24));
    expect(leftMax).toBeGreaterThan(0.45);
    expect(midMax).toBeGreaterThan(0.45);
    expect(rightMax).toBeGreaterThan(0.45);

    const minRightVsLeftRatio = rightMax / Math.max(0.01, leftMax);
    expect(minRightVsLeftRatio).toBeGreaterThan(0.55);
  });

  it("handles silent, empty, and boundary FFT inputs safely", () => {
    const emptyTargets = shapeLiveSpectrumTargets(new Uint8Array(0), 20, 0.5, new Float32Array(5));
    expect(emptyTargets).toHaveLength(20);
    emptyTargets.forEach((v) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0.04);
    });

    const singleBar = shapeLiveSpectrumTargets(new Uint8Array(64), 1, 0.5, new Float32Array(5));
    expect(singleBar).toHaveLength(1);
    expect(singleBar[0]).toBeGreaterThanOrEqual(0.04);
  });
});

describe("LyricsPanel auto-scroll & jump-to-top predicates", () => {
  it("suppresses auto-scroll whenever the user has scrolled away", () => {
    expect(shouldRunAutoScroll(true, false)).toBe(true);
    expect(shouldRunAutoScroll(true, true)).toBe(false);
    expect(shouldRunAutoScroll(false, false)).toBe(false);
    expect(shouldRunAutoScroll(false, true)).toBe(false);
  });

  it("identifies early cues <= 1 cleanly for scroll-to-top alignment", () => {
    expect(shouldScrollContainerToTop(-1)).toBe(true);
    expect(shouldScrollContainerToTop(0)).toBe(true);
    expect(shouldScrollContainerToTop(1)).toBe(true);
    expect(shouldScrollContainerToTop(2)).toBe(false);
    expect(shouldScrollContainerToTop(12)).toBe(false);
  });

  it("picks instant 'auto' snap on reduced-motion, initial sync, and large seek deltas (>1.25x container height)", () => {
    // Reduced motion always forces instant scroll
    expect(
      pickLyricScrollBehavior({
        reducedMotion: true,
        isInitialSync: false,
        deltaPx: 48,
        containerHeight: 600,
      }),
    ).toBe("auto");

    // Initial mount / track hydration sync always snaps immediately even for small deltas
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: true,
        deltaPx: 120,
        containerHeight: 600,
      }),
    ).toBe("auto");

    // Large forward seek jump (e.g. t=186s scrollTop=1906 when containerHeight=600) snaps immediately
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 1906,
        containerHeight: 600,
      }),
    ).toBe("auto");

    // Large backward seek jump also snaps immediately
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: -1400,
        containerHeight: 600,
      }),
    ).toBe("auto");

    // Just over the 1.25x threshold triggers instant snap
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 751,
        containerHeight: 600,
      }),
    ).toBe("auto");

    // Normal nearby line advances (and exact 1.25x boundary) use smooth scroll
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 750,
        containerHeight: 600,
      }),
    ).toBe("smooth");

    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 64,
        containerHeight: 600,
      }),
    ).toBe("smooth");

    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 0,
        containerHeight: 600,
      }),
    ).toBe("smooth");

    // Non-finite or degenerate inputs fail safely to instant snap
    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: Number.NaN,
        containerHeight: 600,
      }),
    ).toBe("auto");

    expect(
      pickLyricScrollBehavior({
        reducedMotion: false,
        isInitialSync: false,
        deltaPx: 120,
        containerHeight: 0,
      }),
    ).toBe("auto");
  });

  it("centers active line within scrollContainerRef and compensates for entry CSS scale without clamping drift", () => {
    expect(
      computeCenteredScrollTop({
        currentScrollTop: 0,
        containerTop: 100,
        containerRectHeight: 600,
        containerClientHeight: 600,
        containerScrollHeight: 3000,
        lineTop: 2170,
        lineHeight: 100,
      }),
    ).toBe(1820);

    // Entry animation scale(0.985) scales client rects uniformly without changing CSS scrollHeight
    const s = 0.985;
    expect(
      computeCenteredScrollTop({
        currentScrollTop: 0,
        containerTop: 100,
        containerRectHeight: 600 * s,
        containerClientHeight: 600,
        containerScrollHeight: 3000,
        lineTop: 100 + 2070 * s,
        lineHeight: 100 * s,
      }),
    ).toBe(1820);

    // Clamps cleanly at top (0) and maxScroll (scrollHeight - clientHeight)
    expect(
      computeCenteredScrollTop({
        currentScrollTop: 100,
        containerTop: 100,
        containerRectHeight: 600,
        containerClientHeight: 600,
        containerScrollHeight: 3000,
        lineTop: 50,
        lineHeight: 60,
      }),
    ).toBe(0);

    expect(
      computeCenteredScrollTop({
        currentScrollTop: 2000,
        containerTop: 100,
        containerRectHeight: 600,
        containerClientHeight: 600,
        containerScrollHeight: 2500,
        lineTop: 1000,
        lineHeight: 80,
      }),
    ).toBe(1900);

    // Degenerate zero height or NaN safely preserves non-negative currentScrollTop
    expect(
      computeCenteredScrollTop({
        currentScrollTop: 240,
        containerTop: 0,
        containerRectHeight: 0,
        containerClientHeight: 0,
        containerScrollHeight: 2000,
        lineTop: 500,
        lineHeight: 50,
      }),
    ).toBe(240);
  });
});

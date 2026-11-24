import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BC_MOTION,
  PillSquashModel,
  dampingFromRatio,
  expandedSymbolAlpha,
  expandedSymbolBlurPx,
  expandedSymbolScale,
  playerSkipPose,
  pullLift,
  rubberBand,
  smootherStep,
  stepSpring,
} from "@/bitchord/motion";

describe("BitChord Motion Physics & Contracts", () => {
  it("converges critically damped sheet spring without overshoot and handles large dt safely", () => {
    const damping = dampingFromRatio(BC_MOTION.SHEET_STIFFNESS, BC_MOTION.SHEET_DAMPING_RATIO);
    let pos = 800;
    let vel = 0;
    for (let i = 0; i < 120; i++) {
      [pos, vel] = stepSpring(pos, vel, 0, 1 / 60, BC_MOTION.SHEET_STIFFNESS, damping);
      expect(pos).toBeGreaterThanOrEqual(-0.01);
    }
    expect(Math.abs(pos)).toBeLessThan(0.5);

    // Large dt clamp should never blow up numerically
    const [safePos, safeVel] = stepSpring(100, 0, 0, 2.0, BC_MOTION.SHEET_STIFFNESS, damping);
    expect(Number.isFinite(safePos)).toBe(true);
    expect(Number.isFinite(safeVel)).toBe(true);
    expect(Math.abs(safePos)).toBeLessThan(100);
  });

  it("computes underdamped tab and play/pause springs that overshoot slightly and settle", () => {
    const damping = dampingFromRatio(BC_MOTION.EXP_PLAY_STIFFNESS, BC_MOTION.EXP_PLAY_DAMPING_RATIO);
    let pos = 0;
    let vel = 0;
    let maxSeen = 0;
    for (let i = 0; i < 120; i++) {
      [pos, vel] = stepSpring(pos, vel, 1, 1 / 60, BC_MOTION.EXP_PLAY_STIFFNESS, damping);
      if (pos > maxSeen) maxSeen = pos;
    }
    expect(maxSeen).toBeGreaterThan(1.0);
    expect(Math.abs(pos - 1)).toBeLessThan(0.01);
  });

  it("evaluates rubberBand and pullLift monotonically and sublinearly", () => {
    expect(rubberBand(0, 500)).toBe(0);
    const r50 = rubberBand(50, 500);
    const r200 = rubberBand(200, 500);
    expect(r50).toBeGreaterThan(0);
    expect(r200).toBeGreaterThan(r50);
    expect(r200).toBeLessThan(200);
    expect(rubberBand(-100, 500)).toBeCloseTo(-rubberBand(100, 500), 6);

    expect(pullLift(0)).toBe(0);
    expect(pullLift(-10)).toBe(0);
    const p40 = pullLift(40);
    const p160 = pullLift(160);
    expect(p40).toBeGreaterThan(0);
    expect(p40).toBeLessThan(40);
    expect(p160).toBeGreaterThan(p40);
    expect(p160).toBeLessThan(160);
  });

  it("evaluates 3-arrow skip conveyor pose across boundaries", () => {
    const start = playerSkipPose(0);
    expect(start.frontScale).toBe(1);
    expect(start.frontAlpha).toBe(1);
    expect(start.survivorTravel).toBe(0);
    expect(start.newScale).toBe(0);

    const mid = playerSkipPose(0.5);
    expect(mid.frontScale).toBe(0);
    expect(mid.frontAlpha).toBe(0);
    expect(mid.survivorTravel).toBeGreaterThan(0.5);
    expect(mid.newScale).toBeGreaterThan(0);
    expect(mid.newScale).toBeLessThan(1);

    const settled = playerSkipPose(BC_MOTION.SKIP_SETTLED);
    expect(settled.survivorTravel).toBeCloseTo(1, 5);
    expect(settled.newScale).toBeCloseTo(1, 5);
    expect(settled.newAlpha).toBeCloseTo(1, 5);
  });

  it("evaluates expanded play/pause helpers and quintic smootherStep", () => {
    expect(expandedSymbolScale(0)).toBe(BC_MOTION.EXP_PLAY_MIN_SCALE);
    expect(expandedSymbolScale(1.2)).toBe(BC_MOTION.EXP_PLAY_MAX_SCALE);
    expect(expandedSymbolAlpha(0)).toBe(0);
    expect(expandedSymbolAlpha(0.5)).toBeCloseTo(0.5, 5);
    expect(expandedSymbolAlpha(1)).toBe(1);
    expect(expandedSymbolBlurPx(0, 38)).toBeCloseTo(38 * BC_MOTION.EXP_PLAY_BLUR_FRAC, 5);
    expect(expandedSymbolBlurPx(1, 38)).toBe(0);

    expect(smootherStep(0)).toBe(0);
    expect(smootherStep(0.5)).toBeCloseTo(0.5, 5);
    expect(smootherStep(1)).toBe(1);
  });

  it("bounds PillSquashModel acceleration deformation within [-0.12, 0.12] and resets cleanly", () => {
    const model = new PillSquashModel();
    model.start();
    expect(model.isTracking).toBe(true);
    let lastVal = 0;
    for (let i = 0; i < 15; i++) {
      // Quadratic accelerating trajectory x = 2000 * t^2
      const t = i * 0.016;
      lastVal = model.track(2000 * t * t, t, 0.016);
      expect(lastVal).toBeGreaterThanOrEqual(-0.12);
      expect(lastVal).toBeLessThanOrEqual(0.12);
    }
    expect(lastVal).toBeGreaterThan(0);
    model.stop();
    expect(model.isTracking).toBe(false);
  });

  it("enforces AutoMix deduplication, Liquid Glass translucency, output glyphs, and seamless artist fade", () => {
    const nowPlayingSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordNowPlaying.tsx"),
      "utf8",
    );
    expect(nowPlayingSrc).not.toContain("ساندیفای میکس در حال اجرا");
    expect(nowPlayingSrc).toContain("bc-automix-bar");
    expect(nowPlayingSrc).toContain("BitChordOutputGlyph");
    expect(nowPlayingSrc).toContain("BC_MOTION.SHEET_STIFFNESS");

    const shellSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordShell.tsx"),
      "utf8",
    );
    expect(shellSrc).toContain("PillSquashModel");
    expect(shellSrc).toContain("draggable={false}");
    expect(shellSrc).toContain("bc-bottom-fade-scrim");
    expect(shellSrc).toContain("bc-page-enter");

    const artistSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordArtistSheet.tsx"),
      "utf8",
    );
    expect(artistSrc).toContain("bc-artist-hero-mask");
    expect(artistSrc).toContain("BitChordPlayPauseGlyph");
    expect(artistSrc).toContain("#09090b 100%");
    expect(artistSrc).not.toContain("aspect-square bg-slate-800");
  });
});

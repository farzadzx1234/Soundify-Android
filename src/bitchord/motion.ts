"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BitChord Motion & Spring Physics Constants
 * Ported directly from upstream BitChord:
 * - FloatingBottomBar.kt (GlassSpring, STRETCH, SQUASH)
 * - GlassSelectionPill.kt (TRAVEL/LIFT/MATERIAL springs, PillSquashModel, 1/240s substeps)
 * - PlayerSheetMotion.kt (SLIDE_STIFFNESS = 195, critically damped)
 * - PlayerPlayPauseMotion.kt & ExpandedPlayPauseMotion.kt
 * - PlayerSkipMotion.kt (DurationMs = 600, FrontGone = 0.35, NewOnset = 0.28, Settled = 0.90)
 * - IosOverscroll.kt (rubberBandConstant = 0.55, normalBounceStiffness = 247)
 * - MiniPlayer.kt (pullLift)
 */

export const BC_MOTION = {
  // Floating Tab Bar Pill (GlassSelectionPill.kt & FloatingBottomBar.kt)
  TAB_TRAVEL_STIFFNESS: 280,
  TAB_TRAVEL_DAMPING: 31.4,
  TAB_LIFT_STIFFNESS: 250,
  TAB_LIFT_DAMPING_X: 19.0,
  TAB_LIFT_DAMPING_Y: 22.1,
  TAB_MATERIAL_STIFFNESS: 1000,
  TAB_MATERIAL_DAMPING: 63.3,
  TAB_STRETCH: 0.16,
  TAB_SQUASH: 0.5,
  TAB_HANDOVER_START: 0.92,
  TAB_ICON_POP_STIFFNESS: 320,
  TAB_ICON_POP_DAMPING_RATIO: 0.72,

  // Player Sheet Open/Close (PlayerSheetMotion.kt)
  SHEET_STIFFNESS: 195,
  SHEET_DAMPING_RATIO: 1.0, // DampingRatioNoBouncy (critically damped)
  SHEET_SETTLED_PX: 0.5,

  // MiniPlayer Pull Lift (MiniPlayer.kt)
  PULL_LIFT_RATE: 0.5,
  PULL_LIFT_EASE_PX: 72,
  PULL_SETTLE_STIFFNESS: 220,
  PULL_SETTLE_DAMPING_RATIO: 0.65,

  // Artwork Scale (NowPlayingScreen.kt)
  ART_MOBILE_STIFFNESS: 140,
  ART_MOBILE_DAMPING_RATIO: 0.75, // DampingRatioLowBouncy
  ART_DESKTOP_DURATION_MS: 500,

  // Expanded Play/Pause (ExpandedPlayPauseMotion.kt)
  EXP_PLAY_STIFFNESS: 170,
  EXP_PLAY_DAMPING_RATIO: 0.68,
  EXP_PLAY_MIN_SCALE: 0.35,
  EXP_PLAY_MAX_SCALE: 1.08,
  EXP_PLAY_BLUR_FRAC: 0.16,
  EXP_PLAY_PRESS_SCALE: 0.9,

  // Mini Play/Pause (PlayerPlayPauseMotion.kt)
  MINI_DIP_SCALE: 0.12,
  MINI_DIP_STIFFNESS: 2500,
  MINI_RETURN_STIFFNESS: 322,
  MINI_RETURN_DAMPING_RATIO: 0.68,

  // Skip Conveyor (PlayerSkipMotion.kt)
  SKIP_DURATION_MS: 600,
  SKIP_FRONT_GONE: 0.35,
  SKIP_NEW_ONSET: 0.28,
  SKIP_SETTLED: 0.9,

  // iOS Rubber Band Overscroll (IosOverscroll.kt)
  RUBBER_BAND_C: 0.55,
  OVERSCROLL_STIFFNESS: 247,
} as const;

/** Convert Compose (stiffness, dampingRatio) to absolute damping coefficient c = 2 * zeta * sqrt(k). */
export function dampingFromRatio(stiffness: number, dampingRatio: number): number {
  return 2 * dampingRatio * Math.sqrt(Math.max(1, stiffness));
}

/**
 * Semi-implicit Euler spring integration in 1/240s substeps
 * (ported directly from GlassSelectionPill.kt `springStep`).
 */
export function stepSpring(
  x: number,
  vel: number,
  target: number,
  dtSec: number,
  stiffness: number,
  damping: number,
): [number, number] {
  let t = Math.min(0.05, Math.max(0, dtSec));
  let px = x;
  let pv = vel;
  const maxStep = 1 / 240;
  while (t > 0) {
    const step = t > maxStep ? maxStep : t;
    const accel = -stiffness * (px - target) - damping * pv;
    pv += accel * step;
    px += pv * step;
    t -= step;
  }
  return [px, pv];
}

/** UIKit rubber-band curve from IosOverscroll.kt. */
export function rubberBand(rawDistance: number, containerPx: number): number {
  if (rawDistance === 0) return 0;
  const dimension = containerPx > 0 ? containerPx : 1200;
  const distance = Math.abs(rawDistance);
  const c = BC_MOTION.RUBBER_BAND_C;
  const banded = (1 - 1 / ((distance * c) / dimension + 1)) * (dimension / c);
  return banded * Math.sign(rawDistance);
}

/** Mini-player rubber-band vertical lift during upward pull (MiniPlayer.kt `pullLift`). */
export function pullLift(pulledPx: number, easePx = BC_MOTION.PULL_LIFT_EASE_PX): number {
  if (pulledPx <= 0 || easePx <= 0) return 0;
  return BC_MOTION.PULL_LIFT_RATE * 2 * easePx * (Math.sqrt(1 + pulledPx / easePx) - 1);
}

export interface SkipPose {
  frontScale: number;
  frontAlpha: number;
  survivorTravel: number;
  newScale: number;
  newAlpha: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function skipSmoothStep(progress: number): number {
  const t = clamp01(progress);
  return t * t * (3 - 2 * t);
}

function skipTravel(progress: number): number {
  const t = clamp01(progress);
  return t + t * t * (1 - t);
}

/** Pure, non-overshooting 3-arrow conveyor pose from PlayerSkipMotion.kt. */
export function playerSkipPose(progress: number): SkipPose {
  const p = clamp01(progress);
  const contraction = clamp01(p / BC_MOTION.SKIP_FRONT_GONE);
  const frontScale = 1 - skipSmoothStep(contraction);
  const frontAlpha = 1 - skipSmoothStep(contraction * contraction);
  const travel = skipTravel(p / BC_MOTION.SKIP_SETTLED);
  const growth = skipSmoothStep(
    (p - BC_MOTION.SKIP_NEW_ONSET) / (BC_MOTION.SKIP_SETTLED - BC_MOTION.SKIP_NEW_ONSET),
  );
  return {
    frontScale,
    frontAlpha,
    survivorTravel: travel,
    newScale: growth,
    newAlpha: growth,
  };
}

/** ExpandedPlayPauseMotion.kt helpers */
export function expandedSymbolScale(weight: number): number {
  return Math.min(BC_MOTION.EXP_PLAY_MAX_SCALE, Math.max(BC_MOTION.EXP_PLAY_MIN_SCALE, weight));
}

export function expandedSymbolAlpha(weight: number): number {
  const w = clamp01(weight);
  return w * w * (3 - 2 * w);
}

export function expandedSymbolBlurPx(weight: number, iconSizePx: number): number {
  return iconSizePx * BC_MOTION.EXP_PLAY_BLUR_FRAC * (1 - clamp01(weight));
}

/** Quintic smootherstep (6t^5 - 15t^4 + 10t^3) from DetailScreen.kt / FADE_CURVE_STOPS. */
export function smootherStep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Acceleration-coupled squash & stretch model ported from GlassSelectionPill.kt `PillSquashModel`.
 * Tracks tab-step position over a 0.3s window, differentiates twice to get acceleration,
 * and returns deformation in [-0.12, +0.12] so the pill stretches on launch and squashes on arrival.
 */
export class PillSquashModel {
  private history: Array<[number, number]> = [];
  public isTracking = false;
  private value = 0;

  private static readonly SAMPLE_WINDOW = 0.3;
  private static readonly SENSITIVITY = 0.00007;
  private static readonly MAX_DEFORMATION = 0.12;
  private static readonly RESPONSE_TIME = 0.18;

  start(): void {
    this.history = [];
    this.value = 0;
    this.isTracking = true;
  }

  stop(): void {
    this.isTracking = false;
    this.history = [];
    this.value = 0;
  }

  track(xPx: number, nowSec: number, dtSec: number): number {
    if (!this.isTracking) return this.value;
    this.history.push([xPx, nowSec]);
    const cutoff = nowSec - PillSquashModel.SAMPLE_WINDOW;
    while (this.history.length > 0 && this.history[0][1] < cutoff) {
      this.history.shift();
    }
    const raw = Math.max(
      -PillSquashModel.MAX_DEFORMATION,
      Math.min(PillSquashModel.MAX_DEFORMATION, this.averageAcceleration() * PillSquashModel.SENSITIVITY),
    );
    const ease = clamp01(dtSec / PillSquashModel.RESPONSE_TIME);
    this.value += (raw - this.value) * ease;
    return this.value;
  }

  private averageAcceleration(): number {
    if (this.history.length < 3) return 0;
    const velocities: Array<[number, number]> = [];
    for (let i = 1; i < this.history.length; i++) {
      const dt = this.history[i][1] - this.history[i - 1][1];
      if (dt <= 0) continue;
      velocities.push([
        (this.history[i][0] - this.history[i - 1][0]) / dt,
        (this.history[i][1] + this.history[i - 1][1]) / 2,
      ]);
    }
    if (velocities.length < 2) return 0;
    let total = 0;
    let count = 0;
    for (let i = 1; i < velocities.length; i++) {
      const dt = velocities[i][1] - velocities[i - 1][1];
      if (dt <= 0) continue;
      total += (velocities[i][0] - velocities[i - 1][0]) / dt;
      count += 1;
    }
    return count === 0 ? 0 : total / count;
  }
}

/** Reactive prefers-reduced-motion hook. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

/**
 * Imperative RAF spring animator that drives a DOM callback at 60-120fps
 * without triggering React re-renders per frame.
 */
export function useSpringDriver(
  initialValue: number,
  stiffness: number,
  dampingRatio: number,
  onFrame: (value: number, velocity: number, settled: boolean) => void,
  precision = 0.001,
) {
  const posRef = useRef(initialValue);
  const velRef = useRef(0);
  const targetRef = useRef(initialValue);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (nextTarget: number, initialVelocity?: number, immediate = false) => {
      targetRef.current = nextTarget;
      if (initialVelocity !== undefined) {
        velRef.current = initialVelocity;
      }
      if (immediate) {
        stop();
        posRef.current = nextTarget;
        velRef.current = 0;
        onFrameRef.current(nextTarget, 0, true);
        return;
      }
      if (rafRef.current !== null) return;
      lastTimeRef.current = performance.now();
      const damping = dampingFromRatio(stiffness, dampingRatio);

      const loop = (now: number) => {
        const dt = (now - lastTimeRef.current) / 1000;
        lastTimeRef.current = now;
        const [nx, nv] = stepSpring(
          posRef.current,
          velRef.current,
          targetRef.current,
          dt,
          stiffness,
          damping,
        );
        posRef.current = nx;
        velRef.current = nv;

        const settled =
          Math.abs(nx - targetRef.current) < precision && Math.abs(nv) < precision * 15;
        if (settled) {
          posRef.current = targetRef.current;
          velRef.current = 0;
          rafRef.current = null;
          onFrameRef.current(targetRef.current, 0, true);
          return;
        }
        onFrameRef.current(nx, nv, false);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [dampingRatio, precision, stiffness, stop],
  );

  const setImmediate = useCallback(
    (value: number) => {
      stop();
      posRef.current = value;
      targetRef.current = value;
      velRef.current = 0;
      onFrameRef.current(value, 0, true);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return {
    animateTo,
    setImmediate,
    stop,
    getValue: () => posRef.current,
    getVelocity: () => velRef.current,
  };
}

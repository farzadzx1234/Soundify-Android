"use client";

import React, { useEffect, useRef } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { isAppInForeground, subscribeToAppState } from "@/lib/androidBridge";

const BAND_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.08],
  [0.08, 0.19],
  [0.19, 0.36],
  [0.36, 0.56],
  [0.56, 0.8],
];
const BAND_TILT_GAINS = [0.84, 1.0, 1.24, 1.62, 2.15] as const;
const BAR_BAND_CYCLE = [3, 1, 0, 2, 4, 2, 0, 1, 4, 3] as const;

export function computeSculptedWaveBar(index: number, barCount: number, phase: number): number {
  const safeCount = Math.max(2, barCount);
  const u = index / (safeCount - 1);
  const waveA = 0.5 + 0.5 * Math.sin(u * Math.PI * 6.4 + phase * 1.15);
  const waveB = 0.5 + 0.5 * Math.sin(u * Math.PI * 10.6 - phase * 0.85 + 1.15);
  const waveC = 0.5 + 0.5 * Math.cos(u * Math.PI * 3.2 + phase * 0.52 - 0.55);
  const mixed = waveA * 0.44 + waveB * 0.34 + waveC * 0.22;
  if (mixed < 0.36) return 0.04;
  if (mixed < 0.49) return 0.14 + ((mixed - 0.36) / 0.13) * 0.18;
  return Math.min(0.95, 0.32 + Math.pow((mixed - 0.49) / 0.51, 0.88) * 0.63);
}

export function shapeLiveSpectrumTargets(
  data: ArrayLike<number>,
  barCount: number,
  phase: number,
  bandPeaks: Float32Array,
): number[] {
  const safeCount = Math.max(1, barCount);
  const len = data.length;
  const bandEnergy = new Float32Array(5);

  if (len > 0) {
    for (let b = 0; b < 5; b++) {
      const [startRatio, endRatio] = BAND_RANGES[b];
      const start = Math.min(len - 1, Math.floor(startRatio * len));
      const end = Math.max(start + 1, Math.min(len, Math.ceil(endRatio * len)));
      let sum = 0;
      let peak = 0;
      for (let k = start; k < end; k++) {
        const val = (data[k] ?? 0) / 255;
        sum += val;
        if (val > peak) peak = val;
      }
      const avg = sum / Math.max(1, end - start);
      const weighted = (avg * 0.58 + peak * 0.42) * BAND_TILT_GAINS[b];
      const prevPeak = bandPeaks[b] || 0.22;
      const nextPeak = Math.max(0.16, prevPeak * 0.985, weighted);
      bandPeaks[b] = nextPeak;
      bandEnergy[b] = Math.min(1, weighted / nextPeak);
    }
  }

  const overallEnergy = Math.min(
    1,
    bandEnergy[0] * 0.22 +
      bandEnergy[1] * 0.24 +
      bandEnergy[2] * 0.26 +
      bandEnergy[3] * 0.16 +
      bandEnergy[4] * 0.12,
  );

  const targets: number[] = new Array(safeCount);
  for (let i = 0; i < safeCount; i++) {
    const bandIdx = BAR_BAND_CYCLE[i % BAR_BAND_CYCLE.length];
    const neighborBand = bandEnergy[(bandIdx + 2) % 5];
    const localEnergy = Math.min(1, bandEnergy[bandIdx] * 0.72 + neighborBand * 0.28);
    const carrier = computeSculptedWaveBar(i, safeCount, phase);
    const driven = carrier * (0.42 + 0.58 * (0.45 * overallEnergy + 0.55 * localEnergy));
    targets[i] =
      carrier <= 0.05 && localEnergy < 0.72
        ? 0.04
        : Math.max(0.04, Math.min(0.96, Math.pow(driven, 0.92)));
  }
  return targets;
}

export function SpectrumVisualizer({
  className = "",
  align = "bottom",
}: {
  className?: string;
  align?: "bottom" | "center";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isVisibleRef = useRef<boolean>(true);
  const { analyserNode, isPlaying, visualizerEnabled } = usePlayer();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!visualizerEnabled) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    let barCount = 24;
    let barWidth = 5 * dpr;
    let gap = 5 * dpr;
    let startX = 0;
    let radius = 2.5 * dpr;
    let grad = ctx.createLinearGradient(0, 0, 0, 1);
    const smoothedBars = new Float32Array(32);

    const configureMetrics = () => {
      const rect = canvas.getBoundingClientRect();
      const cssWidth = Math.max(96, rect.width || 300);
      const cssHeight = Math.max(14, rect.height || 36);
      const targetW = Math.round(cssWidth * dpr);
      const targetH = Math.round(cssHeight * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      // Bold capsule dots & peaks matching Apple Sing 1C visualizer silhouette
      barCount = Math.max(20, Math.min(28, Math.floor((cssWidth + 4) / 11)));
      const pitch = canvas.width / barCount;
      gap = Math.max(3.2 * dpr, pitch * 0.48);
      barWidth = Math.max(2.6 * dpr, Math.min(5.2 * dpr, (canvas.width - gap * (barCount - 1)) / barCount));
      const totalSpan = barCount * barWidth + (barCount - 1) * gap;
      startX = Math.max(0, (canvas.width - totalSpan) / 2);
      radius = barWidth / 2;

      grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, "#FACC15");
      grad.addColorStop(0.28, "#BEF264");
      grad.addColorStop(0.62, "#34D399");
      grad.addColorStop(1, "#059669");
    };

    configureMetrics();
    const hasRoundRect = typeof ctx.roundRect === "function";

    const isMobile =
      typeof window !== "undefined" &&
      (window.innerWidth <= 768 || window.matchMedia("(pointer: coarse)").matches);
    const frameInterval = isMobile ? 1000 / 30 : 1000 / 60;

    const drawBars = (values: Float32Array, alpha: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.fillStyle = grad;
      ctx.globalAlpha = alpha;
      // High-performance rendering: bypass expensive canvas gaussian shadow passes on mobile/touch screens
      if (!isMobile) {
        ctx.shadowColor = "rgba(132, 204, 22, 0.28)";
        ctx.shadowBlur = 5 * dpr;
      }
      ctx.beginPath();
      for (let i = 0; i < barCount; i++) {
        const norm = Math.max(0.04, Math.min(0.96, values[i]));
        const barH = Math.max(barWidth, barWidth + norm * Math.max(0, canvas.height * 0.92 - barWidth));
        const x = startX + i * (barWidth + gap);
        const y = align === "center" ? (canvas.height - barH) / 2 : canvas.height - barH;
        if (hasRoundRect) {
          ctx.roundRect(x, y, barWidth, barH, radius);
        } else {
          ctx.rect(x, y, barWidth, barH);
        }
      }
      ctx.fill();
      ctx.restore();
    };

    const drawRestingFrame = () => {
      const resting = new Float32Array(barCount);
      for (let i = 0; i < barCount; i++) {
        resting[i] = computeSculptedWaveBar(i, barCount, 0.95);
      }
      drawBars(resting, 0.92);
    };

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            configureMetrics();
            if (!isPlaying || reducedMotion) drawRestingFrame();
          })
        : null;
    ro?.observe(canvas);

    // Resting equalizer bars when paused or reduced-motion so stage retains visual rhythm
    if (!isPlaying || reducedMotion) {
      drawRestingFrame();
      return () => {
        ro?.disconnect();
      };
    }

    let rafId = 0;
    let lastDrawTime = 0;
    const bins = analyserNode ? analyserNode.frequencyBinCount : 32;
    const data = new Uint8Array(bins);
    const bandPeaks = new Float32Array([0.28, 0.26, 0.24, 0.22, 0.2]);
    let tick = 0.95;

    const draw = (now: number) => {
      // Immediately cancel animation frames if document is hidden, offscreen, or app is in background/multitasking
      if (document.hidden || !isVisibleRef.current || !isAppInForeground()) {
        rafId = 0;
        return;
      }

      const elapsed = now - lastDrawTime;
      if (elapsed < frameInterval) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      lastDrawTime = now - (elapsed % frameInterval);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let hasSignal = false;
      if (analyserNode) {
        analyserNode.getByteFrequencyData(data);
        const scanMax = Math.min(data.length, 48);
        for (let k = 0; k < scanMax; k++) {
          if (data[k] > 3) {
            hasSignal = true;
            break;
          }
        }
      }

      tick += 0.085;
      const targets = hasSignal ? shapeLiveSpectrumTargets(data, barCount, tick, bandPeaks) : null;

      for (let i = 0; i < barCount; i++) {
        const target = targets ? targets[i] : computeSculptedWaveBar(i, barCount, tick);
        const prev = smoothedBars[i] || 0;
        const speed = target > prev ? 0.48 : 0.24;
        smoothedBars[i] = prev + (target - prev) * speed;
      }

      drawBars(smoothedBars, 0.96);

      rafId = requestAnimationFrame(draw);
    };

    const startLoop = () => {
      if (!rafId && !document.hidden && isVisibleRef.current && isAppInForeground()) {
        lastDrawTime = performance.now();
        rafId = requestAnimationFrame(draw);
      }
    };

    const stopLoop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const onVisibility = () => {
      if (document.hidden || !isAppInForeground()) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isVisibleRef.current = entry?.isIntersecting ?? true;
          if (isVisibleRef.current && isAppInForeground()) {
            startLoop();
          } else {
            stopLoop();
          }
        },
        { threshold: 0.05 },
      );
      observer.observe(canvas);
    }

    document.addEventListener("visibilitychange", onVisibility);
    const unsubAppState = subscribeToAppState((inForeground) => {
      if (inForeground) {
        startLoop();
      } else {
        stopLoop();
      }
    });

    startLoop();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubAppState();
      if (observer) observer.disconnect();
      ro?.disconnect();
      stopLoop();
    };
  }, [analyserNode, align, isPlaying, visualizerEnabled]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`w-full h-14 opacity-90 ${className}`}
    />
  );
}

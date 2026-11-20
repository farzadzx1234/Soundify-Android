"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/lrc";
import { computeWaveformBarCount, downsamplePeaks } from "@/lib/waveform";
import type { TrackComment } from "@/lib/types";

interface WaveformScrubberProps {
  peaks: number[];
  durationSec: number;
  currentTimeSec: number;
  accentColor?: string;
  comments?: TrackComment[];
  onSeek: (seconds: number) => void;
  ariaLabel?: string;
  variant?: "default" | "dock";
  showTimestamps?: boolean;
  className?: string;
}

export function WaveformScrubber({
  peaks,
  durationSec,
  currentTimeSec,
  accentColor = "#6366F1",
  comments = [],
  onSeek,
  ariaLabel = "Audio waveform seek bar",
  variant = "default",
  showTimestamps = true,
  className = "",
}: WaveformScrubberProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [hoveredComment, setHoveredComment] = useState<TrackComment | null>(null);
  const draggingRef = useRef(false);

  const safeDuration = Math.max(1, durationSec);
  const progressRatio = Math.max(0, Math.min(1, currentTimeSec / safeDuration));
  const isDock = variant === "dock";
  const [canvasCssSize, setCanvasCssSize] = useState<{ w: number; h: number }>({
    w: isDock ? 320 : 560,
    h: isDock ? 34 : 72,
  });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextW = Math.round(rect.width);
        const nextH = Math.round(rect.height);
        setCanvasCssSize((prev) =>
          prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH },
        );
      }
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const targetBarCount = useMemo(
    () => computeWaveformBarCount(canvasCssSize.w, isDock),
    [canvasCssSize.w, isDock],
  );

  const bars = useMemo(
    () => downsamplePeaks(peaks, targetBarCount, isDock ? 0.22 : 0.16),
    [peaks, targetBarCount, isDock],
  );

  const lastDrawnKeyRef = useRef<string>("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const targetPxW = Math.max(120, Math.round(canvasCssSize.w * dpr));
    const targetPxH = Math.max(24, Math.round(canvasCssSize.h * dpr));

    if (canvas.width !== targetPxW || canvas.height !== targetPxH) {
      canvas.width = targetPxW;
      canvas.height = targetPxH;
      lastDrawnKeyRef.current = "";
    }

    const quantizedProgress = Math.round(progressRatio * 400);
    const quantizedHover = hoverRatio === null ? -1 : Math.round(hoverRatio * 400);
    const drawKey = `${targetPxW}x${targetPxH}:${bars.length}:${quantizedProgress}:${quantizedHover}:${accentColor}:${variant}`;
    if (lastDrawnKeyRef.current === drawKey) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      lastDrawnKeyRef.current = drawKey;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const n = bars.length;
      const gap = Math.max(2.6 * dpr, (w / Math.max(1, n)) * (isDock ? 0.52 : 0.44));
      const barW = Math.max(2 * dpr, Math.min(3.8 * dpr, (w - gap * Math.max(0, n - 1)) / Math.max(1, n)));
      const totalSpan = n * barW + Math.max(0, n - 1) * gap;
      const startX = Math.max(0, (w - totalSpan) / 2);
      const radius = Math.min(barW / 2, 3 * dpr);
      const hasRoundRect = typeof ctx.roundRect === "function";

      for (let idx = 0; idx < n; idx++) {
        const barRatio = (idx + 0.5) / n;
        const played = barRatio <= progressRatio;
        const hovered = hoverRatio !== null && barRatio <= hoverRatio;
        const heightPct = Math.max(isDock ? 0.16 : 0.16, Math.min(0.94, bars[idx]));
        const barH = Math.max(barW, heightPct * (isDock ? h * 0.8 : h));
        const x = startX + idx * (barW + gap);
        const y = isDock ? (h - barH) / 2 : h - barH;

        ctx.fillStyle = played
          ? isDock
            ? "#ffffff"
            : accentColor
          : hovered
            ? isDock
              ? "rgba(255, 255, 255, 0.62)"
              : "rgba(129, 140, 248, 0.55)"
            : isDock
              ? "rgba(255, 255, 255, 0.25)"
              : "rgba(148, 163, 184, 0.38)";
        ctx.beginPath();
        if (hasRoundRect) {
          ctx.roundRect(x, y, barW, barH, radius);
        } else {
          ctx.rect(x, y, barW, barH);
        }
        ctx.fill();
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [accentColor, bars, canvasCssSize, hoverRatio, isDock, progressRatio, variant]);

  const ratioFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const r = ratioFromClientX(e.clientX);
    onSeek(r * safeDuration);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ratioFromClientX(e.clientX);
    setHoverRatio(r);
    if (draggingRef.current) {
      onSeek(r * safeDuration);
    }
  };

  const handlePointerEnd = () => {
    draggingRef.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(safeDuration, currentTimeSec + 5));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, currentTimeSec - 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(safeDuration);
    }
  };

  return (
    <div className={`${isDock ? "w-full" : "space-y-1.5"} select-none ${className}`} dir="ltr">
      <div
        ref={containerRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeDuration)}
        aria-valuenow={Math.round(currentTimeSec)}
        aria-valuetext={`${formatDuration(currentTimeSec)} / ${formatDuration(safeDuration)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={() => {
          setHoverRatio(null);
          setHoveredComment(null);
        }}
        onKeyDown={handleKeyDown}
        className={`relative flex cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80 ${
          isDock
            ? "items-center h-8 px-0.5 rounded-xl bg-transparent"
            : "items-end h-20 rounded-2xl px-2 py-2 bg-[var(--sf-subtle)]"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={isDock ? 320 : 560}
          height={isDock ? 32 : 72}
          aria-hidden="true"
          className="h-full w-full pointer-events-none"
        />

        {/* Timestamped Comment Pins (SoundCloud style) */}
        {comments.map((cmt) => {
          const leftPct = Math.max(2, Math.min(98, (cmt.timestampSec / safeDuration) * 100));
          return (
            <button
              key={cmt.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(cmt.timestampSec);
              }}
              onMouseEnter={() => setHoveredComment(cmt)}
              onFocus={() => setHoveredComment(cmt)}
              aria-label={`${cmt.author.displayName} at ${formatDuration(cmt.timestampSec)}: ${cmt.body}`}
              className="absolute bottom-1 -translate-x-1/2 h-5 w-5 rounded-full border-2 border-white text-[9px] font-bold text-white shadow-md transition-transform hover:scale-125 focus-visible:scale-125 after:absolute after:-inset-3 after:content-['']"
              style={{
                left: `${leftPct}%`,
                backgroundColor: cmt.author.avatarColor || "#4F46E5",
              }}
            >
              {cmt.author.displayName.slice(0, 1).toUpperCase()}
            </button>
          );
        })}

        {hoverRatio !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1 bottom-1 w-0.5 bg-indigo-500/75 dark:bg-white/75"
            style={{ left: `${hoverRatio * 100}%` }}
          />
        )}
      </div>

      {showTimestamps && (
        <div className="flex items-center justify-between text-xs opacity-75 px-1">
          <span>{formatDuration(currentTimeSec)}</span>
          {hoveredComment ? (
            <span dir="auto" className="truncate max-w-[65%] font-medium text-indigo-700 dark:text-indigo-300">
              @{hoveredComment.author.username} ({formatDuration(hoveredComment.timestampSec)}): {hoveredComment.body}
            </span>
          ) : hoverRatio !== null ? (
            <span>{formatDuration(hoverRatio * safeDuration)}</span>
          ) : null}
          <span>{formatDuration(safeDuration)}</span>
        </div>
      )}
    </div>
  );
}

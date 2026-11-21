"use client";

import React, { memo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useTrackDownload } from "@/lib/downloadManager";
import { useI18n } from "@/context/I18nContext";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { DownloadActionSheet } from "./DownloadActionSheet";
import type { Track } from "@/lib/types";

export interface DownloadButtonProps {
  track: Track | null | undefined;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "glass" | "pill";
  showLabel?: boolean;
  className?: string;
  onDownloaded?: () => void;
  onRemoved?: () => void;
  onPlayOffline?: () => void;
}

export const DownloadButton = memo(function DownloadButton({
  track,
  size = "md",
  variant = "ghost",
  showLabel = false,
  className = "",
  onDownloaded,
  onRemoved,
  onPlayOffline,
}: DownloadButtonProps) {
  const { t, formatNum, pickText } = useI18n();
  const trackTitle = track ? pickText(track.title || "", track.titleFa) || "Track" : "Track";
  const {
    status,
    progress,
    isDownloaded,
    isDownloading,
    isQueued,
    isPaused,
    isFailed,
    error,
    download,
    pause,
    resume,
    retry,
    remove,
    cancel,
  } = useTrackDownload(track);
  const [hovered, setHovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);

  if (!track || !track.id) {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    void triggerHapticFeedback("tap");
    if (busy) return;

    if (isDownloading) {
      pause();
      return;
    }

    if (isQueued) {
      cancel();
      return;
    }

    if (isPaused) {
      setBusy(true);
      try {
        const ok = await resume();
        if (ok) onDownloaded?.();
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isFailed) {
      setBusy(true);
      try {
        const ok = await retry();
        if (ok) onDownloaded?.();
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isDownloaded) {
      // Apple HIG: Do NOT delete or re-download immediately; open action sheet with options
      setShowActionSheet(true);
      return;
    }

    // Start download
    setBusy(true);
    try {
      const ok = await download();
      if (ok) onDownloaded?.();
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFromSheet = async () => {
    setBusy(true);
    try {
      const ok = await remove();
      if (ok) onRemoved?.();
    } finally {
      setBusy(false);
    }
  };

  const sizeClasses =
    size === "sm"
      ? "h-8 w-8 min-h-[32px] min-w-[32px] text-xs"
      : size === "lg"
        ? "h-11 w-11 min-h-[44px] min-w-[44px] text-base"
        : "h-9 w-9 min-h-[36px] min-w-[36px] text-sm";

  const iconSize = size === "sm" ? 15 : size === "lg" ? 20 : 17;

  let variantClasses = "";
  if (variant === "glass") {
    variantClasses =
      "bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.14] border border-black/[0.04] dark:border-white/[0.08] shadow-sm";
  } else if (variant === "pill") {
    variantClasses =
      "px-3 py-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.14] border border-black/[0.04] dark:border-white/[0.06]";
  } else {
    variantClasses =
      "hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[var(--sf-muted)] hover:text-[var(--sf-text)]";
  }

  // Downloaded state
  if (isDownloaded) {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          disabled={busy}
          aria-label={`${trackTitle} - ${t("downloaded")}`}
          title={t("downloaded")}
          className={`sf-btn relative inline-flex items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer ${sizeClasses} ${variantClasses} text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 ${className}`}
        >
          <CheckCircleIcon size={iconSize} weight="fill" aria-hidden="true" className="sf-spring-pop text-emerald-500 dark:text-emerald-400" />
          {showLabel && (
            <span className="ms-1.5 font-bold text-xs">
              {t("downloaded")}
            </span>
          )}
        </button>

        {showActionSheet && (
          <DownloadActionSheet
            track={track}
            isOpen={showActionSheet}
            onClose={() => setShowActionSheet(false)}
            onRemove={handleRemoveFromSheet}
            onPlayOffline={onPlayOffline}
          />
        )}
      </>
    );
  }

  // Downloading state (with Apple HIG determinate circular progress & pause action)
  if (isDownloading) {
    const ringParams =
      size === "sm"
        ? { dim: 32, center: 16, radius: 12, stroke: 2.5, circumference: 75.398 }
        : size === "lg"
          ? { dim: 44, center: 22, radius: 17, stroke: 3.5, circumference: 106.814 }
          : { dim: 36, center: 18, radius: 14, stroke: 3, circumference: 87.964 };
    const dashOffset = ringParams.circumference * (1 - Math.max(0.04, Math.min(1, progress / 100)));

    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={busy}
        aria-label={`${trackTitle} - ${t("downloading")} ${formatNum(progress)}% - ${t("pauseDownload")}`}
        title={`${t("downloading")} (${formatNum(progress)}%) - ${t("pauseDownload")}`}
        className={`sf-btn relative inline-flex items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer text-indigo-600 dark:text-indigo-400 bg-indigo-500/15 backdrop-blur-sm ${sizeClasses} ${className}`}
      >
        <svg
          width={ringParams.dim}
          height={ringParams.dim}
          viewBox={`0 0 ${ringParams.dim} ${ringParams.dim}`}
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <circle
            cx={ringParams.center}
            cy={ringParams.center}
            r={ringParams.radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringParams.stroke}
            className="opacity-20"
          />
          <circle
            cx={ringParams.center}
            cy={ringParams.center}
            r={ringParams.radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringParams.stroke}
            strokeDasharray={ringParams.circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${ringParams.center} ${ringParams.center})`}
            className="transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>

        {hovered ? (
          <PauseIcon
            size={Math.max(12, Math.round(iconSize * 0.72))}
            weight="bold"
            className="text-indigo-600 dark:text-indigo-400 sf-spring-pop z-10"
            aria-hidden="true"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`block rounded-[2px] bg-indigo-600 dark:bg-indigo-400 z-10 transition-transform ${
              size === "sm" ? "h-2 w-2" : size === "lg" ? "h-3 w-3 rounded-[3px]" : "h-2.5 w-2.5"
            }`}
          />
        )}

        {showLabel && (
          <span className="ms-2 font-bold text-xs whitespace-nowrap z-10">
            {hovered ? t("pauseDownload") : `${t("downloading")} ${formatNum(progress)}%`}
          </span>
        )}
      </button>
    );
  }

  // Queued state
  if (isQueued) {
    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={busy}
        aria-label={`${trackTitle} - ${t("downloadQueued")}`}
        title={`${t("downloadQueued")} - ${t("cancelSelect")}`}
        className={`sf-btn relative inline-flex items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer text-amber-500 dark:text-amber-400 bg-amber-500/15 ${sizeClasses} ${className}`}
      >
        <ClockIcon size={iconSize} weight="bold" aria-hidden="true" className="animate-pulse" />
        {showLabel && (
          <span className="ms-1.5 text-xs font-semibold">
            {hovered ? t("cancelSelect") : t("downloadQueued")}
          </span>
        )}
      </button>
    );
  }

  // Paused state
  if (isPaused) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`${trackTitle} - ${t("downloadPaused")} - ${t("resumeDownload")}`}
        title={`${t("downloadPaused")} - ${t("resumeDownload")}`}
        className={`sf-btn relative inline-flex items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer text-amber-600 dark:text-amber-300 bg-amber-500/15 ${sizeClasses} ${className}`}
      >
        <PlayIcon size={iconSize} weight="fill" aria-hidden="true" />
        {showLabel && (
          <span className="ms-1.5 text-xs font-semibold">
            {t("resumeDownload")}
          </span>
        )}
      </button>
    );
  }

  // Error / Failed state
  if (isFailed || status === "error") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`${trackTitle} - ${error || t("downloadFailed")} - ${t("retryDownload")}`}
        title={`${error || t("downloadFailed")} - ${t("retryDownload")}`}
        className={`sf-btn inline-flex items-center justify-center rounded-full text-rose-500 hover:bg-rose-500/15 cursor-pointer active:scale-95 transition-colors ${sizeClasses} ${className}`}
      >
        <ArrowClockwiseIcon size={iconSize} weight="bold" aria-hidden="true" />
        {showLabel && <span className="ms-1.5 text-xs font-semibold">{t("retryDownload")}</span>}
      </button>
    );
  }

  // Idle (not downloaded) state
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={`${t("downloadTrack")}: ${trackTitle}`}
      title={t("downloadTrack")}
      className={`sf-btn inline-flex items-center justify-center rounded-full text-[var(--sf-muted)] hover:text-[var(--sf-text)] active:scale-95 transition-all cursor-pointer ${sizeClasses} ${variantClasses} ${className}`}
    >
      <DownloadSimpleIcon size={iconSize} weight="bold" aria-hidden="true" />
      {showLabel && <span className="ms-1.5 text-xs font-semibold">{t("downloadTrack")}</span>}
    </button>
  );
});

export { DownloadButton as DownloadTrackButton };
export default DownloadButton;

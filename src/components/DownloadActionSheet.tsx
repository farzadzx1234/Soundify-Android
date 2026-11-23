"use client";

import React, { useEffect, useCallback, useSyncExternalStore, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircleIcon,
  HardDrivesIcon,
  PlayIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { exportTrackToDeviceStorage, isTrackExported } from "@/lib/mediaExport";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { calculateDampedDrag, calculateVelocity } from "@/lib/touchGestures";
import { OptimizedTrackImage } from "./OptimizedTrackImage";
import type { Track } from "@/lib/types";

const emptySubscribe = () => () => {};

export interface DownloadActionSheetProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
  onRemove: () => void;
  onPlayOffline?: () => void;
}

export function DownloadActionSheet({
  track,
  isOpen,
  onClose,
  onRemove,
  onPlayOffline,
}: DownloadActionSheetProps) {
  const { pickText, lang } = useI18n();
  const { playTrack } = usePlayer();
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [prevOpenKey, setPrevOpenKey] = useState<string | null>(null);

  const openKey = isOpen && track ? `${track.id}` : null;
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey);
    if (openKey !== null) {
      setIsClosing(false);
      setDragY(0);
      setExportStatusMsg(null);
    }
  }

  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTime = useRef(0);
  const isTrackingRef = useRef(false);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const handleDismissWithPhysics = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsClosing(true);
    void triggerHapticFeedback("dismiss");
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      isClosingRef.current = false;
      setIsClosing(false);
      setDragY(0);
      onClose();
    }, 220);
  }, [onClose]);

  // Clear any stale dismissal timer and ref lock whenever the sheet opens
  useEffect(() => {
    if (!isOpen) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    isClosingRef.current = false;
  }, [isOpen, track?.id]);

  // Clear pending dismissal timeout only on full component unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismissWithPhysics();
      }
    },
    [handleDismissWithPhysics],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !track || !isMounted) return null;

  const title = pickText(track.title, track.titleFa) || "Track";
  const artist = pickText(track.artistName, track.artistNameFa) || "Artist";

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    void triggerHapticFeedback("selection");
    if (onPlayOffline) {
      onPlayOffline();
    } else {
      playTrack(track, undefined, 0, true);
    }
    onClose();
  };

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    void triggerHapticFeedback("tap");
    if (isTrackExported(track.id)) {
      setExportStatusMsg(
        lang === "fa"
          ? "این آهنگ قبلاً در پوشه Music/Soundify ذخیره شده است."
          : "This track is already saved in Music/Soundify.",
      );
      return;
    }
    const res = await exportTrackToDeviceStorage(track);
    if (res.alreadyExists) {
      setExportStatusMsg(
        lang === "fa"
          ? "این آهنگ قبلاً در پوشه Music/Soundify ذخیره شده است."
          : "This track is already saved in Music/Soundify.",
      );
      return;
    }
    onClose();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void triggerHapticFeedback("selection");
    onRemove();
    onClose();
  };

  // Touch gesture handlers for the top drag area (grabber + header)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartY.current = touch.clientY;
    touchStartX.current = touch.clientX;
    touchStartTime.current = Date.now();
    isTrackingRef.current = true;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTrackingRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStartY.current;
    const deltaX = touch.clientX - touchStartX.current;

    // Reject primarily horizontal swipes
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 12) {
      return;
    }

    if (deltaY > 0) {
      setDragY(calculateDampedDrag(deltaY, 0.95));
    } else {
      // Rubber-band resistance on upward drag
      setDragY(Math.max(-20, deltaY * 0.15));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isTrackingRef.current) return;
    isTrackingRef.current = false;
    setIsDragging(false);

    const touch = e.changedTouches[0];
    const deltaY = touch ? touch.clientY - touchStartY.current : dragY;
    const dt = Math.max(1, Date.now() - touchStartTime.current);
    const vY = calculateVelocity(Math.max(0, deltaY), dt);

    // Dismiss if pulled down > 65px or flicked downwards at velocity > 0.32 px/ms
    if (dragY > 65 || (dragY > 25 && vY > 0.32)) {
      handleDismissWithPhysics();
    } else {
      setDragY(0);
    }
  };

  const handleTouchCancel = () => {
    isTrackingRef.current = false;
    setIsDragging(false);
    setDragY(0);
  };

  const sheetContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-sheet-title"
      className={`fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      onClick={handleDismissWithPhysics}
    >
      <div
        className={`w-full max-w-sm sm:max-w-md bg-white/98 dark:bg-[#12131a]/98 text-[var(--sf-text)] rounded-t-[32px] sm:rounded-3xl p-5 sm:p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.85)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 backdrop-blur-xl space-y-4 ${
          isClosing
            ? "transition-transform duration-220 ease-in translate-y-full"
            : isDragging
            ? "transition-none"
            : "transition-transform duration-300 ease-out"
        }`}
        style={
          !isClosing
            ? {
                transform: dragY !== 0 ? `translate3d(0, ${dragY}px, 0)` : "translate3d(0, 0, 0)",
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Apple HIG Drag Handle Zone (Touch Target ≥44px, dedicated gesture target) */}
        <div
          role="button"
          tabIndex={0}
          aria-label={lang === "fa" ? "بستن منوی ادیت آهنگ" : "Dismiss track edit menu"}
          onClick={(e) => {
            e.stopPropagation();
            handleDismissWithPhysics();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleDismissWithPhysics();
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          className="w-full py-3 -mt-3 mb-1 flex items-center justify-center cursor-pointer select-none group touch-none"
        >
          <div className="w-12 h-1.5 rounded-full bg-black/25 dark:bg-white/35 group-hover:bg-black/45 dark:group-hover:bg-white/60 group-active:scale-95 transition-all shadow-sm" />
        </div>

        {/* Track Info Header (Apple Music HIG Presentation, also pullable) */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          className="flex items-center gap-3.5 pb-3.5 border-b border-black/[0.06] dark:border-white/[0.08] touch-none select-none"
        >
          <div className="h-14 w-14 rounded-2xl overflow-hidden bg-black/5 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/15 shadow-md shrink-0">
            <OptimizedTrackImage
              src={track.coverUrl}
              trackId={track.id}
              alt={title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="download-sheet-title" className="text-base sm:text-lg font-black text-[var(--sf-text)] truncate leading-snug">
              {title}
            </h3>
            <p className="text-xs text-[var(--sf-muted)] truncate mt-0.5 font-medium">{artist}</p>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-1.5">
              <CheckCircleIcon size={13} weight="fill" className="shrink-0" />
              <span>{lang === "fa" ? "دانلود شده • آماده پخش آفلاین" : "Downloaded • Ready Offline"}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons Group (Apple HIG Grouped Style) */}
        <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/10 overflow-hidden divide-y divide-black/[0.05] dark:divide-white/[0.08] shadow-inner backdrop-blur-xl">
          {/* Action 1: Play Offline */}
          <button
            type="button"
            onClick={handlePlay}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-black/[0.04] active:bg-black/[0.08] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.1] transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/25 shadow-sm group-hover:scale-105 transition-transform">
              <PlayIcon size={18} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[var(--sf-text)] group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors leading-tight">
                {lang === "fa" ? "پخش آفلاین" : "Play Offline"}
              </p>
              <p className="text-xs text-[var(--sf-muted)] leading-relaxed mt-0.5">
                {lang === "fa" ? "پخش مستقیم از فایل ذخیره شده در حافظه" : "Stream directly from local offline storage"}
              </p>
            </div>
          </button>

          {/* Action 2: Save to Device Storage (MediaStore) */}
          <button
            type="button"
            onClick={handleExport}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-black/[0.04] active:bg-black/[0.08] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.1] transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/25 shadow-sm group-hover:scale-105 transition-transform">
              <HardDrivesIcon size={18} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[var(--sf-text)] group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-tight">
                {lang === "fa" ? "ذخیره در حافظه دستگاه" : "Save to Device Storage"}
              </p>
              <p className="text-xs text-[var(--sf-muted)] leading-relaxed mt-0.5">
                {exportStatusMsg
                  ? exportStatusMsg
                  : isTrackExported(track.id)
                    ? (lang === "fa" ? "قبلاً در پوشه Music/Soundify ذخیره شده" : "Already saved in Music/Soundify")
                    : (lang === "fa" ? "انتقال به پوشه موزیک گوشی جهت پخش در برنامه‌های دیگر" : "Export to public Music folder for external apps")}
              </p>
            </div>
          </button>

          {/* Action 3: Remove Download (Destructive style red) */}
          <button
            type="button"
            onClick={handleDelete}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-rose-500/10 active:bg-rose-500/20 text-rose-500 dark:text-rose-400 transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/25 shadow-sm group-hover:scale-105 transition-transform">
              <TrashIcon size={18} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight group-hover:text-rose-600 dark:group-hover:text-rose-300 transition-colors">
                {lang === "fa" ? "حذف فایل دانلود شده" : "Delete Download"}
              </p>
              <p className="text-xs text-rose-500/70 dark:text-rose-300/60 leading-relaxed mt-0.5">
                {lang === "fa" ? "آزادسازی حافظه محلی و حذف از بخش دانلودها" : "Remove audio file from offline storage"}
              </p>
            </div>
          </button>
        </div>

        {/* Separated Cancel Button (Apple HIG Style) */}
        <button
          type="button"
          onClick={handleDismissWithPhysics}
          className="w-full min-h-[52px] py-3.5 rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] active:bg-black/[0.14] dark:bg-white/[0.09] dark:hover:bg-white/[0.14] dark:active:bg-white/[0.18] text-[var(--sf-text)] font-bold text-sm sm:text-base transition-all cursor-pointer active:scale-[0.98] inline-flex items-center justify-center text-center leading-none border border-black/[0.08] dark:border-white/10 shadow-md backdrop-blur-md"
        >
          {lang === "fa" ? "لغو" : "Cancel"}
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(sheetContent, document.body) : null;
}

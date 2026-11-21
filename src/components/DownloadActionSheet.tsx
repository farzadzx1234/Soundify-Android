"use client";

import React, { useEffect, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircleIcon,
  HardDrivesIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { exportTrackToDeviceStorage } from "@/lib/mediaExport";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
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

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
    await exportTrackToDeviceStorage(track);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void triggerHapticFeedback("selection");
    onRemove();
    onClose();
  };

  const sheetContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-sheet-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm sm:max-w-md bg-zinc-900/90 dark:bg-[#12131a]/95 text-white rounded-t-[28px] sm:rounded-3xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/10 backdrop-blur-2xl transition-all duration-200 transform translate-y-0 active:scale-[0.99] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS Drag Handle on Mobile */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto -mt-1 sm:hidden" />

        {/* Track Info Header */}
        <div className="flex items-center gap-3 pb-2 border-b border-white/10">
          <div className="h-12 w-12 rounded-xl overflow-hidden bg-white/5 ring-1 ring-white/10 shrink-0">
            <OptimizedTrackImage
              src={track.coverUrl}
              trackId={track.id}
              alt={title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <CheckCircleIcon size={15} weight="fill" className="text-emerald-400 shrink-0" />
              <span className="text-[11px] font-semibold text-emerald-400 tracking-wide uppercase">
                {lang === "fa" ? "دانلود شده و آماده پخش آفلاین" : "Downloaded & Ready Offline"}
              </span>
            </div>
            <h3 id="download-sheet-title" className="text-sm font-bold text-white truncate mt-0.5">
              {title}
            </h3>
            <p className="text-xs text-white/60 truncate">{artist}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="h-8 w-8 min-h-[32px] min-w-[32px] rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <XIcon size={14} weight="bold" />
          </button>
        </div>

        {/* Action Buttons Group (Apple HIG Grouped Style) */}
        <div className="rounded-2xl bg-white/[0.06] border border-white/10 overflow-hidden divide-y divide-white/10 shadow-inner">
          {/* Action 1: Play Offline */}
          <button
            type="button"
            onClick={handlePlay}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-start hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer active:scale-[0.99]"
          >
            <div className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <PlayIcon size={16} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white leading-tight">
                {lang === "fa" ? "پخش آفلاین" : "Play Offline"}
              </p>
              <p className="text-[11px] text-white/50">
                {lang === "fa" ? "پخش مستقیم از فایل ذخیره شده در حافظه" : "Stream directly from local storage"}
              </p>
            </div>
          </button>

          {/* Action 2: Save to Device Storage (MediaStore) */}
          <button
            type="button"
            onClick={handleExport}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-start hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer active:scale-[0.99]"
          >
            <div className="h-8 w-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <HardDrivesIcon size={16} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white leading-tight">
                {lang === "fa" ? "ذخیره در حافظه دستگاه" : "Save to Device Storage"}
              </p>
              <p className="text-[11px] text-white/50">
                {lang === "fa" ? "انتقال به پوشه موزیک گوشی جهت پخش در برنامه‌های دیگر" : "Export to public Music folder"}
              </p>
            </div>
          </button>

          {/* Action 3: Remove Download (Destructive style red) */}
          <button
            type="button"
            onClick={handleDelete}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-start hover:bg-rose-500/10 active:bg-rose-500/20 text-rose-400 transition-colors cursor-pointer active:scale-[0.99]"
          >
            <div className="h-8 w-8 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
              <TrashIcon size={16} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">
                {lang === "fa" ? "حذف فایل دانلود شده" : "Delete Download"}
              </p>
              <p className="text-[11px] text-rose-300/60">
                {lang === "fa" ? "آزادسازی حافظه محلی و حذف از بخش دانلودها" : "Remove audio file from offline storage"}
              </p>
            </div>
          </button>
        </div>

        {/* Separated Cancel Button (Apple HIG Style) */}
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] py-3 rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:bg-white/[0.18] text-white font-semibold text-sm transition-all cursor-pointer active:scale-[0.98] inline-flex items-center justify-center text-center leading-none"
        >
          {lang === "fa" ? "لغو" : "Cancel"}
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(sheetContent, document.body) : null;
}

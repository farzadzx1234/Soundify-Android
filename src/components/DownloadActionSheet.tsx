"use client";

import React, { useEffect, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircleIcon,
  HardDrivesIcon,
  PlayIcon,
  TrashIcon,
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
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm sm:max-w-md bg-zinc-950/95 dark:bg-[#12131a]/98 text-white rounded-t-[32px] sm:rounded-3xl p-5 sm:p-6 pb-8 sm:pb-6 shadow-[0_25px_60px_rgba(0,0,0,0.85)] border-t border-x sm:border border-white/10 backdrop-blur-2xl space-y-4 sf-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS Drag Handle on Mobile */}
        <div className="w-10 h-1.5 rounded-full bg-white/30 mx-auto -mt-1 mb-3 sm:hidden" />

        {/* Track Info Header (Apple Music HIG Presentation) */}
        <div className="flex items-center gap-3.5 pb-3.5 border-b border-white/[0.08]">
          <div className="h-14 w-14 rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/15 shadow-md shrink-0">
            <OptimizedTrackImage
              src={track.coverUrl}
              trackId={track.id}
              alt={title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="download-sheet-title" className="text-base sm:text-lg font-black text-white truncate leading-snug">
              {title}
            </h3>
            <p className="text-xs text-white/65 truncate mt-0.5 font-medium">{artist}</p>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[11px] font-bold text-emerald-400 mt-1.5">
              <CheckCircleIcon size={13} weight="fill" className="shrink-0" />
              <span>{lang === "fa" ? "دانلود شده • آماده پخش آفلاین" : "Downloaded • Ready Offline"}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons Group (Apple HIG Grouped Style) */}
        <div className="rounded-2xl bg-white/[0.05] border border-white/10 overflow-hidden divide-y divide-white/[0.08] shadow-inner backdrop-blur-xl">
          {/* Action 1: Play Offline */}
          <button
            type="button"
            onClick={handlePlay}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-white/[0.06] active:bg-white/[0.1] transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20 shadow-sm group-hover:scale-105 transition-transform">
              <PlayIcon size={18} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors leading-tight">
                {lang === "fa" ? "پخش آفلاین" : "Play Offline"}
              </p>
              <p className="text-xs text-white/50 leading-relaxed mt-0.5">
                {lang === "fa" ? "پخش مستقیم از فایل ذخیره شده در حافظه" : "Stream directly from local offline storage"}
              </p>
            </div>
          </button>

          {/* Action 2: Save to Device Storage (MediaStore) */}
          <button
            type="button"
            onClick={handleExport}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-white/[0.06] active:bg-white/[0.1] transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20 shadow-sm group-hover:scale-105 transition-transform">
              <HardDrivesIcon size={18} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors leading-tight">
                {lang === "fa" ? "ذخیره در حافظه دستگاه" : "Save to Device Storage"}
              </p>
              <p className="text-xs text-white/50 leading-relaxed mt-0.5">
                {lang === "fa" ? "انتقال به پوشه موزیک گوشی جهت پخش در برنامه‌های دیگر" : "Export to public Music folder for external apps"}
              </p>
            </div>
          </button>

          {/* Action 3: Remove Download (Destructive style red) */}
          <button
            type="button"
            onClick={handleDelete}
            className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3.5 text-start hover:bg-rose-500/10 active:bg-rose-500/20 text-rose-400 transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="h-10 w-10 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/20 shadow-sm group-hover:scale-105 transition-transform">
              <TrashIcon size={18} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight group-hover:text-rose-300 transition-colors">
                {lang === "fa" ? "حذف فایل دانلود شده" : "Delete Download"}
              </p>
              <p className="text-xs text-rose-300/60 leading-relaxed mt-0.5">
                {lang === "fa" ? "آزادسازی حافظه محلی و حذف از بخش دانلودها" : "Remove audio file from offline storage"}
              </p>
            </div>
          </button>
        </div>

        {/* Separated Cancel Button (Apple HIG Style) */}
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[52px] py-3.5 rounded-2xl bg-white/[0.09] hover:bg-white/[0.14] active:bg-white/[0.18] text-white font-bold text-sm sm:text-base transition-all cursor-pointer active:scale-[0.98] inline-flex items-center justify-center text-center leading-none border border-white/10 shadow-md backdrop-blur-md"
        >
          {lang === "fa" ? "لغو" : "Cancel"}
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(sheetContent, document.body) : null;
}

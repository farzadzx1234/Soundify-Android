"use client";

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { formatDuration } from "@/lib/lrc";
import { OptimizedTrackImage } from "./OptimizedTrackImage";
import type { Track } from "@/lib/types";

interface VirtualizedTrackTableProps {
  tracks: Track[];
  currentTrackId?: string | null;
  isPlaying?: boolean;
  isOwner?: boolean;
  onPlayTrack: (track: Track, allTracks: Track[]) => void;
  onRemoveTrack?: (trackId: string) => void;
  rowHeight?: number;
  overscan?: number;
  threshold?: number;
}

export const VirtualizedTrackTable = memo(function VirtualizedTrackTable({
  tracks,
  currentTrackId,
  isPlaying = false,
  isOwner = false,
  onPlayTrack,
  onRemoveTrack,
  rowHeight = 60,
  overscan = 5,
  threshold = 15,
}: VirtualizedTrackTableProps) {
  const { t, pickText } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const updateViewportHeight = useCallback(() => {
    if (typeof window !== "undefined") {
      setViewportHeight(window.innerHeight || 600);
    }
  }, []);

  useEffect(() => {
    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight, { passive: true });
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, [updateViewportHeight]);

  useEffect(() => {
    if (tracks.length <= threshold || typeof window === "undefined") return;

    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const topOffset = Math.max(0, -rect.top);
        setScrollTop(topOffset);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [tracks.length, threshold]);

  const renderRow = (tr: Track, index: number) => {
    const active = currentTrackId === tr.id;
    const isPlayingNow = active && isPlaying;

    return (
      <div
        key={tr.id}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlayTrack(tr, tracks);
          }
        }}
        className={`group flex items-center justify-between gap-3 p-2.5 sm:px-4 sm:py-3 rounded-2xl transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
          active
            ? "bg-indigo-500/15 dark:bg-indigo-500/20 shadow-sm"
            : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        }`}
        style={{ height: rowHeight }}
        onClick={() => onPlayTrack(tr, tracks)}
      >
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <span className="w-6 text-center text-xs font-mono opacity-50 shrink-0">
            {isPlayingNow ? (
              <span className="inline-block h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
            ) : (
              index + 1
            )}
          </span>

          <div className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0 shadow-sm">
            <OptimizedTrackImage
              src={tr.coverUrl}
              alt={pickText(tr.title, tr.titleFa)}
              accentColor={tr.accentColor}
              pageUrl={tr.pageUrl}
              trackId={tr.id}
              trackTitle={tr.title}
              artistName={tr.artistName}
            />
            <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isPlayingNow ? (
                <PauseIcon size={16} weight="fill" className="text-white" aria-hidden="true" />
              ) : (
                <PlayIcon size={16} weight="fill" className="text-white" aria-hidden="true" />
              )}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <span
              className={`block font-bold text-sm truncate ${
                active ? "text-indigo-600 dark:text-indigo-400" : ""
              }`}
            >
              {pickText(tr.title, tr.titleFa)}
            </span>
            <span className="block text-xs opacity-70 truncate">
              {pickText(tr.artistName, tr.artistNameFa)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-8 shrink-0">
          <span className="hidden sm:block w-24 text-xs opacity-70 truncate">
            {pickText(tr.album, tr.albumFa)}
          </span>
          <span className="w-14 sm:w-16 text-end text-xs font-mono tabular-nums opacity-70" dir="ltr">
            {formatDuration(tr.durationSec)}
          </span>
          {isOwner && onRemoveTrack && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTrack(tr.id);
              }}
              aria-label={`${t("removeFromPlaylist")}: ${pickText(tr.title, tr.titleFa)}`}
              className="inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-rose-500 hover:bg-rose-500/15 cursor-pointer shrink-0 transition-colors"
            >
              <TrashIcon size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Direct render for small playlists
  if (tracks.length <= threshold) {
    return (
      <div ref={containerRef} className="space-y-1">
        {tracks.map((tr, index) => renderRow(tr, index))}
      </div>
    );
  }

  const totalHeight = tracks.length * rowHeight;
  const rawStartIdx = Math.floor(scrollTop / rowHeight) - overscan;
  const startIdx = Math.min(tracks.length, Math.max(0, rawStartIdx));
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIdx = Math.min(tracks.length, startIdx + visibleCount);

  const visibleTracks = tracks.slice(startIdx, endIdx);
  const topSpacer = Math.min(totalHeight, startIdx * rowHeight);
  const bottomSpacer = Math.max(0, (tracks.length - endIdx) * rowHeight);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: totalHeight }}>
      {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden="true" />}
      <div className="space-y-1">
        {visibleTracks.map((tr, i) => renderRow(tr, startIdx + i))}
      </div>
      {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}
    </div>
  );
});

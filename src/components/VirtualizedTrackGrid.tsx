"use client";

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { TrackCard } from "./TrackCard";
import type { Playlist, Track } from "@/lib/types";

interface VirtualizedTrackGridProps {
  tracks: Track[];
  queue?: Track[];
  playlists?: Playlist[];
  onTrackUpdated?: (track: Track) => void;
  className?: string;
  estimatedRowHeight?: number;
  overscanRows?: number;
  threshold?: number; // Minimum number of items before windowing engages (default: 12)
  autoExpand?: boolean;
}

export const VirtualizedTrackGrid = memo(function VirtualizedTrackGrid({
  tracks,
  queue,
  playlists = [],
  onTrackUpdated,
  className = "",
  estimatedRowHeight = 350,
  overscanRows = 2,
  threshold = 100,
  autoExpand = false,
}: VirtualizedTrackGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [itemsPerRow, setItemsPerRow] = useState(1);

  // Responsive column determination based on container width or window
  const updateLayoutMetrics = useCallback(() => {
    if (typeof window === "undefined") return;
    const width = containerRef.current?.offsetWidth || window.innerWidth;
    let cols = 2;
    if (width >= 1280) {
      cols = 4;
    } else if (width >= 768) {
      cols = 3;
    }
    setItemsPerRow(cols);
    setViewportHeight(window.innerHeight || 800);
  }, []);

  useEffect(() => {
    updateLayoutMetrics();
    window.addEventListener("resize", updateLayoutMetrics, { passive: true });
    return () => window.removeEventListener("resize", updateLayoutMetrics);
  }, [updateLayoutMetrics]);

  // Window scroll listener throttled via requestAnimationFrame for 60fps performance
  useEffect(() => {
    if (tracks.length <= threshold || typeof window === "undefined") return;

    let rafId: number | null = null;
    let lastReportedTop = 0;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        // Calculate container-relative scroll offset
        const topOffset = Math.max(0, -rect.top);
        if (Math.abs(topOffset - lastReportedTop) > 36) {
          lastReportedTop = topOffset;
          setScrollTop(topOffset);
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [tracks.length, threshold]);

  // If dataset is within native threshold, render directly without windowing overhead
  if (tracks.length <= threshold) {
    return (
      <div
        ref={containerRef}
        className={`grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4 ${className}`}
      >
        {tracks.map((track, idx) => (
          <TrackCard
            key={track.id}
            track={track}
            queue={queue || tracks}
            playlists={playlists}
            priorityImage={idx < 4}
            onTrackUpdated={onTrackUpdated}
            autoExpand={autoExpand}
          />
        ))}
      </div>
    );
  }

  const totalRows = Math.ceil(tracks.length / itemsPerRow);
  const totalHeight = totalRows * estimatedRowHeight;

  // Compute visible row range with overscan, bounded safely between 0 and totalRows
  const rawStartRow = Math.floor(scrollTop / estimatedRowHeight) - overscanRows;
  const startRow = Math.min(totalRows, Math.max(0, rawStartRow));
  const visibleRowCount = Math.ceil(viewportHeight / estimatedRowHeight) + overscanRows * 2;
  const endRow = Math.min(totalRows, startRow + visibleRowCount);

  const startIndex = Math.min(tracks.length, startRow * itemsPerRow);
  const endIndex = Math.min(tracks.length, endRow * itemsPerRow);

  const visibleTracks = tracks.slice(startIndex, endIndex);

  const topSpacerHeight = Math.min(totalHeight, startRow * estimatedRowHeight);
  const bottomSpacerHeight = Math.max(0, (totalRows - endRow) * estimatedRowHeight);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: totalHeight }}>
      {/* Top Spacer */}
      {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} aria-hidden="true" />}

      {/* Visible Windowed Items Grid */}
      <div className={`grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4 ${className}`}>
        {visibleTracks.map((track, index) => {
          const globalIndex = startIndex + index;
          return (
            <TrackCard
              key={track.id}
              track={track}
              queue={queue || tracks}
              playlists={playlists}
              priorityImage={globalIndex < 4}
              onTrackUpdated={onTrackUpdated}
              autoExpand={autoExpand}
            />
          );
        })}
      </div>

      {/* Bottom Spacer */}
      {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />}
    </div>
  );
});

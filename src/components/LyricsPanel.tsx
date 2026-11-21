"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/GlassControls";
import {
  ArrowsDownUpIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  FadersIcon,
  FloppyDiskIcon,
  ListDashesIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MicrophoneStageIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { formatDuration } from "@/lib/lrc";
import { api } from "@/lib/api";
import type { LyricsSourceCandidate } from "@/lib/types";

export function shouldRunAutoScroll(autoScroll: boolean, userHasScrolled: boolean): boolean {
  return autoScroll && !userHasScrolled;
}

export function shouldScrollContainerToTop(activeLyricIndex: number): boolean {
  return activeLyricIndex <= 1;
}

export interface PickLyricScrollBehaviorParams {
  reducedMotion: boolean;
  isInitialSync: boolean;
  deltaPx: number;
  containerHeight: number;
}

/**
 * Picks `"auto"` (instant 1-frame snap) when reduced motion is enabled, on initial
 * hydration/mount sync for a track, or when the target jump exceeds 1.25x the scroll
 * container height; picks `"smooth"` for nearby active-line advances.
 */
export function pickLyricScrollBehavior({
  reducedMotion,
  isInitialSync,
  deltaPx,
  containerHeight,
}: PickLyricScrollBehaviorParams): ScrollBehavior {
  if (reducedMotion || isInitialSync) return "auto";
  if (!Number.isFinite(deltaPx) || !Number.isFinite(containerHeight)) return "auto";
  if (Math.abs(deltaPx) > Math.max(0, containerHeight) * 1.25) return "auto";
  return "smooth";
}

export interface ComputeLyricTargetTopParams {
  currentScrollTop: number;
  containerTop: number;
  containerRectHeight: number;
  containerClientHeight: number;
  containerScrollHeight: number;
  lineTop: number;
  lineHeight: number;
}

export function computeCenteredScrollTop({
  currentScrollTop,
  containerTop,
  containerRectHeight,
  containerClientHeight,
  containerScrollHeight,
  lineTop,
  lineHeight,
}: ComputeLyricTargetTopParams): number {
  if (
    !Number.isFinite(currentScrollTop) ||
    !Number.isFinite(containerTop) ||
    !Number.isFinite(containerRectHeight) ||
    !Number.isFinite(containerClientHeight) ||
    !Number.isFinite(containerScrollHeight) ||
    !Number.isFinite(lineTop) ||
    !Number.isFinite(lineHeight) ||
    containerClientHeight <= 0
  ) {
    return Math.max(0, Number.isFinite(currentScrollTop) ? currentScrollTop : 0);
  }
  const scale =
    containerRectHeight > 0 && Math.abs(containerRectHeight - containerClientHeight) > 0.5
      ? containerRectHeight / containerClientHeight
      : 1;
  const lineCenterOffset =
    (lineTop + lineHeight / 2 - (containerTop + containerRectHeight / 2)) / scale;
  const maxScroll = Math.max(0, containerScrollHeight - containerClientHeight);
  return Math.max(0, Math.min(maxScroll, Math.round(currentScrollTop + lineCenterOffset)));
}

export interface LyricsPanelProps {
  compact?: boolean;
  darkSurface?: boolean;
  fullScreen?: boolean;
  borderless?: boolean;
  hideToolbar?: boolean;
  externalSearchOpen?: boolean;
  onExternalSearchOpenChange?: (open: boolean) => void;
  externalToolsOpen?: boolean;
  onExternalToolsOpenChange?: (open: boolean) => void;
  externalSourcesOpen?: boolean;
  onExternalSourcesOpenChange?: (open: boolean) => void;
  onToggleFullScreen?: () => void;
  showFullScreenButton?: boolean;
  showControls?: boolean;
  trackPage?: boolean;
  className?: string;
}

export function LyricsPanel({
  compact = false,
  darkSurface = false,
  fullScreen,
  borderless = false,
  trackPage = false,
  hideToolbar = false,
  externalSearchOpen,
  onExternalSearchOpenChange,
  externalToolsOpen,
  onExternalToolsOpenChange,
  externalSourcesOpen,
  onExternalSourcesOpenChange,
  onToggleFullScreen,
  showFullScreenButton = true,
  showControls = true,
  className = "",
}: LyricsPanelProps) {
  const { t, pickText, lang } = useI18n();
  const {
    currentTrack,
    lyrics,
    lyricsSource,
    lyricsLoading,
    lyricsOffsetMs,
    adjustLyricsOffset,
    saveLyricsOffset,
    applyLyricsSource,
    seek,
    refreshLyrics,
  } = usePlayer();
  const { activeLyricIndex } = usePlayerProgress();

  const activeLineRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const hasInitialScrolledRef = useRef(false);

  const [internalFullScreen, setInternalFullScreen] = useState(false);
  const isEffectiveFullScreen = fullScreen !== undefined ? fullScreen : internalFullScreen;

  const [autoScroll, setAutoScroll] = useState(true);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [showCustomSearchState, setShowCustomSearchState] = useState(false);
  const [showSyncBarState, setShowSyncBarState] = useState(false);
  const showCustomSearch = externalSearchOpen ?? showCustomSearchState;
  const setShowCustomSearch = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(showCustomSearch) : next;
      if (onExternalSearchOpenChange) onExternalSearchOpenChange(resolved);
      else setShowCustomSearchState(resolved);
    },
    [onExternalSearchOpenChange, showCustomSearch],
  );
  const showSyncBar = externalToolsOpen ?? showSyncBarState;
  const setShowSyncBar = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(showSyncBar) : next;
      if (onExternalToolsOpenChange) onExternalToolsOpenChange(resolved);
      else setShowSyncBarState(resolved);
    },
    [onExternalToolsOpenChange, showSyncBar],
  );
  const [showSourcesModalState, setShowSourcesModalState] = useState(false);
  const showSourcesModal = externalSourcesOpen ?? showSourcesModalState;
  const setShowSourcesModal = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(showSourcesModal) : next;
      if (onExternalSourcesOpenChange) onExternalSourcesOpenChange(resolved);
      else setShowSourcesModalState(resolved);
    },
    [onExternalSourcesOpenChange, showSourcesModal],
  );
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [availableSources, setAvailableSources] = useState<LyricsSourceCandidate[]>([]);
  const [savingOffset, setSavingOffset] = useState(false);
  const [offsetSavedMsg, setOffsetSavedMsg] = useState("");
  const [applyingSource, setApplyingSource] = useState<string | null>(null);

  const [prevTrackId, setPrevTrackId] = useState<string | undefined>(currentTrack?.id);
  const [queryTitle, setQueryTitle] = useState(currentTrack?.title ?? "");
  const [queryArtist, setQueryArtist] = useState(currentTrack?.artistName ?? "");
  const [statusMsg, setStatusMsg] = useState("");

  if (currentTrack?.id !== prevTrackId) {
    setPrevTrackId(currentTrack?.id);
    setQueryTitle(currentTrack?.title ?? "");
    setQueryArtist(currentTrack?.artistName ?? "");
    setStatusMsg("");
    setUserHasScrolled(false);
    setShowSyncBar(false);
    setShowSourcesModal(false);
    setOffsetSavedMsg("");
  }

  useEffect(() => {
    hasInitialScrolledRef.current = false;
  }, [currentTrack?.id]);

  useEffect(() => {
    if (lyrics.length === 0) {
      hasInitialScrolledRef.current = false;
    }
  }, [lyrics.length]);

  const scrollToActiveLyric = useCallback(
    (behaviorOverride?: ScrollBehavior) => {
      const container = scrollContainerRef.current;
      if (!container || container.clientHeight <= 0) return;
      const reducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const isInitialSync = !hasInitialScrolledRef.current;
      const scrollToTop = shouldScrollContainerToTop(activeLyricIndex);

      let targetTop = 0;
      let deltaPx = 0;
      if (scrollToTop) {
        targetTop = 0;
        deltaPx = -container.scrollTop;
      } else if (activeLineRef.current) {
        const containerRect = container.getBoundingClientRect();
        const lineRect = activeLineRef.current.getBoundingClientRect();
        targetTop = computeCenteredScrollTop({
          currentScrollTop: container.scrollTop,
          containerTop: containerRect.top,
          containerRectHeight: containerRect.height,
          containerClientHeight: container.clientHeight,
          containerScrollHeight: container.scrollHeight,
          lineTop: lineRect.top,
          lineHeight: lineRect.height,
        });
        deltaPx = targetTop - container.scrollTop;
      } else {
        programmaticScrollUntilRef.current = 0;
        return;
      }

      hasInitialScrolledRef.current = true;
      if (Math.abs(deltaPx) < 1) {
        programmaticScrollUntilRef.current = 0;
        return;
      }

      const behavior: ScrollBehavior =
        behaviorOverride ??
        pickLyricScrollBehavior({
          reducedMotion,
          isInitialSync,
          deltaPx,
          containerHeight: container.clientHeight,
        });
      programmaticScrollUntilRef.current = Date.now() + (behavior === "auto" ? 80 : 1100);

      container.scrollTo({ top: targetTop, behavior });
    },
    [activeLyricIndex],
  );

  // Auto-centering scroll (instant snap on initial sync / large seek jumps, smooth for nearby ticks)
  useEffect(() => {
    if (!shouldRunAutoScroll(autoScroll, userHasScrolled)) return;
    scrollToActiveLyric();
  }, [
    activeLyricIndex,
    lyrics.length,
    currentTrack?.id,
    autoScroll,
    userHasScrolled,
    showCustomSearch,
    showSyncBar,
    scrollToActiveLyric,
  ]);

  const handleToggleAutoScroll = useCallback(() => {
    if (!autoScroll || userHasScrolled) {
      setAutoScroll(true);
      setUserHasScrolled(false);
      scrollToActiveLyric();
    } else {
      setAutoScroll(false);
    }
  }, [autoScroll, userHasScrolled, scrollToActiveLyric]);

  // Handle escape key when internal fullscreen is active
  useEffect(() => {
    if (!internalFullScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInternalFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [internalFullScreen]);

  // Fetch multi-source lyrics candidates whenever Sources modal opens (external or inline trigger)
  const trackIdForSources = currentTrack?.id;
  useEffect(() => {
    if (!showSourcesModal || !trackIdForSources) return;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setSourcesLoading(true);
        return api.getLyricsSources(trackIdForSources);
      })
      .then((res) => {
        if (!active || !res) return;
        setAvailableSources(res.sources ?? []);
      })
      .catch(() => {
        if (active) setAvailableSources([]);
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showSourcesModal, trackIdForSources]);

  if (!currentTrack) return null;

  const handleToggleFs = () => {
    if (onToggleFullScreen) {
      onToggleFullScreen();
    } else {
      setInternalFullScreen((prev) => !prev);
    }
  };

  const handleAutoFetch = async (useCustom = false) => {
    setStatusMsg("");
    const res = await refreshLyrics(
      true,
      useCustom
        ? {
            queryTitle: queryTitle.trim() || currentTrack.title,
            queryArtist: queryArtist.trim() || currentTrack.artistName,
          }
        : undefined,
    );
    if (!res.found) {
      setStatusMsg(lyrics.length > 0 ? t("lyricsNotFoundKeepExisting") : t("lyricsNotFound"));
    }
  };

  const handleOpenSourcesModal = () => {
    setShowSourcesModal(true);
  };

  const handleScroll = () => {
    const containerEl = scrollContainerRef.current;
    if (!containerEl || !activeLineRef.current) return;
    const isProgrammatic = Date.now() < programmaticScrollUntilRef.current;
    const container = containerEl.getBoundingClientRect();
    const line = activeLineRef.current.getBoundingClientRect();
    const isVisible = line.top >= container.top - 20 && line.bottom <= container.bottom + 20;
    if (!isVisible) {
      if (!isProgrammatic) {
        setUserHasScrolled(true);
      }
    } else {
      programmaticScrollUntilRef.current = 0;
      setUserHasScrolled(false);
    }
  };

  const renderContent = (isModal: boolean) => (
    <div
      className={`relative flex flex-col ${
        isModal
          ? "h-full w-full"
          : isEffectiveFullScreen
            ? "h-full flex-1"
            : borderless
              ? "h-full flex-1 min-h-0"
              : compact
                ? "h-72"
                : "h-[54vh] min-h-[340px]"
      } ${className}`}
    >
      {/* Header controls bar (hidden when modal or Desktop 1C header hosts tools) */}
      {!isModal && showControls && !hideToolbar && (
        <div
          className={`flex items-center justify-between gap-2 shrink-0 ${
            borderless
              ? "pb-1.5 pt-0.5"
              : `pb-2.5 border-b ${
                  darkSurface || isEffectiveFullScreen ? "border-white/10" : "border-[var(--sf-border)]"
                }`
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold min-w-0 flex-1">
            {!borderless && !trackPage && (
              <>
                <MicrophoneStageIcon
                  size={18}
                  weight="duotone"
                  className={darkSurface || isEffectiveFullScreen ? "text-indigo-400 shrink-0" : "text-indigo-600 dark:text-indigo-400 shrink-0"}
                  aria-hidden="true"
                />
                <span className="truncate hidden sm:inline">{t("lyrics")}</span>
              </>
            )}

            {/* Clickable Source Badge - Refined Apple HIG Pull-down Button */}
            {lyrics.length > 0 && lyricsSource !== "none" && (
              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("selection");
                  void handleOpenSourcesModal();
                }}
                title={`${t("lyricsSyncedFrom")} ${lyricsSource} (${t("switchSource")})`}
                aria-label={`${t("lyricsSyncedFrom")} ${lyricsSource}`}
                className={`group relative rounded-full px-3 py-1.5 min-h-[36px] text-xs font-medium shrink-0 inline-flex items-center gap-1.5 transition-all duration-150 active:scale-[0.96] cursor-pointer select-none touch-manipulation max-w-[130px] sm:max-w-[200px] ${
                  borderless
                    ? "sf-1c-pill hover:bg-white/[0.15] text-white/95"
                    : darkSurface || isEffectiveFullScreen
                      ? "bg-white/10 hover:bg-white/18 text-white/95 border border-white/15 shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
                      : "bg-black/[0.05] hover:bg-black/[0.08] dark:bg-white/10 dark:hover:bg-white/18 text-[var(--sf-text)] border border-black/[0.08] dark:border-white/12 shadow-sm"
                }`}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]" />
                </span>
                <span className="text-[11px] opacity-60 hidden sm:inline shrink-0 font-normal">
                  {lang === "fa" ? "منبع:" : "Source:"}
                </span>
                <span className="truncate font-semibold tracking-tight">{lyricsSource}</span>
                <CaretDownIcon
                  size={12}
                  weight="bold"
                  className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          <div
            className={`flex items-center shrink-0 ${
              borderless
                ? "sf-1c-pill rounded-full px-1.5 py-0.5 gap-1"
                : "gap-1.5"
            }`}
          >
            {/* Sync Timing Offset Tuner toggle */}
            <button
              type="button"
              onClick={() => setShowSyncBar((prev) => !prev)}
              aria-label={t("lyricsSyncOffset")}
              title={t("lyricsSyncOffset")}
              aria-expanded={showSyncBar}
              className={`sf-btn relative inline-flex ${borderless ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full cursor-pointer transition-all duration-200 active:scale-95 shrink-0 select-none ${
                showSyncBar
                  ? darkSurface || isEffectiveFullScreen
                    ? "bg-white/25 text-white border border-white/30 shadow-sm"
                    : "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                  : darkSurface || isEffectiveFullScreen
                    ? borderless
                      ? "text-white/80 hover:text-white hover:bg-white/15"
                      : "bg-white/10 text-white hover:bg-white/20"
                    : "bg-black/[0.06] text-[var(--sf-muted)] hover:bg-black/[0.1] dark:bg-white/[0.1]"
              }`}
            >
              <FadersIcon size={borderless ? 14 : 15} weight={showSyncBar ? "bold" : "regular"} aria-hidden="true" />
              {lyricsOffsetMs !== 0 && (
                <span className="absolute top-0.5 end-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>

            {/* Multiple Sources Picker toggle (only shown when source pill above is NOT displayed) */}
            {!borderless && !(lyrics.length > 0 && lyricsSource !== "none") && (
              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("selection");
                  void handleOpenSourcesModal();
                }}
                aria-label={t("lyricsSources")}
                title={t("lyricsSources")}
                className={`sf-btn inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer transition-all duration-200 active:scale-95 shrink-0 select-none ${
                  darkSurface || isEffectiveFullScreen
                    ? "bg-white/10 text-white hover:bg-white/20"
                    : "bg-black/[0.06] text-[var(--sf-muted)] hover:bg-black/[0.1] dark:bg-white/[0.1]"
                }`}
              >
                <ListDashesIcon size={15} aria-hidden="true" />
              </button>
            )}

            {/* Sleek Apple-style auto-scroll button */}
            <button
              type="button"
              onClick={handleToggleAutoScroll}
              aria-label={t("toggleAutoScroll")}
              title={autoScroll ? t("autoScrollOn") : t("autoScrollOff")}
              className={`sf-btn relative inline-flex ${borderless ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full cursor-pointer transition-all duration-200 active:scale-95 shrink-0 select-none ${
                autoScroll
                  ? darkSurface || isEffectiveFullScreen
                    ? borderless
                      ? "bg-white/18 text-emerald-300"
                      : "bg-white/20 text-white border border-white/25 shadow-sm"
                    : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25"
                  : darkSurface || isEffectiveFullScreen
                    ? borderless
                      ? "text-white/50 hover:text-white hover:bg-white/10"
                      : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-white/10"
                    : "bg-black/[0.05] text-[var(--sf-muted)] hover:bg-black/[0.1] dark:bg-white/[0.08] border border-black/[0.06] dark:border-white/[0.08]"
              }`}
            >
              <ArrowsDownUpIcon size={borderless ? 14 : 15} weight={autoScroll ? "bold" : "regular"} aria-hidden="true" className="shrink-0" />
              {!borderless && (
                <span className={`absolute top-1 end-1 h-1.5 w-1.5 rounded-full transition-colors duration-300 ${autoScroll ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-white/30"}`} />
              )}
            </button>

            {/* Custom search toggle */}
            <button
              type="button"
              onClick={() => setShowCustomSearch((prev) => !prev)}
              aria-label={t("navSearch")}
              title={t("navSearch")}
              aria-expanded={showCustomSearch}
              className={`sf-btn inline-flex ${borderless ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full cursor-pointer transition-colors shrink-0 ${
                showCustomSearch
                  ? darkSurface || isEffectiveFullScreen
                    ? "bg-white/25 text-white"
                    : "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                  : darkSurface || isEffectiveFullScreen
                    ? borderless
                      ? "text-white/80 hover:text-white hover:bg-white/15"
                      : "bg-white/10 text-white hover:bg-white/20 active:scale-95"
                    : "bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/[0.1] dark:hover:bg-white/[0.16] active:scale-95"
              }`}
            >
              <MagnifyingGlassIcon size={borderless ? 14 : 15} aria-hidden="true" />
            </button>

            {/* Auto fetch button */}
            <button
              type="button"
              disabled={lyricsLoading}
              onClick={() => void handleAutoFetch(showCustomSearch)}
              aria-label={lyricsLoading ? t("fetchingLyrics") : t("autoFetchLyrics")}
              title={lyricsLoading ? t("fetchingLyrics") : t("autoFetchLyrics")}
              className={`sf-btn inline-flex ${borderless ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full cursor-pointer transition-colors shrink-0 ${
                darkSurface || isEffectiveFullScreen
                  ? borderless
                    ? "text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-40"
                    : "bg-white/10 text-white hover:bg-white/20 active:scale-95 disabled:opacity-40"
                  : "bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/[0.1] dark:hover:bg-white/[0.16] active:scale-95 disabled:opacity-40"
              }`}
            >
              <MagicWandIcon size={borderless ? 14 : 15} aria-hidden="true" />
            </button>

            {/* Full-Screen toggle */}
            {showFullScreenButton && !!onToggleFullScreen && (
              <button
                type="button"
                onClick={handleToggleFs}
                aria-label={isEffectiveFullScreen ? t("exitFullScreenLyrics") : t("fullScreenLyrics")}
                title={isEffectiveFullScreen ? t("exitFullScreenLyrics") : t("fullScreenLyrics")}
                className={`sf-btn inline-flex ${borderless ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full cursor-pointer transition-colors shrink-0 ${
                  darkSurface || isEffectiveFullScreen
                    ? borderless
                      ? "text-white/80 hover:text-white hover:bg-white/15"
                      : "bg-white/10 text-white hover:bg-white/20 active:scale-95"
                    : "bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/[0.1] dark:hover:bg-white/[0.16] active:scale-95"
                }`}
              >
                {isEffectiveFullScreen ? (
                  <ArrowsInSimpleIcon size={borderless ? 14 : 15} weight="bold" aria-hidden="true" />
                ) : (
                  <ArrowsOutSimpleIcon size={borderless ? 14 : 15} weight="bold" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sync Offset Calibration Bar (حل مشکل تاخیر و عدم سینک با موسیقی) */}
      {showSyncBar && (
        <div className="rounded-2xl p-3 my-2 border bg-white/[0.06] dark:bg-white/[0.06] backdrop-blur-xl border-white/10 flex flex-wrap items-center justify-between gap-2.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200 shrink-0">
          <div className="flex items-center gap-2">
            <ClockCounterClockwiseIcon size={16} className="text-indigo-400 shrink-0" />
            <span className="font-semibold">{t("lyricsSyncOffset")}:</span>
            <span
              className={`px-2 py-0.5 rounded-full font-mono font-bold text-[11px] tabular-nums ${
                lyricsOffsetMs > 0
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : lyricsOffsetMs < 0
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {lyricsOffsetMs === 0
                ? "۰.۰s (هماهنگ)"
                : `${lyricsOffsetMs > 0 ? "+" : ""}${(lyricsOffsetMs / 1000).toFixed(1)}s`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => adjustLyricsOffset(-500)}
              title="0.5 ثانیه جلوتر"
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all font-mono font-medium cursor-pointer"
            >
              -0.5s
            </button>
            <button
              type="button"
              onClick={() => adjustLyricsOffset(-200)}
              title="0.2 ثانیه جلوتر"
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all font-mono font-medium cursor-pointer"
            >
              -0.2s
            </button>
            <button
              type="button"
              onClick={() => adjustLyricsOffset(+200)}
              title="0.2 ثانیه عقب‌تر"
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all font-mono font-medium cursor-pointer"
            >
              +0.2s
            </button>
            <button
              type="button"
              onClick={() => adjustLyricsOffset(+500)}
              title="0.5 ثانیه عقب‌تر"
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all font-mono font-medium cursor-pointer"
            >
              +0.5s
            </button>
            {lyricsOffsetMs !== 0 && (
              <button
                type="button"
                onClick={() => adjustLyricsOffset(-lyricsOffsetMs)}
                className="px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 active:scale-95 transition-all cursor-pointer font-medium"
              >
                {t("resetSync")}
              </button>
            )}
            <button
              type="button"
              disabled={savingOffset}
              onClick={async () => {
                setSavingOffset(true);
                const ok = await saveLyricsOffset();
                setSavingOffset(false);
                if (ok) {
                  setOffsetSavedMsg(t("syncOffsetSaved"));
                  setTimeout(() => setOffsetSavedMsg(""), 3500);
                }
              }}
              className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1 active:scale-95 transition-all shadow-md cursor-pointer disabled:opacity-50 ${
                darkSurface || isEffectiveFullScreen
                  ? "bg-white text-slate-950 hover:bg-white/90"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              <FloppyDiskIcon size={14} />
              <span>{savingOffset ? "..." : t("saveSyncOffset")}</span>
            </button>
            {hideToolbar && (
              <>
                <button
                  type="button"
                  onClick={handleToggleAutoScroll}
                  title={autoScroll ? t("autoScrollOn") : t("autoScrollOff")}
                  className={`px-2 py-1 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-all ${
                    autoScroll ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/10 text-white/70 hover:bg-white/20"
                  }`}
                >
                  <ArrowsDownUpIcon size={13} aria-hidden="true" />
                  <span>{autoScroll ? t("autoScrollOn") : t("autoScrollOff")}</span>
                </button>
                <button
                  type="button"
                  disabled={lyricsLoading}
                  onClick={() => void handleAutoFetch(showCustomSearch)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <MagicWandIcon size={13} aria-hidden="true" />
                  <span>{t("autoFetchLyrics")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenSourcesModal()}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1 cursor-pointer"
                >
                  <ListDashesIcon size={13} aria-hidden="true" />
                  <span>{t("lyricsSources")}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {offsetSavedMsg && (
        <div className="mb-2 rounded-xl px-3 py-1.5 text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-2 animate-in fade-in duration-200 shrink-0">
          <CheckIcon size={15} weight="bold" />
          <span>{offsetSavedMsg}</span>
        </div>
      )}

      {/* Custom search bar */}
      {showCustomSearch && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAutoFetch(true);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 shrink-0"
        >
          <input
            type="text"
            value={queryTitle}
            onChange={(e) => setQueryTitle(e.target.value)}
            placeholder={t("customLyricsTitlePlaceholder")}
            aria-label={t("trackTitleEn")}
            className={`rounded-xl px-3 py-2 text-xs outline-none focus:outline-none focus-visible:outline-none transition-colors ${
              darkSurface || isEffectiveFullScreen
                ? "bg-white/10 text-white placeholder:text-white/50 focus:bg-white/15"
                : "bg-black/[0.05] dark:bg-white/[0.08] focus:ring-2 focus:ring-[var(--sf-accent)]/50"
            }`}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={queryArtist}
              onChange={(e) => setQueryArtist(e.target.value)}
              placeholder={t("customLyricsArtistPlaceholder")}
              aria-label={t("artistName")}
              className={`flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none focus:outline-none focus-visible:outline-none transition-colors ${
                darkSurface || isEffectiveFullScreen
                  ? "bg-white/10 text-white placeholder:text-white/50 focus:bg-white/15"
                  : "bg-black/[0.05] dark:bg-white/[0.08] focus:ring-2 focus:ring-[var(--sf-accent)]/50"
              }`}
            />
            <button
              type="submit"
              disabled={lyricsLoading}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold cursor-pointer shrink-0 transition-colors active:scale-95 inline-flex items-center justify-center gap-1.5 ${
                darkSurface || isEffectiveFullScreen
                  ? "bg-white text-slate-950 hover:bg-white/90"
                  : "bg-indigo-500 text-white hover:bg-indigo-400"
              }`}
            >
              {lyricsLoading && (
                <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" aria-hidden="true" />
              )}
              <span>{lyricsLoading ? t("fetchingLyrics") : t("navSearch")}</span>
            </button>
          </div>
        </form>
      )}

      {statusMsg && (
        <p
          role="status"
          className={`mt-2 rounded-xl px-3 py-2 text-xs shrink-0 ${
            darkSurface || isEffectiveFullScreen
              ? "bg-amber-500/20 text-amber-200"
              : "bg-amber-500/15 text-amber-800 dark:text-amber-200"
          }`}
        >
          {statusMsg}
        </p>
      )}

      {/* Main Lyrics View */}
      {lyrics.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-75 gap-3">
          <MicrophoneStageIcon size={44} weight="thin" className="opacity-60" aria-hidden="true" />
          <p className="text-sm max-w-xs">{t("noLyricsYet")}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
            <Button
              variant="glass"
              disabled={lyricsLoading}
              onClick={() => void handleAutoFetch(false)}
              icon={<MagicWandIcon size={16} aria-hidden="true" />}
              className="text-xs"
            >
              {lyricsLoading ? t("fetchingLyrics") : t("autoFetchLyrics")}
            </Button>
            <Button
              variant="glass"
              onClick={() => void handleOpenSourcesModal()}
              icon={<ListDashesIcon size={16} aria-hidden="true" />}
              className="text-xs"
            >
              {t("lyricsSources")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onWheel={() => {
            programmaticScrollUntilRef.current = 0;
          }}
          onTouchMove={() => {
            programmaticScrollUntilRef.current = 0;
          }}
          className={`${borderless ? "sf-lyrics-mask-apple" : "sf-lyrics-mask"} relative flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-2 sm:px-6 ${
            borderless
              ? isEffectiveFullScreen
                ? "space-y-2.5 sm:space-y-3.5 xl:space-y-4 pt-[16dvh] pb-[20dvh] sm:pt-[18dvh] sm:pb-[22dvh]"
                : "space-y-2.5 min-[375px]:space-y-3.5 min-[900px]:space-y-5 pt-[11dvh] pb-[14dvh] min-[375px]:pt-[15dvh] min-[375px]:pb-[18dvh] min-[900px]:pt-[24dvh] min-[900px]:pb-[26dvh]"
              : isEffectiveFullScreen
                ? "space-y-4 sm:space-y-6 pt-10 pb-56 sm:pt-14 sm:pb-64"
                : "space-y-4 sm:space-y-6 pt-2 pb-24 sm:pt-3 sm:pb-28"
          }`}
        >
          {lyrics.map((line, index) => {
            const isInstrumental = !line.text || !line.text.trim();
            const firstNonEmptyIdx = lyrics.findIndex((l) => Boolean(l.text && l.text.trim()));
            const isExplicitActive = index === activeLyricIndex;
            const isLeadCue = activeLyricIndex < 0 && borderless && index === (firstNonEmptyIdx >= 0 ? firstNonEmptyIdx : 0);
            const isActive = isExplicitActive;
            const anchorIdx = activeLyricIndex >= 0 ? activeLyricIndex : firstNonEmptyIdx >= 0 ? firstNonEmptyIdx : 0;
            const dist = Math.abs(index - anchorIdx);

            // Strict GPU compositor states (zero font-size/padding layout thrash across lyric lines)
            const appleStageTransform =
              isActive || isLeadCue
                ? "opacity-100 scale-[1.06] text-white sf-lyrics-stage-glow"
                : dist === 1
                  ? "opacity-45 scale-[0.93] text-white"
                  : dist === 2
                    ? "opacity-24 scale-[0.88] text-white"
                    : dist === 3
                      ? "opacity-14 scale-[0.84] text-white"
                      : "opacity-10 scale-[0.82] text-white";

            if (isInstrumental) {
              return (
                <div
                  key={`${line.timeMs}-${index}`}
                  ref={isActive ? (el) => { activeLineRef.current = el; } : undefined}
                  data-active={isActive ? "true" : undefined}
                  className={`py-2 flex items-center justify-center select-none tracking-widest origin-center transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isActive ? "opacity-90 text-white scale-110 text-sm sf-lyrics-active-glow" : "opacity-30 scale-95 text-xs"
                  }`}
                >
                  <span>♪ ♪ ♪</span>
                </div>
              );
            }

            const baseLineSize = isEffectiveFullScreen
              ? "text-[26px] sm:text-4xl xl:text-[44px] py-2 sm:py-3"
              : borderless
                ? "text-[23px] sm:text-[28px] xl:text-[34px] py-1.5 sm:py-2"
                : trackPage
                  ? "text-base sm:text-lg md:text-xl py-1.5 sm:py-2"
                  : "text-lg sm:text-xl lg:text-2xl py-1.5 sm:py-2";

            return (
              <button
                key={`${line.timeMs}-${index}`}
                ref={isActive ? (el) => { activeLineRef.current = el; } : undefined}
                data-active={isActive ? "true" : undefined}
                type="button"
                onClick={() => {
                  seek(line.timeMs / 1000);
                  setAutoScroll(true);
                  setUserHasScrolled(false);
                }}
                dir="auto"
                style={{ textAlign: "center", justifyContent: "center" }}
                className={`group relative w-full rounded-2xl px-2 sm:px-3 origin-center text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 flex flex-col items-center justify-center select-none font-bold tracking-tight transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] ${baseLineSize} ${
                  borderless
                    ? `${appleStageTransform} hover:opacity-90`
                    : isActive
                      ? "opacity-100 scale-[1.04] text-white sf-lyrics-active-glow font-black"
                      : darkSurface || isEffectiveFullScreen
                        ? "opacity-30 scale-[0.94] text-white hover:opacity-80"
                        : "opacity-35 scale-[0.94] text-slate-900 dark:text-white hover:opacity-80"
                }`}
              >
                <span
                  dir="auto"
                  style={{ textAlign: "center", width: "100%" }}
                  className={`block text-center w-full mx-auto ${
                    isEffectiveFullScreen ? "leading-tight sm:leading-snug" : "leading-snug sm:leading-relaxed"
                  } text-wrap-balance break-words`}
                >
                  {line.text}
                </span>
                {!isEffectiveFullScreen && (
                  <span
                    className="absolute end-3 top-1/2 -translate-y-1/2 hidden sm:inline-block opacity-0 group-hover:opacity-40 transition-opacity text-xs font-mono tabular-nums shrink-0 select-none pointer-events-none"
                    dir="ltr"
                  >
                    {formatDuration(line.timeMs / 1000)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Jump to Playing Line pill when user has scrolled away */}
      {userHasScrolled && activeLyricIndex >= 0 && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--sf-bg)]/80 to-transparent z-20 rounded-b-3xl" />
          <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              type="button"
              onClick={() => {
                void triggerHapticFeedback("selection");
                setAutoScroll(true);
                setUserHasScrolled(false);
                scrollToActiveLyric();
              }}
              className="group inline-flex items-center gap-2 rounded-full px-4 sm:px-5 py-2.5 min-h-[44px] text-xs font-semibold select-none cursor-pointer touch-manipulation transition-all duration-200 active:scale-[0.96] shadow-[0_8px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-2xl bg-white/90 text-zinc-900 border border-black/10 hover:bg-white dark:bg-zinc-950/85 dark:text-white dark:border-white/20 dark:hover:bg-zinc-900/95"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              </span>
              <ArrowsDownUpIcon
                size={15}
                weight="bold"
                className="text-zinc-600 dark:text-white/90 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors shrink-0"
                aria-hidden="true"
              />
              <span className="tracking-tight whitespace-nowrap">{t("resumeAutoScroll")}</span>
            </button>
          </div>
        </>
      )}

      {/* Multi-Source Lyrics Switcher Modal */}
      {showSourcesModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl bg-[#0b0e12]/92 backdrop-blur-2xl border border-white/18 p-5 sm:p-6 shadow-2xl text-white overflow-hidden">
            <div className="flex items-center justify-between pb-3.5 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-white/15 text-white flex items-center justify-center border border-white/20">
                  <ListDashesIcon size={18} weight="bold" />
                </div>
                <div>
                  <h3 className="text-base font-bold">{t("lyricsSources")}</h3>
                  <p className="text-xs opacity-60">{t("lyricsSourcesDesc")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSourcesModal(false)}
                aria-label={t("close")}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              >
                <XIcon size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3 [scrollbar-width:thin]">
              {sourcesLoading ? (
                <div className="py-14 flex flex-col items-center justify-center gap-3 text-sm opacity-70">
                  <div className="h-8 w-8 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                  <p>{t("searchingSources")}</p>
                </div>
              ) : availableSources.length === 0 ? (
                <div className="py-12 text-center text-sm opacity-70 space-y-2">
                  <p>{t("noOtherSourcesFound")}</p>
                  <p className="text-xs opacity-50">{t("tryManualSearchHint")}</p>
                </div>
              ) : (
                availableSources.map((cand, idx) => {
                  const isCurrent = cand.source === lyricsSource;
                  const isBusy = applyingSource === cand.source;

                  return (
                    <div
                      key={idx}
                      className={`rounded-2xl p-4 border transition-all ${
                        isCurrent
                          ? "bg-white/[0.12] border-white/30 shadow-sm"
                          : "bg-white/[0.04] hover:bg-white/[0.08] border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{cand.name}</span>
                          <span
                            className={`text-[10.5px] px-2.5 py-0.5 rounded-full font-medium ${
                              cand.isSynced
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {cand.isSynced ? t("syncedSource") : t("plainSource")}
                          </span>
                          <span className="text-xs opacity-60">
                            ({cand.lineCount} {t("linesCount")})
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={isCurrent || isBusy}
                          onClick={async () => {
                            setApplyingSource(cand.source);
                            const ok = await applyLyricsSource(cand.source, cand.lrcContent);
                            setApplyingSource(null);
                            if (ok) {
                              setShowSourcesModal(false);
                            }
                          }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                            isCurrent
                              ? "bg-white/10 text-white/50 cursor-default"
                              : "bg-white text-slate-950 hover:bg-white/90 active:scale-95 shadow cursor-pointer"
                          }`}
                        >
                          {isBusy ? t("applyingSource") : isCurrent ? t("activeSource") : t("applyThisSource")}
                        </button>
                      </div>

                      {cand.providerTrackName && (
                        <p dir="auto" className="text-xs opacity-50 mb-2 truncate">
                          {t("sourceTrackLabel")}: {cand.providerTrackName} {cand.providerArtistName ? `• ${cand.providerArtistName}` : ""}
                        </p>
                      )}

                      {/* Snippet preview */}
                      <div dir="auto" className="text-xs opacity-75 font-sans leading-relaxed line-clamp-2 bg-black/25 p-2.5 rounded-xl border border-white/5">
                        {cand.lrcContent
                          .replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "")
                          .split("\n")
                          .filter((l) => l.trim().length > 0)
                          .slice(0, 3)
                          .join(" • ")}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // If internal full screen modal is activated (e.g. from track detail page)
  if (internalFullScreen && !onToggleFullScreen) {
    return (
      <>
        {renderContent(false)}
        <div
          role="dialog"
          aria-modal="true"
          data-theme="dark"
          data-resolved-theme="dark"
          aria-label={t("fullScreenLyrics")}
          className="dark sf-dark-overlay fixed inset-0 z-50 overflow-hidden bg-[#070814]/98 text-white p-4 sm:p-8 flex flex-col sf-overlay-in"
          style={{
            backgroundImage: `radial-gradient(circle at 50% 20%, ${currentTrack.accentColor}40, transparent 65%), radial-gradient(circle at 80% 80%, #EC489928, transparent 60%)`,
          }}
        >
          {/* Ambient blurred artwork (lightweight compositor-friendly blur) */}
          <img
            src={currentTrack.coverUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover scale-110 blur-2xl opacity-22 select-none"
            style={{ transform: "translate3d(0, 0, 0)" }}
          />

          <div className="relative z-10 flex items-center justify-between gap-4 pb-4 border-b border-white/10 max-w-5xl mx-auto w-full shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={currentTrack.coverUrl}
                alt={pickText(currentTrack.title, currentTrack.titleFa)}
                width={40}
                height={40}
                className="h-10 w-10 rounded-xl object-cover shadow-md shrink-0 border border-white/10"
              />
              <div className="min-w-0">
                <p className="truncate text-base font-bold">{pickText(currentTrack.title, currentTrack.titleFa)}</p>
                <p className="truncate text-xs opacity-70">{pickText(currentTrack.artistName, currentTrack.artistNameFa)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Sleek Apple-style auto-scroll button */}
              <button
                type="button"
                onClick={handleToggleAutoScroll}
                aria-label={t("toggleAutoScroll")}
                title={autoScroll ? t("autoScrollOn") : t("autoScrollOff")}
                className={`sf-btn relative inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer transition-all duration-200 active:scale-95 shrink-0 select-none ${
                  autoScroll
                    ? "bg-white/20 text-white border border-white/25 shadow-sm"
                    : "bg-white/10 text-white/60 hover:bg-white/15 border border-white/10"
                }`}
              >
                <ArrowsDownUpIcon size={15} weight={autoScroll ? "bold" : "regular"} aria-hidden="true" className="shrink-0" />
                <span className={`absolute top-1 end-1 h-1.5 w-1.5 rounded-full transition-colors duration-300 ${autoScroll ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-white/30"}`} />
              </button>

              <button
                type="button"
                onClick={() => setInternalFullScreen(false)}
                aria-label={t("close")}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
              >
                <XIcon size={20} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex-1 max-w-3xl mx-auto w-full my-2 sm:my-3 p-4 sm:p-8 rounded-3xl bg-white/[0.04] sm:bg-white/[0.06] border border-white/10 sm:border-white/15 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.15)] min-h-0 flex flex-col overflow-hidden">
            {renderContent(true)}
          </div>
        </div>
      </>
    );
  }

  return renderContent(false);
}

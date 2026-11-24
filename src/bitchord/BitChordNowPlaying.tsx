"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  BroadcastIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CircleNotchIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FadersIcon,
  FastForwardIcon,
  GaugeIcon,
  HeadphonesIcon,
  HeartIcon,
  InfinityIcon,
  ListDashesIcon,
  ListPlusIcon,
  MagnifyingGlassIcon,
  MusicNoteSimpleIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  QuotesIcon,
  RepeatIcon,
  RepeatOnceIcon,
  RewindIcon,
  ShareNetworkIcon,
  ShuffleIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { GlassSegmented } from "@/components/GlassControls";
import { LyricsPanel } from "@/components/LyricsPanel";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { openPlaylistPicker } from "@/components/PlaylistPickerSheet";
import { useAuth } from "@/context/AuthContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { api, getTrackDetailHref, getTrackShareUrl } from "@/lib/api";
import { buildPaletteFromHex, extractCoverPalette, type CoverPalette } from "@/lib/coverPalette";
import { startTrackDownload, useTrackDownload } from "@/lib/downloadManager";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { formatDuration } from "@/lib/lrc";
import { setAutoMixEnabled, useAutoMixEnabled } from "@/lib/smartAutoMix";
import {
  calculateDampedDrag,
  calculateElasticDrag,
  calculateVelocity,
  createSwipeTouchHandlers,
} from "@/lib/touchGestures";
import type { Track } from "@/lib/types";

const DESKTOP_MEDIA_QUERY = "(min-width: 900px)";
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

function subscribeDesktopViewport(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mq.addEventListener?.("change", onStoreChange);
  return () => mq.removeEventListener?.("change", onStoreChange);
}

function getDesktopViewportSnapshot() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function useIsDesktopViewport() {
  return useSyncExternalStore(subscribeDesktopViewport, getDesktopViewportSnapshot, () => true);
}

function BitChordPillScrubber({
  defaultDuration,
  statusLabel,
}: {
  defaultDuration: number;
  statusLabel?: string | null;
}) {
  const { seek } = usePlayer();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const [scrubVal, setScrubVal] = useState<number | null>(null);

  useEffect(() => {
    if (scrubVal === null) return;
    const endScrub = () => setScrubVal(null);
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("pointercancel", endScrub);
    return () => {
      window.removeEventListener("pointerup", endScrub);
      window.removeEventListener("pointercancel", endScrub);
    };
  }, [scrubVal]);

  const activeTime = Math.min(safeDuration, Math.max(0, scrubVal !== null ? scrubVal : currentTime));
  const remaining = Math.max(0, safeDuration - activeTime);
  const ratio = Math.max(0, Math.min(1, activeTime / safeDuration));

  return (
    <div dir="ltr" className="w-full space-y-1.5 select-none" data-prevent-sheet-drag="true">
      <div className="relative flex items-center h-6">
        <div
          className={`relative w-full h-[6px] rounded-full bg-white/22 overflow-hidden transition-transform duration-150 ${
            scrubVal !== null ? "scale-y-[1.45]" : ""
          }`}
        >
          <div
            className="h-full w-full bg-white/90 rounded-full origin-left transition-transform duration-75"
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
        <input
          type="range"
          aria-label="Seek track position"
          min={0}
          max={safeDuration}
          step={0.25}
          value={activeTime}
          onPointerDown={() => setScrubVal(currentTime)}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            setScrubVal(next);
            seek(next);
          }}
          onPointerUp={() => setScrubVal(null)}
          className="bc-scrubber-range absolute inset-0 w-full h-full cursor-pointer"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] font-medium font-mono tabular-nums text-white/65 px-0.5">
        <span>{formatDuration(activeTime)}</span>
        {statusLabel && (
          <span className="font-sans text-[11px] font-semibold tracking-tight text-white/75 truncate max-w-[56%]">
            {statusLabel}
          </span>
        )}
        <span>-{formatDuration(remaining)}</span>
      </div>
    </div>
  );
}

function BitChordVolumeBar({
  volume,
  muted,
  label,
  onToggleMute,
  onVolumeChange,
}: {
  volume: number;
  muted: boolean;
  label: string;
  onToggleMute: () => void;
  onVolumeChange: (val: number) => void;
}) {
  const [draggingVol, setDraggingVol] = useState(false);
  const pct = muted ? 0 : Math.max(0, Math.min(100, Math.round(volume * 100)));
  const ratio = pct / 100;

  useEffect(() => {
    if (!draggingVol) return;
    const stop = () => setDraggingVol(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [draggingVol]);

  return (
    <div dir="ltr" className="flex items-center gap-3 px-0.5 select-none" data-prevent-sheet-drag="true">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={label}
        className="h-8 w-8 flex items-center justify-center text-white/70 hover:text-white cursor-pointer shrink-0"
      >
        {muted || volume === 0 ? (
          <SpeakerSlashIcon size={16} aria-hidden="true" />
        ) : (
          <SpeakerLowIcon size={16} aria-hidden="true" />
        )}
      </button>
      <div className="relative flex-1 flex items-center h-6">
        <div
          className={`relative w-full h-[5px] rounded-full bg-white/22 overflow-hidden transition-transform duration-150 ${
            draggingVol ? "scale-y-[1.45]" : ""
          }`}
        >
          <div
            className="h-full w-full bg-white/90 rounded-full origin-left transition-transform duration-75"
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
        <input
          type="range"
          aria-label={label}
          min={0}
          max={100}
          step={1}
          value={pct}
          onPointerDown={() => setDraggingVol(true)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (muted) onToggleMute();
            onVolumeChange(v / 100);
          }}
          onPointerUp={() => setDraggingVol(false)}
          className="bc-scrubber-range absolute inset-0 w-full h-full cursor-pointer"
        />
      </div>
      <SpeakerHighIcon size={16} className="text-white/70 shrink-0" aria-hidden="true" />
    </div>
  );
}

function BitChordLyricPreviewBar({ onOpenLyrics }: { onOpenLyrics: () => void }) {
  const { lyrics, lyricsLoading } = usePlayer();
  const { activeLyricIndex } = usePlayerProgress();
  const { t, lang } = useI18n();

  const activeText =
    activeLyricIndex >= 0 && lyrics[activeLyricIndex]?.text?.trim()
      ? lyrics[activeLyricIndex].text.trim()
      : lyrics[0]?.text?.trim() || null;

  return (
    <button
      type="button"
      onClick={() => {
        void triggerHapticFeedback("selection");
        onOpenLyrics();
      }}
      aria-label={t("lyrics")}
      className="bc-control-btn group w-full flex items-center gap-2 py-1 text-start text-white/75 hover:text-white cursor-pointer min-h-[32px]"
    >
      <MusicNoteSimpleIcon size={15} weight="fill" className="text-white/70 shrink-0" aria-hidden="true" />
      <span dir="auto" className="truncate text-[13px] font-medium leading-snug">
        {lyricsLoading
          ? t("fetchingLyrics")
          : activeText || (lang === "fa" ? "نمایش متن آهنگ" : "Open Lyrics")}
      </span>
      <CaretRightIcon
        size={13}
        weight="bold"
        className="text-white/50 group-hover:text-white/90 shrink-0 rtl:rotate-180"
        aria-hidden="true"
      />
    </button>
  );
}

function BitChordQueueList({
  queue,
  currentTrackId,
  onPlay,
}: {
  queue: Track[];
  currentTrackId: string;
  onPlay: (t: Track) => void;
}) {
  const { pickText } = useI18n();
  const activeRef = useRef<HTMLLIElement | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (scrolledRef.current || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    scrolledRef.current = true;
  }, [queue.length, currentTrackId]);

  return (
    <ul className="bc-queue-fade flex-1 min-h-0 overflow-y-auto space-y-1.5 py-2 pe-1 sf-queue-scroll">
      {queue.map((item) => {
        const active = item.id === currentTrackId;
        return (
          <li key={item.id} ref={active ? activeRef : undefined}>
            <button
              type="button"
              onClick={() => {
                void triggerHapticFeedback("selection");
                onPlay(item);
              }}
              className={`bc-control-btn w-full flex items-center gap-3 p-2 rounded-2xl text-start cursor-pointer ${
                active
                  ? "bg-white/18 ring-1 ring-white/20 shadow-md"
                  : "hover:bg-white/10"
              }`}
            >
              <div className="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden shadow-sm ring-1 ring-white/15">
                <OptimizedTrackImage
                  src={item.coverUrl}
                  alt={pickText(item.title, item.titleFa)}
                  trackId={item.id}
                  trackTitle={item.title}
                  artistName={item.artistName}
                  pageUrl={item.pageUrl}
                  accentColor={item.accentColor}
                  className="h-full w-full object-cover"
                />
                {active && (
                  <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                    <span className="flex items-end gap-0.5 h-3.5 w-3" aria-hidden="true">
                      <span className="w-0.5 h-full bg-white rounded-full animate-pulse" />
                      <span className="w-0.5 h-2/3 bg-white rounded-full animate-pulse delay-75" />
                      <span className="w-0.5 h-4/5 bg-white rounded-full animate-pulse delay-150" />
                    </span>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13.5px] ${active ? "font-bold text-white" : "font-semibold text-white/95"}`}>
                  {pickText(item.title, item.titleFa)}
                </p>
                <p className="truncate text-xs text-white/60">
                  {pickText(item.artistName, item.artistNameFa)}
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-white/45 shrink-0">
                {formatDuration(item.durationSec || 0)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function BitChordNowPlaying() {
  const { user, openAuthDialog } = useAuth();
  const isDesktop = useIsDesktopViewport();
  const { t, pickText, dir, lang } = useI18n();
  const {
    currentTrack,
    queue,
    isPlaying,
    isBuffering,
    isCrossfading,
    crossfadeFromTrack,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    playbackRate,
    lyrics,
    lyricsSource,
    lyricsOffsetMs,
    expanded,
    queueOpen,
    setExpanded,
    setQueueOpen,
    playTrack,
    togglePlay,
    next,
    prev,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    setPlaybackRate,
    updateTrackInQueue,
  } = usePlayer();
  const {
    isRemotePlaybackActive,
    localizedActiveDeviceName,
    toggleDevicePicker,
    setDevicePickerOpen,
    transferToThisDevice,
  } = useDeviceSync();
  const autoMixEnabled = useAutoMixEnabled();
  const { status: downloadStatus, progress: downloadProgress } = useTrackDownload(currentTrack);

  const [prevExpandedState, setPrevExpandedState] = useState(expanded);
  const [prevQueueOpen, setPrevQueueOpen] = useState(queueOpen);
  const [prevTrackId, setPrevTrackId] = useState<string | undefined>(currentTrack?.id);
  const [mobileTab, setMobileTab] = useState<"hero" | "lyrics" | "queue">(queueOpen ? "queue" : "hero");
  const [desktopTab, setDesktopTab] = useState<"lyrics" | "queue">(queueOpen ? "queue" : "lyrics");
  const [isLyricsFullscreen, setIsLyricsFullscreen] = useState(false);
  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false);
  const [lyricsToolsOpen, setLyricsToolsOpen] = useState(false);
  const [lyricsSourcesOpen, setLyricsSourcesOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [artworkDeltaX, setArtworkDeltaX] = useState(0);
  const [isSwipingArtwork, setIsSwipingArtwork] = useState(false);
  const [sampledPalette, setSampledPalette] = useState<{ url: string; palette: CoverPalette } | null>(null);

  const containerRef = useRef<HTMLDialogElement>(null);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const shareTimerRef = useRef<number | null>(null);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTimeRef = useRef(0);

  useEffect(() => {
    const coverUrl = currentTrack?.coverUrl;
    if (!coverUrl || !expanded) return;
    let cancelled = false;
    extractCoverPalette(coverUrl).then((palette) => {
      if (!cancelled && palette) {
        setSampledPalette({ url: coverUrl, palette });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.coverUrl, expanded]);

  if (expanded !== prevExpandedState) {
    setPrevExpandedState(expanded);
    if (expanded) {
      setIsClosing(false);
      setHasEntered(false);
      setDragY(0);
      setContextMenuOpen(false);
    }
  }

  if (currentTrack?.id !== prevTrackId) {
    setPrevTrackId(currentTrack?.id);
    setLyricsSearchOpen(false);
    setLyricsToolsOpen(false);
    setLyricsSourcesOpen(false);
    setContextMenuOpen(false);
  }

  if (queueOpen !== prevQueueOpen) {
    setPrevQueueOpen(queueOpen);
    if (queueOpen) {
      setDesktopTab("queue");
      setMobileTab("queue");
    } else {
      setDesktopTab("lyrics");
      setMobileTab("hero");
    }
  }

  useEffect(() => {
    return () => {
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const hasCurrentTrack = Boolean(currentTrack);

  useLayoutEffect(() => {
    const dialog = containerRef.current;
    if (!expanded || !hasCurrentTrack || !dialog) return;
    isClosingRef.current = false;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    return () => {
      if (dialog.open) {
        try {
          dialog.close();
        } catch {
          // ignore
        }
      }
    };
  }, [expanded, hasCurrentTrack]);

  const dismissWithPhysics = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    void triggerHapticFeedback("dismiss");
    setContextMenuOpen(false);
    setIsDragging(false);
    setIsClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      isClosingRef.current = false;
      setIsLyricsFullscreen(false);
      setExpanded(false);
      setIsClosing(false);
      setDragY(0);
    }, 280);
  }, [setExpanded]);

  useEffect(() => {
    if (!expanded || typeof window === "undefined") return;
    const onDismissRequest = (e: Event) => {
      e.preventDefault();
      if (contextMenuOpen) {
        setContextMenuOpen(false);
        return;
      }
      dismissWithPhysics();
    };
    window.addEventListener("soundify-dismiss-now-playing", onDismissRequest);
    return () => window.removeEventListener("soundify-dismiss-now-playing", onDismissRequest);
  }, [expanded, contextMenuOpen, dismissWithPhysics]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isDesktop || contextMenuOpen || e.touches.length !== 1) return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('[role="slider"], input, select, textarea, button, a, [data-prevent-sheet-drag]')) return;
    const scrollableAncestor = targetEl?.closest(".overflow-y-auto");
    if (scrollableAncestor && scrollableAncestor.scrollTop > 2) return;
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchStartTimeRef.current = Date.now();
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    if (e.touches.length !== 1) {
      setIsDragging(false);
      setDragY(0);
      return;
    }
    const deltaY = e.touches[0].clientY - touchStartY.current;
    const deltaX = e.touches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setIsDragging(false);
      setDragY(0);
      return;
    }
    if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX) * 1.05) {
      setDragY(calculateDampedDrag(deltaY));
    } else {
      setDragY(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const dt = Math.max(1, Date.now() - touchStartTimeRef.current);
    const vY = calculateVelocity(dragY, dt);
    if (dragY > 80 || (dragY > 35 && vY > 0.32)) {
      dismissWithPhysics();
    } else {
      setDragY(0);
    }
  };

  const artworkTouchHandlers = useMemo(
    () =>
      createSwipeTouchHandlers({
        dir,
        enableHorizontal: true,
        enableVerticalDismiss: false,
        horizontalThreshold: 38,
        onDragMove: (deltaX, deltaY) => {
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
            setIsSwipingArtwork(true);
            setArtworkDeltaX(calculateElasticDrag(deltaX, 48));
          }
        },
        onSwipeNext: () => next(false),
        onSwipePrev: () => prev(),
        onDragEnd: () => {
          setIsSwipingArtwork(false);
          setArtworkDeltaX(0);
        },
      }),
    [dir, next, prev],
  );

  if (!expanded || !currentTrack) return null;

  const title = pickText(currentTrack.title, currentTrack.titleFa);
  const artist = pickText(currentTrack.artistName, currentTrack.artistNameFa);
  const album = pickText(currentTrack.album, currentTrack.albumFa);
  const safeDuration = Math.max(1, duration || currentTrack.durationSec || 1);
  const coverPalette =
    sampledPalette && sampledPalette.url === currentTrack.coverUrl
      ? sampledPalette.palette
      : buildPaletteFromHex(currentTrack.accentColor);

  const handleLike = async () => {
    if (!user) {
      openAuthDialog();
      return;
    }
    try {
      const willLike = !currentTrack.likedByMe;
      void triggerHapticFeedback("likeToggle", { liked: willLike });
      const res = await api.toggleLike(currentTrack.id, currentTrack);
      updateTrackInQueue({ ...currentTrack, likedByMe: res.liked, likesCount: res.likesCount });
    } catch {
      // ignore
    }
  };

  const handleShare = async () => {
    const shareUrl = getTrackShareUrl(currentTrack.id);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = window.setTimeout(() => setCopiedShare(false), 1800);
    } catch {
      // ignore
    }
  };

  const cyclePlaybackSpeed = () => {
    void triggerHapticFeedback("selection");
    const idx = SPEED_OPTIONS.indexOf(playbackRate);
    const nextRate = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(nextRate);
  };

  const statusBadge = isCrossfading
    ? pickText("AutoMix Active", "میکس روان فعال")
    : isBuffering
      ? pickText("Loading stream...", "در حال بارگذاری...")
      : playbackRate !== 1
        ? `${playbackRate}x`
        : currentTrack.genre || null;

  const playingFromLabel = album
    ? lang === "fa"
      ? `در حال پخش از ${album}`
      : `Playing from ${album}`
    : lang === "fa"
      ? "در حال پخش"
      : "Now Playing";

  return (
    <dialog
      ref={containerRef}
      aria-modal="true"
      data-theme="dark"
      data-resolved-theme="dark"
      aria-label={`${t("nowPlaying")}: ${title}`}
      onCancel={(e) => {
        e.preventDefault();
        if (contextMenuOpen) {
          setContextMenuOpen(false);
          return;
        }
        dismissWithPhysics();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        setIsDragging(false);
        setDragY(0);
      }}
      onAnimationEnd={(e) => {
        if (e.target === containerRef.current && e.animationName === "bc-sheet-in") {
          setHasEntered(true);
        }
      }}
      className={`dark fixed inset-0 z-50 m-0 h-dvh w-screen max-w-none max-h-none border-0 p-0 bg-[#0d0d10] text-white overflow-hidden flex flex-col ${
        isClosing
          ? "bc-sheet-out pointer-events-none"
          : !hasEntered && !isDragging && dragY === 0
            ? "bc-sheet-in"
            : ""
      }`}
      style={{
        "--bc-drag-y": `${dragY}px`,
        transform: isClosing ? undefined : dragY > 0 ? `translate3d(0, ${dragY}px, 0)` : undefined,
        transition:
          isDragging || isClosing ? "none" : "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)",
      } as React.CSSProperties}
    >
      {/* Dynamic BitChord Atmospheric Artwork Backdrop (offline-safe via OptimizedTrackImage) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0 select-none" aria-hidden="true">
        <OptimizedTrackImage
          src={currentTrack.coverUrl}
          trackId={currentTrack.id}
          trackTitle={currentTrack.title}
          artistName={currentTrack.artistName}
          pageUrl={currentTrack.pageUrl}
          accentColor={currentTrack.accentColor}
          alt=""
          className="h-full w-full object-cover scale-125 blur-3xl opacity-62 brightness-[0.78] saturate-[1.65] transition-opacity duration-500"
        />
        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{
            backgroundImage: `radial-gradient(ellipse 92% 82% at 22% 32%, ${coverPalette.ambientLeft}, transparent 72%), radial-gradient(ellipse 88% 78% at 80% 62%, ${coverPalette.ambientRight}, transparent 74%)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/25 to-black/62" />
      </div>

      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden">
        {isDesktop ? (
          /* =================================================================
             DESKTOP BITCHORD 2-COLUMN IMMERSIVE PLAYER
             ================================================================= */
          <>
            <header className="shrink-0 flex items-center justify-between gap-4 px-8 pt-5 pb-2 max-w-[1440px] mx-auto w-full">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={dismissWithPhysics}
                  aria-label={t("collapse")}
                  className="bc-control-btn inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/18 border border-white/15 px-4 h-10 text-xs font-semibold text-white cursor-pointer"
                >
                  <CaretDownIcon size={16} weight="bold" aria-hidden="true" />
                  <span>{t("collapse")}</span>
                </button>
                <span className="text-xs font-medium text-white/60 truncate max-w-xs">{playingFromLabel}</span>
              </div>

              {!isLyricsFullscreen && (
                <GlassSegmented
                  aria-label="Lyrics or Queue"
                  darkSurface
                  whiteActivePill
                  value={desktopTab}
                  onValueChange={(v) => {
                    const nextTab = v as "lyrics" | "queue";
                    setDesktopTab(nextTab);
                    setQueueOpen(nextTab === "queue");
                  }}
                  items={[
                    { value: "lyrics", label: t("lyrics") },
                    { value: "queue", label: `${t("queue")} (${queue.length})` },
                  ]}
                />
              )}

              <div className="flex items-center gap-2">
                {(desktopTab === "lyrics" || isLyricsFullscreen) && (
                  <>
                    {lyrics.length > 0 && lyricsSource !== "none" && (
                      <button
                        type="button"
                        onClick={() => setLyricsSourcesOpen(true)}
                        className="bc-control-btn inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/18 border border-white/15 h-10 px-3.5 text-xs font-semibold text-emerald-300 cursor-pointer"
                      >
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="truncate max-w-[140px]">{lyricsSource}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLyricsSearchOpen((p) => !p)}
                      aria-label={t("navSearch")}
                      className={`bc-control-btn h-10 w-10 rounded-full inline-flex items-center justify-center border border-white/15 cursor-pointer ${
                        lyricsSearchOpen ? "bg-white text-slate-950" : "bg-white/10 hover:bg-white/18 text-white"
                      }`}
                    >
                      <MagnifyingGlassIcon size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLyricsToolsOpen((p) => !p)}
                      aria-label={t("lyricsSyncOffset")}
                      className={`bc-control-btn relative h-10 w-10 rounded-full inline-flex items-center justify-center border border-white/15 cursor-pointer ${
                        lyricsToolsOpen ? "bg-white text-slate-950" : "bg-white/10 hover:bg-white/18 text-white"
                      }`}
                    >
                      <FadersIcon size={16} aria-hidden="true" />
                      {lyricsOffsetMs !== 0 && (
                        <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setIsLyricsFullscreen((p) => !p)}
                  aria-label={isLyricsFullscreen ? t("exitFullScreenLyrics") : t("fullScreenLyrics")}
                  className="bc-control-btn h-10 w-10 rounded-full inline-flex items-center justify-center bg-white/10 hover:bg-white/18 border border-white/15 text-white cursor-pointer"
                >
                  {isLyricsFullscreen ? (
                    <ArrowsInSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  ) : (
                    <ArrowsOutSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  )}
                </button>
              </div>
            </header>

            {isLyricsFullscreen ? (
              <main className="flex-1 min-h-0 max-w-5xl mx-auto w-full px-8 pb-6 flex flex-col">
                <LyricsPanel
                  key={currentTrack.id}
                  fullScreen
                  darkSurface
                  borderless
                  hideToolbar
                  externalSearchOpen={lyricsSearchOpen}
                  onExternalSearchOpenChange={setLyricsSearchOpen}
                  externalToolsOpen={lyricsToolsOpen}
                  onExternalToolsOpenChange={setLyricsToolsOpen}
                  externalSourcesOpen={lyricsSourcesOpen}
                  onExternalSourcesOpenChange={setLyricsSourcesOpen}
                  showControls={false}
                  className="h-full"
                />
              </main>
            ) : (
              <main className="grid grid-cols-12 gap-10 items-center flex-1 min-h-0 max-w-[1360px] mx-auto w-full px-8 pb-6">
            {/* Left Column: BitChord Artwork + Metadata + Controls */}
                <section className="col-span-5 flex flex-col items-center justify-center min-h-0 space-y-5">
                  {isRemotePlaybackActive && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/12 border border-white/15 px-3.5 py-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                      <span className="text-white/80 font-medium truncate max-w-[160px]">
                        {t("playingOn")} {localizedActiveDeviceName}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          void transferToThisDevice();
                        }}
                        className="rounded-full bg-white text-slate-950 px-2.5 py-0.5 text-[11px] font-bold cursor-pointer shrink-0"
                      >
                        {t("playOnThisDevice")}
                      </button>
                    </div>
                  )}
                  <div className="relative w-[min(100%,370px,42dvh)] aspect-square shrink-0">
                    <div
                      className="pointer-events-none absolute -inset-8 rounded-full blur-3xl opacity-55"
                      style={{ background: coverPalette.haloRgba }}
                      aria-hidden="true"
                    />
                    <div
                      key={currentTrack.id}
                      className={`relative h-full w-full rounded-[26px] overflow-hidden shadow-[0_28px_72px_rgba(0,0,0,0.72)] ring-1 ring-white/15 ${
                        isCrossfading && crossfadeFromTrack ? "sf-automix-artwork-in" : "sf-track-swap"
                      }`}
                    >
                      <OptimizedTrackImage
                        src={currentTrack.coverUrl}
                        trackId={currentTrack.id}
                        trackTitle={currentTrack.title}
                        artistName={currentTrack.artistName}
                        pageUrl={currentTrack.pageUrl}
                        alt={title}
                        priority
                        className="h-full w-full object-cover"
                      />
                      {isCrossfading && crossfadeFromTrack && crossfadeFromTrack.id !== currentTrack.id && (
                        <div
                          aria-hidden="true"
                          className="sf-automix-dissolve-out pointer-events-none absolute inset-0 z-10 overflow-hidden"
                        >
                          <OptimizedTrackImage
                            src={crossfadeFromTrack.coverUrl}
                            trackId={crossfadeFromTrack.id}
                            trackTitle={crossfadeFromTrack.title}
                            artistName={crossfadeFromTrack.artistName}
                            pageUrl={crossfadeFromTrack.pageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-full max-w-[390px] space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-2xl font-black tracking-tight text-white">{title}</h2>
                        <p className="truncate text-sm font-medium text-white/70 mt-0.5">{artist}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleLike}
                          aria-label={t("like")}
                          className="bc-control-btn h-10 w-10 rounded-full bg-white/12 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                        >
                          <HeartIcon
                            size={19}
                            weight={currentTrack.likedByMe ? "fill" : "regular"}
                            className={currentTrack.likedByMe ? "text-rose-400" : "text-white"}
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setContextMenuOpen((p) => !p)}
                          aria-label="More actions"
                          className="bc-control-btn h-10 w-10 rounded-full bg-white/12 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                        >
                          <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <BitChordPillScrubber defaultDuration={safeDuration} statusLabel={statusBadge} />

                    <div className="flex items-center justify-between px-2">
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("modeToggle");
                          toggleShuffle();
                        }}
                        aria-label={t("shuffle")}
                        aria-pressed={shuffle}
                        className={`bc-control-btn h-10 w-10 rounded-full flex items-center justify-center cursor-pointer ${
                          shuffle ? "bg-white/20 text-white" : "text-white/55 hover:text-white"
                        }`}
                      >
                        <ShuffleIcon size={18} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("trackSkip");
                          prev();
                        }}
                        aria-label={t("prevTrack")}
                        className="bc-control-btn h-12 w-12 rounded-full flex items-center justify-center text-white hover:bg-white/12 cursor-pointer"
                      >
                        {dir === "rtl" ? (
                          <FastForwardIcon size={26} weight="fill" aria-hidden="true" />
                        ) : (
                          <RewindIcon size={26} weight="fill" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("playPause");
                          togglePlay();
                        }}
                        aria-label={isPlaying ? t("pause") : t("play")}
                        className="bc-control-btn h-14 w-14 rounded-full bg-white text-slate-950 shadow-[0_8px_28px_rgba(255,255,255,0.28)] flex items-center justify-center cursor-pointer"
                      >
                        {isBuffering ? (
                          <CircleNotchIcon size={24} className="animate-spin text-slate-950" aria-hidden="true" />
                        ) : isPlaying ? (
                          <PauseIcon size={24} weight="fill" aria-hidden="true" />
                        ) : (
                          <PlayIcon size={24} weight="fill" className="ms-0.5 rtl:me-0.5 rtl:ms-0" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("trackSkip");
                          next(false);
                        }}
                        aria-label={t("nextTrack")}
                        className="bc-control-btn h-12 w-12 rounded-full flex items-center justify-center text-white hover:bg-white/12 cursor-pointer"
                      >
                        {dir === "rtl" ? (
                          <RewindIcon size={26} weight="fill" aria-hidden="true" />
                        ) : (
                          <FastForwardIcon size={26} weight="fill" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("modeToggle");
                          cycleRepeat();
                        }}
                        aria-label={`${t("repeat")}: ${repeat}`}
                        aria-pressed={repeat !== "off"}
                        className={`bc-control-btn h-10 w-10 rounded-full flex items-center justify-center cursor-pointer ${
                          repeat !== "off" ? "bg-white/20 text-white" : "text-white/55 hover:text-white"
                        }`}
                      >
                        {repeat === "one" ? (
                          <RepeatOnceIcon size={18} weight="bold" aria-hidden="true" />
                        ) : (
                          <RepeatIcon size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <div className="pt-1">
                      <BitChordVolumeBar
                        volume={volume}
                        muted={muted}
                        label={t("volume")}
                        onToggleMute={toggleMute}
                        onVolumeChange={setVolume}
                      />
                    </div>
                  </div>
                </section>

                {/* Right Column: Lyrics or Queue */}
                <section className="col-span-7 h-full max-h-[76dvh] min-h-0 flex flex-col">
                  {desktopTab === "lyrics" ? (
                    <LyricsPanel
                      key={currentTrack.id}
                      darkSurface
                      borderless
                      hideToolbar
                      externalSearchOpen={lyricsSearchOpen}
                      onExternalSearchOpenChange={setLyricsSearchOpen}
                      externalToolsOpen={lyricsToolsOpen}
                      onExternalToolsOpenChange={setLyricsToolsOpen}
                      externalSourcesOpen={lyricsSourcesOpen}
                      onExternalSourcesOpenChange={setLyricsSourcesOpen}
                      showControls={false}
                      className="h-full"
                    />
                  ) : (
                    <div className="flex flex-col h-full min-h-0">
                      <div className="flex items-center justify-between pb-3">
                        <h3 className="text-lg font-extrabold text-white">{t("queue")}</h3>
                        <span className="text-xs font-medium text-white/55 tabular-nums">
                          {queue.length} {t("tracksCount")}
                        </span>
                      </div>
                      <BitChordQueueList
                        queue={queue}
                        currentTrackId={currentTrack.id}
                        onPlay={(tr) => playTrack(tr, queue)}
                      />
                    </div>
                  )}
                </section>
              </main>
            )}
          </>
        ) : (
          /* =================================================================
             MOBILE BITCHORD FULL-BLEED PLAYER / LYRICS / QUEUE (photo_1,3,5,6,8,9)
             ================================================================= */
          <div className="flex flex-col h-full w-full overflow-hidden">
            {mobileTab === "hero" ? (
              /* ---- PLAYER HERO VIEW (photo_1 & photo_5) ---- */
              <div className="bc-view-switch relative flex flex-col h-full w-full min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* Top Drag Handle + "Playing from ..." overlaid gently over top of artwork */}
                <div className="bc-player-top-scrim absolute top-0 inset-x-0 z-20 flex flex-col items-center pt-[max(0.75rem,var(--sat,env(safe-area-inset-top,0px)))] pb-4 px-5 pointer-events-none">
                  <button
                    type="button"
                    onClick={dismissWithPhysics}
                    aria-label={t("collapse")}
                    className="pointer-events-auto flex flex-col items-center gap-1.5 py-1.5 px-6 cursor-pointer"
                  >
                    <span className="h-1 w-9 rounded-full bg-white/65 shadow-sm" />
                    <span className="text-[11px] font-semibold text-white/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] truncate max-w-[78vw]">
                      {playingFromLabel}
                    </span>
                  </button>
                  {isRemotePlaybackActive && (
                    <div className="pointer-events-auto mt-1 inline-flex items-center gap-2 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 px-3 py-1 text-[11px]">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                      <span className="text-white/80 font-medium truncate max-w-[130px]">
                        {localizedActiveDeviceName}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          void transferToThisDevice();
                        }}
                        className="rounded-full bg-white text-slate-950 px-2 py-0.5 text-[10px] font-bold cursor-pointer shrink-0"
                      >
                        {t("playOnThisDevice")}
                      </button>
                    </div>
                  )}
                </div>

                {/* Full-Bleed Edge-to-Edge Artwork with Smooth Bottom Gradient Fade */}
                <div
                  {...artworkTouchHandlers}
                  className="relative w-full flex-1 min-h-[34dvh] max-h-[54dvh] overflow-hidden touch-pan-y select-none"
                  style={{
                    transform: artworkDeltaX !== 0 ? `translate3d(${artworkDeltaX}px, 0, 0)` : undefined,
                    transition: isSwipingArtwork ? "none" : "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  <div
                    key={currentTrack.id}
                    className={`bc-hero-art-mask relative h-full w-full ${
                      isCrossfading && crossfadeFromTrack ? "sf-automix-artwork-in" : "sf-track-swap"
                    }`}
                  >
                    <OptimizedTrackImage
                      src={currentTrack.coverUrl}
                      trackId={currentTrack.id}
                      trackTitle={currentTrack.title}
                      artistName={currentTrack.artistName}
                      pageUrl={currentTrack.pageUrl}
                      alt={title}
                      priority
                      className="h-full w-full object-cover"
                    />
                    {isCrossfading && crossfadeFromTrack && crossfadeFromTrack.id !== currentTrack.id && (
                      <div
                        aria-hidden="true"
                        className="sf-automix-dissolve-out pointer-events-none absolute inset-0 z-10 overflow-hidden"
                      >
                        <OptimizedTrackImage
                          src={crossfadeFromTrack.coverUrl}
                          trackId={crossfadeFromTrack.id}
                          trackTitle={crossfadeFromTrack.title}
                          artistName={crossfadeFromTrack.artistName}
                          pageUrl={crossfadeFromTrack.pageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls Stage melting directly below artwork */}
                <div className="shrink-0 px-6 pb-[max(1rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.65rem))] -mt-6 relative z-20 space-y-3.5">
                  {/* Track Title + Artist + [...] Context Button */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h2 className="truncate text-[21px] min-[380px]:text-[23px] font-black tracking-tight text-white leading-tight">
                          {title}
                        </h2>
                      </div>
                      <p className="truncate text-[14px] font-medium text-white/70 mt-0.5">{artist}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleLike}
                        aria-label={t("like")}
                        className="bc-control-btn h-10 w-10 min-h-[40px] min-w-[40px] rounded-full bg-white/14 hover:bg-white/22 flex items-center justify-center cursor-pointer"
                      >
                        <HeartIcon
                          size={18}
                          weight={currentTrack.likedByMe ? "fill" : "regular"}
                          className={currentTrack.likedByMe ? "text-rose-400" : "text-white"}
                          aria-hidden="true"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          setContextMenuOpen(true);
                        }}
                        aria-label="Track options"
                        className="bc-control-btn h-10 w-10 min-h-[40px] min-w-[40px] rounded-full bg-white/16 hover:bg-white/24 flex items-center justify-center text-white cursor-pointer"
                      >
                        <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Live Lyric Preview Row (photo_1 ♪ >) */}
                  <BitChordLyricPreviewBar onOpenLyrics={() => setMobileTab("lyrics")} />

                  {/* BitChord Tactile Pill Scrubber */}
                  <BitChordPillScrubber defaultDuration={safeDuration} statusLabel={statusBadge} />

                  {/* Large Tactile Transport Controls */}
                  <div className="flex items-center justify-around px-2 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("trackSkip");
                        prev();
                      }}
                      aria-label={t("prevTrack")}
                      className="bc-control-btn h-14 w-14 min-h-[48px] min-w-[48px] rounded-full flex items-center justify-center text-white hover:bg-white/10 cursor-pointer"
                    >
                      {dir === "rtl" ? (
                        <FastForwardIcon size={34} weight="fill" aria-hidden="true" />
                      ) : (
                        <RewindIcon size={34} weight="fill" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("playPause");
                        togglePlay();
                      }}
                      aria-label={isPlaying ? t("pause") : t("play")}
                      className="bc-control-btn h-16 w-16 min-h-[56px] min-w-[56px] rounded-full flex items-center justify-center text-white hover:bg-white/10 cursor-pointer"
                    >
                      {isBuffering ? (
                        <CircleNotchIcon size={34} className="animate-spin text-white" aria-hidden="true" />
                      ) : isPlaying ? (
                        <PauseIcon size={38} weight="fill" aria-hidden="true" />
                      ) : (
                        <PlayIcon size={38} weight="fill" className="ms-1 rtl:me-1 rtl:ms-0" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("trackSkip");
                        next(false);
                      }}
                      aria-label={t("nextTrack")}
                      className="bc-control-btn h-14 w-14 min-h-[48px] min-w-[48px] rounded-full flex items-center justify-center text-white hover:bg-white/10 cursor-pointer"
                    >
                      {dir === "rtl" ? (
                        <RewindIcon size={34} weight="fill" aria-hidden="true" />
                      ) : (
                        <FastForwardIcon size={34} weight="fill" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* Volume Row */}
                  <BitChordVolumeBar
                    volume={volume}
                    muted={muted}
                    label={t("volume")}
                    onToggleMute={toggleMute}
                    onVolumeChange={setVolume}
                  />

                  {/* Bottom Utility Bar (Lyrics | Output Device | Queue) */}
                  <div className="flex items-center justify-between pt-0.5 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setMobileTab("lyrics");
                      }}
                      aria-label={t("showLyrics")}
                      className="bc-control-btn h-11 w-11 min-h-[44px] min-w-[44px] rounded-2xl flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <QuotesIcon size={22} weight="fill" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        toggleDevicePicker();
                      }}
                      aria-label={t("devicesTitle")}
                      className="bc-control-btn flex flex-col items-center justify-center gap-0.5 min-h-[44px] px-3 rounded-2xl text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <HeadphonesIcon
                        size={21}
                        weight={isRemotePlaybackActive ? "fill" : "regular"}
                        className={isRemotePlaybackActive ? "text-emerald-300" : "text-white/85"}
                        aria-hidden="true"
                      />
                      <span className="text-[10.5px] font-medium text-white/65 truncate max-w-[140px]">
                        {isRemotePlaybackActive
                          ? localizedActiveDeviceName
                          : lang === "fa"
                            ? "این دستگاه"
                            : "This Device"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setQueueOpen(true);
                        setMobileTab("queue");
                      }}
                      aria-label={t("queue")}
                      className="bc-control-btn h-11 w-11 min-h-[44px] min-w-[44px] rounded-2xl flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <QueueIcon size={22} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ) : mobileTab === "lyrics" ? (
              /* ---- IMMERSIVE LYRICS VIEW (photo_3) ---- */
              <div className="bc-view-switch flex flex-col h-full w-full px-5 pt-[max(0.75rem,var(--sat,env(safe-area-inset-top,0px)))] pb-[max(1rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.65rem))]">
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={dismissWithPhysics}
                    aria-label={t("collapse")}
                    className="py-1.5 px-6 cursor-pointer"
                  >
                    <span className="block h-1 w-9 rounded-full bg-white/45" />
                  </button>
                </div>

                {/* Compact Mini Header (photo_3) */}
                <div className="flex items-center justify-between gap-3 pb-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("selection");
                      setMobileTab("hero");
                    }}
                    className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer"
                  >
                    <div className="h-11 w-11 rounded-xl overflow-hidden shadow-md ring-1 ring-white/15 shrink-0">
                      <OptimizedTrackImage
                        src={currentTrack.coverUrl}
                        trackId={currentTrack.id}
                        trackTitle={currentTrack.title}
                        artistName={currentTrack.artistName}
                        pageUrl={currentTrack.pageUrl}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{title}</p>
                      <p className="truncate text-xs text-white/65">{artist}</p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {lyrics.length > 0 && lyricsSource !== "none" && (
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          setLyricsSourcesOpen(true);
                        }}
                        aria-label={t("lyricsSources")}
                        title={`${t("lyricsSyncedFrom")} ${lyricsSource}`}
                        className="bc-control-btn inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full bg-white/14 text-emerald-300 text-[11px] font-semibold cursor-pointer max-w-[110px]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="truncate">{lyricsSource}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLyricsSearchOpen((p) => !p)}
                      aria-label={t("navSearch")}
                      className={`bc-control-btn h-9 w-9 rounded-full flex items-center justify-center cursor-pointer ${
                        lyricsSearchOpen ? "bg-white text-slate-950" : "bg-white/14 text-white"
                      }`}
                    >
                      <MagnifyingGlassIcon size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLyricsToolsOpen((p) => !p)}
                      aria-label={t("lyricsSyncOffset")}
                      className={`bc-control-btn relative h-9 w-9 rounded-full flex items-center justify-center cursor-pointer ${
                        lyricsToolsOpen ? "bg-white text-slate-950" : "bg-white/14 text-white"
                      }`}
                    >
                      <FadersIcon size={16} aria-hidden="true" />
                      {lyricsOffsetMs !== 0 && (
                        <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setContextMenuOpen(true)}
                      aria-label="Track options"
                      className="bc-control-btn h-9 w-9 rounded-full bg-white/14 text-white flex items-center justify-center cursor-pointer"
                    >
                      <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Large Bold Apple-Music / BitChord Synced Lyrics */}
                <div className="flex-1 min-h-0">
                  <LyricsPanel
                    key={currentTrack.id}
                    fullScreen
                    darkSurface
                    borderless
                    hideToolbar
                    externalSearchOpen={lyricsSearchOpen}
                    onExternalSearchOpenChange={setLyricsSearchOpen}
                    externalToolsOpen={lyricsToolsOpen}
                    onExternalToolsOpenChange={setLyricsToolsOpen}
                    externalSourcesOpen={lyricsSourcesOpen}
                    onExternalSourcesOpenChange={setLyricsSourcesOpen}
                    showControls={false}
                    className="h-full"
                  />
                </div>

                {/* Compact Bottom Transport + Tab Switcher */}
                <div className="shrink-0 pt-2 space-y-2.5">
                  <BitChordPillScrubber defaultDuration={safeDuration} />
                  <div className="flex items-center justify-between px-4">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setMobileTab("hero");
                      }}
                      aria-label={t("nowPlaying")}
                      className="bc-control-btn h-10 w-10 rounded-xl bg-white/20 text-white flex items-center justify-center cursor-pointer"
                    >
                      <QuotesIcon size={20} weight="fill" aria-hidden="true" />
                    </button>

                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("trackSkip");
                          prev();
                        }}
                        aria-label={t("prevTrack")}
                        className="bc-control-btn h-10 w-10 rounded-full flex items-center justify-center text-white cursor-pointer"
                      >
                        {dir === "rtl" ? (
                          <FastForwardIcon size={24} weight="fill" aria-hidden="true" />
                        ) : (
                          <RewindIcon size={24} weight="fill" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("playPause");
                          togglePlay();
                        }}
                        aria-label={isPlaying ? t("pause") : t("play")}
                        className="bc-control-btn h-12 w-12 rounded-full flex items-center justify-center text-white cursor-pointer"
                      >
                        {isBuffering ? (
                          <CircleNotchIcon size={26} className="animate-spin text-white" aria-hidden="true" />
                        ) : isPlaying ? (
                          <PauseIcon size={30} weight="fill" aria-hidden="true" />
                        ) : (
                          <PlayIcon size={30} weight="fill" className="ms-0.5" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("trackSkip");
                          next(false);
                        }}
                        aria-label={t("nextTrack")}
                        className="bc-control-btn h-10 w-10 rounded-full flex items-center justify-center text-white cursor-pointer"
                      >
                        {dir === "rtl" ? (
                          <RewindIcon size={24} weight="fill" aria-hidden="true" />
                        ) : (
                          <FastForwardIcon size={24} weight="fill" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setQueueOpen(true);
                        setMobileTab("queue");
                      }}
                      aria-label={t("queue")}
                      className="bc-control-btn h-10 w-10 rounded-xl text-white/75 hover:bg-white/10 flex items-center justify-center cursor-pointer"
                    >
                      <QueueIcon size={20} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ---- QUEUE VIEW (photo_6 & photo_9) ---- */
              <div className="bc-view-switch flex flex-col h-full w-full px-5 pt-[max(0.75rem,var(--sat,env(safe-area-inset-top,0px)))] pb-[max(1rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.65rem))]">
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={dismissWithPhysics}
                    aria-label={t("collapse")}
                    className="py-1.5 px-6 cursor-pointer"
                  >
                    <span className="block h-1 w-9 rounded-full bg-white/45" />
                  </button>
                </div>

                {/* Compact Mini Header */}
                <div className="flex items-center justify-between gap-3 pb-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("selection");
                      setQueueOpen(false);
                      setMobileTab("hero");
                    }}
                    className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer"
                  >
                    <div className="h-11 w-11 rounded-xl overflow-hidden shadow-md ring-1 ring-white/15 shrink-0">
                      <OptimizedTrackImage
                        src={currentTrack.coverUrl}
                        trackId={currentTrack.id}
                        trackTitle={currentTrack.title}
                        artistName={currentTrack.artistName}
                        pageUrl={currentTrack.pageUrl}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{title}</p>
                      <p className="truncate text-xs text-white/65">{artist}</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContextMenuOpen(true)}
                    aria-label="Track options"
                    className="bc-control-btn h-9 w-9 rounded-full bg-white/14 text-white flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex items-baseline justify-between pb-1 shrink-0">
                  <h3 className="text-lg font-extrabold text-white">
                    {lang === "fa" ? "صف پخش" : "Queue"}
                  </h3>
                  <span className="text-xs font-medium text-white/60 tabular-nums">
                    {queue.length} {t("tracksCount")}
                  </span>
                </div>
                <p className="text-xs font-medium text-white/60 pb-2 truncate shrink-0">
                  {album
                    ? lang === "fa"
                      ? `ادامه از: ${album}`
                      : `Next from: ${album}`
                    : lang === "fa"
                      ? "قطعات بعدی صف"
                      : "Up Next"}
                </p>

                <BitChordQueueList
                  queue={queue}
                  currentTrackId={currentTrack.id}
                  onPlay={(tr) => playTrack(tr, queue)}
                />

                {/* Persistent Scrubber + Transport + [Lyrics | Shuffle/Repeat/AutoMix Pill | Queue] */}
                <div className="shrink-0 pt-2 space-y-3">
                  <BitChordPillScrubber defaultDuration={safeDuration} statusLabel={statusBadge} />

                  <div className="flex items-center justify-around px-2">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("trackSkip");
                        prev();
                      }}
                      aria-label={t("prevTrack")}
                      className="bc-control-btn h-12 w-12 rounded-full flex items-center justify-center text-white cursor-pointer"
                    >
                      {dir === "rtl" ? (
                        <FastForwardIcon size={30} weight="fill" aria-hidden="true" />
                      ) : (
                        <RewindIcon size={30} weight="fill" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("playPause");
                        togglePlay();
                      }}
                      aria-label={isPlaying ? t("pause") : t("play")}
                      className="bc-control-btn h-14 w-14 rounded-full flex items-center justify-center text-white cursor-pointer"
                    >
                      {isBuffering ? (
                        <CircleNotchIcon size={30} className="animate-spin text-white" aria-hidden="true" />
                      ) : isPlaying ? (
                        <PauseIcon size={34} weight="fill" aria-hidden="true" />
                      ) : (
                        <PlayIcon size={34} weight="fill" className="ms-0.5" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("trackSkip");
                        next(false);
                      }}
                      aria-label={t("nextTrack")}
                      className="bc-control-btn h-12 w-12 rounded-full flex items-center justify-center text-white cursor-pointer"
                    >
                      {dir === "rtl" ? (
                        <RewindIcon size={30} weight="fill" aria-hidden="true" />
                      ) : (
                        <FastForwardIcon size={30} weight="fill" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* Bottom Bar with [Shuffle | Repeat | AutoMix] Segmented Pill (photo_6 & photo_9) */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setQueueOpen(false);
                        setMobileTab("lyrics");
                      }}
                      aria-label={t("showLyrics")}
                      className="bc-control-btn h-11 w-11 rounded-2xl flex items-center justify-center text-white/75 hover:bg-white/10 cursor-pointer shrink-0"
                    >
                      <QuotesIcon size={21} weight="fill" aria-hidden="true" />
                    </button>

                    <div className="inline-flex items-center rounded-full bg-white/12 border border-white/10 overflow-hidden h-10 p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("modeToggle");
                          toggleShuffle();
                        }}
                        aria-label={t("shuffle")}
                        aria-pressed={shuffle}
                        className={`h-full px-4 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                          shuffle ? "bg-white/25 text-white" : "text-white/70 hover:text-white"
                        }`}
                      >
                        <ShuffleIcon size={18} weight="bold" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("modeToggle");
                          cycleRepeat();
                        }}
                        aria-label={`${t("repeat")}: ${repeat}`}
                        aria-pressed={repeat !== "off"}
                        className={`h-full px-4 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                          repeat !== "off" ? "bg-white/25 text-white" : "text-white/70 hover:text-white"
                        }`}
                      >
                        {repeat === "one" ? (
                          <RepeatOnceIcon size={18} weight="bold" aria-hidden="true" />
                        ) : (
                          <RepeatIcon size={18} weight="bold" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          setAutoMixEnabled(!autoMixEnabled);
                        }}
                        aria-label={lang === "fa" ? "ساندیفای میکس" : "Soundify Mix"}
                        aria-pressed={autoMixEnabled}
                        className={`h-full px-4 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                          autoMixEnabled ? "bg-white/25 text-white" : "text-white/70 hover:text-white"
                        }`}
                      >
                        <InfinityIcon size={18} weight="bold" aria-hidden="true" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setQueueOpen(false);
                        setMobileTab("hero");
                      }}
                      aria-label={t("nowPlaying")}
                      className="bc-control-btn h-11 w-11 rounded-2xl bg-white text-slate-950 flex items-center justify-center shadow-md cursor-pointer shrink-0"
                    >
                      <QueueIcon size={21} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =================================================================
          BITCHORD FLOATING GLASS CONTEXT MENU (photo_7 style)
         ================================================================= */}
      {contextMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Track Options"
          className="fixed inset-0 z-[70] flex items-center justify-end lg:justify-start p-5 lg:ps-16 bg-black/45 backdrop-blur-sm"
          onClick={() => setContextMenuOpen(false)}
        >
          <div
            className="bc-glass-menu bc-menu-pop w-full max-w-[270px] max-h-[85dvh] overflow-y-auto rounded-[28px] text-white divide-y divide-white/[0.08]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Share Row */}
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  void handleShare();
                }}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-2xl hover:bg-white/10 transition-colors cursor-pointer"
              >
                {copiedShare ? (
                  <CheckIcon size={20} weight="bold" className="text-emerald-400" aria-hidden="true" />
                ) : (
                  <ShareNetworkIcon size={20} aria-hidden="true" />
                )}
                <span className="text-xs font-semibold">
                  {copiedShare ? t("copiedLink") : t("share")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setContextMenuOpen(false)}
                aria-label={t("close")}
                className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <XIcon size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>

            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setContextMenuOpen(false);
                  void triggerHapticFeedback("selection");
                  openPlaylistPicker(currentTrack);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <ListPlusIcon size={19} aria-hidden="true" />
                <span>{t("addToPlaylist")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuOpen(false);
                  void triggerHapticFeedback("selection");
                  if (downloadStatus !== "downloaded") {
                    void startTrackDownload(currentTrack);
                  }
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <span className="flex items-center gap-3">
                  <DownloadSimpleIcon size={19} aria-hidden="true" />
                  <span>
                    {downloadStatus === "downloaded"
                      ? t("downloaded")
                      : downloadStatus === "downloading"
                        ? `${t("downloading")} ${downloadProgress}%`
                        : t("downloadTrack")}
                  </span>
                </span>
                {downloadStatus === "downloaded" && (
                  <CheckIcon size={16} weight="bold" className="text-emerald-400" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("modeToggle");
                  toggleShuffle();
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <span className="flex items-center gap-3">
                  <ShuffleIcon size={19} aria-hidden="true" />
                  <span>{t("shuffle")}</span>
                </span>
                <span className="text-xs font-bold text-white/60">
                  {shuffle ? (lang === "fa" ? "روشن" : "On") : lang === "fa" ? "خاموش" : "Off"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("modeToggle");
                  cycleRepeat();
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <span className="flex items-center gap-3">
                  {repeat === "one" ? (
                    <RepeatOnceIcon size={19} aria-hidden="true" />
                  ) : (
                    <RepeatIcon size={19} aria-hidden="true" />
                  )}
                  <span>{t("repeat")}</span>
                </span>
                <span className="text-xs font-bold text-white/60 capitalize">{repeat}</span>
              </button>
            </div>

            <div className="py-1">
              <button
                type="button"
                onClick={cyclePlaybackSpeed}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <span className="flex items-center gap-3">
                  <GaugeIcon size={19} aria-hidden="true" />
                  <span>{t("speed")}</span>
                </span>
                <span className="text-xs font-mono font-bold text-white/75">{playbackRate}x</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuOpen(false);
                  setQueueOpen(false);
                  setMobileTab("lyrics");
                  setDesktopTab("lyrics");
                  setLyricsToolsOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <FadersIcon size={19} aria-hidden="true" />
                <span>{t("lyricsSyncOffset")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuOpen(false);
                  setQueueOpen(false);
                  setMobileTab("lyrics");
                  setDesktopTab("lyrics");
                  setLyricsSourcesOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <ListDashesIcon size={19} aria-hidden="true" />
                <span>{t("lyricsSources")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuOpen(false);
                  setDevicePickerOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <BroadcastIcon size={19} aria-hidden="true" />
                <span>{t("devicesTitle")}</span>
              </button>

              <Link
                href={getTrackDetailHref(currentTrack.id)}
                onClick={() => {
                  setContextMenuOpen(false);
                  setExpanded(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer text-start"
              >
                <ChatCircleTextIcon size={19} aria-hidden="true" />
                <span>{t("openTrackPage")}</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

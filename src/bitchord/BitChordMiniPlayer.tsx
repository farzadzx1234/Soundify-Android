"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsOutSimpleIcon,
  BroadcastIcon,
  MusicNotesSimpleIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";
import { Slider } from "@/components/GlassControls";
import { DownloadButton } from "@/components/DownloadButton";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { useTrackDownload } from "@/lib/downloadManager";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { formatDuration } from "@/lib/lrc";
import { calculateElasticDrag, createSwipeTouchHandlers } from "@/lib/touchGestures";
import {
  BitChordPlayPauseGlyph,
  BitChordSkipGlyph,
  BitChordTransportButton,
} from "./BitChordGlyphs";
import { pullLift } from "./motion";

function MiniPlayerLyricOrArtist({ fallback }: { fallback: string }) {
  const { lyrics, isCrossfading } = usePlayer();
  const { lang } = useI18n();
  const { activeLyricIndex } = usePlayerProgress();
  if (isCrossfading) {
    return (
      <p
        dir="auto"
        className="bc-automix-label-pulse truncate text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-300 leading-tight"
      >
        {lang === "fa" ? "در حال میکس..." : "Soundify Mix mixing..."}
      </p>
    );
  }
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text?.trim() : null;
  return (
    <p dir="auto" className="truncate text-[11.5px] font-medium text-slate-600 dark:text-white/65 leading-tight">
      {activeLine || fallback}
    </p>
  );
}

function MiniPlayerMobileProgress({
  defaultDuration,
  isCrossfading,
}: {
  defaultDuration: number;
  isCrossfading: boolean;
}) {
  const { dir } = useI18n();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const ratio = Math.max(0, Math.min(1, currentTime / safeDuration));

  if (isCrossfading) {
    return (
      <div
        aria-hidden="true"
        className="lg:hidden pointer-events-none absolute inset-x-5 bottom-0 h-[2.5px] overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]"
      >
        <div className="bc-automix-bar h-full w-full rounded-full" />
        <div className="bc-automix-sheen absolute inset-0 rounded-full" />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="lg:hidden pointer-events-none absolute inset-x-7 bottom-0 h-[1.5px] overflow-hidden rounded-full bg-black/[0.04] dark:bg-white/[0.05]"
    >
      <div
        className={`h-full w-full bg-slate-900/35 dark:bg-white/30 transition-transform duration-200 ease-out ${
          dir === "rtl" ? "origin-right" : "origin-left"
        }`}
        style={{ transform: `scaleX(${ratio})` }}
      />
    </div>
  );
}

function DesktopScrubber({
  defaultDuration,
  isCrossfading,
}: {
  defaultDuration: number;
  isCrossfading: boolean;
}) {
  const { seek } = usePlayer();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    if (scrubbing === null) return;
    const handleRelease = () => setScrubbing(null);
    window.addEventListener("pointerup", handleRelease);
    window.addEventListener("pointercancel", handleRelease);
    return () => {
      window.removeEventListener("pointerup", handleRelease);
      window.removeEventListener("pointercancel", handleRelease);
    };
  }, [scrubbing]);

  const displayTime = scrubbing !== null ? scrubbing : Math.min(safeDuration, currentTime);

  return (
    <div className="hidden lg:flex items-center gap-2.5 w-full" dir="ltr" data-prevent-swipe="true">
      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-white/55 w-9 text-end shrink-0">
        {formatDuration(displayTime)}
      </span>
      {isCrossfading && scrubbing === null ? (
        <div className="relative flex-1 min-w-0 h-[6px] rounded-full overflow-hidden bg-white/15">
          <div className="bc-automix-bar absolute inset-0 rounded-full" />
          <div className="bc-automix-sheen absolute inset-0 rounded-full" />
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex items-center">
          <Slider
            aria-label="Track progress"
            min={0}
            max={safeDuration}
            step={0.5}
            value={displayTime}
            onPointerDown={() => setScrubbing(currentTime)}
            onValueChange={(val) => {
              setScrubbing(val);
              seek(val);
            }}
            onPointerUp={() => setScrubbing(null)}
          />
        </div>
      )}
      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-white/55 w-9 shrink-0">
        {formatDuration(safeDuration)}
      </span>
    </div>
  );
}

export function BitChordMiniPlayer() {
  const { t, pickText, dir } = useI18n();
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    isCrossfading,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    togglePlay,
    next,
    prev,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    expanded,
    setExpanded,
    queueOpen,
    setQueueOpen,
  } = usePlayer();
  const {
    isRemotePlaybackActive,
    localizedActiveDeviceName,
    toggleDevicePicker,
    transferToThisDevice,
  } = useDeviceSync();

  const { isDownloading: isCurrentTrackDownloading, progress: currentTrackDownloadProgress } =
    useTrackDownload(currentTrack);

  const [dockTranslateX, setDockTranslateX] = useState(0);
  const [dockTranslateY, setDockTranslateY] = useState(0);
  const [isSwipingDock, setIsSwipingDock] = useState(false);
  const [swipingDock, setSwipingDock] = useState(false);
  const [dockPressed, setDockPressed] = useState(false);
  const [nextTapCount, setNextTapCount] = useState(0);
  const [prevTapCount, setPrevTapCount] = useState(0);
  const [trackAnimDir, setTrackAnimDir] = useState<"next" | "prev">("next");
  const prevTrackIdRef = useRef<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number; axis: "x" | "y" | null } | null>(null);

  useEffect(() => {
    if (!currentTrack?.id) return;
    prevTrackIdRef.current = currentTrack.id;
  }, [currentTrack?.id]);

  const triggerNextTrack = () => {
    setTrackAnimDir("next");
    setNextTapCount((c) => c + 1);
    void triggerHapticFeedback("trackSkip");
    next(false);
  };

  const triggerPrevTrack = () => {
    setTrackAnimDir("prev");
    setPrevTapCount((c) => c + 1);
    void triggerHapticFeedback("trackSkip");
    prev();
  };

  const horizontalHandlers = useMemo(
    () =>
      createSwipeTouchHandlers({
        dir,
        enableHorizontal: true,
        enableVerticalDismiss: false,
        horizontalThreshold: 34,
        ignoreSelector: '[role="slider"], input, select, textarea, [data-prevent-swipe]',
        onDragMove: (deltaX, deltaY) => {
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
            setSwipingDock(true);
            setIsSwipingDock(true);
            setDockTranslateX(calculateElasticDrag(deltaX, 34));
          }
        },
        onSwipeNext: () => {
          setSwipingDock(true);
          setTrackAnimDir("next");
          setNextTapCount((c) => c + 1);
          next(false);
        },
        onSwipePrev: () => {
          setSwipingDock(true);
          setTrackAnimDir("prev");
          setPrevTapCount((c) => c + 1);
          prev();
        },
        onDragEnd: () => {
          setIsSwipingDock(false);
          setDockTranslateX(0);
          window.setTimeout(() => setSwipingDock(false), 120);
        },
      }),
    [dir, next, prev],
  );

  const dockTouchHandlers = useMemo(
    () => ({
      onTouchStart: (e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('[role="slider"], input, select, textarea, [data-prevent-swipe]')) return;
        setDockPressed(!target?.closest("button"));
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          time: Date.now(),
          axis: null,
        };
        horizontalHandlers.onTouchStart(e);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const start = touchStartRef.current;
        if (!start || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - start.x;
        const dy = e.touches[0].clientY - start.y;
        if (!start.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          start.axis = Math.abs(dy) > Math.abs(dx) * 1.1 && dy < 0 ? "y" : "x";
        }
        if (start.axis === "y") {
          setSwipingDock(true);
          setIsSwipingDock(true);
          setDockPressed(false);
          const upPull = Math.min(0, dy);
          setDockTranslateY(-pullLift(-upPull));
          setDockTranslateX(0);
          return;
        }
        horizontalHandlers.onTouchMove(e);
      },
      onTouchEnd: (e: React.TouchEvent) => {
        setDockPressed(false);
        const start = touchStartRef.current;
        touchStartRef.current = null;
        if (start?.axis === "y") {
          const endY = e.changedTouches[0]?.clientY ?? start.y;
          const dy = endY - start.y;
          const dt = Math.max(1, Date.now() - start.time);
          const upVelocity = (-dy) / dt;
          setIsSwipingDock(false);
          setDockTranslateY(0);
          window.setTimeout(() => setSwipingDock(false), 120);
          if (dy < -24 || (dy < -12 && upVelocity > 0.25)) {
            void triggerHapticFeedback("selection");
            setExpanded(true);
          }
          return;
        }
        horizontalHandlers.onTouchEnd(e);
      },
      onTouchCancel: () => {
        touchStartRef.current = null;
        setDockPressed(false);
        setIsSwipingDock(false);
        setDockTranslateX(0);
        setDockTranslateY(0);
        setSwipingDock(false);
      },
    }),
    [horizontalHandlers, setExpanded],
  );

  if (!currentTrack) return null;

  const title = pickText(currentTrack.title, currentTrack.titleFa);
  const artist = pickText(currentTrack.artistName, currentTrack.artistNameFa);
  const safeDuration = Math.max(1, duration || currentTrack.durationSec || 1);

  const hasTransform = dockTranslateX !== 0 || dockTranslateY !== 0 || dockPressed;
  const dockTransform = hasTransform
    ? `translate3d(${dockTranslateX}px, ${dockTranslateY}px, 0)${dockPressed && !isSwipingDock ? " scale3d(1.018, 1.018, 1)" : ""}`
    : undefined;

  return (
    <div className="fixed inset-x-3.5 lg:inset-x-6 lg:ms-[272px] bottom-[calc(4.65rem+max(15px,calc(var(--sab,env(safe-area-inset-bottom,0px))+6px)))] lg:bottom-4 z-[45] pointer-events-none">
      {isRemotePlaybackActive && (
        <div className="mx-auto max-w-5xl mb-2 px-1 pointer-events-auto flex justify-center sm:justify-start">
          <div className="bc-pill-glass inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-slate-900 dark:text-white text-xs max-w-full">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={toggleDevicePicker}
              className="font-semibold opacity-80 hover:opacity-100 truncate cursor-pointer"
            >
              {t("playingOn")} {localizedActiveDeviceName}
            </button>
            <button
              type="button"
              onClick={() => void transferToThisDevice()}
              className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
            >
              {t("playOnThisDevice")}
            </button>
          </div>
        </div>
      )}

      <div
        {...dockTouchHandlers}
        onClickCapture={(e) => {
          if (swipingDock) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        style={{
          transform: dockTransform,
          transition: isSwipingDock
            ? "none"
            : "transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="bc-mini-pill relative pointer-events-auto mx-auto max-w-5xl rounded-full px-3 py-1.5 lg:px-5 lg:py-2.5 touch-none lg:touch-pan-y select-none overflow-hidden"
      >
        <MiniPlayerMobileProgress defaultDuration={safeDuration} isCrossfading={isCrossfading} />

        {isCurrentTrackDownloading && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-0 h-[2px] overflow-hidden rounded-full bg-black/[0.04] dark:bg-white/[0.06] z-20"
          >
            <div
              className="h-full bg-emerald-500 dark:bg-emerald-400 transition-transform duration-300 ease-out origin-left"
              style={{
                transform: `scaleX(${Math.max(0.02, currentTrackDownloadProgress / 100)})`,
              }}
            />
          </div>
        )}

        {/* MOBILE FLOATING CAPSULE MINI-PLAYER */}
        <div className="lg:hidden flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              void triggerHapticFeedback("selection");
              setExpanded(true);
            }}
            aria-label={`${t("expandPlayer")}: ${title}`}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-start cursor-pointer active:opacity-80 transition-opacity"
          >
            <div
              key={currentTrack.id}
              className={`${trackAnimDir === "prev" ? "bc-track-prev" : "bc-track-next"} flex items-center gap-2.5 min-w-0 flex-1`}
            >
              <div className="relative h-10 w-10 rounded-[8px] overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/15 shrink-0">
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

              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-[13px] text-slate-900 dark:text-white leading-snug tracking-[0.01em]">
                  {title}
                </p>
                <MiniPlayerLyricOrArtist fallback={artist} />
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <BitChordTransportButton
              onClick={() => {
                void triggerHapticFeedback("playPause");
                togglePlay();
              }}
              circleDiameter={48}
              aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
              className="bc-control-btn h-11 w-10 min-h-[44px] min-w-[40px] rounded-full flex items-center justify-center text-slate-900 dark:text-white cursor-pointer"
            >
              <BitChordPlayPauseGlyph
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                variant="mini"
                size={24}
              />
            </BitChordTransportButton>

            <BitChordTransportButton
              onClick={triggerNextTrack}
              circleDiameter={48}
              aria-label={t("nextTrack")}
              className="bc-control-btn h-11 w-10 min-h-[44px] min-w-[40px] rounded-full flex items-center justify-center text-slate-800 dark:text-white/95 cursor-pointer"
            >
              <BitChordSkipGlyph
                direction="next"
                isRtl={dir === "rtl"}
                tapCount={nextTapCount}
                size={23}
              />
            </BitChordTransportButton>
          </div>
        </div>

        {/* DESKTOP FLOATING PILL DOCK */}
        <div className="hidden lg:flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`${t("expandPlayer")}: ${title}`}
            className="flex items-center gap-3 min-w-0 w-56 xl:w-64 text-start cursor-pointer group shrink-0"
          >
            <div className="relative h-11 w-11 rounded-[10px] overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/15 shrink-0 transition-transform duration-200 group-hover:scale-105">
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
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-sm text-slate-900 dark:text-white">{title}</p>
              <MiniPlayerLyricOrArtist fallback={artist} />
            </div>
          </button>

          <div className="flex flex-col items-center gap-1 flex-1 min-w-0 max-w-lg">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("modeToggle");
                  toggleShuffle();
                }}
                aria-label={t("shuffle")}
                aria-pressed={shuffle}
                className={`bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center cursor-pointer ${
                  shuffle
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                    : "text-slate-500 dark:text-white/60 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.1]"
                }`}
              >
                <ShuffleIcon size={16} aria-hidden="true" />
              </button>

              <BitChordTransportButton
                onClick={triggerPrevTrack}
                aria-label={t("prevTrack")}
                className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-800 dark:text-white/90 cursor-pointer"
              >
                <BitChordSkipGlyph
                  direction="prev"
                  isRtl={dir === "rtl"}
                  tapCount={prevTapCount}
                  size={18}
                />
              </BitChordTransportButton>

              <BitChordTransportButton
                onClick={() => {
                  void triggerHapticFeedback("playPause");
                  togglePlay();
                }}
                aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
                className="bc-control-btn h-10 w-10 rounded-full inline-flex items-center justify-center bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-md cursor-pointer"
              >
                <BitChordPlayPauseGlyph
                  isPlaying={isPlaying}
                  isBuffering={isBuffering}
                  variant="mini"
                  size={18}
                />
              </BitChordTransportButton>

              <BitChordTransportButton
                onClick={triggerNextTrack}
                aria-label={t("nextTrack")}
                className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-800 dark:text-white/90 cursor-pointer"
              >
                <BitChordSkipGlyph
                  direction="next"
                  isRtl={dir === "rtl"}
                  tapCount={nextTapCount}
                  size={18}
                />
              </BitChordTransportButton>

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("modeToggle");
                  cycleRepeat();
                }}
                aria-label={`${t("repeat")}: ${repeat}`}
                aria-pressed={repeat !== "off"}
                className={`bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center cursor-pointer ${
                  repeat !== "off"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                    : "text-slate-500 dark:text-white/60 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.1]"
                }`}
              >
                {repeat === "one" ? (
                  <RepeatOnceIcon size={16} weight="bold" aria-hidden="true" />
                ) : (
                  <RepeatIcon size={16} aria-hidden="true" />
                )}
              </button>
            </div>

            <DesktopScrubber defaultDuration={safeDuration} isCrossfading={isCrossfading} />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5 w-24 xl:w-28" dir="ltr">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={t("volume")}
                className="h-8 w-8 rounded-full inline-flex items-center justify-center text-slate-500 dark:text-white/65 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                {muted || volume === 0 ? (
                  <SpeakerSlashIcon size={16} aria-hidden="true" />
                ) : (
                  <SpeakerHighIcon size={16} aria-hidden="true" />
                )}
              </button>
              <Slider
                aria-label={t("volume")}
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : Math.round(volume * 100)}
                onValueChange={(v) => {
                  if (muted) toggleMute();
                  setVolume(v / 100);
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setQueueOpen(false);
                setExpanded(true);
              }}
              aria-label={t("showLyrics")}
              className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-600 dark:text-white/75 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
            >
              <MusicNotesSimpleIcon size={17} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (expanded && queueOpen) {
                  setQueueOpen(false);
                } else {
                  setQueueOpen(true);
                  setExpanded(true);
                }
              }}
              aria-label={t("queue")}
              className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-600 dark:text-white/75 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
            >
              <QueueIcon size={17} aria-hidden="true" />
            </button>

            <DownloadButton track={currentTrack} size="sm" variant="ghost" />

            <button
              type="button"
              onClick={toggleDevicePicker}
              aria-label={t("devicesTitle")}
              className={`bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center cursor-pointer ${
                isRemotePlaybackActive
                  ? "text-emerald-500 bg-emerald-500/15"
                  : "text-slate-600 dark:text-white/75 hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
              }`}
            >
              <BroadcastIcon size={17} weight={isRemotePlaybackActive ? "fill" : "regular"} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("expandPlayer")}
              className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-600 dark:text-white/75 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
            >
              <ArrowsOutSimpleIcon size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowsOutSimpleIcon,
  BroadcastIcon,
  CircleNotchIcon,
  FastForwardIcon,
  MusicNotesSimpleIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOnceIcon,
  RewindIcon,
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

function MiniPlayerLyricOrArtist({ fallback }: { fallback: string }) {
  const { lyrics } = usePlayer();
  const { activeLyricIndex } = usePlayerProgress();
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text?.trim() : null;
  return (
    <p className="truncate text-[11.5px] font-medium text-slate-600 dark:text-white/65 leading-tight">
      {activeLine || fallback}
    </p>
  );
}

function MiniPlayerMobileProgress({ defaultDuration }: { defaultDuration: number }) {
  const { dir } = useI18n();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const ratio = Math.max(0, Math.min(1, currentTime / safeDuration));

  return (
    <div
      aria-hidden="true"
      className="lg:hidden pointer-events-none absolute inset-x-6 bottom-0 h-[2px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
    >
      <div
        className={`h-full w-full bg-slate-900 dark:bg-white/85 transition-transform duration-200 ease-out ${
          dir === "rtl" ? "origin-right" : "origin-left"
        }`}
        style={{ transform: `scaleX(${ratio})` }}
      />
    </div>
  );
}

function DesktopScrubber({ defaultDuration }: { defaultDuration: number }) {
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
  const [isSwipingDock, setIsSwipingDock] = useState(false);
  const [swipingDock, setSwipingDock] = useState(false);

  const dockTouchHandlers = useMemo(
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
          next(false);
        },
        onSwipePrev: () => {
          setSwipingDock(true);
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

  if (!currentTrack) return null;

  const title = pickText(currentTrack.title, currentTrack.titleFa);
  const artist = pickText(currentTrack.artistName, currentTrack.artistNameFa);
  const safeDuration = Math.max(1, duration || currentTrack.durationSec || 1);

  return (
    <div className="bc-float-dock-in fixed inset-x-3.5 lg:inset-x-6 lg:ms-[272px] bottom-[calc(4.9rem+max(0.75rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.35rem)))] lg:bottom-4 z-[45] pointer-events-none">
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
          transform: dockTranslateX !== 0 ? `translate3d(${dockTranslateX}px, 0, 0)` : undefined,
          transition: isSwipingDock ? "none" : "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="bc-mini-pill relative pointer-events-auto mx-auto max-w-5xl rounded-full px-3.5 py-2 lg:px-5 lg:py-2.5 touch-pan-y select-none overflow-hidden"
      >
        <MiniPlayerMobileProgress defaultDuration={safeDuration} />

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

        {/* MOBILE FLOATING CAPSULE MINI-PLAYER (BitChord photo_2 / photo_4 style) */}
        <div className="lg:hidden flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              void triggerHapticFeedback("selection");
              setExpanded(true);
            }}
            aria-label={`${t("expandPlayer")}: ${title}`}
            className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer active:opacity-80 transition-opacity"
          >
            <div key={currentTrack.id} className="sf-track-swap flex items-center gap-3 min-w-0 flex-1">
              <div className="relative h-10 w-10 rounded-[11px] overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/15 shrink-0">
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
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="truncate font-bold text-[13.5px] text-slate-900 dark:text-white leading-snug">
                    {title}
                  </p>
                  {isCrossfading && (
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-300 shrink-0">
                      Mix
                    </span>
                  )}
                </div>
                <MiniPlayerLyricOrArtist fallback={artist} />
              </div>
            </div>
          </button>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                void triggerHapticFeedback("playPause");
                togglePlay();
              }}
              aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
              className="bc-control-btn h-11 w-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-900 dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
            >
              {isBuffering ? (
                <CircleNotchIcon size={21} className="animate-spin text-slate-900 dark:text-white" aria-hidden="true" />
              ) : isPlaying ? (
                <PauseIcon size={22} weight="fill" aria-hidden="true" />
              ) : (
                <PlayIcon size={22} weight="fill" className="ms-0.5 rtl:me-0.5 rtl:ms-0" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                void triggerHapticFeedback("trackSkip");
                next(false);
              }}
              aria-label={t("nextTrack")}
              className="bc-control-btn h-11 w-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-700 dark:text-white/90 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
            >
              {dir === "rtl" ? (
                <RewindIcon size={21} weight="fill" aria-hidden="true" />
              ) : (
                <FastForwardIcon size={21} weight="fill" aria-hidden="true" />
              )}
            </button>
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
            <div className="relative h-11 w-11 rounded-xl overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/15 shrink-0 transition-transform duration-200 group-hover:scale-105">
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

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("trackSkip");
                  prev();
                }}
                aria-label={t("prevTrack")}
                className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-800 dark:text-white/90 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              >
                {dir === "rtl" ? (
                  <FastForwardIcon size={18} weight="fill" aria-hidden="true" />
                ) : (
                  <RewindIcon size={18} weight="fill" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("playPause");
                  togglePlay();
                }}
                aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
                className="bc-control-btn h-10 w-10 rounded-full inline-flex items-center justify-center bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-md cursor-pointer"
              >
                {isBuffering ? (
                  <CircleNotchIcon size={18} className="animate-spin" aria-hidden="true" />
                ) : isPlaying ? (
                  <PauseIcon size={18} weight="fill" aria-hidden="true" />
                ) : (
                  <PlayIcon size={18} weight="fill" className="ms-0.5 rtl:me-0.5 rtl:ms-0" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("trackSkip");
                  next(false);
                }}
                aria-label={t("nextTrack")}
                className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-800 dark:text-white/90 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              >
                {dir === "rtl" ? (
                  <RewindIcon size={18} weight="fill" aria-hidden="true" />
                ) : (
                  <FastForwardIcon size={18} weight="fill" aria-hidden="true" />
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

            <DesktopScrubber defaultDuration={safeDuration} />
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

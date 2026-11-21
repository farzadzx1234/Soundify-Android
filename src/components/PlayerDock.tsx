"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Slider } from "@/components/GlassControls";
import {
  ArrowsOutSimpleIcon,
  BroadcastIcon,
  CircleNotchIcon,
  MusicNotesSimpleIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { formatDuration } from "@/lib/lrc";
import { DownloadButton } from "@/components/DownloadButton";
import { useTrackDownload } from "@/lib/downloadManager";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { calculateElasticDrag, createSwipeTouchHandlers } from "@/lib/touchGestures";

function PlayerDockSubtitle({ fallback }: { fallback: string }) {
  const { lyrics } = usePlayer();
  const { activeLyricIndex } = usePlayerProgress();
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : null;
  return <p className="truncate text-xs opacity-75">{activeLine ?? fallback}</p>;
}

function PlayerDockMobileProgress({
  defaultDuration,
  accentColor,
}: {
  defaultDuration: number;
  accentColor: string;
}) {
  const { dir } = useI18n();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const ratio = Math.max(0, Math.min(1, currentTime / safeDuration));

  return (
    <div
      aria-hidden="true"
      className="md:hidden pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] overflow-hidden rounded-b-2xl bg-black/[0.04] dark:bg-white/[0.06]"
    >
      <div
        className={`h-full w-full transition-transform duration-200 ease-out ${
          dir === "rtl" ? "origin-right" : "origin-left"
        }`}
        style={{
          backgroundColor: accentColor || "var(--sf-accent)",
          transform: `scaleX(${ratio})`,
        }}
      />
    </div>
  );
}

function PlayerDockSeek({ defaultDuration }: { defaultDuration: number }) {
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
    <div className="hidden md:flex items-center gap-3 w-full" dir="ltr" data-prevent-swipe="true">
      <span className="text-[11px] font-mono tabular-nums text-[var(--sf-muted)] w-10 text-end shrink-0">
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
      <span className="text-[11px] font-mono tabular-nums text-[var(--sf-muted)] w-10 shrink-0">
        {formatDuration(safeDuration)}
      </span>
    </div>
  );
}

export function PlayerDock() {
  const { t, pickText, dir } = useI18n();
  const {
    currentTrack,
    isPlaying,
    isBuffering,
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

  const handleTogglePlay = () => {
    void triggerHapticFeedback("playPause");
    togglePlay();
  };

  const handleToggleShuffle = () => {
    void triggerHapticFeedback("modeToggle");
    toggleShuffle();
  };

  const handleCycleRepeat = () => {
    void triggerHapticFeedback("modeToggle");
    cycleRepeat();
  };

  const handleNext = () => {
    void triggerHapticFeedback("trackSkip");
    next(false);
  };

  const handlePrev = () => {
    void triggerHapticFeedback("trackSkip");
    prev();
  };

  // Horizontal swipe gesture on PlayerDock to skip Next / Prev track
  const dockTouchHandlers = useMemo(
    () =>
      createSwipeTouchHandlers({
        dir,
        enableHorizontal: true,
        enableVerticalDismiss: false,
        horizontalThreshold: 36,
        ignoreSelector: '[role="slider"], input, select, textarea, [data-prevent-swipe]',
        onDragMove: (deltaX, deltaY) => {
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
            setSwipingDock(true);
            setIsSwipingDock(true);
            setDockTranslateX(calculateElasticDrag(deltaX, 36));
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
          window.setTimeout(() => {
            setSwipingDock(false);
          }, 120);
        },
      }),
    [dir, next, prev],
  );

  if (!currentTrack) return null;

  const title = pickText(currentTrack.title, currentTrack.titleFa);
  const artist = pickText(currentTrack.artistName, currentTrack.artistNameFa);
  const safeDuration = Math.max(1, duration || currentTrack.durationSec || 1);

  return (
    <div className="fixed inset-x-2.5 sm:inset-x-4 bottom-[calc(4.25rem+max(0.65rem,calc(env(safe-area-inset-bottom)+0.2rem)))] lg:bottom-4 lg:inset-x-6 lg:ms-[264px] z-[45] pointer-events-none sf-fade-up">
      {/* Apple Liquid Glass Active Remote AirPlay Pill */}
      {isRemotePlaybackActive && (
        <div className="mx-auto max-w-6xl mb-2 px-1 pointer-events-auto flex justify-center sm:justify-start">
          <div className="inline-flex items-center gap-2 sm:gap-2.5 px-3 sm:px-3.5 py-1.5 rounded-full bg-[#111520]/90 border border-white/[0.14] backdrop-blur-2xl shadow-[0_10px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] text-white text-xs transition-all max-w-full">
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.75)]" aria-hidden="true" />
            <button
              type="button"
              onClick={toggleDevicePicker}
              aria-label={`${t("playingOn")} ${localizedActiveDeviceName}`}
              title={t("connectedDevicesTooltip")}
              className="group font-semibold text-white/80 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 min-w-0"
            >
              <span className="shrink-0 text-white/60 text-[11px]">{t("playingOn")}</span>
              <span className="truncate text-white font-bold">{localizedActiveDeviceName}</span>
            </button>
            <span className="h-3.5 w-px bg-white/15 shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={() => void transferToThisDevice()}
              aria-label={t("playOnThisDevice")}
              className="inline-flex items-center gap-1 font-bold text-[11px] px-2.5 py-1 rounded-full bg-white text-slate-950 hover:bg-white/90 active:scale-95 transition-all cursor-pointer shrink-0"
            >
              <span>{t("playOnThisDevice")}</span>
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
          transition: isSwipingDock ? "none" : "transform 0.28s cubic-bezier(0.18, 0.89, 0.32, 1)",
        }}
        className="sf-dock-glass relative pointer-events-auto mx-auto max-w-6xl rounded-2xl px-3 py-2 sm:px-5 sm:py-3 touch-pan-y select-none overflow-hidden"
      >
        <PlayerDockMobileProgress defaultDuration={safeDuration} accentColor={currentTrack.accentColor} />

        {/* Real-time determinate download progress bar across the dock top edge */}
        {isCurrentTrackDownloading && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] overflow-hidden rounded-t-2xl bg-black/[0.04] dark:bg-white/[0.06] z-20"
          >
            <div
              className={`h-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-300 ease-out ${
                dir === "rtl" ? "origin-right float-right" : "origin-left float-left"
              }`}
              style={{ width: `${Math.max(2, currentTrackDownloadProgress)}%` }}
            />
          </div>
        )}

        {/* =========================================================================
            1. MOBILE MINI PLAYER (Pure Apple Music HIG & Liquid Glass)
           ========================================================================= */}
        <div className="lg:hidden flex items-center justify-between gap-2.5">
          {/* Track cover & Info (Tapping opens NowPlayingOverlay) */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`${t("expandPlayer")}: ${title}`}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-start cursor-pointer group active:opacity-85 transition-opacity"
          >
            <div key={currentTrack.id} className="sf-track-swap flex items-center gap-2.5 min-w-0 flex-1">
              <div className="relative shrink-0 h-[42px] w-[42px] rounded-[10px] overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.25)] border border-black/[0.08] dark:border-white/[0.12] bg-white/[0.05]">
                <OptimizedTrackImage
                  src={currentTrack.coverUrl}
                  trackId={currentTrack.id}
                  alt={title}
                  className="h-full w-full object-cover shrink-0"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="truncate font-semibold text-[13px] sm:text-sm text-slate-900 dark:text-white">{title}</p>
                  {isPlaying && (
                    <span aria-hidden="true" className="flex items-end gap-0.5 h-2.5 px-1 py-0.5 rounded-full bg-emerald-500/15 shrink-0">
                      <span className="sf-eq-bar w-0.5 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full" />
                      <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-500 dark:bg-emerald-400 rounded-full" style={{ animationDelay: "0.2s" }} />
                      <span className="sf-eq-bar w-0.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 rounded-full" style={{ animationDelay: "0.4s" }} />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0 mt-0.5">
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-300/85 font-medium">{artist}</p>
                  {isCurrentTrackDownloading && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 dark:text-emerald-400 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                      <span dir="ltr">{currentTrackDownloadProgress}%</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>

          {/* Minimalist Apple Controls (Play/Pause + Next Track) with standard 44px+ touch targets */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleTogglePlay}
              aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
              className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full text-slate-900 dark:text-white hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center active:scale-90 active:opacity-75 transition-all cursor-pointer"
            >
              {isBuffering ? (
                <CircleNotchIcon size={22} className="animate-spin text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
              ) : isPlaying ? (
                <PauseIcon size={24} weight="fill" aria-hidden="true" />
              ) : (
                <PlayIcon size={24} weight="fill" className="ms-0.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={handleNext}
              aria-label={t("nextTrack")}
              className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center active:scale-90 active:opacity-75 transition-all cursor-pointer"
            >
              {dir === "rtl" ? (
                <SkipBackIcon size={22} weight="fill" aria-hidden="true" />
              ) : (
                <SkipForwardIcon size={22} weight="fill" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* =========================================================================
            2. DESKTOP FULL CONTROLS DOCK (lg:flex)
           ========================================================================= */}
        <div className="hidden lg:flex items-center justify-between gap-3 sm:gap-4">
          {/* Track info + Cover */}
          <div className="flex items-center gap-3 min-w-0 flex-initial w-44 xl:w-60 min-[1360px]:w-64 text-start">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`${t("expandPlayer")}: ${title}`}
              className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer group"
            >
              <div className="relative shrink-0">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-1 rounded-2xl opacity-40 blur-md transition-opacity"
                  style={{
                    background: `radial-gradient(circle, ${currentTrack.accentColor || "#6366f1"} 0%, transparent 72%)`,
                  }}
                />
                <div className="relative h-12 w-12 rounded-xl overflow-hidden shadow-md shrink-0 transition-transform duration-300 group-hover:scale-105 bg-white/[0.05]">
                  <OptimizedTrackImage
                    src={currentTrack.coverUrl}
                    trackId={currentTrack.id}
                    alt={title}
                    className="h-full w-full object-cover shrink-0"
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="truncate font-bold text-sm text-white">{title}</p>
                  {isPlaying && (
                    <span aria-hidden="true" className="flex items-end gap-0.5 h-3 px-1.5 py-0.5 rounded-full bg-emerald-500/15 shrink-0">
                      <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-400 rounded-full" />
                      <span className="sf-eq-bar w-0.5 h-3 bg-emerald-400 rounded-full" style={{ animationDelay: "0.2s" }} />
                      <span className="sf-eq-bar w-0.5 h-2 bg-emerald-400 rounded-full" style={{ animationDelay: "0.4s" }} />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0 mt-0.5">
                  <PlayerDockSubtitle fallback={artist} />
                  {isCurrentTrackDownloading && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span dir="ltr">{currentTrackDownloadProgress}%</span>
                    </span>
                  )}
                </div>
                {isRemotePlaybackActive && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 mt-0.5 truncate max-w-full"
                  >
                    <BroadcastIcon size={11} weight="fill" className="shrink-0 animate-pulse" />
                    <span className="truncate">{t("playingOn")} {localizedActiveDeviceName}</span>
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Center Controls + Seek Slider */}
          <div className="flex flex-col items-center gap-1 flex-1 min-w-0 max-w-xl">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={handleToggleShuffle}
                aria-label={t("shuffle")}
                title={t("shuffle")}
                aria-pressed={shuffle}
                className={`hidden sm:inline-flex h-10 w-10 sm:h-9 sm:w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-full transition-colors cursor-pointer ${
                  shuffle ? "text-indigo-400 bg-white/[0.12]" : "text-slate-400 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                <ShuffleIcon size={18} aria-hidden="true" />
              </button>

              <div className="hidden sm:inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("prevTrack")}
                  title={t("prevTrack")}
                  className="min-h-[44px] min-w-[44px]"
                  icon={
                    dir === "rtl" ? (
                      <SkipForwardIcon size={18} weight="fill" aria-hidden="true" />
                    ) : (
                      <SkipBackIcon size={18} weight="fill" aria-hidden="true" />
                    )
                  }
                  onClick={handlePrev}
                />
              </div>

              <Button
                type="button"
                variant="filled"
                tint={currentTrack.accentColor}
                aria-label={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
                title={isBuffering ? pickText("Buffering...", "در حال بارگذاری...") : isPlaying ? t("pause") : t("play")}
                className="min-h-[44px] min-w-[44px]"
                icon={
                  isBuffering ? (
                    <CircleNotchIcon size={20} className="animate-spin text-white" aria-hidden="true" />
                  ) : isPlaying ? (
                    <PauseIcon size={20} weight="fill" aria-hidden="true" />
                  ) : (
                    <PlayIcon size={20} weight="fill" aria-hidden="true" />
                  )
                }
                onClick={handleTogglePlay}
              />

              <Button
                type="button"
                variant="ghost"
                aria-label={t("nextTrack")}
                title={t("nextTrack")}
                className="min-h-[44px] min-w-[44px]"
                icon={
                  dir === "rtl" ? (
                    <SkipBackIcon size={18} weight="fill" aria-hidden="true" />
                  ) : (
                    <SkipForwardIcon size={18} weight="fill" aria-hidden="true" />
                  )
                }
                onClick={handleNext}
              />

              <button
                type="button"
                onClick={handleCycleRepeat}
                aria-label={`${t("repeat")}: ${repeat}`}
                title={`${t("repeat")}: ${repeat}`}
                aria-pressed={repeat !== "off"}
                className={`hidden sm:inline-flex h-10 w-10 sm:h-9 sm:w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-full transition-colors cursor-pointer ${
                  repeat !== "off" ? "text-indigo-400 bg-white/[0.12]" : "text-slate-400 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                {repeat === "one" ? (
                  <RepeatOnceIcon size={18} weight="bold" aria-hidden="true" />
                ) : (
                  <RepeatIcon size={18} aria-hidden="true" />
                )}
              </button>
            </div>

            <PlayerDockSeek defaultDuration={safeDuration} />
          </div>

          {/* Right Utilities: Lyrics / Queue / Volume / Expand */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="hidden lg:flex items-center gap-2 w-20 xl:w-28 me-0.5 xl:me-1" dir="ltr">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={t("volume")}
                title={muted || volume === 0 ? "Unmute" : t("volume")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                {muted || volume === 0 ? (
                  <SpeakerSlashIcon size={17} aria-hidden="true" />
                ) : (
                  <SpeakerHighIcon size={17} aria-hidden="true" />
                )}
              </button>
              <Slider
                aria-label={t("volume")}
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : Math.round(volume * 100)}
                onValueChange={(v) => setVolume(v / 100)}
              />
            </div>

            <div className="hidden xl:inline-flex">
              <Button
                type="button"
                variant="ghost"
                aria-label={t("showLyrics")}
                title={t("showLyrics")}
                icon={<MusicNotesSimpleIcon size={18} aria-hidden="true" />}
                onClick={() => {
                  setQueueOpen(false);
                  setExpanded(true);
                }}
              />
            </div>

            <div className="hidden sm:inline-flex">
              <Button
                type="button"
                variant="ghost"
                aria-label={t("queue")}
                title={t("queue")}
                aria-expanded={expanded && queueOpen}
                icon={<QueueIcon size={18} aria-hidden="true" />}
                onClick={() => {
                  if (expanded && queueOpen) {
                    setQueueOpen(false);
                  } else {
                    setQueueOpen(true);
                    setExpanded(true);
                  }
                }}
              />
            </div>

            {/* Offline PWA Download Button (visible on tablet/desktop) */}
            <div className="hidden sm:inline-flex">
              <DownloadButton track={currentTrack} size="md" />
            </div>

            {/* Soundify Connect Multi-Device Button */}
            <div className="relative inline-flex">
              <button
                type="button"
                onClick={toggleDevicePicker}
                aria-label={
                  isRemotePlaybackActive
                    ? `${t("playingOn")} ${localizedActiveDeviceName}`
                    : t("devicesTitle")
                }
                title={
                  isRemotePlaybackActive
                    ? `${t("playingOn")} ${localizedActiveDeviceName}`
                    : t("connectedDevicesTooltip")
                }
                className={`relative inline-flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-full transition-all cursor-pointer ${
                  isRemotePlaybackActive
                    ? "text-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                <BroadcastIcon size={18} weight={isRemotePlaybackActive ? "fill" : "regular"} aria-hidden="true" />
                {isRemotePlaybackActive && (
                  <span className="absolute top-1 end-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                  </span>
                )}
              </button>
            </div>

            <div className="hidden sm:inline-flex">
              <Button
                type="button"
                variant="ghost"
                aria-label={t("expandPlayer")}
                title={t("expandPlayer")}
                className="min-h-[44px] min-w-[44px]"
                icon={<ArrowsOutSimpleIcon size={18} aria-hidden="true" />}
                onClick={() => setExpanded(true)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

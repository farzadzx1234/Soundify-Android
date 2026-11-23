"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { GlassSegmented, Slider } from "@/components/GlassControls";
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  BroadcastIcon,
  CaretDownIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CircleNotchIcon,
  FadersIcon,
  HeartIcon,
  ListPlusIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShareNetworkIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";
import { api, getTrackDetailHref, getTrackShareUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import {
  buildPaletteFromHex,
  extractCoverPalette,
  type CoverPalette,
} from "@/lib/coverPalette";
import { formatDuration } from "@/lib/lrc";
import type { Track } from "@/lib/types";
import { LyricsPanel } from "./LyricsPanel";
import { SpectrumVisualizer } from "./SpectrumVisualizer";
import { WaveformScrubber } from "./WaveformScrubber";
import { DownloadButton } from "./DownloadButton";
import { OptimizedTrackImage } from "./OptimizedTrackImage";
import { openPlaylistPicker } from "./PlaylistPickerSheet";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import {
  calculateDampedDrag,
  calculateElasticDrag,
  calculateVelocity,
  createSwipeTouchHandlers,
} from "@/lib/touchGestures";

const SPEED_ITEMS = [
  { value: "0.75", label: "0.75x" },
  { value: "1", label: "1x" },
  { value: "1.25", label: "1.25x" },
  { value: "1.5", label: "1.5x" },
];

const DESKTOP_MEDIA_QUERY = "(min-width: 900px)";

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
  return useSyncExternalStore(
    subscribeDesktopViewport,
    getDesktopViewportSnapshot,
    () => true
  );
}

function NowPlayingDockTimeline({
  peaks,
  defaultDuration,
  accentColor,
  layout = "inline",
}: {
  peaks: number[];
  defaultDuration: number;
  accentColor: string;
  layout?: "inline" | "stacked";
}) {
  const { seek } = usePlayer();
  const { currentTime, duration } = usePlayerProgress();
  const safeDuration = Math.max(1, duration || defaultDuration || 1);
  const clampedTime = Math.min(safeDuration, Math.max(0, currentTime));

  if (layout === "stacked") {
    return (
      <div className="w-full space-y-1 select-none">
        <WaveformScrubber
          variant="dock"
          showTimestamps={false}
          peaks={peaks}
          durationSec={safeDuration}
          currentTimeSec={clampedTime}
          accentColor={accentColor}
          onSeek={seek}
        />
        <div
          dir="ltr"
          className="flex items-center justify-between px-0.5 text-[11px] font-mono tabular-nums text-white/60"
        >
          <span>{formatDuration(clampedTime)}</span>
          <span>{formatDuration(safeDuration)}</span>
        </div>
      </div>
    );
  }

  return (
    <div dir="ltr" className="flex items-center gap-2 w-full min-w-0 select-none">
      <span className="text-[11px] font-mono tabular-nums text-white/70 w-9 text-end shrink-0">
        {formatDuration(clampedTime)}
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <WaveformScrubber
          variant="dock"
          showTimestamps={false}
          peaks={peaks}
          durationSec={safeDuration}
          currentTimeSec={clampedTime}
          accentColor={accentColor}
          onSeek={seek}
        />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-white/70 w-9 shrink-0">
        {formatDuration(safeDuration)}
      </span>
    </div>
  );
}

function LiveLyricsPeek({ onOpenLyrics }: { onOpenLyrics: () => void }) {
  const { lyrics, lyricsLoading } = usePlayer();
  const { activeLyricIndex } = usePlayerProgress();
  const { t } = useI18n();

  if (lyricsLoading) {
    return (
      <button
        type="button"
        onClick={onOpenLyrics}
        className="w-full max-w-sm min-h-[56px] px-4 py-2 rounded-2xl text-center text-xs text-white/60 hover:bg-white/[0.06] transition-colors cursor-pointer"
      >
        {t("fetchingLyrics")}
      </button>
    );
  }

  if (!lyrics.length) {
    return (
      <button
        type="button"
        onClick={onOpenLyrics}
        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white/75 transition-colors cursor-pointer"
      >
        <span>{t("lyrics")}</span>
      </button>
    );
  }

  const centerIdx = activeLyricIndex >= 0 ? activeLyricIndex : 0;
  let prevLine = "";
  for (let i = centerIdx - 1; i >= 0; i--) {
    const txt = lyrics[i]?.text?.trim();
    if (txt) {
      prevLine = txt;
      break;
    }
  }
  const activeLine = lyrics[centerIdx]?.text?.trim() || "♪ ♪ ♪";
  let nextLine = "";
  for (let i = centerIdx + 1; i < lyrics.length; i++) {
    const txt = lyrics[i]?.text?.trim();
    if (txt) {
      nextLine = txt;
      break;
    }
  }

  return (
    <button
      type="button"
      onClick={onOpenLyrics}
      aria-label={t("lyrics")}
      className="sf-press group w-full max-w-[356px] sm:max-w-md shrink-0 min-h-[38px] px-2 py-0.5 min-[375px]:py-1 rounded-2xl text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 overflow-hidden"
    >
      <div
        key={centerIdx}
        className="sf-lyric-peek-in space-y-0.5 min-[375px]:space-y-1"
      >
        <p dir="auto" className="truncate text-[11px] min-[375px]:text-[13px] text-white/45 group-hover:text-white/70 transition-opacity duration-300 leading-tight min-h-[0.95rem] min-[375px]:min-h-[1.1rem]">
          {prevLine || "\u00A0"}
        </p>
        <p
          dir="auto"
          className="truncate min-[375px]:whitespace-normal min-[375px]:line-clamp-2 text-[15px] min-[375px]:text-[18px] sm:text-[19px] font-black text-white leading-snug sf-lyrics-active-glow"
        >
          {activeLine}
        </p>
        <p dir="auto" className="truncate text-[11px] min-[375px]:text-[13px] text-white/42 group-hover:text-white/65 transition-opacity duration-300 leading-tight min-h-[0.95rem] min-[375px]:min-h-[1.1rem]">
          {nextLine || "\u00A0"}
        </p>
      </div>
    </button>
  );
}

function DockTransport({
  isPlaying,
  isBuffering = false,
  shuffle,
  repeat,
  dir,
  size = "desktop",
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  labels,
}: {
  isPlaying: boolean;
  isBuffering?: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  dir: "rtl" | "ltr";
  size?: "desktop" | "mobile";
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  labels: {
    shuffle: string;
    prev: string;
    play: string;
    pause: string;
    next: string;
    repeat: string;
    loading?: string;
  };
}) {
  const isMobile = size === "mobile";
  const sideBtnClass = isMobile
    ? "h-11 w-11 min-h-[44px] min-w-[44px]"
    : "h-9 w-9 min-h-[36px] min-w-[36px]";
  const skipBtnClass = isMobile
    ? "h-11 w-11 min-h-[44px] min-w-[44px]"
    : "h-9 w-9 min-h-[36px] min-w-[36px]";
  const playBtnClass = isMobile
    ? "h-[54px] w-[54px] min-h-[54px] min-w-[54px]"
    : "h-12 w-12 min-h-[48px] min-w-[48px]";

  return (
    <div className={`flex items-center justify-center ${isMobile ? "w-full justify-between px-1 min-[375px]:px-2" : "gap-1.5 xl:gap-2.5"}`}>
      <button
        type="button"
        onClick={onToggleShuffle}
        aria-label={labels.shuffle}
        aria-pressed={shuffle}
        className={`${sideBtnClass} inline-flex items-center justify-center rounded-full cursor-pointer transition-colors ${
          shuffle
            ? "text-white bg-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
            : "text-white/55 hover:text-white hover:bg-white/10"
        }`}
      >
        <ShuffleIcon size={isMobile ? 19 : 16} aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label={labels.prev}
        onClick={onPrev}
        className={`${skipBtnClass} inline-flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/12 transition-all cursor-pointer active:scale-95`}
      >
        {dir === "rtl" ? (
          <SkipForwardIcon size={isMobile ? 22 : 18} weight="fill" aria-hidden="true" />
        ) : (
          <SkipBackIcon size={isMobile ? 22 : 18} weight="fill" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        aria-label={isBuffering ? (labels.loading || "Loading...") : isPlaying ? labels.pause : labels.play}
        onClick={onTogglePlay}
        className={`${playBtnClass} inline-flex items-center justify-center rounded-full bg-white text-[#0b0e17] shadow-[0_0_24px_rgba(255,255,255,0.34)] hover:scale-105 active:scale-95 transition-all cursor-pointer`}
      >
        {isBuffering ? (
          <CircleNotchIcon size={isMobile ? 22 : 19} className="animate-spin text-[#0b0e17]" aria-hidden="true" />
        ) : isPlaying ? (
          <PauseIcon size={isMobile ? 22 : 19} weight="fill" aria-hidden="true" />
        ) : (
          <PlayIcon size={isMobile ? 22 : 19} weight="fill" className="translate-x-0.5 rtl:-translate-x-0.5" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        aria-label={labels.next}
        onClick={onNext}
        className={`${skipBtnClass} inline-flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/12 transition-all cursor-pointer active:scale-95`}
      >
        {dir === "rtl" ? (
          <SkipBackIcon size={isMobile ? 22 : 18} weight="fill" aria-hidden="true" />
        ) : (
          <SkipForwardIcon size={isMobile ? 22 : 18} weight="fill" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onCycleRepeat}
        aria-label={`${labels.repeat}: ${repeat}`}
        aria-pressed={repeat !== "off"}
        className={`${sideBtnClass} inline-flex items-center justify-center rounded-full cursor-pointer transition-colors ${
          repeat !== "off"
            ? "text-white bg-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
            : "text-white/55 hover:text-white hover:bg-white/10"
        }`}
      >
        {repeat === "one" ? (
          <RepeatOnceIcon size={isMobile ? 19 : 16} weight="bold" aria-hidden="true" />
        ) : (
          <RepeatIcon size={isMobile ? 19 : 16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function DockVolumeAndSpeed({
  volume,
  muted,
  playbackRate,
  onToggleMute,
  onVolumeChange,
  onSpeedChange,
  volumeLabel,
  speedLabel,
  sliderWidthClass = "w-24 xl:w-28",
  compact = false,
}: {
  volume: number;
  muted: boolean;
  playbackRate: number;
  onToggleMute: () => void;
  onVolumeChange: (val: number) => void;
  onSpeedChange: (rate: number) => void;
  volumeLabel: string;
  speedLabel: string;
  sliderWidthClass?: string;
  compact?: boolean;
}) {
  return (
    <div
      dir="ltr"
      className={`flex items-center ${compact ? "justify-between gap-1.5 min-[360px]:gap-2 w-full flex-nowrap" : "gap-2.5 shrink-0"} overflow-visible`}
    >
      <div className={`flex items-center gap-1 min-[360px]:gap-1.5 overflow-visible ${compact ? "flex-1 min-w-0" : ""}`}>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={volumeLabel}
          className={`inline-flex items-center justify-center rounded-full cursor-pointer text-white/75 hover:text-white hover:bg-white/10 shrink-0 transition-colors ${
            compact ? "h-8 w-8 min-h-[32px] min-w-[32px]" : "h-9 w-9 min-h-[36px] min-w-[36px]"
          }`}
        >
          {muted || volume === 0 ? (
            <SpeakerSlashIcon size={17} aria-hidden="true" />
          ) : (
            <SpeakerHighIcon size={17} aria-hidden="true" />
          )}
        </button>

        {/* Glisse iPhone Liquid Glass Slider — overflow-visible ensures refractive lens stays unclipped */}
        <div className={`${sliderWidthClass} overflow-visible py-1`}>
          <Slider
            aria-label={volumeLabel}
            min={0}
            max={100}
            step={1}
            value={muted ? 0 : Math.round(volume * 100)}
            onValueChange={onVolumeChange}
          />
        </div>
      </div>

      <div className="shrink-0">
        <GlassSegmented
          aria-label={speedLabel}
          size="xs"
          darkSurface
          whiteActivePill
          className="!bg-black/24 !border-white/[0.11] !backdrop-blur-none !shadow-none"
          value={String(playbackRate)}
          onValueChange={(v) => onSpeedChange(Number(v))}
          items={SPEED_ITEMS}
        />
      </div>
    </div>
  );
}

interface DesktopBottomDockProps {
  currentTrack: Track;
  title: string;
  artist: string;
  accent: string;
  safeDuration: number;
  copiedShare: boolean;
  onLike: () => void;
  onShare: () => void;
  isPlaying: boolean;
  isBuffering?: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  dir: "ltr" | "rtl";
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  transportLabels: {
    shuffle: string;
    prev: string;
    play: string;
    pause: string;
    next: string;
    repeat: string;
  };
  volume: number;
  muted: boolean;
  playbackRate: number;
  onToggleMute: () => void;
  onVolumeChange: (val: number) => void;
  onSpeedChange: (rate: number) => void;
  likeLabel: string;
  shareLabel: string;
  volumeLabel: string;
  speedLabel: string;
}

function DesktopBottomDock({
  currentTrack,
  title,
  artist,
  accent,
  safeDuration,
  copiedShare,
  onLike,
  onShare,
  isPlaying,
  isBuffering = false,
  shuffle,
  repeat,
  dir,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  transportLabels,
  volume,
  muted,
  playbackRate,
  onToggleMute,
  onVolumeChange,
  onSpeedChange,
  likeLabel,
  shareLabel,
  volumeLabel,
  speedLabel,
}: DesktopBottomDockProps) {
  return (
    <div className="sf-1c-capsule flex items-center justify-between gap-2 min-[1024px]:gap-4 xl:gap-6 mx-auto w-full max-w-[1280px] rounded-full px-3.5 min-[1024px]:px-6 xl:px-7 py-2.5 xl:py-3 min-h-[72px] xl:min-h-[76px] overflow-visible">
      {/* Start: Rounded-Square Mini Cover + Meta + Heart (+ Share on XL) */}
      <div className="flex items-center gap-2 min-w-0 w-[160px] min-[1024px]:w-[225px] xl:w-[296px] shrink-0">
        <img
          src={currentTrack.coverUrl}
          alt={title}
          width={46}
          height={46}
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.onerror = null;
            img.src = "/icons/icon-192.png";
          }}
          className="h-11 w-11 rounded-xl object-cover shadow-md shrink-0 ring-1 ring-white/15"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{title}</p>
          <p className="truncate text-xs text-white/65">{artist}</p>
        </div>
        <DownloadButton track={currentTrack} size="sm" variant="ghost" className="text-white hover:bg-white/12" />
        <button
          type="button"
          onClick={onLike}
          aria-label={likeLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer hover:bg-white/12 shrink-0 text-white transition-colors"
        >
          <HeartIcon
            size={17}
            weight={currentTrack.likedByMe ? "fill" : "regular"}
            className={currentTrack.likedByMe ? "text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" : "text-white/80"}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onShare}
          aria-label={shareLabel}
          title={shareLabel}
          className="hidden xl:inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer hover:bg-white/12 shrink-0 text-white transition-colors"
        >
          {copiedShare ? (
            <CheckIcon size={15} weight="bold" className="text-emerald-400" aria-hidden="true" />
          ) : (
            <ShareNetworkIcon size={15} className="text-white/75" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Transport */}
      <div className="shrink-0">
        <DockTransport
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          shuffle={shuffle}
          repeat={repeat}
          dir={dir}
          size="desktop"
          onTogglePlay={onTogglePlay}
          onPrev={onPrev}
          onNext={onNext}
          onToggleShuffle={onToggleShuffle}
          onCycleRepeat={onCycleRepeat}
          labels={transportLabels}
        />
      </div>

      {/* Center Dock Waveform */}
      <div className="flex-1 min-w-[100px] min-[1024px]:min-w-[155px] max-w-[340px]">
        <NowPlayingDockTimeline
          peaks={currentTrack.waveform}
          defaultDuration={safeDuration}
          accentColor={accent}
          layout="inline"
        />
      </div>

      {/* End: Speed & iPhone Liquid Glass Volume */}
      <DockVolumeAndSpeed
        volume={volume}
        muted={muted}
        playbackRate={playbackRate}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
        onSpeedChange={onSpeedChange}
        volumeLabel={volumeLabel}
        speedLabel={speedLabel}
        sliderWidthClass="w-14 min-[1024px]:w-20 xl:w-24"
      />
    </div>
  );
}

function MobileBottomDock({
  currentTrack,
  accent,
  safeDuration,
  isPlaying,
  isBuffering = false,
  shuffle,
  repeat,
  dir,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  transportLabels,
  volume,
  muted,
  playbackRate,
  onToggleMute,
  onVolumeChange,
  onSpeedChange,
  volumeLabel,
  speedLabel,
}: Pick<
  DesktopBottomDockProps,
  | "currentTrack"
  | "accent"
  | "safeDuration"
  | "isPlaying"
  | "isBuffering"
  | "shuffle"
  | "repeat"
  | "dir"
  | "onTogglePlay"
  | "onPrev"
  | "onNext"
  | "onToggleShuffle"
  | "onCycleRepeat"
  | "transportLabels"
  | "volume"
  | "muted"
  | "playbackRate"
  | "onToggleMute"
  | "onVolumeChange"
  | "onSpeedChange"
  | "volumeLabel"
  | "speedLabel"
>) {
  return (
    <div className="sf-1c-capsule flex flex-col gap-1.5 min-[375px]:gap-2.5 mx-auto w-full max-w-[368px] sm:max-w-md rounded-[26px] min-[375px]:rounded-[30px] px-3.5 min-[375px]:px-4 pt-2.5 min-[375px]:pt-3.5 pb-2.5 min-[375px]:pb-3.5 overflow-visible">
      <NowPlayingDockTimeline
        peaks={currentTrack.waveform}
        defaultDuration={safeDuration}
        accentColor={accent}
        layout="stacked"
      />

      <DockTransport
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        shuffle={shuffle}
        repeat={repeat}
        dir={dir}
        size="mobile"
        onTogglePlay={onTogglePlay}
        onPrev={onPrev}
        onNext={onNext}
        onToggleShuffle={onToggleShuffle}
        onCycleRepeat={onCycleRepeat}
        labels={transportLabels}
      />

      <div className="pt-0.5 overflow-visible">
        <DockVolumeAndSpeed
          volume={volume}
          muted={muted}
          playbackRate={playbackRate}
          onToggleMute={onToggleMute}
          onVolumeChange={onVolumeChange}
          onSpeedChange={onSpeedChange}
          volumeLabel={volumeLabel}
          speedLabel={speedLabel}
          sliderWidthClass="flex-1 min-w-[48px]"
          compact={true}
        />
      </div>
    </div>
  );
}

function NowPlayingQueueList({
  queue,
  currentTrackId,
  onPlay,
  maxHeightClass = "flex-1 min-h-0",
}: {
  queue: Track[];
  currentTrackId: string;
  onPlay: (t: Track) => void;
  maxHeightClass?: string;
}) {
  const { pickText } = useI18n();
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    if (hasScrolledRef.current) return;
    if (!activeItemRef.current) return;
    activeItemRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    hasScrolledRef.current = true;
  }, [queue.length, currentTrackId]);

  return (
    <ul className={`${maxHeightClass} min-h-[200px] overflow-y-auto space-y-2 pe-1.5 sf-queue-scroll`}>
      {queue.map((item) => {
        const active = item.id === currentTrackId;
        return (
          <li key={item.id} ref={active ? activeItemRef : undefined}>
            <button
              type="button"
              onClick={() => onPlay(item)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-start transition-all cursor-pointer ${
                active
                  ? "bg-white/18 border border-white/20 shadow-md ring-1 ring-white/15"
                  : "hover:bg-white/10 border border-transparent"
              }`}
            >
              <div className="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden shadow-sm">
                <img
                  src={item.coverUrl}
                  alt={pickText(item.title, item.titleFa)}
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                />
                {active && (
                  <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                    <span className="flex items-end gap-0.5 h-3.5 w-3" aria-hidden="true">
                      <span className="w-0.5 h-full bg-emerald-400 rounded-full animate-pulse" />
                      <span className="w-0.5 h-2/3 bg-emerald-400 rounded-full animate-pulse delay-75" />
                      <span className="w-0.5 h-4/5 bg-emerald-400 rounded-full animate-pulse delay-150" />
                    </span>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${active ? "text-emerald-300 font-bold" : "text-white"}`}>
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

export function NowPlayingOverlay() {
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

  const [prevExpandedState, setPrevExpandedState] = useState(expanded);
  const [prevQueueOpen, setPrevQueueOpen] = useState(queueOpen);
  const [prevTrackIdForLyrics, setPrevTrackIdForLyrics] = useState<string | undefined>(currentTrack?.id);
  const [desktopTab, setDesktopTab] = useState<"lyrics" | "queue">(queueOpen ? "queue" : "lyrics");
  const [mobileTab, setMobileTab] = useState<"hero" | "lyrics" | "queue">(queueOpen ? "queue" : "hero");
  const showLyrics = mobileTab === "lyrics";
  const [isLyricsFullscreen, setIsLyricsFullscreen] = useState(false);
  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false);
  const [lyricsToolsOpen, setLyricsToolsOpen] = useState(false);
  const [lyricsSourcesOpen, setLyricsSourcesOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [artworkDeltaX, setArtworkDeltaX] = useState(0);
  const [isSwipingArtwork, setIsSwipingArtwork] = useState(false);
  const [sampledPalette, setSampledPalette] = useState<{ url: string; palette: CoverPalette } | null>(null);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTimeRef = useRef(0);
  const shareTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDialogElement>(null);

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
    }
  }

  if (currentTrack?.id !== prevTrackIdForLyrics) {
    setPrevTrackIdForLyrics(currentTrack?.id);
    setLyricsSearchOpen(false);
    setLyricsToolsOpen(false);
    setLyricsSourcesOpen(false);
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
    setIsDragging(false);
    setIsClosing(true);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      isClosingRef.current = false;
      setIsLyricsFullscreen(false);
      setExpanded(false);
      setIsClosing(false);
      setDragY(0);
    }, 290);
  }, [setExpanded]);

  useEffect(() => {
    if (!expanded || typeof window === "undefined") return;
    const onDismissRequest = (e: Event) => {
      e.preventDefault();
      dismissWithPhysics();
    };
    window.addEventListener("soundify-dismiss-now-playing", onDismissRequest);
    return () => window.removeEventListener("soundify-dismiss-now-playing", onDismissRequest);
  }, [expanded, dismissWithPhysics]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isDesktop || e.touches.length !== 1) return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('[role="slider"], input, select, textarea, button, a, [data-prevent-sheet-drag]')) return;
    const scrollableAncestor = targetEl?.closest(".overflow-y-auto");
    if (scrollableAncestor && scrollableAncestor.scrollTop > 2) return;
    if (containerRef.current && containerRef.current.scrollTop > 5) return;
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
    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStartY.current;
    const deltaX = touch.clientX - touchStartX.current;

    // Predominantly horizontal swipe: do not drag down sheet
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

  const handleTouchCancel = () => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragY(0);
  };

  // Horizontal swipe gesture on mobile artwork to skip Next / Prev track
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
            setArtworkDeltaX(calculateElasticDrag(deltaX, 52));
          }
        },
        onSwipeNext: () => {
          next(false);
        },
        onSwipePrev: () => {
          prev();
        },
        onDragEnd: () => {
          setIsSwipingArtwork(false);
          setArtworkDeltaX(0);
        },
      }),
    [dir, next, prev],
  );

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

  if (!expanded || !currentTrack) return null;

  const title = pickText(currentTrack.title, currentTrack.titleFa);
  const artist = pickText(currentTrack.artistName, currentTrack.artistNameFa);
  const safeDuration = Math.max(1, duration || currentTrack.durationSec || 1);
  const accent = currentTrack.accentColor || "#6366f1";
  const coverPalette =
    sampledPalette && sampledPalette.url === currentTrack.coverUrl
      ? sampledPalette.palette
      : buildPaletteFromHex(accent);

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
      // ignore transient network errors
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
      // ignore clipboard errors
    }
  };

  const handleVolumeSliderChange = (v: number) => {
    if (muted) toggleMute();
    setVolume(v / 100);
  };

  const transportLabels = {
    shuffle: t("shuffle"),
    prev: t("prevTrack"),
    play: t("play"),
    pause: t("pause"),
    next: t("nextTrack"),
    repeat: t("repeat"),
  };

  const compactQueueLabel = `${lang === "fa" ? (mobileTab === "lyrics" ? "صف" : "صف پخش") : "Queue"} (${queue.length})`;
  const compactHeroLabel = lang === "fa" ? (
    mobileTab === "lyrics" ? (
      "پخش"
    ) : (
      <>
        <span className="max-[359px]:hidden">در حال </span>پخش
      </>
    )
  ) : (
    "Now Playing"
  );
  const compactLyricsLabel = lang === "fa" ? (
    <>
      متن<span className="max-[429px]:hidden"> آهنگ</span>
    </>
  ) : (
    t("showLyrics")
  );

  return (
    <dialog
      ref={containerRef}
      aria-modal="true"
      data-theme="dark"
      data-resolved-theme="dark"
      aria-label={`${t("nowPlaying")}: ${title}`}
      onCancel={(e) => {
        e.preventDefault();
        dismissWithPhysics();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onAnimationEnd={(e) => {
        if (e.target === containerRef.current && e.animationName === "sf-overlay-in") {
          setHasEntered(true);
        }
      }}
      className={`dark sf-dark-overlay sf-now-playing-dialog fixed inset-0 z-50 bg-[#050708]/98 text-white overflow-hidden flex flex-col ${
        isClosing
          ? "sf-overlay-out pointer-events-none"
          : !hasEntered && !isDragging && dragY === 0
          ? "sf-overlay-in"
          : ""
      }`}
      style={{
        "--sf-glass-tint": coverPalette.glassTint,
        "--sf-drag-y": `${dragY}px`,
        transform: isClosing
          ? undefined
          : dragY > 0
          ? `translate3d(0, ${dragY}px, 0)`
          : undefined,
        transition:
          isDragging || isClosing
            ? "none"
            : "transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      {/* Dynamic Ambient Artwork Mesh (desktop blurred layer; lightweight radial mesh on mobile GPU) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0 select-none" aria-hidden="true">
        <img
          src={currentTrack.coverUrl}
          alt=""
          className="hidden md:block h-full w-full object-cover scale-110 blur-2xl opacity-30 brightness-[0.8] saturate-[1.5] transition-opacity duration-500"
          style={{ transform: "translate3d(0, 0, 0)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/45 to-black/72" />
        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{
            backgroundImage: `radial-gradient(ellipse 85% 75% at 18% 36%, ${coverPalette.ambientLeft}, transparent 68%), radial-gradient(ellipse 80% 75% at 84% 48%, ${coverPalette.ambientRight}, transparent 68%)`,
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden">
        {isLyricsFullscreen ? (
          <>
            <header
              className={
                isDesktop
                  ? "shrink-0 z-20 px-6 xl:px-10 pt-[max(1.25rem,env(safe-area-inset-top))] pb-2"
                  : "shrink-0 z-20 px-4 sm:px-6 pt-[max(2.5rem,calc(env(safe-area-inset-top)+0.85rem))] pb-1.5"
              }
            >
              {isDesktop ? (
                <div className="flex items-center justify-between gap-4 max-w-[1440px] mx-auto">
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={dismissWithPhysics}
                      aria-label={t("collapse")}
                      className="sf-1c-pill inline-flex items-center gap-2 rounded-full px-4 h-10 text-xs font-semibold hover:bg-white/[0.16] text-white transition-all cursor-pointer active:scale-95"
                    >
                      <CaretDownIcon size={16} weight="bold" aria-hidden="true" />
                      <span>{t("collapse")}</span>
                    </button>

                    <Link
                      href={getTrackDetailHref(currentTrack.id)}
                      onClick={() => setExpanded(false)}
                      className="sf-1c-pill inline-flex items-center gap-2 rounded-full px-4 h-10 text-xs font-semibold hover:bg-white/[0.16] text-white transition-all"
                    >
                      <ChatCircleTextIcon size={16} aria-hidden="true" />
                      <span>{t("openTrackPage")}</span>
                    </Link>
                  </div>

                  <div className="sf-1c-pill inline-flex items-center gap-2.5 rounded-full ps-1.5 pe-4 py-1 h-10 min-w-0 max-w-sm lg:max-w-md">
                    <img
                      src={currentTrack.coverUrl}
                      alt={title}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full object-cover shadow-sm shrink-0 ring-1 ring-white/20"
                    />
                    <div className="min-w-0 flex items-baseline gap-1.5">
                      <span className="truncate text-xs font-extrabold text-white">{title}</span>
                      <span className="text-[11px] text-white/40 shrink-0" aria-hidden="true">•</span>
                      <span className="truncate text-xs text-white/70">{artist}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {lyrics.length > 0 && lyricsSource !== "none" && (
                      <button
                        type="button"
                        onClick={() => {
                          void triggerHapticFeedback("selection");
                          setLyricsSourcesOpen(true);
                        }}
                        title={`${t("lyricsSyncedFrom")} ${lyricsSource} (${t("switchSource")})`}
                        aria-label={`${t("lyricsSyncedFrom")} ${lyricsSource}`}
                        className="sf-1c-pill inline-flex items-center gap-1.5 rounded-full h-10 px-3.5 text-xs font-semibold text-white/95 hover:bg-white/[0.16] transition-all cursor-pointer active:scale-95"
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]" />
                        </span>
                        <span className="truncate max-w-[140px] sm:max-w-[200px] font-bold text-emerald-300">{lyricsSource}</span>
                        <CaretDownIcon size={12} weight="bold" className="opacity-60 shrink-0" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setLyricsSearchOpen((prev) => !prev)}
                      aria-label={t("navSearch")}
                      title={t("navSearch")}
                      aria-expanded={lyricsSearchOpen}
                      className={`sf-1c-pill inline-flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                        lyricsSearchOpen ? "bg-white/25 text-white border-white/35" : "text-white hover:bg-white/[0.16]"
                      }`}
                    >
                      <MagnifyingGlassIcon size={16} weight={lyricsSearchOpen ? "bold" : "regular"} aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setLyricsToolsOpen((prev) => !prev)}
                      aria-label={t("lyricsSyncOffset")}
                      title={t("lyricsSyncOffset")}
                      aria-expanded={lyricsToolsOpen}
                      className={`sf-1c-pill relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                        lyricsToolsOpen ? "bg-white/25 text-white border-white/35" : "text-white hover:bg-white/[0.16]"
                      }`}
                    >
                      <FadersIcon size={16} weight={lyricsToolsOpen ? "bold" : "regular"} aria-hidden="true" />
                      {lyricsOffsetMs !== 0 && (
                        <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsLyricsFullscreen(false)}
                      aria-label={t("exitFullScreenLyrics")}
                      title={t("exitFullScreenLyrics")}
                      className="sf-1c-pill inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-3 xl:px-3.5 text-xs font-semibold hover:bg-white/[0.16] text-white transition-all cursor-pointer active:scale-95"
                    >
                      <ArrowsInSimpleIcon size={16} weight="bold" aria-hidden="true" />
                      <span className="hidden xl:inline whitespace-nowrap">{t("exitFullScreenLyrics")}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setIsLyricsFullscreen(false)}
                    aria-label={t("exitFullScreenLyrics")}
                    title={t("exitFullScreenLyrics")}
                    className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                  >
                    <ArrowsInSimpleIcon size={18} weight="bold" aria-hidden="true" />
                  </button>

                  <div className="sf-1c-pill inline-flex items-center gap-2 rounded-full ps-1.5 pe-3.5 py-1 h-10 min-w-0 max-w-[230px] sm:max-w-xs">
                    <img
                      src={currentTrack.coverUrl}
                      alt={title}
                      width={26}
                      height={26}
                      className="h-6.5 w-6.5 rounded-full object-cover shrink-0 ring-1 ring-white/20"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-white">{title}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={dismissWithPhysics}
                    aria-label={t("collapse")}
                    className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                  >
                    <CaretDownIcon size={18} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              )}
            </header>

            <main className="relative flex-1 min-h-0 max-w-6xl mx-auto w-full px-3 sm:px-8 z-10 flex flex-col justify-center">
              <LyricsPanel
                fullScreen
                darkSurface
                borderless
                hideToolbar={isDesktop}
                externalSearchOpen={lyricsSearchOpen}
                onExternalSearchOpenChange={setLyricsSearchOpen}
                externalToolsOpen={lyricsToolsOpen}
                onExternalToolsOpenChange={setLyricsToolsOpen}
                externalSourcesOpen={lyricsSourcesOpen}
                onExternalSourcesOpenChange={setLyricsSourcesOpen}
                showControls={false}
                onToggleFullScreen={() => setIsLyricsFullscreen(false)}
                className="h-full"
              />
            </main>
          </>
        ) : (
          <>
          {/* Top Chrome: Desktop OR Mobile (mutually exclusive) */}
          <header
            className={
              isDesktop
                ? "shrink-0 z-20 px-6 xl:px-10 pt-[max(1.25rem,env(safe-area-inset-top))] pb-2"
                : "shrink-0 z-20 px-4 sm:px-6 pt-[max(2.5rem,calc(env(safe-area-inset-top)+0.85rem))] pb-1.5"
            }
          >
            {isDesktop ? (
              <div className="flex items-center justify-between gap-4 max-w-[1440px] mx-auto">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={dismissWithPhysics}
                    aria-label={t("collapse")}
                    className="sf-1c-pill inline-flex items-center gap-2 rounded-full px-4 h-10 text-xs font-semibold hover:bg-white/[0.16] text-white transition-all cursor-pointer active:scale-95"
                  >
                    <CaretDownIcon size={16} weight="bold" aria-hidden="true" />
                    <span>{t("collapse")}</span>
                  </button>

                  <Link
                    href={getTrackDetailHref(currentTrack.id)}
                    onClick={() => setExpanded(false)}
                    className="sf-1c-pill inline-flex items-center gap-2 rounded-full px-4 h-10 text-xs font-semibold hover:bg-white/[0.16] text-white transition-all"
                  >
                    <ChatCircleTextIcon size={16} aria-hidden="true" />
                    <span>{t("openTrackPage")}</span>
                  </Link>
                </div>

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

                <div className="flex items-center gap-2">
                  {desktopTab === "lyrics" && lyrics.length > 0 && lyricsSource !== "none" && (
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        setLyricsSourcesOpen(true);
                      }}
                      title={`${t("lyricsSyncedFrom")} ${lyricsSource} (${t("switchSource")})`}
                      aria-label={`${t("lyricsSyncedFrom")} ${lyricsSource}`}
                      className="sf-1c-pill inline-flex items-center gap-1.5 rounded-full h-10 px-3.5 text-xs font-semibold text-white/95 hover:bg-white/[0.16] transition-all cursor-pointer active:scale-95"
                    >
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]" />
                      </span>
                      <span className="truncate max-w-[140px] sm:max-w-[200px] font-bold text-emerald-300">{lyricsSource}</span>
                      <CaretDownIcon size={12} weight="bold" className="opacity-60 shrink-0" aria-hidden="true" />
                    </button>
                  )}

                  {desktopTab === "lyrics" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setLyricsSearchOpen((prev) => !prev)}
                        aria-label={t("navSearch")}
                        title={t("navSearch")}
                        aria-expanded={lyricsSearchOpen}
                        className={`sf-1c-pill inline-flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                          lyricsSearchOpen ? "bg-white/25 text-white border-white/35" : "text-white hover:bg-white/[0.16]"
                        }`}
                      >
                        <MagnifyingGlassIcon size={16} weight={lyricsSearchOpen ? "bold" : "regular"} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setLyricsToolsOpen((prev) => !prev)}
                        aria-label={t("lyricsSyncOffset")}
                        title={t("lyricsSyncOffset")}
                        aria-expanded={lyricsToolsOpen}
                        className={`sf-1c-pill relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                          lyricsToolsOpen ? "bg-white/25 text-white border-white/35" : "text-white hover:bg-white/[0.16]"
                        }`}
                      >
                        <FadersIcon size={16} weight={lyricsToolsOpen ? "bold" : "regular"} aria-hidden="true" />
                        {lyricsOffsetMs !== 0 && (
                          <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                        )}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsLyricsFullscreen(true)}
                    aria-label={t("fullScreenLyrics")}
                    title={t("fullScreenLyrics")}
                    className="sf-1c-pill inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-all cursor-pointer active:scale-95"
                  >
                    <ArrowsOutSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("selection");
                      setDevicePickerOpen(true);
                    }}
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
                    className={`sf-1c-pill relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                      isRemotePlaybackActive
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/35"
                        : "text-white hover:bg-white/[0.16]"
                    }`}
                  >
                    <BroadcastIcon size={16} weight={isRemotePlaybackActive ? "fill" : "regular"} aria-hidden="true" />
                    {isRemotePlaybackActive && (
                      <span className="absolute top-1.5 end-1.5 inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 min-w-0">
                <button
                  type="button"
                  onClick={dismissWithPhysics}
                  aria-label={t("collapse")}
                  className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                >
                  <CaretDownIcon size={18} weight="bold" aria-hidden="true" />
                </button>

                <div className="min-w-0 flex justify-center flex-1">
                  <GlassSegmented
                    aria-label="Mobile Now Playing Tabs"
                    size="sm"
                    darkSurface
                    whiteActivePill
                    value={mobileTab}
                    onValueChange={(v) => {
                      const nextTab = v as "hero" | "lyrics" | "queue";
                      setMobileTab(nextTab);
                      setQueueOpen(nextTab === "queue");
                    }}
                    items={
                      mobileTab === "lyrics"
                        ? [
                            { value: "hero", label: compactHeroLabel },
                            { value: "lyrics", label: compactLyricsLabel },
                            { value: "queue", label: compactQueueLabel },
                          ]
                        : [
                            { value: "hero", label: compactHeroLabel },
                            { value: "queue", label: compactQueueLabel },
                          ]
                    }
                  />
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("selection");
                      setDevicePickerOpen(true);
                    }}
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
                    className={`sf-1c-pill relative inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 ${
                      isRemotePlaybackActive
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/35"
                        : "text-white hover:bg-white/[0.16]"
                    }`}
                  >
                    <BroadcastIcon size={18} weight={isRemotePlaybackActive ? "fill" : "regular"} aria-hidden="true" />
                    {isRemotePlaybackActive && (
                      <span className="absolute top-2 end-2 inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]" aria-hidden="true" />
                    )}
                  </button>

                  <Link
                    href={getTrackDetailHref(currentTrack.id)}
                    onClick={() => {
                      setIsLyricsFullscreen(false);
                      setExpanded(false);
                    }}
                    aria-label={t("openTrackPage")}
                    title={t("openTrackPage")}
                    className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors active:scale-95"
                  >
                    <ChatCircleTextIcon size={18} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
          </header>

          {/* Main Stage: Desktop 2-Column 1C Stage OR Mobile Single-Focus Stage (mutually exclusive) */}
          {isDesktop && isRemotePlaybackActive && (
            <aside
              aria-label={`${t("playingOn")} ${localizedActiveDeviceName}`}
              className="shrink-0 z-20 px-6 xl:px-12 pt-1 pb-2"
            >
              <div className="mx-auto flex items-center justify-between gap-4 max-w-xl px-4 py-2 rounded-full bg-black/75 dark:bg-black/75 backdrop-blur-2xl border border-white/[0.16] shadow-[0_12px_36px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.18)] ring-1 ring-white/5 transition-all">
                <button
                  type="button"
                  onClick={() => {
                    void triggerHapticFeedback("selection");
                    toggleDevicePicker();
                  }}
                  aria-label={`${t("playingOn")} ${localizedActiveDeviceName}`}
                  title={t("connectedDevicesTooltip")}
                  className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer group py-0.5 outline-none min-h-[38px]"
                >
                  <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] border border-white/[0.12] text-emerald-400 group-hover:scale-105 group-hover:bg-white/[0.14] transition-all">
                    <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-60" />
                    <BroadcastIcon size={14} weight="fill" className="relative z-10" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex flex-col justify-center">
                    <span className="text-[10px] font-semibold tracking-wider text-white/50 leading-none">
                      {t("playingOn")}
                    </span>
                    <span className="truncate text-xs font-bold text-white group-hover:text-emerald-300 transition-colors leading-tight mt-0.5">
                      {localizedActiveDeviceName}
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("selection");
                      void transferToThisDevice();
                    }}
                    aria-label={t("playOnThisDevice")}
                    className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-full bg-white/14 hover:bg-white/22 active:bg-white/28 active:scale-95 text-white border border-white/20 backdrop-blur-md shadow-sm transition-all cursor-pointer inline-flex items-center gap-1.5 relative before:absolute before:-inset-1 before:content-['']"
                  >
                    <BroadcastIcon size={13} weight="fill" className="text-emerald-400" aria-hidden="true" />
                    <span>{t("playOnThisDevice")}</span>
                  </button>
                </div>
              </div>
            </aside>
          )}

          {isDesktop ? (
            <main className="grid grid-cols-12 gap-8 xl:gap-12 items-center flex-1 min-h-0 w-full max-w-[1440px] mx-auto px-6 xl:px-12 pb-3">
              {/* Hero Cover Column (Start Side — Right in RTL, Left in LTR) */}
              <section className="col-span-5 flex flex-col items-center justify-center text-center min-h-0 px-2">
                <div className="relative w-[min(100%,330px,39dvh)] lg:w-[min(100%,355px,39dvh)] xl:w-[min(100%,388px,41dvh)] aspect-square shrink-0">
                  <div
                    className="pointer-events-none absolute -inset-8 rounded-full blur-3xl opacity-55 transition-colors duration-700"
                    style={{ background: coverPalette.haloRgba }}
                    aria-hidden="true"
                  />
                  <div
                    key={currentTrack.id}
                    className={`relative h-full w-full rounded-[28px] overflow-hidden shadow-[0_32px_76px_rgba(0,0,0,0.78)] ring-1 ring-white/15 bg-white/[0.05] ${
                      isCrossfading && crossfadeFromTrack ? "sf-automix-artwork-in" : "sf-track-swap"
                    }`}
                  >
                    <OptimizedTrackImage
                      src={currentTrack.coverUrl}
                      trackId={currentTrack.id}
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
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 xl:mt-5 flex items-center justify-center gap-2">
                  {isCrossfading ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-bold text-emerald-200 bg-emerald-500/20 border border-emerald-400/40 shadow-sm shrink-0 whitespace-nowrap">
                      <span aria-hidden="true" className="flex items-end gap-0.5 h-2.5 shrink-0">
                        <span className="sf-eq-bar w-0.5 h-2 bg-emerald-400 rounded-full" />
                        <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-300 rounded-full" style={{ animationDelay: "0.18s" }} />
                        <span className="sf-eq-bar w-0.5 h-1.5 bg-emerald-400 rounded-full" style={{ animationDelay: "0.34s" }} />
                      </span>
                      <span>{pickText("AutoMix", "میکس روان")}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-semibold tracking-wider text-amber-100/90 bg-white/[0.08] border border-white/15">
                      {currentTrack.genre}
                    </span>
                  )}
                </div>

                <div className="mt-2 xl:mt-2.5 flex items-center gap-2 max-w-md flex-wrap">
                  <h2 className="text-xl lg:text-2xl xl:text-[31px] leading-tight font-black tracking-tight text-white line-clamp-2">
                    {title}
                  </h2>
                </div>
                <p className="mt-1 text-sm xl:text-base font-medium text-white/75 truncate max-w-sm">
                  {artist}
                </p>

                <SpectrumVisualizer align="bottom" className="!h-8 xl:!h-10 max-w-[320px] mt-3 xl:mt-5" />
              </section>

              {/* Lyrics / Queue Stage Column */}
              <section className="col-span-7 h-full min-h-0 flex flex-col justify-center">
                {desktopTab === "lyrics" ? (
                  <div className="h-full max-h-[68dvh] min-h-0 flex flex-col">
                    <LyricsPanel
                      darkSurface
                      borderless
                      hideToolbar
                      externalSearchOpen={lyricsSearchOpen}
                      onExternalSearchOpenChange={setLyricsSearchOpen}
                      externalToolsOpen={lyricsToolsOpen}
                      onExternalToolsOpenChange={setLyricsToolsOpen}
                      externalSourcesOpen={lyricsSourcesOpen}
                      onExternalSourcesOpenChange={setLyricsSourcesOpen}
                      showFullScreenButton={false}
                      onToggleFullScreen={() => setIsLyricsFullscreen(true)}
                      className="h-full"
                    />
                  </div>
                ) : (
                  <div className="h-full max-h-[64dvh] rounded-[28px] bg-white/[0.06] border border-white/[0.1] backdrop-blur-2xl p-5 shadow-[0_16px_44px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 shrink-0">
                      <div className="flex items-center gap-2.5">
                        <QueueIcon size={18} weight="bold" aria-hidden="true" />
                        <h3 className="text-sm font-bold tracking-wide">{t("queue")}</h3>
                      </div>
                      <span className="text-xs text-white/50 font-mono tabular-nums">{queue.length}</span>
                    </div>
                    <NowPlayingQueueList
                      queue={queue}
                      currentTrackId={currentTrack.id}
                      onPlay={playTrack}
                    />
                  </div>
                )}
              </section>
            </main>
          ) : (
            <>
              {isRemotePlaybackActive && !showLyrics && (
                <aside
                  aria-label={`${t("playingOn")} ${localizedActiveDeviceName}`}
                  className="shrink-0 z-20 px-3.5 pt-1 pb-1.5"
                >
                  <div className="mx-auto flex items-center justify-between gap-3 max-w-[420px] px-3.5 py-1.5 rounded-full bg-black/75 dark:bg-black/75 backdrop-blur-2xl border border-white/[0.16] shadow-[0_12px_36px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.18)] ring-1 ring-white/5 transition-all">
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        toggleDevicePicker();
                      }}
                      aria-label={`${t("playingOn")} ${localizedActiveDeviceName}`}
                      title={t("connectedDevicesTooltip")}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-start cursor-pointer group py-0.5 outline-none min-h-[36px]"
                    >
                      {/* Apple Live Activity Pulse Indicator & Badge */}
                      <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] border border-white/[0.12] text-emerald-400 group-hover:scale-105 group-hover:bg-white/[0.14] transition-all">
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-60" />
                        <BroadcastIcon size={14} weight="fill" className="relative z-10" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex flex-col justify-center">
                        <span className="text-[10px] font-semibold tracking-wider text-white/50 leading-none">
                          {t("playingOn")}
                        </span>
                        <span className="truncate text-[12px] font-bold text-white group-hover:text-emerald-300 transition-colors leading-tight mt-0.5">
                          {localizedActiveDeviceName}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        void transferToThisDevice();
                      }}
                      aria-label={t("playOnThisDevice")}
                      className="shrink-0 min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-full bg-white/14 hover:bg-white/22 active:bg-white/28 active:scale-95 text-white border border-white/20 backdrop-blur-md shadow-sm transition-all cursor-pointer inline-flex items-center gap-1.5 relative before:absolute before:-inset-1 before:content-['']"
                    >
                      <BroadcastIcon size={13} weight="fill" className="text-emerald-400" aria-hidden="true" />
                      <span>{t("playOnThisDevice")}</span>
                    </button>
                  </div>
                </aside>
              )}
              <main className="flex-1 min-h-0 flex flex-col px-3.5 pb-2 overflow-hidden">
            {mobileTab === "hero" && (
              <div key="tab-hero" className="sf-view-fade flex-1 min-h-0 flex flex-col items-center justify-evenly gap-1 min-[375px]:gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 min-[375px]:py-1">
                <div
                  {...artworkTouchHandlers}
                  style={{
                    transform:
                      artworkDeltaX !== 0
                        ? `translate3d(${artworkDeltaX}px, 0, 0) rotate(${artworkDeltaX * 0.025}deg)`
                        : undefined,
                    transition: isSwipingArtwork
                      ? "none"
                      : "transform 0.32s cubic-bezier(0.18, 0.89, 0.32, 1)",
                  }}
                  data-prevent-sheet-drag="true"
                  className="sf-mobile-hero-cover relative aspect-square w-[min(46vw,172px,24dvh)] min-[375px]:w-[min(68vw,272px,31dvh)] shrink-0 touch-pan-y cursor-grab active:cursor-grabbing select-none"
                >
                  <div
                    className="pointer-events-none absolute -inset-8 rounded-full opacity-60 transition-opacity duration-500"
                    style={{ background: `radial-gradient(circle, ${coverPalette.haloRgba} 0%, transparent 72%)` }}
                    aria-hidden="true"
                  />
                  <div
                    key={currentTrack.id}
                    className={`${
                      isCrossfading && crossfadeFromTrack ? "sf-automix-artwork-in" : "sf-track-swap"
                    } relative h-full w-full rounded-[22px] min-[375px]:rounded-[26px] overflow-hidden shadow-[0_28px_64px_rgba(0,0,0,0.78)] ring-1 ring-white/15 bg-white/[0.05] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isPlaying ? "scale-100" : "scale-[0.92]"
                    }`}
                  >
                    <OptimizedTrackImage
                      src={currentTrack.coverUrl}
                      trackId={currentTrack.id}
                      alt={title}
                      priority
                      className="h-full w-full object-cover pointer-events-none"
                    />
                    {isCrossfading && crossfadeFromTrack && crossfadeFromTrack.id !== currentTrack.id && (
                      <div
                        aria-hidden="true"
                        className="sf-automix-dissolve-out pointer-events-none absolute inset-0 z-10 overflow-hidden"
                      >
                        <OptimizedTrackImage
                          src={crossfadeFromTrack.coverUrl}
                          trackId={crossfadeFromTrack.id}
                          alt=""
                          className="h-full w-full object-cover pointer-events-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div key={`info-${currentTrack.id}`} className="sf-view-fade w-full max-w-[356px] sm:max-w-md flex items-center justify-between gap-2.5 px-1 shrink-0">
                  <div className="min-w-0 flex-1 overflow-hidden text-start">
                    <div className="flex items-center gap-1.5 mb-1">
                      {isCrossfading ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-emerald-200 bg-emerald-500/20 border border-emerald-400/40 shrink-0 whitespace-nowrap">
                          <span aria-hidden="true" className="flex items-end gap-0.5 h-2.5 shrink-0">
                            <span className="sf-eq-bar w-0.5 h-2 bg-emerald-400 rounded-full" />
                            <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-300 rounded-full" style={{ animationDelay: "0.18s" }} />
                            <span className="sf-eq-bar w-0.5 h-1.5 bg-emerald-400 rounded-full" style={{ animationDelay: "0.34s" }} />
                          </span>
                          <span>{pickText("AutoMix", "میکس روان")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider text-amber-100/90 bg-white/[0.08] border border-white/15 max-w-full truncate">
                          {currentTrack.genre}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="truncate whitespace-nowrap text-[17px] min-[375px]:text-[20px] font-black tracking-tight text-white leading-snug">
                        {title}
                      </h2>
                    </div>
                    <p className="truncate whitespace-nowrap text-xs min-[375px]:text-[13px] font-medium text-white/75 mt-0.5">
                      {artist}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <DownloadButton
                      track={currentTrack}
                      size="lg"
                      variant="glass"
                      className="sf-1c-pill text-white hover:bg-white/[0.16] border border-white/10 active:scale-95"
                    />

                    <button
                      type="button"
                      onClick={() => openPlaylistPicker(currentTrack)}
                      aria-label={t("addToPlaylist")}
                      title={t("addToPlaylist")}
                      className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                    >
                      <ListPlusIcon size={19} weight="bold" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleShare()}
                      aria-label={copiedShare ? t("copiedLink") : t("share")}
                      title={copiedShare ? t("copiedLink") : t("share")}
                      className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                    >
                      {copiedShare ? (
                        <CheckIcon size={18} weight="bold" className="text-emerald-400" aria-hidden="true" />
                      ) : (
                        <ShareNetworkIcon size={18} aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleLike()}
                      aria-label={currentTrack.likedByMe ? t("liked") : t("like")}
                      className="sf-1c-pill inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer active:scale-95"
                    >
                      <HeartIcon
                        size={19}
                        weight={currentTrack.likedByMe ? "fill" : "regular"}
                        className={currentTrack.likedByMe ? "text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.65)]" : "text-white/85"}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                <SpectrumVisualizer align="center" className="!h-6 min-[375px]:!h-9 max-w-[348px] sm:max-w-md shrink-0" />

                <LiveLyricsPeek onOpenLyrics={() => setMobileTab("lyrics")} />
              </div>
            )}

            {mobileTab === "lyrics" && (
              <div key="tab-lyrics" className="sf-view-fade flex-1 min-h-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 px-1 py-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileTab("hero")}
                    aria-label={t("nowPlaying")}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-start cursor-pointer"
                  >
                    <img
                      src={currentTrack.coverUrl}
                      alt={title}
                      width={52}
                      height={52}
                      className="h-13 w-13 rounded-2xl object-cover shadow-lg border border-white/25 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-white">{title}</p>
                      <p className="truncate text-[11px] text-white/65">
                        {artist}
                        {currentTrack.genre ? ` • ${currentTrack.genre}` : ""}
                      </p>
                      <SpectrumVisualizer className="!h-4 max-w-[140px] mt-1" />
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <DownloadButton
                      track={currentTrack}
                      size="lg"
                      variant="glass"
                      className="sf-1c-pill text-white hover:bg-white/[0.16] border border-white/10 active:scale-95"
                    />

                    <button
                      type="button"
                      onClick={() => openPlaylistPicker(currentTrack)}
                      aria-label={t("addToPlaylist")}
                      title={t("addToPlaylist")}
                      className="sf-1c-pill inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer"
                    >
                      <ListPlusIcon size={17} weight="bold" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleShare()}
                      aria-label={copiedShare ? t("copiedLink") : t("share")}
                      className="sf-1c-pill inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer"
                    >
                      {copiedShare ? (
                        <CheckIcon size={16} weight="bold" className="text-emerald-400" aria-hidden="true" />
                      ) : (
                        <ShareNetworkIcon size={16} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLike()}
                      aria-label={currentTrack.likedByMe ? t("liked") : t("like")}
                      className="sf-1c-pill inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full hover:bg-white/[0.16] text-white transition-colors cursor-pointer"
                    >
                      <HeartIcon
                        size={17}
                        weight={currentTrack.likedByMe ? "fill" : "regular"}
                        className={currentTrack.likedByMe ? "text-rose-400" : "text-white/85"}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                  <LyricsPanel
                    darkSurface
                    borderless
                    showFullScreenButton={true}
                    onToggleFullScreen={() => setIsLyricsFullscreen(true)}
                    className="h-full"
                  />
                </div>
              </div>
            )}

            {mobileTab === "queue" && (
              <div key="tab-queue" className="sf-view-fade flex-1 min-h-0 flex flex-col rounded-3xl bg-white/[0.06] border border-white/[0.1] backdrop-blur-2xl p-3.5 shadow-[0_12px_36px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden">
                <NowPlayingQueueList
                  queue={queue}
                  currentTrackId={currentTrack.id}
                  onPlay={playTrack}
                />
              </div>
            )}
          </main>
          </>
          )}

          </>
        )}

        {/* Bottom Floating Liquid Glass Dock Capsule (Desktop OR Mobile, shared seamlessly across normal & fullscreen modes) */}
        <footer
          className={
            isDesktop
              ? "shrink-0 z-20 px-6 xl:px-10 pb-5 pt-1 overflow-visible"
              : "shrink-0 z-20 px-3 sm:px-6 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-1 overflow-visible"
          }
        >
          {isDesktop ? (
            <DesktopBottomDock
              currentTrack={currentTrack}
              title={title}
              artist={artist}
              accent={accent}
              safeDuration={safeDuration}
              copiedShare={copiedShare}
              onLike={() => void handleLike()}
              onShare={() => void handleShare()}
              isPlaying={isPlaying}
              isBuffering={isBuffering}
              shuffle={shuffle}
              repeat={repeat}
              dir={dir}
              onTogglePlay={handleTogglePlay}
              onPrev={handlePrev}
              onNext={handleNext}
              onToggleShuffle={handleToggleShuffle}
              onCycleRepeat={handleCycleRepeat}
              transportLabels={transportLabels}
              volume={volume}
              muted={muted}
              playbackRate={playbackRate}
              onToggleMute={toggleMute}
              onVolumeChange={handleVolumeSliderChange}
              onSpeedChange={setPlaybackRate}
              likeLabel={currentTrack.likedByMe ? t("liked") : t("like")}
              shareLabel={copiedShare ? t("copiedLink") : t("share")}
              volumeLabel={t("volume")}
              speedLabel={t("speed")}
            />
          ) : (
            <MobileBottomDock
              currentTrack={currentTrack}
              accent={accent}
              safeDuration={safeDuration}
              isPlaying={isPlaying}
              isBuffering={isBuffering}
              shuffle={shuffle}
              repeat={repeat}
              dir={dir}
              onTogglePlay={handleTogglePlay}
              onPrev={handlePrev}
              onNext={handleNext}
              onToggleShuffle={handleToggleShuffle}
              onCycleRepeat={handleCycleRepeat}
              transportLabels={transportLabels}
              volume={volume}
              muted={muted}
              playbackRate={playbackRate}
              onToggleMute={toggleMute}
              onVolumeChange={handleVolumeSliderChange}
              onSpeedChange={setPlaybackRate}
              volumeLabel={t("volume")}
              speedLabel={t("speed")}
            />
          )}
        </footer>
      </div>
    </dialog>
  );
}

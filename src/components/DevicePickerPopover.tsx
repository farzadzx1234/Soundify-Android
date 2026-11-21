"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  BroadcastIcon,
  BrowserIcon,
  CheckCircleIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DeviceTabletIcon,
  LaptopIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { getDeviceTypeLabel, localizeDeviceName } from "@/lib/deviceFormatter";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import type { Track } from "@/lib/types";

function ActiveOutputCover({
  track,
  title,
  isPlaying,
}: {
  track: Track | null;
  title: string;
  isPlaying: boolean;
}) {
  const [failedCoverKey, setFailedCoverKey] = useState<string | null>(null);
  const currentCoverKey = track ? `${track.id}-${track.coverUrl || "no-cover"}` : null;
  const isFailed = currentCoverKey !== null && failedCoverKey === currentCoverKey;

  if (!track || !track.coverUrl || isFailed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/25 via-white/[0.08] to-purple-500/15 text-indigo-300 border border-white/15 backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] ring-1 ring-white/10"
      >
        <BroadcastIcon size={22} weight="fill" className="text-white/85" />
      </span>
    );
  }

  return (
    <div className="relative h-12 w-12 rounded-xl overflow-hidden ring-1 ring-white/20 shrink-0 shadow-md bg-white/[0.05]">
      <OptimizedTrackImage
        src={track.coverUrl}
        trackId={track.id}
        alt={title}
        className="h-full w-full object-cover"
        onError={() => {
          if (currentCoverKey) setFailedCoverKey(currentCoverKey);
        }}
      />
      {isPlaying && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-black/45 flex items-center justify-center"
        >
          <span className="flex items-end gap-0.5 h-3.5">
            <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="w-0.5 h-3.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
            <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
          </span>
        </span>
      )}
    </div>
  );
}

export function DevicePickerPopover() {
  const {
    devices,
    deviceId,
    activeDeviceId,
    isRemotePlaybackActive,
    localizedActiveDeviceName,
    isRefreshing,
    devicePickerOpen,
    setDevicePickerOpen,
    transferToThisDevice,
    transferToDevice,
    refreshDevices,
    sendRemoteCommand,
    syncState,
    isSyncEnabled,
    toggleSyncEnabled,
  } = useDeviceSync();

  const { currentTrack, isPlaying: isLocalPlaying, getCurrentTime } = usePlayer();
  const { t, pickText, dir, lang } = useI18n();

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);

  const [prevOpen, setPrevOpen] = useState(devicePickerOpen);
  const [prevVolume, setPrevVolume] = useState<number | undefined>(syncState?.volume);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const touchStartY = useRef(0);

  if (devicePickerOpen !== prevOpen) {
    setPrevOpen(devicePickerOpen);
    if (devicePickerOpen) {
      setIsClosing(false);
      setHasEntered(false);
      setDragY(0);
      setLocalVolume(null);
    }
  }

  if (syncState?.volume !== prevVolume) {
    setPrevVolume(syncState?.volume);
    setLocalVolume(null);
  }

  const dismissSheet = useCallback(() => {
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
      setIsClosing(false);
      setDragY(0);
      setDevicePickerOpen(false);
    }, 235);
  }, [setDevicePickerOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (devicePickerOpen) {
      void refreshDevices();
    }
  }, [devicePickerOpen, refreshDevices]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input[type="range"], [data-prevent-sheet-drag]')) return;
    const scrollBox = target?.closest(".sf-device-list-scroll");
    if (scrollBox && scrollBox.scrollTop > 2) return;
    touchStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY > 0) {
      setDragY(deltaY * 0.72);
    } else {
      setDragY(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragY > 68) {
      dismissSheet();
    } else {
      setDragY(0);
    }
  };

  // Sync open/close state with HTML5 dialog.showModal()
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (devicePickerOpen) {
      isClosingRef.current = false;
      if (!dlg.open) {
        try {
          dlg.showModal();
        } catch {
          dlg.setAttribute("open", "");
        }
      }
    } else if (!devicePickerOpen && dlg.open) {
      try {
        dlg.close();
      } catch {
        dlg.removeAttribute("open");
      }
    }
  }, [devicePickerOpen]);

  // Handle native cancel (Escape key) and backdrop tap outside sheet
  useEffect(() => {
    if (!devicePickerOpen) return;
    const dlg = dialogRef.current;
    if (!dlg) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      dismissSheet();
    };

    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dlg) {
        dismissSheet();
      }
    };

    dlg.addEventListener("cancel", handleCancel);
    dlg.addEventListener("click", handleBackdropClick);
    return () => {
      dlg.removeEventListener("cancel", handleCancel);
      dlg.removeEventListener("click", handleBackdropClick);
    };
  }, [devicePickerOpen, dismissSheet]);

  if (!devicePickerOpen) return null;

  const effectiveActiveDeviceId = activeDeviceId || deviceId;

  // Never display a stale PC song inside the banner when THIS device is active locally
  const displayedTrack = isRemotePlaybackActive
    ? (syncState?.track ?? currentTrack)
    : (currentTrack ?? syncState?.track ?? null);

  const displayedIsPlaying = isRemotePlaybackActive
    ? Boolean(syncState?.isPlaying)
    : isLocalPlaying;

  const getDeviceIcon = (type: string, isTargetActive: boolean) => {
    const iconSize = 20;
    const colorClass = isTargetActive ? "text-emerald-400" : "text-white/75";

    if (type === "smartphone") return <DeviceMobileIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
    if (type === "tablet") return <DeviceTabletIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
    if (type === "desktop") return <DesktopIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
    if (type === "browser") return <BrowserIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
    if (type === "speaker") return <SpeakerHighIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
    return <LaptopIcon size={iconSize} weight={isTargetActive ? "fill" : "regular"} className={colorClass} aria-hidden="true" />;
  };

  const handleSelectDevice = async (targetId: string) => {
    if (!isSyncEnabled || targetId === effectiveActiveDeviceId || transferringId) return;
    void triggerHapticFeedback("selection");
    setTransferringId(targetId);
    try {
      if (targetId === deviceId) {
        await transferToThisDevice(
          syncState?.trackId || currentTrack?.id
            ? {
                trackId: syncState?.trackId || currentTrack?.id,
                currentTime: isRemotePlaybackActive ? syncState?.currentTime : getCurrentTime(),
                isPlaying: isRemotePlaybackActive ? syncState?.isPlaying ?? true : isLocalPlaying,
              }
            : undefined,
        );
      } else {
        await transferToDevice(targetId, {
          trackId: currentTrack?.id || syncState?.trackId || undefined,
          currentTime: !isRemotePlaybackActive ? getCurrentTime() : syncState?.currentTime,
          isPlaying: !isRemotePlaybackActive ? isLocalPlaying : syncState?.isPlaying ?? true,
        });
      }
    } finally {
      setTransferringId(null);
    }
  };

  const handleClaimThisDevice = async () => {
    if (transferringId) return;
    void triggerHapticFeedback("selection");
    setTransferringId(deviceId);
    try {
      await transferToThisDevice(
        syncState?.trackId || currentTrack?.id
          ? {
              trackId: syncState?.trackId || currentTrack?.id,
              currentTime: isRemotePlaybackActive ? syncState?.currentTime : getCurrentTime(),
              isPlaying: true,
            }
          : undefined,
      );
    } finally {
      setTransferringId(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-picker-title"
      onClose={() => {
        if (!isClosingRef.current) setDevicePickerOpen(false);
      }}
      className="dark sf-device-picker-dialog fixed inset-0 z-[120] m-auto bg-transparent p-0 sm:p-4 border-0 flex items-end sm:items-center justify-center outline-none max-w-none max-h-none w-full h-full backdrop:bg-black/60 backdrop:backdrop-blur-md"
    >
      <div
        onAnimationEnd={(e) => {
          if (e.currentTarget === e.target && e.animationName === "sf-sheet-up") {
            setHasEntered(true);
          }
        }}
        style={{
          "--sf-drag-y": `${dragY}px`,
          transform: isClosing
            ? undefined
            : dragY > 0
            ? `translate3d(0, ${dragY}px, 0)`
            : undefined,
          transition:
            isDragging || isClosing
              ? "none"
              : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
        } as React.CSSProperties}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full max-w-md rounded-t-[30px] sm:rounded-[28px] bg-black/85 dark:bg-[#12141c]/92 border-t sm:border border-white/[0.14] shadow-[0_24px_64px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-3xl backdrop-saturate-[1.8] overflow-hidden px-4 pt-3 pb-[max(1.35rem,calc(env(safe-area-inset-bottom)+0.6rem))] sm:p-5 space-y-4 text-white select-none touch-pan-y ${
          isClosing
            ? "sf-sheet-down pointer-events-none"
            : !hasEntered && !isDragging && dragY === 0
            ? "sf-sheet-up"
            : ""
        }`}
      >
        {/* Apple HIG Sheet Grabber */}
        <div className="flex justify-center pb-0.5 sm:hidden">
          <button
            type="button"
            onClick={dismissSheet}
            aria-label={t("close")}
            className="h-5 w-14 flex items-center justify-center cursor-pointer"
          >
            <span className="h-[5px] w-9 rounded-full bg-white/25 transition-colors hover:bg-white/40" aria-hidden="true" />
          </button>
        </div>

        {/* Apple HIG Sheet Navigation Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
          <button
            type="button"
            onClick={() => {
              void triggerHapticFeedback("selection");
              void refreshDevices();
            }}
            disabled={isRefreshing}
            aria-label={t("refreshDevices")}
            title={t("refreshDevices")}
            className="sf-1c-pill h-10 w-10 min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.14] active:scale-95 transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            <ArrowClockwiseIcon size={17} className={isRefreshing ? "animate-spin text-emerald-400" : ""} aria-hidden="true" />
          </button>

          <div className="min-w-0 text-center flex-1 px-1">
            <h2 id="device-picker-title" className="text-[15px] font-bold text-white tracking-tight truncate">
              {t("devicesTitle")}
            </h2>
          </div>

          <button
            type="button"
            onClick={dismissSheet}
            aria-label={t("close")}
            className="sf-1c-pill inline-flex h-10 min-h-[40px] min-w-[44px] items-center justify-center rounded-full px-3.5 text-xs font-bold text-white hover:bg-white/[0.16] active:scale-95 transition-all cursor-pointer shrink-0"
          >
            {lang === "fa" ? "بستن" : "Done"}
          </button>
        </div>

        {/* Active Output Card (Clean HIG Content Material, max 1 prominent action) */}
        <div className="rounded-2xl bg-white/[0.06] border border-white/[0.09] p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ActiveOutputCover
                track={displayedTrack}
                title={displayedTrack ? pickText(displayedTrack.title, displayedTrack.titleFa) : ""}
                isPlaying={displayedIsPlaying}
              />

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                      displayedIsPlaying ? "bg-emerald-400" : "bg-white/40"
                    }`}
                    aria-hidden="true"
                  />
                  <p className="text-[11px] font-semibold text-white/65 truncate">
                    {!isRemotePlaybackActive ? t("listeningOnThisDevice") : t("listeningOnRemoteDevice")}
                  </p>
                </div>
                <p className="text-sm font-bold truncate text-white mt-0.5">
                  {localizedActiveDeviceName}
                </p>
                {displayedTrack && (
                  <p className="text-[11px] text-white/60 truncate mt-0.5">
                    {pickText(displayedTrack.title, displayedTrack.titleFa)} • {pickText(displayedTrack.artistName, displayedTrack.artistNameFa)}
                  </p>
                )}
              </div>
            </div>

            {isRemotePlaybackActive && (
              <button
                type="button"
                disabled={Boolean(transferringId)}
                onClick={() => void handleClaimThisDevice()}
                className="shrink-0 min-h-[36px] text-xs px-3.5 py-1.5 font-bold bg-white hover:bg-white/90 text-slate-950 rounded-full shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {transferringId === deviceId && (
                  <ArrowClockwiseIcon size={13} className="animate-spin" aria-hidden="true" />
                )}
                <span>{t("playOnThisDevice")}</span>
              </button>
            )}
          </div>

          {/* Remote AirPlay Transport Controls (Shown ONLY while another device is actively outputting) */}
          {isRemotePlaybackActive && syncState?.track && (
            <div className="pt-2.5 border-t border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("trackSkip");
                      void sendRemoteCommand("PREV");
                    }}
                    aria-label={t("prevTrack")}
                    className="h-9 w-9 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.12] transition-colors active:scale-95 cursor-pointer"
                  >
                    {dir === "rtl" ? <SkipForwardIcon size={16} weight="fill" /> : <SkipBackIcon size={16} weight="fill" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("playPause");
                      void sendRemoteCommand("TOGGLE_PLAY");
                    }}
                    aria-label={syncState.isPlaying ? t("pause") : t("play")}
                    className="h-9 w-9 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full bg-white text-slate-950 hover:bg-white/90 active:scale-95 transition-all shadow-sm cursor-pointer"
                  >
                    {syncState.isPlaying ? <PauseIcon size={16} weight="fill" /> : <PlayIcon size={16} weight="fill" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void triggerHapticFeedback("trackSkip");
                      void sendRemoteCommand("NEXT");
                    }}
                    aria-label={t("nextTrack")}
                    className="h-9 w-9 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.12] transition-colors active:scale-95 cursor-pointer"
                  >
                    {dir === "rtl" ? <SkipBackIcon size={16} weight="fill" /> : <SkipForwardIcon size={16} weight="fill" />}
                  </button>
                </div>

                {/* Apple Slider Volume Control */}
                <div dir="ltr" className="flex items-center gap-2 flex-1 max-w-[175px]" data-prevent-sheet-drag="true">
                  <SpeakerHighIcon size={14} className="text-white/55 shrink-0" aria-hidden="true" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={localVolume !== null ? localVolume : (typeof syncState.volume === "number" ? syncState.volume : 0.8)}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setLocalVolume(vol);
                      void sendRemoteCommand("SET_VOLUME", { volume: vol });
                    }}
                    style={
                      {
                        "--slider-progress": `${Math.round(((localVolume !== null ? localVolume : (typeof syncState.volume === "number" ? syncState.volume : 0.8)) || 0) * 100)}%`,
                      } as React.CSSProperties
                    }
                    aria-label={t("remoteVolume")}
                    title={t("remoteVolume")}
                    className="sf-apple-slider w-full cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Apple HIG Real-Time Sync Toggle Switch */}
        <div className="rounded-2xl bg-white/[0.06] border border-white/[0.09] p-3.5 flex items-center justify-between gap-3 shadow-sm">
          <div className="min-w-0 flex-1 pe-2">
            <p className="text-[13px] font-bold text-white">
              {lang === "fa" ? "همگام‌سازی بلادرنگ دستگاه‌ها" : "Real-Time Device Sync"}
            </p>
            <p className="text-[11px] text-white/55 mt-0.5 leading-snug">
              {lang === "fa"
                ? "امکان پخش همزمان و مستقل در چندین دستگاه با خاموش کردن"
                : "Listen independently & simultaneously on multiple devices when disabled"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isSyncEnabled}
            onClick={() => {
              void triggerHapticFeedback("selection");
              toggleSyncEnabled();
            }}
            aria-label={lang === "fa" ? "همگام‌سازی بلادرنگ دستگاه‌ها" : "Real-Time Device Sync"}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out outline-none before:absolute before:-inset-2 before:content-[''] ${
              isSyncEnabled ? "bg-emerald-500" : "bg-white/20"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] ring-0 transition-transform duration-200 ease-in-out ${
                isSyncEnabled ? (dir === "rtl" ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Apple HIG Grouped Inset Device List */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold text-white/55">
              {isSyncEnabled
                ? t("selectDeviceToPlay")
                : (lang === "fa" ? "همگام‌سازی خاموش است (انتخاب دستگاه غیرفعال)" : "Sync is disabled (device selection locked)")}
            </p>
            {devices.length > 0 && isSyncEnabled && (
              <span className="text-[11px] text-white/45 font-mono tabular-nums">
                {devices.length}
              </span>
            )}
          </div>

          <div
            className={`sf-device-list-scroll rounded-[20px] bg-white/[0.05] border border-white/[0.08] divide-y divide-white/[0.07] max-h-60 overflow-y-auto [scrollbar-width:thin] transition-all duration-300 ${
              !isSyncEnabled ? "opacity-35 pointer-events-none select-none grayscale" : ""
            }`}
          >
            {devices.map((dev) => {
              const isCurrent = dev.id === deviceId;
              const isTargetActive = dev.id === effectiveActiveDeviceId;
              const isSwitching = transferringId === dev.id;
              const localizedName = localizeDeviceName(dev.name, lang);
              const typeLabel = getDeviceTypeLabel(dev.type, t);

              return (
                <button
                  key={dev.id}
                  type="button"
                  disabled={!isSyncEnabled || Boolean(transferringId)}
                  aria-disabled={!isSyncEnabled}
                  onClick={() => void handleSelectDevice(dev.id)}
                  className="w-full min-h-[60px] flex items-center justify-between gap-3 px-3.5 py-2.5 text-start hover:bg-white/[0.06] active:bg-white/[0.1] active:scale-[0.98] transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isTargetActive
                          ? "bg-emerald-500/15 border-emerald-400/35"
                          : "bg-white/[0.06] border-white/[0.08]"
                      }`}
                    >
                      {getDeviceIcon(dev.type, isTargetActive)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className={`text-[13.5px] font-semibold truncate ${isTargetActive ? "text-white" : "text-white/90"}`}>
                          {localizedName}
                        </p>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-white/[0.1] px-2 py-0.5 text-[10px] font-semibold text-white/75">
                            {t("currentDeviceBadge")}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/50 truncate mt-0.5">
                        {typeLabel} • {isTargetActive ? t("deviceActive") : t("deviceOnlineReady")}
                      </p>
                    </div>
                  </div>

                  {isSwitching ? (
                    <ArrowClockwiseIcon size={18} className="animate-spin text-white/75 shrink-0" aria-hidden="true" />
                  ) : isTargetActive ? (
                    <CheckCircleIcon size={22} weight="fill" className="text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="inline-flex h-[20px] w-[20px] rounded-full border border-white/25 shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}

            {devices.length === 0 && (
              <div className="text-center py-7 px-4 space-y-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-white/70 mb-0.5">
                  <BroadcastIcon size={20} />
                </span>
                <p className="text-xs font-semibold text-white">{t("scanningDevices")}</p>
                <p className="text-[11px] text-white/50 max-w-xs mx-auto leading-relaxed">
                  {t("noOtherDevicesFound")}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Concise HIG Footnote */}
        <p className="text-center text-[11px] text-white/45 pt-0.5">
          {t("deviceSyncFooter")}
        </p>
      </div>
    </dialog>
  );
}

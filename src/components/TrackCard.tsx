"use client";

import React, { memo, useState } from "react";
import Link from "next/link";
import { Menu } from "@/components/GlassControls";
import {
  ArrowsClockwiseIcon,
  ChatCircleTextIcon,
  CircleNotchIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  PlusCircleIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import { DownloadButton } from "@/components/DownloadButton";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { api, getTrackDetailHref, getTrackShareUrl } from "@/lib/api";
import { formatDuration } from "@/lib/lrc";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import type { Playlist, Track } from "@/lib/types";

interface TrackCardProps {
  track: Track;
  queue?: Track[];
  playlists?: Playlist[];
  onTrackUpdated?: (track: Track) => void;
  priorityImage?: boolean;
  autoExpand?: boolean;
}

export const TrackCard = memo(function TrackCard({
  track,
  queue,
  playlists = [],
  onTrackUpdated,
  priorityImage = false,
  autoExpand = false,
}: TrackCardProps) {
  const { user, openAuthDialog } = useAuth();
  const { pickText, formatNum, t } = useI18n();
  const { currentTrack, isPlaying, isBuffering, playTrack, updateTrackInQueue, setExpanded } = usePlayer();
  const [prevTrack, setPrevTrack] = useState(track);
  const [localTrack, setLocalTrack] = useState(track);
  const [toast, setToast] = useState("");

  if (track !== prevTrack) {
    setPrevTrack(track);
    setLocalTrack(track);
  }

  const activeTrack = localTrack;
  const isCurrent = currentTrack?.id === activeTrack.id;
  const isCurrentPlaying = isCurrent && isPlaying;

  const title = pickText(activeTrack.title, activeTrack.titleFa);
  const artist = pickText(activeTrack.artistName, activeTrack.artistNameFa);

  const handleLike = async () => {
    if (!user) {
      openAuthDialog();
      return;
    }
    try {
      const willLike = !activeTrack.likedByMe;
      void triggerHapticFeedback("likeToggle", { liked: willLike });
      const res = await api.toggleLike(activeTrack.id, activeTrack);
      const updated = { ...activeTrack, likedByMe: res.liked, likesCount: res.likesCount };
      setLocalTrack(updated);
      updateTrackInQueue(updated);
      onTrackUpdated?.(updated);
    } catch {
      // ignore
    }
  };

  const handleRepost = async () => {
    if (!user) {
      openAuthDialog();
      return;
    }
    try {
      void triggerHapticFeedback("tap");
      const res = await api.toggleRepost(activeTrack.id);
      const updated = { ...activeTrack, repostedByMe: res.reposted, repostsCount: res.repostsCount };
      setLocalTrack(updated);
      updateTrackInQueue(updated);
      onTrackUpdated?.(updated);
    } catch {
      // ignore
    }
  };

  const handleShare = async () => {
    const shareUrl = getTrackShareUrl(activeTrack.id);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast(t("copiedLink"));
      setTimeout(() => setToast(""), 2000);
    } catch {
      // ignore
    }
  };

  const editablePlaylists = user
    ? playlists.filter((pl) => pl.ownerId === user.id || user.role === "admin").slice(0, 5)
    : [];

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const menuItems = [
    ...editablePlaylists.map((pl) => ({
      label: `${t("addToPlaylist")}: ${pickText(pl.title, pl.titleFa)}`,
      icon: <PlusCircleIcon size={16} aria-hidden="true" />,
      onSelect: () => {
        void api
          .addTrackToPlaylist(pl.id, activeTrack.id)
          .then(() => showToast(t("addedToPlaylist")))
          .catch(() => showToast(t("actionFailed")));
      },
    })),
    ...(editablePlaylists.length > 0 ? (["separator"] as const) : []),
    {
      label: t("share"),
      icon: <ShareNetworkIcon size={16} aria-hidden="true" />,
      onSelect: () => void handleShare(),
    },
  ];

  return (
    <article
      className={`group relative rounded-2xl p-3 flex flex-col gap-2.5 bg-white/85 hover:bg-white dark:bg-white/[0.035] dark:hover:bg-white/[0.065] border border-black/[0.06] hover:border-black/[0.1] dark:border-white/[0.05] dark:hover:border-white/[0.09] shadow-[0_4px_20px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.25)] transition-all duration-200 contain-paint ${
        isCurrentPlaying ? "ring-1 ring-indigo-400/40 dark:ring-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.4)]" : ""
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl">
        {isCurrentPlaying && (
          <div
            aria-hidden="true"
            className="sf-cover-pulse pointer-events-none absolute -inset-2 z-0 opacity-40"
            style={{
              background: `radial-gradient(circle at 80% 80%, ${activeTrack.accentColor}55 0%, transparent 70%)`,
            }}
          />
        )}
        <OptimizedTrackImage
          src={activeTrack.coverUrl}
          alt={title}
          accentColor={activeTrack.accentColor}
          priority={priorityImage}
          pageUrl={activeTrack.pageUrl}
          trackId={activeTrack.id}
          className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
        />
        {/* Subtle Dark Gradient Overlay for Contrast */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-black/75 via-black/20 to-black/30 opacity-70 group-hover:opacity-90 transition-opacity duration-300"
        />

        {/* Duration badge */}
        <span
          className="absolute top-2.5 start-2.5 z-20 pointer-events-none select-none rounded-full px-2 py-0.5 text-[11px] font-medium text-white/95 bg-black/72 shadow-sm border border-white/12"
          dir="ltr"
        >
          {formatDuration(activeTrack.durationSec)}
        </span>

        {/* Clickable cover area to toggle playback */}
        <button
          type="button"
          aria-label={`${isCurrentPlaying ? t("pause") : t("play")} ${title}`}
          onClick={() => {
            void triggerHapticFeedback("playPause");
            if (isCurrentPlaying && autoExpand) {
              setExpanded(true);
            } else {
              playTrack(activeTrack, queue);
              if (autoExpand) setExpanded(true);
            }
          }}
          className="absolute inset-0 z-10 w-full h-full cursor-pointer focus:outline-none"
        />

        {/* Play Button & Integrated Live Equalizer Docked to Bottom-End of Artwork */}
        <div className="absolute bottom-2.5 end-2.5 z-20 flex items-center pointer-events-auto">
          {isCurrent && isBuffering ? (
            <button
              type="button"
              aria-label={pickText("Buffering...", "در حال بارگذاری...")}
              className="sf-press flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full text-white bg-black/82 shadow-[0_6px_18px_rgba(0,0,0,0.4)] border border-white/[0.14] cursor-wait"
            >
              <CircleNotchIcon size={20} className="animate-spin text-white" aria-hidden="true" />
            </button>
          ) : isCurrentPlaying ? (
            <button
              type="button"
              aria-label={`${t("pause")} ${title}`}
              onClick={(e) => {
                e.stopPropagation();
                void triggerHapticFeedback("playPause");
                if (autoExpand) {
                  setExpanded(true);
                } else {
                  playTrack(activeTrack, queue);
                }
              }}
              className="sf-press flex h-10 items-center gap-2 px-3 rounded-full text-white bg-black/82 hover:bg-black/90 shadow-[0_6px_18px_rgba(0,0,0,0.4)] border border-white/[0.14] cursor-pointer group/btn"
            >
              <span aria-hidden="true" className="flex items-end gap-0.5 h-3.5 shrink-0">
                <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-400 rounded-full" />
                <span className="sf-eq-bar w-0.5 h-3.5 bg-emerald-400 rounded-full" style={{ animationDelay: "0.2s" }} />
                <span className="sf-eq-bar w-0.5 h-2 bg-emerald-400 rounded-full" style={{ animationDelay: "0.4s" }} />
              </span>
              <PauseIcon size={16} weight="fill" className="text-white" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`${t("play")} ${title}`}
              onClick={(e) => {
                e.stopPropagation();
                void triggerHapticFeedback("playPause");
                playTrack(activeTrack, queue);
                if (autoExpand) setExpanded(true);
              }}
              className="sf-press flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full text-white shadow-[0_6px_18px_rgba(0,0,0,0.35)] cursor-pointer opacity-95 group-hover:opacity-100"
              style={{
                backgroundColor: activeTrack.accentColor || "#6366f1",
              }}
            >
              <PlayIcon size={20} weight="fill" className="translate-x-[1px]" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-0.5 px-0.5">
        <Link
          href={getTrackDetailHref(activeTrack.id)}
          className="block truncate font-bold text-base text-[var(--sf-text)] hover:underline focus-visible:underline"
        >
          {title}
        </Link>
        <p className="truncate text-xs text-[var(--sf-muted)]">{artist}</p>
      </div>

      <div className="flex items-center justify-between gap-1 pt-0.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleLike}
            aria-label={activeTrack.likedByMe ? t("liked") : t("like")}
            aria-pressed={activeTrack.likedByMe}
            className={`sf-btn inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs cursor-pointer min-h-[40px] sm:min-h-[36px] ${
              activeTrack.likedByMe
                ? "sf-spring-pop text-rose-600 dark:text-rose-400 bg-rose-500/12 font-semibold"
                : "text-[var(--sf-muted)] hover:text-[var(--sf-text)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            <HeartIcon size={15} weight={activeTrack.likedByMe ? "fill" : "regular"} aria-hidden="true" />
            <span>{formatNum(activeTrack.likesCount)}</span>
          </button>

          <button
            type="button"
            onClick={handleRepost}
            aria-label={activeTrack.repostedByMe ? t("reposted") : t("repost")}
            aria-pressed={activeTrack.repostedByMe}
            className={`sf-btn inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs cursor-pointer min-h-[40px] sm:min-h-[36px] ${
              activeTrack.repostedByMe
                ? "sf-spring-pop text-emerald-700 dark:text-emerald-400 bg-emerald-500/12 font-semibold"
                : "text-[var(--sf-muted)] hover:text-[var(--sf-text)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            <ArrowsClockwiseIcon size={15} weight={activeTrack.repostedByMe ? "bold" : "regular"} aria-hidden="true" />
            <span>{formatNum(activeTrack.repostsCount)}</span>
          </button>

          <Link
            href={getTrackDetailHref(activeTrack.id)}
            aria-label={`${t("openTrackPage")}: ${title}`}
            className="sf-btn inline-flex items-center justify-center rounded-full p-2 text-[var(--sf-muted)] hover:text-[var(--sf-text)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px]"
          >
            <ChatCircleTextIcon size={15} aria-hidden="true" />
          </Link>
        </div>

        <div className="flex items-center gap-0.5">
          <DownloadButton track={activeTrack} size="sm" />
          <Menu aria-label={`${title} options`} align="end" items={menuItems} />
        </div>
      </div>

      {toast && (
        <span
          role="status"
          className="absolute bottom-14 end-3 rounded-full bg-emerald-500 text-slate-950 px-3 py-1 text-xs font-semibold shadow-lg"
        >
          {toast}
        </span>
      )}
    </article>
  );
});

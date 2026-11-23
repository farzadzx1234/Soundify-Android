"use client";

import React, { memo, useState } from "react";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  SoundcloudLogoIcon,
  SpotifyLogoIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { DownloadButton } from "@/components/DownloadButton";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { formatDuration } from "@/lib/lrc";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import type { Track } from "@/lib/types";

interface ExternalTrackCardProps {
  track: Track;
  queue?: Track[];
  onImportSuccess?: (imported: Track) => void;
  autoExpand?: boolean;
}

export const ExternalTrackCard = memo(function ExternalTrackCard({
  track,
  queue = [],
  onImportSuccess,
  autoExpand = false,
}: ExternalTrackCardProps) {
  const { user, openAuthDialog } = useAuth();
  const { pickText, t } = useI18n();
  const { currentTrack, isPlaying, isBuffering, playTrack, togglePlay, setExpanded } = usePlayer();

  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [isLiked, setIsLiked] = useState(track.likedByMe ?? false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;

  const handleLikeToggle = async () => {
    if (!user) {
      openAuthDialog();
      return;
    }
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      const res = await api.toggleLike(track.id, track);
      setIsLiked(res.liked);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLikeBusy(false);
    }
  };

  const source = (track.source || "youtube").toLowerCase();
  const isYouTube = source === "youtube";
  const isSoundCloud = source === "soundcloud";

  const brandInfo = isYouTube
    ? {
        name: "YouTube",
        nameFa: "یوتیوب",
        icon: <YoutubeLogoIcon size={15} weight="fill" className="text-red-500 shrink-0" aria-hidden="true" />,
        badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
        accent: "#EF4444",
      }
    : isSoundCloud
      ? {
          name: "SoundCloud",
          nameFa: "ساندکلود",
          icon: <SoundcloudLogoIcon size={15} weight="fill" className="text-orange-500 shrink-0" aria-hidden="true" />,
          badgeClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
          accent: "#F97316",
        }
      : {
          name: "Spotify",
          nameFa: "اسپاتیفای",
          icon: <SpotifyLogoIcon size={15} weight="fill" className="text-emerald-500 shrink-0" aria-hidden="true" />,
          badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          accent: "#1DB954",
        };

  const handlePlayButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent && isPlaying) {
      togglePlay();
      return;
    }
    const effectiveQueue =
      queue.length > 0
        ? queue.some((t) => t.id === track.id)
          ? queue
          : [track, ...queue]
        : [track];
    playTrack(track, effectiveQueue);
  };

  const handleCardClick = () => {
    const effectiveQueue =
      queue.length > 0
        ? queue.some((t) => t.id === track.id)
          ? queue
          : [track, ...queue]
        : [track];
    if (!isCurrentPlaying) {
      playTrack(track, effectiveQueue);
    }
    if (autoExpand) {
      setExpanded(true);
    }
  };

  const handleAdminImport = async () => {
    if (importing || imported || !user || user.role !== "admin") return;
    setImporting(true);
    setErrorMsg(null);
    try {
      const safeSource: "youtube" | "soundcloud" | "spotify" =
        track.source === "soundcloud" || track.source === "spotify" ? track.source : "youtube";
      const res = await api.adminYtDlpImport({
        url: track.pageUrl || track.audioUrl,
        source: safeSource,
        title: track.title,
        titleFa: track.titleFa,
        artistName: track.artistName,
        artistNameFa: track.artistNameFa,
        album: track.album,
        albumFa: track.albumFa,
        genre: track.genre,
        mood: track.mood,
        accentColor: brandInfo.accent,
        autoFetchLyrics: true,
      });
      setImported(true);
      onImportSuccess?.(res.track);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setImporting(false);
    }
  };

  const title = pickText(track.title, track.titleFa);
  const artist = pickText(track.artistName, track.artistNameFa);

  return (
    <article
      className={`sf-press group relative flex items-center gap-3 rounded-2xl p-2.5 sm:p-3 transition-[transform,background-color,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isCurrent
          ? "bg-indigo-500/[0.08] dark:bg-white/[0.08] border border-indigo-500/35 dark:border-white/20 shadow-sm"
          : "bg-white/70 dark:bg-white/[0.04] hover:bg-white/90 dark:hover:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.07]"
      }`}
    >
      {/* Thumbnail Artwork + Card Player Trigger (56x56 Apple Music Row Style) */}
      <button
        type="button"
        onClick={handleCardClick}
        aria-label={isCurrentPlaying ? t("pause") : t("play")}
        className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-xl bg-black/15 dark:bg-white/5 shadow-sm cursor-pointer group/art focus-visible:outline-2 focus-visible:outline-[var(--sf-accent)]"
      >
        <OptimizedTrackImage
          src={track.coverUrl}
          alt={title}
          accentColor={brandInfo.accent}
          pageUrl={track.pageUrl}
          trackId={track.id}
          className="h-full w-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/art:scale-105"
        />

        {/* Active Playing Overlay or Subtle Hover Indicator */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            isCurrentPlaying || (isCurrent && isBuffering)
              ? "bg-black/55 opacity-100"
              : "bg-black/35 opacity-0 group-hover/art:opacity-100"
          }`}
        >
          {isCurrent && isBuffering ? (
            <CircleNotchIcon size={22} className="animate-spin text-white drop-shadow" aria-hidden="true" />
          ) : isCurrentPlaying ? (
            <span className="flex items-end gap-0.5 h-3.5">
              <span className="sf-eq-bar w-0.5 h-2.5 bg-emerald-400 rounded-full" />
              <span className="sf-eq-bar w-0.5 h-3.5 bg-emerald-400 rounded-full" style={{ animationDelay: "0.2s" }} />
              <span className="sf-eq-bar w-0.5 h-2 bg-emerald-400 rounded-full" style={{ animationDelay: "0.4s" }} />
            </span>
          ) : (
            <PlayIcon size={20} weight="fill" className="text-white drop-shadow" />
          )}
        </span>
      </button>

      {/* Center Metadata (Scannable Hierarchy - Tapping opens player) */}
      <button
        type="button"
        onClick={handleCardClick}
        className="min-w-0 flex-1 text-start cursor-pointer py-0.5 space-y-1 focus:outline-none"
      >
        <h3
          title={title}
          className={`truncate text-sm sm:text-[15px] font-bold leading-snug ${
            isCurrent ? "text-indigo-600 dark:text-indigo-400" : "text-slate-900 dark:text-white"
          }`}
        >
          {title}
        </h3>

        <p title={artist} className="truncate text-xs text-slate-500 dark:text-slate-400 font-medium">
          {artist}
        </p>

        <div className="flex items-center gap-2 pt-0.5 min-w-0">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border shrink-0 ${brandInfo.badgeClass}`}
          >
            {brandInfo.icon}
            <span>{pickText(brandInfo.name, brandInfo.nameFa)}</span>
          </span>
          {track.durationSec > 0 && (
            <span dir="ltr" className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {formatDuration(track.durationSec)}
            </span>
          )}
          {errorMsg && <span className="text-[10px] text-rose-500 truncate">{errorMsg}</span>}
        </div>
      </button>

      {/* Trailing Action Controls (44pt Accessible Touch Targets) */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => void handleLikeToggle()}
          disabled={likeBusy}
          title={isLiked ? t("liked") : t("like")}
          aria-label={isLiked ? t("liked") : t("like")}
          className={`sf-press inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full transition-colors cursor-pointer text-center leading-none ${
            isLiked
              ? "text-rose-500 bg-rose-500/12"
              : "text-slate-400 dark:text-slate-400 hover:text-rose-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          }`}
        >
          <HeartIcon size={18} weight={isLiked ? "fill" : "regular"} aria-hidden="true" />
        </button>

        <DownloadButton track={track} size="sm" variant="glass" />

        {user?.role === "admin" && (
          <button
            type="button"
            disabled={importing || imported}
            onClick={() => void handleAdminImport()}
            title={imported ? t("adminImported") : t("adminImportBtn")}
            aria-label={imported ? t("adminImported") : t("adminImportBtn")}
            className={`sf-press inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full transition-colors cursor-pointer text-center leading-none ${
              imported
                ? "text-emerald-500 bg-emerald-500/15"
                : "text-slate-400 hover:text-indigo-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            }`}
          >
            {importing ? (
              <CircleNotchIcon size={17} className="animate-spin" aria-hidden="true" />
            ) : imported ? (
              <CheckCircleIcon size={17} weight="fill" aria-hidden="true" />
            ) : (
              <CloudArrowDownIcon size={17} weight="bold" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={handlePlayButtonClick}
          aria-label={isCurrentPlaying ? t("pause") : t("play")}
          className="sf-press flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-white shadow-sm cursor-pointer transition-transform"
          style={{ backgroundColor: brandInfo.accent }}
        >
          {isCurrentPlaying ? (
            <PauseIcon size={17} weight="fill" aria-hidden="true" />
          ) : (
            <PlayIcon size={17} weight="fill" className="ms-0.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </article>
  );
});

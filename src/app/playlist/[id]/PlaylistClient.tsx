"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ClockIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { VirtualizedTrackTable } from "@/components/VirtualizedTrackTable";
import type { Playlist, Track } from "@/lib/types";

export default function PlaylistClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const queryId = searchParams.get("id");
  const id =
    queryId && queryId.trim()
      ? queryId.trim()
      : params?.id && params.id !== "default"
        ? params.id
        : "";
  const { user } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [actionErr, setActionErr] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .getPlaylist(id)
      .then((res) => {
        if (!active) return;
        setNotFound(false);
        setPlaylist(res.playlist);
        setTracks(res.tracks);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (!id || notFound) {
    return (
      <Glass className="mx-auto max-w-2xl rounded-3xl p-12 text-center space-y-3">
        <h1 className="text-xl font-bold">{t("playlistNotFound")}</h1>
        <p className="text-sm opacity-70">
          {lang === "fa"
            ? "این پلی‌لیست در دسترس نیست یا حذف شده است."
            : "This playlist is unavailable or has been removed."}
        </p>
        <Link href="/library" className="inline-block rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">
          {t("navLibrary")}
        </Link>
      </Glass>
    );
  }

  if (!playlist) {
    return <div className="mx-auto max-w-5xl h-80 rounded-3xl sf-content-card animate-pulse" />;
  }

  const isOwner = Boolean(user && (user.id === playlist.ownerId || user.role === "admin"));
  const isPlaylistPlaying = tracks.some((t) => t.id === currentTrack?.id) && isPlaying;

  const handlePlayAll = () => {
    if (isPlaylistPlaying) {
      togglePlay();
      return;
    }
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
    }
  };

  const handleShuffle = () => {
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled);
    }
  };

  const handleRemove = async (trackId: string) => {
    setActionErr("");
    try {
      await api.removeTrackFromPlaylist(playlist.id, trackId);
      setTracks((prev) => prev.filter((tr) => tr.id !== trackId));
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 sf-fade-up">
      {actionErr && (
        <p role="alert" className="rounded-2xl bg-rose-500/15 border border-rose-500/30 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300">
          {actionErr}
        </p>
      )}

      {/* Apple Music Playlist Curated Header */}
      <div className="relative overflow-hidden rounded-3xl sf-content-surface p-6 sm:p-8 border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_20px_50px_rgba(0,0,0,0.35)]">
        {/* Blurred backing glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 blur-3xl scale-125"
          style={{ backgroundColor: playlist.accentColor }}
        />

        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8 text-center sm:text-start">
          {/* Adaptive Mosaic artwork */}
          <PlaylistMosaic
            coverUrls={playlist.coverUrls}
            className="h-48 w-48 sm:h-52 sm:w-52 rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.4)] border border-white/15"
          />

          <div className="flex-1 min-w-0 space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/10 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/10 px-3.5 py-1 text-xs font-semibold text-[var(--sf-text)]">
              <PlaylistIcon size={14} weight="bold" aria-hidden="true" />
              <span>
                {formatNum(tracks.length)} {t("tracksCount")}
              </span>
            </span>

            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
              {pickText(playlist.title, playlist.titleFa)}
            </h1>

            <p className="text-sm opacity-80 leading-relaxed max-w-xl">
              {pickText(playlist.description, playlist.descriptionFa)}
            </p>

            {tracks.length > 0 && (
              <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <Button
                  type="button"
                  variant="filled"
                  tint={playlist.accentColor}
                  onClick={handlePlayAll}
                  icon={isPlaylistPlaying ? <PauseIcon size={18} weight="fill" aria-hidden="true" /> : <PlayIcon size={18} weight="fill" aria-hidden="true" />}
                >
                  {isPlaylistPlaying ? t("pause") : t("playNow")}
                </Button>
                <Button
                  type="button"
                  variant="glass"
                  onClick={handleShuffle}
                  icon={<ShuffleIcon size={18} weight="bold" aria-hidden="true" />}
                >
                  {t("shuffle")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Apple Music Tracklist Table */}
      <Glass className="rounded-3xl p-3 sm:p-5">
        {tracks.length === 0 ? (
          <div className="py-12 text-center opacity-70 text-sm">
            {t("emptyPlaylist")}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Table Header */}
            <div className="hidden sm:flex items-center justify-between px-4 py-2 text-xs font-semibold text-[var(--sf-muted)] uppercase tracking-wider border-b border-black/[0.04] dark:border-white/[0.06]">
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <span className="w-6 text-center shrink-0">#</span>
                <span className="w-11 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">{t("playlistTrackTitleCol")}</span>
              </div>
              <div className="flex items-center gap-4 sm:gap-8 shrink-0">
                <span className="hidden sm:block w-24 text-start">{t("albumName")}</span>
                <span className="w-14 sm:w-16 text-end flex items-center justify-end gap-1">
                  <ClockIcon size={13} aria-hidden="true" />
                </span>
                {isOwner && <span className="w-10 shrink-0" aria-hidden="true" />}
              </div>
            </div>

            {/* Track rows with Apple hover plates & smooth virtualization */}
            <VirtualizedTrackTable
              tracks={tracks}
              currentTrackId={currentTrack?.id}
              isPlaying={isPlaying}
              isOwner={isOwner}
              onPlayTrack={(tr, allTracks) => playTrack(tr, allTracks)}
              onRemoveTrack={handleRemove}
            />
          </div>
        )}
      </Glass>
    </div>
  );
}

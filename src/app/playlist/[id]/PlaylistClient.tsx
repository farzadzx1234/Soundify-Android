"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  BookmarkSimpleIcon,
  CheckIcon,
  ClockIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { api, getCachedCatalogTracks, getPlaylistDetailHref } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { VirtualizedTrackTable } from "@/components/VirtualizedTrackTable";
import {
  customRecordToPlaylist,
  deleteCustomPlaylist,
  removeTrackFromCustomPlaylist,
  savePersonalizedMixAsCustomPlaylist,
  updateCustomPlaylist,
  useCustomPlaylists,
} from "@/lib/customPlaylists";
import { useDownloadedTracks } from "@/lib/downloadManager";
import {
  buildPersonalizedMixes,
  getCachedPersonalizedMix,
} from "@/lib/listeningPersonalization";
import type { Playlist, Track } from "@/lib/types";

export default function PlaylistClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
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
  const { downloadedTracks } = useDownloadedTracks();
  const customPlaylists = useCustomPlaylists();

  const isCustomPlaylist = id.startsWith("cpl-");
  const isMixPlaylist = id.startsWith("mix-");

  const customRecord = useMemo(
    () => (isCustomPlaylist ? customPlaylists.find((p) => p.id === id) ?? null : null),
    [customPlaylists, id, isCustomPlaylist],
  );

  const resolvedMix = useMemo(() => {
    if (!isMixPlaylist) return null;
    const cached = getCachedPersonalizedMix(id);
    if (cached) return cached;
    const catalog = getCachedCatalogTracks() ?? [];
    const dl = downloadedTracks.map((d) => d.track);
    const rebuilt = buildPersonalizedMixes(catalog, dl, [], lang);
    return rebuilt.find((m) => m.id === id) ?? null;
  }, [downloadedTracks, id, isMixPlaylist, lang]);

  const [serverPlaylist, setServerPlaylist] = useState<Playlist | null>(null);
  const [serverTracks, setServerTracks] = useState<Track[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!id || isCustomPlaylist || isMixPlaylist) return;
    let active = true;
    api
      .getPlaylist(id)
      .then((res) => {
        if (!active) return;
        setNotFound(false);
        setServerPlaylist(res.playlist);
        setServerTracks(res.tracks);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [id, isCustomPlaylist, isMixPlaylist]);

  const playlist: Playlist | null = isCustomPlaylist
    ? customRecord
      ? customRecordToPlaylist(customRecord)
      : null
    : isMixPlaylist
      ? resolvedMix
        ? {
            id: resolvedMix.id,
            title: resolvedMix.title,
            titleFa: resolvedMix.titleFa,
            description: resolvedMix.subtitle,
            descriptionFa: resolvedMix.subtitleFa,
            ownerId: "soundify-auto",
            isFeatured: false,
            accentColor: resolvedMix.accentColor,
            trackCount: resolvedMix.tracks.length,
            coverUrls: resolvedMix.coverUrls,
            createdAt: new Date().toISOString(),
          }
        : null
      : serverPlaylist;

  const tracks: Track[] = isCustomPlaylist
    ? customRecord?.tracks ?? []
    : isMixPlaylist
      ? resolvedMix?.tracks ?? []
      : serverTracks;

  if (!id || (!isCustomPlaylist && !isMixPlaylist && notFound) || (isCustomPlaylist && !customRecord) || (isMixPlaylist && !resolvedMix)) {
    if (!isCustomPlaylist && !isMixPlaylist && !notFound && !serverPlaylist && id) {
      return <div className="mx-auto max-w-5xl h-80 rounded-3xl sf-content-card animate-pulse" />;
    }
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

  const isOwner =
    isCustomPlaylist ||
    Boolean(!isMixPlaylist && user && (user.id === playlist.ownerId || user.role === "admin"));
  const isPlaylistPlaying = tracks.some((tr) => tr.id === currentTrack?.id) && isPlaying;

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
    if (isCustomPlaylist) {
      removeTrackFromCustomPlaylist(playlist.id, trackId);
      return;
    }
    try {
      await api.removeTrackFromPlaylist(playlist.id, trackId);
      setServerTracks((prev) => prev.filter((tr) => tr.id !== trackId));
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleDraft.trim() || !isCustomPlaylist) return;
    updateCustomPlaylist(playlist.id, { title: titleDraft.trim() });
    setEditingTitle(false);
  };

  const handleDeleteCustom = () => {
    if (!isCustomPlaylist) return;
    deleteCustomPlaylist(playlist.id);
    router.push("/library");
  };

  const handleSaveMixToCustom = () => {
    if (!resolvedMix) return;
    const saved = savePersonalizedMixAsCustomPlaylist(resolvedMix, lang);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      router.push(getPlaylistDetailHref(saved.id));
    }, 650);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {actionErr && (
        <p role="alert" className="rounded-2xl bg-rose-500/15 border border-rose-500/30 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300">
          {actionErr}
        </p>
      )}

      {/* Apple Music / Spotify Playlist Curated Header */}
      <div className="relative overflow-hidden rounded-3xl sf-content-surface p-6 sm:p-8 border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_20px_50px_rgba(0,0,0,0.35)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 blur-3xl scale-125"
          style={{ backgroundColor: playlist.accentColor }}
        />

        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8 text-center sm:text-start">
          <PlaylistMosaic
            coverUrls={playlist.coverUrls}
            tracks={tracks}
            className="h-44 w-44 sm:h-52 sm:w-52 rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.4)] border border-white/15"
          />

          <div className="flex-1 min-w-0 space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/10 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/10 px-3.5 py-1 text-xs font-semibold text-[var(--sf-text)]">
              <PlaylistIcon size={14} weight="bold" aria-hidden="true" />
              <span>
                {formatNum(tracks.length)} {t("tracksCount")}
              </span>
            </span>

            {editingTitle ? (
              <form onSubmit={handleSaveRename} className="flex items-center gap-2 max-w-md mx-auto sm:mx-0">
                <input
                  type="text"
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="flex-1 rounded-xl bg-black/15 dark:bg-white/10 border border-white/25 px-3 py-2 text-lg font-bold text-[var(--sf-text)] focus:outline-none"
                  required
                />
                <Button type="submit" variant="filled" className="!min-h-[40px] !px-4 text-xs">
                  <CheckIcon size={16} weight="bold" />
                </Button>
              </form>
            ) : (
              <div className="flex items-center justify-center sm:justify-start gap-2.5">
                <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
                  {pickText(playlist.title, playlist.titleFa)}
                </h1>
                {isCustomPlaylist && (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(playlist.title);
                      setEditingTitle(true);
                    }}
                    aria-label={pickText("Rename playlist", "تغییر نام پلی‌لیست")}
                    className="sf-press h-9 w-9 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center text-[var(--sf-muted)] hover:text-[var(--sf-text)] cursor-pointer shrink-0"
                  >
                    <PencilSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {(playlist.description || playlist.descriptionFa) && (
              <p className="text-sm opacity-80 leading-relaxed max-w-xl">
                {pickText(playlist.description, playlist.descriptionFa)}
              </p>
            )}

            <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              {tracks.length > 0 && (
                <>
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
                </>
              )}

              {isMixPlaylist && resolvedMix && (
                <Button
                  type="button"
                  variant="glass"
                  onClick={handleSaveMixToCustom}
                  icon={
                    savedNotice ? (
                      <CheckIcon size={18} weight="bold" className="text-emerald-500" aria-hidden="true" />
                    ) : (
                      <BookmarkSimpleIcon size={18} weight="bold" aria-hidden="true" />
                    )
                  }
                >
                  {savedNotice
                    ? pickText("Saved!", "ذخیره شد!")
                    : pickText("Save to My Playlists", "ذخیره در پلی‌لیست‌های من")}
                </Button>
              )}

              {isCustomPlaylist && (
                <Button
                  type="button"
                  variant="ghost"
                  destructive
                  onClick={handleDeleteCustom}
                  icon={<TrashIcon size={17} aria-hidden="true" />}
                >
                  {t("deletePlaylist")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Apple Music Tracklist Table */}
      <Glass className="rounded-3xl p-3 sm:p-5">
        {tracks.length === 0 ? (
          <div className="py-12 text-center space-y-2 opacity-80 text-sm">
            <p className="font-bold">{t("emptyPlaylist")}</p>
            <p className="text-xs text-[var(--sf-muted)]">
              {pickText(
                "Tap the Add to Playlist button on any track in Search, Home, or Library to add songs here.",
                "روی دکمه افزودن به پلی‌لیست در صفحه خانه، جستجو یا کتابخانه بزنید تا آهنگ‌ها به اینجا اضافه شوند.",
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
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

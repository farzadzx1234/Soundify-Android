"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowCircleDownIcon,
  ArrowLineDownIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  HeartIcon,
  HardDriveIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  MicrophoneStageIcon,
  PlayIcon,
  PlaylistIcon,
  PlusIcon,
  RepeatIcon,
  ShuffleIcon,
  SquareIcon,
  SquaresFourIcon,
  TrashIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { api, getPlaylistDetailHref } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n, type TranslationKey } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { useDownloadedTracks, useActiveDownloads } from "@/lib/downloadManager";
import { exportTrackToDeviceStorage, getExportedTrackIds } from "@/lib/mediaExport";
import { buildPersonalizedMixes } from "@/lib/listeningPersonalization";
import { formatDuration } from "@/lib/lrc";
import { Button, Glass, Input } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackGrid } from "@/components/VirtualizedTrackGrid";
import type { Playlist, Track } from "@/lib/types";

type LibraryTab = "downloaded" | "liked" | "reposts" | "playlists" | "history";

function formatStorageSize(
  bytes: number,
  t?: (key: TranslationKey) => string,
  formatNum?: (num: number) => string,
): string {
  const fn = (n: number) => (formatNum ? formatNum(n) : String(n));
  const kbUnit = t ? t("kilobytes") : "KB";
  const mbUnit = t ? t("megabytes") : "MB";
  const gbUnit = t ? t("gigabytes") : "GB";

  if (!bytes || bytes <= 0) return `0 ${mbUnit}`;
  if (bytes < 1024 * 1024) return `${fn(Math.round(bytes / 102.4) / 10)} ${kbUnit}`;
  if (bytes < 1024 * 1024 * 1024) return `${fn(Math.round(bytes / (102.4 * 1024)) / 10)} ${mbUnit}`;
  return `${fn(Math.round(bytes / (10.24 * 1024 * 1024)) / 100)} ${gbUnit}`;
}

export default function LibraryPage() {
  const { user, openAuthDialog } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { playTrack, currentTrack, isPlaying, isBuffering, togglePlay } = usePlayer();
  const {
    downloadedTracks,
    totalSizeBytes,
    batchDeleteTracks,
  } = useDownloadedTracks();
  const activeDownloads = useActiveDownloads();

  const [tab, setTab] = useState<LibraryTab>("downloaded");
  const hasManuallySwitchedTab = useRef(false);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [repostedTracks, setRepostedTracks] = useState<Track[]>([]);
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);

  // Downloaded tab local search, view mode, device export & batch selection
  const [downloadSearchQuery, setDownloadSearchQuery] = useState("");
  const [downloadViewMode, setDownloadViewMode] = useState<"list" | "grid">("list");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [exportedTrackIds, setExportedTrackIds] = useState<Set<string>>(() => getExportedTrackIds());
  const [exportAllRunning, setExportAllRunning] = useState(false);
  const [exportToast, setExportToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [trackPendingDelete, setTrackPendingDelete] = useState<Track | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      api.getTracks({ liked: true }),
      api.getTracks({ reposted: true }),
      api.getPlaylists(true),
      api.getHistory(),
    ])
      .then(([liked, reposts, pls, hist]) => {
        if (!active) return;
        setLikedTracks(liked.tracks);
        setRepostedTracks(reposts.tracks);
        setPlaylists(pls.playlists);
        setHistoryTracks(hist.tracks);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthDialog();
      return;
    }
    if (!newPlaylistTitle.trim()) return;
    setCreating(true);
    setActionErr("");
    try {
      const res = await api.createPlaylist({ title: newPlaylistTitle.trim() });
      setPlaylists((prev) => [res.playlist, ...prev]);
      setNewPlaylistTitle("");
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setActionErr("");
    try {
      await api.deletePlaylist(playlistId);
      setPlaylists((prev) => prev.filter((pl) => pl.id !== playlistId));
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };



  const handleToggleSelectTrack = (trackId: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTrackIds.size === filteredDownloadedTracks.length) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(filteredDownloadedTracks.map((r) => r.trackId)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedTrackIds.size === 0) return;
    if (!confirmDeleteSelected) {
      setConfirmDeleteSelected(true);
      setTimeout(() => setConfirmDeleteSelected(false), 4000);
      return;
    }
    setConfirmDeleteSelected(false);
    const ids = Array.from(selectedTrackIds);
    await batchDeleteTracks(ids);
    setSelectedTrackIds(new Set());
  };

  const handleExportAll = async () => {
    if (exportAllRunning || filteredDownloadedTracks.length === 0) return;
    setExportAllRunning(true);
    let newlySavedCount = 0;
    let alreadySavedCount = 0;
    try {
      for (const rec of filteredDownloadedTracks) {
        try {
          const res = await exportTrackToDeviceStorage(rec.track, rec.audioBlob);
          if (res.success) {
            if (res.alreadyExists) {
              alreadySavedCount++;
            } else {
              newlySavedCount++;
            }
            setExportedTrackIds((prev) => new Set(prev).add(rec.trackId));
          }
        } catch {}
      }
      if (newlySavedCount > 0) {
        setExportToast({ message: t("exportAllSuccess"), type: "success" });
        setTimeout(() => setExportToast(null), 4000);
      } else if (alreadySavedCount > 0) {
        setExportToast({
          message: pickText(
            "All tracks are already saved in your Music/Soundify folder",
            "همه آهنگ‌ها قبلاً در پوشه Music/Soundify گوشی ذخیره شده‌اند و نسخه تکراری ایجاد نشد.",
          ),
          type: "success",
        });
        setTimeout(() => setExportToast(null), 4000);
      } else {
        setExportToast({ message: t("saveToDeviceError"), type: "error" });
        setTimeout(() => setExportToast(null), 4000);
      }
    } finally {
      setExportAllRunning(false);
    }
  };

  const handleExportSelected = async () => {
    if (exportAllRunning || selectedTrackIds.size === 0) return;
    setExportAllRunning(true);
    let newlySavedCount = 0;
    let alreadySavedCount = 0;
    try {
      const targets = filteredDownloadedTracks.filter((r) => selectedTrackIds.has(r.trackId));
      for (const rec of targets) {
        try {
          const res = await exportTrackToDeviceStorage(rec.track, rec.audioBlob);
          if (res.success) {
            if (res.alreadyExists) {
              alreadySavedCount++;
            } else {
              newlySavedCount++;
            }
            setExportedTrackIds((prev) => new Set(prev).add(rec.trackId));
          }
        } catch {}
      }
      if (newlySavedCount > 0) {
        setExportToast({ message: t("exportAllSuccess"), type: "success" });
        setTimeout(() => setExportToast(null), 4000);
      } else if (alreadySavedCount > 0) {
        setExportToast({
          message: pickText(
            "Selected tracks are already saved on device storage",
            "آهنگ‌های انتخاب‌شده قبلاً یک‌بار روی گوشی ذخیره شده‌اند.",
          ),
          type: "success",
        });
        setTimeout(() => setExportToast(null), 4000);
      } else {
        setExportToast({ message: t("saveToDeviceError"), type: "error" });
        setTimeout(() => setExportToast(null), 4000);
      }
    } finally {
      setExportAllRunning(false);
    }
  };

  const handlePlayDownloadedTrack = (track: Track) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
      playTrack(track, filteredDownloadedTrackObjects);
    }
  };

  const handleTrackUpdated = (updated: Track) => {
    if (tab === "liked") {
      setLikedTracks((prev) =>
        updated.likedByMe ? prev.map((tr) => (tr.id === updated.id ? updated : tr)) : prev.filter((tr) => tr.id !== updated.id),
      );
    } else if (tab === "reposts") {
      setRepostedTracks((prev) =>
        updated.repostedByMe ? prev.map((tr) => (tr.id === updated.id ? updated : tr)) : prev.filter((tr) => tr.id !== updated.id),
      );
    } else if (tab === "history") {
      setHistoryTracks((prev) => prev.map((tr) => (tr.id === updated.id ? updated : tr)));
    }
  };

  // Filter downloaded tracks by search query
  const filteredDownloadedTracks = !downloadSearchQuery.trim()
    ? downloadedTracks
    : downloadedTracks.filter((rec) => {
        const q = downloadSearchQuery.trim().toLowerCase();
        const title = (rec.track.title || "").toLowerCase();
        const titleFa = (rec.track.titleFa || "").toLowerCase();
        const artist = (rec.track.artistName || "").toLowerCase();
        const artistFa = (rec.track.artistNameFa || "").toLowerCase();
        return title.includes(q) || titleFa.includes(q) || artist.includes(q) || artistFa.includes(q);
      });

  const filteredDownloadedTrackObjects = filteredDownloadedTracks.map((r) => r.track);

  const personalizedMixes = React.useMemo(
    () =>
      buildPersonalizedMixes(
        [],
        downloadedTracks.map((r) => r.track),
        likedTracks,
        lang,
      ),
    [downloadedTracks, lang, likedTracks],
  );

  const activeTracks: Track[] =
    tab === "downloaded"
      ? filteredDownloadedTrackObjects
      : tab === "liked"
        ? likedTracks
        : tab === "reposts"
          ? repostedTracks
          : historyTracks;

  const handlePlayAll = () => {
    if (activeTracks.length > 0) {
      playTrack(activeTracks[0], activeTracks);
    }
  };

  const handleShuffle = () => {
    if (activeTracks.length > 0) {
      const shuffled = [...activeTracks].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled);
    }
  };

  const isGuestTabLocked = !user && tab !== "downloaded";

  const handleRefresh = async () => {
    try {
      if (user) {
        const [liked, reposts, pls, hist] = await Promise.all([
          api.getTracks({ liked: true }),
          api.getTracks({ reposted: true }),
          api.getPlaylists(true),
          api.getHistory(),
        ]);
        setLikedTracks(liked.tracks);
        setRepostedTracks(reposts.tracks);
        setPlaylists(pls.playlists);
        setHistoryTracks(hist.tracks);
      }
    } catch {
      // non-fatal
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="mx-auto max-w-7xl w-full overflow-x-hidden space-y-5 sf-fade-up px-1 sm:px-2">
        {/* Apple Music HIG Clean Library Header */}
        <header className="space-y-4 pt-1 sm:pt-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <h1 className="text-[26px] sm:text-3xl font-black text-[var(--sf-text)] tracking-tight truncate">
                {t("libraryTitle")}
              </h1>
              <p className="text-xs text-[var(--sf-muted)] font-medium truncate">
                {user ? (
                  <bdi className="font-semibold text-[var(--sf-muted)]">{user.displayName}</bdi>
                ) : (
                  t("guestAccount")
                )}
              </p>
            </div>

            {/* Quick Play & Shuffle actions for current section (44pt Apple HIG touch targets) */}
            {tab !== "playlists" && !isGuestTabLocked && activeTracks.length > 0 && !selectMode && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="filled"
                  onClick={handlePlayAll}
                  icon={<PlayIcon size={16} weight="fill" aria-hidden="true" />}
                  className="!min-h-[44px] !px-4 text-xs font-bold"
                >
                  {t("playNow")}
                </Button>
                <Button
                  type="button"
                  variant="glass"
                  onClick={handleShuffle}
                  icon={<ShuffleIcon size={16} weight="bold" aria-hidden="true" />}
                  aria-label={t("shuffle")}
                  className="!min-h-[44px] !px-3.5 text-xs font-bold"
                />
              </div>
            )}
          </div>

          {/* Apple Music / Spotify Filter Chips */}
          <div className="w-full max-w-full overflow-x-auto no-scrollbar scroll-smooth" role="tablist" aria-label={t("libraryTitle")}>
            <div className="flex items-center gap-2 min-w-max py-0.5">
              {[
                {
                  id: "downloaded" as const,
                  label: t("downloadedTracksTab"),
                  count: downloadedTracks.length,
                  icon: <ArrowCircleDownIcon size={15} weight="bold" />,
                },
                {
                  id: "liked" as const,
                  label: t("likedTracksTab"),
                  count: likedTracks.length,
                  icon: <HeartIcon size={15} weight="bold" />,
                },
                {
                  id: "playlists" as const,
                  label: t("playlistsTab"),
                  count: playlists.length,
                  icon: <PlaylistIcon size={15} weight="bold" />,
                },
                {
                  id: "reposts" as const,
                  label: t("repostsTab"),
                  count: repostedTracks.length,
                  icon: <RepeatIcon size={15} weight="bold" />,
                },
                {
                  id: "history" as const,
                  label: t("historyTab"),
                  count: historyTracks.length,
                  icon: <ClockCounterClockwiseIcon size={15} weight="bold" />,
                },
              ].map((tabItem) => {
                const isActive = tab === tabItem.id;
                return (
                  <button
                    key={tabItem.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      hasManuallySwitchedTab.current = true;
                      setTab(tabItem.id);
                      setSelectMode(false);
                      setSelectedTrackIds(new Set());
                    }}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs sm:text-[13px] font-bold transition-all cursor-pointer select-none active:scale-95 shrink-0 ${
                      isActive
                        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 border border-indigo-500"
                        : "bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-[var(--sf-muted)] hover:text-[var(--sf-text)] border border-black/[0.06] dark:border-white/[0.08]"
                    }`}
                  >
                    <span className={isActive ? "text-white" : "text-indigo-500 dark:text-indigo-400"}>
                      {tabItem.icon}
                    </span>
                    <span>{tabItem.label}</span>
                    {tabItem.count !== undefined && tabItem.count > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums leading-none ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-black/[0.06] dark:bg-white/[0.1] text-[var(--sf-text)]"
                        }`}
                      >
                        {formatNum(tabItem.count)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {actionErr && (
          <p role="alert" className="rounded-2xl bg-rose-500/15 border border-rose-500/30 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300">
            {actionErr}
          </p>
        )}

        {/* Guest Lock Banner for Cloud Tabs */}
        {isGuestTabLocked ? (
          <Glass className="rounded-3xl p-8 sm:p-10 text-center space-y-4 max-w-md mx-auto">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-500 border border-indigo-500/20">
              <UserCircleIcon size={28} weight="bold" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold">{t("loginRequired")}</h2>
              <p className="text-xs text-[var(--sf-muted)]">
                {t("guestAccount")} — {t("loginRequired")}
              </p>
            </div>
            <div className="pt-2 flex justify-center gap-2.5">
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                icon={<UserCircleIcon size={18} aria-hidden="true" />}
              >
                {t("signIn")}
              </Button>
              <Button
                type="button"
                variant="glass"
                onClick={() => {
                  hasManuallySwitchedTab.current = true;
                  setTab("downloaded");
                }}
                icon={<ArrowCircleDownIcon size={18} aria-hidden="true" />}
              >
                {t("downloadedTracksTab")}
              </Button>
            </div>
          </Glass>
        ) : tab === "downloaded" ? (
          /* Downloaded Tracks Section with Minimal Unified Sub-bar */
          <div className="space-y-4">
            {activeDownloads.length > 0 && (
              <div className="rounded-2xl p-3.5 sm:p-4 space-y-2.5 border border-indigo-500/25 bg-indigo-500/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs sm:text-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
                    {pickText("Active Downloads", "دانلودهای در حال انجام")} ({formatNum(activeDownloads.length)})
                  </span>
                </div>
                <div className="space-y-2 divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {activeDownloads.map((dl) => (
                    <div key={dl.trackId} className="pt-2 first:pt-0 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold truncate max-w-[200px] sm:max-w-md">
                          {dl.track ? pickText(dl.track.title, dl.track.titleFa) : dl.trackId}
                        </span>
                        <span className="tabular-nums font-black text-indigo-500" dir="ltr">
                          {dl.progress}%
                        </span>
                      </div>
                      <div className="w-full bg-black/[0.06] dark:bg-white/[0.08] h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-300"
                          style={{ width: `${Math.max(3, dl.progress)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clean Minimal Search & Action Strip (Spotify / Apple Music Design) */}
            {downloadedTracks.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 py-1">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Input
                      aria-label={t("searchDownloadedPlaceholder")}
                      placeholder={t("searchDownloadedPlaceholder")}
                      value={downloadSearchQuery}
                      onValueChange={setDownloadSearchQuery}
                      icon={<MagnifyingGlassIcon size={15} aria-hidden="true" />}
                    />
                  </div>
                  <div className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.03] dark:bg-white/[0.04] text-[11px] font-semibold text-[var(--sf-muted)] shrink-0 border border-black/[0.04] dark:border-white/[0.05]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>{formatNum(filteredDownloadedTracks.length)} {t("tracksCount")}</span>
                    <span>•</span>
                    <span className="tabular-nums text-[var(--sf-text)] font-bold">{formatStorageSize(totalSizeBytes, t, formatNum)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                  {/* Export All to Device Button */}
                  {!selectMode && filteredDownloadedTracks.length > 0 && (
                    <Button
                      type="button"
                      variant="glass"
                      onClick={() => void handleExportAll()}
                      disabled={exportAllRunning}
                      icon={
                        exportAllRunning ? (
                          <CircleNotchIcon size={15} className="animate-spin text-indigo-500" aria-hidden="true" />
                        ) : (
                          <ArrowLineDownIcon size={15} weight="bold" aria-hidden="true" />
                        )
                      }
                      className="!min-h-[36px] !px-3 text-xs font-semibold"
                      title={t("exportAllToDevice")}
                    >
                      <span className="max-[400px]:hidden">{exportAllRunning ? t("exportingToDevice") : t("exportAllToDevice")}</span>
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant={selectMode ? "filled" : "glass"}
                    onClick={() => {
                      setSelectMode(!selectMode);
                      setSelectedTrackIds(new Set());
                      setConfirmDeleteSelected(false);
                    }}
                    className="!min-h-[36px] !px-3 text-xs font-semibold"
                  >
                    {selectMode ? t("cancelSelect") : t("selectMode")}
                  </Button>

                  {/* View Mode Toggle (List / Grid) anchored on far trailing edge */}
                  {!selectMode && (
                    <div className="inline-flex rounded-full bg-black/[0.04] dark:bg-white/[0.06] p-0.5 border border-black/[0.04] dark:border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => setDownloadViewMode("list")}
                        aria-label={t("viewModeList")}
                        title={t("viewModeList")}
                        className={`p-1.5 rounded-full transition-all cursor-pointer ${
                          downloadViewMode === "list"
                            ? "bg-white dark:bg-white/20 text-indigo-500 shadow-sm"
                            : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                        }`}
                      >
                        <ListDashesIcon size={15} weight="bold" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDownloadViewMode("grid")}
                        aria-label={t("viewModeGrid")}
                        title={t("viewModeGrid")}
                        className={`p-1.5 rounded-full transition-all cursor-pointer ${
                          downloadViewMode === "grid"
                            ? "bg-white dark:bg-white/20 text-indigo-500 shadow-sm"
                            : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                        }`}
                      >
                        <SquaresFourIcon size={15} weight="bold" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Contextual Batch Action Bar when selectMode is Active */}
            {selectMode && filteredDownloadedTracks.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 sf-fade-up">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleSelectAll}
                    icon={
                      selectedTrackIds.size === filteredDownloadedTracks.length && filteredDownloadedTracks.length > 0 ? (
                        <CheckSquareIcon size={16} weight="fill" className="text-indigo-500" aria-hidden="true" />
                      ) : (
                        <SquareIcon size={16} aria-hidden="true" />
                      )
                    }
                    className="!min-h-[34px] !px-2.5 text-xs font-bold"
                  >
                    {t("selectAll")}
                  </Button>
                  <span className="text-xs font-bold text-[var(--sf-muted)]">
                    ({formatNum(selectedTrackIds.size)} / {formatNum(filteredDownloadedTracks.length)})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTrackIds.size > 0 && (
                    <>
                      <Button
                        type="button"
                        variant="glass"
                        onClick={() => void handleExportSelected()}
                        disabled={exportAllRunning}
                        icon={
                          exportAllRunning ? (
                            <CircleNotchIcon size={14} className="animate-spin text-indigo-500" />
                          ) : (
                            <ArrowLineDownIcon size={14} weight="bold" />
                          )
                        }
                        className="!min-h-[34px] !px-3 text-xs font-semibold"
                        title={t("saveToDevice")}
                      >
                        {exportAllRunning
                          ? t("exportingToDevice")
                          : `${t("saveToDevice")} (${formatNum(selectedTrackIds.size)})`}
                      </Button>

                      <Button
                        type="button"
                        variant="filled"
                        destructive
                        onClick={() => void handleDeleteSelected()}
                        icon={<TrashIcon size={14} aria-hidden="true" />}
                        className="!min-h-[34px] !px-3 text-xs font-semibold"
                      >
                        {confirmDeleteSelected
                          ? t("deleteSelectedConfirm")
                          : `${t("deleteSelected")} (${formatNum(selectedTrackIds.size)})`}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {downloadedTracks.length === 0 ? (
              <div className="sf-content-card rounded-3xl p-8 sm:p-10 text-center space-y-4 max-w-md mx-auto border border-black/[0.06] dark:border-white/[0.08]">
                <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-500 border border-indigo-500/20">
                  <ArrowCircleDownIcon size={26} weight="duotone" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-[var(--sf-text)]">{t("downloadedTracksTab")}</h2>
                  <p className="text-xs text-[var(--sf-muted)] leading-relaxed">
                    {t("noDownloadedTracks")}
                  </p>
                </div>
                <div className="pt-1 flex justify-center">
                  <Link
                    href="/search"
                    className="sf-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-sm active:scale-[0.97] transition-all"
                  >
                    <MagnifyingGlassIcon size={15} weight="bold" aria-hidden="true" />
                    <span>{pickText("Discover & Download Music", "جستجو و دانلود آهنگ")}</span>
                  </Link>
                </div>
              </div>
            ) : filteredDownloadedTracks.length === 0 ? (
              <Glass className="rounded-3xl p-8 text-center space-y-2 max-w-md mx-auto">
                <p className="text-sm font-semibold">{t("noOfflineMatch")}</p>
              </Glass>
            ) : selectMode ? (
              /* Multi-select Batch Management Table / List */
              <div className="rounded-2xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.05] overflow-hidden">
                {filteredDownloadedTracks.map((record) => {
                  const isChecked = selectedTrackIds.has(record.trackId);
                  const trackTitle = pickText(record.track.title, record.track.titleFa);
                  const artistTitle = pickText(record.track.artistName, record.track.artistNameFa);
                  const isExported = exportedTrackIds.has(record.trackId);
                  const hasLyrics = Boolean(record.lyrics?.lines && record.lyrics.lines.length > 0);

                  return (
                    <div
                      key={record.trackId}
                      onClick={() => handleToggleSelectTrack(record.trackId)}
                      className={`flex items-center justify-between gap-3 p-3 sm:px-4 cursor-pointer transition-colors ${
                        isChecked
                          ? "bg-indigo-500/10 dark:bg-indigo-500/15"
                          : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectTrack(record.trackId);
                          }}
                          aria-label={isChecked ? "Deselect" : "Select"}
                          className="shrink-0 p-1 text-slate-700 dark:text-slate-200"
                        >
                          {isChecked ? (
                            <CheckSquareIcon size={20} weight="fill" className="text-indigo-500" />
                          ) : (
                            <SquareIcon size={20} className="text-[var(--sf-muted)]" />
                          )}
                        </button>

                        <div className="h-11 w-11 rounded-xl overflow-hidden bg-slate-800 shrink-0 shadow-sm">
                          {record.track.coverUrl ? (
                            <img
                              src={record.track.coverUrl}
                              alt={trackTitle}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center bg-indigo-500 text-white font-bold text-xs">
                              {trackTitle.slice(0, 1)}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm truncate">{trackTitle}</p>
                          <div className="flex items-center gap-2 text-xs text-[var(--sf-muted)] truncate">
                            <span className="truncate">{artistTitle}</span>
                            {hasLyrics && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-semibold shrink-0">
                                <MicrophoneStageIcon size={11} weight="fill" />
                                <span>{t("hasLyricsBadge")}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold tabular-nums text-[var(--sf-muted)]">
                          {formatStorageSize(record.sizeBytes || 0, t, formatNum)}
                        </span>
                        {isExported && (
                          <span title={t("savedToDeviceBadge")}>
                            <HardDriveIcon
                              size={13}
                              weight="bold"
                              className="text-emerald-500 dark:text-emerald-400 ms-1 shrink-0"
                              aria-label={t("savedToDeviceBadge")}
                            />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : downloadViewMode === "list" ? (
              /* Apple Music / Spotify Sleek Scannable Row List */
              <div className="rounded-2xl sf-content-card border border-black/[0.05] dark:border-white/[0.07] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.05] overflow-hidden">
                {filteredDownloadedTracks.map((record) => {
                  const trackTitle = pickText(record.track.title, record.track.titleFa);
                  const artistTitle = pickText(record.track.artistName, record.track.artistNameFa);
                  const isCurrent = currentTrack?.id === record.trackId;
                  const isExported = exportedTrackIds.has(record.trackId);
                  const hasLyrics = Boolean(record.lyrics?.lines && record.lyrics.lines.length > 0);

                  return (
                    <div
                      key={record.trackId}
                      onClick={() => handlePlayDownloadedTrack(record.track)}
                      className={`group flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3 transition-colors cursor-pointer select-none active:scale-[0.99] ${
                        isCurrent
                          ? "bg-indigo-500/[0.08] dark:bg-indigo-500/[0.12]"
                          : "hover:bg-black/[0.025] dark:hover:bg-white/[0.035]"
                      }`}
                    >
                      {/* Leading: Apple Music 44x44 Album Art with Playing Indicator */}
                      <div className="relative h-11 w-11 sm:h-12 sm:w-12 rounded-[10px] overflow-hidden bg-slate-800 shrink-0 shadow-sm ring-1 ring-black/5 dark:ring-white/10 pointer-events-none">
                        {record.track.coverUrl ? (
                          <img
                            src={record.track.coverUrl}
                            alt={trackTitle}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-pink-500 text-white font-black text-xs">
                            {trackTitle.slice(0, 1)}
                          </div>
                        )}
                        {isCurrent && (
                          <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                            {isBuffering ? (
                              <CircleNotchIcon size={16} className="animate-spin text-white" aria-hidden="true" />
                            ) : isPlaying ? (
                              <span className="flex items-end gap-0.5 h-3.5 w-3" aria-hidden="true">
                                <span className="w-0.5 h-full bg-emerald-400 rounded-full animate-pulse" />
                                <span className="w-0.5 h-2/3 bg-emerald-400 rounded-full animate-pulse delay-75" />
                                <span className="w-0.5 h-4/5 bg-emerald-400 rounded-full animate-pulse delay-150" />
                              </span>
                            ) : (
                              <PlayIcon size={14} weight="fill" className="text-white" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Center: Clean Scannable Title & Subtitle */}
                      <div className="min-w-0 flex-1 space-y-0.5 text-start">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p
                            className={`truncate text-[15px] leading-snug font-semibold ${
                              isCurrent
                                ? "text-indigo-600 dark:text-indigo-400 font-bold"
                                : "text-[var(--sf-text)]"
                            }`}
                          >
                            {trackTitle}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-[var(--sf-muted)] truncate">
                          <span className="truncate">{artistTitle}</span>
                          <span className="shrink-0 opacity-60">•</span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {formatDuration(record.track.durationSec || 0)}
                          </span>
                          <span className="shrink-0 opacity-60">•</span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {formatStorageSize(record.sizeBytes || 0, t, formatNum)}
                          </span>

                          {hasLyrics && (
                            <span title={t("hasLyricsBadge")}>
                              <MicrophoneStageIcon
                                size={12}
                                weight="fill"
                                className="text-indigo-400 ms-0.5 shrink-0"
                                aria-label={t("hasLyricsBadge")}
                              />
                            </span>
                          )}

                          {isExported && (
                            <span title={t("savedToDeviceBadge")}>
                              <HardDriveIcon
                                size={12}
                                weight="bold"
                                className="text-emerald-500 dark:text-emerald-400 ms-0.5 shrink-0"
                                aria-label={t("savedToDeviceBadge")}
                              />
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Trailing: Direct Delete Button (Opens Confirmation Dialog) */}
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTrackPendingDelete(record.track);
                          }}
                          aria-label={`${pickText("Remove download", "حذف دانلود")} ${trackTitle}`}
                          className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-rose-500/80 hover:text-rose-500 hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer"
                        >
                          <TrashIcon size={19} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <VirtualizedTrackGrid
                tracks={filteredDownloadedTrackObjects}
                queue={filteredDownloadedTrackObjects}
                playlists={playlists}
                onTrackUpdated={handleTrackUpdated}
                className="pb-4"
              />
            )}
          </div>
        ) : tab === "playlists" ? (
        /* Playlists Section */
        <div className="space-y-6">
          {personalizedMixes.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm sm:text-base font-extrabold text-[var(--sf-text)]">
                  {pickText("Made For You", "ساخته‌شده اختصاصی برای شما")}
                </h2>
                <span className="text-[11px] font-medium text-[var(--sf-muted)]">
                  {pickText("Auto Mixes", "میکس هوشمند")}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {personalizedMixes.map((mix) => (
                  <button
                    key={mix.id}
                    type="button"
                    onClick={() => mix.tracks.length > 0 && playTrack(mix.tracks[0], mix.tracks)}
                    className="sf-press sf-content-card text-start rounded-2xl p-3 flex items-center gap-3.5 cursor-pointer border border-black/[0.05] dark:border-white/[0.08]"
                  >
                    <PlaylistMosaic coverUrls={mix.coverUrls} className="h-16 w-16 rounded-xl shrink-0 shadow" lazy />
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-emerald-500">
                        {lang === "fa" ? mix.badgeFa : mix.badge}
                      </span>
                      <h3 className="font-bold text-sm truncate text-[var(--sf-text)]">
                        {lang === "fa" ? mix.titleFa : mix.title}
                      </h3>
                      <p className="text-[11px] text-[var(--sf-muted)] truncate">
                        {formatNum(mix.tracks.length)} {t("tracksCount")}
                      </p>
                    </div>
                    <span className="h-9 w-9 rounded-full bg-indigo-500 text-white flex items-center justify-center shrink-0">
                      <PlayIcon size={15} weight="fill" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <Glass className="rounded-3xl p-4 sm:p-5">
            <form onSubmit={handleCreatePlaylist} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Input
                  aria-label={t("createPlaylist")}
                  placeholder={t("playlistTitlePlaceholder")}
                  value={newPlaylistTitle}
                  onValueChange={setNewPlaylistTitle}
                />
              </div>
              <Button
                type="submit"
                variant="filled"
                disabled={creating}
                icon={<PlusIcon size={18} aria-hidden="true" />}
              >
                {t("create")}
              </Button>
            </form>
          </Glass>

          {playlists.length === 0 ? (
            <Glass className="rounded-3xl p-12 text-center space-y-3 opacity-80">
              <PlaylistIcon size={44} weight="duotone" className="mx-auto text-[var(--sf-muted)]" aria-hidden="true" />
              <p className="text-base font-bold">{t("emptyLibrary")}</p>
            </Glass>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="group sf-content-card rounded-3xl p-4 flex items-center justify-between gap-3 transition-all duration-300 hover:shadow-xl hover:scale-[1.01]"
                >
                  <Link href={getPlaylistDetailHref(pl.id)} className="flex items-center gap-4 min-w-0 flex-1">
                    <PlaylistMosaic coverUrls={pl.coverUrls} className="h-20 w-20 rounded-2xl shadow-md" lazy />
                    <div className="min-w-0">
                      <h2 className="font-extrabold text-base truncate group-hover:text-indigo-500 transition-colors">
                        {pickText(pl.title, pl.titleFa)}
                      </h2>
                      <p className="text-xs opacity-75">
                        {formatNum(pl.trackCount)} {t("tracksCount")}
                      </p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleDeletePlaylist(pl.id)}
                    aria-label={`${t("deletePlaylist")}: ${pickText(pl.title, pl.titleFa)}`}
                    className="inline-flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-rose-500 hover:bg-rose-500/15 cursor-pointer shrink-0 transition-colors"
                  >
                    <TrashIcon size={17} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTracks.length === 0 ? (
        <Glass className="rounded-3xl p-12 text-center space-y-3 opacity-80">
          <HeartIcon size={44} weight="duotone" className="mx-auto text-[var(--sf-muted)]" aria-hidden="true" />
          <p className="text-base font-bold">{t("emptyLibrary")}</p>
        </Glass>
      ) : (
        <VirtualizedTrackGrid
          tracks={activeTracks}
          queue={activeTracks}
          playlists={playlists}
          onTrackUpdated={handleTrackUpdated}
        />
      )}

      {/* Apple-style floating toast alert for device storage export */}
      {exportToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center gap-2.5 text-xs sm:text-sm font-bold sf-fade-up ${
            exportToast.type === "success"
              ? "bg-emerald-500/90 text-white border-emerald-400/40"
              : "bg-rose-500/90 text-white border-rose-400/40"
          }`}
        >
          {exportToast.type === "success" ? (
            <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
          ) : (
            <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
          )}
          <span>{exportToast.message}</span>
        </div>
      )}
      {/* Direct Remove Download Confirmation Dialog */}
      {trackPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-remove-download-title"
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md"
          onClick={() => setTrackPendingDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sf-sheet-up w-full max-w-sm sm:max-w-md bg-white/98 dark:bg-[#14161f]/98 text-[var(--sf-text)] rounded-t-[28px] sm:rounded-3xl p-5 sm:p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.45)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 space-y-4"
          >
            <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/25 mx-auto -mt-1 sm:hidden" />
            <div className="text-center space-y-2 pt-1">
              <div className="h-12 w-12 rounded-2xl bg-rose-500/15 text-rose-500 mx-auto flex items-center justify-center ring-1 ring-rose-500/25">
                <TrashIcon size={24} weight="bold" aria-hidden="true" />
              </div>
              <h3 id="confirm-remove-download-title" className="text-base font-bold text-[var(--sf-text)]">
                {pickText("Remove Downloaded Track?", "حذف آهنگ از دانلودهای برنامه؟")}
              </h3>
              <p className="text-xs text-[var(--sf-muted)] leading-relaxed px-2">
                {pickText(
                  `"${trackPendingDelete.title}" will be removed from Soundify offline list. Your exported copy in Music/Soundify remains safe.`,
                  `آهنگ «${pickText(trackPendingDelete.title, trackPendingDelete.titleFa)}» از لیست دانلودهای داخل برنامه حذف می‌شود.`,
                )}
              </p>
            </div>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  const idToRemove = trackPendingDelete.id;
                  setTrackPendingDelete(null);
                  await batchDeleteTracks([idToRemove]);
                }}
                className="sf-press w-full min-h-[48px] rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm cursor-pointer shadow-sm"
              >
                {pickText("Yes, Remove", "بله، حذف شود")}
              </button>
              <button
                type="button"
                onClick={() => setTrackPendingDelete(null)}
                className="sf-press w-full min-h-[48px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm cursor-pointer border border-black/[0.08] dark:border-white/10"
              >
                {pickText("Cancel", "لغو")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

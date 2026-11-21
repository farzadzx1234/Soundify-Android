"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowCircleDownIcon,
  ArrowLineDownIcon,
  BooksIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  CircleNotchIcon,
  DotsThreeVerticalIcon,
  HeartIcon,
  HardDriveIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  MicrophoneStageIcon,
  PlayIcon,
  PlaylistIcon,
  PlusIcon,
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
import { formatDuration } from "@/lib/lrc";
import { Button, Glass, GlassSegmented, Input } from "@/components/GlassControls";
import { DownloadActionSheet } from "@/components/DownloadActionSheet";
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
  const { t, pickText, formatNum } = useI18n();
  const { playTrack, currentTrack, isPlaying, togglePlay } = usePlayer();
  const {
    downloadedTracks,
    totalSizeBytes,
    storageBudgetInfo,
    clearAll,
    batchDeleteTracks,
    clearCache,
  } = useDownloadedTracks();
  const activeDownloads = useActiveDownloads();

  const [tab, setTab] = useState<LibraryTab>(() => (user ? "liked" : "downloaded"));
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [repostedTracks, setRepostedTracks] = useState<Track[]>([]);
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [cacheClearedNotice, setCacheClearedNotice] = useState(false);

  // Downloaded tab local search, view mode, device export & batch selection
  const [downloadSearchQuery, setDownloadSearchQuery] = useState("");
  const [downloadViewMode, setDownloadViewMode] = useState<"list" | "grid">("list");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [exportingTrackId, setExportingTrackId] = useState<string | null>(null);
  const [exportedTrackIds, setExportedTrackIds] = useState<Set<string>>(() => getExportedTrackIds());
  const [exportAllRunning, setExportAllRunning] = useState(false);
  const [exportToast, setExportToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [selectedActionTrack, setSelectedActionTrack] = useState<Track | null>(null);

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

  const handleClearAllDownloads = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    setSelectedTrackIds(new Set());
    setSelectMode(false);
    await clearAll();
  };

  const handleClearCache = () => {
    if (!confirmClearCache) {
      setConfirmClearCache(true);
      setTimeout(() => setConfirmClearCache(false), 4000);
      return;
    }
    setConfirmClearCache(false);
    clearCache();
    setCacheClearedNotice(true);
    setTimeout(() => setCacheClearedNotice(false), 3000);
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

  const handleExportTrack = async (record: (typeof downloadedTracks)[0]) => {
    if (exportingTrackId) return;
    setExportingTrackId(record.trackId);
    try {
      const res = await exportTrackToDeviceStorage(record.track, record.audioBlob);
      if (res.success) {
        setExportedTrackIds((prev) => new Set(prev).add(record.trackId));
        setExportToast({ message: t("saveToDeviceSuccess"), type: "success" });
        setTimeout(() => setExportToast(null), 3500);
      } else {
        setExportToast({ message: res.error || t("saveToDeviceError"), type: "error" });
        setTimeout(() => setExportToast(null), 4000);
      }
    } catch {
      setExportToast({ message: t("saveToDeviceError"), type: "error" });
      setTimeout(() => setExportToast(null), 4000);
    } finally {
      setExportingTrackId(null);
    }
  };

  const handleExportAll = async () => {
    if (exportAllRunning || filteredDownloadedTracks.length === 0) return;
    setExportAllRunning(true);
    let successCount = 0;
    try {
      for (const rec of filteredDownloadedTracks) {
        try {
          const res = await exportTrackToDeviceStorage(rec.track, rec.audioBlob);
          if (res.success) {
            successCount++;
            setExportedTrackIds((prev) => new Set(prev).add(rec.trackId));
          }
        } catch {}
      }
      if (successCount > 0) {
        setExportToast({ message: t("exportAllSuccess"), type: "success" });
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
    let successCount = 0;
    try {
      const targets = filteredDownloadedTracks.filter((r) => selectedTrackIds.has(r.trackId));
      for (const rec of targets) {
        try {
          const res = await exportTrackToDeviceStorage(rec.track, rec.audioBlob);
          if (res.success) {
            successCount++;
            setExportedTrackIds((prev) => new Set(prev).add(rec.trackId));
          }
        } catch {}
      }
      if (successCount > 0) {
        setExportToast({ message: t("exportAllSuccess"), type: "success" });
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
      <div className="mx-auto max-w-7xl space-y-6 sf-fade-up">
      {/* Apple Music Library Header */}
      <Glass className="rounded-3xl p-5 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-md">
                <BooksIcon size={22} weight="bold" aria-hidden="true" />
              </span>
              <span>{t("libraryTitle")}</span>
            </h1>
            <p className="text-xs text-[var(--sf-muted)]">
              {user ? (
                <>
                  {user.displayName} • {formatNum(downloadedTracks.length)} {t("downloadedTracksTab")} • {formatNum(likedTracks.length)} {t("likedTracksTab")} • {formatNum(playlists.length)} {t("playlistsTab")}
                </>
              ) : (
                <>
                  {t("guestAccount")} • {formatNum(downloadedTracks.length)} {t("downloadedTracksTab")} (Offline)
                </>
              )}
            </p>
          </div>

          {/* Quick Play & Shuffle actions for current section */}
          {tab !== "playlists" && !isGuestTabLocked && activeTracks.length > 0 && !selectMode && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="filled"
                onClick={handlePlayAll}
                icon={<PlayIcon size={18} weight="fill" aria-hidden="true" />}
              >
                {t("playNow")}
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

        {/* Apple Segmented Switcher with Downloaded tab */}
        <div className="pt-1">
          <GlassSegmented
            aria-label="Library sections"
            value={tab}
            onValueChange={(v) => {
              setTab(v as LibraryTab);
              setSelectMode(false);
              setSelectedTrackIds(new Set());
            }}
            items={[
              { value: "downloaded", label: `${t("downloadedTracksTab")} (${formatNum(downloadedTracks.length)})` },
              { value: "liked", label: `${t("likedTracksTab")} (${formatNum(likedTracks.length)})` },
              { value: "reposts", label: `${t("repostsTab")} (${formatNum(repostedTracks.length)})` },
              { value: "playlists", label: `${t("playlistsTab")} (${formatNum(playlists.length)})` },
              { value: "history", label: t("historyTab") },
            ]}
          />
        </div>
      </Glass>

      {actionErr && (
        <p role="alert" className="rounded-2xl bg-rose-500/15 border border-rose-500/30 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300">
          {actionErr}
        </p>
      )}

      {/* Guest Lock Banner for Cloud Tabs */}
      {isGuestTabLocked ? (
        <Glass className="rounded-3xl p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto">
          <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-lg">
            <UserCircleIcon size={30} weight="bold" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-black">{t("loginRequired")}</h2>
            <p className="text-xs text-[var(--sf-muted)]">
              {t("guestAccount")} — {t("loginRequired")}
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
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
              onClick={() => setTab("downloaded")}
              icon={<ArrowCircleDownIcon size={18} aria-hidden="true" />}
            >
              {t("downloadedTracksTab")}
            </Button>
          </div>
        </Glass>
      ) : tab === "downloaded" ? (
        /* Downloaded Tracks Section with Storage Quota Meter & Batch Controls */
        <div className="space-y-5">
          {activeDownloads.length > 0 && (
            <Glass className="rounded-3xl p-4 sm:p-5 space-y-3 border border-indigo-500/25 bg-indigo-500/[0.04]">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-sm sm:text-base flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
                  {pickText("Active Downloads", "دانلودهای در حال انجام")} ({formatNum(activeDownloads.length)})
                </span>
              </div>
              <div className="space-y-2.5 divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {activeDownloads.map((dl) => (
                  <div key={dl.trackId} className="pt-2 first:pt-0 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold truncate max-w-[220px] sm:max-w-md">
                        {dl.track ? pickText(dl.track.title, dl.track.titleFa) : dl.trackId}
                      </span>
                      <span className="font-mono tabular-nums font-black text-indigo-500" dir="ltr">
                        {dl.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-black/[0.06] dark:bg-white/[0.08] h-2 rounded-full overflow-hidden p-0.5 border border-black/[0.04] dark:border-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-teal-400 to-emerald-400 transition-all duration-300"
                        style={{ width: `${Math.max(3, dl.progress)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Glass>
          )}

          {/* Enhanced Storage Meter Card */}
          <Glass className="rounded-3xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0 border border-emerald-500/20 shadow-sm">
                  <HardDriveIcon size={22} weight="bold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm sm:text-base">{t("storageMeter")}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
                      <span>{t("offlineMode")}</span>
                    </span>
                  </div>
                  <p className="text-xs text-[var(--sf-muted)] truncate mt-0.5">
                    {formatStorageSize(storageBudgetInfo.usageBytes, t, formatNum)} {t("storageUsedOf")} {formatStorageSize(storageBudgetInfo.maxStorageBytes, t, formatNum)} ({formatNum(storageBudgetInfo.usagePercent)}%) • {formatNum(downloadedTracks.length)} / {formatNum(storageBudgetInfo.maxTracks)} {t("tracksCount")}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--sf-muted)] mt-1">
                    <span>{t("downloadedSongsSize")}: <strong className="text-[var(--sf-text)] font-semibold">{formatStorageSize(storageBudgetInfo.songsBytes, t, formatNum)}</strong></span>
                    <span>•</span>
                    <span>{t("cacheSize")}: <strong className="text-[var(--sf-muted)] font-semibold">{formatStorageSize(storageBudgetInfo.cacheBytes, t, formatNum)}</strong></span>
                  </div>
                </div>
              </div>

              {/* Storage Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant={confirmClearCache ? "filled" : "glass"}
                  destructive={confirmClearCache}
                  onClick={handleClearCache}
                  className="text-xs font-semibold"
                  title={t("clearOfflineCacheDesc")}
                >
                  {confirmClearCache
                    ? t("confirmClearCache")
                    : cacheClearedNotice
                      ? t("clearOfflineCacheDone")
                      : t("clearOfflineCacheTitle")}
                </Button>
                {downloadedTracks.length > 0 && (
                  <Button
                    type="button"
                    variant={confirmClear ? "filled" : "ghost"}
                    destructive={confirmClear}
                    onClick={() => void handleClearAllDownloads()}
                    icon={<TrashIcon size={16} aria-hidden="true" />}
                    className="text-xs shrink-0"
                  >
                    {confirmClear ? t("confirmClearDownloads") : t("clearAllDownloads")}
                  </Button>
                )}
              </div>
            </div>

            {/* Apple-style Gradient Usage Progress Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="w-full bg-black/[0.06] dark:bg-white/[0.08] h-3 rounded-full overflow-hidden p-0.5 border border-black/[0.04] dark:border-white/[0.06]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    storageBudgetInfo.usagePercent > 90
                      ? "bg-gradient-to-r from-amber-500 via-rose-500 to-red-500"
                      : "bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(totalSizeBytes > 0 ? 3 : 0, storageBudgetInfo.usagePercent))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-[var(--sf-muted)] px-1 font-mono tabular-nums">
                <span>0 MB</span>
                <span>{formatStorageSize(storageBudgetInfo.maxStorageBytes, t, formatNum)}</span>
              </div>
            </div>
          </Glass>

          {/* Search Filter, View Toggle, Export All & Multi-Select Batch Actions Bar */}
          {downloadedTracks.length > 0 && (
            <Glass className="rounded-3xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Input
                  aria-label={t("searchDownloadedPlaceholder")}
                  placeholder={t("searchDownloadedPlaceholder")}
                  value={downloadSearchQuery}
                  onValueChange={setDownloadSearchQuery}
                  icon={<MagnifyingGlassIcon size={16} aria-hidden="true" />}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 self-end md:self-auto shrink-0">
                {/* Export All to Device Storage Button */}
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
                    className="text-xs font-semibold"
                    title={t("exportAllToDevice")}
                  >
                    <span>{exportAllRunning ? t("exportingToDevice") : t("exportAllToDevice")}</span>
                  </Button>
                )}

                {/* View Mode Toggle (List / Grid) */}
                {!selectMode && (
                  <div className="inline-flex rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] p-1 border border-black/[0.04] dark:border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setDownloadViewMode("list")}
                      aria-label={t("viewModeList")}
                      title={t("viewModeList")}
                      className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                        downloadViewMode === "list"
                          ? "bg-white dark:bg-white/20 text-indigo-500 shadow-sm"
                          : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                      }`}
                    >
                      <ListDashesIcon size={16} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDownloadViewMode("grid")}
                      aria-label={t("viewModeGrid")}
                      title={t("viewModeGrid")}
                      className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                        downloadViewMode === "grid"
                          ? "bg-white dark:bg-white/20 text-indigo-500 shadow-sm"
                          : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                      }`}
                    >
                      <SquaresFourIcon size={16} weight="bold" />
                    </button>
                  </div>
                )}

                <Button
                  type="button"
                  variant={selectMode ? "filled" : "glass"}
                  onClick={() => {
                    setSelectMode(!selectMode);
                    setSelectedTrackIds(new Set());
                    setConfirmDeleteSelected(false);
                  }}
                  className="text-xs font-semibold"
                >
                  {selectMode ? t("cancelSelect") : t("selectMode")}
                </Button>

                {selectMode && (
                  <>
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
                      className="text-xs"
                    >
                      {t("selectAll")}
                    </Button>

                    {selectedTrackIds.size > 0 && (
                      <>
                        <Button
                          type="button"
                          variant="glass"
                          onClick={() => void handleExportSelected()}
                          disabled={exportAllRunning}
                          icon={
                            exportAllRunning ? (
                              <CircleNotchIcon size={15} className="animate-spin text-indigo-500" />
                            ) : (
                              <ArrowLineDownIcon size={15} weight="bold" />
                            )
                          }
                          className="text-xs font-semibold"
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
                          icon={<TrashIcon size={15} aria-hidden="true" />}
                          className="text-xs"
                        >
                          {confirmDeleteSelected
                            ? t("deleteSelectedConfirm")
                            : `${t("deleteSelected")} (${formatNum(selectedTrackIds.size)})`}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>
            </Glass>
          )}

          {downloadedTracks.length === 0 ? (
            <Glass className="rounded-3xl p-12 text-center space-y-4 max-w-xl mx-auto">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-3xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <ArrowCircleDownIcon size={36} weight="duotone" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold">{t("downloadedTracksTab")}</h2>
                <p className="text-xs text-[var(--sf-muted)] max-w-sm mx-auto leading-relaxed">
                  {t("noDownloadedTracks")}
                </p>
              </div>
            </Glass>
          ) : filteredDownloadedTracks.length === 0 ? (
            <Glass className="rounded-3xl p-8 text-center space-y-2 max-w-md mx-auto">
              <p className="text-sm font-semibold">{t("noOfflineMatch")}</p>
            </Glass>
          ) : selectMode ? (
            /* Multi-select Batch Management Table / List */
            <div className="space-y-2">
              <div className="rounded-3xl sf-content-card border border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
                {filteredDownloadedTracks.map((record) => {
                  const isChecked = selectedTrackIds.has(record.trackId);
                  const trackTitle = pickText(record.track.title, record.track.titleFa);
                  const artistTitle = pickText(record.track.artistName, record.track.artistNameFa);
                  const isExporting = exportingTrackId === record.trackId;
                  const isExported = exportedTrackIds.has(record.trackId);
                  const hasLyrics = Boolean(record.lyrics?.lines && record.lyrics.lines.length > 0);

                  return (
                    <div
                      key={record.trackId}
                      onClick={() => handleToggleSelectTrack(record.trackId)}
                      className={`flex items-center justify-between gap-3 p-3.5 sm:px-5 cursor-pointer transition-colors ${
                        isChecked
                          ? "bg-indigo-500/10 dark:bg-indigo-500/15"
                          : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
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

                        <div className="h-11 w-11 rounded-xl overflow-hidden bg-slate-800 shrink-0">
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
                        <span className="text-xs font-mono tabular-nums text-[var(--sf-muted)] hidden sm:inline">
                          {formatStorageSize(record.sizeBytes || 0, t, formatNum)}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleExportTrack(record);
                          }}
                          disabled={isExporting}
                          aria-label={t("saveToDevice")}
                          title={t("saveToDeviceLong")}
                          className="h-10 w-10 min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-indigo-500 hover:bg-indigo-500/15 active:scale-95 transition-all cursor-pointer"
                        >
                          {isExporting ? (
                            <CircleNotchIcon size={16} className="animate-spin text-indigo-500" />
                          ) : isExported ? (
                            <CheckIcon size={16} weight="bold" className="text-emerald-500" />
                          ) : (
                            <ArrowLineDownIcon size={16} weight="bold" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await batchDeleteTracks([record.trackId]);
                          }}
                          aria-label={t("removeFromDownloads")}
                          title={t("removeFromDownloads")}
                          className="h-10 w-10 min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-500/15 active:scale-95 transition-colors cursor-pointer"
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : downloadViewMode === "list" ? (
            /* Apple Music / iOS 18 Sleek Row List View for Downloaded Music */
            <div className="space-y-2">
              <div className="rounded-3xl sf-content-card border border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
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
                      className={`group flex items-center justify-between gap-3 px-3.5 sm:px-4 py-2.5 sm:py-3 transition-colors cursor-pointer select-none active:scale-[0.99] ${
                        isCurrent
                          ? "bg-indigo-500/[0.08] dark:bg-indigo-500/[0.12]"
                          : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
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
                            {isPlaying ? (
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
                          <span className="shrink-0 font-mono tabular-nums">
                            {formatDuration(record.track.durationSec || 0)}
                          </span>
                          <span className="shrink-0 opacity-60">•</span>
                          <span className="shrink-0 font-mono tabular-nums">
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

                      {/* Trailing: Single Apple 3-Dots Action Button (Opens ActionSheet) */}
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedActionTrack(record.track);
                          }}
                          aria-label={`Options for ${trackTitle}`}
                          className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-[var(--sf-muted)] hover:text-[var(--sf-text)] hover:bg-black/[0.05] dark:hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer"
                        >
                          <DotsThreeVerticalIcon size={20} weight="bold" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <VirtualizedTrackGrid
              tracks={filteredDownloadedTrackObjects}
              queue={filteredDownloadedTrackObjects}
              playlists={playlists}
              onTrackUpdated={handleTrackUpdated}
            />
          )}
        </div>
      ) : tab === "playlists" ? (
        /* Playlists Section */
        <div className="space-y-6">
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
      {/* Apple HIG Download Action Sheet */}
      {selectedActionTrack && (
        <DownloadActionSheet
          track={selectedActionTrack}
          isOpen={Boolean(selectedActionTrack)}
          onClose={() => setSelectedActionTrack(null)}
          onRemove={async () => {
            const trackId = selectedActionTrack.id;
            setSelectedActionTrack(null);
            await batchDeleteTracks([trackId]);
          }}
          onPlayOffline={() => {
            const t = selectedActionTrack;
            setSelectedActionTrack(null);
            handlePlayDownloadedTrack(t);
          }}
        />
      )}
    </div>
    </PullToRefresh>
  );
}

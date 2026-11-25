"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownIcon,
  BookmarkSimpleIcon,
  CheckIcon,
  CircleNotchIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
  SoundcloudLogoIcon,
  SpotifyLogoIcon,
  WarningCircleIcon,
  XIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { api, ApiError, getPlaylistDetailHref } from "@/lib/api";
import { detectPlaylistLink } from "@/lib/externalPlaylist";
import { createCustomPlaylist, linkCloudPlaylistToCustom } from "@/lib/customPlaylists";
import {
  batchDownloadTracks,
  resolveDownloadedTrackId,
  useActiveDownloads,
  useDownloadedTracks,
} from "@/lib/downloadManager";
import { filterSensitiveTracks } from "@/lib/contentFilter";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { formatDuration } from "@/lib/lrc";
import { isPlaylistContextPlaying } from "@/lib/trackIdentity";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass, Input } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { ExternalTrackCard } from "@/components/ExternalTrackCard";
import type { ExternalPlaylistMetadata, Playlist, Track } from "@/lib/types";

interface ExternalPlaylistImporterProps {
  /** Optional external URL pushed automatically (e.g. when pasted into Search input). */
  externalUrl?: string;
  /** Hide the standalone link form when the parent Search input already supplies the URL. */
  hideUrlInput?: boolean;
  onRequestAuth?: () => void;
  onRequestGlobalAccess?: () => void;
  onPlaylistSaved?: (result: { localId: string; cloudId?: string; playlist: Playlist }) => void;
  onClear?: () => void;
}

export function ExternalPlaylistImporter({
  externalUrl,
  hideUrlInput = false,
  onRequestAuth,
  onRequestGlobalAccess,
  onPlaylistSaved,
  onClear,
}: ExternalPlaylistImporterProps) {
  const { user, openAuthDialog } = useAuth();
  const { pickText, formatNum, t } = useI18n();
  const { currentTrack, isPlaying, playbackContextId, playTrack, togglePlay } = usePlayer();
  const { downloadedTracks } = useDownloadedTracks();
  const activeDownloads = useActiveDownloads();

  const [urlInput, setUrlInput] = useState(externalUrl || "");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadedPlaylist, setLoadedPlaylist] = useState<ExternalPlaylistMetadata | null>(null);
  const [loadedTracks, setLoadedTracks] = useState<Track[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedLocalId, setSavedLocalId] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const lastAutoLoadedRef = useRef("");

  const loadPlaylistUrl = async (rawUrl: string, forceRefresh = false) => {
    const clean = rawUrl.trim();
    if (!clean) return;
    if (!detectPlaylistLink(clean)) {
      setErrorMsg(
        pickText(
          "Please paste a valid YouTube, Spotify, or SoundCloud playlist URL.",
          "لطفاً لینک معتبر پلی‌لیست یوتیوب، اسپاتیفای یا ساندکلود را وارد کنید.",
        ),
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSavedLocalId(null);
    setSaveFeedback(null);

    try {
      const res = await api.fetchExternalPlaylist(clean, { limit: 80, forceRefresh });
      const safeTracks = filterSensitiveTracks(res.tracks || []);
      setLoadedPlaylist(res.playlist);
      setLoadedTracks(safeTracks);
      if (safeTracks.length === 0) {
        setErrorMsg(
          pickText(
            "No playable tracks were found in this playlist.",
            "آهنگ قابل پخشی در این پلی‌لیست پیدا نشد.",
          ),
        );
      }
    } catch (err: unknown) {
      if (
        (err instanceof ApiError && (err.status === 403 || err.code === "GLOBAL_SEARCH_ACCESS_REQUIRED")) ||
        String(err).includes("GLOBAL_SEARCH_ACCESS_REQUIRED")
      ) {
        if (!user) {
          (onRequestAuth ?? openAuthDialog)();
        } else {
          onRequestGlobalAccess?.();
        }
        setErrorMsg(
          pickText(
            "Global music access is required to load external playlists.",
            "برای بارگذاری پلی‌لیست‌های خارجی نیاز به دسترسی پخش جهانی دارید.",
          ),
        );
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : pickText("Failed to load playlist.", "دریافت اطلاعات پلی‌لیست با خطا مواجه شد."),
        );
      }
      setLoadedPlaylist(null);
      setLoadedTracks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const clean = (externalUrl || "").trim();
    if (!clean || clean === lastAutoLoadedRef.current || !detectPlaylistLink(clean)) return;
    lastAutoLoadedRef.current = clean;
    const timer = setTimeout(() => {
      setUrlInput(clean);
      void loadPlaylistUrl(clean);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lastAutoLoadedRef.current = urlInput.trim();
    void loadPlaylistUrl(urlInput);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setUrlInput(text.trim());
        if (detectPlaylistLink(text.trim())) {
          lastAutoLoadedRef.current = text.trim();
          void loadPlaylistUrl(text.trim());
        }
      }
    } catch {
      // Clipboard API unavailable in context
    }
  };

  const playlistContextId = loadedPlaylist ? `extpl:${loadedPlaylist.id}` : "";
  const isPlaylistPlaying = isPlaylistContextPlaying({
    isPlaying,
    currentTrack,
    playbackContextId,
    playlistId: playlistContextId || "__none__",
    tracks: loadedTracks,
  });

  const downloadedCount = useMemo(() => {
    if (loadedTracks.length === 0) return 0;
    let count = 0;
    for (const tr of loadedTracks) {
      if (resolveDownloadedTrackId(tr) || downloadedTracks.some((d) => d.trackId === tr.id)) {
        count += 1;
      }
    }
    return count;
  }, [downloadedTracks, loadedTracks]);

  const activePlaylistDownloadCount = useMemo(() => {
    if (loadedTracks.length === 0 || activeDownloads.length === 0) return 0;
    const ids = new Set(loadedTracks.map((t) => t.id));
    return activeDownloads.filter((d) => ids.has(d.trackId)).length;
  }, [activeDownloads, loadedTracks]);

  const totalDurationSec = useMemo(
    () => loadedTracks.reduce((acc, tr) => acc + (tr.durationSec || 0), 0),
    [loadedTracks],
  );

  const handlePlayAll = () => {
    if (loadedTracks.length === 0) return;
    void triggerHapticFeedback("playPause");
    if (isPlaylistPlaying) {
      togglePlay();
      return;
    }
    playTrack(loadedTracks[0], loadedTracks, 0, true, playlistContextId);
  };

  const handleShuffle = () => {
    if (loadedTracks.length === 0) return;
    void triggerHapticFeedback("selection");
    const shuffled = [...loadedTracks].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled, 0, true, playlistContextId);
  };

  const handleDownloadAll = async () => {
    if (loadedTracks.length === 0 || batchDownloading) return;
    void triggerHapticFeedback("selection");
    setBatchDownloading(true);
    try {
      await batchDownloadTracks(loadedTracks);
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleSaveFullPlaylist = async () => {
    if (!loadedPlaylist || loadedTracks.length === 0 || saving || savedLocalId) return;
    void triggerHapticFeedback("selection");
    setSaving(true);
    setSaveFeedback(null);

    try {
      const localRecord = createCustomPlaylist({
        title: loadedPlaylist.title,
        description: loadedPlaylist.descriptionFa || loadedPlaylist.description,
        accentColor: loadedPlaylist.accentColor,
        sourceUrl: loadedPlaylist.sourceUrl,
        initialTracks: loadedTracks,
      });
      setSavedLocalId(localRecord.id);

      let cloudId: string | undefined;
      if (user) {
        try {
          const cloudRes = await api.importExternalPlaylist({
            title: loadedPlaylist.title,
            titleFa: loadedPlaylist.titleFa,
            description: loadedPlaylist.description,
            descriptionFa: loadedPlaylist.descriptionFa,
            accentColor: loadedPlaylist.accentColor,
            sourceUrl: loadedPlaylist.sourceUrl,
            tracks: loadedTracks,
          });
          if (cloudRes?.playlist?.id) {
            cloudId = cloudRes.playlist.id;
            linkCloudPlaylistToCustom(localRecord.id, cloudId);
          }
        } catch {
          // Local offline custom playlist already succeeded cleanly
        }
      }

      setSaveFeedback(
        pickText(
          "Playlist added to Library!",
          "پلی‌لیست کامل به بخش پلی‌لیست‌های شما اضافه شد!",
        ),
      );
      onPlaylistSaved?.({
        localId: localRecord.id,
        cloudId,
        playlist: {
          id: localRecord.id,
          title: localRecord.title,
          titleFa: localRecord.titleFa,
          description: localRecord.description,
          descriptionFa: localRecord.descriptionFa,
          accentColor: localRecord.accentColor,
          isFeatured: false,
          trackCount: loadedTracks.length,
          coverUrls: loadedPlaylist.coverUrls,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const sourceBadge =
    loadedPlaylist?.source === "youtube"
      ? {
          label: pickText("YouTube", "یوتیوب"),
          icon: <YoutubeLogoIcon size={14} weight="fill" className="text-red-500" aria-hidden="true" />,
          cls: "bg-red-500/12 text-red-500 border-red-500/25",
        }
      : loadedPlaylist?.source === "soundcloud"
        ? {
            label: pickText("SoundCloud", "ساندکلود"),
            icon: <SoundcloudLogoIcon size={14} weight="fill" className="text-orange-500" aria-hidden="true" />,
            cls: "bg-orange-500/12 text-orange-500 border-orange-500/25",
          }
        : {
            label: pickText("Spotify", "اسپاتیفای"),
            icon: <SpotifyLogoIcon size={14} weight="fill" className="text-emerald-500" aria-hidden="true" />,
            cls: "bg-emerald-500/12 text-emerald-500 border-emerald-500/25",
          };

  return (
    <div className="space-y-4">
      {!hideUrlInput && (
        <Glass className="rounded-3xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                <LinkIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-[var(--sf-text)]">
                  {pickText("Load Playlist by Link", "بارگذاری پلی‌لیست با لینک")}
                </h3>
                <p className="text-[11px] text-[var(--sf-muted)]">
                  {pickText(
                    "Paste a YouTube, Spotify, or SoundCloud playlist URL to play, download, or save",
                    "لینک پلی‌لیست یوتیوب، اسپاتیفای یا ساندکلود را وارد کنید تا دقیقاً با تمام ترک‌ها باز شود",
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] font-bold">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-red-500/10 text-red-500">
                <YoutubeLogoIcon size={12} weight="fill" aria-hidden="true" /> YouTube
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-emerald-500/10 text-emerald-500">
                <SpotifyLogoIcon size={12} weight="fill" aria-hidden="true" /> Spotify
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-orange-500/10 text-orange-500">
                <SoundcloudLogoIcon size={12} weight="fill" aria-hidden="true" /> SoundCloud
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex-1 min-w-0">
              <Input
                type="url"
                dir="ltr"
                aria-label={pickText("Playlist URL", "لینک پلی‌لیست")}
                placeholder="https://open.spotify.com/playlist/... | youtube.com/playlist?list=... | soundcloud.com/.../sets/..."
                value={urlInput}
                onValueChange={setUrlInput}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="glass"
                onClick={() => void handlePasteClipboard()}
                className="!min-h-[42px] !px-3.5 text-xs font-bold"
              >
                {pickText("Paste", "چسباندن")}
              </Button>
              <Button
                type="submit"
                variant="filled"
                disabled={loading || !urlInput.trim()}
                icon={
                  loading ? (
                    <CircleNotchIcon size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <PlaylistIcon size={16} weight="bold" aria-hidden="true" />
                  )
                }
                className="!min-h-[42px] !px-5 text-xs font-bold"
              >
                {loading
                  ? pickText("Loading...", "در حال دریافت...")
                  : pickText("Load Playlist", "بارگذاری پلی‌لیست")}
              </Button>
            </div>
          </form>
        </Glass>
      )}

      {loading && (
        <Glass className="rounded-3xl p-6 text-center space-y-3">
          <CircleNotchIcon size={28} className="mx-auto animate-spin text-emerald-500" aria-hidden="true" />
          <p className="text-xs sm:text-sm font-bold text-[var(--sf-text)]">
            {pickText("Extracting playlist tracks...", "در حال استخراج اطلاعات و آهنگ‌های پلی‌لیست...")}
          </p>
        </Glass>
      )}

      {errorMsg && !loading && (
        <Glass className="rounded-2xl p-4 border border-rose-500/30 bg-rose-500/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <WarningCircleIcon size={20} weight="fill" className="text-rose-500 shrink-0" aria-hidden="true" />
            <p className="text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-300">{errorMsg}</p>
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t("close")}
              className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 shrink-0 cursor-pointer"
            >
              <XIcon size={15} aria-hidden="true" />
            </button>
          )}
        </Glass>
      )}

      {loadedPlaylist && loadedTracks.length > 0 && !loading && (
        <div className="space-y-4">
          {/* Curated External Playlist Header */}
          <Glass className="rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-5">
              <PlaylistMosaic
                coverUrls={loadedPlaylist.coverUrls}
                tracks={loadedTracks}
                className="h-32 w-32 sm:h-36 sm:w-36 rounded-2xl shadow-lg shrink-0"
              />
              <div className="flex-1 min-w-0 text-center sm:text-start space-y-1.5">
                <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${sourceBadge.cls}`}
                  >
                    {sourceBadge.icon}
                    <span>{sourceBadge.label}</span>
                  </span>
                  <span className="text-xs font-semibold text-[var(--sf-muted)]">
                    {formatNum(loadedTracks.length)} {t("tracksCount")}
                    {totalDurationSec > 0 ? ` • ${formatDuration(totalDurationSec)}` : ""}
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-black text-[var(--sf-text)] line-clamp-2">
                  {pickText(loadedPlaylist.title, loadedPlaylist.titleFa)}
                </h2>

                {loadedPlaylist.creator && (
                  <p className="text-xs sm:text-sm text-[var(--sf-muted)] font-medium truncate">
                    {loadedPlaylist.creator}
                  </p>
                )}
              </div>
            </div>

            {/* Play / Shuffle / Batch Download / Full Playlist Save Controls */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                type="button"
                variant="filled"
                onClick={handlePlayAll}
                icon={
                  isPlaylistPlaying ? (
                    <PauseIcon size={17} weight="fill" aria-hidden="true" />
                  ) : (
                    <PlayIcon size={17} weight="fill" aria-hidden="true" />
                  )
                }
                className="!min-h-[42px] !px-5 text-xs font-bold"
              >
                {isPlaylistPlaying
                  ? t("pause")
                  : pickText("Play Playlist", "پخش کامل")}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={handleShuffle}
                icon={<ShuffleIcon size={16} weight="bold" aria-hidden="true" />}
                className="!min-h-[42px] !px-4 text-xs font-bold"
              >
                {t("shuffle")}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={() => void handleDownloadAll()}
                disabled={batchDownloading && activePlaylistDownloadCount > 0}
                icon={
                  activePlaylistDownloadCount > 0 ? (
                    <CircleNotchIcon size={16} className="animate-spin text-emerald-500" aria-hidden="true" />
                  ) : downloadedCount === loadedTracks.length ? (
                    <CheckIcon size={16} weight="bold" className="text-emerald-500" aria-hidden="true" />
                  ) : (
                    <ArrowDownIcon size={16} weight="bold" className="text-indigo-500" aria-hidden="true" />
                  )
                }
                className="!min-h-[42px] !px-4 text-xs font-bold"
              >
                {downloadedCount === loadedTracks.length
                  ? pickText("All Downloaded", "همه دانلود شدند")
                  : activePlaylistDownloadCount > 0
                    ? pickText(
                        `Downloading (${downloadedCount}/${loadedTracks.length})`,
                        `در حال دانلود (${formatNum(downloadedCount)}/${formatNum(loadedTracks.length)})`,
                      )
                    : pickText("Download All", "دانلود همه ترک‌ها")}
              </Button>

              {savedLocalId ? (
                <Link
                  href={getPlaylistDetailHref(savedLocalId)}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-colors hover:bg-emerald-500/25"
                >
                  <CheckIcon size={16} weight="bold" aria-hidden="true" />
                  <span>{pickText("Saved • Open Playlist", "ذخیره شد • مشاهده پلی‌لیست")}</span>
                </Link>
              ) : (
                <Button
                  type="button"
                  variant="glass"
                  disabled={saving}
                  onClick={() => void handleSaveFullPlaylist()}
                  icon={
                    saving ? (
                      <CircleNotchIcon size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <BookmarkSimpleIcon size={16} weight="bold" className="text-amber-500" aria-hidden="true" />
                    )
                  }
                  className="!min-h-[42px] !px-4 text-xs font-bold"
                >
                  {pickText("Save Full Playlist", "افزودن کامل به پلی‌لیست‌ها")}
                </Button>
              )}
            </div>

            {saveFeedback && (
              <p role="status" className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {saveFeedback}
              </p>
            )}
          </Glass>

          {/* Individual Track List (Play, Download, Like, Add to Single Playlist) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {loadedTracks.map((tr) => (
              <ExternalTrackCard
                key={tr.id}
                track={tr}
                queue={loadedTracks}
                autoExpand={true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

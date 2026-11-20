"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowsClockwiseIcon,
  BroadcastIcon,
  ChatCircleTextIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  HeartIcon,
  MusicNotesSimpleIcon,
  PauseIcon,
  PlayIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import {
  api,
  externalTracksCache,
  getCachedCatalogTracks,
  getTrackShareUrl,
  isExternalTrack,
  synthesizeExternalTrack,
} from "@/lib/api";
import { FALLBACK_TRACKS } from "@/lib/fallbackSeedData";
import { formatDuration } from "@/lib/lrc";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer, usePlayerProgress } from "@/context/PlayerContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { Button, Glass, Input } from "@/components/GlassControls";
import { LyricsPanel } from "@/components/LyricsPanel";
import { WaveformScrubber } from "@/components/WaveformScrubber";
import type { LyricLine, Track, TrackComment } from "@/lib/types";

function TrackDetailWaveform({
  track,
  isCurrent,
  comments,
  onPlayTrack,
  onSeek,
}: {
  track: Track;
  isCurrent: boolean;
  comments: TrackComment[];
  onPlayTrack: (track: Track) => void;
  onSeek: (sec: number) => void;
}) {
  const { currentTime } = usePlayerProgress();
  return (
    <WaveformScrubber
      peaks={track.waveform}
      durationSec={track.durationSec}
      currentTimeSec={isCurrent ? currentTime : 0}
      accentColor={track.accentColor}
      comments={comments}
      onSeek={(sec) => {
        if (!isCurrent) onPlayTrack(track);
        onSeek(sec);
      }}
    />
  );
}

export default function TrackClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const queryId = searchParams.get("id");
  const id =
    queryId && queryId.trim()
      ? queryId.trim()
      : params?.id && params.id !== "default"
        ? params.id
        : "";

  const { user, openAuthDialog } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { currentTrack, isPlaying, getCurrentTime, playTrack, seek, updateTrackInQueue } = usePlayer();
  const { setDevicePickerOpen, isRemotePlaybackActive, localizedActiveDeviceName } = useDeviceSync();

  const [track, setTrack] = useState<Track | null>(() => {
    if (!id) return null;
    if (currentTrack?.id === id) return currentTrack;
    return (
      externalTracksCache.get(id) ??
      getCachedCatalogTracks()?.find((item) => item.id === id) ??
      FALLBACK_TRACKS.find((item) => item.id === id) ??
      (isExternalTrack(id) ? synthesizeExternalTrack(id) : null)
    );
  });
  const [comments, setComments] = useState<TrackComment[]>([]);
  const [previewLyrics, setPreviewLyrics] = useState<LyricLine[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [actionErr, setActionErr] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([api.getTrack(id), api.getComments(id), api.getLyrics(id).catch(() => ({ lines: [] as LyricLine[] }))])
      .then(([tRes, cRes, lRes]) => {
        if (!active) return;
        setNotFound(false);
        setTrack(tRes.track);
        setComments(cRes.comments);
        setPreviewLyrics(lRes.lines ?? []);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);

  if (!id || notFound) {
    return (
      <Glass className="mx-auto max-w-2xl rounded-3xl p-12 text-center space-y-3">
        <h1 className="text-xl font-bold">{t("trackNotFound")}</h1>
        <p className="text-sm opacity-70">
          {lang === "fa"
            ? "این آهنگ در دسترس نیست یا حذف شده است."
            : "This track is unavailable or has been removed."}
        </p>
        <Link href="/" className="inline-block rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">
          {t("navHome")}
        </Link>
      </Glass>
    );
  }

  if (!track) {
    return <div className="mx-auto max-w-6xl h-96 rounded-3xl sf-content-card animate-pulse" />;
  }

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const title = pickText(track.title, track.titleFa);
  const artist = pickText(track.artistName, track.artistNameFa);

  const handleLike = async () => {
    if (!user) return openAuthDialog();
    setActionErr("");
    try {
      const res = await api.toggleLike(track.id);
      const next = { ...track, likedByMe: res.liked, likesCount: res.likesCount };
      setTrack(next);
      updateTrackInQueue(next);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const handleRepost = async () => {
    if (!user) return openAuthDialog();
    setActionErr("");
    try {
      const res = await api.toggleRepost(track.id);
      const next = { ...track, repostedByMe: res.reposted, repostsCount: res.repostsCount };
      setTrack(next);
      updateTrackInQueue(next);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return openAuthDialog();
    if (!commentBody.trim()) return;
    setPosting(true);
    setActionErr("");
    try {
      const ts = isCurrent ? Math.round(getCurrentTime()) : 0;
      const res = await api.addComment(track.id, commentBody.trim(), ts);
      setComments((prev) => [...prev, res.comment].sort((a, b) => a.timestampSec - b.timestampSec));
      setCommentBody("");
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 sf-fade-up">
      {actionErr && (
        <p role="alert" className="rounded-2xl bg-rose-500/15 border border-rose-500/30 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300">
          {actionErr}
        </p>
      )}

      {/* Apple Music Hero Card with Ambient Blur Refraction */}
      <div className="relative overflow-hidden rounded-3xl sf-content-surface p-6 sm:p-10 border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_24px_60px_rgba(0,0,0,0.4)]">
        {/* Ambient blurred glow from artwork (desktop only for Android GPU smoothness) */}
        <img
          src={track.coverUrl}
          alt=""
          aria-hidden="true"
          className="hidden md:block pointer-events-none select-none absolute inset-0 h-full w-full object-cover scale-150 blur-3xl opacity-35 dark:opacity-60"
        />
        <div
          aria-hidden="true"
          className="md:hidden pointer-events-none select-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at 30% 25%, ${track.accentColor || "#6366f1"}3d 0%, transparent 62%)`,
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--sf-bg)]/80 via-transparent to-transparent"
        />

        <div className="relative z-10 flex flex-col md:flex-row gap-6 sm:gap-8 items-center md:items-start">
          <div className="relative group shrink-0">
            <img
              src={track.coverUrl}
              alt={title}
              width={260}
              height={260}
              fetchPriority="high"
              className="h-56 w-56 sm:h-64 sm:w-64 rounded-3xl object-cover shadow-[0_16px_40px_rgba(0,0,0,0.5)] border border-white/20"
            />
          </div>

          <div className="flex-1 min-w-0 w-full space-y-4 text-center md:text-start">
            {/* Metadata Badges */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
              <span className="rounded-full bg-black/[0.08] dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/10 px-3 py-0.5 text-xs font-semibold text-[var(--sf-text)]">
                {track.genre}
              </span>
              <span className="rounded-full bg-black/[0.08] dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/10 px-3 py-0.5 text-xs font-semibold text-[var(--sf-text)]">
                {track.mood}
              </span>
              <span className="flex items-center gap-1 text-xs opacity-75 text-[var(--sf-text)]">
                <ClockIcon size={13} aria-hidden="true" />
                <span>{formatDuration(track.durationSec)}</span>
              </span>
              <span className="flex items-center gap-1 text-xs opacity-75 text-[var(--sf-text)]">
                <EyeIcon size={13} aria-hidden="true" />
                <span>{formatNum(track.playsCount)} {t("plays")}</span>
              </span>
            </div>

            <div className="space-y-1">
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">{title}</h1>
              <p className="text-lg sm:text-xl font-medium opacity-85">
                {artist} — <span className="opacity-75">{pickText(track.album, track.albumFa)}</span>
              </p>
            </div>

            {/* Apple Action Buttons */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 pt-2">
              <Button
                type="button"
                variant="filled"
                tint={track.accentColor}
                onClick={() => playTrack(track)}
                icon={isCurrentPlaying ? <PauseIcon size={20} weight="fill" aria-hidden="true" /> : <PlayIcon size={20} weight="fill" aria-hidden="true" />}
              >
                {isCurrentPlaying ? t("pause") : t("playNow")}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={() => void handleLike()}
                icon={<HeartIcon size={18} weight={track.likedByMe ? "fill" : "regular"} className={track.likedByMe ? "text-rose-600 dark:text-rose-400" : ""} aria-hidden="true" />}
              >
                {formatNum(track.likesCount)}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={() => void handleRepost()}
                icon={<ArrowsClockwiseIcon size={18} className={track.repostedByMe ? "text-emerald-600 dark:text-emerald-400" : ""} aria-hidden="true" />}
              >
                {formatNum(track.repostsCount)}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={() => {
                  void navigator.clipboard.writeText(getTrackShareUrl(track.id));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                icon={copied ? <CheckIcon size={18} aria-hidden="true" /> : <ShareNetworkIcon size={18} aria-hidden="true" />}
              >
                {copied ? t("copiedLink") : t("share")}
              </Button>

              <Button
                type="button"
                variant="glass"
                onClick={() => {
                  void triggerHapticFeedback("selection");
                  setDevicePickerOpen(true);
                }}
                aria-label={t("devicesTitle")}
                icon={
                  <BroadcastIcon
                    size={18}
                    weight={isRemotePlaybackActive ? "fill" : "regular"}
                    className={isRemotePlaybackActive ? "text-emerald-400" : ""}
                    aria-hidden="true"
                  />
                }
              >
                {isRemotePlaybackActive ? localizedActiveDeviceName : t("devicesTitle")}
              </Button>
            </div>

            {/* Waveform Scrubber */}
            <div className="pt-2">
              <TrackDetailWaveform
                track={track}
                isCurrent={isCurrent}
                comments={comments}
                onPlayTrack={playTrack}
                onSeek={seek}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Lyrics on Left/Right, Comments on the other */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Apple Music Lyrics Viewer */}
        <div className="lg:col-span-7">
          <Glass className="rounded-3xl p-5 sm:p-7 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <MusicNotesSimpleIcon size={22} weight="duotone" className="text-indigo-500" aria-hidden="true" />
              <span>{t("lyrics")}</span>
              {track.hasLyrics && !isCurrent && (
                <span className="ms-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {track.lyricsSource}
                </span>
              )}
            </h2>
            <div className="min-h-[320px]">
              {isCurrent ? (
                <LyricsPanel showFullScreenButton={false} trackPage />
              ) : previewLyrics.length > 0 ? (
                <div className="sf-lyrics-mask relative max-h-96 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-2 py-6 space-y-3 scroll-smooth">
                  {previewLyrics.map((line, idx) => (
                    <button
                      key={idx}
                      type="button"
                      dir="auto"
                      onClick={() => {
                        playTrack(track);
                        seek(line.timeMs / 1000);
                      }}
                      style={{ textAlign: "center", justifyContent: "center" }}
                      className="group relative w-full text-center rounded-2xl p-2 text-lg sm:text-xl font-bold text-slate-900/40 dark:text-white/40 opacity-70 hover:opacity-100 hover:text-slate-950 dark:hover:text-white hover:scale-[1.01] active:scale-[0.99] origin-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center select-none"
                    >
                      <span className="block w-full text-center leading-snug break-words" dir="auto">
                        {line.text}
                      </span>
                      <span
                        className="absolute end-3 top-1/2 -translate-y-1/2 hidden sm:inline-block opacity-0 group-hover:opacity-40 transition-opacity text-xs font-mono tabular-nums shrink-0 select-none pointer-events-none"
                        dir="ltr"
                      >
                        {formatDuration(line.timeMs / 1000)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center opacity-70 text-sm">
                  {track.hasLyrics ? t("playToViewSyncedLyrics") : t("noLyricsYet")}
                </div>
              )}
            </div>
          </Glass>
        </div>

        {/* Timestamped Comments Styled Like Apple Review Sheets */}
        <div id="comments" className="lg:col-span-5 scroll-mt-20">
          <Glass className="rounded-3xl p-5 sm:p-7 space-y-4 flex flex-col h-full">
            <h2 className="text-xl font-bold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ChatCircleTextIcon size={22} weight="duotone" className="text-indigo-500" aria-hidden="true" />
                <span>{t("commentsTitle")}</span>
              </span>
              <span className="text-xs text-[var(--sf-muted)] font-medium">
                {formatNum(comments.length)}
              </span>
            </h2>

            {/* Post comment input */}
            <form onSubmit={handlePostComment} className="flex gap-2">
              <div className="flex-1">
                <Input
                  aria-label={t("commentPlaceholder")}
                  placeholder={t("commentPlaceholder")}
                  value={commentBody}
                  onValueChange={setCommentBody}
                />
              </div>
              <Button type="submit" variant="filled" disabled={posting}>
                {t("postComment")}
              </Button>
            </form>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto space-y-3 max-h-[460px] pe-1">
              {comments.length === 0 ? (
                <p className="text-xs text-center py-10 opacity-70">
                  {t("firstToComment")}
                </p>
              ) : (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] p-3.5 border border-black/[0.03] dark:border-white/[0.05] transition-colors"
                  >
                    <span
                      className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm"
                      style={{ backgroundColor: c.author?.avatarColor || "#6366F1" }}
                    >
                      {(c.author?.displayName || "U").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold truncate" dir="auto">
                          {c.author?.displayName || "User"}
                        </span>
                        <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                          {formatDuration(c.timestampSec)}
                        </span>
                      </div>
                      <p dir="auto" className="text-xs text-[var(--sf-text)] opacity-90 leading-relaxed break-words">
                        {c.body}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Glass>
        </div>
      </div>
    </div>
  );
}

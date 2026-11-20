"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  FileAudioIcon,
  ImageIcon,
  MagicWandIcon,
  MicrophoneStageIcon,
  PauseIcon,
  PlayIcon,
  TimerIcon,
  UploadSimpleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDuration, formatLrcTimestamp, parseLrc } from "@/lib/lrc";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass, GlassSegmented, Input } from "@/components/GlassControls";
import type { Track } from "@/lib/types";

const MOODS = ["Chill", "Midnight", "Energetic", "Emotional", "Deep", "Focus", "Relax", "Soulful"];

export default function StudioPage() {
  const { user, openAuthDialog } = useAuth();
  const { t, pickText } = useI18n();
  const { currentTrack, isPlaying, getCurrentTime, playTrack, setLyricsLines } = usePlayer();

  const [tab, setTab] = useState<"upload" | "sync">("upload");
  const [tracks, setTracks] = useState<Track[]>([]);

  // Upload state
  const [titleEn, setTitleEn] = useState("");
  const [titleFa, setTitleFa] = useState("");
  const [artistName, setArtistName] = useState("");
  const [album, setAlbum] = useState("Singles");
  const [genre, setGenre] = useState("Persian Fusion");
  const [mood, setMood] = useState("Chill");
  const [accentColor, setAccentColor] = useState("#6366F1");
  const [lrcContent, setLrcContent] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");

  // Tap-to-Sync state
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [plainText, setPlainText] = useState(
    "در شب آرام و شیشه‌ای شهر\nنوری از رویای فردا می‌تابد\nهر ضربان قلب هم‌آواز با موج صداست\nتا سپیده‌دم همراه موسیقی می‌مانیم",
  );
  const [syncedLrc, setSyncedLrc] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncErr, setSyncErr] = useState("");
  const [lrclibTitle, setLrclibTitle] = useState("");
  const [lrclibArtist, setLrclibArtist] = useState("");

  useEffect(() => {
    api
      .getTracks()
      .then((res) => {
        setTracks(res.tracks);
        if (res.tracks.length > 0) {
          setSelectedTrackId((prev) => {
            const nextId = prev || res.tracks[0].id;
            const first = res.tracks.find((item) => item.id === nextId) ?? res.tracks[0];
            setLrclibTitle((curr) => curr || first.title);
            setLrclibArtist((curr) => curr || first.artistName);
            return nextId;
          });
        }
      })
      .catch(() => {});
  }, []);

  const selectedTrack = tracks.find((tr) => tr.id === selectedTrackId) ?? null;
  const isSelectedPlaying = selectedTrack && currentTrack?.id === selectedTrack.id && isPlaying;

  const handleAudioSelected = (file: File | null) => {
    setAudioFile(file);
    setAudioDurationSec(null);
    if (!file || typeof Audio === "undefined") return;
    const objUrl = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = objUrl;
    const cleanup = () => URL.revokeObjectURL(objUrl);
    probe.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setAudioDurationSec(Math.round(probe.duration));
      }
      cleanup();
    });
    probe.addEventListener("error", cleanup);
  };

  const handleCoverSelected = (file: File | null) => {
    setCoverFile(file);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    if (file) {
      setCoverPreviewUrl(URL.createObjectURL(file));
    } else {
      setCoverPreviewUrl(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthDialog();
      return;
    }
    if (!audioFile) {
      setUploadErr("لطفاً فایل صوتی را انتخاب کنید");
      return;
    }
    setUploading(true);
    setUploadErr("");
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("title", titleEn.trim());
      if (titleFa.trim()) fd.append("titleFa", titleFa.trim());
      if (artistName.trim()) fd.append("artistName", artistName.trim());
      if (album.trim()) fd.append("album", album.trim());
      fd.append("genre", genre);
      fd.append("mood", mood);
      fd.append("accentColor", accentColor);
      if (lrcContent.trim()) fd.append("lrcContent", lrcContent.trim());
      fd.append("audio", audioFile);
      if (coverFile) fd.append("cover", coverFile);

      const res = await api.uploadTrack(fd);
      setUploadMsg(t("uploadSuccess"));
      setTracks((prev) => [res.track, ...prev]);
      setTitleEn("");
      setTitleFa("");
      setAudioFile(null);
      setCoverFile(null);
      setCoverPreviewUrl(null);
      setLrcContent("");
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleAutoDistribute = async () => {
    if (!selectedTrack || !plainText.trim()) return;
    setSyncErr("");
    setSyncMsg("");
    try {
      const res = await api.autoSyncPlainLyrics(
        plainText,
        selectedTrack.durationSec,
        selectedTrack.title,
        selectedTrack.artistName,
      );
      setSyncedLrc(res.lrcContent);
    } catch (err) {
      setSyncErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const handleStampLine = useCallback(() => {
    const rawLines = plainText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (cursorIndex >= rawLines.length) return;
    const stamp = formatLrcTimestamp(getCurrentTime() * 1000);
    const nextLine = `${stamp}${rawLines[cursorIndex]}`;
    setSyncedLrc((prev) => (prev ? `${prev}\n${nextLine}` : nextLine));
    setCursorIndex((c) => c + 1);
  }, [cursorIndex, getCurrentTime, plainText]);

  const stampLineRef = useRef(handleStampLine);
  useEffect(() => {
    stampLineRef.current = handleStampLine;
  }, [handleStampLine]);

  // Spacebar shortcut for Tap-to-Sync when focus is not inside a text/select input
  useEffect(() => {
    if (tab !== "sync") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      stampLineRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  const handleSaveSynced = async () => {
    if (!user) {
      openAuthDialog();
      return;
    }
    if (!selectedTrack || !syncedLrc.trim()) return;
    setSyncErr("");
    setSyncMsg("");
    try {
      const res = await api.saveLyrics(selectedTrack.id, syncedLrc, "auto-synced");
      if (currentTrack?.id === selectedTrack.id) {
        setLyricsLines(res.lines, res.source);
      }
      setSyncMsg(t("lyricsSaved"));
    } catch (err) {
      setSyncErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const handleAutoFetchLrclib = async () => {
    if (!selectedTrack) return;
    setSyncErr("");
    setSyncMsg("");
    try {
      const res = await api.autoFetchLyrics(selectedTrack.id, {
        forceRefresh: true,
        queryTitle: lrclibTitle.trim() || selectedTrack.title,
        queryArtist: lrclibArtist.trim() || selectedTrack.artistName,
      });
      if (res.found && res.lrcContent) {
        setSyncedLrc(res.lrcContent);
        if (currentTrack?.id === selectedTrack.id) {
          setLyricsLines(res.lines, res.source);
        }
        setSyncMsg(`${t("lyricsSyncedFrom")} ${res.source}`);
      } else {
        setSyncMsg(t("lyricsNotFound"));
      }
    } catch (err) {
      setSyncErr(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const rawLines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-5xl space-y-6 sf-fade-up">
      {/* Studio Apple Pro Header */}
      <Glass className="rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-md">
                <MicrophoneStageIcon size={22} weight="bold" aria-hidden="true" />
              </span>
              <span>{t("studioTitle")}</span>
            </h1>
            <p className="text-xs text-[var(--sf-muted)]">{t("studioDesc")}</p>
          </div>

          <GlassSegmented
            aria-label="Studio mode"
            className="shrink-0 self-start lg:self-auto"
            value={tab}
            onValueChange={(v) => setTab(v as "upload" | "sync")}
            items={[
              { value: "upload", label: t("uploadTrack") },
              { value: "sync", label: t("tapSyncTab") },
            ]}
          />
        </div>
      </Glass>

      {tab === "upload" ? (
        <Glass className="rounded-3xl p-5 sm:p-8">
          {!user ? (
            <div className="text-center py-12 space-y-4">
              <p className="text-sm opacity-80">{t("loginRequired")}</p>
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                icon={<UserCircleIcon size={18} aria-hidden="true" />}
              >
                {t("signIn")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleUpload} className="space-y-6">
              {/* Apple Pro Sleek Dropzones */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Audio Dropzone */}
                <div
                  className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition-all ${
                    audioFile
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.03] hover:border-indigo-500/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  }`}
                >
                  <input
                    type="file"
                    accept="audio/*"
                    required
                    onChange={(e) => handleAudioSelected(e.target.files?.[0] ?? null)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    aria-label={t("audioFile")}
                  />
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 mb-2">
                    <FileAudioIcon size={28} weight="duotone" aria-hidden="true" />
                  </div>
                  {audioFile ? (
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate max-w-xs">
                        {audioFile.name}
                      </p>
                      <p className="text-xs text-[var(--sf-muted)]">
                        {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
                        {audioDurationSec ? ` • ${formatDuration(audioDurationSec)}` : ""}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold">{t("audioFile")}</p>
                      <p className="text-xs text-[var(--sf-muted)]">MP3, WAV, FLAC, M4A, Opus</p>
                    </div>
                  )}
                </div>

                {/* Cover Dropzone */}
                <div
                  className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition-all ${
                    coverFile
                      ? "border-pink-500/50 bg-pink-500/5"
                      : "border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.03] hover:border-pink-500/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleCoverSelected(e.target.files?.[0] ?? null)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    aria-label={t("coverFile")}
                  />
                  {coverPreviewUrl ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={coverPreviewUrl}
                        alt="Preview"
                        className="h-16 w-16 rounded-2xl object-cover shadow-md"
                      />
                      <div className="text-start space-y-0.5">
                        <p className="text-sm font-bold text-pink-600 dark:text-pink-400 truncate max-w-xs">
                          {coverFile?.name}
                        </p>
                        <p className="text-xs text-[var(--sf-muted)]">برای تغییر کلیک کنید</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-500/10 text-pink-500 mb-2">
                        <ImageIcon size={28} weight="duotone" aria-hidden="true" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold">{t("coverFile")}</p>
                        <p className="text-xs text-[var(--sf-muted)]">JPG, PNG, WebP (اختیاری)</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pro Metadata Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("trackTitleEn")}</span>
                  <Input value={titleEn} onValueChange={setTitleEn} placeholder="Tehran Skyline" required />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("trackTitleFa")}</span>
                  <Input value={titleFa} onValueChange={setTitleFa} placeholder="آسمان تهران" />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("artistName")}</span>
                  <Input value={artistName} onValueChange={setArtistName} placeholder={user.displayName} />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("albumName")}</span>
                  <Input value={album} onValueChange={setAlbum} placeholder="Singles" />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("genre")}</span>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] px-3.5 py-2.5 text-sm outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40 text-[var(--sf-text)]"
                  >
                    <option value="Persian Rap" className="bg-[var(--sf-bg)]">Persian Rap</option>
                    <option value="Persian Pop" className="bg-[var(--sf-bg)]">Persian Pop</option>
                    <option value="Traditional" className="bg-[var(--sf-bg)]">Traditional</option>
                    <option value="Persian Fusion" className="bg-[var(--sf-bg)]">Persian Fusion</option>
                    <option value="Rock" className="bg-[var(--sf-bg)]">Rock</option>
                    <option value="Synthwave" className="bg-[var(--sf-bg)]">Synthwave</option>
                    <option value="Electronic" className="bg-[var(--sf-bg)]">Electronic</option>
                    <option value="Lo-Fi" className="bg-[var(--sf-bg)]">Lo-Fi</option>
                    <option value="Ambient" className="bg-[var(--sf-bg)]">Ambient</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("mood")}</span>
                  <select
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                    className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] px-3.5 py-2.5 text-sm outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40 text-[var(--sf-text)]"
                  >
                    {MOODS.map((m) => (
                      <option key={m} value={m} className="bg-[var(--sf-bg)]">
                        {m}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("accentColor")}</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-10 w-16 rounded-xl bg-transparent cursor-pointer outline-none focus:outline-none"
                    />
                    <span className="font-mono text-xs opacity-75">{accentColor}</span>
                  </div>
                </label>

                <label className="md:col-span-2 space-y-1 text-sm">
                  <span className="font-semibold opacity-85">{t("lrcOptional")}</span>
                  <textarea
                    rows={4}
                    value={lrcContent}
                    onChange={(e) => setLrcContent(e.target.value)}
                    placeholder="[00:02.00]First lyric line..."
                    dir="ltr"
                    className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] p-3 text-sm font-mono outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </label>
              </div>

              {uploadErr && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {uploadErr}
                </p>
              )}
              {uploadMsg && (
                <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold">
                  {uploadMsg}
                </p>
              )}

              <div>
                <Button
                  type="submit"
                  variant="filled"
                  disabled={uploading}
                  icon={<UploadSimpleIcon size={18} weight="bold" aria-hidden="true" />}
                >
                  {uploading ? t("uploading") : t("uploadTrack")}
                </Button>
              </div>
            </form>
          )}
        </Glass>
      ) : (
        /* Tap-to-Sync LRC Timeline Editor */
        <Glass className="rounded-3xl p-5 sm:p-7 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <label className="flex-1 space-y-1 text-sm">
              <span className="font-semibold opacity-85">{t("selectTrackForSync")}</span>
              <select
                value={selectedTrackId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const nextTrack = tracks.find((item) => item.id === nextId);
                  setSelectedTrackId(nextId);
                  setLrclibTitle(nextTrack?.title ?? "");
                  setLrclibArtist(nextTrack?.artistName ?? "");
                  setSyncedLrc("");
                  setCursorIndex(0);
                  setSyncMsg("");
                  setSyncErr("");
                }}
                className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] px-3.5 py-2.5 text-sm outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40 text-[var(--sf-text)]"
              >
                {tracks.map((tr) => (
                  <option key={tr.id} value={tr.id} className="bg-[var(--sf-bg)]">
                    {pickText(tr.title, tr.titleFa)} — {pickText(tr.artistName, tr.artistNameFa)}
                  </option>
                ))}
              </select>
            </label>

            {selectedTrack && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="filled"
                  tint={selectedTrack.accentColor}
                  onClick={() => playTrack(selectedTrack, tracks)}
                  icon={isSelectedPlaying ? <PauseIcon size={16} weight="fill" aria-hidden="true" /> : <PlayIcon size={16} weight="fill" aria-hidden="true" />}
                >
                  {isSelectedPlaying ? t("pause") : t("play")}
                </Button>
                <Button
                  type="button"
                  variant="glass"
                  onClick={() => void handleAutoFetchLrclib()}
                  icon={<MagicWandIcon size={16} aria-hidden="true" />}
                >
                  {t("autoFetchLyrics")}
                </Button>
              </div>
            )}
          </div>

          {selectedTrack && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="font-semibold opacity-75">{t("customLyricsTitlePlaceholder")}</span>
                <Input
                  value={lrclibTitle}
                  onValueChange={setLrclibTitle}
                  placeholder={selectedTrack.title}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold opacity-75">{t("customLyricsArtistPlaceholder")}</span>
                <Input
                  value={lrclibArtist}
                  onValueChange={setLrclibArtist}
                  placeholder={selectedTrack.artistName}
                />
              </label>
            </div>
          )}

          <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-3 text-xs text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
            <span>{t("tapSyncDesc")} (کلید Space برای همگام‌سازی خط بعدی)</span>
            <span className="font-mono font-bold">Spacebar</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <span className="block text-xs font-semibold text-[var(--sf-muted)]">متن خام آهنگ</span>
              <textarea
                rows={8}
                value={plainText}
                onChange={(e) => setPlainText(e.target.value)}
                className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] p-3 text-sm leading-relaxed outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="glass"
                  onClick={() => void handleAutoDistribute()}
                  icon={<MagicWandIcon size={16} aria-hidden="true" />}
                >
                  {t("autoDistributeSync")}
                </Button>
                <Button
                  type="button"
                  variant="filled"
                  onClick={handleStampLine}
                  disabled={cursorIndex >= rawLines.length}
                  icon={<TimerIcon size={16} aria-hidden="true" />}
                >
                  {t("stampNextLine")} ({Math.min(cursorIndex + 1, rawLines.length)}/{rawLines.length})
                </Button>
                <Button
                  type="button"
                  variant="glass"
                  onClick={() => {
                    setSyncedLrc("");
                    setCursorIndex(0);
                    setSyncMsg("");
                    setSyncErr("");
                  }}
                >
                  {t("resetSync")}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <span className="block text-xs font-semibold text-[var(--sf-muted)]">خروجی LRC همگام‌شده</span>
              <textarea
                rows={8}
                value={syncedLrc}
                onChange={(e) => setSyncedLrc(e.target.value)}
                placeholder="[00:02.10]..."
                dir="ltr"
                className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] p-3 text-xs font-mono leading-relaxed outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs opacity-70">
                  خطوط: {parseLrc(syncedLrc).length}
                </span>
                <Button
                  type="button"
                  variant="filled"
                  disabled={!syncedLrc.trim()}
                  onClick={() => void handleSaveSynced()}
                  icon={<CheckIcon size={16} weight="bold" aria-hidden="true" />}
                >
                  {t("saveLyrics")}
                </Button>
              </div>
              {syncErr && (
                <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 font-semibold">
                  {syncErr}
                </p>
              )}
              {syncMsg && (
                <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                  {syncMsg}
                </p>
              )}
            </div>
          </div>
        </Glass>
      )}
    </div>
  );
}

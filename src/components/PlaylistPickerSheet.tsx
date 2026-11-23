"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircleIcon,
  ListPlusIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import {
  addTrackToCustomPlaylist,
  createCustomPlaylist,
  removeTrackFromCustomPlaylist,
  useCustomPlaylists,
} from "@/lib/customPlaylists";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import type { Track } from "@/lib/types";

const OPEN_PLAYLIST_PICKER_EVENT = "soundify-open-playlist-picker";

const PLAYLIST_ACCENTS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#0ea5e9",
];

export function openPlaylistPicker(track: Track): void {
  if (typeof window === "undefined" || !track) return;
  window.dispatchEvent(new CustomEvent(OPEN_PLAYLIST_PICKER_EVENT, { detail: track }));
}

export function PlaylistPickerSheet() {
  const { pickText, formatNum, t } = useI18n();
  const customPlaylists = useCustomPlaylists();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [targetTrack, setTargetTrack] = useState<Track | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedAccent, setSelectedAccent] = useState(PLAYLIST_ACCENTS[0]);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<Track>).detail;
      if (detail) {
        setTargetTrack(detail);
        setCreating(false);
        setNewTitle("");
        setFeedback(null);
      }
    };
    window.addEventListener(OPEN_PLAYLIST_PICKER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PLAYLIST_PICKER_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (targetTrack) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          try {
            dialog.setAttribute("open", "true");
          } catch {}
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {}
    }
  }, [targetTrack]);

  const trackTitle = targetTrack ? pickText(targetTrack.title, targetTrack.titleFa) : "";

  const handleTogglePlaylist = (playlistId: string, hasTrack: boolean, playlistTitle: string) => {
    if (!targetTrack) return;
    void triggerHapticFeedback("selection");
    if (hasTrack) {
      removeTrackFromCustomPlaylist(playlistId, targetTrack.id);
      setFeedback(pickText(`Removed from "${playlistTitle}"`, `از «${playlistTitle}» حذف شد`));
    } else {
      addTrackToCustomPlaylist(playlistId, targetTrack);
      setFeedback(pickText(`Added to "${playlistTitle}"`, `به «${playlistTitle}» اضافه شد`));
    }
  };

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTrack) return;
    const title = newTitle.trim();
    if (!title) return;
    void triggerHapticFeedback("tap");
    const created = createCustomPlaylist({
      title,
      accentColor: selectedAccent,
      initialTracks: [targetTrack],
    });
    setNewTitle("");
    setCreating(false);
    setFeedback(
      pickText(
        `Created "${created.title}" & added track`,
        `پلی‌لیست «${created.title}» ساخته و آهنگ اضافه شد`,
      ),
    );
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="playlist-picker-title"
      className="sf-picker-dialog"
      onCancel={(e) => {
        e.preventDefault();
        setTargetTrack(null);
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          setTargetTrack(null);
        }
      }}
    >
      {targetTrack && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="sf-sheet-up sm:sf-modal-pop w-full max-w-md bg-white/98 dark:bg-[#12141e]/98 text-[var(--sf-text)] rounded-t-[28px] sm:rounded-3xl p-5 pb-[max(1.75rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.15rem))] shadow-[0_24px_64px_rgba(0,0,0,0.45)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 space-y-4 max-h-[82dvh] flex flex-col"
        >
          <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/25 mx-auto -mt-1 sm:hidden shrink-0" />

          <div className="flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500 shrink-0">
                <ListPlusIcon size={20} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="playlist-picker-title" className="text-base font-extrabold truncate">
                  {pickText("Add to Playlist", "افزودن به پلی‌لیست")}
                </h2>
                <p className="text-xs text-[var(--sf-muted)] truncate">{trackTitle}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTargetTrack(null)}
              aria-label={t("close")}
              className="sf-press h-9 w-9 min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center bg-black/[0.05] dark:bg-white/[0.08] text-[var(--sf-muted)] hover:text-[var(--sf-text)] cursor-pointer shrink-0"
            >
              <XIcon size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {/* Inline Create New Playlist Drawer */}
          {creating ? (
            <form onSubmit={handleCreateAndAdd} className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] p-3.5 space-y-3 shrink-0">
              <input
                type="text"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={pickText("Playlist name (e.g. Late Night Vibes)", "نام پلی‌لیست (مثلاً شب‌های آرام)")}
                className="w-full rounded-xl bg-white dark:bg-black/25 border border-black/[0.08] dark:border-white/10 px-3.5 py-2.5 text-sm text-[var(--sf-text)] placeholder:text-[var(--sf-muted)]/60 focus:outline-none focus:border-indigo-500"
                required
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {PLAYLIST_ACCENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedAccent(c)}
                      aria-label={`Select accent ${c}`}
                      className={`h-6 w-6 rounded-full cursor-pointer transition-transform ${
                        selectedAccent === c ? "scale-110 ring-2 ring-[var(--sf-text)] ring-offset-2 ring-offset-transparent" : "opacity-75 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[var(--sf-muted)] hover:text-[var(--sf-text)] cursor-pointer"
                  >
                    {pickText("Cancel", "لغو")}
                  </button>
                  <button
                    type="submit"
                    className="sf-press px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                  >
                    {pickText("Create & Add", "ساخت و افزودن")}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="sf-press w-full flex items-center justify-center gap-2 rounded-2xl py-3 px-4 bg-indigo-500/12 hover:bg-indigo-500/18 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 font-bold text-sm cursor-pointer shrink-0"
            >
              <PlusIcon size={17} weight="bold" aria-hidden="true" />
              <span>{pickText("Create New Playlist", "ساخت پلی‌لیست جدید")}</span>
            </button>
          )}

          {feedback && (
            <p role="status" className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 text-center shrink-0">
              {feedback}
            </p>
          )}

          {/* Existing User Custom Playlists List */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pe-0.5">
            {customPlaylists.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--sf-muted)]">
                {pickText(
                  "You haven't created a playlist yet. Tap Create New Playlist above.",
                  "هنوز پلی‌لیستی نساخته‌اید. دکمه بالا را بزنید تا اولین پلی‌لیست خود را بسازید.",
                )}
              </div>
            ) : (
              customPlaylists.map((pl) => {
                const hasTrack = pl.tracks.some((tr) => tr.id === targetTrack.id);
                const coverUrls = pl.tracks
                  .map((tr) => tr.coverUrl)
                  .filter((u): u is string => Boolean(u && !u.startsWith("blob:")))
                  .slice(0, 4);
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handleTogglePlaylist(pl.id, hasTrack, pl.title)}
                    className={`sf-row-press w-full flex items-center justify-between gap-3 rounded-2xl p-2.5 text-start cursor-pointer border transition-colors ${
                      hasTrack
                        ? "bg-indigo-500/10 border-indigo-500/30"
                        : "bg-black/[0.02] dark:bg-white/[0.03] border-black/[0.05] dark:border-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PlaylistMosaic
                        coverUrls={coverUrls}
                        className="h-12 w-12 rounded-xl shrink-0 shadow-sm"
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate text-[var(--sf-text)]">{pl.title}</p>
                        <p className="text-xs text-[var(--sf-muted)] tabular-nums">
                          {formatNum(pl.tracks.length)} {t("tracksCount")}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        hasTrack
                          ? "bg-emerald-500 text-white"
                          : "bg-black/[0.06] dark:bg-white/[0.1] text-transparent"
                      }`}
                    >
                      <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CircleNotchIcon,
  DotsThreeIcon,
  PauseIcon,
  PlayIcon,
  ShuffleIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { OptimizedTrackImage } from "@/components/OptimizedTrackImage";
import { DownloadButton } from "@/components/DownloadButton";
import { openPlaylistPicker } from "@/components/PlaylistPickerSheet";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { api, externalTracksCache, getCachedCatalogTracks } from "@/lib/api";
import { canonicalizeArtistString, toPhoneticSkeleton } from "@/lib/artistResolver";
import { useDownloadedTracks } from "@/lib/downloadManager";
import { FALLBACK_TRACKS } from "@/lib/fallbackSeedData";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { formatDuration } from "@/lib/lrc";
import { areTracksSameIdentity } from "@/lib/trackIdentity";
import type { Track } from "@/lib/types";
import { BitChordPlayPauseGlyph } from "./BitChordGlyphs";
import { rubberBand } from "./motion";

interface BitChordArtistSheetProps {
  artistName: string | null;
  seedTrack?: Track | null;
  onClose: () => void;
}

const GENERIC_ALBUM_LABELS = new Set([
  "single",
  "singles",
  "soundcloud",
  "youtube",
  "youtube audio",
  "youtube music",
  "spotify",
  "soundify",
  "soundify offline",
  "offline",
  "آفلاین ساندیفای",
]);

function matchesArtist(track: Track, targetName: string): boolean {
  const cleanTarget = canonicalizeArtistString(targetName);
  const targetSkel = toPhoneticSkeleton(targetName);
  if (!cleanTarget && !targetSkel) return false;
  const candidates = [track.artistName, track.artistNameFa].filter(Boolean);
  for (const candidate of candidates) {
    const cleanCand = canonicalizeArtistString(candidate);
    if (!cleanCand) continue;
    if (
      cleanCand === cleanTarget ||
      (cleanTarget.length >= 3 && (cleanCand.includes(cleanTarget) || cleanTarget.includes(cleanCand)))
    ) {
      return true;
    }
    const candSkel = toPhoneticSkeleton(candidate);
    if (targetSkel.length >= 3 && candSkel === targetSkel) {
      return true;
    }
  }
  return false;
}

export function BitChordArtistSheet({ artistName, seedTrack, onClose }: BitChordArtistSheetProps) {
  const { lang, pickText, t, formatNum } = useI18n();
  const { currentTrack, isPlaying, queue, playTrack, togglePlay, setExpanded } = usePlayer();
  const { downloadedTracks } = useDownloadedTracks();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropParallaxRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef<number | null>(null);

  const [prevArtist, setPrevArtist] = useState<string | null>(artistName);
  const [remoteTracks, setRemoteTracks] = useState<Track[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(Boolean(artistName));
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [overscrollY, setOverscrollY] = useState(0);
  const [isOverscrolling, setIsOverscrolling] = useState(false);

  if (artistName !== prevArtist) {
    setPrevArtist(artistName);
    setRemoteTracks([]);
    setSelectedAlbum(null);
    setActionMenuOpen(false);
    setOverscrollY(0);
    setLoadingRemote(Boolean(artistName));
  }

  const isOpen = Boolean(artistName && artistName.trim().length > 0);

  useLayoutEffect(() => {
    const dlg = dialogRef.current;
    if (!isOpen || !dlg) return;
    if (!dlg.open) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute("open", "");
      }
      try {
        dlg.focus({ preventScroll: true });
      } catch {}
    }
    return () => {
      if (dlg.open) {
        try {
          dlg.close();
        } catch {}
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!artistName) return;
    let active = true;
    void Promise.allSettled([
      api.getTracks({ q: artistName, limit: 24 }),
      api.searchExternal(artistName, "all", 24),
    ])
      .then((results) => {
        if (!active) return;
        const collected: Track[] = [];
        const localRes = results[0];
        if (localRes.status === "fulfilled" && Array.isArray(localRes.value?.tracks)) {
          collected.push(...localRes.value.tracks);
        }
        const extRes = results[1];
        if (extRes.status === "fulfilled" && Array.isArray(extRes.value?.results)) {
          collected.push(...extRes.value.results);
        }
        setRemoteTracks(collected.filter((tr) => matchesArtist(tr, artistName)));
      })
      .finally(() => {
        if (active) setLoadingRemote(false);
      });
    return () => {
      active = false;
    };
  }, [artistName]);

  const artistTracks = useMemo(() => {
    if (!artistName) return [] as Track[];
    const pool: Track[] = [];
    if (seedTrack) pool.push(seedTrack);
    if (currentTrack && matchesArtist(currentTrack, artistName)) pool.push(currentTrack);
    for (const d of downloadedTracks) {
      if (matchesArtist(d.track, artistName)) pool.push(d.track);
    }
    for (const q of queue) {
      if (matchesArtist(q, artistName)) pool.push(q);
    }
    for (const cached of getCachedCatalogTracks() ?? []) {
      if (matchesArtist(cached, artistName)) pool.push(cached);
    }
    for (const fb of FALLBACK_TRACKS) {
      if (matchesArtist(fb, artistName)) pool.push(fb);
    }
    externalTracksCache.forEach((tr) => {
      if (matchesArtist(tr, artistName)) pool.push(tr);
    });
    for (const rt of remoteTracks) {
      pool.push(rt);
    }

    const deduped: Track[] = [];
    for (const item of pool) {
      if (!deduped.some((existing) => existing.id === item.id || areTracksSameIdentity(existing, item))) {
        deduped.push(item);
      }
    }
    return deduped;
  }, [artistName, currentTrack, downloadedTracks, queue, remoteTracks, seedTrack]);

  const albums = useMemo(() => {
    const map = new Map<string, { name: string; coverTrack: Track; tracks: Track[] }>();
    for (const tr of artistTracks) {
      const alb = pickText(tr.album, tr.albumFa)?.trim();
      if (!alb || GENERIC_ALBUM_LABELS.has(alb.toLowerCase())) continue;
      const existing = map.get(alb);
      if (existing) {
        existing.tracks.push(tr);
      } else {
        map.set(alb, { name: alb, coverTrack: tr, tracks: [tr] });
      }
    }
    return Array.from(map.values());
  }, [artistTracks, pickText]);

  const displayedTracks = useMemo(() => {
    if (!selectedAlbum) return artistTracks;
    return artistTracks.filter((tr) => pickText(tr.album, tr.albumFa)?.trim() === selectedAlbum);
  }, [artistTracks, pickText, selectedAlbum]);

  if (!isOpen || !artistName) return null;

  const heroTrack = seedTrack || artistTracks[0] || null;
  const totalSec = artistTracks.reduce((acc, tr) => acc + (tr.durationSec || 0), 0);
  const totalMin = Math.max(0, Math.round(totalSec / 60));
  const isPlayingArtist =
    Boolean(currentTrack && isPlaying && artistTracks.some((tr) => areTracksSameIdentity(tr, currentTrack)));

  const handlePlayAll = (shuffleMode = false) => {
    if (displayedTracks.length === 0) return;
    void triggerHapticFeedback("playPause");
    if (!shuffleMode && isPlayingArtist && currentTrack && displayedTracks.some((t) => t.id === currentTrack.id)) {
      togglePlay();
      return;
    }
    const list = shuffleMode ? [...displayedTracks].sort(() => Math.random() - 0.5) : displayedTracks;
    playTrack(list[0], list, 0, true, `artist:${artistName}`);
  };

  const handleBackdropParallaxScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const backdrop = backdropParallaxRef.current;
    if (!backdrop) return;
    const st = Math.max(0, e.currentTarget.scrollTop);
    // BitChord DetailScreen PageBackground parallax (-0.55x smooth glide)
    const offset = -Math.min(st * 0.55, 280);
    backdrop.style.transform = `translate3d(0, ${offset}px, 0)`;
  };

  const handleScrollTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    if ((scrollRef.current?.scrollTop ?? 0) <= 0) {
      pullStartYRef.current = e.touches[0].clientY;
    } else {
      pullStartYRef.current = null;
    }
  };

  const handleScrollTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const startY = pullStartYRef.current;
    if (startY === null || e.touches.length !== 1) return;
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop > 1) {
      pullStartYRef.current = null;
      return;
    }
    const dy = e.touches[0].clientY - startY;
    if (dy > 4) {
      setIsOverscrolling(true);
      setOverscrollY(rubberBand(dy, 520));
    } else if (overscrollY > 0) {
      setOverscrollY(0);
    }
  };

  const handleScrollTouchEnd = () => {
    pullStartYRef.current = null;
    setIsOverscrolling(false);
    if (overscrollY !== 0) setOverscrollY(0);
  };

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-label={artistName}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 z-[80] m-0 h-dvh w-screen max-w-none max-h-none border-0 p-0 bg-[#f4f4f6] dark:bg-[#09090b] text-slate-950 dark:text-white overflow-hidden flex flex-col bc-sheet-in outline-none focus:outline-none"
    >
      {/* Seamless Atmospheric Hero Backdrop (DetailScreen.kt PageBackground eased fade to solid wash) */}
      {heroTrack && (
        <div
          ref={backdropParallaxRef}
          className="bc-artist-hero-mask pointer-events-none absolute inset-x-0 -top-16 h-[74vh] will-change-transform [&>div]:!aspect-auto [&>div]:!bg-transparent"
          aria-hidden="true"
        >
          <OptimizedTrackImage
            src={heroTrack.coverUrl}
            trackId={heroTrack.id}
            trackTitle={heroTrack.title}
            artistName={heroTrack.artistName}
            pageUrl={heroTrack.pageUrl}
            alt=""
            className="h-full w-full object-cover scale-125 blur-3xl opacity-38 dark:opacity-55 saturate-150"
          />
          <div
            className="hidden dark:block absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, rgba(9,9,11,0.16) 40%, rgba(9,9,11,0.48) 62%, rgba(9,9,11,0.82) 78%, rgba(9,9,11,0.97) 90%, #09090b 100%)",
            }}
          />
          <div
            className="block dark:hidden absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(244,244,246,0.22) 40%, rgba(244,244,246,0.55) 62%, rgba(244,244,246,0.86) 78%, rgba(244,244,246,0.98) 90%, #f4f4f6 100%)",
            }}
          />
        </div>
      )}

      {/* Floating Frosted Top Controls */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-[max(0.85rem,calc(var(--sat,env(safe-area-inset-top,0px))+0.45rem))] pb-2">
        <button
          type="button"
          onClick={() => {
            void triggerHapticFeedback("selection");
            onClose();
          }}
          aria-label={lang === "fa" ? "بازگشت" : "Back"}
          className="bc-pill-glass bc-control-btn h-11 w-11 min-h-[44px] min-w-[44px] rounded-full inline-flex items-center justify-center text-slate-900 dark:text-white cursor-pointer outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40 dark:focus-visible:ring-white/45"
        >
          {lang === "fa" ? (
            <CaretRightIcon size={20} weight="bold" aria-hidden="true" />
          ) : (
            <CaretLeftIcon size={20} weight="bold" aria-hidden="true" />
          )}
        </button>

        <div className="bc-pill-glass inline-flex items-center gap-1 rounded-full p-1">
          <button
            type="button"
            onClick={() => setActionMenuOpen((p) => !p)}
            aria-label="More actions"
            className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-900 dark:text-white cursor-pointer"
          >
            <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              setExpanded(true);
            }}
            aria-label={t("nowPlaying")}
            className="bc-control-btn h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-900 dark:text-white cursor-pointer"
          >
            <XIcon size={17} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleBackdropParallaxScroll}
        onTouchStart={handleScrollTouchStart}
        onTouchMove={handleScrollTouchMove}
        onTouchEnd={handleScrollTouchEnd}
        onTouchCancel={handleScrollTouchEnd}
        className="relative z-10 flex-1 overflow-y-auto px-5 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.5rem))]"
      >
        <div
          style={{
            transform: overscrollY !== 0 ? `translate3d(0, ${overscrollY}px, 0)` : undefined,
            transition: isOverscrolling ? "none" : "transform 0.42s cubic-bezier(0.22, 1.35, 0.36, 1)",
          }}
        >
        {/* Centered BitChord DetailScreen Hero */}
        <section className="mx-auto max-w-2xl flex flex-col items-center text-center pt-2 pb-6 space-y-4">
          <div className="h-44 w-44 sm:h-52 sm:w-52 rounded-[28px] overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-black/10 dark:ring-white/15 bg-black/10 dark:bg-white/5 flex items-center justify-center">
            {heroTrack ? (
              <OptimizedTrackImage
                src={heroTrack.coverUrl}
                trackId={heroTrack.id}
                trackTitle={heroTrack.title}
                artistName={heroTrack.artistName}
                pageUrl={heroTrack.pageUrl}
                alt={artistName}
                priority
                className="h-full w-full object-cover"
              />
            ) : (
              <UserIcon size={56} className="text-slate-400 dark:text-white/40" aria-hidden="true" />
            )}
          </div>

          <div className="space-y-1.5 max-w-lg">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{artistName}</h1>
            <p className="text-xs font-semibold text-slate-500 dark:text-white/60 tabular-nums">
              {lang === "fa" ? "صفحه خواننده" : "Artist"} · {formatNum(artistTracks.length)} {t("tracksCount")}
              {totalMin > 0 ? ` · ${formatNum(totalMin)} ${lang === "fa" ? "دقیقه" : "min"}` : ""}
            </p>
          </div>

          {/* Action Bar: Shuffle Circle + White Play Pill */}
          <div className="flex items-center justify-center gap-3 w-full max-w-sm pt-1">
            <button
              type="button"
              onClick={() => handlePlayAll(true)}
              disabled={displayedTracks.length === 0}
              aria-label={t("shuffle")}
              className="bc-pill-glass bc-control-btn h-12 w-12 rounded-full inline-flex items-center justify-center text-slate-900 dark:text-white disabled:opacity-40 cursor-pointer shrink-0"
            >
              <ShuffleIcon size={20} weight="bold" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handlePlayAll(false)}
              disabled={displayedTracks.length === 0}
              className="bc-control-btn flex-1 h-12 rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 cursor-pointer"
            >
              <BitChordPlayPauseGlyph isPlaying={isPlayingArtist} variant="mini" size={18} />
              <span>{isPlayingArtist ? t("pause") : t("play")}</span>
            </button>
          </div>
        </section>

        {/* Albums / Releases Horizontal Shelf */}
        {albums.length > 0 && (
          <section className="mx-auto max-w-2xl pb-6 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-extrabold tracking-tight">
                {lang === "fa" ? "آلبوم‌ها و مجموعه‌ها" : "Albums & Releases"}
              </h2>
              {selectedAlbum && (
                <button
                  type="button"
                  onClick={() => setSelectedAlbum(null)}
                  className="text-xs font-bold text-indigo-500 dark:text-indigo-400 cursor-pointer"
                >
                  {lang === "fa" ? "نمایش همه" : "Show all"}
                </button>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {albums.map((alb) => {
                const activeAlb = selectedAlbum === alb.name;
                return (
                  <button
                    key={alb.name}
                    type="button"
                    onClick={() => setSelectedAlbum(activeAlb ? null : alb.name)}
                    className={`bc-control-btn shrink-0 w-32 text-start rounded-2xl p-2 border transition-colors cursor-pointer ${
                      activeAlb
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent"
                        : "bg-white/75 dark:bg-white/[0.06] border-black/[0.06] dark:border-white/[0.08]"
                    }`}
                  >
                    <div className="aspect-square w-full rounded-xl overflow-hidden mb-2">
                      <OptimizedTrackImage
                        src={alb.coverTrack.coverUrl}
                        trackId={alb.coverTrack.id}
                        trackTitle={alb.coverTrack.title}
                        artistName={alb.coverTrack.artistName}
                        pageUrl={alb.coverTrack.pageUrl}
                        alt={alb.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <p className="truncate text-xs font-bold">{alb.name}</p>
                    <p className="text-[10.5px] opacity-65">
                      {formatNum(alb.tracks.length)} {t("tracksCount")}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Artist Songs List */}
        <section className="mx-auto max-w-2xl space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-extrabold tracking-tight">
              {selectedAlbum
                ? selectedAlbum
                : lang === "fa"
                  ? "آهنگ‌های برتر"
                  : "Songs"}
            </h2>
            {loadingRemote && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/55">
                <CircleNotchIcon size={13} className="animate-spin" aria-hidden="true" />
                <span>{lang === "fa" ? "جستجوی بیشتر..." : "Loading more..."}</span>
              </span>
            )}
          </div>

          <div className="rounded-[24px] bg-white/85 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
            {displayedTracks.length === 0 && !loadingRemote ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500 dark:text-white/60">
                {lang === "fa" ? "آهنگی برای این خواننده پیدا نشد." : "No tracks found for this artist."}
              </p>
            ) : (
              displayedTracks.map((tr) => {
                const isCurr = Boolean(currentTrack && areTracksSameIdentity(currentTrack, tr));
                const isCurrPlaying = isCurr && isPlaying;
                const trTitle = pickText(tr.title, tr.titleFa);
                return (
                  <div
                    key={tr.id}
                    className={`track-list-row flex items-center gap-3 px-3.5 py-2.5 transition-colors ${
                      isCurr ? "bg-black/[0.05] dark:bg-white/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void triggerHapticFeedback("selection");
                        if (isCurrPlaying) {
                          togglePlay();
                        } else {
                          playTrack(tr, displayedTracks, 0, true, `artist:${artistName}`);
                        }
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-start cursor-pointer"
                    >
                      <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 ring-1 ring-black/10 dark:ring-white/15">
                        <OptimizedTrackImage
                          src={tr.coverUrl}
                          trackId={tr.id}
                          trackTitle={tr.title}
                          artistName={tr.artistName}
                          pageUrl={tr.pageUrl}
                          alt={trTitle}
                          className="h-full w-full object-cover"
                        />
                        {isCurr && (
                          <span className="absolute inset-0 bg-black/45 flex items-center justify-center text-white">
                            {isCurrPlaying ? (
                              <PauseIcon size={17} weight="fill" aria-hidden="true" />
                            ) : (
                              <PlayIcon size={17} weight="fill" aria-hidden="true" />
                            )}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${isCurr ? "font-extrabold" : "font-semibold"}`}>
                          {trTitle}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-white/60">
                          {pickText(tr.artistName, tr.artistNameFa)} · {formatDuration(tr.durationSec || 0)}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <DownloadButton track={tr} size="sm" variant="ghost" />
                      <button
                        type="button"
                        onClick={() => openPlaylistPicker(tr)}
                        aria-label={t("addToPlaylist")}
                        className="h-9 w-9 rounded-full inline-flex items-center justify-center text-slate-500 dark:text-white/65 hover:bg-black/[0.06] dark:hover:bg-white/10 cursor-pointer"
                      >
                        <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
        </div>
      </div>

      {/* Quick Action Sheet for Artist */}
      {actionMenuOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-end p-4 pt-16 bg-black/35 backdrop-blur-sm"
          onClick={() => setActionMenuOpen(false)}
        >
          <div
            className="bc-glass-menu bc-menu-pop w-56 rounded-[24px] text-white divide-y divide-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setActionMenuOpen(false);
                handlePlayAll(false);
              }}
              className="w-full px-4 py-3 text-sm font-semibold text-start hover:bg-white/10 cursor-pointer"
            >
              {t("play")}
            </button>
            <button
              type="button"
              onClick={() => {
                setActionMenuOpen(false);
                handlePlayAll(true);
              }}
              className="w-full px-4 py-3 text-sm font-semibold text-start hover:bg-white/10 cursor-pointer"
            >
              {t("shuffle")}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

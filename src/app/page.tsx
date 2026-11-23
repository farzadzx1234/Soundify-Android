"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FireIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  api,
  getCachedCatalogPlaylists,
  getCachedCatalogTracks,
  getPlaylistDetailHref,
  getTrackDetailHref,
} from "@/lib/api";
import {
  FALLBACK_PLAYLISTS,
  FALLBACK_TRACKS,
} from "@/lib/fallbackSeedData";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, GlassSegmented } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackGrid } from "@/components/VirtualizedTrackGrid";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { useDownloadedTracks } from "@/lib/downloadManager";
import { buildPersonalizedMixes } from "@/lib/listeningPersonalization";
import type { Playlist, Track } from "@/lib/types";

export default function HomePage() {
  const { user } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { currentTrack, isPlaying, playTrack } = usePlayer();
  const { downloadedTracks } = useDownloadedTracks();

  // Initialize from cached live server catalog immediately so real tracks & artwork paint instantaneously
  const [tracks, setTracks] = useState<Track[]>(() => getCachedCatalogTracks() ?? FALLBACK_TRACKS);
  const [playlists, setPlaylists] = useState<Playlist[]>(() => getCachedCatalogPlaylists() ?? FALLBACK_PLAYLISTS);
  const [genre, setGenre] = useState("all");

  useEffect(() => {
    let active = true;
    const fetchCatalog = () => {
      // Fetch each independently so one slow endpoint doesn't block or cancel the others
      api.getTracks()
        .then((tRes) => {
          if (active && tRes?.tracks && tRes.tracks.length > 0) setTracks(tRes.tracks);
        })
        .catch(() => {});

      api.getPlaylists()
        .then((pRes) => {
          if (active && pRes?.playlists && pRes.playlists.length > 0) setPlaylists(pRes.playlists);
        })
        .catch(() => {});
    };

    fetchCatalog();

    const onServerChanged = () => {
      fetchCatalog();
    };
    window.addEventListener("soundify-server-changed", onServerChanged);

    return () => {
      active = false;
      window.removeEventListener("soundify-server-changed", onServerChanged);
    };
  }, [user?.id]);

  const genres = useMemo(
    () => ["all", ...Array.from(new Set(tracks.map((tr) => tr.genre)))],
    [tracks],
  );

  const filteredTracks = useMemo(() => {
    if (genre === "all") return tracks;
    return tracks.filter((tr) => tr.genre.toLowerCase() === genre.toLowerCase());
  }, [genre, tracks]);

  const featured = useMemo(() => {
    if (!tracks.length) return null;
    return [...tracks].sort((a, b) => (b.playsCount ?? 0) - (a.playsCount ?? 0))[0] ?? tracks[0];
  }, [tracks]);
  const featuredPlaying = featured && currentTrack?.id === featured.id && isPlaying;

  const personalizedMixes = useMemo(() => {
    const dlTrackObjects = downloadedTracks.map((d) => d.track);
    const likedOnly = tracks.filter((tr) => Boolean(tr.likedByMe));
    return buildPersonalizedMixes(tracks, dlTrackObjects, likedOnly, lang);
  }, [downloadedTracks, lang, tracks]);

  const handleRefresh = async () => {
    try {
      const [tRes, pRes] = await Promise.allSettled([
        api.getTracks(),
        api.getPlaylists(),
      ]);
      if (tRes.status === "fulfilled" && tRes.value.tracks.length > 0) setTracks(tRes.value.tracks);
      if (pRes.status === "fulfilled" && pRes.value.playlists.length > 0) setPlaylists(pRes.value.playlists);
    } catch {
      // ignore
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="mx-auto max-w-7xl space-y-7">
        {/* Hero Spotlight (Apple Music Style Immersive Card) */}
        {featured && (
          <section aria-label={t("heroBadge")}>
            <div className="sf-content-surface relative overflow-hidden rounded-[28px] sm:rounded-3xl p-5 sm:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_20px_50px_rgba(0,0,0,0.4)] border border-white/[0.08]">
              {/* Vibrant blurred artwork glow inside Hero (desktop only for Android scroll fps) */}
              <img
                src={featured.coverUrl}
                alt=""
                aria-hidden="true"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  img.onerror = null;
                  img.src = "/covers/track-01.jpg";
                }}
                className="hidden md:block pointer-events-none select-none absolute inset-0 h-full w-full object-cover scale-125 blur-3xl opacity-35 dark:opacity-65"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 22% 28%, ${featured.accentColor}55 0%, transparent 60%)`,
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/80 via-white/60 to-white/40 dark:from-[#0d0f18]/75 dark:via-[#0d0f18]/55 dark:to-[#0d0f18]/35"
              />

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-center relative z-10">
                <div className="md:col-span-5 lg:col-span-4 xl:col-span-3 flex justify-center relative">
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-2 rounded-full opacity-60 transition-transform duration-700 ${
                      featuredPlaying ? "sf-cover-pulse" : ""
                    }`}
                    style={{
                      background: `radial-gradient(circle, ${featured.accentColor}77 0%, transparent 72%)`,
                    }}
                  />
                  <img
                    src={featured.coverUrl}
                    alt={pickText(featured.title, featured.titleFa)}
                    width={280}
                    height={280}
                    fetchPriority="high"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.onerror = null;
                      img.src = "/covers/track-01.jpg";
                    }}
                    className={`relative h-48 w-48 sm:h-56 sm:w-56 lg:h-56 lg:w-56 xl:h-64 xl:w-64 max-w-full aspect-square rounded-2xl object-cover shadow-[0_20px_45px_rgba(0,0,0,0.4)] transition-transform duration-500 ${
                      featuredPlaying ? "scale-[1.03]" : "hover:scale-[1.02]"
                    }`}
                  />
                </div>
                <div className="md:col-span-7 lg:col-span-8 xl:col-span-9 space-y-3.5 text-center md:text-start">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 dark:bg-white/[0.12] px-3 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-200">
                    <SparkleIcon size={14} weight="fill" aria-hidden="true" />
                    {t("heroBadge")}
                  </span>

                  <h2 className="text-2xl sm:text-4xl xl:text-5xl font-black tracking-tight leading-tight text-slate-950 dark:text-white">
                    {pickText(featured.title, featured.titleFa)}
                  </h2>

                  <p className="text-sm sm:text-base text-[var(--sf-muted)] dark:text-slate-200 font-medium">
                    {pickText(featured.artistName, featured.artistNameFa)} • {pickText(featured.album, featured.albumFa)} •{" "}
                    {formatNum(featured.playsCount)} {t("plays")}
                  </p>

                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-1">
                    <Button
                      type="button"
                      variant="filled"
                      tint={featured.accentColor}
                      onClick={() => {
                        void triggerHapticFeedback("playPause");
                        playTrack(featured, tracks);
                      }}
                      icon={
                        featuredPlaying ? (
                          <PauseIcon size={20} weight="fill" aria-hidden="true" />
                        ) : (
                          <PlayIcon size={20} weight="fill" aria-hidden="true" />
                        )
                      }
                      className="min-h-[44px] px-6 text-sm font-bold shadow-lg"
                    >
                      {featuredPlaying ? t("pause") : t("playNow")}
                    </Button>

                    <Link
                      href={getTrackDetailHref(featured.id)}
                      className="sf-btn inline-flex min-h-[44px] items-center rounded-full px-5 py-2 text-sm font-bold bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/[0.12] dark:hover:bg-white/[0.18] transition-all active:scale-95 text-slate-900 dark:text-white"
                    >
                      {t("openTrackPage")}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Personalized Spotify-style Mixes Built from User Taste */}
        {personalizedMixes.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-white">
                <SparkleIcon size={20} weight="duotone" className="text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                <span>{pickText("Made For You", "ساخته‌شده اختصاصی برای شما")}</span>
              </h2>
              <span className="text-[11px] font-semibold text-[var(--sf-muted)]">
                {pickText("Based on your plays", "بر اساس سلیقه شنیداری شما")}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4">
              {personalizedMixes.map((mix) => {
                const isMixPlaying =
                  isPlaying && currentTrack && mix.tracks.some((tr) => tr.id === currentTrack.id);
                return (
                  <button
                    key={mix.id}
                    type="button"
                    onClick={() => {
                      if (mix.tracks.length === 0) return;
                      void triggerHapticFeedback("playPause");
                      playTrack(mix.tracks[0], mix.tracks);
                    }}
                    className="group sf-press sf-content-card text-start rounded-2xl p-2 sm:p-3 flex flex-col gap-2 cursor-pointer transition-transform"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md bg-black/20">
                      <PlaylistMosaic coverUrls={mix.coverUrls} className="h-full w-full rounded-xl" lazy />
                      <span
                        className="absolute top-2 start-2 rounded-full bg-black/72 border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white"
                      >
                        {lang === "fa" ? mix.badgeFa : mix.badge}
                      </span>
                      <span
                        aria-hidden="true"
                        className="absolute bottom-2 end-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-950 shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-105"
                        style={{ backgroundColor: isMixPlaying ? "#10b981" : "#ffffff" }}
                      >
                        {isMixPlaying ? (
                          <PauseIcon size={16} weight="fill" />
                        ) : (
                          <PlayIcon size={16} weight="fill" className="translate-x-[0.5px]" />
                        )}
                      </span>
                    </div>
                    <div className="min-w-0 space-y-0.5 px-0.5 w-full">
                      <h3 className="font-bold text-[13px] sm:text-sm truncate text-slate-950 dark:text-white">
                        {lang === "fa" ? mix.titleFa : mix.title}
                      </h3>
                      <p className="text-[11px] text-[var(--sf-muted)] dark:text-slate-400 truncate">
                        {lang === "fa" ? mix.subtitleFa : mix.subtitle}
                      </p>
                      <span className="inline-block text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5 tabular-nums">
                        {formatNum(mix.tracks.length)} {t("tracksCount")}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Curated Playlists (Spotify-style Square Grid Cards) */}
        {playlists.length > 0 && (
          <section className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-white">
                <PlaylistIcon size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span>{t("curatedPlaylists")}</span>
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 sm:gap-4">
              {playlists.slice(0, 4).map((pl) => (
                <Link
                  key={pl.id}
                  href={getPlaylistDetailHref(pl.id)}
                  onClick={() => void triggerHapticFeedback("tap")}
                  className="group sf-content-card rounded-2xl p-2.5 sm:p-3.5 flex flex-col gap-2.5 active:scale-[0.98] transition-transform"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md bg-black/20">
                    <PlaylistMosaic coverUrls={pl.coverUrls} className="h-full w-full rounded-xl" lazy />
                    <span
                      aria-hidden="true"
                      className="absolute bottom-2 end-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-slate-950 shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-105"
                    >
                      <PlayIcon size={17} weight="fill" className="translate-x-[0.5px]" />
                    </span>
                  </div>
                  <div className="min-w-0 space-y-0.5 px-0.5">
                    <h3 className="font-bold text-xs sm:text-sm truncate text-slate-950 dark:text-white">
                      {pickText(pl.title, pl.titleFa)}
                    </h3>
                    <p className="text-[11px] text-[var(--sf-muted)] dark:text-slate-400 truncate">
                      {pickText(pl.description, pl.descriptionFa)}
                    </p>
                    <span className="inline-block text-[10.5px] font-semibold text-indigo-600 dark:text-indigo-400 pt-0.5">
                      {formatNum(pl.trackCount)} {t("tracksCount")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Genre Filter + Trending Tracks */}
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-white">
              <FireIcon size={22} weight="duotone" className="text-pink-600 dark:text-pink-400" aria-hidden="true" />
              <span>{t("trendingNow")}</span>
            </h2>

            <GlassSegmented
              aria-label="Filter by genre"
              value={genre}
              onValueChange={setGenre}
              items={genres.map((g) => ({
                value: g,
                label: g === "all" ? t("allGenres") : g,
              }))}
            />
          </div>

          <VirtualizedTrackGrid
            tracks={filteredTracks}
            queue={filteredTracks}
            playlists={playlists}
            onTrackUpdated={(updated) =>
              setTracks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
            }
          />
        </section>
      </div>
    </PullToRefresh>
  );
}

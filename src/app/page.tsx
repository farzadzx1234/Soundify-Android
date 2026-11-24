"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FireIcon,
  PauseIcon,
  PlayIcon,
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
import { isPlaylistContextPlaying } from "@/lib/trackIdentity";
import type { Playlist, Track } from "@/lib/types";

function getDailyPlaysScore(tr: Track): number {
  return tr.dailyPlaysCount ?? tr.playsToday ?? tr.todayPlays ?? tr.playsCount ?? 0;
}

function getExplicitDailyPlays(tr: Track): number | null {
  if (!tr) return null;
  if (typeof tr.dailyPlaysCount === "number" && tr.dailyPlaysCount > 0) return tr.dailyPlaysCount;
  if (typeof tr.playsToday === "number" && tr.playsToday > 0) return tr.playsToday;
  if (typeof tr.todayPlays === "number" && tr.todayPlays > 0) return tr.todayPlays;
  return null;
}

class HomeSectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(err: unknown) {
    console.warn("HomeSectionErrorBoundary recovered section:", err);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function HomePage() {
  const { user } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { currentTrack, isPlaying, playbackContextId, playTrack, togglePlay } = usePlayer();
  const { downloadedTracks } = useDownloadedTracks();

  // Initialize from cached live server catalog immediately so real tracks & artwork paint instantaneously
  const [tracks, setTracks] = useState<Track[]>(() => getCachedCatalogTracks() ?? FALLBACK_TRACKS);
  const [playlists, setPlaylists] = useState<Playlist[]>(() => getCachedCatalogPlaylists() ?? FALLBACK_PLAYLISTS);
  const [genre, setGenre] = useState("all");

  const safeTracks = useMemo(
    () =>
      (Array.isArray(tracks) ? tracks : FALLBACK_TRACKS).filter(
        (tr): tr is Track => Boolean(tr && typeof tr === "object" && typeof tr.id === "string" && tr.id),
      ),
    [tracks],
  );

  useEffect(() => {
    let active = true;
    const fetchCatalog = () => {
      // Fetch each independently so one slow endpoint doesn't block or cancel the others
      api.getTracks()
        .then((tRes) => {
          if (active && Array.isArray(tRes?.tracks) && tRes.tracks.length > 0) {
            setTracks(tRes.tracks.filter((tr): tr is Track => Boolean(tr && typeof tr.id === "string" && tr.id)));
          }
        })
        .catch(() => {});

      api.getPlaylists()
        .then((pRes) => {
          if (active && Array.isArray(pRes?.playlists) && pRes.playlists.length > 0) {
            setPlaylists(pRes.playlists.filter((pl): pl is Playlist => Boolean(pl && typeof pl.id === "string" && pl.id)));
          }
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
    () => [
      "all",
      ...Array.from(
        new Set(
          safeTracks
            .map((tr) => tr.genre)
            .filter((g): g is string => typeof g === "string" && g.trim().length > 0),
        ),
      ),
    ],
    [safeTracks],
  );

  const filteredTracks = useMemo(() => {
    if (genre === "all") return safeTracks;
    return safeTracks.filter((tr) => (typeof tr.genre === "string" ? tr.genre : "").toLowerCase() === genre.toLowerCase());
  }, [genre, safeTracks]);

  const featured = useMemo(() => {
    if (!safeTracks.length) return null;
    return (
      [...safeTracks].sort((a, b) => {
        const diff = getDailyPlaysScore(b) - getDailyPlaysScore(a);
        if (diff !== 0) return diff;
        return (b.playsCount ?? 0) - (a.playsCount ?? 0);
      })[0] ?? safeTracks[0]
    );
  }, [safeTracks]);
  const featuredPlaying = featured && currentTrack?.id === featured.id && isPlaying;
  const featuredDailyPlays = featured ? getExplicitDailyPlays(featured) : null;

  const personalizedMixes = useMemo(() => {
    try {
      const dlTrackObjects = (Array.isArray(downloadedTracks) ? downloadedTracks : [])
        .map((d) => d?.track)
        .filter((tr): tr is Track => Boolean(tr && typeof tr.id === "string" && tr.id));
      const likedOnly = safeTracks.filter((tr) => Boolean(tr.likedByMe));
      return buildPersonalizedMixes(safeTracks, dlTrackObjects, likedOnly, lang);
    } catch {
      return [];
    }
  }, [downloadedTracks, lang, safeTracks]);

  const handleRefresh = async () => {
    try {
      const [tRes, pRes] = await Promise.allSettled([
        api.getTracks(),
        api.getPlaylists(),
      ]);
      if (tRes.status === "fulfilled" && Array.isArray(tRes.value?.tracks) && tRes.value.tracks.length > 0) {
        setTracks(tRes.value.tracks.filter((tr): tr is Track => Boolean(tr && typeof tr.id === "string" && tr.id)));
      }
      if (pRes.status === "fulfilled" && Array.isArray(pRes.value?.playlists) && pRes.value.playlists.length > 0) {
        setPlaylists(pRes.value.playlists.filter((pl): pl is Playlist => Boolean(pl && typeof pl.id === "string" && pl.id)));
      }
    } catch {
      // ignore
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="mx-auto max-w-7xl space-y-7">
        {/* Hero Spotlight (Apple Music Style Immersive Card) */}
        {featured && (
          <HomeSectionErrorBoundary>
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
                    {featuredDailyPlays !== null
                      ? `${formatNum(featuredDailyPlays)} ${pickText("plays today", "پخش امروز")}`
                      : `${formatNum(featured.playsCount ?? 0)} ${t("plays")}`}
                  </p>

                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-1">
                    <Button
                      type="button"
                      variant="filled"
                      tint={featured.accentColor}
                      onClick={() => {
                        void triggerHapticFeedback("playPause");
                        playTrack(featured, safeTracks);
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
          </HomeSectionErrorBoundary>
        )}

        {/* Personalized Spotify-style Mixes Built from User Taste */}
        {personalizedMixes.length > 0 && (
          <HomeSectionErrorBoundary>
            <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-white">
                <SparkleIcon size={20} weight="duotone" className="text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                <span>{pickText("Made For You", "ساخته‌شده اختصاصی برای شما")}</span>
              </h2>
              <span className="text-[11px] font-semibold text-[var(--sf-muted)]">
                {pickText("Auto Artist & Daily Mixes", "میکس‌های هوشمند و خواننده")}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
              {personalizedMixes.map((mix) => {
                const isMixPlaying = isPlaylistContextPlaying({
                  isPlaying,
                  currentTrack,
                  playbackContextId,
                  playlistId: mix.id,
                  tracks: mix.tracks,
                });
                return (
                  <div
                    key={mix.id}
                    className="group sf-content-card rounded-2xl p-2 sm:p-3 flex flex-col gap-2"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md bg-black/20">
                      <Link href={getPlaylistDetailHref(mix.id)} className="block h-full w-full">
                        <PlaylistMosaic coverUrls={mix.coverUrls} tracks={mix.tracks} className="h-full w-full rounded-xl" lazy />
                      </Link>
                      <span
                        className="pointer-events-none absolute top-2 start-2 rounded-full bg-black/72 border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white"
                      >
                        {lang === "fa" ? mix.badgeFa : mix.badge}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (mix.tracks.length === 0) return;
                          void triggerHapticFeedback("playPause");
                          if (isMixPlaying) {
                            togglePlay();
                          } else {
                            playTrack(mix.tracks[0], mix.tracks, 0, true, `playlist:${mix.id}`);
                          }
                        }}
                        aria-label={`${t("playNow")}: ${lang === "fa" ? mix.titleFa : mix.title}`}
                        className="sf-press absolute bottom-2 end-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-950 shadow-[0_6px_16px_rgba(0,0,0,0.45)] cursor-pointer"
                        style={{ backgroundColor: isMixPlaying ? "#10b981" : "#ffffff" }}
                      >
                        {isMixPlaying ? (
                          <PauseIcon size={16} weight="fill" />
                        ) : (
                          <PlayIcon size={16} weight="fill" className="translate-x-[0.5px]" />
                        )}
                      </button>
                    </div>
                    <Link href={getPlaylistDetailHref(mix.id)} className="min-w-0 space-y-0.5 px-0.5 w-full block">
                      <h3 className="font-bold text-[13px] sm:text-sm truncate text-slate-950 dark:text-white">
                        {lang === "fa" ? mix.titleFa : mix.title}
                      </h3>
                      <p className="text-[11px] text-[var(--sf-muted)] dark:text-slate-400 truncate">
                        {lang === "fa" ? mix.subtitleFa : mix.subtitle}
                      </p>
                      <span className="inline-block text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5 tabular-nums">
                        {formatNum(mix.tracks.length)} {t("tracksCount")}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
            </section>
          </HomeSectionErrorBoundary>
        )}

        {/* Genre Filter + Trending Tracks */}
        <HomeSectionErrorBoundary>
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
        </HomeSectionErrorBoundary>
      </div>
    </PullToRefresh>
  );
}

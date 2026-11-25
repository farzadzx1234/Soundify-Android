"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CompassIcon,
  FireIcon,
  MagnifyingGlassIcon,
  MusicNotesSimpleIcon,
  PlayIcon,
  PauseIcon,
  PlaylistIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  api,
  getCachedCatalogPlaylists,
  getCachedCatalogTracks,
  getPlaylistDetailHref,
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Glass } from "@/components/GlassControls";
import { PlaylistMosaic } from "@/components/PlaylistMosaic";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackGrid } from "@/components/VirtualizedTrackGrid";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import { FALLBACK_PLAYLISTS, FALLBACK_TRACKS } from "@/lib/fallbackSeedData";
import type { Playlist, Track } from "@/lib/types";

const EXPLORE_CATEGORIES = [
  { id: "all", label: "All Curations", labelFa: "تمام بخش‌ها" },
  { id: "trending", label: "Trending Now", labelFa: "ترندهای برتر" },
  { id: "new", label: "Fresh Drops", labelFa: "تازه‌ترین‌ها" },
  { id: "persian", label: "Persian Wave", labelFa: "موج پارسی" },
  { id: "chill", label: "Midnight & Chill", labelFa: "شبانه و آرامش" },
];

export default function ExplorePage() {
  const { user } = useAuth();
  const { t, pickText, lang, formatNum } = useI18n();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();

  const [tracks, setTracks] = useState<Track[]>(() => getCachedCatalogTracks() ?? FALLBACK_TRACKS);
  const [playlists, setPlaylists] = useState<Playlist[]>(() => getCachedCatalogPlaylists() ?? FALLBACK_PLAYLISTS);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        api.getTracks(),
        api.getPlaylists(),
      ]);
      setTracks(tRes.tracks);
      setPlaylists(pRes.playlists);
    } catch {
      // Graceful offline fallback
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([api.getTracks(), api.getPlaylists()])
      .then(([tRes, pRes]) => {
        if (!active) return;
        setTracks(tRes.tracks);
        setPlaylists(pRes.playlists);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const filteredTracks = useMemo(() => {
    if (selectedCategory === "trending") {
      return [...tracks].sort((a, b) => (b.playsCount ?? 0) - (a.playsCount ?? 0));
    }
    if (selectedCategory === "new") {
      return [...tracks].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
    }
    if (selectedCategory === "persian") {
      return tracks.filter(
        (tr) =>
          tr.genre.toLowerCase().includes("pop") ||
          tr.genre.toLowerCase().includes("traditional") ||
          tr.genre.toLowerCase().includes("fusion") ||
          tr.titleFa ||
          tr.artistNameFa,
      );
    }
    if (selectedCategory === "chill") {
      return tracks.filter(
        (tr) =>
          tr.mood.toLowerCase().includes("chill") ||
          tr.mood.toLowerCase().includes("deep") ||
          tr.genre.toLowerCase().includes("acoustic") ||
          tr.genre.toLowerCase().includes("electronic"),
      );
    }
    return tracks;
  }, [selectedCategory, tracks]);

  const heroTrack = useMemo(() => {
    return filteredTracks[0] ?? tracks[0] ?? null;
  }, [filteredTracks, tracks]);

  const isHeroPlaying = heroTrack && currentTrack?.id === heroTrack.id && isPlaying;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Banner */}
        <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border border-white/10 bg-gradient-to-br from-indigo-950/60 via-purple-950/40 to-black/80 backdrop-blur-2xl shadow-2xl">
          <div className="absolute -top-24 -end-24 w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />
          <div className="relative z-10 space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              <CompassIcon size={14} weight="bold" />
              <span>{lang === "fa" ? "کاوش و کشف موسیقی" : "Explore & Discovery"}</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
              {lang === "fa" ? "دنیای بی‌پایان اصوات برگزیده" : "Endless Sonic Discoveries"}
            </h1>
            <p className="text-sm sm:text-base text-zinc-300">
              {lang === "fa"
                ? "ترندهای داغ، پلی‌لیست‌های اختصاصی و تازه‌ترین آثار هنرمندان محبوب را در ساندیفای کشف کنید."
                : "Explore curated charts, fresh trending releases, and exclusive soundscapes tuned for you."}
            </p>

            {heroTrack && (
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (currentTrack?.id === heroTrack.id) {
                      togglePlay();
                    } else {
                      playTrack(heroTrack, filteredTracks);
                    }
                  }}
                  className="sf-btn inline-flex items-center justify-center gap-2.5 h-11 px-6 rounded-full font-bold text-sm text-slate-950 bg-white hover:bg-white/95 active:scale-[0.96] shadow-[0_8px_24px_rgba(255,255,255,0.22)] transition-all cursor-pointer select-none"
                >
                  {isHeroPlaying ? (
                    <PauseIcon size={18} weight="fill" className="text-slate-950 shrink-0" aria-hidden="true" />
                  ) : (
                    <PlayIcon size={18} weight="fill" className="text-slate-950 shrink-0" aria-hidden="true" />
                  )}
                  <span className="tracking-tight">
                    {isHeroPlaying
                      ? lang === "fa"
                        ? "توقف پخش"
                        : "Pause Featured"
                      : lang === "fa"
                        ? "پخش برگزیده امروز"
                        : "Play Spotlight"}
                  </span>
                </button>
                <Link
                  href="/search"
                  className="sf-btn inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full text-sm font-semibold bg-white/12 hover:bg-white/18 text-white border border-white/15 backdrop-blur-md active:scale-[0.96] transition-all cursor-pointer select-none"
                >
                  <MagnifyingGlassIcon size={17} className="text-white shrink-0" aria-hidden="true" />
                  <span>{t("navSearch")}</span>
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Category Segmented Selector */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <SparkleIcon size={20} className="text-amber-400" weight="fill" />
              <span>{lang === "fa" ? "دسته‌بندی‌های پیشنهادی" : "Featured Categories"}</span>
            </h2>
            <span className="text-xs text-slate-500 dark:text-zinc-400">
              {formatNum(filteredTracks.length)} {t("tracksCount")}
            </span>
          </div>

          <div className="overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-2 min-w-max">
              {EXPLORE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  data-active={selectedCategory === cat.id ? "true" : "false"}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`sf-tab-pill px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                    selectedCategory === cat.id
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 scale-102"
                      : "bg-black/[0.04] dark:bg-white/5 hover:bg-black/[0.08] dark:hover:bg-white/10 text-slate-700 dark:text-zinc-300 border border-black/[0.06] dark:border-white/5"
                  }`}
                >
                  {lang === "fa" ? cat.labelFa : cat.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Virtualized Track Explorer Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <FireIcon size={20} className="text-rose-500" weight="fill" />
              <span>{lang === "fa" ? "آهنگ‌های منتخب" : "Selected Tracks"}</span>
            </h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-2xl bg-black/[0.04] dark:bg-white/5 animate-pulse border border-black/[0.06] dark:border-white/5"
                />
              ))}
            </div>
          ) : filteredTracks.length === 0 ? (
            <Glass className="p-8 text-center rounded-3xl border border-black/[0.06] dark:border-white/10">
              <MusicNotesSimpleIcon size={40} className="mx-auto text-zinc-500 mb-3" />
              <p className="text-slate-500 dark:text-zinc-400 text-sm">
                {lang === "fa"
                  ? "آهنگی در این دسته‌بندی یافت نشد."
                  : "No tracks found in this category."}
              </p>
            </Glass>
          ) : (
            <VirtualizedTrackGrid
              tracks={filteredTracks}
              queue={filteredTracks}
            />
          )}
        </section>

        {/* Curated Playlists */}
        {playlists.length > 0 && (
          <section className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2 text-slate-900 dark:text-white">
                <PlaylistIcon size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span>{t("curatedPlaylists")}</span>
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 sm:gap-4">
              {playlists.slice(0, 8).map((pl) => (
                <Link
                  key={pl.id}
                  href={getPlaylistDetailHref(pl.id)}
                  onClick={() => void triggerHapticFeedback("tap")}
                  className="group sf-content-card rounded-2xl p-2.5 sm:p-3.5 flex flex-col gap-2.5"
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
                    <span className="inline-block text-[10.5px] font-semibold text-indigo-600 dark:text-indigo-400 pt-0.5 tabular-nums">
                      {formatNum(pl.trackCount)} {t("tracksCount")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </PullToRefresh>
  );
}

"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  GlobeHemisphereWestIcon,
  HardDrivesIcon,
  MagnifyingGlassIcon,
  MusicNotesSimpleIcon,
  PauseIcon,
  PlayIcon,
  SoundcloudLogoIcon,
  SparkleIcon,
  SpotifyLogoIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass, GlassSegmented, SearchField } from "@/components/GlassControls";
import { ExternalTrackCard } from "@/components/ExternalTrackCard";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackGrid } from "@/components/VirtualizedTrackGrid";
import type { Playlist, Track } from "@/lib/types";

const MOODS = ["all", "Chill", "Energetic", "Deep", "Emotional", "Midnight", "Focus", "Soulful"];

const BROWSE_CATEGORIES = [
  {
    id: "pop",
    title: "Persian Pop",
    titleFa: "پاپ فارسی",
    query: "Pop",
    gradient: "from-rose-500 to-pink-600",
    accent: "#F43F5E",
    icon: "🎤",
  },
  {
    id: "rap",
    title: "Rap & Hip-Hop",
    titleFa: "رپ و هیپ‌هاپ",
    query: "Rap",
    gradient: "from-amber-500 to-orange-600",
    accent: "#F97316",
    icon: "🔥",
  },
  {
    id: "traditional",
    title: "Traditional & Fusion",
    titleFa: "سنتی و تلفیقی",
    query: "Fusion",
    gradient: "from-indigo-600 to-violet-700",
    accent: "#6366F1",
    icon: "🪕",
  },
  {
    id: "rock",
    title: "Rock & Alternative",
    titleFa: "راک و متال",
    query: "Rock",
    gradient: "from-red-600 to-zinc-900",
    accent: "#DC2626",
    icon: "⚡",
  },
  {
    id: "electronic",
    title: "Electronic & Dance",
    titleFa: "الکترونیک و دنس",
    query: "Electronic",
    gradient: "from-cyan-500 to-blue-600",
    accent: "#06B6D4",
    icon: "🎛️",
  },
  {
    id: "chill",
    title: "Chill & Acoustic",
    titleFa: "آرامش و لایت",
    query: "Chill",
    gradient: "from-emerald-500 to-teal-700",
    accent: "#10B981",
    icon: "🍃",
  },
  {
    id: "nostalgia",
    title: "Classics & Memories",
    titleFa: "نوستالژی و ماندگار",
    query: "Classic",
    gradient: "from-amber-600 to-yellow-700",
    accent: "#D97706",
    icon: "📻",
  },
  {
    id: "focus",
    title: "Focus & Deep Flow",
    titleFa: "تمرکز و شبانه",
    query: "Deep",
    gradient: "from-purple-600 to-indigo-900",
    accent: "#8B5CF6",
    icon: "🌌",
  },
];

type SearchSource = "local" | "external";
type ExternalSubSource = "all" | "youtube" | "soundcloud" | "spotify";

function SearchPageInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { t, pickText, formatNum } = useI18n();
  const { currentTrack, isPlaying, playTrack } = usePlayer();

  const urlQ = searchParams.get("q") ?? "";
  const rawSource = searchParams.get("source");
  const urlSource = (rawSource === "external" ? "external" : "local") as SearchSource;
  const rawExt = searchParams.get("ext") ?? "all";
  const urlExtSource = (["all", "youtube", "soundcloud", "spotify"].includes(rawExt)
    ? (rawExt as ExternalSubSource)
    : "all");

  const [searchSource, setSearchSource] = useState<SearchSource>(urlSource);
  const [extSubSource, setExtSubSource] = useState<ExternalSubSource>(urlExtSource);
  const [inputValue, setInputValue] = useState(urlQ);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQ);
  const [mood, setMood] = useState("all");

  const inputRef = useRef<HTMLInputElement>(null);

  // Local Catalog State
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // External Search State
  const [externalTracks, setExternalTracks] = useState<Track[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);

  useEffect(() => {
    api.getPlaylists().then((r) => setPlaylists(r.playlists)).catch(() => {});
  }, [user?.id]);

  // Pure in-place URL synchronization without triggering Next.js route navigation
  // Prevents mobile virtual keyboard dismiss, focus resets, and unneeded RSC payload fetches
  const syncUrl = useCallback(
    (q: string, src: SearchSource, extSrc: ExternalSubSource) => {
      if (typeof window === "undefined") return;
      const cleanQ = q.trim();
      const sp = new URLSearchParams();
      if (cleanQ) sp.set("q", cleanQ);
      if (src === "external") {
        sp.set("source", "external");
        if (extSrc !== "all") sp.set("ext", extSrc);
      }
      const queryStr = sp.toString();
      const nextUrl = queryStr ? `/search?${queryStr}` : "/search";
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (currentUrl !== nextUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    },
    [],
  );

  // Sync state if browser Back/Forward is clicked
  useEffect(() => {
    const handlePopState = () => {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("q") ?? "";
      const rawSrc = sp.get("source");
      const src: SearchSource = rawSrc === "external" ? "external" : "local";
      const rawE = sp.get("ext") ?? "all";
      const ext: ExternalSubSource = ["all", "youtube", "soundcloud", "spotify"].includes(rawE)
        ? (rawE as ExternalSubSource)
        : "all";

      setInputValue(q);
      setDebouncedQuery(q);
      setSearchSource(src);
      setExtSubSource(ext);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Sync if external navigation occurs (e.g. from AppShell desktop search bar or link)
  // Protected: NEVER overwrite input state if user is currently focused/typing in the input
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === inputRef.current) {
      return;
    }
    setInputValue(urlQ);
    setDebouncedQuery(urlQ);
    setSearchSource(urlSource);
    setExtSubSource(urlExtSource);
  }, [urlQ, urlSource, urlExtSource]);

  // Debounce typing: sync debouncedQuery and URL 280ms after user pauses typing
  useEffect(() => {
    if (inputValue.trim() === debouncedQuery.trim()) {
      return;
    }

    const timer = setTimeout(() => {
      const nextQuery = inputValue;
      setDebouncedQuery(nextQuery);
      syncUrl(nextQuery, searchSource, extSubSource);
    }, 280);

    return () => clearTimeout(timer);
  }, [inputValue, debouncedQuery, searchSource, extSubSource, syncUrl]);

  // Input change handler
  const handleInputChange = (val: string) => {
    setInputValue(val);
    if (!val.trim()) {
      // Immediate clear for instant visual and catalog reset
      setDebouncedQuery("");
      syncUrl("", searchSource, extSubSource);
    }
  };

  // Immediate form submit handler (e.g. user presses 'Search' / 'Enter' on mobile keyboard)
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQuery(inputValue);
    syncUrl(inputValue, searchSource, extSubSource);
  };

  // Local catalog search effect
  useEffect(() => {
    if (searchSource !== "local") return;
    let active = true;

    const timer = setTimeout(() => {
      setLocalLoading(true);
      api
        .getTracks({ q: debouncedQuery.trim() || undefined, mood })
        .then((res) => {
          if (active) setLocalTracks(res.tracks);
        })
        .catch(() => {
          if (active) setLocalTracks([]);
        })
        .finally(() => {
          if (active) setLocalLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [debouncedQuery, mood, searchSource, user?.id]);

  // External search effect (YouTube / SoundCloud / Spotify)
  useEffect(() => {
    if (searchSource !== "external") return;
    const cleanQ = debouncedQuery.trim();

    let active = true;
    const timer = setTimeout(() => {
      if (!cleanQ || cleanQ.length < 2) {
        setExternalTracks([]);
        setExternalLoading(false);
        setExternalError(null);
        return;
      }

      setExternalLoading(true);
      setExternalError(null);
      api
        .searchExternal(cleanQ, extSubSource, 20)
        .then((res) => {
          if (!active) return;
          setExternalTracks(res.results || []);
          if (res.error && (!res.results || res.results.length === 0)) {
            setExternalError(res.error);
          }
        })
        .catch((err) => {
          if (!active) return;
          setExternalTracks([]);
          setExternalError(err instanceof Error ? err.message : t("actionFailed"));
        })
        .finally(() => {
          if (active) setExternalLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [debouncedQuery, searchSource, extSubSource, t]);

  const handleSourceChange = (newSource: string) => {
    const next = newSource as SearchSource;
    setSearchSource(next);
    syncUrl(inputValue, next, extSubSource);
  };

  const handleExtSubSourceChange = (newSub: string) => {
    const next = newSub as ExternalSubSource;
    setExtSubSource(next);
    syncUrl(inputValue, searchSource, next);
  };

  const handleCategoryClick = (catQuery: string) => {
    setInputValue(catQuery);
    setDebouncedQuery(catQuery);
    syncUrl(catQuery, searchSource, extSubSource);
  };

  // Top result candidate for local search
  const topResult = useMemo(() => {
    if (!debouncedQuery.trim() || localTracks.length === 0) return null;
    return localTracks[0];
  }, [debouncedQuery, localTracks]);

  const topResultPlaying = topResult && currentTrack?.id === topResult.id && isPlaying;

  const handleRefresh = async () => {
    try {
      if (searchSource === "external") {
        if (debouncedQuery.trim()) {
          const res = await api.searchExternal(debouncedQuery.trim());
          setExternalTracks(res.results);
        }
      } else {
        const [tRes, pRes] = await Promise.all([
          api.getTracks({ q: debouncedQuery.trim() || undefined }),
          api.getPlaylists(),
        ]);
        setLocalTracks(tRes.tracks);
        setPlaylists(pRes.playlists);
      }
    } catch {
      // ignore
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="mx-auto max-w-7xl space-y-8 sf-fade-up">
      {/* Search Header Container */}
      <Glass className="rounded-3xl p-5 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-md">
              <MagnifyingGlassIcon size={22} weight="bold" aria-hidden="true" />
            </span>
            <span>{t("navSearch")}</span>
          </h1>
        </div>

        {/* Primary Source Switcher: Local Catalog vs Online Streams (YouTube/SoundCloud/Spotify) */}
        <div className="pt-1">
          <GlassSegmented
            aria-label="Search Source"
            fullWidth
            size="sm"
            value={searchSource}
            onValueChange={handleSourceChange}
            items={[
              {
                value: "local",
                label: (
                  <span className="inline-flex items-center justify-center gap-1.5 font-bold">
                    <HardDrivesIcon size={16} weight="duotone" className="text-indigo-400 shrink-0" aria-hidden="true" />
                    <span className="truncate">{pickText("Soundify", "آرشیو ساندیفای")}</span>
                  </span>
                ),
              },
              {
                value: "external",
                label: (
                  <span className="inline-flex items-center justify-center gap-1.5 font-bold">
                    <GlobeHemisphereWestIcon size={16} weight="duotone" className="text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className="truncate">{pickText("Global Search", "پخش جهانی")}</span>
                  </span>
                ),
              },
            ]}
          />
        </div>

        {/* Large Apple Search Pill */}
        <form onSubmit={handleSearchSubmit} role="search" className="max-w-2xl">
          <SearchField
            ref={inputRef}
            aria-label={t("navSearch")}
            loading={localLoading || externalLoading}
            placeholder={
              searchSource === "external"
                ? pickText(
                    "Search song or artist on YouTube, SoundCloud & Spotify...",
                    "جستجو در یوتیوب، ساندکلود و اسپاتیفای...",
                  )
                : t("searchPlaceholder")
            }
            value={inputValue}
            onValueChange={handleInputChange}
          />
        </form>

        {/* Sub-Filters: Mood filter for Local, or Service filter for External */}
        {searchSource === "local" ? (
          <div className="pt-1 max-w-full">
            <GlassSegmented
              aria-label="Filter by mood"
              size="sm"
              value={mood}
              onValueChange={setMood}
              items={MOODS.map((m) => ({
                value: m,
                label: m === "all" ? t("allGenres") : m,
              }))}
            />
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-[var(--sf-border)]/50 pt-3">
            <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--sf-muted)] shrink-0">
                {pickText("Source:", "منبع:")}
              </span>
              <GlassSegmented
                aria-label="External Channel"
                size="sm"
                value={extSubSource}
                onValueChange={handleExtSubSourceChange}
                items={[
                  {
                    value: "all",
                    label: (
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <SparkleIcon size={13} weight="fill" className="text-indigo-400 shrink-0" aria-hidden="true" />
                        <span>{t("allGenres")}</span>
                      </span>
                    ),
                  },
                  {
                    value: "youtube",
                    label: (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-500">
                        <YoutubeLogoIcon size={13} weight="fill" className="shrink-0" aria-hidden="true" />
                        <span>{t("searchSourceYouTube")}</span>
                      </span>
                    ),
                  },
                  {
                    value: "soundcloud",
                    label: (
                      <span className="inline-flex items-center gap-1 font-semibold text-orange-500">
                        <SoundcloudLogoIcon size={13} weight="fill" className="shrink-0" aria-hidden="true" />
                        <span>{t("searchSourceSoundCloud")}</span>
                      </span>
                    ),
                  },
                  {
                    value: "spotify",
                    label: (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                        <SpotifyLogoIcon size={13} weight="fill" className="shrink-0" aria-hidden="true" />
                        <span>{t("searchSourceSpotify")}</span>
                      </span>
                    ),
                  },
                ]}
              />
            </div>

            <p className="text-xs text-[var(--sf-muted)] hidden md:block">
              {t("externalSearchNotice")}
            </p>
          </div>
        )}
      </Glass>

      {/* ========================================================================= */}
      {/* SOURCE 1: LOCAL SOUNDIFY CATALOG VIEW */}
      {/* ========================================================================= */}
      {searchSource === "local" && (
        <>
          {/* When NO query is entered: Show Browse Categories */}
          {!inputValue.trim() && mood === "all" && (
            <section aria-label="Browse Categories" className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  <SparkleIcon size={22} weight="duotone" className="text-indigo-500" aria-hidden="true" />
                  <span>{t("allGenres")}</span>
                </h2>
                <span className="text-xs text-[var(--sf-muted)] font-medium">
                  {pickText("Browse Categories", "مرور سبک‌ها")}
                </span>
              </div>

              <div className="sf-stagger grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                {BROWSE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategoryClick(cat.query)}
                    className={`sf-press group relative h-24 sm:h-28 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden text-start select-none cursor-pointer shadow-sm bg-gradient-to-br ${cat.gradient}`}
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-black/10 group-hover:bg-transparent transition-opacity"
                    />
                    <span className="text-2xl sm:text-3xl">{cat.icon}</span>
                    <div className="relative z-10">
                      <span className="block text-sm sm:text-base font-extrabold text-white leading-tight">
                        {pickText(cat.title, cat.titleFa)}
                      </span>
                      <span className="block text-[11px] font-medium text-white/80">{cat.query}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Local Search Results */}
          {localLoading && localTracks.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="sf-content-card rounded-3xl p-4 h-72 animate-pulse" />
              ))}
            </div>
          ) : localTracks.length === 0 ? (
            <Glass className="rounded-3xl p-12 text-center space-y-3 opacity-80">
              <MagnifyingGlassIcon size={44} weight="duotone" className="mx-auto text-[var(--sf-muted)]" aria-hidden="true" />
              <p className="text-base font-bold">{t("searchEmpty")}</p>
              <p className="text-xs text-[var(--sf-muted)]">نام خواننده، آهنگ یا آلبوم را با عبارت دیگری جستجو کنید</p>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="glass"
                  onClick={() => handleSourceChange("external")}
                  icon={<GlobeHemisphereWestIcon size={16} aria-hidden="true" />}
                >
                  {pickText("Search online on YouTube / SoundCloud / Spotify", "جستجو در منابع آنلاین (یوتیوب / ساندکلود / اسپاتیفای)")}
                </Button>
              </div>
            </Glass>
          ) : (
            <div className="space-y-6">
              {/* Top Result spotlight */}
              {topResult && (debouncedQuery.trim() || inputValue.trim()) && (
                <section aria-label="Top Result" className="space-y-3">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--sf-muted)]">
                    <span>{t("heroBadge")}</span>
                  </h2>
                  <div className="sf-content-card rounded-3xl p-4 sm:p-5 flex items-center gap-4 relative overflow-hidden">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 opacity-20"
                      style={{
                        background: `radial-gradient(circle at 20% 50%, ${topResult.accentColor} 0%, transparent 70%)`,
                      }}
                    />
                    <img
                      src={topResult.coverUrl}
                      alt={pickText(topResult.title, topResult.titleFa)}
                      width={96}
                      height={96}
                      className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl object-cover shadow-md shrink-0 relative z-10"
                    />
                    <div className="flex-1 min-w-0 text-start space-y-1.5 relative z-10">
                      <span className="inline-block rounded-full bg-black/10 dark:bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold">
                        {topResult.genre} • {topResult.mood}
                      </span>
                      <h3 className="text-lg sm:text-xl font-black truncate">{pickText(topResult.title, topResult.titleFa)}</h3>
                      <p className="text-xs sm:text-sm opacity-80 truncate">{pickText(topResult.artistName, topResult.artistNameFa)}</p>
                      <div className="pt-1 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="filled"
                          tint={topResult.accentColor}
                          onClick={() => playTrack(topResult, localTracks)}
                          icon={
                            topResultPlaying ? (
                              <PauseIcon size={16} weight="fill" aria-hidden="true" />
                            ) : (
                              <PlayIcon size={16} weight="fill" aria-hidden="true" />
                            )
                          }
                          className="!min-h-[38px] !px-4 !text-xs"
                        >
                          {topResultPlaying ? t("pause") : t("playNow")}
                        </Button>
                        <Link
                          href={`/track/${topResult.id}`}
                          className="sf-press rounded-full bg-black/[0.06] dark:bg-white/[0.1] hover:bg-black/[0.1] dark:hover:bg-white/[0.15] px-3.5 py-2 text-xs font-semibold transition-colors"
                        >
                          {t("openTrackPage")}
                        </Link>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Local Songs Grid */}
              <section aria-label="Search Songs" className="space-y-3">
                <h2 className="text-xl font-bold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MusicNotesSimpleIcon size={20} weight="bold" className="text-indigo-500" aria-hidden="true" />
                    <span>{pickText("Tracks on Soundify", "آهنگ‌های موجود روی سرور")}</span>
                  </span>
                  <span className="text-xs text-[var(--sf-muted)] font-normal">
                    {formatNum(localTracks.length)} {t("tracksCount")}
                  </span>
                </h2>

                <div
                  className={`transition-opacity duration-200 ${
                    localLoading ? "opacity-60" : "opacity-100"
                  }`}
                >
                  <VirtualizedTrackGrid tracks={localTracks} queue={localTracks} playlists={playlists} />
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* SOURCE 2: ONLINE EXTERNAL STREAMS (YOUTUBE / SOUNDCLOUD / SPOTIFY) */}
      {/* ========================================================================= */}
      {searchSource === "external" && (
        <div className="space-y-4">
          {!inputValue.trim() || inputValue.trim().length < 2 ? (
            <Glass className="rounded-3xl p-10 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-sm">
                <GlobeHemisphereWestIcon size={30} weight="duotone" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg sm:text-xl font-black">
                  {pickText(
                    "Search Worldwide Music (YouTube, SoundCloud & Spotify)",
                    "کاوش نامحدود در یوتیوب، ساندکلود و اسپاتیفای",
                  )}
                </h2>
                <p className="text-xs text-[var(--sf-muted)] max-w-md mx-auto">
                  {pickText(
                    "Type the name of any track or artist. You can play them instantly right here inside Soundify!",
                    "نام هر آهنگ یا خواننده دلخواه را تایپ کنید؛ موزیک‌ها به صورت زنده استخراج شده و مستقیماً داخل سایت پخش می‌شوند.",
                  )}
                </p>
              </div>
            </Glass>
          ) : externalLoading && externalTracks.length === 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[var(--sf-muted)]">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{t("externalSearchSearching")}</span>
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 sm:gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="sf-content-card rounded-2xl p-2.5 flex items-center gap-3 animate-pulse">
                    <div className="h-14 w-14 rounded-xl bg-white/10 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-3/4 rounded-full bg-white/10" />
                      <div className="h-3 w-1/2 rounded-full bg-white/5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : externalTracks.length === 0 ? (
            <Glass className="rounded-3xl p-10 text-center space-y-3 opacity-85">
              <MagnifyingGlassIcon size={40} weight="duotone" className="mx-auto text-[var(--sf-muted)]" aria-hidden="true" />
              <p className="text-base font-bold">{t("searchEmpty")}</p>
              <p className="text-xs text-[var(--sf-muted)]">
                {externalError ||
                  pickText(
                    "No results found on selected provider. Try another spelling or switch provider.",
                    "نتیجه‌ای در ارائه‌دهنده انتخابی یافت نشد. املای کلمه را بررسی کنید یا ارائه‌دهنده را تغییر دهید.",
                  )}
              </p>
            </Glass>
          ) : (
            <section aria-label="External Online Results" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                  <GlobeHemisphereWestIcon size={20} weight="duotone" className="text-emerald-500" aria-hidden="true" />
                  <span>
                    {pickText("Worldwide Streams", "نتایج پخش آنلاین")}
                  </span>
                </h2>
                <span className="text-xs text-[var(--sf-muted)] font-medium">
                  {formatNum(externalTracks.length)} {t("tracksCount")}
                </span>
              </div>

              {/* Apple Music Scannable Compact Track Rows */}
              <div
                className={`sf-stagger grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 transition-opacity duration-200 ${
                  externalLoading ? "opacity-60" : "opacity-100"
                }`}
              >
                {externalTracks.map((tr) => (
                  <ExternalTrackCard
                    key={tr.id}
                    track={tr}
                    queue={externalTracks}
                    onImportSuccess={() => {
                      // refresh catalog in background
                      api.getTracks().then((r) => setLocalTracks(r.tracks)).catch(() => {});
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-70">Loading search...</div>}>
      <SearchPageInner />
    </Suspense>
  );
}

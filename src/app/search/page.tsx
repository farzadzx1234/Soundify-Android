"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  GlobeHemisphereWestIcon,
  HardDrivesIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  MusicNotesSimpleIcon,
  PauseIcon,
  PlayIcon,
  PlusCircleIcon,
  SoundcloudLogoIcon,
  SparkleIcon,
  SpotifyLogoIcon,
  XIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass, GlassSegmented, SearchField } from "@/components/GlassControls";
import { ExternalTrackCard } from "@/components/ExternalTrackCard";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackGrid } from "@/components/VirtualizedTrackGrid";
import { filterSensitiveTracks, isSearchQuerySensitive } from "@/lib/contentFilter";
import { sortExternalTracksByReleaseDate } from "@/lib/externalSort";
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

const RECENT_SEARCHES_KEY = "soundify_recent_searches";

const PLACEHOLDER_SUGGESTIONS_FA = [
  "جستجوی آهنگ، خواننده یا سبک...",
  "مثلاً: شادمهر عقیلی",
  "مثلاً: همایون شجریان",
  "مثلاً: یاس",
  "مثلاً: Coldplay",
  "مثلاً: Adele",
  "مثلاً: بهنام بانی",
  "مثلاً: سیروان خسروی",
];

const PLACEHOLDER_SUGGESTIONS_EN = [
  "Search tracks, artists, or genres...",
  "e.g. The Weeknd",
  "e.g. Coldplay",
  "e.g. Shajarian",
  "e.g. Billie Eilish",
  "e.g. Taylor Swift",
  "e.g. Hans Zimmer",
];

function SearchPageInner() {
  const searchParams = useSearchParams();
  const { user, openAuthDialog } = useAuth();
  const { t, pickText, formatNum, lang } = useI18n();
  const { currentTrack, isPlaying, playTrack, setExpanded } = usePlayer();

  const canAccessGlobal = Boolean(
    user && (user.canAccessGlobalSearch || user.role === "admin" || user.isAdmin),
  );

  const urlQ = searchParams.get("q") ?? "";
  const rawSource = searchParams.get("source");
  const urlSource = (rawSource === "external" ? "external" : "local") as SearchSource;
  const rawExt = searchParams.get("ext") ?? "all";
  const urlExtSource = (["all", "youtube", "soundcloud", "spotify"].includes(rawExt)
    ? (rawExt as ExternalSubSource)
    : "all");

  const initialSource: SearchSource =
    urlSource === "external" && canAccessGlobal ? "external" : "local";

  const [searchSource, setSearchSource] = useState<SearchSource>(initialSource);
  const [extSubSource, setExtSubSource] = useState<ExternalSubSource>(urlExtSource);
  const [inputValue, setInputValue] = useState(urlQ);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQ);
  const [mood, setMood] = useState("all");

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

  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const accessDialogRef = useRef<HTMLDialogElement | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Synchronize access modal open/close lifecycle
  useEffect(() => {
    const dlg = accessDialogRef.current;
    if (!dlg) return;
    if (accessModalOpen && !dlg.open) {
      dlg.showModal();
    } else if (!accessModalOpen && dlg.open) {
      dlg.close();
    }
  }, [accessModalOpen]);

  // Click outside and cancel listener for access dialog
  useEffect(() => {
    const dlg = accessDialogRef.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      setAccessModalOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (e.target === dlg) {
        setAccessModalOpen(false);
      }
    };
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("click", onClick);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("click", onClick);
    };
  }, []);

  // Recent Searches State
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const saveRecentSearch = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean || clean.length < 2) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== clean.toLowerCase());
      const next = [clean, ...filtered].slice(0, 8);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((queryToRemove: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRecentSearches((prev) => {
      const next = prev.filter((item) => item !== queryToRemove);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const clearAllRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {}
  }, []);

  // Animated Placeholder cycling
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDER_SUGGESTIONS_FA.length);
    }, 3600);
    return () => clearInterval(timer);
  }, []);

  const activePlaceholder = useMemo(() => {
    if (canAccessGlobal && searchSource === "external") {
      return pickText(
        "Search YouTube, SoundCloud & Spotify...",
        "جستجو در یوتیوب، ساندکلود و اسپاتیفای...",
      );
    }
    const list = lang === "fa" ? PLACEHOLDER_SUGGESTIONS_FA : PLACEHOLDER_SUGGESTIONS_EN;
    return list[placeholderIndex % list.length];
  }, [canAccessGlobal, searchSource, lang, placeholderIndex, pickText]);

  // Local Catalog State
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // External Search State
  const [externalTracks, setExternalTracks] = useState<Track[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [extSortMode, setExtSortMode] = useState<"releaseDate" | "relevance">("releaseDate");
  const [extPage, setExtPage] = useState(1);
  const [extLoadingMore, setExtLoadingMore] = useState(false);
  const [extHasMore, setExtHasMore] = useState(true);
  const [extRefreshing, setExtRefreshing] = useState(false);
  const [extMoreFeedback, setExtMoreFeedback] = useState<string | null>(null);

  useEffect(() => {
    api.getPlaylists().then((r) => setPlaylists(r.playlists)).catch(() => {});
  }, [user?.id]);

  // Sync state if browser Back/Forward is clicked
  useEffect(() => {
    const handlePopState = () => {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("q") ?? "";
      const rawSrc = sp.get("source");
      const src: SearchSource = rawSrc === "external" && canAccessGlobal ? "external" : "local";
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
  }, [canAccessGlobal]);

  // Sync if external navigation occurs (e.g. from AppShell desktop search bar or link)
  // Protected: NEVER overwrite input state if user is currently focused/typing in the input
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === inputRef.current) {
      return;
    }
    setInputValue(urlQ);
    setDebouncedQuery(urlQ);
    setSearchSource(urlSource === "external" && !canAccessGlobal ? "local" : urlSource);
    setExtSubSource(urlExtSource);
  }, [urlQ, urlSource, urlExtSource, canAccessGlobal]);

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
    if (inputValue.trim()) {
      saveRecentSearch(inputValue.trim());
    }
  };

  // Local catalog search effect
  useEffect(() => {
    if (searchSource !== "local") return;
    const cleanQ = debouncedQuery.trim();
    let active = true;

    const timer = setTimeout(() => {
      if (isSearchQuerySensitive(cleanQ)) {
        if (active) {
          setLocalTracks([]);
          setLocalLoading(false);
        }
        return;
      }
      setLocalLoading(true);
      api
        .getTracks({ q: cleanQ || undefined, mood })
        .then((res) => {
          if (active) setLocalTracks(filterSensitiveTracks(res.tracks));
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
    if (!canAccessGlobal || searchSource !== "external") return;
    const cleanQ = debouncedQuery.trim();
    let active = true;

    const timer = setTimeout(() => {
      if (isSearchQuerySensitive(cleanQ)) {
        if (active) {
          setExternalTracks([]);
          setExternalLoading(false);
          setExternalError(null);
        }
        return;
      }

      if (!cleanQ || cleanQ.length < 2) {
        setExternalTracks([]);
        setExternalLoading(false);
        setExternalError(null);
        return;
      }

      setExternalLoading(true);
      setExternalError(null);
      setExtPage(1);
      setExtHasMore(true);
      setExtMoreFeedback(null);
      const searchLimit = extSubSource === "all" ? 48 : 32;
      api
        .searchExternal(cleanQ, extSubSource, searchLimit)
        .then((res) => {
          if (!active) return;
          if (res.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" || res.error?.includes("GLOBAL_SEARCH_ACCESS_REQUIRED")) {
            setExternalTracks([]);
            setSearchSource("local");
            syncUrl(cleanQ, "local", extSubSource);
            setAccessModalOpen(true);
            return;
          }
          if (res.code === "APP_UPDATE_REQUIRED") {
            setExternalTracks([]);
            setSearchSource("local");
            syncUrl(cleanQ, "local", extSubSource);
            return;
          }
          setExternalTracks(filterSensitiveTracks(res.results || []));
          if (res.error && (!res.results || res.results.length === 0)) {
            setExternalError(res.error);
          }
        })
        .catch((err: unknown) => {
          if (!active) return;
          if (
            (err instanceof ApiError && (err.status === 426 || err.code === "APP_UPDATE_REQUIRED")) ||
            (err as { code?: string })?.code === "APP_UPDATE_REQUIRED" ||
            String(err).includes("APP_UPDATE_REQUIRED")
          ) {
            setExternalTracks([]);
            setSearchSource("local");
            syncUrl(cleanQ, "local", extSubSource);
            return;
          }
          if (
            (err instanceof ApiError && (err.status === 403 || err.code === "GLOBAL_SEARCH_ACCESS_REQUIRED")) ||
            (err as { code?: string })?.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" ||
            String(err).includes("GLOBAL_SEARCH_ACCESS_REQUIRED")
          ) {
            setExternalTracks([]);
            setSearchSource("local");
            syncUrl(cleanQ, "local", extSubSource);
            setAccessModalOpen(true);
            return;
          }
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
  }, [canAccessGlobal, debouncedQuery, searchSource, extSubSource, syncUrl, t]);

  const handleSourceChange = (newSource: string) => {
    const next = newSource as SearchSource;
    if (next === "external" && !canAccessGlobal) {
      if (!user) {
        openAuthDialog();
      } else {
        setAccessModalOpen(true);
      }
      return;
    }
    setSearchSource(next);
    syncUrl(inputValue, next, extSubSource);
  };

  const handleExtSubSourceChange = (newSub: string) => {
    const next = newSub as ExternalSubSource;
    setExtSubSource(next);
    setExternalError(null);
    setExtPage(1);
    setExtHasMore(true);
    setExtMoreFeedback(null);
    if (next !== "all") {
      setExternalTracks((prev) => prev.filter((tr) => tr.source === next));
    }
    syncUrl(inputValue, searchSource, next);
  };

  const handleRefreshExternalSearch = async () => {
    const cleanQ = (debouncedQuery.trim() || inputValue.trim()).trim();
    if (!canAccessGlobal || !cleanQ || cleanQ.length < 2 || extRefreshing || externalLoading) return;
    setExtRefreshing(true);
    setExternalError(null);
    setExtMoreFeedback(null);
    try {
      const searchLimit = extSubSource === "all" ? 48 : 32;
      const res = await api.searchExternal(cleanQ, extSubSource, searchLimit, {
        page: 1,
        forceRefresh: true,
      });
      if (res.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" || res.error?.includes("GLOBAL_SEARCH_ACCESS_REQUIRED")) {
        setExternalTracks([]);
        setSearchSource("local");
        syncUrl(cleanQ, "local", extSubSource);
        setAccessModalOpen(true);
        return;
      }
      const nextList = filterSensitiveTracks(res.results || []);
      setExternalTracks(nextList);
      setExtPage(1);
      setExtHasMore(nextList.length > 0);
      if (res.error && nextList.length === 0) {
        setExternalError(res.error);
      }
    } catch (err: unknown) {
      setExternalError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setExtRefreshing(false);
    }
  };

  const handleLoadMoreExternal = async () => {
    const cleanQ = (debouncedQuery.trim() || inputValue.trim()).trim();
    if (!canAccessGlobal || !cleanQ || cleanQ.length < 2 || extLoadingMore || externalLoading) return;
    const nextPage = extPage + 1;
    if (nextPage > 6) {
      setExtHasMore(false);
      return;
    }
    setExtLoadingMore(true);
    setExtMoreFeedback(null);
    try {
      const batchLimit = extSubSource === "all" ? 36 : 24;
      const res = await api.searchExternal(cleanQ, extSubSource, batchLimit, { page: nextPage });
      if (res.code === "GLOBAL_SEARCH_ACCESS_REQUIRED" || res.error?.includes("GLOBAL_SEARCH_ACCESS_REQUIRED")) {
        setExternalTracks([]);
        setSearchSource("local");
        syncUrl(cleanQ, "local", extSubSource);
        setAccessModalOpen(true);
        return;
      }
      const incoming = filterSensitiveTracks(res.results || []);
      const seen = new Set<string>();
      for (const item of externalTracks) {
        seen.add(item.id);
        const canon = (item.pageUrl || "").split("?")[0].toLowerCase();
        if (canon) seen.add(canon);
      }
      const uniqueNew: Track[] = [];
      for (const item of incoming) {
        const canon = (item.pageUrl || "").split("?")[0].toLowerCase();
        if (seen.has(item.id) || (canon && seen.has(canon))) continue;
        seen.add(item.id);
        if (canon) seen.add(canon);
        uniqueNew.push(item);
      }
      if (uniqueNew.length > 0) {
        setExternalTracks((prev) => {
          const prevIds = new Set(prev.map((p) => p.id));
          return [...prev, ...uniqueNew.filter((u) => !prevIds.has(u.id))];
        });
      }
      setExtPage(nextPage);
      if (uniqueNew.length > 0) {
        setExtMoreFeedback(
          pickText(
            `Added ${uniqueNew.length} more tracks`,
            `${formatNum(uniqueNew.length)} آهنگ جدید به لیست اضافه شد`,
          ),
        );
      } else if (nextPage >= 5) {
        setExtHasMore(false);
        setExtMoreFeedback(
          pickText(
            "All available matching tracks are loaded",
            "تمام نتایج مرتبط برای این جستجو نمایش داده شدند",
          ),
        );
      } else {
        setExtMoreFeedback(
          pickText(
            "Tap again to try another search variation",
            "نتیجه جدیدی در این بخش نبود؛ دوباره بزنید تا جستجوی بعدی انجام شود",
          ),
        );
      }
    } catch {
      setExtMoreFeedback(
        pickText("Could not load more tracks right now", "خطا در بارگذاری آهنگ‌های بیشتر"),
      );
    } finally {
      setExtLoadingMore(false);
    }
  };

  const handleCategoryClick = (catQuery: string) => {
    setInputValue(catQuery);
    setDebouncedQuery(catQuery);
    syncUrl(catQuery, searchSource, extSubSource);
    saveRecentSearch(catQuery);
  };

  // Top result candidate for local search
  const topResult = useMemo(() => {
    if (!debouncedQuery.trim() || localTracks.length === 0) return null;
    return localTracks[0];
  }, [debouncedQuery, localTracks]);

  const displayedExternalTracks = useMemo(
    () => (extSortMode === "releaseDate" ? sortExternalTracksByReleaseDate(externalTracks) : externalTracks),
    [externalTracks, extSortMode],
  );

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

        {/* Primary Source Switcher: Local Catalog vs Online Streams (Only visible when user has global access) */}
        {canAccessGlobal && (
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
        )}

        {/* Large Apple Search Pill */}
        <form onSubmit={handleSearchSubmit} role="search" className="max-w-2xl">
          <SearchField
            ref={inputRef}
            aria-label={t("navSearch")}
            loading={localLoading || externalLoading}
            placeholder={activePlaceholder}
            value={inputValue}
            onValueChange={handleInputChange}
          />
        </form>

        {/* Sub-Filters: Mood filter for Local, or Service filter for External */}
        {(!canAccessGlobal || searchSource === "local") ? (
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
            <div className="w-full sm:flex-1 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
              <span className="text-[11px] font-bold text-[var(--sf-muted)] shrink-0">
                {pickText("Source:", "منبع:")}
              </span>
              <GlassSegmented
                aria-label="External Channel"
                size="sm"
                fullWidth
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
      {(!canAccessGlobal || searchSource === "local") && (
        <>
          {/* Recent Searches Pills (Apple HIG Tag Cloud) */}
          {recentSearches.length > 0 && !inputValue.trim() && (
            <section aria-label="Recent Searches" className="space-y-3 sf-fade-up">
              <div className="flex items-center justify-between">
                <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-[var(--sf-muted)]">
                  <ClockCounterClockwiseIcon size={18} weight="bold" className="text-indigo-500" aria-hidden="true" />
                  <span>{pickText("Recent Searches", "جستجوهای اخیر")}</span>
                </h2>
                <button
                  type="button"
                  onClick={clearAllRecentSearches}
                  className="text-xs font-semibold text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  {pickText("Clear All", "پاک کردن همه")}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {recentSearches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setInputValue(item);
                      setDebouncedQuery(item);
                      syncUrl(item, searchSource, extSubSource);
                    }}
                    className="sf-press group inline-flex items-center gap-2 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.14] border border-black/[0.06] dark:border-white/[0.08] px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all cursor-pointer select-none"
                  >
                    <span className="truncate">{item}</span>
                    <span
                      onClick={(e) => removeRecentSearch(item, e)}
                      role="button"
                      aria-label={`Remove ${item}`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[var(--sf-muted)] hover:text-rose-500 transition-colors"
                    >
                      <XIcon size={11} weight="bold" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

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
                    className={`sf-press group relative h-24 sm:h-28 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden text-start select-none cursor-pointer shadow-sm active:scale-[0.98] transition-all bg-gradient-to-br ${cat.gradient}`}
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-black/10 group-hover:bg-transparent transition-opacity"
                    />
                    <span className="text-2xl sm:text-3xl transition-transform duration-300 group-hover:scale-110">{cat.icon}</span>
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
                <div
                  key={i}
                  className="rounded-2xl p-3 flex flex-col gap-2.5 bg-white/40 dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.05] animate-pulse"
                >
                  <div className="aspect-square w-full rounded-xl bg-black/10 dark:bg-white/10" />
                  <div className="h-4 w-3/4 rounded-full bg-black/10 dark:bg-white/10 mt-1" />
                  <div className="h-3 w-1/2 rounded-full bg-black/5 dark:bg-white/5" />
                </div>
              ))}
            </div>
          ) : localTracks.length === 0 ? (
            <Glass className="rounded-3xl p-8 sm:p-12 text-center space-y-3 opacity-90">
              <MagnifyingGlassIcon size={40} weight="duotone" className="mx-auto text-[var(--sf-muted)]" aria-hidden="true" />
              <p className="text-base font-bold">{t("searchEmpty")}</p>
              <p className="text-xs text-[var(--sf-muted)] max-w-xs mx-auto leading-relaxed">
                {pickText(
                  "Try another artist, track title, or album name.",
                  "نام خواننده، آهنگ یا آلبوم را با عبارت دیگری جستجو کنید.",
                )}
              </p>
              {canAccessGlobal && (
                <div className="pt-2 flex justify-center">
                  <Button
                    type="button"
                    variant="glass"
                    onClick={() => handleSourceChange("external")}
                    icon={<GlobeHemisphereWestIcon size={16} className="text-emerald-500 shrink-0" aria-hidden="true" />}
                    className="max-w-full !px-5 text-xs font-bold"
                  >
                    {pickText("Search Global Streams", "جستجو در پخش جهانی")}
                  </Button>
                </div>
              )}
            </Glass>
          ) : (
            <div className="space-y-6">
              {/* Top Result spotlight */}
              {topResult && (debouncedQuery.trim() || inputValue.trim()) && (
                <section aria-label="Top Result" className="space-y-3">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--sf-muted)]">
                    <span>{t("heroBadge")}</span>
                  </h2>
                  <div
                    onClick={() => {
                      playTrack(topResult, localTracks);
                      setExpanded(true);
                      if (inputValue.trim()) saveRecentSearch(inputValue.trim());
                    }}
                    className="sf-content-card sf-press rounded-3xl p-4 sm:p-5 flex items-center gap-4 relative overflow-hidden cursor-pointer group hover:border-indigo-500/35 transition-all"
                  >
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
                      className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl object-cover shadow-md shrink-0 relative z-10 transition-transform duration-300 group-hover:scale-105"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            playTrack(topResult, localTracks);
                            if (inputValue.trim()) saveRecentSearch(inputValue.trim());
                          }}
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
                          onClick={(e) => e.stopPropagation()}
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
                  <VirtualizedTrackGrid
                    tracks={localTracks}
                    queue={localTracks}
                    playlists={playlists}
                    autoExpand={true}
                  />
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* SOURCE 2: ONLINE EXTERNAL STREAMS (YOUTUBE / SOUNDCLOUD / SPOTIFY) */}
      {/* ========================================================================= */}
      {canAccessGlobal && searchSource === "external" && (
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                  <GlobeHemisphereWestIcon size={20} weight="duotone" className="text-emerald-500" aria-hidden="true" />
                  <span>
                    {pickText("Worldwide Streams", "نتایج پخش آنلاین")}
                  </span>
                </h2>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => void handleRefreshExternalSearch()}
                    disabled={extRefreshing || externalLoading}
                    aria-label={pickText("Refresh results", "بروزرسانی نتایج")}
                    className="sf-press inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] border border-black/[0.06] dark:border-white/[0.1] px-3 py-1.5 min-h-[36px] text-[11px] font-bold text-[var(--sf-text)] cursor-pointer transition-colors disabled:opacity-55"
                  >
                    <ArrowsClockwiseIcon
                      size={13}
                      weight="bold"
                      className={`text-emerald-500 shrink-0 ${extRefreshing || externalLoading ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    <span>{pickText("Refresh", "بروزرسانی")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExtSortMode((prev) => (prev === "releaseDate" ? "relevance" : "releaseDate"))
                    }
                    className="sf-press inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] border border-black/[0.06] dark:border-white/[0.1] px-3 py-1.5 min-h-[36px] text-[11px] font-bold text-[var(--sf-text)] cursor-pointer transition-colors"
                  >
                    {extSortMode === "releaseDate" ? (
                      <ClockCounterClockwiseIcon size={13} weight="bold" className="text-emerald-500 shrink-0" aria-hidden="true" />
                    ) : (
                      <SparkleIcon size={13} weight="bold" className="text-indigo-500 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {extSortMode === "releaseDate"
                        ? pickText("Newest First", "جدیدترین (تاریخ انتشار)")
                        : pickText("Most Relevant", "مرتبط‌ترین")}
                    </span>
                  </button>
                  <span className="text-xs text-[var(--sf-muted)] font-medium">
                    {formatNum(displayedExternalTracks.length)} {t("tracksCount")}
                  </span>
                </div>
              </div>

              {/* Apple Music Scannable Compact Track Rows */}
              <div
                className={`sf-stagger grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 transition-opacity duration-200 ${
                  externalLoading || extRefreshing ? "opacity-60" : "opacity-100"
                }`}
              >
                {displayedExternalTracks.map((tr) => (
                  <ExternalTrackCard
                    key={tr.id}
                    track={tr}
                    queue={displayedExternalTracks}
                    autoExpand={true}
                  />
                ))}
              </div>

              {/* Load More External Tracks & Discovery Status */}
              <div className="pt-2 flex flex-col items-center gap-2">
                {extMoreFeedback && (
                  <p className="text-xs text-[var(--sf-muted)] text-center">{extMoreFeedback}</p>
                )}
                {extHasMore && (
                  <Button
                    type="button"
                    variant="glass"
                    disabled={extLoadingMore || externalLoading}
                    onClick={() => void handleLoadMoreExternal()}
                    className="w-full sm:w-auto sm:min-w-[260px] !min-h-[48px] !px-6 text-xs sm:text-sm font-bold justify-center"
                    icon={
                      extLoadingMore ? (
                        <CircleNotchIcon size={17} className="animate-spin text-emerald-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <PlusCircleIcon size={17} weight="bold" className="text-emerald-500 shrink-0" aria-hidden="true" />
                      )
                    }
                  >
                    {extLoadingMore
                      ? pickText("Finding more tracks...", "در حال یافتن آهنگ‌های بیشتر...")
                      : pickText("Load More Tracks", "بارگذاری آهنگ‌های بیشتر")}
                  </Button>
                )}
              </div>
            </section>
          )}
        </div>
      )}
      {/* Global Search Access Required Modal (Apple HIG Style) */}
      <dialog
        ref={accessDialogRef}
        {...({ closedby: "any" } as Record<string, string>)}
        aria-labelledby="global-access-dialog-title"
        className="sf-dialog max-w-md w-[92vw]"
        onClose={() => setAccessModalOpen(false)}
      >
        <div className="p-6 sm:p-7 space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/25 shadow-lg shadow-amber-500/10">
            <LockSimpleIcon size={32} weight="duotone" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h2 id="global-access-dialog-title" className="text-lg sm:text-xl font-black">
              {pickText("Global Search Access Required", "دسترسی به جستجوی شبکه‌های جهانی")}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--sf-muted)] leading-relaxed">
              {pickText(
                "Access to external music sources (YouTube, SoundCloud, Spotify) requires administrator authorization.",
                "جستجو و پخش از سرورهای جهانی (یوتیوب، ساندکلود و اسپاتیفای) نیازمند تایید و فعال‌سازی توسط مدیر سیستم است."
              )}
            </p>
          </div>

          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-3.5 text-xs text-start space-y-1.5">
            {user ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--sf-muted)]">{pickText("Account:", "حساب کاربری:")}</span>
                  <span className="font-semibold text-white">@{user.username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--sf-muted)]">{pickText("Status:", "وضعیت دسترسی:")}</span>
                  <span className="font-bold text-amber-400">{pickText("Pending Admin Approval", "در انتظار تایید مدیر")}</span>
                </div>
                <p className="text-[11px] text-[var(--sf-muted)] pt-1 border-t border-white/[0.06]">
                  {pickText(
                    "Please contact your administrator to activate global search permission for your account.",
                    "برای فعال‌سازی این قابلیت، از مدیر سیستم درخواست کنید تا دسترسی جستجوی جهانی را برای شما فعال کند."
                  )}
                </p>
              </>
            ) : (
              <p className="text-center text-[var(--sf-muted)]">
                {pickText(
                  "Please sign in to your account first so the administrator can verify your access.",
                  "جهت دسترسی، ابتدا وارد حساب کاربری خود شوید تا مدیر امکان تایید دسترسی شما را داشته باشد."
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
            {!user ? (
              <Button
                type="button"
                variant="filled"
                className="w-full justify-center text-xs font-bold"
                onClick={() => {
                  setAccessModalOpen(false);
                  openAuthDialog();
                }}
              >
                {t("signIn")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={user ? "filled" : "glass"}
              className="w-full justify-center text-xs font-bold"
              onClick={() => setAccessModalOpen(false)}
            >
              {pickText("Got it", "متوجه شدم")}
            </Button>
          </div>
        </div>
      </dialog>
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

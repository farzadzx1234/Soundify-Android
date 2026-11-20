"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  CheckCircleIcon,
  CheckSquareIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  EyeIcon,
  GlobeHemisphereWestIcon,
  HeartIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  MusicNotesPlusIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlaylistIcon,
  ShieldCheckIcon,
  SparkleIcon,
  SquareIcon,
  TrashIcon,
  UserIcon,
  WaveformIcon,
  XIcon,
  ChatCircleTextIcon,
} from "@phosphor-icons/react";
import { Button, Glass, GlassSegmented, Input, SearchField, Switch } from "@/components/GlassControls";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { api, getApiToken } from "@/lib/api";
import type { AdminStats, AdminUser, AdminUserDetails, ExternalMusicSource, ExternalTrackCandidate, Track } from "@/lib/types";

const QUICK_QUERIES = ["همایون شجریان", "محسن چاوشی", "علیرضا قربانی", "هایده", "Homayoun Shajarian"];

export default function AdminPage() {
  const { user, login, logout } = useAuth();
  const { t, pickText, formatNum } = useI18n();
  const { playTrack, isPlaying, togglePlay } = usePlayer();

  // Admin Login Form
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin Tabs & Catalog
  const [tab, setTab] = useState<"search" | "catalog" | "users">("search");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [catalogTracks, setCatalogTracks] = useState<Track[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);

  // Admin Users State
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState<number>(0);
  const [usersQuery, setUsersQuery] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState<"all" | "user" | "creator" | "admin">("all");
  const [usersBusy, setUsersBusy] = useState(false);
  const [userActionStatus, setUserActionStatus] = useState<string | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<AdminUserDetails | null>(null);
  const [userRoleModal, setUserRoleModal] = useState<{ userId: string; username: string; currentRole: "user" | "creator" | "admin" } | null>(null);
  const [newRole, setNewRole] = useState<"user" | "creator" | "admin">("user");
  const [usersError, setUsersError] = useState<string | null>(null);

  // External Music Search
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<ExternalMusicSource>("all");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ExternalTrackCandidate[]>([]);
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});

  // Audio Preview in Admin Search
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Per-candidate Import & Inline Override State
  const [importedTracks, setImportedTracks] = useState<Record<string, Track>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [expandedCustomizeId, setExpandedCustomizeId] = useState<string | null>(null);
  const [downloadStatuses, setDownloadStatuses] = useState<
    Record<
      string,
      {
        jobId?: string;
        stage: "idle" | "queued" | "downloading" | "processing" | "lyrics" | "completed" | "error";
        progress: number;
        stageFa: string;
        error?: string;
      }
    >
  >({});
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  // Search More / Pagination State
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchLimit, setSearchLimit] = useState(15);
  const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);

  const isBatchRunning = useMemo(() => {
    return Array.from(selectedCandidateIds).some((id) => {
      const s = downloadStatuses[id];
      return s && s.stage !== "completed" && s.stage !== "error" && s.stage !== "idle";
    });
  }, [selectedCandidateIds, downloadStatuses]);
  const [customDrafts, setCustomDrafts] = useState<
    Record<
      string,
      {
        title: string;
        titleFa: string;
        artistName: string;
        artistNameFa: string;
        album: string;
        genre: string;
        mood: string;
        accentColor: string;
        autoFetchLyrics: boolean;
        lrcContent: string;
      }
    >
  >({});

  // Catalog Inline Edit State
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    titleFa: string;
    artistName: string;
    artistNameFa: string;
    genre: string;
    mood: string;
  }>({ title: "", titleFa: "", artistName: "", artistNameFa: "", genre: "", mood: "" });
  const [catalogStatus, setCatalogStatus] = useState<string | null>(null);

  // Catalog Lyrics Manager Modal State
  const [lyricsTrack, setLyricsTrack] = useState<Track | null>(null);
  const [lyricsCustomTitle, setLyricsCustomTitle] = useState("");
  const [lyricsCustomArtist, setLyricsCustomArtist] = useState("");
  const [lyricsLrcText, setLyricsLrcText] = useState("");
  const [lyricsActionBusy, setLyricsActionBusy] = useState(false);
  const [lyricsActionStatus, setLyricsActionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!lyricsTrack) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLyricsTrack(null);
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lyricsTrack]);

  // Admin Proxy Configuration State
  const [proxyInput, setProxyInput] = useState("");
  const [proxySaved, setProxySaved] = useState("");
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const [proxyMsg, setProxyMsg] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const loadCatalog = useCallback(
    async (q = "") => {
      if (!isAdmin) return;
      setCatalogBusy(true);
      try {
        const res = await api.adminGetTracks(q);
        setCatalogTracks(res.tracks);
        setStats(res.stats);
      } catch {
        // handled gracefully
      } finally {
        setCatalogBusy(false);
      }
    },
    [isAdmin],
  );

  const loadUsers = useCallback(
    async (q = usersQuery, role = usersRoleFilter) => {
      if (!isAdmin) return;
      setUsersBusy(true);
      setUsersError(null);
      try {
        const res = await api.adminGetUsers({ q, role: role === "all" ? undefined : role });
        setAdminUsers(res.users);
        setUsersTotal(res.total);
      } catch (err) {
        setUsersError(err instanceof Error ? err.message : pickText("خطا در بارگذاری فهرست کاربران", "Failed to load users list"));
      } finally {
        setUsersBusy(false);
      }
    },
    [isAdmin, usersQuery, usersRoleFilter, pickText],
  );

  useEffect(() => {
    if (tab === "users" && isAdmin) {
      void loadUsers();
    }
  }, [tab, isAdmin, loadUsers]);

  const handleUpdateRole = async (userId: string, targetRole: "user" | "creator" | "admin") => {
    try {
      await api.adminUpdateUserRole(userId, targetRole);
      setUserActionStatus(pickText("نقش کاربر با موفقیت به‌روزرسانی شد", "User role updated successfully"));
      setUserRoleModal(null);
      void loadUsers();
    } catch (err) {
      setUserActionStatus(err instanceof Error ? err.message : pickText("تغییر نقش ناموفق بود", "Failed to update role"));
    }
  };

  const handleToggleStatus = async (userId: string, currentActive: boolean) => {
    try {
      await api.adminUpdateUserStatus(userId, !currentActive);
      setUserActionStatus(
        !currentActive
          ? pickText("حساب کاربری با موفقیت فعال شد", "Account activated successfully")
          : pickText("حساب کاربری با موفقیت غیرفعال شد", "Account deactivated successfully")
      );
      void loadUsers();
    } catch (err) {
      setUserActionStatus(err instanceof Error ? err.message : pickText("تغییر وضعیت ناموفق بود", "Failed to update status"));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await api.adminDeleteUser(userId);
      setConfirmDeleteUserId(null);
      if (selectedUserForDetails?.user.id === userId) {
        setSelectedUserForDetails(null);
      }
      setUserActionStatus(pickText("کاربر با موفقیت از سیستم حذف شد", "User deleted successfully"));
      void loadUsers();
    } catch (err) {
      setUserActionStatus(err instanceof Error ? err.message : pickText("حذف کاربر ناموفق بود", "Failed to delete user"));
    }
  };

  const handleOpenUserDetails = async (userId: string) => {
    try {
      const details = await api.adminGetUserDetails(userId);
      setSelectedUserForDetails(details);
    } catch {
      // handled
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api
      .adminGetTracks("")
      .then((res) => {
        if (!active) return;
        setCatalogTracks(res.tracks);
        setStats(res.stats);
      })
      .catch(() => {
        // handled gracefully
      });

    api
      .adminGetProxy()
      .then((res) => {
        if (!active) return;
        setProxyInput(res.proxy || "");
        setProxySaved(res.proxy || "");
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const handleSaveProxy = async (overrideValue?: string) => {
    const valToSave = overrideValue !== undefined ? overrideValue : proxyInput.trim();
    setProxySaving(true);
    setProxyMsg(null);
    setProxyTestResult(null);
    try {
      const res = await api.adminSaveProxy(valToSave);
      setProxySaved(res.proxy);
      setProxyInput(res.proxy);
      setProxyMsg(res.proxy ? "پروکسی با موفقیت ذخیره شد." : "پروکسی پاک شد.");
    } catch (err) {
      setProxyMsg(err instanceof Error ? err.message : "خطا در ذخیره پروکسی");
    } finally {
      setProxySaving(false);
    }
  };

  const handleTestProxy = async () => {
    setProxyTesting(true);
    setProxyTestResult(null);
    setProxyMsg(null);
    try {
      const res = await api.adminTestProxy(proxyInput.trim() || undefined);
      setProxyTestResult(res);
    } catch (err) {
      setProxyTestResult({ ok: false, message: err instanceof Error ? err.message : "تست ناموفق بود" });
    } finally {
      setProxyTesting(false);
    }
  };

  useEffect(() => {
    const audioEl = previewAudioRef.current;
    if (!audioEl) return;
    const onEnded = () => setPreviewingId(null);
    const onError = () => setPreviewingId(null);
    audioEl.addEventListener("ended", onEnded);
    audioEl.addEventListener("error", onError);
    return () => {
      audioEl.removeEventListener("ended", onEnded);
      audioEl.removeEventListener("error", onError);
      audioEl.pause();
    };
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      await login(identifier.trim(), password);
      setPassword("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setAuthBusy(false);
    }
  };

  const runSearch = async (queryOverride?: string, sourceOverride?: ExternalMusicSource) => {
    const q = (queryOverride ?? searchQuery).trim();
    const activeSource = sourceOverride ?? sourceFilter;
    if (queryOverride !== undefined) setSearchQuery(queryOverride);
    if (q.length < 2) return;

    setSearching(true);
    setSearchError(null);
    setImportError(null);
    setLoadMoreMessage(null);
    setSearchLimit(15);
    const isYtDlp = activeSource === "youtube" || activeSource === "soundcloud" || activeSource === "spotify";
    try {
      if (isYtDlp) {
        const res = await api.adminYtDlpSearch(q, activeSource, 15);
        setCandidates(res.results);
        setProviderErrors(res.error ? { [activeSource]: res.error } : {});
      } else {
        const res = await api.adminExternalSearch(q, activeSource, 20);
        setCandidates(res.results);
        setProviderErrors(res.errors);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setSearching(false);
    }
  };

  const handleSearchMore = async () => {
    const q = searchQuery.trim();
    if (q.length < 2 || loadingMore || searching) return;
    const newLimit = searchLimit + 15;
    setLoadingMore(true);
    setSearchError(null);
    setLoadMoreMessage(null);
    const activeSource = sourceFilter;
    const isYtDlp = activeSource === "youtube" || activeSource === "soundcloud" || activeSource === "spotify";
    try {
      if (isYtDlp) {
        const res = await api.adminYtDlpSearch(q, activeSource, newLimit);
        setCandidates((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const existingTitles = new Set(prev.map((c) => c.title.toLowerCase().trim()));
          const fresh = res.results.filter((c) => !existingIds.has(c.id) && !existingTitles.has(c.title.toLowerCase().trim()));
          if (fresh.length === 0) {
            setLoadMoreMessage("تمام نتایج در دسترس دریافت شده است");
          } else {
            setLoadMoreMessage(`${fresh.length} آهنگ جدید به نتایج اضافه شد`);
          }
          return [...prev, ...fresh];
        });
        if (res.error) {
          setProviderErrors({ [activeSource]: res.error });
        }
      } else {
        const res = await api.adminExternalSearch(q, activeSource, newLimit);
        setCandidates((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const existingTitles = new Set(prev.map((c) => c.title.toLowerCase().trim()));
          const fresh = res.results.filter((c) => !existingIds.has(c.id) && !existingTitles.has(c.title.toLowerCase().trim()));
          if (fresh.length === 0) {
            setLoadMoreMessage("تمام نتایج در دسترس دریافت شده است");
          } else {
            setLoadMoreMessage(`${fresh.length} آهنگ جدید به نتایج اضافه شد`);
          }
          return [...prev, ...fresh];
        });
        setProviderErrors(res.errors);
      }
      setSearchLimit(newLimit);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "خطا در دریافت نتایج بیشتر");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelectCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCandidates = () => {
    if (selectedCandidateIds.size === candidates.length) {
      setSelectedCandidateIds(new Set());
    } else {
      setSelectedCandidateIds(new Set(candidates.map((c) => c.id)));
    }
  };

  const pollImportJob = useCallback(
    (candidateId: string, jobId: string) => {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 120) {
          clearInterval(interval);
          setDownloadStatuses((prev) => ({
            ...prev,
            [candidateId]: {
              stage: "error",
              progress: 0,
              stageFa: "پایان مهلت دانلود",
              error: "عملیات با تاخیر مواجه شد",
            },
          }));
          return;
        }

        try {
          const { job } = await api.adminGetImportJob(jobId);
          if (!job) return;

          setDownloadStatuses((prev) => ({
            ...prev,
            [candidateId]: {
              jobId,
              stage: job.status,
              progress: job.progress,
              stageFa: job.stageFa || "در حال انجام...",
              error: job.error,
            },
          }));

          if (job.status === "completed") {
            clearInterval(interval);
            const importedTrack = job.track;
            if (importedTrack) {
              setImportedTracks((prev) => ({ ...prev, [candidateId]: importedTrack }));
              setCatalogTracks((prev) => {
                if (prev.some((t) => t.id === importedTrack.id)) return prev;
                return [importedTrack, ...prev];
              });
              setStats((prev) => (prev ? { ...prev, totalTracks: prev.totalTracks + 1 } : prev));
            }
          } else if (job.status === "error") {
            clearInterval(interval);
          }
        } catch {
          clearInterval(interval);
        }
      }, 500);
    },
    [],
  );

  const togglePreview = async (item: ExternalTrackCandidate) => {
    const audioEl = previewAudioRef.current;
    if (!audioEl) return;

    if (previewingId === item.id) {
      audioEl.pause();
      setPreviewingId(null);
      return;
    }

    if (isPlaying) {
      togglePlay();
    }

    let audioUrl = item.audioUrl;
    if (!audioUrl && (item.pageUrl || (item as unknown as { url?: string }).url)) {
      setResolvingId(item.id);
      try {
        const targetPage = item.pageUrl || (item as unknown as { url?: string }).url || "";
        const resolved = await api.adminPreviewResolve(targetPage);
        if (resolved.audioUrl) {
          audioUrl = resolved.audioUrl;
          setCandidates((prev) =>
            prev.map((c) =>
              c.id === item.id
                ? {
                    ...c,
                    audioUrl: resolved.audioUrl,
                    coverUrl: resolved.coverUrl ?? c.coverUrl,
                    title: resolved.title ?? c.title,
                    artistName: resolved.artistName ?? c.artistName,
                  }
                : c,
            ),
          );
        }
      } catch {
        // show error
      } finally {
        setResolvingId(null);
      }
    }

    if (!audioUrl) {
      const fallbackUrl = item.pageUrl || (item as unknown as { url?: string }).url;
      if (fallbackUrl) {
        audioUrl = fallbackUrl;
      } else {
        setImportError(t("actionFailed"));
        return;
      }
    }

    const token = getApiToken();
    const streamUrl = `/api/admin/preview-stream?url=${encodeURIComponent(audioUrl)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    audioEl.src = streamUrl;
    try {
      await audioEl.play();
      setPreviewingId(item.id);
    } catch {
      setPreviewingId(null);
      setImportError(t("actionFailed"));
    }
  };

  const getDraft = (item: ExternalTrackCandidate) => {
    const isRap = /rap|hiphop|hip-hop|رپ|هیپ/i.test(item.genre);
    const isTrad = /traditional|سنتی/i.test(item.genre);
    return (
      customDrafts[item.id] ?? {
        title: item.title,
        titleFa: item.titleFa,
        artistName: item.artistName,
        artistNameFa: item.artistNameFa,
        album: item.album,
        genre: item.genre,
        mood: isTrad ? "Soulful" : isRap ? "Midnight" : "Chill",
        accentColor: "#6366F1",
        autoFetchLyrics: true,
        lrcContent: "",
      }
    );
  };

  const updateDraft = (id: string, patch: Partial<ReturnType<typeof getDraft>>, base: ExternalTrackCandidate) => {
    setCustomDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? getDraft(base)),
        ...patch,
      },
    }));
  };

  const handleImport = async (item: ExternalTrackCandidate) => {
    setImportError(null);
    const draft = getDraft(item);

    setDownloadStatuses((prev) => ({
      ...prev,
      [item.id]: {
        stage: "queued",
        progress: 10,
        stageFa: "در صف دانلود...",
      },
    }));

    try {
      const res = await api.adminStartImport({
        candidate: item,
        draft: {
          title: draft.title.trim() || item.title,
          titleFa: draft.titleFa.trim() || item.titleFa,
          artistName: draft.artistName.trim() || item.artistName,
          artistNameFa: draft.artistNameFa.trim() || item.artistNameFa,
          album: draft.album.trim() || item.album,
          albumFa: item.albumFa,
          genre: draft.genre.trim() || item.genre,
          mood: draft.mood.trim() || "Chill",
          accentColor: draft.accentColor,
          autoFetchLyrics: draft.autoFetchLyrics,
          lrcContent: draft.lrcContent.trim() || undefined,
        },
      });

      const jobId = res.jobId;
      setDownloadStatuses((prev) => ({
        ...prev,
        [item.id]: {
          jobId,
          stage: "queued",
          progress: 15,
          stageFa: "در صف دانلود...",
        },
      }));

      pollImportJob(item.id, jobId);
    } catch (err) {
      setDownloadStatuses((prev) => ({
        ...prev,
        [item.id]: {
          stage: "error",
          progress: 0,
          stageFa: "خطا در شروع دانلود",
          error: err instanceof Error ? err.message : t("actionFailed"),
        },
      }));
    }
  };

  const handleBatchDownload = async () => {
    const selectedItems = candidates.filter(
      (c) =>
        selectedCandidateIds.has(c.id) &&
        !importedTracks[c.id] &&
        (!downloadStatuses[c.id] ||
          downloadStatuses[c.id].stage === "idle" ||
          downloadStatuses[c.id].stage === "error"),
    );
    if (selectedItems.length === 0) return;

    for (const item of selectedItems) {
      void handleImport(item);
    }
  };

  const startEditTrack = (track: Track) => {
    setEditingTrackId(track.id);
    setEditDraft({
      title: track.title,
      titleFa: track.titleFa,
      artistName: track.artistName,
      artistNameFa: track.artistNameFa,
      genre: track.genre,
      mood: track.mood,
    });
  };

  const saveEditTrack = async (id: string) => {
    try {
      const res = await api.adminUpdateTrack(id, editDraft);
      setCatalogTracks((prev) => prev.map((tr) => (tr.id === id ? res.track : tr)));
      setEditingTrackId(null);
      setCatalogStatus(t("adminTrackUpdated"));
    } catch (err) {
      setCatalogStatus(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const openLyricsModal = async (track: Track) => {
    setLyricsTrack(track);
    setLyricsCustomTitle(track.title);
    setLyricsCustomArtist(track.artistName);
    setLyricsActionBusy(true);
    setLyricsActionStatus(null);
    try {
      const res = await api.getLyrics(track.id);
      setLyricsLrcText(res.lrcContent || "");
    } catch {
      setLyricsLrcText("");
    } finally {
      setLyricsActionBusy(false);
    }
  };

  const handleFetchLyricsForTrack = async () => {
    if (!lyricsTrack) return;
    setLyricsActionBusy(true);
    setLyricsActionStatus(null);
    try {
      const res = await api.autoFetchLyrics(lyricsTrack.id, {
        forceRefresh: true,
        queryTitle: lyricsCustomTitle.trim() || undefined,
        queryArtist: lyricsCustomArtist.trim() || undefined,
      });
      if (res.found && res.lrcContent) {
        setLyricsLrcText(res.lrcContent);
        setLyricsActionStatus(`یافت شد (${res.source}) و ذخیره گردید.`);
        setCatalogTracks((prev) =>
          prev.map((tr) => (tr.id === lyricsTrack.id ? { ...tr, hasLyrics: true, lyricsSource: res.source } : tr)),
        );
      } else {
        setLyricsActionStatus("در LRCLIB یافت نشد. می‌توانید متن را دستی وارد یا ویرایش کنید.");
      }
    } catch (err) {
      setLyricsActionStatus(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLyricsActionBusy(false);
    }
  };

  const handleSaveManualLyrics = async () => {
    if (!lyricsTrack) return;
    setLyricsActionBusy(true);
    setLyricsActionStatus(null);
    try {
      await api.saveLyrics(lyricsTrack.id, lyricsLrcText, "manual");
      setLyricsActionStatus("متن لایریک با موفقیت ذخیره شد!");
      setCatalogTracks((prev) =>
        prev.map((tr) =>
          tr.id === lyricsTrack.id
            ? { ...tr, hasLyrics: lyricsLrcText.trim().length > 0, lyricsSource: "manual" }
            : tr,
        ),
      );
    } catch (err) {
      setLyricsActionStatus(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLyricsActionBusy(false);
    }
  };

  const handleDeleteTrack = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await api.adminDeleteTrack(id);
      setCatalogTracks((prev) => prev.filter((tr) => tr.id !== id));
      setCatalogStatus(t("adminTrackDeleted") || "آهنگ با موفقیت حذف شد");
      void loadCatalog(catalogQuery);
    } catch {
      setCatalogStatus(t("actionFailed"));
    }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md py-10 sf-fade-up">
        <Glass className="rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
              <ShieldCheckIcon size={26} weight="fill" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-black">{t("adminLoginTitle")}</h1>
              <p className="text-xs opacity-75">{t("adminLoginDesc")}</p>
            </div>
          </div>

          {user && user.role !== "admin" && (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/15 px-3.5 py-2.5 text-xs flex items-center justify-between gap-2">
              <span>
                {user.displayName} ({user.role})
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="font-bold underline cursor-pointer"
              >
                {t("signOut")}
              </button>
            </div>
          )}

          {authError && (
            <div role="alert" className="rounded-2xl border border-rose-500/35 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200">
              {authError}
            </div>
          )}

          <form onSubmit={(e) => void handleAdminLogin(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-user" className="block text-xs font-semibold opacity-80">
                {t("usernameOrEmail")}
              </label>
              <Input
                id="admin-user"
                required
                autoComplete="username"
                icon={<UserIcon size={16} aria-hidden="true" />}
                placeholder="admin"
                value={identifier}
                onValueChange={setIdentifier}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-pass" className="block text-xs font-semibold opacity-80">
                {t("password")}
              </label>
              <Input
                id="admin-pass"
                type="password"
                required
                autoComplete="current-password"
                icon={<LockKeyIcon size={16} aria-hidden="true" />}
                placeholder="••••••••"
                value={password}
                onValueChange={setPassword}
              />
            </div>

            <Button
              type="submit"
              variant="filled"
              tint="#4F46E5"
              disabled={authBusy}
              icon={<ShieldCheckIcon size={18} weight="bold" aria-hidden="true" />}
              className="w-full justify-center"
            >
              {authBusy ? "..." : t("signIn")}
            </Button>
          </form>
        </Glass>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 sf-fade-up">
      <audio
        ref={previewAudioRef}
        preload="none"
        onEnded={() => setPreviewingId(null)}
        onError={() => setPreviewingId(null)}
      />

      {/* Admin Hero Header */}
      <Glass className="rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg">
              <ShieldCheckIcon size={26} weight="fill" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-black">{t("adminTitle")}</h1>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  {user.username}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[var(--sf-muted)] max-w-2xl">{t("adminDesc")}</p>
            </div>
          </div>

          <GlassSegmented
            aria-label="Admin sections"
            value={tab}
            onValueChange={(v) => setTab(v as "search" | "catalog" | "users")}
            items={[
              { value: "search", label: t("adminSearchTab") },
              { value: "catalog", label: `${t("adminCatalogTab")} (${formatNum(stats?.totalTracks ?? catalogTracks.length)})` },
              { value: "users", label: `${pickText("کاربران", "Users")} (${formatNum(usersTotal || adminUsers.length)})` },
            ]}
          />
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t("adminTracksStat"), val: stats.totalTracks, color: "text-indigo-500" },
              { label: t("adminArtistsStat"), val: stats.totalArtists, color: "text-violet-500" },
              { label: t("adminPlaysStat"), val: stats.totalPlays, color: "text-pink-500" },
              { label: t("adminLyricsStat"), val: stats.tracksWithLyrics, color: "text-emerald-500" },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-2xl bg-[var(--sf-subtle)] px-4 py-3">
                <p className="text-xs text-[var(--sf-muted)]">{kpi.label}</p>
                <p className={`text-xl sm:text-2xl font-black mt-0.5 ${kpi.color}`}>{formatNum(kpi.val)}</p>
              </div>
            ))}
          </div>
        )}
      </Glass>

      {/* Admin Proxy Configuration Card */}
      <Glass className="rounded-3xl p-5 sm:p-6 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
              <GlobeHemisphereWestIcon size={22} weight="duotone" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                {t("adminProxyTitle")}
                {proxySaved ? (
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {t("adminProxyActive")}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                    {t("adminProxyDirect")}
                  </span>
                )}
              </h2>
              <p className="text-xs text-[var(--sf-muted)]">
                {t("adminProxyDescPrefix")}{" "}
                <code className="font-mono text-indigo-500 font-semibold">socks5://user:pass@ip:port</code>{" "}
                {t("adminProxyOr")}{" "}
                <code className="font-mono text-indigo-500 font-semibold">http://user:pass@ip:port</code>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              dir="ltr"
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
              placeholder={t("adminProxyPlaceholder")}
              aria-label="Proxy URL"
              style={{ outline: "none", border: "none", boxShadow: "none" }}
              className="w-full rounded-2xl px-3.5 py-2.5 text-xs bg-[var(--sf-subtle)] border border-black/[0.08] dark:border-white/[0.1] outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="filled"
              tint="#4F46E5"
              disabled={proxySaving}
              onClick={() => void handleSaveProxy()}
              className="text-xs min-h-[38px] px-4"
            >
              {proxySaving ? t("adminProxySaving") : t("adminProxySave")}
            </Button>
            <Button
              type="button"
              variant="glass"
              disabled={proxyTesting || (!proxyInput.trim() && !proxySaved)}
              onClick={() => void handleTestProxy()}
              className="text-xs min-h-[38px] px-3.5"
            >
              {proxyTesting ? t("adminProxyTesting") : t("adminProxyTest")}
            </Button>
            {proxySaved && (
              <Button
                type="button"
                variant="ghost"
                destructive
                onClick={() => {
                  setProxyInput("");
                  void handleSaveProxy("");
                }}
                className="text-xs min-h-[38px] px-3"
              >
                {t("adminProxyRemove")}
              </Button>
            )}
          </div>
        </div>

        {proxyMsg && (
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
            {proxyMsg}
          </p>
        )}

        {proxyTestResult && (
          <div
            className={`rounded-2xl px-3.5 py-2 text-xs flex items-center justify-between border ${
              proxyTestResult.ok
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-200"
                : "bg-rose-500/10 border-rose-500/25 text-rose-800 dark:text-rose-200"
            }`}
          >
            <span>{proxyTestResult.message}</span>
            {proxyTestResult.latencyMs && (
              <span className="font-mono font-bold text-[11px]">{proxyTestResult.latencyMs}ms</span>
            )}
          </div>
        )}
      </Glass>

      {tab === "search" ? (
        <section className="space-y-5">
          {/* Search Bar + Sources */}
          <Glass className="rounded-3xl p-4 sm:p-5 space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
            >
              <div className="flex-1 min-w-0">
                <SearchField
                  aria-label={t("adminSearchPlaceholder")}
                  placeholder={t("adminSearchPlaceholder")}
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
              </div>
              <Button
                type="submit"
                variant="filled"
                tint="#4F46E5"
                disabled={searching || searchQuery.trim().length < 2}
                icon={<MagnifyingGlassIcon size={18} weight="bold" aria-hidden="true" />}
              >
                {searching ? "..." : t("adminSearchBtn")}
              </Button>
            </form>

            <div className="flex flex-col gap-3">
              <div className="w-full max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5">
                <GlassSegmented
                  aria-label="External source"
                  size="sm"
                  value={sourceFilter}
                  onValueChange={(v) => {
                    const next = v as ExternalMusicSource;
                    setSourceFilter(next);
                    if (searchQuery.trim().length >= 2) {
                      void runSearch(searchQuery, next);
                    }
                  }}
                  items={[
                    { value: "all", label: t("adminAllSources") },
                    { value: "youtube", label: "YouTube" },
                    { value: "soundcloud", label: "SoundCloud" },
                    { value: "spotify", label: "Spotify / URL" },
                    { value: "golsarmusic", label: "گلسار موزیک" },
                    { value: "nex1music", label: "نکس وان" },
                    { value: "upmusics", label: "آپ موزیک" },
                    { value: "rozmusic", label: "رز موزیک" },
                    { value: "tabamusic", label: "تابا موزیک" },
                    { value: "popmusic", label: "پاپ موزیک" },
                    { value: "itunes", label: "iTunes" },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void runSearch(q)}
                    className="sf-btn rounded-full bg-[var(--sf-subtle)] px-3 py-1 text-xs font-semibold hover:bg-[var(--sf-subtle-hover)] cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {Object.keys(providerErrors).length > 0 && (
              <p className="text-[11px] opacity-65">
                Note: {Object.entries(providerErrors).map(([k, v]) => `${k}: ${v}`).join(" • ")}
              </p>
            )}
          </Glass>

          {(searchError || importError) && (
            <div role="alert" className="rounded-2xl border border-rose-500/35 bg-rose-500/15 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
              {searchError || importError}
            </div>
          )}

          {/* Search Results Grid */}
          {searching ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sf-content-card rounded-3xl p-4 h-44 animate-pulse" />
              ))}
            </div>
          ) : candidates.length > 0 ? (
            <div className="space-y-4">
              {/* Batch selection and action bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--sf-subtle)] p-3 border border-[var(--sf-border)]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllCandidates}
                    className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {selectedCandidateIds.size === candidates.length && candidates.length > 0 ? (
                      <CheckSquareIcon size={19} weight="fill" className="text-indigo-400" />
                    ) : (
                      <SquareIcon size={19} className="opacity-50" />
                    )}
                    <span>
                      {selectedCandidateIds.size === candidates.length && candidates.length > 0
                        ? "لغو انتخاب همه"
                        : "انتخاب همه"} ({candidates.length})
                    </span>
                  </button>

                  {selectedCandidateIds.size > 0 && (
                    <span className="text-xs text-indigo-400 font-bold bg-indigo-500/15 px-2.5 py-1 rounded-full">
                      {selectedCandidateIds.size} آهنگ انتخاب شد
                    </span>
                  )}
                </div>

                {selectedCandidateIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="filled"
                      tint="#4F46E5"
                      disabled={isBatchRunning}
                      onClick={() => void handleBatchDownload()}
                      icon={
                        isBatchRunning ? (
                          <CircleNotchIcon size={16} className="animate-spin" />
                        ) : (
                          <CloudArrowDownIcon size={17} weight="bold" />
                        )
                      }
                    >
                      {isBatchRunning ? "در حال دریافت همزمان..." : `دانلود موارد انتخاب‌شده (${selectedCandidateIds.size})`}
                    </Button>
                    <Button
                      type="button"
                      variant="glass"
                      onClick={() => setSelectedCandidateIds(new Set())}
                    >
                      لغو
                    </Button>
                  </div>
                )}
              </div>

              <div className="sf-stagger grid grid-cols-1 md:grid-cols-2 gap-4">
                {candidates.map((item) => {
                  const imported = importedTracks[item.id];
                  const draft = getDraft(item);
                  const isCustomizing = expandedCustomizeId === item.id;
                  const isPreviewing = previewingId === item.id;
                  const downloadStatus = downloadStatuses[item.id];

                  return (
                    <article key={item.id} className="sf-content-card rounded-3xl p-4 space-y-3.5">
                      <div className="flex gap-3.5 items-start">
                        <button
                          type="button"
                          onClick={() => toggleSelectCandidate(item.id)}
                          className="shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-indigo-400 mt-1"
                          aria-label="انتخاب این موزیک برای دانلود همزمان"
                        >
                          {selectedCandidateIds.has(item.id) ? (
                            <CheckSquareIcon size={22} weight="fill" className="text-indigo-400" />
                          ) : (
                            <SquareIcon size={22} className="opacity-35 hover:opacity-80 text-foreground" />
                          )}
                        </button>

                        <div className="relative h-20 w-20 sm:h-24 sm:w-24 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 shadow-lg flex items-center justify-center text-white">
                          <WaveformIcon size={32} aria-hidden="true" />
                          {item.coverUrl && (
                            <img
                              src={item.coverUrl}
                              alt={pickText(item.title, item.titleFa)}
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-indigo-500/18 px-2.5 py-0.5 text-[10px] font-bold uppercase text-indigo-700 dark:text-indigo-200">
                              {item.source}
                            </span>
                            <span className="rounded-full bg-[var(--sf-subtle)] px-2 py-0.5 text-[10px] font-semibold">
                              {item.qualityLabel}
                            </span>
                            {item.isPreview && (
                              <span className="rounded-full bg-amber-500/18 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                30s Preview
                              </span>
                            )}
                          </div>

                          <h2 className="font-bold text-base truncate">{pickText(draft.title, draft.titleFa)}</h2>
                          <p className="text-xs opacity-75 truncate">
                            {pickText(draft.artistName, draft.artistNameFa)} • {draft.genre}
                          </p>
                        </div>
                      </div>

                      {isCustomizing && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-[var(--sf-border)]">
                          <Input
                            aria-label={t("trackTitleEn")}
                            placeholder={t("trackTitleEn")}
                            value={draft.title}
                            onValueChange={(v) => updateDraft(item.id, { title: v }, item)}
                          />
                          <Input
                            aria-label={t("trackTitleFa")}
                            placeholder={t("trackTitleFa")}
                            value={draft.titleFa}
                            onValueChange={(v) => updateDraft(item.id, { titleFa: v }, item)}
                          />
                          <Input
                            aria-label={t("artistName")}
                            placeholder={t("artistName")}
                            value={draft.artistName}
                            onValueChange={(v) => updateDraft(item.id, { artistName: v }, item)}
                          />
                          <Input
                            aria-label="Artist (FA)"
                            placeholder="نام فارسی خواننده"
                            value={draft.artistNameFa}
                            onValueChange={(v) => updateDraft(item.id, { artistNameFa: v }, item)}
                          />
                          <Input
                            aria-label={t("genre")}
                            placeholder={t("genre")}
                            value={draft.genre}
                            onValueChange={(v) => updateDraft(item.id, { genre: v }, item)}
                          />
                          <Input
                            aria-label={t("adminAlbum")}
                            placeholder={t("adminAlbum")}
                            value={draft.album}
                            onValueChange={(v) => updateDraft(item.id, { album: v }, item)}
                          />
                          <Input
                            aria-label={t("adminMood")}
                            placeholder={t("adminMood")}
                            value={draft.mood}
                            onValueChange={(v) => updateDraft(item.id, { mood: v }, item)}
                          />
                          <div className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--sf-subtle)] px-3 py-1.5">
                            <span className="text-xs font-semibold">LRCLIB Sync</span>
                            <Switch
                              aria-label="Auto-fetch LRCLIB lyrics"
                              checked={draft.autoFetchLyrics}
                              onCheckedChange={(checked) => updateDraft(item.id, { autoFetchLyrics: checked }, item)}
                            />
                          </div>

                          <div className="sm:col-span-2 sm:col-span-3 space-y-1">
                            <label className="text-[11px] font-semibold opacity-75">متن لایریک دستی LRC (اختیاری):</label>
                            <textarea
                              value={draft.lrcContent}
                              onChange={(e) => updateDraft(item.id, { lrcContent: e.target.value }, item)}
                              placeholder="[00:12.34] متن لایریک..."
                              rows={2}
                              dir="ltr"
                              className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] p-2.5 text-xs font-mono outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-[var(--sf-accent)]/40"
                            />
                          </div>
                        </div>
                      )}

                      {/* Real-time download progress bar */}
                      {downloadStatus && downloadStatus.stage !== "idle" && downloadStatus.stage !== "completed" && downloadStatus.stage !== "error" && (
                        <div className="space-y-1.5 pt-2 border-t border-[var(--sf-border)]">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 font-medium text-indigo-400">
                              <CircleNotchIcon size={13} className="animate-spin text-indigo-400" />
                              {downloadStatus.stageFa}
                            </span>
                            <span className="font-bold text-indigo-400">{downloadStatus.progress}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 dark:bg-black/30">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 rounded-full"
                              style={{ width: `${Math.max(5, downloadStatus.progress)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {downloadStatus?.stage === "error" && (
                        <div className="flex items-center justify-between text-xs text-rose-400 pt-2 border-t border-rose-500/20">
                          <span className="truncate">{downloadStatus.error || downloadStatus.stageFa}</span>
                          <button
                            type="button"
                            onClick={() => void handleImport(item)}
                            className="shrink-0 underline font-bold hover:text-rose-300 ml-2 cursor-pointer"
                          >
                            تلاش مجدد
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--sf-border)]">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="glass"
                            disabled={resolvingId === item.id}
                            onClick={() => void togglePreview(item)}
                            icon={
                              isPreviewing ? (
                                <PauseIcon size={16} weight="fill" aria-hidden="true" />
                              ) : (
                                <PlayIcon size={16} weight="fill" aria-hidden="true" />
                              )
                            }
                          >
                            {resolvingId === item.id ? "..." : isPreviewing ? t("adminStopPreview") : t("adminPreviewBtn")}
                          </Button>

                          <Button
                            type="button"
                            variant="glass"
                            onClick={() => setExpandedCustomizeId(isCustomizing ? null : item.id)}
                            icon={<PencilSimpleIcon size={15} aria-hidden="true" />}
                          >
                            {t("adminCustomize")}
                          </Button>
                        </div>

                        {imported ? (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="filled"
                              tint="#10B981"
                              onClick={() => playTrack(imported, [imported, ...catalogTracks])}
                              icon={<PlayIcon size={16} weight="fill" aria-hidden="true" />}
                            >
                              {t("playNow")}
                            </Button>
                            <Link
                              href={`/track/${imported.id}`}
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/18 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                            >
                              <CheckCircleIcon size={15} weight="fill" aria-hidden="true" />
                              {t("adminImported")}
                            </Link>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="filled"
                            tint="#4F46E5"
                            disabled={Boolean(downloadStatus && downloadStatus.stage !== "completed" && downloadStatus.stage !== "error")}
                            onClick={() => void handleImport(item)}
                            icon={
                              downloadStatus && downloadStatus.stage !== "completed" && downloadStatus.stage !== "error" ? (
                                <CircleNotchIcon size={17} className="animate-spin" />
                              ) : (
                                <CloudArrowDownIcon size={17} weight="bold" aria-hidden="true" />
                              )
                            }
                          >
                            {downloadStatus && downloadStatus.stage !== "completed" && downloadStatus.stage !== "error"
                              ? downloadStatus.stageFa
                              : t("adminImportBtn")}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Load More Results Button */}
              <div className="flex flex-col items-center justify-center gap-2.5 pt-5 pb-2">
                <Button
                  type="button"
                  variant="filled"
                  tint="#4F46E5"
                  disabled={loadingMore || searching}
                  onClick={() => void handleSearchMore()}
                  className="min-h-[46px] px-8 text-sm font-bold shadow-xl shadow-indigo-500/25 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  icon={
                    loadingMore ? (
                      <CircleNotchIcon size={19} className="animate-spin text-white" />
                    ) : (
                      <MusicNotesPlusIcon size={19} weight="bold" />
                    )
                  }
                >
                  {loadingMore ? "در حال دریافت آهنگ‌های بیشتر..." : "یافتن آهنگ‌های بیشتر (+۱۵ نتیجه)"}
                </Button>
                {loadMoreMessage && (
                  <p className="text-xs font-semibold text-indigo-400 animate-fade-in">
                    {loadMoreMessage}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <Glass className="rounded-3xl p-10 text-center space-y-2 opacity-80">
              <MusicNotesPlusIcon size={38} className="mx-auto text-indigo-400" aria-hidden="true" />
              <p className="text-sm font-semibold">{t("adminSearchPlaceholder")}</p>
            </Glass>
          )}
        </section>
      ) : tab === "catalog" ? (
        <section className="space-y-4">
          <Glass className="rounded-3xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1">
              <SearchField
                aria-label={t("searchPlaceholder")}
                placeholder={t("searchPlaceholder")}
                value={catalogQuery}
                onValueChange={(v) => {
                  setCatalogQuery(v);
                  void loadCatalog(v);
                }}
              />
            </div>
            {catalogStatus && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">{catalogStatus}</span>}
          </Glass>

          {catalogBusy ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sf-content-surface rounded-2xl h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {catalogTracks.map((track) => {
                const isEditing = editingTrackId === track.id;
                return (
                  <div key={track.id} className="sf-content-card rounded-3xl p-3.5 sm:p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={track.coverUrl}
                          alt={pickText(track.title, track.titleFa)}
                          width={56}
                          height={56}
                          className="h-14 w-14 rounded-2xl object-cover shrink-0 shadow-md"
                        />
                        <div className="min-w-0">
                          <Link href={`/track/${track.id}`} className="block font-bold text-sm truncate hover:underline">
                            {pickText(track.title, track.titleFa)}
                          </Link>
                          <p className="text-xs opacity-75 truncate">
                            {pickText(track.artistName, track.artistNameFa)} • {track.genre} •{" "}
                            {track.hasLyrics ? `LRC (${track.lyricsSource})` : "No lyrics"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="glass"
                          aria-label={t("play")}
                          icon={<PlayIcon size={16} weight="fill" aria-hidden="true" />}
                          onClick={() => playTrack(track, catalogTracks)}
                        />
                        <Button
                          type="button"
                          variant="glass"
                          onClick={() => void openLyricsModal(track)}
                          icon={<SparkleIcon size={15} aria-hidden="true" />}
                        >
                          {track.hasLyrics ? "لایریک (LRC)" : "افزودن لایریک"}
                        </Button>
                        <Button
                          type="button"
                          variant="glass"
                          onClick={() => (isEditing ? setEditingTrackId(null) : startEditTrack(track))}
                          icon={<PencilSimpleIcon size={15} aria-hidden="true" />}
                        >
                          {t("adminCustomize")}
                        </Button>
                        <Button
                          type="button"
                          destructive
                          aria-label={confirmDeleteId === track.id ? t("adminConfirmDelete") : t("adminDeleteTrack")}
                          icon={<TrashIcon size={16} aria-hidden="true" />}
                          onClick={() => void handleDeleteTrack(track.id)}
                        >
                          {confirmDeleteId === track.id ? t("adminConfirmDelete") : undefined}
                        </Button>
                      </div>
                    </div>

                    {isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3 border-t border-[var(--sf-border)]">
                        <Input
                          value={editDraft.title}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, title: v }))}
                          placeholder={t("trackTitleEn")}
                        />
                        <Input
                          value={editDraft.titleFa}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, titleFa: v }))}
                          placeholder={t("trackTitleFa")}
                        />
                        <Input
                          value={editDraft.artistName}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, artistName: v }))}
                          placeholder={t("artistName")}
                        />
                        <Input
                          value={editDraft.artistNameFa}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, artistNameFa: v }))}
                          placeholder="نام فارسی خواننده"
                        />
                        <Input
                          value={editDraft.genre}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, genre: v }))}
                          placeholder={t("genre")}
                        />
                        <div className="flex items-center gap-2">
                          <Input
                            value={editDraft.mood}
                            onValueChange={(v) => setEditDraft((d) => ({ ...d, mood: v }))}
                            placeholder={t("mood")}
                          />
                          <Button variant="filled" tint="#10B981" onClick={() => void saveEditTrack(track.id)}>
                            {t("adminSaveEdit")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-4">
          {/* Search Bar + Role Filter + Status Feedback */}
          <Glass className="rounded-3xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1">
                <SearchField
                  aria-label={pickText("جستجوی نام کاربری، ایمیل یا نام...", "Search username, email, name...")}
                  placeholder={pickText("جستجوی نام کاربری، ایمیل یا نام...", "Search username, email, name...")}
                  value={usersQuery}
                  onValueChange={(v) => {
                    setUsersQuery(v);
                    void loadUsers(v, usersRoleFilter);
                  }}
                />
              </div>

              <div className="shrink-0">
                <GlassSegmented
                  aria-label="Role Filter"
                  size="sm"
                  value={usersRoleFilter}
                  onValueChange={(v) => {
                    const nextRole = v as "all" | "user" | "creator" | "admin";
                    setUsersRoleFilter(nextRole);
                    void loadUsers(usersQuery, nextRole);
                  }}
                  items={[
                    { value: "all", label: pickText("همه", "All") },
                    { value: "user", label: pickText("کاربران", "Users") },
                    { value: "creator", label: pickText("هنرمندان", "Creators") },
                    { value: "admin", label: pickText("مدیران", "Admins") },
                  ]}
                />
              </div>
            </div>

            {userActionStatus && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs font-semibold text-emerald-400">
                <span>{userActionStatus}</span>
                <button
                  type="button"
                  onClick={() => setUserActionStatus(null)}
                  className="p-1 hover:bg-emerald-500/20 rounded-full cursor-pointer"
                >
                  <XIcon size={14} />
                </button>
              </div>
            )}
          </Glass>

          {/* Users List */}
          {usersError ? (
            <Glass className="rounded-3xl p-8 text-center space-y-3 border-rose-500/20 bg-rose-500/5">
              <p className="text-sm font-semibold text-rose-400">{usersError}</p>
              <Button
                type="button"
                variant="glass"
                onClick={() => void loadUsers()}
                className="mx-auto"
              >
                {pickText("تلاش مجدد", "Retry")}
              </Button>
            </Glass>
          ) : usersBusy ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sf-content-surface rounded-2xl h-24 animate-pulse" />
              ))}
            </div>
          ) : adminUsers.length === 0 ? (
            <Glass className="rounded-3xl p-10 text-center space-y-2 opacity-80">
              <UserIcon size={38} className="mx-auto text-indigo-400" aria-hidden="true" />
              <p className="text-sm font-semibold">
                {usersQuery
                  ? pickText("کاربری با این مشخصات یافت نشد", "No users found matching your search")
                  : pickText("هنوز کاربری ثبت نشده است", "No registered users found")}
              </p>
            </Glass>
          ) : (
            <div className="space-y-3">
              {adminUsers.map((u) => {
                const isCurrentAdmin = u.id === user.id;

                return (
                  <Glass
                    key={u.id}
                    variant="chrome"
                    className={`rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
                      !u.isActive ? "opacity-60 bg-black/20" : ""
                    }`}
                  >
                    {/* User Info */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white font-black text-lg shadow-md"
                        style={{ backgroundColor: u.avatarColor || "#4F46E5" }}
                      >
                        {u.displayName.slice(0, 1).toUpperCase()}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-extrabold text-sm sm:text-base text-white truncate">
                            {pickText(u.displayName, u.displayNameFa || u.displayName)}
                          </h3>
                          <span className="text-xs text-[var(--sf-muted)] font-mono">@{u.username}</span>

                          {/* Role Badge */}
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              u.role === "admin"
                                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                : u.role === "creator"
                                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                  : "bg-white/10 text-white/80"
                            }`}
                          >
                            {u.role === "admin"
                              ? pickText("مدیر سیستم", "Admin")
                              : u.role === "creator"
                                ? pickText("هنرمند", "Creator")
                                : pickText("کاربر عادی", "User")}
                          </span>

                          {/* Active Status Badge */}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              u.isActive
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-rose-500/15 text-rose-400"
                            }`}
                          >
                            {u.isActive ? pickText("فعال", "Active") : pickText("غیرفعال", "Deactivated")}
                          </span>
                        </div>

                        <p className="text-xs text-[var(--sf-muted)] truncate">{u.email}</p>

                        {/* Activity Counters */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-[var(--sf-muted)]">
                          <span className="flex items-center gap-1">
                            <HeartIcon size={14} className="text-pink-400" />
                            <span>{formatNum(u.likedTracksCount)} {pickText("لایک", "likes")}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <PlaylistIcon size={14} className="text-indigo-400" />
                            <span>{formatNum(u.playlistsCount)} {pickText("پلی‌لیست", "playlists")}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <ChatCircleTextIcon size={14} className="text-cyan-400" />
                            <span>{formatNum(u.commentsCount)} {pickText("نظر", "comments")}</span>
                          </span>
                          <span className="opacity-60 text-[10px]">
                            {pickText("عضویت:", "Joined:")} {u.createdAt ? new Date(u.createdAt).toLocaleDateString("fa-IR") : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0">
                      {/* View details */}
                      <Button
                        type="button"
                        variant="glass"
                        aria-label={pickText("مشاهده جزئیات", "View Details")}
                        title={pickText("مشاهده جزئیات فعالیت", "View Activity Details")}
                        icon={<EyeIcon size={16} />}
                        onClick={() => void handleOpenUserDetails(u.id)}
                      >
                        <span className="hidden md:inline">{pickText("جزئیات", "Details")}</span>
                      </Button>

                      {/* Change Role Button */}
                      <Button
                        type="button"
                        variant="glass"
                        disabled={isCurrentAdmin}
                        title={pickText("تغییر نقش", "Change Role")}
                        icon={<ShieldCheckIcon size={16} />}
                        onClick={() => {
                          setUserRoleModal({ userId: u.id, username: u.username, currentRole: u.role });
                          setNewRole(u.role);
                        }}
                      >
                        <span className="hidden md:inline">{pickText("نقش", "Role")}</span>
                      </Button>

                      {/* Deactivate / Activate Button */}
                      {!isCurrentAdmin && (
                        <Button
                          type="button"
                          variant="glass"
                          className={u.isActive ? "hover:text-amber-400" : "text-emerald-400 hover:text-emerald-300"}
                          onClick={() => void handleToggleStatus(u.id, u.isActive)}
                          title={u.isActive ? pickText("غیرفعال‌سازی کاربر", "Deactivate") : pickText("فعال‌سازی کاربر", "Activate")}
                        >
                          {u.isActive ? pickText("غیرفعال‌سازی", "Deactivate") : pickText("فعال‌سازی", "Activate")}
                        </Button>
                      )}

                      {/* Delete Button */}
                      {!isCurrentAdmin && (
                        confirmDeleteUserId === u.id ? (
                          <div className="flex items-center gap-1.5 animate-in fade-in">
                            <Button
                              type="button"
                              variant="filled"
                              tint="#EF4444"
                              className="text-xs px-2.5 py-1 font-bold"
                              onClick={() => void handleDeleteUser(u.id)}
                            >
                              {pickText("تأیید حذف", "Confirm")}
                            </Button>
                            <Button
                              type="button"
                              variant="glass"
                              className="text-xs px-2 py-1"
                              onClick={() => setConfirmDeleteUserId(null)}
                            >
                              {t("close")}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="glass"
                            className="hover:text-rose-400"
                            aria-label={pickText("حذف کاربر", "Delete User")}
                            title={pickText("حذف کاربر", "Delete User")}
                            icon={<TrashIcon size={16} />}
                            onClick={() => setConfirmDeleteUserId(u.id)}
                          />
                        )
                      )}
                    </div>
                  </Glass>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Lyrics Manager Modal */}
      {lyricsTrack && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pickText(lyricsTrack.title, lyricsTrack.titleFa)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLyricsTrack(null);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto sf-fade-in"
        >
          <Glass
            variant="chrome"
            className="w-full max-w-xl rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl border border-white/20 my-auto bg-slate-900/95 dark:bg-[#0c1017]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--sf-border)] pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={lyricsTrack.coverUrl}
                  alt={lyricsTrack.title}
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-xl object-cover shrink-0 shadow-md"
                />
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{pickText(lyricsTrack.title, lyricsTrack.titleFa)}</h3>
                  <p className="text-xs opacity-75 truncate">{pickText(lyricsTrack.artistName, lyricsTrack.artistNameFa)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLyricsTrack(null)}
                aria-label={t("close")}
                className="p-1.5 rounded-full hover:bg-[var(--sf-subtle-hover)] cursor-pointer text-white/80 hover:text-white transition-colors"
              >
                <XIcon size={18} aria-hidden="true" />
              </button>
            </div>

            {lyricsActionStatus && (
              <div className="rounded-2xl bg-indigo-500/15 border border-indigo-500/25 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                {lyricsActionStatus}
              </div>
            )}

            {/* LRCLIB Direct Query Search */}
            <div className="space-y-2 bg-[var(--sf-subtle)] p-3 rounded-2xl">
              <p className="text-xs font-bold">جستجوی هوشمند در پایگاه LRCLIB با عنوان سفارشی:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  value={lyricsCustomTitle}
                  onValueChange={setLyricsCustomTitle}
                  placeholder="عنوان آهنگ (انگلیسی / فینگلیش)"
                />
                <Input
                  value={lyricsCustomArtist}
                  onValueChange={setLyricsCustomArtist}
                  placeholder="نام خواننده (انگلیسی / فینگلیش)"
                />
              </div>
              <Button
                type="button"
                variant="filled"
                tint="#6366F1"
                disabled={lyricsActionBusy}
                onClick={() => void handleFetchLyricsForTrack()}
                icon={<SparkleIcon size={16} aria-hidden="true" />}
                className="w-full justify-center text-xs mt-1"
              >
                {lyricsActionBusy ? "در حال استعلام..." : "استعلام و همگام‌سازی از LRCLIB"}
              </Button>
            </div>

            {/* Manual LRC Editor */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold block">متن لایریک (فرمت سنکرون LRC یا ساده):</label>
              <textarea
                value={lyricsLrcText}
                onChange={(e) => setLyricsLrcText(e.target.value)}
                placeholder="[00:12.34] متن لایریک خط اول..."
                rows={7}
                dir="ltr"
                className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] p-3 text-xs font-mono outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-[var(--sf-accent)]/40"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--sf-border)]">
              <Button type="button" variant="glass" onClick={() => setLyricsTrack(null)}>
                {t("close")}
              </Button>
              <Button
                type="button"
                variant="filled"
                tint="#10B981"
                disabled={lyricsActionBusy}
                onClick={() => void handleSaveManualLyrics()}
              >
                ذخیره متن ترانه
              </Button>
            </div>
          </Glass>
        </div>,
        document.body
      )}

      {/* User Role Change Modal */}
      {userRoleModal && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pickText("تغییر نقش کاربر", "Change User Role")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setUserRoleModal(null);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md sf-fade-in"
        >
          <Glass
            variant="chrome"
            className="w-full max-w-sm rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl border border-white/20 bg-slate-900/95 dark:bg-[#0c1017]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--sf-border)] pb-3">
              <h3 className="font-extrabold text-sm sm:text-base">
                {pickText("تغییر نقش کاربر", "Change User Role")}
              </h3>
              <button
                type="button"
                onClick={() => setUserRoleModal(null)}
                aria-label={t("close")}
                className="p-1.5 rounded-full hover:bg-[var(--sf-subtle-hover)] cursor-pointer text-white/80 hover:text-white"
              >
                <XIcon size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-[var(--sf-muted)]">
                {pickText("انتخاب نقش جدید برای", "Select new role for")}{" "}
                <span className="font-bold text-white">@{userRoleModal.username}</span>:
              </p>

              <GlassSegmented
                aria-label="Select Role"
                fullWidth
                value={newRole}
                onValueChange={(v) => setNewRole(v as "user" | "creator" | "admin")}
                items={[
                  { value: "user", label: pickText("کاربر عادی", "User") },
                  { value: "creator", label: pickText("هنرمند", "Creator") },
                  { value: "admin", label: pickText("مدیر سیستم", "Admin") },
                ]}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--sf-border)]">
              <Button type="button" variant="glass" onClick={() => setUserRoleModal(null)}>
                {t("close")}
              </Button>
              <Button
                type="button"
                variant="filled"
                tint="#6366F1"
                onClick={() => void handleUpdateRole(userRoleModal.userId, newRole)}
              >
                {pickText("ذخیره نقش", "Save Role")}
              </Button>
            </div>
          </Glass>
        </div>,
        document.body,
      )}

      {/* User Details & Activity Drawer/Modal */}
      {selectedUserForDetails && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pickText("جزئیات کاربر", "User Details")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedUserForDetails(null);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md overflow-y-auto sf-fade-in"
        >
          <Glass
            variant="chrome"
            className="w-full max-w-2xl max-h-[85vh] rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl border border-white/20 my-auto bg-slate-900/95 dark:bg-[#0c1017]/95 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--sf-border)] pb-4 shrink-0">
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white font-black text-xl shadow-md"
                  style={{ backgroundColor: selectedUserForDetails.user.avatarColor || "#4F46E5" }}
                >
                  {selectedUserForDetails.user.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base text-white truncate">
                      {selectedUserForDetails.user.displayName}
                    </h3>
                    <span className="text-xs text-[var(--sf-muted)] font-mono">@{selectedUserForDetails.user.username}</span>
                  </div>
                  <p className="text-xs text-[var(--sf-muted)] truncate">{selectedUserForDetails.user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForDetails(null)}
                aria-label={t("close")}
                className="p-1.5 rounded-full hover:bg-[var(--sf-subtle-hover)] cursor-pointer text-white/80 hover:text-white"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto space-y-5 [scrollbar-width:thin] pr-1">
              {/* Stats overview */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl bg-white/[0.04] p-3 text-center border border-white/5">
                  <p className="text-[11px] text-[var(--sf-muted)]">{pickText("آهنگ‌های لایک شده", "Liked Tracks")}</p>
                  <p className="text-lg font-black text-pink-400 mt-0.5">{formatNum(selectedUserForDetails.likedTracks.length)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-3 text-center border border-white/5">
                  <p className="text-[11px] text-[var(--sf-muted)]">{pickText("پلی‌لیست‌ها", "Playlists")}</p>
                  <p className="text-lg font-black text-indigo-400 mt-0.5">{formatNum(selectedUserForDetails.playlists.length)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-3 text-center border border-white/5">
                  <p className="text-[11px] text-[var(--sf-muted)]">{pickText("نظرات ارسالی", "Comments")}</p>
                  <p className="text-lg font-black text-cyan-400 mt-0.5">{formatNum(selectedUserForDetails.comments.length)}</p>
                </div>
              </div>

              {/* Liked Tracks list */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <HeartIcon size={14} className="text-pink-400" />
                  <span>{pickText("آخرین آهنگ‌های لایک شده", "Recent Liked Tracks")}</span>
                </h4>
                {selectedUserForDetails.likedTracks.length === 0 ? (
                  <p className="text-xs text-[var(--sf-muted)] py-2">{pickText("هیچ آهنگی لایک نشده است", "No liked tracks")}</p>
                ) : (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {selectedUserForDetails.likedTracks.map((trk) => (
                      <div key={trk.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-white/[0.03] text-xs">
                        <img src={trk.coverUrl} alt={trk.title} className="h-8 w-8 rounded-lg object-cover shrink-0" />
                        <div className="min-w-0 flex-1 truncate">
                          <p className="font-semibold text-white truncate">{trk.title}</p>
                          <p className="text-[11px] text-[var(--sf-muted)] truncate">{trk.artistName}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Playlists list */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <PlaylistIcon size={14} className="text-indigo-400" />
                  <span>{pickText("پلی‌لیست‌های ساخته‌شده", "Created Playlists")}</span>
                </h4>
                {selectedUserForDetails.playlists.length === 0 ? (
                  <p className="text-xs text-[var(--sf-muted)] py-2">{pickText("پلی‌لیستی ساخته نشده است", "No playlists created")}</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedUserForDetails.playlists.map((pl) => (
                      <div key={pl.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] text-xs">
                        <span className="font-semibold text-white truncate">{pl.title}</span>
                        <span className="text-[11px] text-[var(--sf-muted)] font-mono">{formatNum(pl.trackCount)} {pickText("آهنگ", "tracks")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Comments list */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <ChatCircleTextIcon size={14} className="text-cyan-400" />
                  <span>{pickText("نظرات ارسالی", "Recent Comments")}</span>
                </h4>
                {selectedUserForDetails.comments.length === 0 ? (
                  <p className="text-xs text-[var(--sf-muted)] py-2">{pickText("هیچ نظری ثبت نشده است", "No comments posted")}</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedUserForDetails.comments.map((cmt) => (
                      <div key={cmt.id} className="p-2.5 rounded-xl bg-white/[0.03] text-xs space-y-1">
                        <p className="text-white font-medium">{cmt.body}</p>
                        <p className="text-[10px] text-[var(--sf-muted)] truncate">
                          {pickText("روی آهنگ:", "On track:")} {cmt.trackTitle}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end pt-3 border-t border-[var(--sf-border)] shrink-0">
              <Button type="button" variant="glass" onClick={() => setSelectedUserForDetails(null)}>
                {t("close")}
              </Button>
            </div>
          </Glass>
        </div>,
        document.body,
      )}
    </div>
  );
}

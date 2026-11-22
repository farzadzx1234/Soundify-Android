"use client";

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwiseIcon,
  CloudCheckIcon,
  DeviceMobileIcon,
  GearSixIcon,
  GlobeHemisphereWestIcon,
  GlobeIcon,
  HardDriveIcon,
  InfoIcon,
  PaintBrushIcon,
  SignOutIcon,
  SparkleIcon,
  TrashIcon,
  UserCircleIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { AdminUser } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useI18n, type Lang } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { useTheme, type ThemeChoice } from "@/context/ThemeContext";
import { Button, GlassSegmented, Switch } from "@/components/GlassControls";
import { useDownloadedTracks } from "@/lib/downloadManager";
import { APP_BUILD_NUMBER, APP_CHANNEL, APP_VERSION } from "@/lib/appVersion";
import { isAndroidNative } from "@/lib/androidBridge";

const LOCAL_PREF_EVENT = "soundify-local-pref-change";

function useLocalStorageBool(key: string, defaultValue = true): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (onStoreChange) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) onStoreChange();
      };
      const onLocal = () => onStoreChange();
      window.addEventListener("storage", onStorage);
      window.addEventListener(LOCAL_PREF_EVENT, onLocal);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(LOCAL_PREF_EVENT, onLocal);
      };
    },
    () => {
      try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? defaultValue : stored === "true";
      } catch {
        return defaultValue;
      }
    },
    () => defaultValue,
  );

  const setValue = (next: boolean) => {
    try {
      window.localStorage.setItem(key, String(next));
      window.dispatchEvent(new Event(LOCAL_PREF_EVENT));
    } catch {
      // Ignore storage quota errors
    }
  };

  return [value, setValue];
}

export default function SettingsPage() {
  const { user, updateProfile, changePassword, openAuthDialog, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { choice, setChoice } = useTheme();
  const { visualizerEnabled, setVisualizerEnabled } = usePlayer();

  const [highQuality, handleToggleHighQuality] = useLocalStorageBool("soundify_hq", true);
  const [offlineCache, handleToggleOfflineCache] = useLocalStorageBool("soundify_offline_cache", true);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Storage management & quota controls
  const {
    downloadedTracks,
    storageBudgetInfo,
    clearAll: clearAllOfflineTracks,
    clearCache: clearOfflineAudioCache,
  } = useDownloadedTracks();
  const [offlineCacheCleared, setOfflineCacheCleared] = useState(false);
  const [confirmClearOfflineCache, setConfirmClearOfflineCache] = useState(false);
  const [confirmDeleteAllDownloads, setConfirmDeleteAllDownloads] = useState(false);

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return `0 MB`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (102.4 * 1024)) / 10} MB`;
    return `${Math.round(bytes / (10.24 * 1024 * 1024)) / 100} GB`;
  };

  const handleConfirmClearOfflineCache = () => {
    setConfirmClearOfflineCache(false);
    clearOfflineAudioCache();
    setOfflineCacheCleared(true);
    setTimeout(() => setOfflineCacheCleared(false), 2500);
  };

  const handleConfirmDeleteAllDownloads = async () => {
    setConfirmDeleteAllDownloads(false);
    await clearAllOfflineTracks();
  };

  // Escape key handler for confirmation modals
  useEffect(() => {
    if (!confirmClearOfflineCache && !confirmDeleteAllDownloads) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmClearOfflineCache(false);
        setConfirmDeleteAllDownloads(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmClearOfflineCache, confirmDeleteAllDownloads]);

  // Profile edit
  const [editDisplayName, setEditDisplayName] = useState(user?.displayName || "");
  const [editDisplayNameFa, setEditDisplayNameFa] = useState(user?.displayNameFa || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  // Change password
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<string | null>(null);

  // Admin permissions management state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [adminActionFeedback, setAdminActionFeedback] = useState<string | null>(null);

  const fetchAdminUsers = useCallback(async () => {
    if (!user || (user.role !== "admin" && !user.isAdmin)) return;
    setAdminUsersLoading(true);
    try {
      const res = await api.adminGetUsers({ limit: 50 });
      setAdminUsers(res.users);
    } catch {
      // Ignore
    } finally {
      setAdminUsersLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    if (user?.role === "admin" || user?.isAdmin) {
      api
        .adminGetUsers({ limit: 50 })
        .then((res) => {
          if (active) setAdminUsers(res.users);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [user]);

  const handleToggleUserGlobalSearch = async (targetUserId: string, nextValue: boolean) => {
    setAdminUsers((prev) =>
      prev.map((u) => (u.id === targetUserId ? { ...u, canAccessGlobalSearch: nextValue } : u)),
    );
    try {
      await api.adminUpdateUserPermissions(targetUserId, { canAccessGlobalSearch: nextValue });
      setAdminActionFeedback(
        lang === "fa"
          ? `دسترسی کاربر با موفقیت ${nextValue ? "فعال" : "غیرفعال"} شد.`
          : `User permission updated to ${nextValue ? "enabled" : "disabled"}.`,
      );
      setTimeout(() => setAdminActionFeedback(null), 3000);
    } catch {
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === targetUserId ? { ...u, canAccessGlobalSearch: !nextValue } : u)),
      );
      setAdminActionFeedback(
        lang === "fa" ? "خطا در به‌روزرسانی دسترسی کاربر" : "Failed to update user permission",
      );
      setTimeout(() => setAdminActionFeedback(null), 3000);
    }
  };

  const filteredAdminUsers = useMemo(() => {
    const q = adminSearchQuery.trim().toLowerCase();
    if (!q) return adminUsers;
    return adminUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q) ||
        u.displayNameFa?.toLowerCase().includes(q),
    );
  }, [adminUsers, adminSearchQuery]);

  const handleClearCache = () => {
    if (typeof window !== "undefined" && "caches" in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 2500);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileFeedback(null);
    try {
      await updateProfile({ displayName: editDisplayName, displayNameFa: editDisplayNameFa });
      setProfileFeedback(lang === "fa" ? "پروفایل با موفقیت ذخیره شد." : "Profile updated successfully.");
    } catch (err) {
      setProfileFeedback(err instanceof Error ? err.message : "Error updating profile");
    } finally {
      setProfileSaving(false);
      setTimeout(() => setProfileFeedback(null), 3500);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdSaving(true);
    setPwdFeedback(null);
    try {
      await changePassword({ currentPassword: currentPwd, newPassword: newPwd });
      setPwdFeedback(lang === "fa" ? "رمز عبور با موفقیت تغییر یافت." : "Password changed successfully.");
      setCurrentPwd("");
      setNewPwd("");
    } catch (err) {
      setPwdFeedback(err instanceof Error ? err.message : "Error changing password");
    } finally {
      setPwdSaving(false);
      setTimeout(() => setPwdFeedback(null), 3500);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-7 sf-fade-up pb-16 sm:pb-12">
      {/* Apple Settings Large Header */}
      <div className="space-y-1">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-md">
            <GearSixIcon size={22} weight="bold" aria-hidden="true" />
          </span>
          <span>{t("settingsTitle")}</span>
        </h1>
        <p className="text-xs text-[var(--sf-muted)]">
          {t("settingsSubtitle")}
        </p>
      </div>

      {/* Group 1: General (Appearance & Language) */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsGeneralGroup")}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
          {/* Language Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#007AFF] text-white shadow-sm shrink-0">
                <GlobeIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("languageLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("languageDesc")}</span>
              </div>
            </div>
            <GlassSegmented
              aria-label={t("languageLabel")}
              className="self-start sm:self-auto shrink-0"
              value={lang}
              onValueChange={(v) => setLang(v as Lang)}
              items={[
                { value: "fa", label: "فارسی (RTL)" },
                { value: "en", label: "English" },
              ]}
            />
          </div>

          {/* Theme Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#5856D6] text-white shadow-sm shrink-0">
                <PaintBrushIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("themeLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("themeDesc")}</span>
              </div>
            </div>
            <GlassSegmented
              aria-label={t("themeLabel")}
              className="self-start sm:self-auto shrink-0"
              value={choice}
              onValueChange={(v) => setChoice(v as ThemeChoice)}
              items={[
                { value: "system", label: t("themeSystem") },
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Group 2: Audio & Playback */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsPlaybackGroup")}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
          {/* Live Waveform Visualizer */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF2D55] text-white shadow-sm shrink-0">
                <WaveformIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("visualizerLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("visualizerDesc")}</span>
              </div>
            </div>
            <Switch
              aria-label={t("visualizerLabel")}
              checked={visualizerEnabled}
              onCheckedChange={setVisualizerEnabled}
            />
          </div>

          {/* High Quality Audio (320kbps / Lossless) */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#34C759] text-white shadow-sm shrink-0">
                <SparkleIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("highQualityAudio")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("highQualityDesc")}</span>
              </div>
            </div>
            <Switch
              aria-label={t("highQualityAudio")}
              checked={highQuality}
              onCheckedChange={handleToggleHighQuality}
            />
          </div>

          {/* Smart Offline Caching */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#00C7BE] text-white shadow-sm shrink-0">
                <CloudCheckIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("offlineCacheTitle")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("offlineCacheDesc")}</span>
              </div>
            </div>
            <Switch
              aria-label={t("offlineCacheTitle")}
              checked={offlineCache}
              onCheckedChange={handleToggleOfflineCache}
            />
          </div>
        </div>
      </div>

      {/* Group 3: App & Device */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsAppGroup")}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
          {/* Clear Cache */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-500 text-white shadow-sm shrink-0">
                <TrashIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <span className="block font-semibold text-sm">{t("clearCacheTitle")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("clearCacheDesc")}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="glass"
              onClick={handleClearCache}
              className="text-xs font-semibold shrink-0"
            >
              {cacheCleared ? t("clearCacheDone") : t("clearCacheBtn")}
            </Button>
          </div>
        </div>
      </div>

      {/* Storage & Offline Downloads Management */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("storageMeter")}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
          {/* Storage Meter & Visual Usage Display */}
          <div className="p-4 sm:px-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm shrink-0">
                  <HardDriveIcon size={20} weight="bold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{t("storageUsed")}</span>
                    <span className="font-mono tabular-nums font-bold text-sm text-[var(--sf-text)]">
                      {formatSize(storageBudgetInfo.usageBytes)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--sf-muted)] mt-0.5">
                    <span>{downloadedTracks.length} {t("tracksCount")}</span>
                    <span>•</span>
                    <span>{t("downloadedSongsSize")}: <strong className="text-[var(--sf-text)] font-semibold">{formatSize(storageBudgetInfo.songsBytes)}</strong></span>
                    <span>•</span>
                    <span>{t("cacheSize")}: <strong className="text-[var(--sf-muted)] font-semibold">{formatSize(storageBudgetInfo.cacheBytes)}</strong></span>
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                {lang === "fa" ? "دانلود نامحدود" : "Unlimited"}
              </span>
            </div>
          </div>

          {/* Clear Offline Cache */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <span className="block font-semibold text-sm">{t("clearOfflineCacheTitle")}</span>
              <span className="block text-xs text-[var(--sf-muted)]">{t("clearOfflineCacheDesc")}</span>
            </div>
            <Button
              type="button"
              variant="glass"
              onClick={() => setConfirmClearOfflineCache(true)}
              className="text-xs font-semibold shrink-0"
            >
              {offlineCacheCleared ? t("clearOfflineCacheDone") : (lang === "fa" ? "پاک‌سازی" : "Clear")}
            </Button>
          </div>

          {/* Delete All Downloads */}
          <div className="flex items-center justify-between gap-3 p-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <span className="block font-semibold text-sm text-rose-500">{t("deleteAllDownloadsTitle")}</span>
              <span className="block text-xs text-[var(--sf-muted)]">{t("deleteAllDownloadsDesc")}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              destructive
              onClick={() => setConfirmDeleteAllDownloads(true)}
              disabled={downloadedTracks.length === 0}
              icon={<TrashIcon size={16} aria-hidden="true" />}
              className="text-xs font-semibold shrink-0"
            >
              {lang === "fa" ? "حذف همه" : "Delete All"}
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal: Clear Offline Cache */}
      {typeof document !== "undefined" && confirmClearOfflineCache && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-cache-dialog-title"
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md sf-fade-up"
          onClick={() => setConfirmClearOfflineCache(false)}
        >
          <div
            className="w-full max-w-sm sm:max-w-md bg-white/95 dark:bg-[#12131a]/98 text-[var(--sf-text)] rounded-t-[32px] sm:rounded-3xl p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.85)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 backdrop-blur-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/30 mx-auto -mt-1 mb-2.5 sm:hidden" />
            <div className="text-center space-y-2 pt-1">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/15 text-amber-500 dark:text-amber-400 mx-auto flex items-center justify-center mb-1 ring-1 ring-amber-500/25">
                <TrashIcon size={24} weight="bold" />
              </div>
              <h3 id="clear-cache-dialog-title" className="text-base font-bold text-[var(--sf-text)]">{t("clearOfflineCacheTitle")}</h3>
              <p className="text-xs text-[var(--sf-muted)] leading-relaxed px-2">
                {t("confirmClearCache")}
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleConfirmClearOfflineCache}
                className="w-full min-h-[50px] rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-bold text-sm transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {lang === "fa" ? "پاک‌سازی حافظه موقت" : "Clear Cache"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearOfflineCache(false)}
                className="w-full min-h-[50px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] active:bg-black/[0.14] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm transition-all cursor-pointer active:scale-[0.98] border border-black/[0.08] dark:border-white/10"
              >
                {lang === "fa" ? "لغو" : "Cancel"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmation Modal: Delete All Downloads */}
      {typeof document !== "undefined" && confirmDeleteAllDownloads && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-dialog-title"
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md sf-fade-up"
          onClick={() => setConfirmDeleteAllDownloads(false)}
        >
          <div
            className="w-full max-w-sm sm:max-w-md bg-white/95 dark:bg-[#12131a]/98 text-[var(--sf-text)] rounded-t-[32px] sm:rounded-3xl p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.85)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 backdrop-blur-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/30 mx-auto -mt-1 mb-2.5 sm:hidden" />
            <div className="text-center space-y-2 pt-1">
              <div className="h-12 w-12 rounded-2xl bg-rose-500/15 text-rose-500 dark:text-rose-400 mx-auto flex items-center justify-center mb-1 ring-1 ring-rose-500/25">
                <TrashIcon size={24} weight="bold" />
              </div>
              <h3 id="delete-all-dialog-title" className="text-base font-bold text-rose-600 dark:text-rose-400">{t("deleteAllDownloadsTitle")}</h3>
              <p className="text-xs text-[var(--sf-muted)] leading-relaxed px-2">
                {t("confirmClearDownloads")}
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => void handleConfirmDeleteAllDownloads()}
                className="w-full min-h-[50px] rounded-2xl bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white font-bold text-sm transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {lang === "fa" ? "حذف دائمی تمام آهنگ‌ها" : "Delete All Tracks"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteAllDownloads(false)}
                className="w-full min-h-[50px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] active:bg-black/[0.14] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm transition-all cursor-pointer active:scale-[0.98] border border-black/[0.08] dark:border-white/10"
              >
                {lang === "fa" ? "لغو" : "Cancel"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Group 4: Account */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsAccountGroup")}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-white/[0.06]">
          {user ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-5">
                <div className="flex items-center gap-3.5">
                  <span
                    className="h-12 w-12 rounded-full flex items-center justify-center font-black text-base text-white shadow-md shrink-0"
                    style={{ backgroundColor: user.avatarColor }}
                  >
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-extrabold text-base">{user.displayName}</p>
                      {user.role === "admin" && (
                        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:text-violet-300">
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--sf-muted)]">@{user.username} • {user.email}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="glass"
                  destructive
                  onClick={() => void logout()}
                  icon={<SignOutIcon size={18} aria-hidden="true" />}
                >
                  {t("signOut")}
                </Button>
              </div>

              {/* Edit Profile Form */}
              <div className="p-4 sm:px-5 space-y-3">
                <span className="block font-semibold text-sm">
                  {lang === "fa" ? "ویرایش مشخصات کاربری" : "Edit Profile Details"}
                </span>
                <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder={lang === "fa" ? "نام نمایشی (انگلیسی)" : "Display Name"}
                      className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                      required
                    />
                    <input
                      type="text"
                      value={editDisplayNameFa}
                      onChange={(e) => setEditDisplayNameFa(e.target.value)}
                      placeholder={lang === "fa" ? "نام نمایشی (فارسی)" : "Persian Display Name"}
                      className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {profileFeedback && (
                      <span className="text-xs font-medium text-emerald-400">{profileFeedback}</span>
                    )}
                    <Button
                      type="submit"
                      variant="filled"
                      disabled={profileSaving}
                      className="text-xs font-semibold mr-auto ltr:mr-0 ltr:ml-auto"
                    >
                      {profileSaving
                        ? lang === "fa"
                          ? "در حال ذخیره..."
                          : "Saving..."
                        : lang === "fa"
                          ? "ذخیره تغییرات"
                          : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Change Password Form */}
              <div className="p-4 sm:px-5 space-y-3">
                <span className="block font-semibold text-sm">
                  {lang === "fa" ? "تغییر رمز عبور" : "Change Password"}
                </span>
                <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="password"
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      placeholder={lang === "fa" ? "رمز عبور فعلی" : "Current Password"}
                      className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                      required
                    />
                    <input
                      type="password"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      placeholder={lang === "fa" ? "رمز عبور جدید (حداقل ۶ نویسه)" : "New Password (min 6 chars)"}
                      className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {pwdFeedback && (
                      <span className="text-xs font-medium text-indigo-400">{pwdFeedback}</span>
                    )}
                    <Button
                      type="submit"
                      variant="glass"
                      disabled={pwdSaving || !currentPwd || !newPwd}
                      className="text-xs font-semibold mr-auto ltr:mr-0 ltr:ml-auto"
                    >
                      {pwdSaving
                        ? lang === "fa"
                          ? "در حال تغییر..."
                          : "Changing..."
                        : lang === "fa"
                          ? "به‌روزرسانی رمز عبور"
                          : "Update Password"}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 shrink-0">
                  <UserCircleIcon size={24} weight="bold" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-bold text-sm">{t("guestAccount")}</p>
                  <p className="text-xs text-[var(--sf-muted)]">{t("loginRequired")}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                icon={<UserCircleIcon size={18} aria-hidden="true" />}
              >
                {t("signIn")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Group Admin: Global Search Access Management (Visible to Admins only) */}
      {Boolean(user && (user.role === "admin" || user.isAdmin)) && (
        <div className="space-y-2 sf-fade-up">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)]">
              {lang === "fa" ? "مدیریت دسترسی‌های جستجوی جهانی" : "Global Search Permissions"}
            </span>
            <Button
              type="button"
              variant="glass"
              disabled={adminUsersLoading}
              onClick={() => void fetchAdminUsers()}
              icon={<ArrowClockwiseIcon size={14} className={adminUsersLoading ? "animate-spin" : ""} />}
              className="!h-7 !px-2.5 !text-[11px]"
            >
              {lang === "fa" ? "بروزرسانی" : "Refresh"}
            </Button>
          </div>

          <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-4 sm:p-5 space-y-4">
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                <GlobeHemisphereWestIcon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <div>
                <p className="font-extrabold text-sm sm:text-base">
                  {lang === "fa" ? "مجوز جستجو در شبکه‌های جهانی" : "External Music Access Control"}
                </p>
                <p className="text-xs text-[var(--sf-muted)]">
                  {lang === "fa"
                    ? "کاربرانی که این گزینه برای آن‌ها فعال باشد، می‌توانند در یوتیوب، ساندکلود و اسپاتیفای جستجو و پخش آنلاین داشته باشند."
                    : "Users with this permission enabled can search and stream directly from YouTube, SoundCloud, and Spotify."}
                </p>
              </div>
            </div>

            {/* Filter / Search input */}
            <div className="relative">
              <input
                type="text"
                value={adminSearchQuery}
                onChange={(e) => setAdminSearchQuery(e.target.value)}
                placeholder={lang === "fa" ? "جستجوی کاربر بر اساس نام یا نام کاربری..." : "Search user by name or username..."}
                className="w-full rounded-2xl bg-white/[0.05] border border-white/10 px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            {adminActionFeedback && (
              <div className="rounded-xl bg-indigo-500/15 border border-indigo-500/30 p-2.5 text-xs text-indigo-300 font-medium">
                {adminActionFeedback}
              </div>
            )}

            {/* Users List */}
            <div className="divide-y divide-white/[0.06] max-h-72 overflow-y-auto rounded-2xl border border-white/[0.06] bg-black/20">
              {filteredAdminUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--sf-muted)]">
                  {adminUsersLoading
                    ? (lang === "fa" ? "در حال بارگذاری کاربران..." : "Loading users...")
                    : (lang === "fa" ? "کاربری یافت نشد." : "No users found.")}
                </div>
              ) : (
                filteredAdminUsers.map((u) => {
                  const isEnabled = Boolean(u.canAccessGlobalSearch || u.role === "admin" || u.isAdmin);
                  const isSelf = user ? u.id === user.id : false;

                  return (
                    <div key={u.id} className="flex items-center justify-between gap-3 p-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm"
                          style={{ backgroundColor: u.avatarColor || "#6366F1" }}
                        >
                          {(u.displayName || u.username || "U").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs truncate">{u.displayName || u.username}</span>
                            {u.role === "admin" && (
                              <span className="rounded-full bg-violet-500/20 px-1.5 py-0.2 text-[9px] font-bold text-violet-400">
                                Admin
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[var(--sf-muted)] truncate block">
                            @{u.username}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          isEnabled
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                            : "bg-amber-500/15 text-amber-400 border-amber-500/25"
                        }`}>
                          {isEnabled ? (lang === "fa" ? "فعال" : "Enabled") : (lang === "fa" ? "غیرفعال" : "Disabled")}
                        </span>
                        <Switch
                          checked={isEnabled}
                          disabled={isSelf || u.role === "admin" || Boolean(u.isAdmin)}
                          onCheckedChange={(next) => void handleToggleUserGlobalSearch(u.id, next)}
                          aria-label={`Toggle global search access for ${u.username}`}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Group 5: About & App Version (Apple HIG Grouped Settings List) */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {lang === "fa" ? "درباره برنامه" : "About"}
        </span>
        <div className="rounded-3xl sf-content-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.04] dark:divide-white/[0.06] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5 min-h-[56px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#8E8E93] text-white shadow-sm shrink-0">
                <InfoIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <span className="font-semibold text-sm truncate">
                {lang === "fa" ? "نسخه برنامه" : "Version"}
              </span>
            </div>
            <span
              dir="ltr"
              className="text-sm font-medium text-[var(--sf-muted)] tabular-nums shrink-0"
            >
              {APP_VERSION} ({APP_BUILD_NUMBER})
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5 min-h-[56px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#34C759] text-white shadow-sm shrink-0">
                <DeviceMobileIcon size={18} weight="bold" aria-hidden="true" />
              </span>
              <span className="font-semibold text-sm truncate">
                {lang === "fa" ? "پلتفرم" : "Platform"}
              </span>
            </div>
            <span
              dir="ltr"
              className="text-sm font-medium text-[var(--sf-muted)] shrink-0"
            >
              {isAndroidNative() ? `${APP_CHANNEL} App` : "Web"}
            </span>
          </div>
        </div>

        <p
          dir="ltr"
          className="text-center text-[11px] font-medium text-[var(--sf-muted)]/75 pt-2 pb-1 tabular-nums"
        >
          Soundify • v{APP_VERSION} (Build {APP_BUILD_NUMBER})
        </p>
      </div>
    </div>
  );
}

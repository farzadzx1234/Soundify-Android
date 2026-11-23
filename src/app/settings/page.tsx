"use client";

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CloudCheckIcon,
  DeviceMobileIcon,
  FolderSimpleIcon,
  GlobeHemisphereWestIcon,
  GlobeIcon,
  HardDriveIcon,
  InfoIcon,
  KeyIcon,
  PaintBrushIcon,
  PencilSimpleIcon,
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
  const { lang, setLang, t, formatNum } = useI18n();
  const { choice, setChoice } = useTheme();
  const { visualizerEnabled, setVisualizerEnabled } = usePlayer();

  const [highQuality, handleToggleHighQuality] = useLocalStorageBool("soundify_hq", true);
  const [offlineCache, handleToggleOfflineCache] = useLocalStorageBool("soundify_offline_cache", true);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Storage management controls
  const {
    downloadedTracks,
    storageBudgetInfo,
    clearAll: clearAllOfflineTracks,
    clearCache: clearOfflineAudioCache,
  } = useDownloadedTracks();
  const [offlineCacheCleared, setOfflineCacheCleared] = useState(false);
  const [confirmClearOfflineCache, setConfirmClearOfflineCache] = useState(false);
  const [confirmDeleteAllDownloads, setConfirmDeleteAllDownloads] = useState(false);

  // Collapsible account disclosure panels (Apple Settings progressive disclosure)
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);

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
      setProfileFeedback(lang === "fa" ? "تغییرات حساب ذخیره شد." : "Profile updated successfully.");
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

  const cardGroupClass =
    "rounded-[22px] bg-white/95 dark:bg-[#14161f] border border-black/[0.06] dark:border-white/[0.07] shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden";

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24 sm:pb-16">
      {/* Apple HIG Large Display Title */}
      <header className="px-1 pt-1 space-y-1">
        <h1 className="text-[28px] sm:text-4xl font-black tracking-tight text-[var(--sf-text)] leading-tight">
          {t("settingsTitle")}
        </h1>
        <p className="text-xs sm:text-sm text-[var(--sf-muted)]">
          {lang === "fa"
            ? "ظاهر برنامه، تنظیمات صدا، فایل‌های آفلاین و حساب کاربری"
            : "Appearance, audio preferences, offline storage, and account"}
        </p>
      </header>

      {/* Group 0: Apple ID Style Account Hero */}
      <section aria-label={t("settingsAccountGroup")} className="space-y-2">
        <div className={cardGroupClass}>
          {user ? (
            <>
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span
                    className="h-13 w-13 rounded-full flex items-center justify-center font-black text-lg text-white shadow-sm ring-1 ring-black/10 dark:ring-white/15 shrink-0"
                    style={{ backgroundColor: user.avatarColor || "#6366f1" }}
                  >
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <bdi className="font-extrabold text-base text-[var(--sf-text)] truncate">
                        {lang === "fa" && user.displayNameFa ? user.displayNameFa : user.displayName}
                      </bdi>
                      {user.role === "admin" && (
                        <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 shrink-0">
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--sf-muted)] truncate mt-0.5" dir="ltr">
                      @{user.username} • {user.email}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="glass"
                  destructive
                  onClick={() => void logout()}
                  icon={<SignOutIcon size={16} aria-hidden="true" />}
                  className="!min-h-[38px] !px-3 text-xs font-bold shrink-0"
                >
                  {t("signOut")}
                </Button>
              </div>

              {/* Disclosure 1: Edit Profile */}
              <div>
                <button
                  type="button"
                  onClick={() => setEditProfileOpen((prev) => !prev)}
                  aria-expanded={editProfileOpen}
                  className="sf-press w-full flex items-center justify-between gap-3 px-4 py-3.5 min-h-[50px] text-start hover:bg-black/[0.02] dark:hover:bg-white/[0.03] cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-indigo-500 text-white shrink-0">
                      <PencilSimpleIcon size={16} weight="bold" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold text-[var(--sf-text)]">
                      {lang === "fa" ? "ویرایش نام و مشخصات" : "Edit Profile Name"}
                    </span>
                  </div>
                  <CaretLeftIcon
                    size={16}
                    weight="bold"
                    className={`text-[var(--sf-muted)] transition-transform duration-200 ltr:rotate-180 ${
                      editProfileOpen ? "-rotate-90 ltr:rotate-90" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {editProfileOpen && (
                  <form onSubmit={(e) => void handleSaveProfile(e)} className="px-4 pb-4 pt-1 space-y-2.5 bg-black/[0.015] dark:bg-white/[0.02]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder={lang === "fa" ? "نام نمایشی (انگلیسی)" : "Display Name"}
                        className="w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/10 text-[var(--sf-text)] placeholder:text-[var(--sf-muted)]/60 px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                        required
                      />
                      <input
                        type="text"
                        value={editDisplayNameFa}
                        onChange={(e) => setEditDisplayNameFa(e.target.value)}
                        placeholder={lang === "fa" ? "نام نمایشی (فارسی)" : "Persian Display Name"}
                        className="w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/10 text-[var(--sf-text)] placeholder:text-[var(--sf-muted)]/60 px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {profileFeedback ? (
                        <span className="text-xs font-medium text-emerald-500">{profileFeedback}</span>
                      ) : (
                        <span />
                      )}
                      <Button
                        type="submit"
                        variant="filled"
                        disabled={profileSaving}
                        className="!min-h-[38px] !px-4 text-xs font-bold"
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
                )}
              </div>

              {/* Disclosure 2: Change Password */}
              <div>
                <button
                  type="button"
                  onClick={() => setChangePwdOpen((prev) => !prev)}
                  aria-expanded={changePwdOpen}
                  className="sf-press w-full flex items-center justify-between gap-3 px-4 py-3.5 min-h-[50px] text-start hover:bg-black/[0.02] dark:hover:bg-white/[0.03] cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-amber-500 text-white shrink-0">
                      <KeyIcon size={16} weight="bold" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold text-[var(--sf-text)]">
                      {lang === "fa" ? "تغییر رمز عبور" : "Change Password"}
                    </span>
                  </div>
                  <CaretLeftIcon
                    size={16}
                    weight="bold"
                    className={`text-[var(--sf-muted)] transition-transform duration-200 ltr:rotate-180 ${
                      changePwdOpen ? "-rotate-90 ltr:rotate-90" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {changePwdOpen && (
                  <form onSubmit={(e) => void handleChangePassword(e)} className="px-4 pb-4 pt-1 space-y-2.5 bg-black/[0.015] dark:bg-white/[0.02]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="password"
                        value={currentPwd}
                        onChange={(e) => setCurrentPwd(e.target.value)}
                        placeholder={lang === "fa" ? "رمز عبور فعلی" : "Current Password"}
                        className="w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/10 text-[var(--sf-text)] placeholder:text-[var(--sf-muted)]/60 px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                        required
                      />
                      <input
                        type="password"
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        placeholder={lang === "fa" ? "رمز عبور جدید (حداقل ۶ نویسه)" : "New Password (min 6 chars)"}
                        className="w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/10 text-[var(--sf-text)] placeholder:text-[var(--sf-muted)]/60 px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                        required
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {pwdFeedback ? (
                        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">{pwdFeedback}</span>
                      ) : (
                        <span />
                      )}
                      <Button
                        type="submit"
                        variant="glass"
                        disabled={pwdSaving || !currentPwd || !newPwd}
                        className="!min-h-[38px] !px-4 text-xs font-bold"
                      >
                        {pwdSaving
                          ? lang === "fa"
                            ? "در حال تغییر..."
                            : "Changing..."
                          : lang === "fa"
                            ? "ثبت رمز جدید"
                            : "Update Password"}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500/12 text-indigo-500 shrink-0">
                  <UserCircleIcon size={26} weight="bold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{t("guestAccount")}</p>
                  <p className="text-xs text-[var(--sf-muted)] truncate">{t("loginRequired")}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                className="!min-h-[40px] !px-4 text-xs font-bold shrink-0"
              >
                {t("signIn")}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Group 1: Appearance & Language */}
      <section aria-label={t("settingsGeneralGroup")} className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsGeneralGroup")}
        </h2>
        <div className={cardGroupClass}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#007AFF] text-white shrink-0">
                <GlobeIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">{t("languageLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("languageDesc")}</span>
              </div>
            </div>
            <GlassSegmented
              aria-label={t("languageLabel")}
              size="sm"
              className="self-end sm:self-auto shrink-0"
              value={lang}
              onValueChange={(v) => setLang(v as Lang)}
              items={[
                { value: "fa", label: "فارسی" },
                { value: "en", label: "English" },
              ]}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#5856D6] text-white shrink-0">
                <PaintBrushIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">{t("themeLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("themeDesc")}</span>
              </div>
            </div>
            <GlassSegmented
              aria-label={t("themeLabel")}
              size="sm"
              className="self-end sm:self-auto shrink-0"
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
      </section>

      {/* Group 2: Audio & Playback */}
      <section aria-label={t("settingsPlaybackGroup")} className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("settingsPlaybackGroup")}
        </h2>
        <div className={cardGroupClass}>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[58px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#34C759] text-white shrink-0">
                <SparkleIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">{t("highQualityAudio")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("highQualityDesc")}</span>
              </div>
            </div>
            <Switch
              aria-label={t("highQualityAudio")}
              checked={highQuality}
              onCheckedChange={handleToggleHighQuality}
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[58px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#FF2D55] text-white shrink-0">
                <WaveformIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">{t("visualizerLabel")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">{t("visualizerDesc")}</span>
              </div>
            </div>
            <Switch
              aria-label={t("visualizerLabel")}
              checked={visualizerEnabled}
              onCheckedChange={setVisualizerEnabled}
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[58px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#00C7BE] text-white shrink-0">
                <CloudCheckIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">{t("offlineCacheTitle")}</span>
                <span className="block text-xs text-[var(--sf-muted)]">
                  {lang === "fa"
                    ? "نگهداری موقت آهنگ‌ها برای پخش فوری در دفعات بعدی"
                    : "Keep recent tracks cached locally for instant playback"}
                </span>
              </div>
            </div>
            <Switch
              aria-label={t("offlineCacheTitle")}
              checked={offlineCache}
              onCheckedChange={handleToggleOfflineCache}
            />
          </div>
        </div>
      </section>

      {/* Group 3: Downloads & Device Storage */}
      <section aria-label={t("storageMeter")} className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {t("storageMeter")}
        </h2>
        <div className={cardGroupClass}>
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                <HardDriveIcon size={19} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{t("storageUsed")}</span>
                  <span className="tabular-nums font-extrabold text-sm text-[var(--sf-text)]" dir="ltr">
                    {formatSize(storageBudgetInfo.usageBytes)}
                  </span>
                </div>
                <p className="text-xs text-[var(--sf-muted)] mt-0.5 tabular-nums">
                  {formatNum(downloadedTracks.length)} {t("tracksCount")} • {formatSize(storageBudgetInfo.songsBytes)}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 shrink-0">
              {lang === "fa" ? "دانلود نامحدود" : "Unlimited"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-indigo-500/15 text-indigo-500 shrink-0">
                <FolderSimpleIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block font-semibold text-sm text-[var(--sf-text)]">
                  {lang === "fa" ? "ذخیره خودکار در پوشه دائمی گوشی" : "Persistent Device Music Folder"}
                </span>
                <span className="block text-xs text-[var(--sf-muted)]">
                  {lang === "fa"
                    ? "آهنگ‌ها در پوشه Music/Soundify ذخیره می‌شوند و با پاک کردن برنامه هم نمی‌روند"
                    : "Saved in Music/Soundify so tracks survive uninstalling the app"}
                </span>
              </div>
            </div>
            <span dir="ltr" className="text-[11px] font-mono font-semibold text-[var(--sf-muted)] shrink-0">
              Music/Soundify
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[56px]">
            <div className="min-w-0">
              <span className="block font-semibold text-sm">{t("clearOfflineCacheTitle")}</span>
              <span className="block text-xs text-[var(--sf-muted)]">{t("clearOfflineCacheDesc")}</span>
            </div>
            <Button
              type="button"
              variant="glass"
              onClick={() => setConfirmClearOfflineCache(true)}
              className="!min-h-[36px] !px-3.5 text-xs font-semibold shrink-0"
            >
              {offlineCacheCleared ? t("clearOfflineCacheDone") : (lang === "fa" ? "پاک‌سازی" : "Clear")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[56px]">
            <div className="min-w-0">
              <span className="block font-semibold text-sm">{t("clearCacheTitle")}</span>
              <span className="block text-xs text-[var(--sf-muted)]">{t("clearCacheDesc")}</span>
            </div>
            <Button
              type="button"
              variant="glass"
              onClick={handleClearCache}
              className="!min-h-[36px] !px-3.5 text-xs font-semibold shrink-0"
            >
              {cacheCleared ? t("clearCacheDone") : t("clearCacheBtn")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[56px]">
            <div className="min-w-0">
              <span className="block font-semibold text-sm text-rose-500">{t("deleteAllDownloadsTitle")}</span>
              <span className="block text-xs text-[var(--sf-muted)]">{t("deleteAllDownloadsDesc")}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              destructive
              onClick={() => setConfirmDeleteAllDownloads(true)}
              disabled={downloadedTracks.length === 0}
              icon={<TrashIcon size={15} aria-hidden="true" />}
              className="!min-h-[36px] !px-3 text-xs font-semibold shrink-0"
            >
              {lang === "fa" ? "حذف همه" : "Delete All"}
            </Button>
          </div>
        </div>
      </section>

      {/* Group 4: Admin Permissions Management (Visible to Admins only) */}
      {Boolean(user && (user.role === "admin" || user.isAdmin)) && (
        <section aria-label="Global Search Permissions" className="space-y-2">
          <div className="flex items-center justify-between px-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)]">
              {lang === "fa" ? "مدیریت دسترسی‌های جستجوی جهانی" : "Global Search Permissions"}
            </h2>
            <Button
              type="button"
              variant="glass"
              disabled={adminUsersLoading}
              onClick={() => void fetchAdminUsers()}
              icon={<ArrowClockwiseIcon size={14} className={adminUsersLoading ? "animate-spin" : ""} />}
              className="!min-h-[30px] !px-2.5 !text-[11px]"
            >
              {lang === "fa" ? "بروزرسانی" : "Refresh"}
            </Button>
          </div>

          <div className="rounded-[22px] bg-white/95 dark:bg-[#14161f] border border-black/[0.06] dark:border-white/[0.07] p-4 space-y-3.5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-500 shrink-0">
                <GlobeHemisphereWestIcon size={20} weight="duotone" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-sm">
                  {lang === "fa" ? "مجوز جستجو در شبکه‌های جهانی" : "External Music Access Control"}
                </p>
                <p className="text-xs text-[var(--sf-muted)] mt-0.5">
                  {lang === "fa"
                    ? "مدیریت کاربرانی که امکان جستجو و پخش در یوتیوب، ساندکلود و اسپاتیفای را دارند."
                    : "Control which users can search and play from YouTube, SoundCloud, and Spotify."}
                </p>
              </div>
            </div>

            <input
              type="text"
              value={adminSearchQuery}
              onChange={(e) => setAdminSearchQuery(e.target.value)}
              placeholder={lang === "fa" ? "جستجوی کاربر..." : "Search user..."}
              className="w-full rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/10 text-[var(--sf-text)] px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
            />

            {adminActionFeedback && (
              <div className="rounded-xl bg-indigo-500/12 border border-indigo-500/25 p-2.5 text-xs text-indigo-600 dark:text-indigo-300 font-medium">
                {adminActionFeedback}
              </div>
            )}

            <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06] max-h-64 overflow-y-auto rounded-2xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
              {filteredAdminUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--sf-muted)]">
                  {adminUsersLoading
                    ? (lang === "fa" ? "در حال بارگذاری..." : "Loading users...")
                    : (lang === "fa" ? "کاربری یافت نشد." : "No users found.")}
                </div>
              ) : (
                filteredAdminUsers.map((u) => {
                  const isEnabled = Boolean(u.canAccessGlobalSearch || u.role === "admin" || u.isAdmin);
                  const isSelf = user ? u.id === user.id : false;

                  return (
                    <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                          style={{ backgroundColor: u.avatarColor || "#6366F1" }}
                        >
                          {(u.displayName || u.username || "U").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs truncate">{u.displayName || u.username}</span>
                            {u.role === "admin" && (
                              <span className="rounded-full bg-indigo-500/15 px-1.5 text-[9px] font-bold text-indigo-500">
                                Admin
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[var(--sf-muted)] truncate block" dir="ltr">
                            @{u.username}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isEnabled
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          }`}
                        >
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
        </section>
      )}

      {/* Group 5: About & App Version */}
      <section aria-label={lang === "fa" ? "درباره برنامه" : "About"} className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)] px-3">
          {lang === "fa" ? "درباره برنامه" : "About"}
        </h2>
        <div className={cardGroupClass}>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[54px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#8E8E93] text-white shrink-0">
                <InfoIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <span className="font-semibold text-sm truncate">
                {lang === "fa" ? "نسخه برنامه" : "Version"}
              </span>
            </div>
            <span dir="ltr" className="text-sm font-medium text-[var(--sf-muted)] tabular-nums shrink-0">
              {APP_VERSION} ({APP_BUILD_NUMBER})
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[54px]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#34C759] text-white shrink-0">
                <DeviceMobileIcon size={17} weight="bold" aria-hidden="true" />
              </span>
              <span className="font-semibold text-sm truncate">
                {lang === "fa" ? "پلتفرم" : "Platform"}
              </span>
            </div>
            <span dir="ltr" className="text-sm font-medium text-[var(--sf-muted)] shrink-0">
              {isAndroidNative() ? `${APP_CHANNEL} App` : "Web"}
            </span>
          </div>
        </div>

        <p dir="ltr" className="text-center text-[11px] font-medium text-[var(--sf-muted)]/75 pt-2 pb-1 tabular-nums">
          Soundify • v{APP_VERSION} (Build {APP_BUILD_NUMBER})
        </p>
      </section>

      {/* Confirmation Modal: Clear Offline Cache */}
      {typeof document !== "undefined" && confirmClearOfflineCache && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-cache-dialog-title"
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md"
          onClick={() => setConfirmClearOfflineCache(false)}
        >
          <div
            className="sf-sheet-up w-full max-w-sm sm:max-w-md bg-white/95 dark:bg-[#14161f]/98 text-[var(--sf-text)] rounded-t-[28px] sm:rounded-3xl p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.35)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/30 mx-auto -mt-1 mb-2.5 sm:hidden" />
            <div className="text-center space-y-2 pt-1">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/15 text-amber-500 mx-auto flex items-center justify-center mb-1 ring-1 ring-amber-500/25">
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
                className="sf-press w-full min-h-[50px] rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm cursor-pointer shadow-sm"
              >
                {lang === "fa" ? "پاک‌سازی حافظه موقت" : "Clear Cache"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearOfflineCache(false)}
                className="sf-press w-full min-h-[50px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm cursor-pointer border border-black/[0.08] dark:border-white/10"
              >
                {lang === "fa" ? "لغو" : "Cancel"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Confirmation Modal: Delete All Downloads */}
      {typeof document !== "undefined" && confirmDeleteAllDownloads && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-dialog-title"
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md"
          onClick={() => setConfirmDeleteAllDownloads(false)}
        >
          <div
            className="sf-sheet-up w-full max-w-sm sm:max-w-md bg-white/95 dark:bg-[#14161f]/98 text-[var(--sf-text)] rounded-t-[28px] sm:rounded-3xl p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.35)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/30 mx-auto -mt-1 mb-2.5 sm:hidden" />
            <div className="text-center space-y-2 pt-1">
              <div className="h-12 w-12 rounded-2xl bg-rose-500/15 text-rose-500 mx-auto flex items-center justify-center mb-1 ring-1 ring-rose-500/25">
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
                className="sf-press w-full min-h-[50px] rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm cursor-pointer shadow-sm"
              >
                {lang === "fa" ? "حذف دائمی تمام آهنگ‌ها" : "Delete All Tracks"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteAllDownloads(false)}
                className="sf-press w-full min-h-[50px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm cursor-pointer border border-black/[0.08] dark:border-white/10"
              >
                {lang === "fa" ? "لغو" : "Cancel"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

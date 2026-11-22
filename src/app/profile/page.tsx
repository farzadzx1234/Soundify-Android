"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  BooksIcon,
  CheckCircleIcon,
  DeviceMobileIcon,
  GlobeHemisphereWestIcon,
  KeyIcon,
  PaintBrushIcon,
  SignOutIcon,
  UserCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { Button, Glass, Input } from "@/components/GlassControls";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";

const AVATAR_PALETTE = [
  "#6366F1", // Indigo
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F43F5E", // Rose
  "#EF4444", // Red
  "#F97316", // Orange
  "#F59E0B", // Amber
  "#10B981", // Emerald
  "#06B6D4", // Cyan
  "#3B82F6", // Blue
];

export default function ProfilePage() {
  const { user, openAuthDialog, logout, updateProfile, changePassword, userSyncData } = useAuth();
  const { t, lang } = useI18n();

  // Profile Form state
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [displayNameFa, setDisplayNameFa] = useState(user?.displayNameFa ?? "");
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? "#6366F1");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Apple HIG Session Sign-Out Confirmation state
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileSuccess(false);
    setProfileError("");

    try {
      await updateProfile({
        displayName: displayName.trim() || undefined,
        displayNameFa: displayNameFa.trim() || undefined,
        avatarColor,
      });
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError(lang === "fa" ? "رمز عبور جدید و تکرار آن یکسان نیستند." : "Passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(lang === "fa" ? "رمز عبور جدید باید حداقل ۶ نویسه باشد." : "Password must be at least 6 characters.");
      return;
    }

    setPasswordSaving(true);
    setPasswordSuccess(false);
    setPasswordError("");

    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto">
        <Glass className="p-10 text-center rounded-3xl border border-black/[0.06] dark:border-white/10 space-y-4">
          <UserCircleIcon size={56} className="mx-auto text-zinc-500" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {lang === "fa" ? "حساب کاربری ساندیفای" : "Soundify Account"}
            </h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
              {lang === "fa"
                ? "برای مشاهده و مدیریت حساب کاربری، لطفا وارد شوید یا ثبت‌نام کنید."
                : "Please sign in or create an account to view and manage your profile."}
            </p>
          </div>
          <Button variant="filled" onClick={openAuthDialog} className="rounded-full">
            {t("signIn")}
          </Button>
        </Glass>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Profile Overview Card */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border border-white/10 bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-black/80 backdrop-blur-2xl shadow-xl flex flex-col sm:flex-row items-center gap-6">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-xl ring-4 ring-white/10 shrink-0"
          style={{ backgroundColor: user.avatarColor || avatarColor }}
        >
          {(user.displayName || user.username || "U").charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 text-center sm:text-start space-y-2">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              {lang === "fa" && user.displayNameFa ? user.displayNameFa : user.displayName || user.username}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">
              {user.role}
            </span>
          </div>
          <p className="text-sm text-zinc-400">@{user.username} • {user.email}</p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 pt-2 text-xs text-zinc-300">
            <Link href="/library" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <BooksIcon size={16} />
              <span>{userSyncData?.likedTrackIds.length ?? 0} {lang === "fa" ? "آهنگ لایک شده" : "Liked Tracks"}</span>
            </Link>
            <Link href="/settings" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <DeviceMobileIcon size={16} />
              <span>{userSyncData?.activeDevices.length ?? 1} {lang === "fa" ? "دیوایس فعال" : "Active Devices"}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Global Search Access Permission Banner (Only visible if access is granted) */}
      {Boolean(user.canAccessGlobalSearch || user.role === "admin" || user.isAdmin) && (
        <section className="rounded-3xl p-5 border border-emerald-500/20 bg-emerald-950/10 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-md shadow-emerald-500/10">
              <GlobeHemisphereWestIcon size={24} weight="duotone" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {lang === "fa" ? "دسترسی به جستجوی جهانی" : "Global Search Access"}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  {lang === "fa" ? "فعال" : "Enabled"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 pt-0.5">
                {lang === "fa"
                  ? "شما مجاز به جستجو و استریم آنلاین در یوتیوب، ساندکلود و اسپاتیفای هستید."
                  : "You have full access to stream music from YouTube, SoundCloud, and Spotify."}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Edit Profile Form */}
        <section className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <PaintBrushIcon size={20} className="text-indigo-400" />
            <span>{lang === "fa" ? "ویرایش مشخصات" : "Edit Profile"}</span>
          </h2>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {lang === "fa" ? "نام نمایشی (انگلیسی)" : "Display Name (English)"}
              </label>
              <Input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your Name"
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {lang === "fa" ? "نام نمایشی (فارسی)" : "Display Name (Persian)"}
              </label>
              <Input
                type="text"
                value={displayNameFa}
                onChange={(e) => setDisplayNameFa(e.target.value)}
                placeholder="نام شما"
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-2">
                {lang === "fa" ? "رنگ آواتار" : "Avatar Color"}
              </label>
              <div className="flex flex-wrap gap-2">
                {AVATAR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      avatarColor === color ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-black" : "opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>

            {profileSuccess && (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircleIcon size={16} />
                <span>{lang === "fa" ? "تغییرات با موفقیت ذخیره شد." : "Profile updated successfully."}</span>
              </p>
            )}

            {profileError && (
              <p className="text-xs text-rose-400 flex items-center gap-1">
                <XCircleIcon size={16} />
                <span>{profileError}</span>
              </p>
            )}

            <Button type="submit" variant="filled" disabled={profileSaving} className="w-full rounded-full">
              {profileSaving ? (lang === "fa" ? "در حال ذخیره..." : "Saving...") : (lang === "fa" ? "ذخیره تغییرات" : "Save Changes")}
            </Button>
          </form>
        </section>

        {/* Change Password Form */}
        <section className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <KeyIcon size={20} className="text-amber-400" />
            <span>{lang === "fa" ? "تغییر رمز عبور" : "Change Password"}</span>
          </h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {lang === "fa" ? "رمز عبور فعلی" : "Current Password"}
              </label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {lang === "fa" ? "رمز عبور جدید" : "New Password"}
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {lang === "fa" ? "تکرار رمز عبور جدید" : "Confirm New Password"}
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full"
              />
            </div>

            {passwordSuccess && (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircleIcon size={16} />
                <span>{lang === "fa" ? "رمز عبور با موفقیت به‌روزرسانی شد." : "Password updated successfully."}</span>
              </p>
            )}

            {passwordError && (
              <p className="text-xs text-rose-400 flex items-center gap-1">
                <XCircleIcon size={16} />
                <span>{passwordError}</span>
              </p>
            )}

            <Button type="submit" variant="glass" disabled={passwordSaving} className="w-full rounded-full">
              {passwordSaving ? (lang === "fa" ? "در حال تغییر..." : "Updating...") : (lang === "fa" ? "به‌روزرسانی رمز عبور" : "Update Password")}
            </Button>
          </form>
        </section>
      </div>

      {/* Account Session / Destructive Sign Out Section */}
      <section className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.04] dark:bg-rose-950/[0.15] backdrop-blur-xl p-5 sm:p-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 transition-all shadow-sm">
        <div className="flex items-center gap-3.5 text-start flex-1 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-500 dark:text-rose-400 shrink-0 shadow-sm">
            <SignOutIcon size={20} weight="bold" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              {lang === "fa" ? "مدیریت نشست و حساب" : "Account Session"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
              {lang === "fa"
                ? "خروج امن از حساب کاربری در این دستگاه"
                : "Safely sign out of your account on this device"}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="glass"
          destructive
          onClick={() => {
            void triggerHapticFeedback("medium");
            setShowLogoutConfirm(true);
          }}
          icon={<SignOutIcon size={18} weight="bold" aria-hidden="true" />}
          className="w-full sm:w-auto px-6 rounded-2xl border-rose-500/35 text-rose-600 dark:text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] transition-all min-h-[44px]"
        >
          {t("signOut")}
        </Button>
      </section>

      {/* Apple HIG Destructive Confirmation Action Sheet */}
      {showLogoutConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#12151c] border border-black/10 dark:border-white/15 p-6 shadow-2xl space-y-5 animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-250 text-start"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-500 dark:text-rose-400 shrink-0">
                <SignOutIcon size={22} weight="bold" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {lang === "fa" ? "خروج از حساب کاربری" : "Sign Out of Account"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  {user.email || user.username}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">
              {lang === "fa"
                ? "آیا مطمئن هستید که می‌خواهید از حساب خود خارج شوید؟ برای دسترسی دوباره به پلی‌لیست‌ها و همگام‌سازی، باید مجدداً وارد شوید."
                : "Are you sure you want to sign out? You will need to sign in again to access cloud sync and personalized playlists."}
            </p>

            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowLogoutConfirm(false)}
                className="w-full sm:w-auto rounded-full"
              >
                {lang === "fa" ? "انصراف" : "Cancel"}
              </Button>
              <Button
                type="button"
                variant="filled"
                destructive
                onClick={() => {
                  void triggerHapticFeedback("heavy");
                  setShowLogoutConfirm(false);
                  logout();
                }}
                icon={<SignOutIcon size={18} weight="bold" aria-hidden="true" />}
                className="w-full sm:w-auto rounded-full"
              >
                {lang === "fa" ? "خروج از حساب" : "Sign Out"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

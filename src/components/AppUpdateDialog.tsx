"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  APP_VERSION,
  MIN_SERVER_SUPPORTED_VERSION,
  subscribeAppUpdateRequired,
  clearAppUpdateRequired,
  type AppUpdateRequiredInfo,
} from "@/lib/appVersion";
import { useI18n } from "@/context/I18nContext";

export const GITHUB_RELEASES_URL =
  "https://github.com/farzadzx1234/Soundify-Android/releases/latest";

export function AppUpdateDialog() {
  const { lang } = useI18n();
  const [updateInfo, setUpdateInfo] = useState<AppUpdateRequiredInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeAppUpdateRequired((info) => {
      setUpdateInfo(info);
      setIsOpen(true);
    });
    return unsubscribe;
  }, []);

  const handleDismiss = () => {
    setIsOpen(false);
    clearAppUpdateRequired();
  };

  const handleDownload = () => {
    if (typeof window !== "undefined") {
      window.open(GITHUB_RELEASES_URL, "_blank", "noopener,noreferrer");
    }
  };

  if (!isOpen) return null;

  const isFa = lang === "fa";
  const minVersion = updateInfo?.minSupportedVersion || MIN_SERVER_SUPPORTED_VERSION;
  const message = isFa
    ? updateInfo?.messageFa ||
      updateInfo?.message ||
      "نسخه برنامه شما قدیمی است. برای استفاده از جستجوی جهانی، یوتیوب، ساندکلود و اسپاتیفای، برنامه را به آخرین نسخه به‌روزرسانی کنید."
    : updateInfo?.messageEn ||
      updateInfo?.message ||
      "Your application version is outdated. Please update to the latest version to access global search and streaming.";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      aria-describedby="app-update-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-[28px] border border-white/15 bg-neutral-900/90 p-6 text-center shadow-2xl backdrop-blur-2xl ring-1 ring-white/10"
        dir={isFa ? "rtl" : "ltr"}
      >
        {/* Subtle Ambient Glow */}
        <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-32 w-32 rounded-full bg-emerald-500/20 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={handleDismiss}
          type="button"
          aria-label={isFa ? "بستن" : "Close"}
          className="absolute top-4 left-4 p-2 text-neutral-400 hover:text-white transition-colors rounded-full active:scale-95 touch-manipulation"
        >
          <XIcon size={18} weight="bold" />
        </button>

        {/* Icon Badge */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-400/20 border border-emerald-500/30 text-emerald-400 shadow-inner">
          <DownloadSimpleIcon size={32} weight="bold" />
        </div>

        {/* Title */}
        <h2
          id="app-update-title"
          className="text-lg font-bold text-white tracking-tight leading-snug"
        >
          {isFa ? "به‌روزرسانی الزامی برنامه" : "App Update Required"}
        </h2>

        {/* Version Badges */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs font-mono text-neutral-300">
            {isFa ? `فعلی: v${APP_VERSION}` : `Current: v${APP_VERSION}`}
          </span>
          <span className="text-neutral-500 text-xs">←</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-mono font-medium text-emerald-300">
            {isFa ? `حداقل: v${minVersion}` : `Min: v${minVersion}`}
          </span>
        </div>

        {/* Message */}
        <p
          id="app-update-desc"
          className="mt-3.5 text-xs leading-relaxed text-neutral-300 font-normal px-1"
        >
          {message}
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleDownload}
            className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition-all duration-150 active:scale-[0.98] active:brightness-95 hover:brightness-105 touch-manipulation"
          >
            <DownloadSimpleIcon size={18} weight="bold" />
            <span>{isFa ? "دریافت نسخه جدید از گیت‌هاب" : "Download Update from GitHub"}</span>
            <ArrowSquareOutIcon size={16} weight="bold" className="opacity-80" />
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="w-full min-h-[42px] flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-neutral-300 transition-all duration-150 active:scale-[0.98] hover:bg-white/10 hover:text-white touch-manipulation"
          >
            {isFa ? "متوجه شدم (استفاده آفلاین)" : "Dismiss (Continue Offline)"}
          </button>
        </div>
      </div>
    </div>
  );
}

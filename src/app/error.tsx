"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { ArrowClockwiseIcon, CloudSlashIcon, MusicNotesSimpleIcon } from "@phosphor-icons/react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error for diagnostics without letting it crash client
    console.error("Soundify App error boundary caught:", error);
  }, [error]);

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl p-6 sm:p-8 bg-[#0c101a]/95 border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop-blur-3xl text-center space-y-5 text-white sf-fade-up">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shadow-[0_0_24px_rgba(99,102,241,0.2)]">
          {isOffline ? (
            <CloudSlashIcon size={32} weight="duotone" aria-hidden="true" />
          ) : (
            <MusicNotesSimpleIcon size={32} weight="duotone" aria-hidden="true" />
          )}
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">
            {isOffline ? "اتصال اینترنت قطع شده است" : "مشکلی در بارگذاری رخ داد"}
          </h1>
          <p className="text-xs text-white/70 leading-relaxed">
            {isOffline
              ? "دستگاه شما در حالت آفلاین قرار دارد. آهنگ‌های دانلود شده در کتابخانه همیشه در دسترس هستند."
              : "خطایی هنگام بارگذاری اطلاعات پیش آمد. می‌توانید دوباره تلاش کنید یا به صفحه اصلی بازگردید."}
          </p>
          {!isOffline && error?.message && (
            <p className="text-[11px] font-mono text-white/45 break-words px-2" dir="ltr">
              {String(error.message).slice(0, 140)}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/30"
          >
            <ArrowClockwiseIcon size={16} weight="bold" />
            <span>تلاش مجدد</span>
          </button>

          <Link
            href="/library"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white text-xs font-bold transition-all border border-white/10"
          >
            <span>کتابخانه و دانلودها</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

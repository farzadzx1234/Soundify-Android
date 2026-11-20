"use client";

import React, { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Soundify Root error caught:", error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body className="bg-[#050708] text-white flex items-center justify-center min-h-screen p-4 font-sans select-none">
        <div className="w-full max-w-md rounded-3xl p-6 sm:p-8 bg-[#0c101a]/95 border border-white/10 shadow-2xl text-center space-y-4">
          <div className="text-2xl font-black text-indigo-400">Soundify</div>
          <h1 className="text-lg font-bold">خطایی در برنامه رخ داد</h1>
          <p className="text-xs text-white/70">
            برنامه در حالت آفلاین یا بدون اتصال به سرور قرار دارد. می‌توانید دوباره بارگذاری کنید.
          </p>
          <div className="pt-2 flex gap-2 justify-center">
            <button
              onClick={() => reset()}
              className="px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition-all cursor-pointer"
            >
              تلاش مجدد
            </button>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-all"
            >
              صفحه اصلی
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}

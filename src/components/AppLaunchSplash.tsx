"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/context/I18nContext";

// Module-level guard guarantees the launch splash renders strictly once per cold app start
// and never re-appears during client-side Next.js route transitions.
let hasShownLaunchSplash = false;

export function AppLaunchSplash() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState<boolean>(() => !hasShownLaunchSplash);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    hasShownLaunchSplash = true;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const holdMs = prefersReducedMotion ? 1100 : 2100;
    const fadeMs = prefersReducedMotion ? 120 : 350;

    const fadeTimer = window.setTimeout(() => {
      setFading(true);
    }, holdMs);

    const unmountTimer = window.setTimeout(() => {
      setVisible(false);
    }, holdMs + fadeMs);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={lang === "fa" ? "در حال آماده‌سازی ساندیفای" : "Loading Soundify"}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[var(--sf-bg)] text-[var(--sf-text)] select-none transition-opacity duration-300 ease-out ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Subtle Apple-style atmospheric center glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl"
      />

      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="relative h-20 w-20 rounded-[22px] overflow-hidden shadow-[0_18px_40px_rgba(99,102,241,0.28)] ring-1 ring-black/10 dark:ring-white/15 bg-black/5 dark:bg-white/5">
          <img
            src="/icons/icon-192.png"
            alt="Soundify"
            width={80}
            height={80}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight text-[var(--sf-text)]">
            {lang === "fa" ? "ساندیفای" : "Soundify"}
          </h1>
          <p className="text-xs font-medium text-[var(--sf-muted)]">
            {lang === "fa" ? "در حال آماده‌سازی پخش..." : "Preparing your music..."}
          </p>
        </div>

        {/* Sleek determinate-feel launch loading bar */}
        <div
          aria-hidden="true"
          className="relative h-1 w-36 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]"
        >
          <div
            className="h-full w-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-400 transition-transform duration-[2000ms] ease-out origin-left"
            style={{
              transform: fading ? "scaleX(1)" : "scaleX(0.92)",
              animation: "soundifyLaunchFill 2s cubic-bezier(0.22, 1, 0.36, 1) forwards",
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes soundifyLaunchFill {
          0% {
            transform: scaleX(0.08);
          }
          55% {
            transform: scaleX(0.72);
          }
          100% {
            transform: scaleX(1);
          }
        }
      `}</style>
    </div>
  );
}

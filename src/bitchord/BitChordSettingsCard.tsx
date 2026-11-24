"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwiseIcon, PaletteIcon, SparkleIcon } from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { Button, Switch } from "@/components/GlassControls";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
import {
  isBitChordBootActive,
  restartAppForDesignChange,
  useBitChordDesignPreference,
} from "./designMode";

const subscribeNoop = () => () => {};

export function BitChordSettingsCard() {
  const { lang } = useI18n();
  const [designEnabled, setDesignEnabled] = useBitChordDesignPreference();
  const bootActive = useSyncExternalStore(subscribeNoop, isBitChordBootActive, () => false);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);

  const needsRestart = designEnabled !== bootActive;

  useEffect(() => {
    if (!restartPromptOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRestartPromptOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [restartPromptOpen]);

  const handleToggle = (checked: boolean) => {
    void triggerHapticFeedback("selection");
    setDesignEnabled(checked);
    if (checked !== bootActive) {
      setRestartPromptOpen(true);
    } else {
      setRestartPromptOpen(false);
    }
  };

  return (
    <section
      aria-label={lang === "fa" ? "طراحی جدید رابط کاربری" : "New Interface Design"}
      className="space-y-2"
    >
      <div className="flex items-center justify-between px-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--sf-muted)]">
          {lang === "fa" ? "تجربه بصری جدید" : "New Interface Experience"}
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <SparkleIcon size={10} weight="fill" aria-hidden="true" />
          {lang === "fa" ? "جدید" : "NEW"}
        </span>
      </div>

      <div className="rounded-[24px] bg-white/90 dark:bg-white/[0.04] border border-black/[0.07] dark:border-white/[0.08] shadow-[0_4px_20px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.28)] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4 min-h-[68px]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/18 via-rose-500/15 to-sky-500/18 text-amber-600 dark:text-amber-300 border border-amber-500/20 shrink-0">
              <PaletteIcon size={20} weight="duotone" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-[var(--sf-text)]">
                  {lang === "fa" ? "طراحی جدید (شیشه مایع)" : "New Design (Liquid Glass)"}
                </span>
                {bootActive && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    {lang === "fa" ? "فعال" : "Active"}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--sf-muted)] mt-0.5 leading-relaxed">
                {lang === "fa"
                  ? "رابط کاربری مدرن با کپسول‌های شیشه مایع، صفحه اختصاصی خواننده، انیمیشن‌های روان و پلیر تمام‌صفحه (نیازمند راه‌اندازی مجدد)"
                  : "Modern liquid-glass capsules, dedicated artist pages, fluid animations & full-bleed player (requires restart)"}
              </p>
            </div>
          </div>

          <Switch
            aria-label={lang === "fa" ? "طراحی جدید (شیشه مایع)" : "New Design (Liquid Glass)"}
            checked={designEnabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {needsRestart && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 bg-amber-500/[0.08] dark:bg-amber-400/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                {designEnabled
                  ? lang === "fa"
                    ? "برای فعال‌سازی طراحی جدید، برنامه را مجدداً راه‌اندازی کنید."
                    : "Restart the app to activate the new Liquid Glass design."
                  : lang === "fa"
                    ? "برای بازگشت به طراحی اصلی برنامه، مجدداً راه‌اندازی کنید."
                    : "Restart the app to restore the original Soundify design."}
              </p>
            </div>
            <Button
              type="button"
              variant="filled"
              onClick={() => {
                void triggerHapticFeedback("selection");
                restartAppForDesignChange();
              }}
              icon={<ArrowClockwiseIcon size={15} weight="bold" aria-hidden="true" />}
              className="!min-h-[38px] !px-4 !text-xs font-bold shrink-0"
            >
              {lang === "fa" ? "راه‌اندازی مجدد" : "Restart App"}
            </Button>
          </div>
        )}
      </div>

      {typeof document !== "undefined" &&
        restartPromptOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-ui-restart-dialog-title"
            className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md"
            onClick={() => setRestartPromptOpen(false)}
          >
            <div
              className="sf-sheet-up sm:sf-modal-pop w-full max-w-sm sm:max-w-md bg-white/98 dark:bg-[#121216]/98 text-[var(--sf-text)] rounded-t-[28px] sm:rounded-3xl p-6 pb-[max(2rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+1.25rem))] shadow-[0_25px_60px_rgba(0,0,0,0.45)] border-t border-x sm:border border-black/[0.08] dark:border-white/10 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1.5 rounded-full bg-black/20 dark:bg-white/30 mx-auto -mt-1 mb-2.5 sm:hidden" />
              <div className="text-center space-y-2 pt-1">
                <div className="h-12 w-12 rounded-2xl bg-amber-500/15 text-amber-500 mx-auto flex items-center justify-center mb-1 ring-1 ring-amber-500/25">
                  <ArrowClockwiseIcon size={24} weight="bold" aria-hidden="true" />
                </div>
                <h3
                  id="new-ui-restart-dialog-title"
                  className="text-base font-extrabold text-[var(--sf-text)]"
                >
                  {designEnabled
                    ? lang === "fa"
                      ? "راه‌اندازی مجدد برای طراحی جدید"
                      : "Restart to Enable New Design"
                    : lang === "fa"
                      ? "بازگشت به طراحی پیش‌فرض"
                      : "Restore Default Design"}
                </h3>
                <p className="text-xs text-[var(--sf-muted)] leading-relaxed px-2">
                  {designEnabled
                    ? lang === "fa"
                      ? "ظاهر جدید شیشه مایع به‌صورت مستقل بارگذاری می‌شود و هیچ تغییری در منطق یا طراحی اصلی ایجاد نمی‌کند. الان برنامه راه‌اندازی مجدد شود؟"
                      : "The new Liquid Glass UI boots independently without altering app logic or the default design. Restart now?"
                    : lang === "fa"
                      ? "با راه‌اندازی مجدد، ظاهر برنامه به حالت استاندارد اولیه برمی‌گردد."
                      : "Restarting will switch the interface back to Soundify's original default layout."}
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    void triggerHapticFeedback("selection");
                    restartAppForDesignChange();
                  }}
                  className="sf-press w-full min-h-[50px] rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 font-bold text-sm cursor-pointer shadow-sm"
                >
                  {lang === "fa" ? "راه‌اندازی مجدد برنامه" : "Restart App Now"}
                </button>
                <button
                  type="button"
                  onClick={() => setRestartPromptOpen(false)}
                  className="sf-press w-full min-h-[48px] rounded-2xl bg-black/[0.05] hover:bg-black/[0.09] dark:bg-white/10 dark:hover:bg-white/15 text-[var(--sf-text)] font-semibold text-sm cursor-pointer border border-black/[0.08] dark:border-white/10"
                >
                  {lang === "fa" ? "بعداً" : "Later"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

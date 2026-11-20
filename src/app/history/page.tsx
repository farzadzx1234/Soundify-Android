"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClockCounterClockwiseIcon,
  CompassIcon,
  MusicNotesSimpleIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { Button, Glass } from "@/components/GlassControls";
import { PullToRefresh } from "@/components/PullToRefresh";
import { VirtualizedTrackTable } from "@/components/VirtualizedTrackTable";
import type { Track } from "@/lib/types";

export default function HistoryPage() {
  const { user, openAuthDialog } = useAuth();
  const { t, lang } = useI18n();
  const { playTrack } = usePlayer();

  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(() => Boolean(user));

  const handleRefresh = async () => {
    if (!user) return;
    try {
      const res = await api.getHistory();
      setHistoryTracks(res.tracks);
    } catch {
      // offline fallback
    }
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    api.getHistory()
      .then((res) => {
        if (!active) return;
        setHistoryTracks(res.tracks);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-black/[0.06] dark:border-white/10 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 text-xs">
              <ClockCounterClockwiseIcon size={16} />
              <span>{lang === "fa" ? "سوابق پخش" : "Listening Activity"}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {t("historyTab")}
            </h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              {lang === "fa"
                ? "آهنگ‌هایی که اخیراً در دستگاه‌های مختلف گوش داده‌اید."
                : "Tracks you have listened to across all your connected devices."}
            </p>
          </div>

          {historyTracks.length > 0 && (
            <Button
              variant="glass"
              onClick={() => playTrack(historyTracks[0], historyTracks)}
              className="self-start sm:self-auto gap-2 rounded-full"
            >
              <PlayIcon size={16} weight="fill" />
              <span>{lang === "fa" ? "پخش همه" : "Play All"}</span>
            </Button>
          )}
        </header>

        {/* Content */}
        {!user ? (
          <Glass className="p-10 text-center rounded-3xl border border-black/[0.06] dark:border-white/10 space-y-4">
            <MusicNotesSimpleIcon size={48} className="mx-auto text-zinc-500" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {lang === "fa" ? "برای مشاهده سوابق وارد شوید" : "Sign in to see history"}
              </h2>
              <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                {lang === "fa"
                  ? "با ورود به حساب کاربری، سوابق پخش شما در تمام دیوایس‌ها به صورت ابری همگام‌سازی می‌شود."
                  : "Your listening history syncs seamlessly across phone, desktop, and tablet when signed in."}
              </p>
            </div>
            <Button variant="filled" onClick={openAuthDialog} className="rounded-full">
              {t("signIn")}
            </Button>
          </Glass>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-2xl bg-black/[0.04] dark:bg-white/5 animate-pulse border border-black/[0.06] dark:border-white/5"
              />
            ))}
          </div>
        ) : historyTracks.length === 0 ? (
          <Glass className="p-10 text-center rounded-3xl border border-black/[0.06] dark:border-white/10 space-y-4">
            <ClockCounterClockwiseIcon size={48} className="mx-auto text-zinc-500" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {lang === "fa" ? "سابقه‌ای وجود ندارد" : "No listening history yet"}
              </h2>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                {lang === "fa"
                  ? "هنوز هیچ آهنگی پخش نکرده‌اید. همین حالا شروع به کشف موسیقی کنید!"
                  : "You haven't played any tracks yet. Explore new tracks now!"}
              </p>
            </div>
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <CompassIcon size={18} />
              <span>{lang === "fa" ? "کاوش موسیقی" : "Explore Music"}</span>
            </Link>
          </Glass>
        ) : (
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/20 backdrop-blur-xl">
            <VirtualizedTrackTable
              tracks={historyTracks}
              onPlayTrack={(tr, all) => playTrack(tr, all)}
            />
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

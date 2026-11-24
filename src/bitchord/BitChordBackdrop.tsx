"use client";

import React, { useEffect, useState } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { isAppInForeground, subscribeToAppState } from "@/lib/androidBridge";
import { buildPaletteFromHex, extractCoverPalette, type CoverPalette } from "@/lib/coverPalette";

export function BitChordBackdrop() {
  const { currentTrack, expanded } = usePlayer();
  const [paused, setPaused] = useState(() => !isAppInForeground());
  const [sampledPalette, setSampledPalette] = useState<{ url: string; palette: CoverPalette } | null>(null);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPaused(document.hidden || !isAppInForeground());
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsub = subscribeToAppState((inFg) => {
      setPaused(!inFg || document.hidden);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsub();
    };
  }, []);

  useEffect(() => {
    const coverUrl = currentTrack?.coverUrl;
    if (!coverUrl) return;
    let active = true;
    extractCoverPalette(coverUrl).then((palette) => {
      if (active && palette) {
        setSampledPalette({ url: coverUrl, palette });
      }
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.coverUrl]);

  const palette =
    currentTrack && sampledPalette?.url === currentTrack.coverUrl
      ? sampledPalette.palette
      : buildPaletteFromHex(currentTrack?.accentColor);

  return (
    <div
      aria-hidden="true"
      data-paused={paused || expanded ? "true" : "false"}
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden contain-strict bg-[#f4f4f6] dark:bg-[#09090b] transition-colors duration-700"
    >
      {/* Dynamic Artwork-Tinted Atmospheric Wash (Dark Mode) */}
      <div
        className="bc-ambient-breathe hidden dark:block absolute -top-[18%] inset-x-[-10%] h-[70vh] opacity-45 transition-opacity duration-700"
        style={{
          backgroundImage: `radial-gradient(ellipse 75% 65% at 25% 20%, ${palette.ambientLeft}, transparent 70%), radial-gradient(ellipse 70% 60% at 78% 18%, ${palette.ambientRight}, transparent 72%)`,
        }}
      />

      {/* Light Mode Subtle Atmospheric Tint */}
      <div
        className="bc-ambient-breathe block dark:hidden absolute -top-[15%] inset-x-[-10%] h-[55vh] opacity-20 transition-opacity duration-700"
        style={{
          backgroundImage: `radial-gradient(ellipse 75% 65% at 25% 20%, ${palette.primaryHex}33, transparent 70%), radial-gradient(ellipse 70% 60% at 78% 18%, ${palette.secondaryHex}28, transparent 72%)`,
        }}
      />

      {/* Clean Obsidian Vignette so text & lists maintain crisp contrast */}
      <div className="hidden dark:block pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[#09090b]/55 to-[#09090b]" />
    </div>
  );
}

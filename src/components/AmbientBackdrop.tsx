"use client";

import React, { useEffect, useState } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { isAppInForeground, subscribeToAppState } from "@/lib/androidBridge";

export function AmbientBackdrop() {
  const { currentTrack, expanded } = usePlayer();
  const accent = currentTrack?.accentColor ?? "#6366f1";
  const [paused, setPaused] = useState(() => !isAppInForeground());

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

  return (
    <div
      aria-hidden="true"
      data-paused={paused || expanded ? "true" : "false"}
      className="sf-ambient-stage pointer-events-none fixed inset-0 -z-10 overflow-hidden contain-strict bg-[#f5f6fa] dark:bg-[#070810] transition-colors duration-700"
    >
      {/* Deep dark Spotify/Apple Music backdrop with subtle, delicate ambient accents (10-15% opacity max) */}
      <div
        className="sf-float-orb absolute -top-[15%] start-[-5%] h-[55vw] w-[55vw] max-h-[640px] max-w-[640px] 2xl:max-h-[1100px] 2xl:max-w-[1100px] rounded-full opacity-20 dark:opacity-12 transition-all duration-1000"
        style={{
          background: `radial-gradient(circle, ${accent}2e 0%, ${accent}0a 45%, transparent 72%)`,
        }}
      />
      <div
        className="sf-float-orb-delay absolute top-[22%] end-[-10%] h-[48vw] w-[48vw] max-h-[560px] max-w-[560px] 2xl:max-h-[960px] 2xl:max-w-[960px] rounded-full opacity-16 dark:opacity-10 transition-opacity duration-1000"
        style={{
          background:
            "radial-gradient(circle, rgba(168,85,247,0.22) 0%, rgba(168,85,247,0.05) 45%, transparent 72%)",
        }}
      />
      <div
        className="sf-float-orb absolute -bottom-[15%] start-[22%] h-[46vw] w-[46vw] max-h-[520px] max-w-[520px] 2xl:max-h-[900px] 2xl:max-w-[900px] rounded-full opacity-15 dark:opacity-08 transition-opacity duration-1000"
        style={{
          background:
            "radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.04) 45%, transparent 72%)",
        }}
      />
      {/* Subtle deep darkening gradient to preserve deep blacks & high-contrast legibility */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#070810]/50 via-transparent to-[#070810]/80 dark:block hidden" />
    </div>
  );
}

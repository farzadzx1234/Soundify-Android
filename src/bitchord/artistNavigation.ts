"use client";

import type { Track } from "@/lib/types";

export const OPEN_ARTIST_PROFILE_EVENT = "soundify-newui-open-artist";

export interface OpenArtistDetail {
  artistName: string;
  seedTrack?: Track | null;
}

export function openNewUiArtistProfile(artistName: string, seedTrack?: Track | null): void {
  if (typeof window === "undefined") return;
  const trimmed = artistName.trim();
  if (!trimmed) return;
  window.dispatchEvent(
    new CustomEvent<OpenArtistDetail>(OPEN_ARTIST_PROFILE_EVENT, {
      detail: { artistName: trimmed, seedTrack: seedTrack ?? null },
    }),
  );
}

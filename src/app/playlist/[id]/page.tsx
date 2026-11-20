import { Suspense } from "react";
import { FALLBACK_PLAYLISTS } from "@/lib/fallbackSeedData";
import PlaylistClient from "./PlaylistClient";

export function generateStaticParams() {
  return [{ id: "default" }, ...FALLBACK_PLAYLISTS.map((p) => ({ id: p.id }))];
}

export default function PlaylistPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl h-80 rounded-3xl sf-content-card animate-pulse" />}>
      <PlaylistClient />
    </Suspense>
  );
}

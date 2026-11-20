import { Suspense } from "react";
import { FALLBACK_TRACKS } from "@/lib/fallbackSeedData";
import TrackClient from "./TrackClient";

export function generateStaticParams() {
  return [{ id: "default" }, ...FALLBACK_TRACKS.map((t) => ({ id: t.id }))];
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl h-96 rounded-3xl sf-content-card animate-pulse" />}>
      <TrackClient />
    </Suspense>
  );
}

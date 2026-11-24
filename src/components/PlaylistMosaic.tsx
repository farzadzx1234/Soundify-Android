"use client";

import React, { useEffect, useState } from "react";
import { extractYouTubeIdClient, resolveMediaUrl } from "@/lib/api";
import { getCachedCoverUrl } from "@/lib/coverCacheManager";
import {
  getTrackDownloadSnapshot,
  resolveDownloadedTrackId,
  resolveLocalDeviceAudioUri,
  useDownloadIndexVersion,
} from "@/lib/downloadManager";
import { getCachedLocalDeviceCoverDataUrl, getLocalDeviceCoverDataUrl } from "@/lib/mediaExport";
import { getCachedCoverBlobUrl, getDownloadedCoverBlobUrl } from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

export type PlaylistMosaicTrack = Pick<Track, "id" | "coverUrl" | "pageUrl" | "accentColor"> & {
  title?: string;
  artistName?: string;
};

interface PlaylistMosaicProps {
  coverUrls?: string[];
  tracks?: PlaylistMosaicTrack[];
  className?: string;
  lazy?: boolean;
}

const RAW_MOSAIC_FALLBACK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240' width='240' height='240'><rect width='100%' height='100%' fill='#0f172a'/><circle cx='120' cy='120' r='56' fill='none' stroke='rgba(99,102,241,0.35)' stroke-width='4'/><circle cx='120' cy='120' r='16' fill='rgba(99,102,241,0.55)'/></svg>`;
const MOSAIC_FALLBACK_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(RAW_MOSAIC_FALLBACK_SVG)}`;

function MosaicTile({
  src,
  trackId = "",
  pageUrl = "",
  title = "",
  artistName = "",
  loadingAttr,
  className = "h-full w-full object-cover",
}: {
  src?: string;
  trackId?: string;
  pageUrl?: string;
  title?: string;
  artistName?: string;
  loadingAttr?: "lazy";
  className?: string;
}) {
  const downloadIndexVersion = useDownloadIndexVersion();
  const isCorruptedDefault = Boolean(trackId && trackId !== "track-01" && src === "/covers/track-01.jpg");
  const cleanRaw =
    src && !src.startsWith("blob:") && !isCorruptedDefault
      ? resolveMediaUrl(src)
      : "";
  const lookupTrack =
    trackId || title || artistName
      ? { id: trackId, title, artistName, pageUrl }
      : null;
  const offlineId = lookupTrack
    ? resolveDownloadedTrackId(lookupTrack) ||
      (trackId && getTrackDownloadSnapshot(trackId).status === "downloaded" ? trackId : "")
    : "";
  const offlineSync = offlineId
    ? getCachedCoverBlobUrl(offlineId) || getCachedLocalDeviceCoverDataUrl(offlineId)
    : null;
  const ytFallbackRaw = (() => {
    const ytId = extractYouTubeIdClient(cleanRaw || pageUrl || trackId);
    return ytId
      ? resolveMediaUrl(
          `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}&id=${encodeURIComponent(trackId)}`,
        )
      : "";
  })();

  const baseSrc = offlineSync || (offlineId ? "" : cleanRaw || ytFallbackRaw || MOSAIC_FALLBACK_SVG);
  const [override, setOverride] = useState<{ forBase: string; src: string } | null>(null);
  const imgSrc = override && override.forBase === baseSrc ? override.src : baseSrc;

  useEffect(() => {
    let active = true;
    const trackMeta =
      trackId || title || artistName
        ? { id: trackId, title, artistName, pageUrl }
        : null;
    if (!offlineSync && (offlineId || !cleanRaw)) {
      void (async () => {
        if (offlineId) {
          const blobUrl = await getDownloadedCoverBlobUrl(offlineId).catch(() => null);
          if (active && blobUrl) {
            setOverride({ forBase: baseSrc, src: blobUrl });
            return;
          }
          const localAudioUri = trackMeta ? resolveLocalDeviceAudioUri(trackMeta) : null;
          const dataUrl = await getLocalDeviceCoverDataUrl({
            trackId: offlineId,
            audioUri: localAudioUri || undefined,
          }).catch(() => null);
          if (active && dataUrl) {
            setOverride({ forBase: baseSrc, src: dataUrl });
            return;
          }
        }
        if (cleanRaw) {
          const cachedUrl = await getCachedCoverUrl(cleanRaw).catch(() => null);
          if (active && cachedUrl) {
            setOverride({ forBase: baseSrc, src: cachedUrl });
            return;
          }
        }
        if (active && offlineId) {
          setOverride({
            forBase: baseSrc,
            src: cleanRaw || ytFallbackRaw || MOSAIC_FALLBACK_SVG,
          });
        }
      })();
    }

    return () => {
      active = false;
    };
  }, [trackId, offlineId, offlineSync, cleanRaw, baseSrc, title, artistName, pageUrl, ytFallbackRaw, downloadIndexVersion]);

  const handleError = () => {
    const ytId = extractYouTubeIdClient(imgSrc || pageUrl || trackId);
    if (
      ytId &&
      !imgSrc.includes("/api/stream/external-cover") &&
      !imgSrc.includes("/api/external/cover")
    ) {
      setOverride({
        forBase: baseSrc,
        src: resolveMediaUrl(
          `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}&id=${encodeURIComponent(trackId)}`,
        ),
      });
      return;
    }
    if (imgSrc !== MOSAIC_FALLBACK_SVG) {
      setOverride({ forBase: baseSrc, src: MOSAIC_FALLBACK_SVG });
    }
  };

  return (
    <img
      src={imgSrc || undefined}
      alt=""
      width={160}
      height={160}
      loading={loadingAttr}
      decoding="async"
      onError={handleError}
      className={className}
    />
  );
}

/**
 * Adaptive 1/2/3/4-tile artwork mosaic for playlists without empty gray grid cells.
 * Resolves offline downloaded cover blobs by trackId when coverUrls are empty/non-persistent.
 */
export function PlaylistMosaic({
  coverUrls = [],
  tracks,
  className = "h-20 w-20 rounded-2xl",
  lazy = false,
}: PlaylistMosaicProps) {
  const loadingAttr = lazy ? "lazy" : undefined;
  const tiles: Array<{ key: string; src?: string; trackId?: string; pageUrl?: string; title?: string; artistName?: string }> = [];

  if (tracks && tracks.length > 0) {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    for (const tr of tracks) {
      if (!tr || typeof tr.id !== "string" || !tr.id || seenIds.has(tr.id)) continue;
      const rawCover = typeof tr.coverUrl === "string" ? tr.coverUrl : "";
      const validUrl =
        rawCover &&
        !rawCover.startsWith("blob:") &&
        !(tr.id !== "track-01" && rawCover === "/covers/track-01.jpg")
          ? rawCover.trim()
          : "";
      const hasOfflineCover =
        Boolean(getCachedCoverBlobUrl(tr.id)) ||
        Boolean(
          resolveDownloadedTrackId({
            id: tr.id,
            title: tr.title || "",
            artistName: tr.artistName || "",
            pageUrl: tr.pageUrl,
          }),
        ) ||
        getTrackDownloadSnapshot(tr.id).status === "downloaded";
      if (validUrl && seenUrls.has(validUrl) && !hasOfflineCover) {
        continue;
      }
      seenIds.add(tr.id);
      if (validUrl) seenUrls.add(validUrl);
      tiles.push({
        key: tr.id,
        src: validUrl,
        trackId: tr.id,
        pageUrl: tr.pageUrl,
        title: tr.title,
        artistName: tr.artistName,
      });
      if (tiles.length >= 4) break;
    }
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < coverUrls.length; i++) {
      const src = coverUrls[i];
      if (typeof src !== "string" || !src.trim() || src.startsWith("blob:") || seen.has(src)) {
        continue;
      }
      seen.add(src);
      tiles.push({ key: `${src}-${i}`, src });
      if (tiles.length >= 4) break;
    }
  }

  if (tiles.length === 0) {
    return (
      <div className={`shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 flex items-center justify-center ${className}`}>
        <img
          src="/icons/icon.svg"
          alt=""
          width={80}
          height={80}
          loading={loadingAttr}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (tiles.length === 1) {
    const t0 = tiles[0];
    return (
      <div className={`shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        <MosaicTile
          key={t0.key}
          src={t0.src}
          trackId={t0.trackId}
          pageUrl={t0.pageUrl}
          title={t0.title}
          artistName={t0.artistName}
          loadingAttr={loadingAttr}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (tiles.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        {tiles.map((tile) => (
          <MosaicTile
            key={tile.key}
            src={tile.src}
            trackId={tile.trackId}
            pageUrl={tile.pageUrl}
            title={tile.title}
            artistName={tile.artistName}
            loadingAttr={loadingAttr}
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  if (tiles.length === 3) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        <MosaicTile
          key={tiles[0].key}
          src={tiles[0].src}
          trackId={tiles[0].trackId}
          pageUrl={tiles[0].pageUrl}
          title={tiles[0].title}
          artistName={tiles[0].artistName}
          loadingAttr={loadingAttr}
          className="row-span-2 h-full w-full object-cover"
        />
        <MosaicTile
          key={tiles[1].key}
          src={tiles[1].src}
          trackId={tiles[1].trackId}
          pageUrl={tiles[1].pageUrl}
          title={tiles[1].title}
          artistName={tiles[1].artistName}
          loadingAttr={loadingAttr}
          className="h-full w-full object-cover"
        />
        <MosaicTile
          key={tiles[2].key}
          src={tiles[2].src}
          trackId={tiles[2].trackId}
          pageUrl={tiles[2].pageUrl}
          title={tiles[2].title}
          artistName={tiles[2].artistName}
          loadingAttr={loadingAttr}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
      {tiles.map((tile) => (
        <MosaicTile
          key={tile.key}
          src={tile.src}
          trackId={tile.trackId}
          pageUrl={tile.pageUrl}
          title={tile.title}
          artistName={tile.artistName}
          loadingAttr={loadingAttr}
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  );
}

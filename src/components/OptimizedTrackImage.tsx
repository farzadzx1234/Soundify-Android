"use client";

import React, { memo, useEffect, useRef, useState } from "react";
import { extractYouTubeIdClient, resolveMediaUrl } from "@/lib/api";
import {
  getTrackDownloadSnapshot,
  resolveDownloadedTrackId,
  resolveLocalDeviceAudioUri,
  resolveLocalDeviceCoverUri,
} from "@/lib/downloadManager";
import { getLocalDeviceCoverDataUrl } from "@/lib/mediaExport";
import { getCachedCoverUrl } from "@/lib/coverCacheManager";
import { getCachedCoverBlobUrl, getDownloadedCoverBlobUrl } from "@/lib/offlineAudioStorage";

interface OptimizedTrackImageProps {
  src?: string;
  alt: string;
  accentColor?: string;
  className?: string;
  priority?: boolean;
  pageUrl?: string;
  trackId?: string;
  trackTitle?: string;
  artistName?: string;
  sizes?: string;
  onError?: () => void;
}

const FALLBACK_PLACEHOLDER = "/icons/icon-192.png";

const RAW_FALLBACK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 500' width='500' height='500'><rect width='100%' height='100%' fill='#0a0a0c'/><circle cx='250' cy='250' r='120' fill='none' stroke='rgba(99,102,241,0.3)' stroke-width='6'/><circle cx='250' cy='250' r='40' fill='rgba(99,102,241,0.5)'/></svg>`;

const FALLBACK_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(RAW_FALLBACK_SVG)}`;

const decodedCoverUrls = new Set<string>();

function rememberDecodedCover(url: string) {
  if (!url) return;
  if (decodedCoverUrls.size > 400) {
    const first = decodedCoverUrls.values().next().value;
    if (first) decodedCoverUrls.delete(first);
  }
  decodedCoverUrls.add(url);
}

export const OptimizedTrackImage = memo(function OptimizedTrackImage({
  src,
  alt,
  accentColor = "#6366f1",
  className = "",
  priority = false,
  pageUrl = "",
  trackId = "",
  trackTitle = "",
  artistName = "",
  onError,
}: OptimizedTrackImageProps) {
  const lookupTrack = trackId || trackTitle || artistName
    ? { id: trackId, title: trackTitle || alt, artistName, pageUrl }
    : null;
  const resolvedOfflineTrackId = lookupTrack
    ? resolveDownloadedTrackId(lookupTrack) ||
      (trackId && getTrackDownloadSnapshot(trackId).status === "downloaded" ? trackId : "")
    : "";
  const resolvedTarget = resolveMediaUrl(src) || FALLBACK_PLACEHOLDER;
  const cachedOfflineSync = resolvedOfflineTrackId ? getCachedCoverBlobUrl(resolvedOfflineTrackId) : null;
  const initialSrc = cachedOfflineSync || resolvedTarget;
  const [currentSrc, setCurrentSrc] = useState<string>(initialSrc);
  const [isLoaded, setIsLoaded] = useState<boolean>(() => Boolean(cachedOfflineSync || decodedCoverUrls.has(initialSrc)));
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const coverBlobRecoveryAttemptedRef = useRef<string>("");

  // Sync immediate decoded state or downloaded cover without querying IDB/CacheStorage unnecessarily
  useEffect(() => {
    let active = true;
    coverBlobRecoveryAttemptedRef.current = "";
    const trackMeta = trackId || trackTitle || artistName
      ? { id: trackId, title: trackTitle || alt, artistName, pageUrl }
      : null;
    const offlineId = trackMeta
      ? resolveDownloadedTrackId(trackMeta) ||
        (trackId && getTrackDownloadSnapshot(trackId).status === "downloaded" ? trackId : "")
      : "";
    const offlineSync = offlineId ? getCachedCoverBlobUrl(offlineId) : null;
    const localSavedCover = trackMeta ? resolveLocalDeviceCoverUri(trackMeta) : null;
    const target = offlineSync || localSavedCover || resolveMediaUrl(src) || FALLBACK_PLACEHOLDER;
    setCurrentSrc(target);
    setHasError(false);

    if (offlineSync || decodedCoverUrls.has(target)) {
      setIsLoaded(true);
    } else if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      rememberDecodedCover(target);
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }

    // Check IndexedDB cover blob or embedded MP3 artwork in Music/Soundify when downloaded locally
    if (offlineId && !offlineSync) {
      void getDownloadedCoverBlobUrl(offlineId).then(async (blobUrl) => {
        if (active && blobUrl) {
          setCurrentSrc(blobUrl);
          setIsLoaded(true);
          return;
        }
        const localAudioUri = trackMeta ? resolveLocalDeviceAudioUri(trackMeta) : null;
        if (localAudioUri || offlineId) {
          const dataUrl = await getLocalDeviceCoverDataUrl({
            trackId: offlineId,
            audioUri: localAudioUri || undefined,
          });
          if (active && dataUrl) {
            setCurrentSrc(dataUrl);
            setIsLoaded(true);
          }
        }
      });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      target &&
      !target.startsWith("data:") &&
      !target.startsWith("blob:") &&
      !target.startsWith("/covers/")
    ) {
      // Only fall back to CacheStorage cover lookup when offline to avoid 50x redundant async locks while scrolling online
      void getCachedCoverUrl(target).then((cachedUrl) => {
        if (active && cachedUrl) {
          setCurrentSrc(cachedUrl);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [src, trackId, pageUrl, alt, trackTitle, artistName]);

  const handleLoad = () => {
    rememberDecodedCover(currentSrc);
    setIsLoaded(true);
    setHasError(false);
  };

  const handleError = () => {
    if (currentSrc.startsWith("blob:") && trackId) {
      const recoveryId = resolveDownloadedTrackId({ id: trackId, title: alt, artistName: "", pageUrl }) || trackId;
      if (coverBlobRecoveryAttemptedRef.current !== recoveryId) {
        coverBlobRecoveryAttemptedRef.current = recoveryId;
        void getDownloadedCoverBlobUrl(recoveryId).then((recoveredUrl) => {
          if (recoveredUrl && recoveredUrl !== currentSrc) {
            setCurrentSrc(recoveredUrl);
          } else {
            const fallbackHttp = resolveMediaUrl(src);
            if (fallbackHttp && !fallbackHttp.startsWith("blob:")) {
              setCurrentSrc(fallbackHttp);
            } else {
              setCurrentSrc(FALLBACK_PLACEHOLDER);
            }
          }
        });
        return;
      }
    }

    const ytId =
      extractYouTubeIdClient(currentSrc) ||
      extractYouTubeIdClient(pageUrl) ||
      extractYouTubeIdClient(trackId);

    if (
      ytId &&
      !currentSrc.includes("/api/stream/external-cover") &&
      !currentSrc.includes("/api/external/cover")
    ) {
      setCurrentSrc(
        resolveMediaUrl(
          `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}&id=${encodeURIComponent(trackId)}`,
        ),
      );
      return;
    }

    // Seamlessly fallback to locally bundled cover art if available for bundled seed tracks
    const isBundledTrack = trackId ? /^track-0[1-9]$|^track-1[0-6]$/.test(trackId) : false;
    if (isBundledTrack && !currentSrc.startsWith("/covers/")) {
      const ext = trackId === "track-09" || trackId === "track-15" ? "webp" : "jpg";
      setCurrentSrc(`/covers/${trackId}.${ext}`);
      return;
    }

    if (currentSrc !== FALLBACK_PLACEHOLDER && currentSrc !== FALLBACK_SVG) {
      setCurrentSrc(FALLBACK_PLACEHOLDER);
      return;
    }

    if (currentSrc === FALLBACK_PLACEHOLDER) {
      setCurrentSrc(FALLBACK_SVG);
      return;
    }

    setHasError(true);
    onError?.();
  };

  return (
    <div className="relative aspect-square w-full h-full overflow-hidden bg-slate-800/40 select-none">
      {/* Blur/Color Skeleton Placeholder with Shimmer */}
      {!isLoaded && !hasError && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 animate-pulse"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${accentColor}44 0%, rgba(15, 23, 42, 0.6) 100%)`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent sf-skeleton-shimmer" />
        </div>
      )}

      {/* Fallback Glass Music Disc Container on Error */}
      {hasError && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-br from-indigo-950/70 via-slate-900/80 to-purple-950/60 text-white/50 border border-white/10"
        >
          <svg className="w-1/2 h-1/2 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )}

      {/* Actual Responsive Lazy-Loaded Image */}
      <img
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        width={320}
        height={320}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onLoad={handleLoad}
        onError={handleError}
        className={`relative z-[1] h-full w-full object-cover transition-opacity duration-300 ${
          isLoaded && !hasError ? "opacity-100" : "opacity-0"
        } ${className}`}
      />
    </div>
  );
});

"use client";

import React, { memo, useEffect, useRef, useState } from "react";
import { extractYouTubeIdClient, resolveMediaUrl } from "@/lib/api";
import {
  getTrackDownloadSnapshot,
  resolveDownloadedTrackId,
  resolveLocalDeviceAudioUri,
  useDownloadIndexVersion,
} from "@/lib/downloadManager";
import {
  getCachedLocalDeviceCoverDataUrl,
  getLocalDeviceCoverDataUrl,
  saveLocalDeviceCover,
} from "@/lib/mediaExport";
import { cacheCoverImage, getCachedCoverUrl, prefetchCover } from "@/lib/coverCacheManager";
import {
  getCachedCoverBlobUrl,
  getDownloadedCoverBlobUrl,
  updateDownloadedCover,
} from "@/lib/offlineAudioStorage";

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
  const downloadIndexVersion = useDownloadIndexVersion();
  const lookupTrack = trackId || trackTitle || artistName
    ? { id: trackId, title: trackTitle || alt, artistName, pageUrl }
    : null;
  const resolvedOfflineTrackId = lookupTrack
    ? resolveDownloadedTrackId(lookupTrack) ||
      (trackId && getTrackDownloadSnapshot(trackId).status === "downloaded" ? trackId : "")
    : "";
  const resolvedTarget = resolveMediaUrl(src) || FALLBACK_PLACEHOLDER;
  const cachedOfflineSync = resolvedOfflineTrackId
    ? getCachedCoverBlobUrl(resolvedOfflineTrackId) ||
      getCachedLocalDeviceCoverDataUrl(resolvedOfflineTrackId) ||
      (trackId && trackId !== resolvedOfflineTrackId ? getCachedLocalDeviceCoverDataUrl(trackId) : null)
    : null;
  const initialSrc = cachedOfflineSync || (resolvedOfflineTrackId ? "" : resolvedTarget);
  const [currentSrc, setCurrentSrc] = useState<string>(initialSrc);
  const [isLoaded, setIsLoaded] = useState<boolean>(() => Boolean(cachedOfflineSync || (!resolvedOfflineTrackId && decodedCoverUrls.has(resolvedTarget))));
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const coverBlobRecoveryAttemptedRef = useRef<string>("");

  // Resolve downloaded offline covers (IDB blob / native file / CacheStorage) strictly before network fallback
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
    const offlineSync = offlineId
      ? getCachedCoverBlobUrl(offlineId) ||
        getCachedLocalDeviceCoverDataUrl(offlineId) ||
        (trackId && trackId !== offlineId ? getCachedLocalDeviceCoverDataUrl(trackId) : null)
      : null;
    const httpTarget = resolveMediaUrl(src) || FALLBACK_PLACEHOLDER;

    if (offlineSync) {
      setCurrentSrc(offlineSync);
      setHasError(false);
      setIsLoaded(true);
      return () => {
        active = false;
      };
    }

    if (offlineId) {
      setHasError(false);
      setIsLoaded(false);
      setCurrentSrc("");

      void (async () => {
        const blobUrl =
          (await getDownloadedCoverBlobUrl(offlineId).catch(() => null)) ||
          (trackId && trackId !== offlineId ? await getDownloadedCoverBlobUrl(trackId).catch(() => null) : null);
        if (!active) return;
        if (blobUrl) {
          setCurrentSrc(blobUrl);
          setIsLoaded(true);
          return;
        }

        const localAudioUri = trackMeta ? resolveLocalDeviceAudioUri(trackMeta) : null;
        const dataUrl = await getLocalDeviceCoverDataUrl({
          trackId: offlineId,
          audioUri: localAudioUri || undefined,
        }).catch(() => null);
        if (!active) return;
        if (dataUrl) {
          setCurrentSrc(dataUrl);
          setIsLoaded(true);
          return;
        }

        if (httpTarget && !httpTarget.startsWith("data:") && !httpTarget.startsWith("blob:")) {
          const cachedUrl = await getCachedCoverUrl(httpTarget).catch(() => null);
          if (!active) return;
          if (cachedUrl) {
            setCurrentSrc(cachedUrl);
            setIsLoaded(true);
            return;
          }
        }

        setCurrentSrc(httpTarget);
        if (decodedCoverUrls.has(httpTarget)) {
          setIsLoaded(true);
        }

        // Backfill missing offline cover permanently when online so subsequent cold launches stay 100% offline
        if (
          httpTarget &&
          httpTarget !== FALLBACK_PLACEHOLDER &&
          !httpTarget.startsWith("data:") &&
          !httpTarget.startsWith("blob:") &&
          (typeof navigator === "undefined" || navigator.onLine !== false)
        ) {
          try {
            const res = await fetch(httpTarget, { cache: "force-cache" });
            if (res.ok) {
              const blob = await res.blob();
              if (blob instanceof Blob && blob.size > 0 && (!blob.type || blob.type.startsWith("image/"))) {
                const savedObjUrl = await updateDownloadedCover(offlineId, blob).catch(() => null);
                void saveLocalDeviceCover(offlineId, blob).catch(() => null);
                void cacheCoverImage(httpTarget, blob).catch(() => null);
                if (active && savedObjUrl) {
                  setCurrentSrc(savedObjUrl);
                  setIsLoaded(true);
                }
              }
            }
          } catch {}
        }
      })();

      return () => {
        active = false;
      };
    }

    setCurrentSrc(httpTarget);
    setHasError(false);

    if (decodedCoverUrls.has(httpTarget)) {
      setIsLoaded(true);
    } else if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      rememberDecodedCover(httpTarget);
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }

    if (
      httpTarget &&
      !httpTarget.startsWith("data:") &&
      !httpTarget.startsWith("blob:") &&
      !httpTarget.startsWith("/covers/") &&
      !httpTarget.startsWith("/icons/")
    ) {
      void getCachedCoverUrl(httpTarget).then((cachedUrl) => {
        if (active && cachedUrl) {
          setCurrentSrc(cachedUrl);
          setIsLoaded(true);
          setHasError(false);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [src, trackId, pageUrl, alt, trackTitle, artistName, downloadIndexVersion]);

  const handleLoad = () => {
    rememberDecodedCover(currentSrc);
    setIsLoaded(true);
    setHasError(false);
    if (
      currentSrc &&
      !currentSrc.startsWith("data:") &&
      !currentSrc.startsWith("blob:") &&
      !currentSrc.startsWith("/covers/") &&
      !currentSrc.startsWith("/icons/")
    ) {
      void prefetchCover(currentSrc).catch(() => false);
    }
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
        src={currentSrc || undefined}
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

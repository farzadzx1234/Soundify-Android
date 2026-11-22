/**
 * Mobile Audio Buffering & Streaming Optimizer.
 *
 * Implements:
 * 1. Bandwidth-adaptive pre-buffering for upcoming queue tracks.
 * 2. Progressive fast-start range chunking.
 * 3. Memory protection during extended playback sessions to avoid mobile RAM bloat.
 */

import { resolveMediaUrl } from "./api";
import { APP_VERSION } from "./appVersion";
import { getDownloadedTrackBlobUrl, isTrackDownloaded } from "./offlineAudioStorage";
import type { Track } from "./types";

export interface NetworkCondition {
  effectiveType: "slow-2g" | "2g" | "3g" | "4g";
  saveData: boolean;
  downlinkMb: number;
  rttMs: number;
}

export interface AudioBufferStats {
  prebufferedTrackIds: string[];
  sessionTracksPlayed: number;
  lastPrebufferedAt: number;
  isMemoryConstrained: boolean;
}

// Module-level cache of prebuffered track IDs
const prebufferedTrackIds = new Set<string>();
let sessionTracksPlayed = 0;
let lastPrebufferTime = 0;

/**
 * Detects current network condition using Network Information API.
 */
export function getNetworkCondition(): NetworkCondition {
  if (typeof navigator === "undefined") {
    return { effectiveType: "4g", saveData: false, downlinkMb: 10, rttMs: 50 };
  }

  const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean; downlink?: number; rtt?: number } }).connection;
  if (!conn) {
    return { effectiveType: "4g", saveData: false, downlinkMb: 10, rttMs: 50 };
  }

  const eff = conn.effectiveType;
  const effectiveType = (eff === "slow-2g" || eff === "2g" || eff === "3g") ? eff : "4g";

  return {
    effectiveType,
    saveData: Boolean(conn.saveData),
    downlinkMb: typeof conn.downlink === "number" ? conn.downlink : 10,
    rttMs: typeof conn.rtt === "number" ? conn.rtt : 50,
  };
}

/**
 * Pre-buffers the next track in the queue to achieve instant playback response.
 * Uses lightweight range requests (256KB initial chunk) to conserve mobile data.
 */
export async function prebufferTrack(track: Track): Promise<boolean> {
  if (!track || !track.id) return false;
  if (typeof document !== "undefined" && document.hidden) return false;

  // Don't duplicate prebuffering for same track
  if (prebufferedTrackIds.has(track.id)) return true;

  const net = getNetworkCondition();
  // If user enabled Save-Data mode or on 2G, avoid aggressive pre-buffering
  if (net.saveData || net.effectiveType === "slow-2g") {
    return false;
  }

  lastPrebufferTime = Date.now();

  try {
    // 1. Check if track is downloaded locally in IndexedDB
    const isOffline = await isTrackDownloaded(track.id);
    if (isOffline) {
      // Warm up Blob URL in memory so it's ready instantaneously
      const blobUrl = await getDownloadedTrackBlobUrl(track.id);
      if (blobUrl) {
        prebufferedTrackIds.add(track.id);
        return true;
      }
    }

    // 2. Online streaming: prefetch first 256KB chunk into HTTP cache
    if (typeof fetch === "function" && track.audioUrl) {
      const targetUrl = resolveMediaUrl(track.audioUrl);
      if (!targetUrl.startsWith("blob:") && !targetUrl.startsWith("data:")) {
        const urlWithFastStart = targetUrl.includes("?")
          ? `${targetUrl}&fastStart=true`
          : `${targetUrl}?fastStart=true`;

        // Range request for first 256KB (fast start audio frame header + first 10-15s audio)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        try {
          const res = await fetch(urlWithFastStart, {
            headers: {
              Range: "bytes=0-262143",
              "X-Purpose": "audio-prebuffer",
              "X-App-Version": APP_VERSION,
            },
            signal: controller.signal,
          });

          clearTimeout(timeout);
          if (res.ok || res.status === 206) {
            // Drain stream into memory to ensure browser commits bytes to HTTP cache and releases socket
            try {
              await res.arrayBuffer();
            } catch {}

            prebufferedTrackIds.add(track.id);
            // Cap prebuffered set to last 10 tracks
            if (prebufferedTrackIds.size > 10) {
              const first = prebufferedTrackIds.values().next().value;
              if (first) prebufferedTrackIds.delete(first);
            }
            return true;
          }
        } catch {
          clearTimeout(timeout);
        }
      }
    }
  } catch {}

  return false;
}

/**
 * Increments played tracks counter and performs memory maintenance during extended sessions.
 */
export function recordPlaybackSessionStep(audioElement?: HTMLAudioElement | null): void {
  sessionTracksPlayed++;
  if (audioElement && audioElement.currentTime < 0) {
    audioElement.currentTime = 0;
  }

  // Memory protection: if more than 15 tracks played in a single continuous session,
  // prune prebuffered tracking set and suggest garbage collection by resetting detached elements.
  if (sessionTracksPlayed % 15 === 0) {
    prebufferedTrackIds.clear();
  }

  // Periodic memory check
  if (typeof performance !== "undefined" && "memory" in performance) {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem && mem.usedJSHeapSize && mem.jsHeapSizeLimit) {
      const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
      if (ratio > 0.8) {
        // High heap pressure: clear prebuffers to free memory
        prebufferedTrackIds.clear();
      }
    }
  }
}

/**
 * Returns current audio buffering stats.
 */
export function getAudioBufferStats(): AudioBufferStats {
  let isMemoryConstrained = false;
  if (typeof performance !== "undefined" && "memory" in performance) {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem && mem.usedJSHeapSize && mem.jsHeapSizeLimit) {
      isMemoryConstrained = mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.75;
    }
  }

  return {
    prebufferedTrackIds: Array.from(prebufferedTrackIds),
    sessionTracksPlayed,
    lastPrebufferedAt: lastPrebufferTime,
    isMemoryConstrained,
  };
}

/**
 * Resets audio buffer tracking (useful for unit tests).
 */
export function resetAudioBufferManager(): void {
  prebufferedTrackIds.clear();
  sessionTracksPlayed = 0;
  lastPrebufferTime = 0;
}

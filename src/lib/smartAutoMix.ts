"use client";

import { useSyncExternalStore } from "react";
import type { Track } from "./types";

export const AUTOMIX_STORAGE_KEY = "soundify_automix_enabled";
const AUTOMIX_CHANGE_EVENT = "soundify-automix-changed";

export interface AutoMixPlan {
  mixOutSec: number;
  mixInSec: number;
  crossfadeSec: number;
  outgoingTailEnergy: number;
  incomingHeadEnergy: number;
}

export interface DecodedAudioAutoMixAnalysis {
  durationSec: number;
  mixInSec: number;
  mixOutSec: number;
  effectiveEndSec: number;
  crossfadeSec: number;
  bodyRms: number;
}

const decodedPcmAutoMixCache = new Map<string, DecodedAudioAutoMixAnalysis>();
const MAX_PCM_ANALYSIS_CACHE = 48;

/**
 * Pure real-PCM acoustic AutoMix analyzer (zero AI):
 * Computes 50ms RMS energy envelopes over decoded PCM samples to find:
 * - True `mixInSec`: skips leading dead silence/slow ambient lead-in and cues onto first musical note/body.
 * - True `effectiveEndSec`: trims trailing dead air at EOF.
 * - True `mixOutSec` & `crossfadeSec`: finds sustained outro energy drop into the tail.
 */
export function analyzePcmAutoMixPoints(
  channelData: Float32Array,
  sampleRate: number,
): DecodedAudioAutoMixAnalysis {
  const safeRate = Number.isFinite(sampleRate) && sampleRate > 1000 ? sampleRate : 44100;
  const totalSamples = channelData?.length || 0;
  const durationSec = totalSamples / safeRate;
  if (!totalSamples || !Number.isFinite(durationSec) || durationSec < 12) {
    return {
      durationSec: Math.max(0, Number.isFinite(durationSec) ? durationSec : 0),
      mixInSec: 0,
      mixOutSec: Math.max(0, (Number.isFinite(durationSec) ? durationSec : 0) - 4),
      effectiveEndSec: Math.max(0, Number.isFinite(durationSec) ? durationSec : 0),
      crossfadeSec: 4.0,
      bodyRms: 0.1,
    };
  }

  const winSamples = Math.max(256, Math.round(safeRate * 0.05)); // 50ms windows
  const stepStride = 4; // downsample 4x for sub-10ms CPU cost on mobile
  const winCount = Math.max(1, Math.floor(totalSamples / winSamples));
  const winSec = winSamples / safeRate;
  const rms = new Float32Array(winCount);

  for (let w = 0; w < winCount; w++) {
    const start = w * winSamples;
    const end = Math.min(totalSamples, start + winSamples);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i += stepStride) {
      const s = channelData[i];
      if (Number.isFinite(s)) {
        sumSq += s * s;
        count++;
      }
    }
    rms[w] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  // Median body loudness from 15%..85% of the track (ignoring silence)
  const bodyStart = Math.floor(winCount * 0.15);
  const bodyEnd = Math.max(bodyStart + 1, Math.ceil(winCount * 0.85));
  const nonSilentBody: number[] = [];
  for (let w = bodyStart; w < bodyEnd; w++) {
    if (rms[w] >= 0.015) nonSilentBody.push(rms[w]);
  }
  const bodyRms = Math.max(0.04, median(nonSilentBody, 0.14));

  // 1. Incoming entry point (`mixInSec`): scan first min(22s, 25% of track)
  const scanInWins = Math.min(winCount, Math.max(4, Math.floor(Math.min(22, durationSec * 0.25) / winSec)));
  const audibleThresh = Math.max(0.016, bodyRms * 0.14);
  const bodyThresh = Math.max(0.045, bodyRms * 0.42);
  let firstAudibleSec = -1;
  let firstBodySec = -1;
  let audibleStreak = 0;
  let bodyStreak = 0;

  for (let w = 0; w < scanInWins; w++) {
    if (rms[w] >= audibleThresh) {
      audibleStreak++;
      if (audibleStreak >= 3 && firstAudibleSec < 0) {
        firstAudibleSec = Math.max(0, (w - 2) * winSec);
      }
    } else {
      audibleStreak = 0;
    }
    if (rms[w] >= bodyThresh) {
      bodyStreak++;
      if (bodyStreak >= 4 && firstBodySec < 0) {
        firstBodySec = Math.max(0, (w - 3) * winSec);
        break;
      }
    } else {
      bodyStreak = 0;
    }
  }

  const maxMixIn = Math.min(14, durationSec * 0.18);
  let mixInSec = 0;
  if (firstBodySec > 1.2) {
    const anchor = firstAudibleSec >= 0 ? Math.max(firstAudibleSec, firstBodySec - 2.0) : Math.max(0, firstBodySec - 0.85);
    mixInSec = Math.max(0, Math.min(maxMixIn, Math.min(firstBodySec - 0.5, anchor)));
  } else if (firstAudibleSec > 0.4) {
    mixInSec = Math.max(0, Math.min(maxMixIn, firstAudibleSec - 0.25));
  }

  // 2. Trailing dead-silence trim (`effectiveEndSec`)
  let lastAudibleWin = winCount - 1;
  while (lastAudibleWin > Math.floor(winCount * 0.5) && rms[lastAudibleWin] < 0.012) {
    lastAudibleWin--;
  }
  const effectiveEndSec = Math.min(durationSec, Math.max(durationSec * 0.55, (lastAudibleWin + 1) * winSec + 0.15));

  // 3. Sustained outro drop in the last 24s before `effectiveEndSec`
  const earliestOutSec = Math.max(durationSec * 0.62, effectiveEndSec - 24);
  const latestOutSec = Math.max(earliestOutSec, effectiveEndSec - 4.2);
  const outStartWin = Math.max(0, Math.floor(earliestOutSec / winSec));
  const outEndWin = Math.min(winCount - 1, Math.ceil(latestOutSec / winSec));
  const quietOutThresh = bodyRms * 0.36;
  let quietOutStreak = 0;
  let mixOutSec = Math.max(earliestOutSec, effectiveEndSec - 7.5 - 0.35);

  for (let w = outStartWin; w <= outEndWin; w++) {
    if (rms[w] <= quietOutThresh) {
      quietOutStreak++;
      if (quietOutStreak >= 14) {
        // Sustained 0.7s+ fade-out detected -> mix cleanly at the start of the outro drop
        const dropSec = Math.max(earliestOutSec, (w - 13) * winSec);
        mixOutSec = Math.min(latestOutSec, dropSec);
        break;
      }
    } else {
      quietOutStreak = 0;
    }
  }

  const headTailRoom = Math.max(3.8, effectiveEndSec - mixOutSec - 0.3);
  const crossfadeSec = Math.max(3.8, Math.min(7.5, headTailRoom));

  return {
    durationSec: Number(durationSec.toFixed(2)),
    mixInSec: Number(mixInSec.toFixed(2)),
    mixOutSec: Number(mixOutSec.toFixed(2)),
    effectiveEndSec: Number(effectiveEndSec.toFixed(2)),
    crossfadeSec: Number(crossfadeSec.toFixed(2)),
    bodyRms: Number(bodyRms.toFixed(4)),
  };
}

/**
 * Decodes an offline downloaded audio Blob via Web Audio API and extracts real PCM mix points.
 */
export async function analyzeDownloadedBlobAutoMix(
  trackId: string,
  audioBlob: Blob,
): Promise<DecodedAudioAutoMixAnalysis | null> {
  if (!trackId || !audioBlob) return null;
  const cached = decodedPcmAutoMixCache.get(trackId);
  if (cached) return cached;

  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx || typeof audioBlob.arrayBuffer !== "function") return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const ch0 = audioBuffer.getChannelData(0);
    const result = analyzePcmAutoMixPoints(ch0, audioBuffer.sampleRate);
    if (decodedPcmAutoMixCache.size >= MAX_PCM_ANALYSIS_CACHE) {
      const oldestKey = decodedPcmAutoMixCache.keys().next().value;
      if (oldestKey) decodedPcmAutoMixCache.delete(oldestKey);
    }
    decodedPcmAutoMixCache.set(trackId, result);
    return result;
  } catch {
    return null;
  } finally {
    if (ctx && typeof ctx.close === "function") {
      try {
        await ctx.close();
      } catch {}
    }
  }
}

export function getAutoMixEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTOMIX_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAutoMixEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTOMIX_STORAGE_KEY, String(Boolean(enabled)));
    window.dispatchEvent(new CustomEvent(AUTOMIX_CHANGE_EVENT, { detail: Boolean(enabled) }));
  } catch {
    // Ignore storage quota / private mode errors
  }
}

function subscribeAutoMix(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === AUTOMIX_STORAGE_KEY) onStoreChange();
  };
  const onLocal = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTOMIX_CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTOMIX_CHANGE_EVENT, onLocal);
  };
}

export function useAutoMixEnabled(): boolean {
  return useSyncExternalStore(
    subscribeAutoMix,
    () => getAutoMixEnabled(),
    () => false,
  );
}

/**
 * Equal-power constant-loudness crossfade curve (cos/sin) matching broadcast/DJ mixers
 * so perceived loudness never dips mid-transition.
 */
export function equalPowerGains(progress: number): { outGain: number; inGain: number } {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return {
    outGain: Math.cos(p * Math.PI * 0.5),
    inGain: Math.sin(p * Math.PI * 0.5),
  };
}

/**
 * Apple Music / Club-DJ Bass-Swap loudness curve:
 * - Outgoing holds warm body briefly, then sweeps smoothly downward with exponential tail
 * - Incoming glides smoothly up to full presence by 82% so Song B claims the drop cleanly
 */
export function djCrossfadeGains(progress: number): { outGain: number; inGain: number } {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p <= 0) return { outGain: 1, inGain: 0 };
  if (p >= 1) return { outGain: 0, inGain: 1 };

  const inP = Math.min(1, p / 0.82);
  const easedIn = 0.5 - 0.5 * Math.cos(inP * Math.PI);
  const inGain = Math.sin(easedIn * Math.PI * 0.5);

  const easedOut = 0.5 - 0.5 * Math.cos(p * Math.PI);
  const outGain = Math.pow(Math.max(0, Math.cos(easedOut * Math.PI * 0.5)), 1.35);

  return {
    outGain: Number.isFinite(outGain) ? Math.max(0, Math.min(1, outGain)) : 0,
    inGain: Number.isFinite(inGain) ? Math.max(0, Math.min(1, inGain)) : 1,
  };
}

/**
 * Paired DJ Bass-Swap High-Pass Filter cutoff curves (Hz) matching AutoMixDspProcessor:
 * - Outgoing rises 0 -> 30..680 Hz across p=0.18..0.90 to carve out conflicting bass & kick
 * - Incoming enters bass-shelved at 360 Hz and opens smoothly down to 0 Hz across p=0.28..0.62
 */
export function djCrossfadeFilterHz(progress: number): {
  outHighPassHz: number;
  inHighPassHz: number;
} {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const outT = Math.max(0, Math.min(1, (p - 0.18) / 0.72));
  const outSmooth = outT * outT * (3 - 2 * outT);
  const outHighPassHz = outT <= 0 ? 0 : Math.round((30 + outSmooth * 650) * 10) / 10;

  const inT = Math.max(0, Math.min(1, (p - 0.28) / 0.34));
  const inSmooth = inT * inT * (3 - 2 * inT);
  const inHighPassHz = inT >= 1 ? 0 : Math.round(360 * (1 - inSmooth) * 10) / 10;

  return { outHighPassHz, inHighPassHz };
}

function hasReliableWaveform(track: Track): boolean {
  if (!Array.isArray(track.waveform) || track.waveform.length < 8) return false;
  if (track.id.startsWith("ext-")) return false;
  if (track.source === "youtube" || track.source === "soundcloud" || track.source === "spotify") {
    return false;
  }
  return true;
}

function normalizeWaveform(wf?: number[]): number[] {
  if (!Array.isArray(wf) || wf.length === 0) return [];
  const clean = wf.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0));
  const maxVal = Math.max(...clean, 0);
  if (maxVal <= 0) return [];
  const divisor = maxVal > 1.05 ? maxVal : 1;
  return clean.map((v) => Math.max(0, Math.min(1, v / divisor)));
}

function meanRange(arr: number[], start: number, end: number, fallback: number): number {
  const s = Math.max(0, start);
  const e = Math.min(arr.length, end);
  if (e <= s) return fallback;
  let sum = 0;
  for (let i = s; i < e; i++) {
    sum += arr[i];
  }
  return sum / (e - s);
}

function median(arr: number[], fallback: number): number {
  if (!arr.length) return fallback;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Deterministic waveform-based AutoMix analyzer (zero AI):
 * - Detects dead/quiet leading intro on incoming track and cues onto first musical beat (`mixInSec`).
 * - Detects natural outro / energy drop in outgoing track's tail (`mixOutSec`).
 * - Adapts crossfade length (`4.5s..7.5s`) to energy similarity between tracks.
 */
export function computeAutoMixPlan(
  outgoing: Track,
  incoming: Track,
  actualDurationSec?: number,
): AutoMixPlan {
  const dur = Math.max(
    Number.isFinite(actualDurationSec) ? actualDurationSec! : 0,
    Number.isFinite(outgoing.durationSec) ? outgoing.durationSec : 0,
  );

  if (dur <= 0) {
    return {
      mixOutSec: 180,
      mixInSec: 0,
      crossfadeSec: 5.0,
      outgoingTailEnergy: 0.45,
      incomingHeadEnergy: 0.5,
    };
  }

  if (dur < 24) {
    const shortFade = Number(Math.max(1.5, Math.min(3.5, dur * 0.2)).toFixed(2));
    return {
      mixOutSec: Number(Math.max(1, dur - shortFade).toFixed(2)),
      mixInSec: 0,
      crossfadeSec: shortFade,
      outgoingTailEnergy: 0.5,
      incomingHeadEnergy: 0.5,
    };
  }

  const outReliable = hasReliableWaveform(outgoing);
  const inReliable = hasReliableWaveform(incoming);
  const outBars = outReliable ? normalizeWaveform(outgoing.waveform) : [];
  const inBars = inReliable ? normalizeWaveform(incoming.waveform) : [];
  const inDur = Number.isFinite(incoming.durationSec) && incoming.durationSec > 0 ? incoming.durationSec : 180;

  // 1. Incoming intro dead-silence skip & beat cue (strictly < 0.08 so soft intros are never clipped)
  let mixInSec = 0;
  if (inReliable && inBars.length >= 8 && inDur >= 20) {
    const maxScanBars = Math.min(
      Math.max(2, Math.floor(inBars.length * 0.14)),
      Math.max(2, Math.round((10 / inDur) * inBars.length)),
    );
    let sawSilence = false;
    for (let i = 0; i < maxScanBars; i++) {
      if (inBars[i] < 0.08) {
        sawSilence = true;
      } else if (inBars[i] >= 0.14) {
        if (sawSilence && i > 0) {
          const rawStart = (i / inBars.length) * inDur - 0.5;
          mixInSec = Number(Math.max(0, Math.min(8, inDur * 0.1, rawStart)).toFixed(2));
        }
        break;
      }
    }
  }

  // 2. Compare outgoing tail energy vs incoming entry energy
  const tailStartIdx = outBars.length > 0 ? Math.floor(outBars.length * 0.8) : 0;
  const outgoingTailEnergy =
    outBars.length > 0 ? meanRange(outBars, tailStartIdx, outBars.length, 0.45) : 0.45;

  const headStartIdx = inBars.length > 0 ? Math.floor((mixInSec / inDur) * inBars.length) : 0;
  const headEndIdx =
    inBars.length > 0 ? Math.min(inBars.length, headStartIdx + Math.max(2, Math.floor(inBars.length * 0.15))) : 0;
  const incomingHeadEnergy =
    inBars.length > 0 ? meanRange(inBars, headStartIdx, headEndIdx, 0.5) : 0.5;

  let crossfadeSec = 7.5;
  let mixOutSec = Math.max(dur * 0.65, dur - crossfadeSec - 0.4);

  if (!outReliable) {
    // External tracks use synthetic hash waveforms: always blend for a rich 7.5s outro overlap
    crossfadeSec = Math.max(5.0, Math.min(7.5, dur * 0.14));
    mixOutSec = Math.max(dur * 0.65, dur - crossfadeSec - 0.4);
  } else {
    const energySimilarity = Math.max(0, 1 - Math.abs(outgoingTailEnergy - incomingHeadEnergy));
    crossfadeSec = 6.5 + energySimilarity * 1.0; // 6.5s .. 7.5s

    // 3. Find true sustained outgoing outro drop in the last 14s..5.5s window
    const minOutSec = Math.max(dur * 0.65, dur - 14);
    const maxOutSec = Math.max(minOutSec, dur - Math.min(crossfadeSec, 5.5));
    mixOutSec = Math.max(minOutSec, dur - crossfadeSec - 0.4);

    if (outBars.length >= 12) {
      const bodyStart = Math.floor(outBars.length * 0.15);
      const bodyEnd = Math.ceil(outBars.length * 0.85);
      const trackMedian = median(outBars.slice(bodyStart, bodyEnd), 0.55);
      const dropThreshold = Math.min(0.22, Math.max(0.1, trackMedian * 0.3));

      const startIdx = Math.max(2, Math.floor((minOutSec / dur) * outBars.length));
      const endIdx = Math.min(outBars.length - 1, Math.ceil((maxOutSec / dur) * outBars.length));

      for (let i = startIdx; i <= endIdx; i++) {
        const prev = outBars[Math.max(0, i - 1)];
        const cur = outBars[i];
        const next = outBars[Math.min(outBars.length - 1, i + 1)];
        const movingAvg = (prev + cur + next) / 3;
        const remainingTailEnergy = meanRange(outBars, i, outBars.length, 1);
        if (movingAvg <= dropThreshold && remainingTailEnergy <= 0.25) {
          const candidateSec = (i / outBars.length) * dur;
          mixOutSec = Math.max(minOutSec, Math.min(maxOutSec, candidateSec));
          break;
        }
      }
    }
  }

  // Ensure crossfade completes gracefully before Deck A reaches EOF with 0.4s headroom
  const remainingSec = Math.max(3.5, dur - mixOutSec - 0.4);
  crossfadeSec = Math.max(3.5, Math.min(7.5, Math.min(crossfadeSec, remainingSec)));

  return {
    mixOutSec: Number(mixOutSec.toFixed(2)),
    mixInSec: Number(mixInSec.toFixed(2)),
    crossfadeSec: Number(crossfadeSec.toFixed(2)),
    outgoingTailEnergy: Number(outgoingTailEnergy.toFixed(3)),
    incomingHeadEnergy: Number(incomingHeadEnergy.toFixed(3)),
  };
}

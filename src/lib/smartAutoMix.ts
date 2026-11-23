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
 * Silky Apple Music / Club-DJ asymmetric S-curve blend:
 * - Smoothstep-eased incoming fade reaches full presence by 72% of transition.
 * - Outgoing groove holds briefly through the first 16%, then melts smoothly with an exponential tail.
 */
export function djCrossfadeGains(progress: number): { outGain: number; inGain: number } {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p <= 0) return { outGain: 1, inGain: 0 };
  if (p >= 1) return { outGain: 0, inGain: 1 };

  // Vocal-Safe Apple Music DJ S-curve:
  // - Outgoing holds full warmth initially, then ducks completely out by 82% (`pow(..., 1.45)`)
  // - Incoming enters as a silk whisper (`pow(..., 1.35)`), claiming foreground solo cleanly at 82%+
  const easedIn = 0.5 - 0.5 * Math.cos(p * Math.PI);
  const inGain = Math.pow(Math.max(0, Math.sin(easedIn * Math.PI * 0.5)), 1.35);

  const outP = Math.min(1, p / 0.82);
  const easedOut = 0.5 - 0.5 * Math.cos(outP * Math.PI);
  const outGain = Math.pow(Math.max(0, Math.cos(easedOut * Math.PI * 0.5)), 1.45);

  return {
    outGain: Number.isFinite(outGain) ? Math.max(0, Math.min(1, outGain)) : 0,
    inGain: Number.isFinite(inGain) ? Math.max(0, Math.min(1, inGain)) : 1,
  };
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

  let crossfadeSec = 4.0;
  let mixOutSec = Math.max(dur * 0.65, dur - crossfadeSec - 0.3);

  if (!outReliable) {
    // External tracks use synthetic hash waveforms: always blend crisply in the final outro
    crossfadeSec = Math.max(3.5, Math.min(4.2, dur * 0.09));
    mixOutSec = Math.max(dur * 0.65, dur - crossfadeSec - 0.3);
  } else {
    const energySimilarity = Math.max(0, 1 - Math.abs(outgoingTailEnergy - incomingHeadEnergy));
    crossfadeSec = 3.8 + energySimilarity * 0.8; // 3.8s .. 4.6s

    // 3. Find true sustained outgoing outro drop in the last 10s..3.8s window
    const minOutSec = Math.max(dur * 0.65, dur - 10);
    const maxOutSec = Math.max(minOutSec, dur - Math.min(crossfadeSec, 3.8));
    mixOutSec = Math.max(minOutSec, dur - crossfadeSec - 0.3);

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

  // Ensure crossfade completes gracefully before Deck A reaches EOF with 0.3s headroom
  const remainingSec = Math.max(3.5, dur - mixOutSec - 0.3);
  crossfadeSec = Math.max(3.5, Math.min(4.6, Math.min(crossfadeSec, remainingSec)));

  return {
    mixOutSec: Number(mixOutSec.toFixed(2)),
    mixInSec: Number(mixInSec.toFixed(2)),
    crossfadeSec: Number(crossfadeSec.toFixed(2)),
    outgoingTailEnergy: Number(outgoingTailEnergy.toFixed(3)),
    incomingHeadEnergy: Number(incomingHeadEnergy.toFixed(3)),
  };
}

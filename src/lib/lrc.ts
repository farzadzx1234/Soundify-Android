import type { LyricLine } from "./types";

const TIMESTAMP_REGEX = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META_REGEX = /^\[([a-zA-Z]+):(.*)\]$/;

export function parseLrc(lrcContent: string): LyricLine[] {
  if (!lrcContent || !lrcContent.trim()) return [];
  const lines: LyricLine[] = [];
  let offsetMs = 0;

  for (const raw of lrcContent.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    TIMESTAMP_REGEX.lastIndex = 0;
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = TIMESTAMP_REGEX.exec(trimmed)) !== null) {
      const m = parseInt(match[1], 10);
      const s = parseInt(match[2], 10);
      const frac = match[3] ?? "0";
      let ms = 0;
      if (frac.length === 1) ms = parseInt(frac, 10) * 100;
      else if (frac.length === 2) ms = parseInt(frac, 10) * 10;
      else ms = parseInt(frac.slice(0, 3), 10);
      timestamps.push(m * 60_000 + s * 1000 + ms);
    }

    if (timestamps.length === 0) {
      const meta = META_REGEX.exec(trimmed);
      if (meta && meta[1].toLowerCase() === "offset") {
        const off = parseInt(meta[2].trim(), 10);
        if (!Number.isNaN(off)) offsetMs = off;
      }
      continue;
    }

    const text = trimmed.replace(TIMESTAMP_REGEX, "").trim();
    for (const ts of timestamps) {
      lines.push({ timeMs: Math.max(0, ts + offsetMs), text });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

export function findActiveLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
  if (lines.length === 0) return -1;
  if (currentTimeMs < lines[0].timeMs) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let result = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= currentTimeMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

export function formatLrcTimestamp(timeMs: number): string {
  const clamped = Math.max(0, Math.round(timeMs));
  const mm = String(Math.floor(clamped / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((clamped % 60_000) / 1000)).padStart(2, "0");
  const xx = String(Math.floor((clamped % 1000) / 10)).padStart(2, "0");
  return `[${mm}:${ss}.${xx}]`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

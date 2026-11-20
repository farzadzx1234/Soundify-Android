/**
 * Helpers for downsampling audio waveform peaks into crisp, readable rounded bars
 * matching responsive container widths without moiré aliasing.
 */

export function generateFallbackWave(count: number): number[] {
  const safeCount = Math.max(1, Math.round(count));
  return Array.from({ length: safeCount }, (_, i) => {
    const t = i / Math.max(1, safeCount - 1);
    const wave =
      0.42 +
      0.26 * Math.sin(t * Math.PI * 5.2 + 0.4) +
      0.18 * Math.cos(t * Math.PI * 11.4) +
      0.1 * Math.sin(i * 1.35);
    return Math.max(0.22, Math.min(0.95, wave));
  });
}

export function downsamplePeaks(
  peaks: number[],
  targetBars: number,
  minFloor = 0.22,
): number[] {
  const count = Math.max(1, Math.round(targetBars));
  const floor = Math.max(0.05, Math.min(0.5, minFloor));

  if (!Array.isArray(peaks) || peaks.length === 0) {
    return generateFallbackWave(count);
  }

  const clean = peaks.map((v) =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0,
  );
  const srcLen = clean.length;

  const sampled: number[] = new Array(count);
  if (srcLen >= count) {
    for (let i = 0; i < count; i++) {
      const start = Math.floor((i * srcLen) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * srcLen) / count));
      let sum = 0;
      let peak = 0;
      let n = 0;
      for (let j = start; j < end && j < srcLen; j++) {
        const val = clean[j];
        sum += val;
        if (val > peak) peak = val;
        n++;
      }
      const avg = n > 0 ? sum / n : 0;
      sampled[i] = 0.6 * peak + 0.4 * avg;
    }
  } else if (srcLen === 1) {
    sampled.fill(clean[0]);
  } else {
    for (let i = 0; i < count; i++) {
      const pos = (i * (srcLen - 1)) / Math.max(1, count - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(srcLen - 1, lo + 1);
      const frac = pos - lo;
      sampled[i] = clean[lo] * (1 - frac) + clean[hi] * frac;
    }
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < count; i++) {
    if (sampled[i] < minVal) minVal = sampled[i];
    if (sampled[i] > maxVal) maxVal = sampled[i];
  }

  // Pure silence input stays flat at floor
  if (maxVal <= 0.001) {
    return sampled.map(() => floor);
  }

  // Use robust percentiles (10th..92nd) so a single quiet fade-out bar or lone intro spike
  // cannot squash a brickwalled track (e.g. avg ~0.92) or quiet track into a uniform picket fence.
  const sorted = [...sampled].sort((a, b) => a - b);
  let lowBound = sorted[Math.floor(0.1 * (count - 1))];
  let highBound = sorted[Math.ceil(0.92 * (count - 1))];
  if (highBound - lowBound < 0.025 && maxVal - minVal >= 0.06) {
    lowBound = minVal;
    highBound = maxVal;
  }

  const span = highBound - lowBound;
  return sampled.map((raw) => {
    const normalized =
      span >= 0.025 ? Math.max(0, Math.min(1, (raw - lowBound) / span)) : raw;
    // Expand compressed dynamics into readable phrase contours while preserving relative loudness
    const shaped =
      span >= 0.025
        ? 0.84 * Math.pow(normalized, 1.35) + 0.16 * raw
        : raw;
    return Math.max(floor, Math.min(0.98, floor + (0.98 - floor) * shaped));
  });
}

export function computeWaveformBarCount(cssWidth: number, isDock: boolean): number {
  const safeW = Math.max(120, Number.isFinite(cssWidth) ? cssWidth : 320);
  if (isDock) {
    // Target ~3.5px bar + ~3.8px gap (~7.3px pitch) so bars stay crisp and uncrowded
    return Math.max(24, Math.min(54, Math.floor((safeW + 3.5) / 7.3)));
  }
  return Math.max(32, Math.min(72, Math.floor((safeW + 4) / 8.5)));
}

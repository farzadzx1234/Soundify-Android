"use client";

export interface AutoMixPlan {
  mode: "BEAT_SYNC_PHRASE" | "SILENCE_TRIMMED_FADE";
  trackAId: string;
  trackBId: string;
  startSampleOnTrackA: number;
  startOffsetSampleOnTrackB: number;
  durationSamples: number;
  initialTempoRatioB: number;
  targetTempoRatioA: number;
  tempoLockCompleteProgress: number; // 0.75
  bassSwapProgress: number; // 0.50
  gainCompensationDbB: number;
}

export interface CamelotKey {
  code: string; // e.g. "8A", "11B"
  number: number; // 1..12
  letter: "A" | "B";
  tonicPc: number; // 0..11 (C..B)
  mode: "major" | "minor";
}

export interface SegmentAnalysis {
  role: "outro" | "intro";
  sampleRate: number;
  segmentStartSample: number;
  segmentEndSample: number;
  bpm: number;
  beatPeriodSec: number;
  beatsSec: number[];
  downbeatsSec: number[];
  phraseBoundariesSec: number[];
  vocalPresence: Float32Array;
  vocalHopSec: number;
  tVocalEndSec: number;
  tVocalStartSec: number;
  firstAudibleSec: number;
  effectiveEndSec: number;
  key: CamelotKey;
  lufs: number;
  spectralFrames: Float32Array[];
  frameRms: Float32Array;
  spectralHopSec: number;
}

export interface FrequencyMatchResult {
  cueOutASec: number;
  cueInBSec: number;
  frequencySimilarity: number;
  mixDurationSec: number;
}

const SILENCE_MINUS_50_DBFS_RMS = 0.00316227766; // 10^(-50/20)
const SEGMENT_WINDOW_SEC = 35;
const ONSET_HOP_SEC = 0.01;
const VAD_HOP_SEC = 0.05;

// Krumhansl-Schmuckler major & minor profiles (starting at tonic C = 0)
const KS_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot wheel lookup indexed by pitch class (0=C .. 11=B)
const MAJOR_CAMELOT_NUMBERS = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT_NUMBERS = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

// 8 log-spaced frequencies spanning the human vocal formant band (300 Hz - 3.5 kHz)
const VOCAL_FORMANT_FREQS_HZ = [330, 470, 670, 950, 1340, 1890, 2650, 3380];

// 12 pitch-class frequencies spanning octaves 3..4 for chromagram Goertzel filters
const CHROMA_BASE_HZ = Array.from({ length: 12 }, (_, pc) => 130.81278265 * Math.pow(2, pc / 12));

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Cubic S-Curve: 3x^2 - 2x^3 over x in [0, 1] for imperceptible tempo morphing.
 */
export function cubicSCurve(x: number): number {
  const t = clamp(x, 0, 1);
  return 3 * t * t - 2 * t * t * t;
}

/**
 * Stage 3: Pitch-preserved Cubic S-Curve Tempo Lock calculator.
 * Completes the morph at `tempoLockCompleteProgress` (0.75) so Deck B settles into
 * its native tempo smoothly before its final 25% drop/verse hits.
 */
export function computeTempoLockRatios(
  plan: Pick<AutoMixPlan, "mode" | "initialTempoRatioB" | "targetTempoRatioA" | "tempoLockCompleteProgress">,
  progress: number,
): { rateA: number; rateB: number } {
  if (plan.mode !== "BEAT_SYNC_PHRASE") {
    return { rateA: 1.0, rateB: 1.0 };
  }
  const p = clamp(progress, 0, 1);
  const lockEnd = clamp(plan.tempoLockCompleteProgress || 0.75, 0.2, 0.95);
  const norm = clamp(p / lockEnd, 0, 1);
  const s = cubicSCurve(norm);
  const rateA = 1.0 + (plan.targetTempoRatioA - 1.0) * s;
  const rateB = plan.initialTempoRatioB + (1.0 - plan.initialTempoRatioB) * s;
  return {
    rateA: clamp(rateA, 0.85, 1.18),
    rateB: clamp(rateB, 0.85, 1.18),
  };
}

/**
 * Circular distance on the 12-position Camelot Wheel.
 * 0 = exact match, 1 = compatible adjacent / relative major-minor, >2 = harmonic clash.
 */
export function camelotDistance(a: CamelotKey, b: CamelotKey): number {
  const rawStep = Math.abs(a.number - b.number) % 12;
  const circleStep = Math.min(rawStep, 12 - rawStep);
  if (a.letter === b.letter) {
    return circleStep;
  }
  // Same Camelot number across A/B (relative major/minor) has harmonic distance 1
  if (circleStep === 0) return 1;
  return circleStep + 1;
}

function goertzelPower(
  buf: Float32Array,
  start: number,
  length: number,
  sampleRate: number,
  targetHz: number,
  step = 1,
): number {
  const effectiveRate = sampleRate / step;
  if (targetHz >= effectiveRate * 0.48 || length <= 4) return 0;
  const omega = (2 * Math.PI * targetHz) / effectiveRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  let count = 0;
  const end = start + length;
  for (let i = start; i < end; i += step) {
    const x = buf[i];
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    count++;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.max(0, power) / Math.max(1, count * count);
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? num / denom : 0;
}

function estimateHarmonicKey(buf: Float32Array, sampleRate: number): CamelotKey {
  const chroma = new Array<number>(12).fill(0);
  const frameLen = Math.min(buf.length, Math.round(sampleRate * 0.25));
  if (frameLen < 256) {
    return { code: "8A", number: 8, letter: "A", tonicPc: 9, mode: "minor" };
  }
  // Sample up to 16 evenly distributed windows across the active segment
  const step = Math.max(1, Math.floor(sampleRate / 11025));
  const numFrames = Math.min(16, Math.max(1, Math.floor(buf.length / frameLen)));
  const strideStart = Math.max(frameLen, Math.floor(buf.length / numFrames));

  for (let f = 0; f < numFrames; f++) {
    const offset = f * strideStart;
    if (offset + frameLen > buf.length) break;
    // Skip near-silent frames so lead silence doesn't bias the key
    let sumSq = 0;
    for (let i = offset; i < offset + frameLen; i += 8) {
      sumSq += buf[i] * buf[i];
    }
    if (sumSq <= 1e-5) continue;

    for (let pc = 0; pc < 12; pc++) {
      const f1 = CHROMA_BASE_HZ[pc];
      const f2 = f1 * 2;
      const f3 = f1 * 4;
      chroma[pc] +=
        goertzelPower(buf, offset, frameLen, sampleRate, f1, step) +
        goertzelPower(buf, offset, frameLen, sampleRate, f2, step) * 0.9 +
        goertzelPower(buf, offset, frameLen, sampleRate, f3, step) * 0.6;
    }
  }

  let bestCorr = -Infinity;
  let bestPc = 0;
  let bestMode: "major" | "minor" = "major";

  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = new Array<number>(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(tonic + i) % 12];
    }
    const corrMaj = pearsonCorr(rotated, KS_MAJOR_PROFILE);
    if (corrMaj > bestCorr) {
      bestCorr = corrMaj;
      bestPc = tonic;
      bestMode = "major";
    }
    const corrMin = pearsonCorr(rotated, KS_MINOR_PROFILE);
    if (corrMin > bestCorr) {
      bestCorr = corrMin;
      bestPc = tonic;
      bestMode = "minor";
    }
  }

  const num = bestMode === "major" ? MAJOR_CAMELOT_NUMBERS[bestPc] : MINOR_CAMELOT_NUMBERS[bestPc];
  const letter = bestMode === "major" ? "B" : "A";
  return {
    code: `${num}${letter}`,
    number: num,
    letter,
    tonicPc: bestPc,
    mode: bestMode,
  };
}

function estimateIntegratedLufs(buf: Float32Array, sampleRate: number): number {
  const blockSamples = Math.max(256, Math.round(sampleRate * 0.4)); // 400ms BS.1770 block
  const hopSamples = Math.max(128, Math.round(sampleRate * 0.1));
  // Lightweight K-weighting approximation: 1-pole high-pass (~60Hz) + high-shelf (+4dB >1.6kHz)
  const hpAlpha = Math.exp((-2 * Math.PI * 60) / sampleRate);
  const shelfAlpha = Math.exp((-2 * Math.PI * 1600) / sampleRate);

  const weighted = new Float32Array(buf.length);
  let hpPrevX = 0;
  let hpPrevY = 0;
  let lpPrev = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const hp = hpAlpha * (hpPrevY + x - hpPrevX);
    hpPrevX = x;
    hpPrevY = hp;
    lpPrev = lpPrev + (1 - shelfAlpha) * (hp - lpPrev);
    const highBand = hp - lpPrev;
    weighted[i] = hp + highBand * 0.58; // ~+4 dB shelf
  }

  const blockLoudness: number[] = [];
  for (let start = 0; start + blockSamples <= weighted.length; start += hopSamples) {
    let sumSq = 0;
    let cnt = 0;
    for (let i = start; i < start + blockSamples; i += 2) {
      sumSq += weighted[i] * weighted[i];
      cnt++;
    }
    const meanSq = sumSq / Math.max(1, cnt);
    const l = -0.691 + 10 * Math.log10(Math.max(1e-10, meanSq));
    if (l > -70) {
      blockLoudness.push(l);
    }
  }

  if (blockLoudness.length === 0) return -24;
  const ungatedLin =
    blockLoudness.reduce((acc, l) => acc + Math.pow(10, (l + 0.691) / 10), 0) / blockLoudness.length;
  const relativeGate = -0.691 + 10 * Math.log10(Math.max(1e-10, ungatedLin)) - 10;
  const gated = blockLoudness.filter((l) => l >= relativeGate);
  const finalSet = gated.length > 0 ? gated : blockLoudness;
  const finalLin = finalSet.reduce((acc, l) => acc + Math.pow(10, (l + 0.691) / 10), 0) / finalSet.length;
  return Number(clamp(-0.691 + 10 * Math.log10(Math.max(1e-10, finalLin)), -40, -1).toFixed(2));
}

function computeMultiBandOnsetAndRms(
  buf: Float32Array,
  sampleRate: number,
  hopSec: number,
): {
  onsetEnv: Float32Array;
  bassEnv: Float32Array;
  fullRms: Float32Array;
  vocalBandRms: Float32Array;
} {
  const hopSamples = Math.max(64, Math.round(sampleRate * hopSec));
  const numFrames = Math.max(1, Math.floor(buf.length / hopSamples));

  const onsetEnv = new Float32Array(numFrames);
  const bassEnv = new Float32Array(numFrames);
  const fullRms = new Float32Array(numFrames);
  const vocalBandRms = new Float32Array(numFrames);

  // 1-pole filters for fast O(N) band splitting inside analysis
  const a140 = 1 - Math.exp((-2 * Math.PI * 140) / sampleRate);
  const a600 = 1 - Math.exp((-2 * Math.PI * 600) / sampleRate);
  const a2800 = 1 - Math.exp((-2 * Math.PI * 2800) / sampleRate);
  const a300 = 1 - Math.exp((-2 * Math.PI * 300) / sampleRate);
  const a3500 = 1 - Math.exp((-2 * Math.PI * 3500) / sampleRate);

  let lp140 = 0;
  let lp600 = 0;
  let lp2800 = 0;
  let lp300 = 0;
  let lp3500 = 0;

  let prevLogB0 = 0;
  let prevLogB1 = 0;
  let prevLogB2 = 0;
  let prevLogB3 = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSamples;
    const end = Math.min(buf.length, start + hopSamples);
    let sqFull = 0;
    let sqB0 = 0;
    let sqB1 = 0;
    let sqB2 = 0;
    let sqB3 = 0;
    let sqVoc = 0;

    for (let i = start; i < end; i++) {
      const x = Number.isFinite(buf[i]) ? buf[i] : 0;
      lp140 += a140 * (x - lp140);
      lp600 += a600 * (x - lp600);
      lp2800 += a2800 * (x - lp2800);
      lp300 += a300 * (x - lp300);
      lp3500 += a3500 * (x - lp3500);

      const b0 = lp140;
      const b1 = lp600 - lp140;
      const b2 = lp2800 - lp600;
      const b3 = x - lp2800;
      const voc = lp3500 - lp300;

      sqFull += x * x;
      sqB0 += b0 * b0;
      sqB1 += b1 * b1;
      sqB2 += b2 * b2;
      sqB3 += b3 * b3;
      sqVoc += voc * voc;
    }

    const n = Math.max(1, end - start);
    fullRms[f] = Math.sqrt(sqFull / n);
    vocalBandRms[f] = Math.sqrt(sqVoc / n);
    bassEnv[f] = Math.sqrt(sqB0 / n);

    const logB0 = Math.log1p(100 * Math.sqrt(sqB0 / n));
    const logB1 = Math.log1p(100 * Math.sqrt(sqB1 / n));
    const logB2 = Math.log1p(100 * Math.sqrt(sqB2 / n));
    const logB3 = Math.log1p(100 * Math.sqrt(sqB3 / n));

    if (f > 0) {
      const flux =
        Math.max(0, logB0 - prevLogB0) * 1.3 +
        Math.max(0, logB1 - prevLogB1) +
        Math.max(0, logB2 - prevLogB2) +
        Math.max(0, logB3 - prevLogB3) * 0.85;
      onsetEnv[f] = flux;
    }
    prevLogB0 = logB0;
    prevLogB1 = logB1;
    prevLogB2 = logB2;
    prevLogB3 = logB3;
  }

  return { onsetEnv, bassEnv, fullRms, vocalBandRms };
}

function estimateTempoAndBeats(
  onsetEnv: Float32Array,
  bassEnv: Float32Array,
  hopSec: number,
  segmentStartSec: number,
): { bpm: number; beatPeriodSec: number; beatsSec: number[]; downbeatsSec: number[] } {
  const n = onsetEnv.length;
  // Normalize onset mean removal
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onsetEnv[i];
  mean /= Math.max(1, n);
  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) centered[i] = Math.max(0, onsetEnv[i] - mean * 0.6);

  const minBpm = 70;
  const maxBpm = 170;
  const minLag = Math.max(8, Math.round(60 / maxBpm / hopSec));
  const maxLag = Math.min(Math.floor(n * 0.45), Math.round(60 / minBpm / hopSec));

  let bestBpm = 120;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      ac += centered[i] * centered[i + lag];
    }
    // Check sub-harmonic (2*lag) reinforcement
    let ac2 = 0;
    if (lag * 2 < n - 1) {
      const l2 = n - lag * 2;
      for (let i = 0; i < l2; i++) {
        ac2 += centered[i] * centered[i + lag * 2];
      }
    }
    const candidateBpm = 60 / (lag * hopSec);
    // Gentle Gaussian tempo prior around 118 BPM (prevents extreme octave errors)
    const logRatio = Math.log2(candidateBpm / 118);
    const prior = Math.exp(-0.5 * (logRatio / 0.72) ** 2);
    const score = (ac + ac2 * 0.45) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = candidateBpm;
    }
  }

  // Octave correction check: if half/double beats match strongly inside 85..160
  if (bestBpm < 80 && bestBpm * 2 <= 160) bestBpm *= 2;
  const roundedBpm = Number(clamp(bestBpm, 70, 170).toFixed(2));
  const beatPeriodSec = 60 / roundedBpm;
  const periodFrames = beatPeriodSec / hopSec;

  // Find strongest starting phase within first 2 beats via onset grid comb correlation
  const searchLimit = Math.min(n - 1, Math.round(periodFrames * 1.5));
  let bestStartFrame = 0;
  let bestCombScore = -Infinity;
  for (let phase = 0; phase < Math.min(Math.round(periodFrames), searchLimit); phase++) {
    let comb = 0;
    for (let p = phase; p < n; p += periodFrames) {
      const idx = Math.round(p);
      if (idx >= 0 && idx < n) {
        comb += onsetEnv[idx] + bassEnv[idx] * 0.4;
      }
    }
    if (comb > bestCombScore) {
      bestCombScore = comb;
      bestStartFrame = phase;
    }
  }

  // Snap individual beats locally within +-12% of beat period
  const beatsSec: number[] = [];
  const snapRadius = Math.max(1, Math.round(periodFrames * 0.12));
  let cursor = bestStartFrame;
  while (cursor < n) {
    const lo = Math.max(0, Math.round(cursor) - snapRadius);
    const hi = Math.min(n - 1, Math.round(cursor) + snapRadius);
    let peakIdx = Math.round(cursor);
    let peakVal = -1;
    for (let idx = lo; idx <= hi; idx++) {
      const val = onsetEnv[idx] + bassEnv[idx] * 0.3;
      if (val > peakVal) {
        peakVal = val;
        peakIdx = idx;
      }
    }
    beatsSec.push(segmentStartSec + peakIdx * hopSec);
    // Keep phase locked close to nominal period with gentle spring correction
    cursor = cursor * 0.35 + peakIdx * 0.65 + periodFrames;
  }

  // Classify 4/4 Downbeats across the 4 possible bar phases (0..3)
  let bestBarPhase = 0;
  let bestBarScore = -Infinity;
  for (let barPhase = 0; barPhase < 4; barPhase++) {
    let sum = 0;
    for (let i = barPhase; i < beatsSec.length; i += 4) {
      const f = clamp(Math.round((beatsSec[i] - segmentStartSec) / hopSec), 0, n - 1);
      sum += bassEnv[f] * 1.4 + onsetEnv[f];
    }
    if (sum > bestBarScore) {
      bestBarScore = sum;
      bestBarPhase = barPhase;
    }
  }

  const downbeatsSec: number[] = [];
  for (let i = bestBarPhase; i < beatsSec.length; i += 4) {
    downbeatsSec.push(beatsSec[i]);
  }
  if (downbeatsSec.length === 0 && beatsSec.length > 0) {
    downbeatsSec.push(beatsSec[0]);
  }

  return {
    bpm: roundedBpm,
    beatPeriodSec,
    beatsSec,
    downbeatsSec,
  };
}

function detectPhraseBoundaries(
  downbeatsSec: number[],
  fullRms: Float32Array,
  bassEnv: Float32Array,
  vocalPresence: Float32Array,
  onsetHopSec: number,
  vadHopSec: number,
  segmentStartSec: number,
): number[] {
  if (downbeatsSec.length < 4) {
    return [...downbeatsSec];
  }
  const boundaries: number[] = [];
  const novelty: number[] = new Array(downbeatsSec.length).fill(0);

  for (let b = 1; b < downbeatsSec.length; b++) {
    const prevT = downbeatsSec[b - 1] - segmentStartSec;
    const curT = downbeatsSec[b] - segmentStartSec;
    const nextT = (b + 1 < downbeatsSec.length ? downbeatsSec[b + 1] : downbeatsSec[b] + 2) - segmentStartSec;

    const prevOn = clamp(Math.floor(prevT / onsetHopSec), 0, fullRms.length - 1);
    const curOn = clamp(Math.floor(curT / onsetHopSec), 0, fullRms.length - 1);
    const nextOn = clamp(Math.floor(nextT / onsetHopSec), curOn + 1, fullRms.length);

    let meanRmsPrev = 0;
    let meanBassPrev = 0;
    for (let i = prevOn; i < curOn; i++) {
      meanRmsPrev += fullRms[i];
      meanBassPrev += bassEnv[i];
    }
    const lenPrev = Math.max(1, curOn - prevOn);
    meanRmsPrev /= lenPrev;
    meanBassPrev /= lenPrev;

    let meanRmsCur = 0;
    let meanBassCur = 0;
    for (let i = curOn; i < nextOn; i++) {
      meanRmsCur += fullRms[i];
      meanBassCur += bassEnv[i];
    }
    const lenCur = Math.max(1, nextOn - curOn);
    meanRmsCur /= lenCur;
    meanBassCur /= lenCur;

    const prevVad = clamp(Math.floor(prevT / vadHopSec), 0, vocalPresence.length - 1);
    const curVad = clamp(Math.floor(curT / vadHopSec), 0, vocalPresence.length - 1);
    const vadDiff = Math.abs((vocalPresence[curVad] || 0) - (vocalPresence[prevVad] || 0));

    novelty[b] = Math.abs(meanRmsCur - meanRmsPrev) * 2.5 + Math.abs(meanBassCur - meanBassPrev) * 2.0 + vadDiff * 0.8;
  }

  // Always prefer structural 4-bar / 8-bar downbeats reinforced by local novelty peaks
  for (let b = 0; b < downbeatsSec.length; b++) {
    const isFourBarGrid = b % 4 === 0;
    const isNoveltyPeak =
      b > 0 &&
      b < downbeatsSec.length - 1 &&
      novelty[b] > novelty[b - 1] &&
      novelty[b] >= novelty[b + 1] &&
      novelty[b] > 0.14;
    if (isFourBarGrid || isNoveltyPeak) {
      boundaries.push(downbeatsSec[b]);
    }
  }
  return boundaries.length > 0 ? boundaries : [...downbeatsSec];
}

function computeVadMaskAndSignalBoundaries(
  buf: Float32Array,
  sampleRate: number,
  segmentStartSec: number,
  role: "outro" | "intro",
): {
  vocalPresence: Float32Array;
  tVocalEndSec: number;
  tVocalStartSec: number;
  firstAudibleSec: number;
  effectiveEndSec: number;
} {
  const { onsetEnv, fullRms, vocalBandRms } = computeMultiBandOnsetAndRms(buf, sampleRate, VAD_HOP_SEC);
  const numWins = fullRms.length;
  const winSamples = Math.max(128, Math.round(sampleRate * VAD_HOP_SEC));
  const vocalPresence = new Float32Array(numWins);
  const goertzelStep = Math.max(1, Math.floor(sampleRate / 11025));

  for (let w = 0; w < numWins; w++) {
    const rms = fullRms[w];
    if (rms < 0.01) {
      vocalPresence[w] = 0;
      continue;
    }

    const formantRatio = vocalBandRms[w] / Math.max(1e-6, rms);
    const start = w * winSamples;
    const len = Math.min(winSamples, buf.length - start);

    // Spectral flatness across 8 log-spaced vocal bins (tonal vocal harmonics -> low flatness)
    let logSum = 0;
    let arithSum = 0;
    for (let k = 0; k < VOCAL_FORMANT_FREQS_HZ.length; k++) {
      const p = goertzelPower(buf, start, len, sampleRate, VOCAL_FORMANT_FREQS_HZ[k], goertzelStep) + 1e-12;
      logSum += Math.log(p);
      arithSum += p;
    }
    const geoMean = Math.exp(logSum / VOCAL_FORMANT_FREQS_HZ.length);
    const ariMean = arithSum / VOCAL_FORMANT_FREQS_HZ.length;
    const flatness = clamp(geoMean / Math.max(1e-12, ariMean), 0, 1);
    const tonalityScore = clamp(1 - flatness * 1.45, 0, 1);

    // Harmonic-to-Percussive Ratio proxy (vocal sustains vs transient drum spikes)
    const transient = onsetEnv[w] || 0;
    const hprScore = clamp(rms / (rms + transient * 0.08 + 1e-4), 0, 1);

    // Combined calibrated vocal probability: formant presence must gate out pure sub-bass/hi-hat intros
    const formantScore = clamp((formantRatio - 0.32) / 0.42, 0, 1);
    const rawProb = formantScore * (0.55 + 0.25 * tonalityScore + 0.2 * hprScore);
    vocalPresence[w] = Number(clamp(rawProb, 0, 1).toFixed(3));
  }

  // First non-silent frame above -50 dBFS (RMS >= 0.003162)
  let firstAudibleSec = segmentStartSec;
  for (let w = 0; w < numWins; w++) {
    if (fullRms[w] >= SILENCE_MINUS_50_DBFS_RMS) {
      firstAudibleSec = segmentStartSec + w * VAD_HOP_SEC;
      break;
    }
  }

  // Last non-silent frame above -50 dBFS
  let lastAudibleWin = numWins - 1;
  while (lastAudibleWin > 0 && fullRms[lastAudibleWin] < SILENCE_MINUS_50_DBFS_RMS) {
    lastAudibleWin--;
  }
  const effectiveEndSec = segmentStartSec + (lastAudibleWin + 1) * VAD_HOP_SEC;

  // Sustained vocal streak detection (>= 3 consecutive 50ms windows = 150ms)
  const VAD_THRESH = 0.5;
  let tVocalStartSec = effectiveEndSec;
  let tVocalEndSec = segmentStartSec;

  if (role === "intro") {
    let streak = 0;
    for (let w = 0; w < numWins; w++) {
      if (vocalPresence[w] >= VAD_THRESH) {
        streak++;
        if (streak >= 3) {
          tVocalStartSec = segmentStartSec + (w - 2) * VAD_HOP_SEC;
          break;
        }
      } else {
        streak = 0;
      }
    }
  } else {
    let streak = 0;
    let foundVocal = false;
    for (let w = numWins - 1; w >= 0; w--) {
      if (vocalPresence[w] >= VAD_THRESH) {
        streak++;
        if (streak >= 3) {
          tVocalEndSec = segmentStartSec + (w + 3) * VAD_HOP_SEC;
          foundVocal = true;
          break;
        }
      } else {
        streak = 0;
      }
    }
    if (!foundVocal) {
      tVocalEndSec = Math.max(segmentStartSec, effectiveEndSec - 10);
    }
  }

  return {
    vocalPresence,
    tVocalEndSec,
    tVocalStartSec,
    firstAudibleSec,
    effectiveEndSec,
  };
}

/**
 * Stage 1: Acoustic & Structural Analysis of the 35s outro (Track A) or 35s intro (Track B).
 */
export function analyzeTrackSegment(
  pcm: Float32Array,
  sampleRate: number,
  role: "outro" | "intro",
  totalTrackSamples?: number,
): SegmentAnalysis {
  const safeRate = Number.isFinite(sampleRate) && sampleRate >= 8000 ? sampleRate : 44100;
  const maxWinSamples = Math.round(SEGMENT_WINDOW_SEC * safeRate);
  const fullLen = totalTrackSamples && totalTrackSamples >= pcm.length ? totalTrackSamples : pcm.length;

  let slice = pcm;
  let segmentStartSample = 0;
  if (role === "outro") {
    if (pcm.length > maxWinSamples) {
      slice = pcm.subarray(pcm.length - maxWinSamples);
      segmentStartSample = Math.max(0, fullLen - maxWinSamples);
    } else {
      segmentStartSample = Math.max(0, fullLen - pcm.length);
    }
  } else {
    if (pcm.length > maxWinSamples) {
      slice = pcm.subarray(0, maxWinSamples);
    }
    segmentStartSample = 0;
  }

  const segmentEndSample = segmentStartSample + slice.length;
  const segmentStartSec = segmentStartSample / safeRate;

  const { onsetEnv, bassEnv, fullRms } = computeMultiBandOnsetAndRms(slice, safeRate, ONSET_HOP_SEC);
  const { bpm, beatPeriodSec, beatsSec, downbeatsSec } = estimateTempoAndBeats(
    onsetEnv,
    bassEnv,
    ONSET_HOP_SEC,
    segmentStartSec,
  );
  const vad = computeVadMaskAndSignalBoundaries(slice, safeRate, segmentStartSec, role);
  const phraseBoundariesSec = detectPhraseBoundaries(
    downbeatsSec,
    fullRms,
    bassEnv,
    vad.vocalPresence,
    ONSET_HOP_SEC,
    VAD_HOP_SEC,
    segmentStartSec,
  );
  const key = estimateHarmonicKey(slice, safeRate);
  const lufs = estimateIntegratedLufs(slice, safeRate);

  // Compute 6-band log-frequency spectral fingerprint every 0.5s for cross-track frequency matching
  const spectralHopSec = 0.5;
  const specHopSamples = Math.max(256, Math.round(safeRate * spectralHopSec));
  const specCount = Math.max(1, Math.floor(slice.length / specHopSamples));
  const spectralFrames: Float32Array[] = new Array(specCount);
  const frameRms = new Float32Array(specCount);
  const a90 = 1 - Math.exp((-2 * Math.PI * 90) / safeRate);
  const a220 = 1 - Math.exp((-2 * Math.PI * 220) / safeRate);
  const a600s = 1 - Math.exp((-2 * Math.PI * 600) / safeRate);
  const a1600 = 1 - Math.exp((-2 * Math.PI * 1600) / safeRate);
  const a4000 = 1 - Math.exp((-2 * Math.PI * 4000) / safeRate);
  let s90 = 0, s220 = 0, s600 = 0, s1600 = 0, s4000 = 0;

  for (let w = 0; w < specCount; w++) {
    const start = w * specHopSamples;
    const end = Math.min(slice.length, start + specHopSamples);
    let e0 = 0, e1 = 0, e2 = 0, e3 = 0, e4 = 0, e5 = 0, sq = 0;
    for (let i = start; i < end; i++) {
      const x = slice[i];
      s90 += a90 * (x - s90);
      s220 += a220 * (x - s220);
      s600 += a600s * (x - s600);
      s1600 += a1600 * (x - s1600);
      s4000 += a4000 * (x - s4000);
      const b0 = s90;
      const b1 = s220 - s90;
      const b2 = s600 - s220;
      const b3 = s1600 - s600;
      const b4 = s4000 - s1600;
      const b5 = x - s4000;
      e0 += b0 * b0;
      e1 += b1 * b1;
      e2 += b2 * b2;
      e3 += b3 * b3;
      e4 += b4 * b4;
      e5 += b5 * b5;
      sq += x * x;
    }
    const len = Math.max(1, end - start);
    const vec = new Float32Array([
      Math.sqrt(e0 / len),
      Math.sqrt(e1 / len),
      Math.sqrt(e2 / len),
      Math.sqrt(e3 / len),
      Math.sqrt(e4 / len),
      Math.sqrt(e5 / len),
    ]);
    spectralFrames[w] = vec;
    frameRms[w] = Math.sqrt(sq / len);
  }

  return {
    role,
    sampleRate: safeRate,
    segmentStartSample,
    segmentEndSample,
    bpm,
    beatPeriodSec,
    beatsSec,
    downbeatsSec,
    phraseBoundariesSec,
    vocalPresence: vad.vocalPresence,
    vocalHopSec: VAD_HOP_SEC,
    tVocalEndSec: vad.tVocalEndSec,
    tVocalStartSec: vad.tVocalStartSec,
    firstAudibleSec: vad.firstAudibleSec,
    effectiveEndSec: vad.effectiveEndSec,
    key,
    lufs,
    spectralFrames,
    frameRms,
    spectralHopSec,
  };
}

function windowSpectrumCosineSimilarity(
  segA: SegmentAnalysis,
  startIdxA: number,
  segB: SegmentAnalysis,
  startIdxB: number,
  spanFrames = 3,
): { cosineSim: number; energySim: number } {
  const vecA = new Float32Array(6);
  const vecB = new Float32Array(6);
  let rmsA = 0;
  let rmsB = 0;
  let cntA = 0;
  let cntB = 0;

  for (let k = 0; k < spanFrames; k++) {
    const idxA = clamp(startIdxA + k, 0, segA.spectralFrames.length - 1);
    const idxB = clamp(startIdxB + k, 0, segB.spectralFrames.length - 1);
    const fA = segA.spectralFrames[idxA];
    const fB = segB.spectralFrames[idxB];
    if (fA) {
      for (let b = 0; b < 6; b++) vecA[b] += fA[b];
      rmsA += segA.frameRms[idxA] || 0;
      cntA++;
    }
    if (fB) {
      for (let b = 0; b < 6; b++) vecB[b] += fB[b];
      rmsB += segB.frameRms[idxB] || 0;
      cntB++;
    }
  }
  if (cntA === 0 || cntB === 0) return { cosineSim: 0.5, energySim: 0.5 };

  let dot = 0, normA = 0, normB = 0;
  for (let b = 0; b < 6; b++) {
    const va = vecA[b] / cntA;
    const vb = vecB[b] / cntB;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA * normB);
  const cosineSim = denom > 1e-8 ? clamp(dot / denom, 0, 1) : 0;
  const avgA = rmsA / cntA;
  const avgB = rmsB / cntB;
  const maxR = Math.max(avgA, avgB, 1e-5);
  const energySim = clamp(1 - Math.abs(avgA - avgB) / maxR, 0, 1);
  return { cosineSim, energySim };
}

/**
 * Soundify Mix Core Matcher:
 * Scans Track A's final <=7.0s (chart-drop outro) against Track B's true opening
 * (first 5.5s after audible start, capped at 6.0s — NEVER jumping mid-song) to find the exact second
 * where both tracks share 6-band spectral similarity, matching energy curves, and zero vocal clash.
 */
export function findBestFrequencyMatchPair(
  segA: SegmentAnalysis,
  segB: SegmentAnalysis,
): FrequencyMatchResult {
  const segStartSecA = segA.segmentStartSample / Math.max(8000, segA.sampleRate);
  const minOutA = Math.max(segStartSecA, segA.effectiveEndSec - 7.0);
  const maxOutA = Math.max(minOutA, segA.effectiveEndSec - 2.6);

  const minInB = Math.max(0, segB.firstAudibleSec);
  const maxInB = Math.max(minInB, Math.min(minInB + 5.5, 6.0));

  const hopA = segA.spectralHopSec || 0.5;
  const hopB = segB.spectralHopSec || 0.5;

  const nonSilentRmsA: number[] = [];
  for (let i = 0; i < segA.frameRms.length; i++) {
    const val = segA.frameRms[i] || 0;
    if (val >= SILENCE_MINUS_50_DBFS_RMS) {
      nonSilentRmsA.push(val);
    }
  }
  nonSilentRmsA.sort((a, b) => a - b);
  const bodyRmsA = nonSilentRmsA.length > 0 ? nonSilentRmsA[Math.floor(nonSilentRmsA.length / 2)] : 0.12;

  let bestScore = -Infinity;
  let bestOutA = Math.max(minOutA, segA.effectiveEndSec - 5.2);
  let bestInB = minInB;
  let bestFreqSim = 0.7;

  const beatsA = segA.beatsSec || [];
  const beatsB = segB.beatsSec || [];
  const nearestBeatDist = (beats: number[], t: number) => {
    let minD = 1.0;
    for (let i = 0; i < beats.length; i++) {
      const d = Math.abs(beats[i] - t);
      if (d < minD) minD = d;
    }
    return minD;
  };

  for (let tA = minOutA; tA <= maxOutA + 0.01; tA += 0.5) {
    const idxA = Math.round((tA - segStartSecA) / hopA);
    if (idxA < 0 || idxA >= segA.spectralFrames.length) continue;
    if ((segA.frameRms[idxA] || 0) < SILENCE_MINUS_50_DBFS_RMS) continue;

    const vadIdxA = clamp(Math.round((tA - segStartSecA) / (segA.vocalHopSec || 0.05)), 0, Math.max(0, segA.vocalPresence.length - 1));
    const vocalA = segA.vocalPresence[vadIdxA] || 0;
    const idxAEnd = Math.min(segA.frameRms.length - 1, idxA + 2);
    const rmsAStart = segA.frameRms[idxA] || 0;
    const rmsAEnd = segA.frameRms[idxAEnd] || 0;
    const declA = rmsAEnd <= rmsAStart * 1.02 ? 1.0 : Math.max(0, 1 - (rmsAEnd - rmsAStart) / Math.max(0.02, rmsAStart));
    const dropBonus = clamp((bodyRmsA - rmsAStart) / Math.max(0.02, bodyRmsA), 0, 1);

    for (let tB = minInB; tB <= maxInB + 0.01; tB += 0.5) {
      const idxB = Math.round(tB / hopB);
      if (idxB < 0 || idxB >= segB.spectralFrames.length) continue;
      if ((segB.frameRms[idxB] || 0) < SILENCE_MINUS_50_DBFS_RMS) continue;

      const { cosineSim, energySim } = windowSpectrumCosineSimilarity(segA, idxA, segB, idxB, 3);
      const vadIdxB = clamp(Math.round(tB / (segB.vocalHopSec || 0.05)), 0, Math.max(0, segB.vocalPresence.length - 1));
      const vocalB = segB.vocalPresence[vadIdxB] || 0;

      const idxBEnd = Math.min(segB.frameRms.length - 1, idxB + 2);
      const rmsBStart = segB.frameRms[idxB] || 0;
      const rmsBEnd = segB.frameRms[idxBEnd] || 0;
      const riseB = rmsBEnd >= rmsBStart * 0.90 ? 1.0 : Math.max(0, 1 - (rmsBStart - rmsBEnd) / Math.max(0.02, rmsBStart));
      const slopeAlign = (declA + riseB) * 0.5;

      const beatAlignBonus =
        Math.max(0, 1 - nearestBeatDist(beatsA, tA) * 4) * 0.5 +
        Math.max(0, 1 - nearestBeatDist(beatsB, tB) * 4) * 0.5;
      const vocalCutPenalty = (vocalA > 0.48 ? 0.65 : 0) + (vocalA > 0.48 && vocalB > 0.48 ? 0.35 : 0);
      const introDelayPenalty = ((tB - minInB) / 5.5) * 0.06;

      const totalScore =
        cosineSim * 0.42 +
        energySim * 0.22 +
        slopeAlign * 0.10 +
        dropBonus * 0.14 +
        beatAlignBonus * 0.12 -
        vocalCutPenalty -
        introDelayPenalty;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestOutA = tA;
        bestInB = tB;
        bestFreqSim = cosineSim;
      }
    }
  }

  if (segA.tVocalEndSec > minOutA && segA.tVocalEndSec <= segA.effectiveEndSec - 2.6) {
    bestOutA = Math.max(bestOutA, segA.tVocalEndSec);
  }
  bestOutA = clamp(bestOutA, minOutA, maxOutA);

  const availRoomA = Math.max(2.5, segA.effectiveEndSec - bestOutA - 0.15);
  const mixDurationSec = Number(clamp(availRoomA, 2.6, 6.8).toFixed(2));
  return {
    cueOutASec: Number(bestOutA.toFixed(2)),
    cueInBSec: Number(bestInB.toFixed(2)),
    frequencySimilarity: Number(bestFreqSim.toFixed(3)),
    mixDurationSec,
  };
}

/**
 * Stage 2: Soundify Mix Cue & Transition Solver combining frequency-matched cosine similarity
 * with Beat/Downbeat snapping, <=7.0s tail ceiling, and Vocal-Safe alignment into Stage 5 `AutoMixPlan`.
 */
export function solveAutoMixPlan(
  trackAId: string,
  trackBId: string,
  segA: SegmentAnalysis,
  segB: SegmentAnalysis,
  sampleRate = segA.sampleRate || 44100,
): AutoMixPlan {
  const safeRate = Number.isFinite(sampleRate) && sampleRate >= 8000 ? sampleRate : 44100;
  const bpmA = Math.max(60, segA.bpm || 120);
  const bpmB = Math.max(60, segB.bpm || 120);
  const bpmDiff = Math.abs(bpmA - bpmB) / bpmA;
  const keyDist = camelotDistance(segA.key, segB.key);

  // Integrated LUFS compensation clamped to safe musical [-6dB, +6dB] range
  const gainCompensationDbB = Number(clamp((segA.lufs ?? -14) - (segB.lufs ?? -14), -6, 6).toFixed(2));

  // Primary frequency-matched Soundify Mix cue pair (strictly <=7.0s from end & Track B opening)
  const freqMatch = findBestFrequencyMatchPair(segA, segB);

  // Fallback helper: clean 2.8s-5.2s equal-power fade aligned inside Track A's final 7.0s & Track B's opening
  const buildFallbackPlan = (): AutoMixPlan => {
    const fadeSec = Number(clamp(freqMatch.mixDurationSec, 2.8, 5.2).toFixed(2));
    const minStartA = Math.max(segA.segmentStartSample / safeRate, segA.effectiveEndSec - 7.0);
    const rawStartSecA = clamp(
      Math.min(freqMatch.cueOutASec, segA.effectiveEndSec - fadeSec),
      minStartA,
      Math.max(minStartA, segA.effectiveEndSec - 2.5),
    );
    const startOffsetSecB = Math.max(
      0,
      segB.firstAudibleSec,
      Math.min(freqMatch.cueInBSec, segB.firstAudibleSec + 5.0, 6.0),
    );
    return {
      mode: "SILENCE_TRIMMED_FADE",
      trackAId,
      trackBId,
      startSampleOnTrackA: Math.round(rawStartSecA * safeRate),
      startOffsetSampleOnTrackB: Math.round(startOffsetSecB * safeRate),
      durationSamples: Math.round(fadeSec * safeRate),
      initialTempoRatioB: 1.0,
      targetTempoRatioA: 1.0,
      tempoLockCompleteProgress: 0.75,
      bassSwapProgress: 0.5,
      gainCompensationDbB,
    };
  };

  // Compatibility Gate: BPM diff > 8% OR (BPM diff > 4% AND harmonic clash > 2)
  if (bpmDiff > 0.08 || (bpmDiff > 0.04 && keyDist > 2)) {
    return buildFallbackPlan();
  }

  // Beat-synced 1..3-bar transition anchored around the frequency-matched cue pair within final 7.0s
  const barSecA = (60 / bpmA) * 4;
  const tryBars = [3, 2, 1];

  const candidateBoundariesB = (segB.phraseBoundariesSec.length > 0 ? segB.phraseBoundariesSec : segB.downbeatsSec)
    .filter((b) => b >= Math.max(0, segB.firstAudibleSec - 0.15) && b <= Math.min(segB.firstAudibleSec + 5.5, 6.0));
  if (candidateBoundariesB.length === 0) {
    candidateBoundariesB.push(freqMatch.cueInBSec);
  }

  const candidateBoundariesA = segA.phraseBoundariesSec.length > 0 ? segA.phraseBoundariesSec : segA.downbeatsSec;
  const minCueOutA = Math.max(segA.segmentStartSample / safeRate, segA.effectiveEndSec - 7.0);

  for (const mixBars of tryBars) {
    const mixDurationSec = mixBars * barSecA;
    if (mixDurationSec < 2.6 || mixDurationSec > 6.8) continue;

    // Pick opening boundary on Track B closest to freqMatch.cueInBSec while ensuring cueInB + mixDur <= tVocalStartB
    const vocalSafeB = candidateBoundariesB.filter((b) => b + mixDurationSec <= segB.tVocalStartSec + 0.08);
    if (vocalSafeB.length === 0) {
      continue;
    }
    const cueInB = vocalSafeB.reduce((best, b) =>
      Math.abs(b - freqMatch.cueInBSec) < Math.abs(best - freqMatch.cueInBSec) ? b : best,
    );

    const maxCueOutA = segA.effectiveEndSec - mixDurationSec - 0.15;
    if (maxCueOutA < minCueOutA) {
      continue;
    }

    const vocalSafeBoundariesA = candidateBoundariesA.filter(
      (b) => b >= Math.max(minCueOutA, segA.tVocalEndSec - 0.12) && b <= maxCueOutA + 0.12,
    );
    const poolA = vocalSafeBoundariesA.length > 0
      ? vocalSafeBoundariesA
      : candidateBoundariesA.filter((b) => b >= minCueOutA && b <= maxCueOutA + 0.12);

    const cueOutA = clamp(
      poolA.length > 0
        ? poolA.reduce((best, b) => (Math.abs(b - freqMatch.cueOutASec) < Math.abs(best - freqMatch.cueOutASec) ? b : best))
        : freqMatch.cueOutASec,
      minCueOutA,
      Math.max(minCueOutA, maxCueOutA),
    );

    const tempoRatio = bpmDiff <= 0.06 ? clamp(bpmB / bpmA, 0.94, 1.06) : 1.0;
    return {
      mode: "BEAT_SYNC_PHRASE",
      trackAId,
      trackBId,
      startSampleOnTrackA: Math.round(Math.max(0, cueOutA) * safeRate),
      startOffsetSampleOnTrackB: Math.round(Math.max(0, cueInB) * safeRate),
      durationSamples: Math.round(mixDurationSec * safeRate),
      initialTempoRatioB: Number((1 / tempoRatio).toFixed(5)),
      targetTempoRatioA: Number(tempoRatio.toFixed(5)),
      tempoLockCompleteProgress: 0.75,
      bassSwapProgress: 0.5,
      gainCompensationDbB,
    };
  }

  return buildFallbackPlan();
}

const segmentAnalysisCache = new Map<string, SegmentAnalysis>();
const MAX_SEGMENT_CACHE = 48;

async function decodeBlobMonoSegment(
  blob: Blob,
  role: "outro" | "intro",
): Promise<{ pcm: Float32Array; sampleRate: number; totalSamples: number } | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx || typeof blob.arrayBuffer !== "function") return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const ch0 = audioBuffer.getChannelData(0);
    const totalSamples = audioBuffer.length;
    const sr = audioBuffer.sampleRate;
    const winSamples = Math.min(totalSamples, Math.round(SEGMENT_WINDOW_SEC * sr));
    const pcm =
      role === "outro"
        ? new Float32Array(ch0.subarray(Math.max(0, totalSamples - winSamples)))
        : new Float32Array(ch0.subarray(0, winSamples));
    return { pcm, sampleRate: sr, totalSamples };
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

export async function analyzeDownloadedPairAutoMixPlan(
  trackAId: string,
  blobA: Blob,
  trackBId: string,
  blobB: Blob,
): Promise<AutoMixPlan | null> {
  if (!trackAId || !trackBId || !blobA || !blobB) return null;
  try {
    const keyA = `${trackAId}:outro`;
    let segA = segmentAnalysisCache.get(keyA);
    if (!segA) {
      const decA = await decodeBlobMonoSegment(blobA, "outro");
      if (!decA) return null;
      segA = analyzeTrackSegment(decA.pcm, decA.sampleRate, "outro", decA.totalSamples);
      if (segmentAnalysisCache.size >= MAX_SEGMENT_CACHE) {
        const oldest = segmentAnalysisCache.keys().next().value;
        if (oldest) segmentAnalysisCache.delete(oldest);
      }
      segmentAnalysisCache.set(keyA, segA);
    }

    const keyB = `${trackBId}:intro`;
    let segB = segmentAnalysisCache.get(keyB);
    if (!segB) {
      const decB = await decodeBlobMonoSegment(blobB, "intro");
      if (!decB) return null;
      segB = analyzeTrackSegment(decB.pcm, decB.sampleRate, "intro", decB.totalSamples);
      if (segmentAnalysisCache.size >= MAX_SEGMENT_CACHE) {
        const oldest = segmentAnalysisCache.keys().next().value;
        if (oldest) segmentAnalysisCache.delete(oldest);
      }
      segmentAnalysisCache.set(keyB, segB);
    }

    return solveAutoMixPlan(trackAId, trackBId, segA, segB, segA.sampleRate);
  } catch {
    return null;
  }
}

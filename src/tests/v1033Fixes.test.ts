import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  analyzeTrackSegment,
  camelotDistance,
  computeTempoLockRatios,
  cubicSCurve,
  solveAutoMixPlan,
} from "@/lib/autoMixEngine";
import {
  checkPrototypeTampering,
  setIntegrityStateForTesting,
} from "@/lib/mobileSecurityIntegrity";
import {
  getDownloadedCoverBlobUrl,
  revokeAllBlobUrls,
  saveDownloadedTrack,
  clearAllDownloadedTracks,
} from "@/lib/offlineAudioStorage";
import {
  resetDownloadManagerState,
} from "@/lib/downloadManager";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "ext-youtube-test-1",
    title: "Test Track",
    titleFa: "آهنگ تست",
    artistId: "artist-1",
    artistName: "Test Artist",
    artistNameFa: "خواننده تست",
    artistAvatarColor: "#10b981",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Chill",
    durationSec: 180,
    audioUrl: "/api/stream/external?id=ext-youtube-test-1",
    coverUrl: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
    accentColor: "#10b981",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 10,
    likesCount: 2,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    source: "youtube",
    ...overrides,
  };
}

function synthesizeDanceLoop(
  bpm: number,
  durationSec: number,
  sampleRate: number,
  options: {
    leadingSilenceSec?: number;
    vocalStartSec?: number;
    vocalEndSec?: number;
    chordFreqHz?: number;
    amplitude?: number;
  } = {},
): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const out = new Float32Array(n);
  const beatPeriod = 60 / bpm;
  const amp = options.amplitude ?? 0.55;
  const chordHz = options.chordFreqHz ?? 261.63; // C4
  const leadSil = options.leadingSilenceSec ?? 0;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    if (t < leadSil) continue;

    // Kick / percussive transient every beat
    const phaseInBeat = (t - leadSil) % beatPeriod;
    const kickEnv = phaseInBeat < 0.09 ? Math.exp(-phaseInBeat * 38) : 0;
    const kick = kickEnv * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-phaseInBeat * 40)) * phaseInBeat);

    // Steady harmonic bass / pad note
    const harmonic = 0.25 * Math.sin(2 * Math.PI * chordHz * t) + 0.14 * Math.sin(2 * Math.PI * chordHz * 1.5 * t);

    // Tonal formant vocal tone in 950Hz + 1890Hz window
    let vocal = 0;
    const inVocalWindow =
      (options.vocalStartSec !== undefined && t >= options.vocalStartSec && (options.vocalEndSec === undefined || t <= options.vocalEndSec)) ||
      (options.vocalStartSec === undefined && options.vocalEndSec !== undefined && t <= options.vocalEndSec);
    if (inVocalWindow) {
      vocal = 0.35 * Math.sin(2 * Math.PI * 950 * t) + 0.2 * Math.sin(2 * Math.PI * 1890 * t);
    }

    out[i] = amp * (0.65 * kick + harmonic + vocal);
  }
  return out;
}

describe("Soundify v1.0.33 Offline Covers, Strict Offline Playback & 5-Stage AutoMix Engine", () => {
  afterEach(async () => {
    setIntegrityStateForTesting({
      threatLevel: "SECURE",
      isRooted: false,
      isHooked: false,
      isDebuggerConnected: false,
      isEmulator: false,
      detectedSignals: [],
    });
    revokeAllBlobUrls();
    await clearAllDownloadedTracks();
    resetDownloadManagerState();
  });

  it("synchronizes v1.0.33+ / versionCode >= 34 across all version manifests", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.3[3-9]\d*$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(34);

    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);

    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);

    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);
  });

  it("fixes Capacitor WebView fetch false-positive and serves downloaded cover blobs even if device security state toggles", async () => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const origCap = scope.Capacitor;
    const origFetch = scope.fetch;
    scope.Capacitor = { isNativePlatform: () => true };
    scope.fetch = function capacitorHttpWrappedFetch() {
      return Promise.resolve(new Response());
    };
    try {
      const cleanRes = checkPrototypeTampering();
      expect(cleanRes.signals).not.toContain("FETCH_PROTOTYPE_TAMPERED");

      // Malicious hook still flagged
      scope.fetch = function frida_hook_fetch() {
        return Promise.resolve(new Response());
      };
      const hookRes = checkPrototypeTampering();
      expect(hookRes.signals).toContain("FETCH_PROTOTYPE_TAMPERED");
    } finally {
      scope.fetch = origFetch;
      if (origCap === undefined) delete scope.Capacitor;
      else scope.Capacitor = origCap;
    }

    const track = makeTrack();
    await saveDownloadedTrack(
      track,
      new Blob(["audio"], { type: "audio/mpeg" }),
      undefined,
      new Blob(["fake-jpg-bytes"], { type: "image/jpeg" }),
    );
    setIntegrityStateForTesting({ threatLevel: "COMPROMISED", isRooted: true });
    const coverUrl = await getDownloadedCoverBlobUrl(track.id);
    expect(coverUrl).toBeTruthy();

    const libraryPage = fs.readFileSync(path.resolve(__dirname, "../app/library/page.tsx"), "utf8");
    expect(libraryPage).toContain("<OptimizedTrackImage");

    const downloadMgr = fs.readFileSync(path.resolve(__dirname, "../lib/downloadManager.ts"), "utf8");
    expect(downloadMgr).toContain("registerDownloadedTrackIndex(rec.track)");

    const playerCtx = fs.readFileSync(path.resolve(__dirname, "../context/PlayerContext.tsx"), "utf8");
    expect(playerCtx).toContain("getDownloadedTrackBlobUrl(offlineId)");
  });

  it("analyzes Stage 1 beats/VAD/LUFS/key and solves Stage 2 BEAT_SYNC_PHRASE + vocal-safe alignment + Stage 3 S-curve tempo lock", () => {
    const sr = 22050;
    const outPcm = synthesizeDanceLoop(120, 35, sr, {
      vocalEndSec: 18,
      chordFreqHz: 110.0, // A2 bass pad (<300Hz), keeping instrumental tail out of vocal formant band
      amplitude: 0.6,
    });
    const inPcm = synthesizeDanceLoop(122, 35, sr, {
      leadingSilenceSec: 1.5,
      vocalStartSec: 22,
      chordFreqHz: 110.0,
      amplitude: 0.45,
    });

    const segA = analyzeTrackSegment(outPcm, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(inPcm, sr, "intro", 35 * sr);

    expect(segA.bpm).toBeGreaterThanOrEqual(116);
    expect(segA.bpm).toBeLessThanOrEqual(124);
    expect(segB.bpm).toBeGreaterThanOrEqual(118);
    expect(segB.bpm).toBeLessThanOrEqual(126);
    expect(segB.firstAudibleSec).toBeGreaterThanOrEqual(1.3);
    expect(segB.firstAudibleSec).toBeLessThanOrEqual(1.9);
    expect(segB.tVocalStartSec).toBeGreaterThanOrEqual(21.0);

    const plan = solveAutoMixPlan("track-a", "track-b", segA, segB, sr);
    expect(plan.mode).toBe("BEAT_SYNC_PHRASE");
    expect(plan.tempoLockCompleteProgress).toBe(0.75);
    expect(plan.bassSwapProgress).toBe(0.5);
    // Crucial: Track A fades out before Track B lead vocals start
    const endOfMixInB = (plan.startOffsetSampleOnTrackB + plan.durationSamples) / sr;
    expect(endOfMixInB).toBeLessThanOrEqual(segB.tVocalStartSec + 0.15);
    // Gain compensation boosts quieter Track B upward toward Track A LUFS
    expect(plan.gainCompensationDbB).toBeGreaterThan(0);

    // Stage 3 Cubic S-curve settles cleanly by progress = 0.75
    expect(cubicSCurve(0)).toBe(0);
    expect(cubicSCurve(0.5)).toBe(0.5);
    expect(cubicSCurve(1)).toBe(1);
    const r0 = computeTempoLockRatios(plan, 0);
    const r75 = computeTempoLockRatios(plan, 0.75);
    const r95 = computeTempoLockRatios(plan, 0.95);
    expect(r0.rateA).toBeCloseTo(1.0, 4);
    expect(r0.rateB).toBeCloseTo(plan.initialTempoRatioB, 4);
    expect(r75.rateB).toBeCloseTo(1.0, 4);
    expect(r95.rateB).toBeCloseTo(1.0, 4);
  });

  it("triggers Stage 2 Compatibility Gate SILENCE_TRIMMED_FADE for large BPM gap (>8%)", () => {
    const sr = 22050;
    const outPcm = synthesizeDanceLoop(90, 35, sr, { vocalEndSec: 16 });
    const inPcm = synthesizeDanceLoop(128, 35, sr, { leadingSilenceSec: 2.0, vocalStartSec: 18 });

    const segA = analyzeTrackSegment(outPcm, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(inPcm, sr, "intro", 35 * sr);
    const plan = solveAutoMixPlan("slow-a", "fast-b", segA, segB, sr);

    expect(plan.mode).toBe("SILENCE_TRIMMED_FADE");
    expect(plan.durationSamples).toBe(Math.round(3.5 * sr));
    expect(plan.initialTempoRatioB).toBe(1.0);
    expect(plan.targetTempoRatioA).toBe(1.0);
    expect(camelotDistance(segA.key, segA.key)).toBe(0);
  });

  it("wires LR4 3-band crossover, -0.5dBFS limiter, native PCM analyzer, and Stage 5 bridge in Java & TS", () => {
    const dsp = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixDspProcessor.java"),
      "utf8",
    );
    expect(dsp).toContain("LOW_CROSSOVER_HZ = 140.0");
    expect(dsp).toContain("HIGH_CROSSOVER_HZ = 2800.0");
    expect(dsp).toContain("LIMITER_CEILING = 0.94406087629");
    expect(dsp).toContain("startSampleAccurateAutoMix");

    const analyzer = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixPcmAnalyzer.java"),
      "utf8",
    );
    expect(analyzer).toContain("MediaExtractor");
    expect(analyzer).toContain("MediaCodec");
    expect(analyzer).toContain("BEAT_SYNC_PHRASE");

    const plugin = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
      "utf8",
    );
    expect(plugin).toContain("scheduleAutoMixPlan");

    const bridge = fs.readFileSync(path.resolve(__dirname, "../lib/nativeAudioBridge.ts"), "utf8");
    expect(bridge).toContain("nativeAudioScheduleAutoMixPlan");
  });
});

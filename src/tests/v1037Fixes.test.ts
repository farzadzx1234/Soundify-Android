import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { analyzeTrackSegment, findBestFrequencyMatchPair, solveAutoMixPlan } from "@/lib/autoMixEngine";

describe("Soundify v1.0.37 Missed Fade-Out Detection Fix", () => {
  it("synchronizes v1.0.37+ / versionCode >= 38 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(?:3[7-9]|[4-9]\d)$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(38);

    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);

    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);

    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });

  it("trims long whisper fade-out tails perceptually and triggers mix on the audible fade slope instead of dead tail", () => {
    const sr = 22050;
    const pcmA = new Float32Array(sr * 35);
    const pcmB = new Float32Array(sr * 35);

    // Track A: 0..20s full body (amp 0.50), 20..32s smooth linear fade 0.50 -> 0.01, 32..35s ultra-quiet -46dB whisper tail (0.005)
    for (let i = 0; i < pcmA.length; i++) {
      const t = i / sr;
      let amp = 0.5;
      if (t >= 20 && t < 32) {
        amp = 0.5 - ((t - 20) / 12) * 0.49;
      } else if (t >= 32) {
        amp = 0.005;
      }
      pcmA[i] = amp * (0.7 * Math.sin(2 * Math.PI * 160 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t));
    }
    for (let i = Math.round(0.8 * sr); i < pcmB.length; i++) {
      const t = i / sr;
      pcmB[i] = 0.35 * (0.7 * Math.sin(2 * Math.PI * 160 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t));
    }

    const segA = analyzeTrackSegment(pcmA, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(pcmB, sr, "intro", 35 * sr);

    // Must trim whisper-quiet fade-out tail well before raw 35s EOF
    expect(segA.effectiveEndSec).toBeLessThan(33.5);
    expect(segA.effectiveEndSec).toBeGreaterThan(28.0);

    const pair = findBestFrequencyMatchPair(segA, segB);
    expect(pair.cueOutASec).toBeLessThan(segA.effectiveEndSec - 2.4);
    expect(segA.effectiveEndSec - pair.cueOutASec).toBeLessThanOrEqual(12.05);

    const plan = solveAutoMixPlan("fade-a", "fade-b", segA, segB, sr);
    const cueOutSec = plan.startSampleOnTrackA / sr;
    expect(cueOutSec).toBeLessThan(segA.effectiveEndSec - 2.0);
  });

  it("still enforces strict <=7.0s ceiling on active songs without long fade-outs", () => {
    const sr = 22050;
    const pcmA = new Float32Array(sr * 35);
    const pcmB = new Float32Array(sr * 35);

    for (let i = 0; i < sr * 34.5; i++) {
      const t = i / sr;
      pcmA[i] = t < 30.5
        ? 0.55 * Math.sin(2 * Math.PI * 950 * t)
        : 0.45 * Math.sin(2 * Math.PI * 160 * t);
    }
    for (let i = Math.round(0.5 * sr); i < pcmB.length; i++) {
      const t = i / sr;
      pcmB[i] = 0.4 * Math.sin(2 * Math.PI * 160 * t);
    }

    const segA = analyzeTrackSegment(pcmA, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(pcmB, sr, "intro", 35 * sr);
    const pair = findBestFrequencyMatchPair(segA, segB);
    expect(segA.effectiveEndSec - pair.cueOutASec).toBeLessThanOrEqual(7.05);

    const plan = solveAutoMixPlan("loud-a", "loud-b", segA, segB, sr);
    expect(segA.effectiveEndSec - plan.startSampleOnTrackA / sr).toBeLessThanOrEqual(7.05);
  });

  it("locks AutoMixDspProcessor bodyRms against fade decay and decouples live fade detection in SoundifyMediaService", () => {
    const dsp = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixDspProcessor.java"),
      "utf8",
    );
    expect(dsp).toContain("blockRms >= bodyRms * 0.55f");
    expect(dsp).toContain("0.9992f");
    expect(dsp).toContain("blockVocal >= bodyVocalRms * 0.55f");

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("private int fadeOutSlopeTicks = 0;");
    expect(service).toContain("private float prevFadeLiveRms = 1.0f;");
    expect(service).toContain("boolean hasValidPlanForPair");
    expect(service).toContain("abortNextDeckIntroScanOnMainThread();");
    expect(service).toContain("remSec <= 15.0");
    expect(service).toContain("remSec <= 18.0");
  });
});

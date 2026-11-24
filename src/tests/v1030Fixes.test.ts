import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { computeAutoMixPlan, djCrossfadeFilterHz } from "@/lib/smartAutoMix";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "local-1",
    title: "Test Track",
    titleFa: "آهنگ تست",
    artistId: "artist-1",
    artistName: "Artist",
    artistNameFa: "هنرمند",
    artistAvatarColor: "#10b981",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Chill",
    durationSec: 200,
    audioUrl: "/api/tracks/local-1/stream",
    coverUrl: "/api/tracks/local-1/cover",
    accentColor: "#10b981",
    waveform: Array.from({ length: 64 }, () => 0.72),
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 10,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    ...overrides,
  };
}

describe("Soundify v1.0.30 Apple Music 7.5s DJ Bass-Swap DSP, Live RMS Outro & Seek-Safe Prebuffer", () => {
  it("synchronizes v1.0.30+ / versionCode >= 31 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.3\d$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(31);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toMatch(/^1\.0\.3\d$/);

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toMatch(/soundify-v1\.0\.3\d-b3\d/);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toMatch(/versionCode\s+3\d/);
    expect(gradle).toMatch(/versionName\s+"1\.0\.3\d"/);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toMatch(/APP_USER_AGENT = "Soundify-Android\/1\.0\.3\d"/);
    expect(service).toMatch(/APP_VERSION_HEADER = "1\.0\.3\d"/);
  });

  it("sweeps outgoing high-pass filter 0 -> 680Hz and incoming high-pass filter 360 -> 0Hz cleanly without bass clash", () => {
    expect(djCrossfadeFilterHz(0)).toEqual({ outHighPassHz: 0, inHighPassHz: 360 });
    const mid = djCrossfadeFilterHz(0.45);
    expect(mid.outHighPassHz).toBeGreaterThan(100);
    expect(mid.inHighPassHz).toBeGreaterThan(100);
    expect(djCrossfadeFilterHz(0.65).inHighPassHz).toBe(0);
    expect(djCrossfadeFilterHz(0.9).outHighPassHz).toBeGreaterThanOrEqual(650);
  });

  it("plans rich 7.5s overlap windows on standard external & local tracks", () => {
    const extOut = makeTrack({ id: "ext-youtube-1", source: "youtube", durationSec: 200 });
    const extIn = makeTrack({ id: "ext-youtube-2", source: "youtube", durationSec: 200 });
    const extPlan = computeAutoMixPlan(extOut, extIn, 200);
    expect(extPlan.crossfadeSec).toBe(7.5);
    expect(extPlan.mixOutSec).toBeCloseTo(192.1, 1);

    const localOut = makeTrack({ id: "local-1", durationSec: 200 });
    const localIn = makeTrack({ id: "local-2", durationSec: 200 });
    const localPlan = computeAutoMixPlan(localOut, localIn, 200);
    expect(localPlan.crossfadeSec).toBe(7.5);
  });

  it("wires AutoMixDspProcessor with BaseAudioProcessor Butterworth biquad and live RMS outro detection in SoundifyMediaService", () => {
    const dsp = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixDspProcessor.java"),
      "utf8",
    );
    expect(dsp).toContain("extends BaseAudioProcessor");
    expect(dsp).toContain("public void setHighPassHz(float hz)");
    expect(dsp).toContain("public float getLiveRms()");
    expect(dsp).toContain("public float getBodyRms()");

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("buildDspExoPlayer(");
    expect(service).toContain("nativeDeckDsp");
    expect(service).toContain("nextDeckDsp");
    expect(service).toContain("quietOutroTicks");

    const seekBlock = service.match(/public void nativeSeek\([\s\S]*?public void nativeSetVolume/)?.[0] ?? "";
    expect(seekBlock).toContain("if (isCrossfading || pendingCrossfade)");
  });

  it("preserves pre-buffered next track when user seeks manually in PlayerContext and pre-buffers 45s ahead", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("plan.mixOutSec - 45");
    expect(playerCtx).toContain("if (autoMixStartedRef.current) {\n        cancelAutoMixRef.current();\n      }");
  });
});

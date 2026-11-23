import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { computeAutoMixPlan, djCrossfadeGains } from "@/lib/smartAutoMix";
import type { Track } from "@/lib/types";

function makeLocalTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "local-1",
    title: "Local Track",
    titleFa: "آهنگ محلی",
    artistId: "artist-1",
    artistName: "Artist",
    artistNameFa: "هنرمند",
    artistAvatarColor: "#10b981",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Chill",
    durationSec: 180,
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

describe("Soundify v1.0.28 Recycled Deck Fix, Perceptual Apple Music AutoMix & Single-Slot Badge", () => {
  it("synchronizes v1.0.28 / versionCode 29 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toBe("1.0.28");
    expect(APP_BUILD_NUMBER).toBe(29);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toBe("1.0.28");

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toContain("soundify-v1.0.28-b29");

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toContain("versionCode 29");
    expect(gradle).toContain('versionName "1.0.28"');

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain('APP_USER_AGENT = "Soundify-Android/1.0.28"');
    expect(service).toContain('APP_VERSION_HEADER = "1.0.28"');
  });

  it("clears playWhenReady on recycled nextDeckPlayer in prepare, completion, and cancel and guards nextDeckStartMs", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("private long nextDeckStartMs = 0L;");

    const prepBlock = service.match(/public void prepareNextNativeStream\([\s\S]*?public void startNativeCrossfade/)?.[0] ?? "";
    expect(prepBlock).toContain("nextDeckPlayer.setPlayWhenReady(false);");
    expect(prepBlock).toContain("nextDeckPlayer.pause();");
    expect(prepBlock).toContain("nextDeckPlayer.seekTo(nextDeckStartMs);");

    const startBlock = service.match(/public void startNativeCrossfade\([\s\S]*?public void cancelNativeCrossfade/)?.[0] ?? "";
    expect(startBlock).toContain("nextDeckStartMs");

    const tickerBlock = service.match(/private final Runnable crossfadeTicker = new Runnable\(\) \{[\s\S]*?private final IBinder binder/)?.[0] ?? "";
    expect(tickerBlock).toContain("nextDeckPlayer.setPlayWhenReady(false);");
    expect(tickerBlock).toContain("Math.pow(Math.sin(eased * Math.PI * 0.5), 1.25)");

    const cancelBlock = service.match(/private void cancelCrossfadeOnMainThread\(\) \{[\s\S]*?private DefaultExtractorsFactory/)?.[0] ?? "";
    expect(cancelBlock).toContain("nextDeckPlayer.setPlayWhenReady(false);");
  });

  it("preserves soft audible intros and ignores mid-song dips before loud endings", () => {
    // Audible soft intro (0.12..0.18) must NOT be skipped (only dead silence < 0.08 is skipped)
    const softIntroWave = Array.from({ length: 64 }, (_, i) => (i < 4 ? 0.14 : 0.78));
    // Mid-song dip around bar 60 followed by loud closing tail at bars 62..63
    const falseDipWave = Array.from({ length: 64 }, (_, i) => (i === 60 ? 0.12 : 0.8));

    const out = makeLocalTrack({ durationSec: 200, waveform: falseDipWave });
    const inc = makeLocalTrack({ id: "local-2", durationSec: 200, waveform: softIntroWave });

    const plan = computeAutoMixPlan(out, inc, 200);
    expect(plan.mixInSec).toBe(0);
    expect(plan.crossfadeSec).toBeGreaterThanOrEqual(4.0);
    expect(plan.crossfadeSec).toBeLessThanOrEqual(5.2);
    expect(plan.mixOutSec).toBeCloseTo(200 - plan.crossfadeSec - 0.35, 1);

    // Perceptual curve starts as a whisper and blends cleanly
    const whisper = djCrossfadeGains(0.1);
    expect(whisper.inGain).toBeLessThan(0.03);
    const mid = djCrossfadeGains(0.5);
    expect(mid.outGain).toBeLessThan(0.68);
    expect(mid.inGain).toBeLessThan(0.68);
  });

  it("recomputes AutoMix plan in PlayerContext when real decoded duration diverges from metadata", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("autoMixPlanDurRef");
    expect(playerCtx).toContain("Math.abs(durSec - autoMixPlanDurRef.current) > 1.5");
  });

  it("swaps Genre pill and AutoMix pill in a single slot so mobile badge never clips into two words", () => {
    const overlay = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toContain("{isCrossfading ? (");
    expect(overlay).toContain('<span>{pickText("AutoMix", "میکس روان")}</span>');
    expect(overlay).toContain("shrink-0 whitespace-nowrap");
  });
});

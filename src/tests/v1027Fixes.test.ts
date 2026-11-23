import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { computeAutoMixPlan, djCrossfadeGains } from "@/lib/smartAutoMix";
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
    durationSec: 180,
    audioUrl: "/api/tracks/local-1/stream",
    coverUrl: "/api/tracks/local-1/cover",
    accentColor: "#10b981",
    waveform: Array.from({ length: 64 }, () => 0.7),
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

describe("Soundify v1.0.27 Apple Music AutoMix Smoothness & Badge Cleanup", () => {
  it("synchronizes v1.0.27+ / versionCode >= 28 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(2[7-9]|3\d)/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(28);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toMatch(/^1\.0\.(2[7-9]|3\d)/);

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toMatch(/soundify-v1\.0\.(2[7-9]|3\d)-b(2[8-9]|3\d)/);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toMatch(/versionCode (2[8-9]|3\d)/);
    expect(gradle).toMatch(/versionName "1\.0\.(2[7-9]|3\d)"/);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toMatch(/APP_USER_AGENT = "Soundify-Android\/1\.0\.(2[7-9]|3\d)"/);
    expect(service).toMatch(/APP_VERSION_HEADER = "1\.0\.(2[7-9]|3\d)"/);
  });

  it("ignores synthetic hash waveforms on external tracks so mixInSec is 0 and mixOutSec is in the final outro", () => {
    const fakeNoisyWave = Array.from({ length: 64 }, (_, i) => (i < 3 ? 0.05 : i > 45 ? 0.1 : 0.85));
    const outgoing = makeTrack({
      id: "ext-youtube-abc",
      source: "youtube",
      durationSec: 200,
      waveform: fakeNoisyWave,
    });
    const incoming = makeTrack({
      id: "ext-soundcloud-xyz",
      source: "soundcloud",
      durationSec: 190,
      waveform: fakeNoisyWave,
    });

    const plan = computeAutoMixPlan(outgoing, incoming, 200);
    expect(plan.mixInSec).toBe(0);
    expect(plan.mixOutSec).toBeGreaterThanOrEqual(200 - 8.5);
    expect(plan.mixOutSec).toBeLessThan(200 - 4.5);
    expect(plan.crossfadeSec).toBeGreaterThanOrEqual(5.0);
    expect(plan.crossfadeSec).toBeLessThanOrEqual(7.5);
  });

  it("maintains silky perceptual S-curve progression across 0..1", () => {
    let prevIn = 0;
    let prevOut = 1;
    for (let i = 1; i <= 20; i++) {
      const p = i / 20;
      const { outGain, inGain } = djCrossfadeGains(p);
      expect(inGain).toBeGreaterThanOrEqual(prevIn);
      expect(outGain).toBeLessThanOrEqual(prevOut);
      prevIn = inGain;
      prevOut = outGain;
    }
    const early = djCrossfadeGains(0.1);
    expect(early.inGain).toBeLessThan(0.08);
    expect(early.outGain).toBeGreaterThan(0.99);
  });

  it("defers AudioFocus transfer until crossfade completion and gates readiness on buffering in SoundifyMediaService", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("crossfadeIncomingReady");
    expect(service).toContain("crossfadeInvokedMs");

    const startBlock = service.match(/public void startNativeCrossfade\([\s\S]*?public void cancelNativeCrossfade/);
    expect(startBlock?.[0] ?? "").not.toContain("outgoingDeck.setAudioAttributes(");
    expect(startBlock?.[0] ?? "").not.toContain("nativePlayer.setAudioAttributes(");

    const tickerBlock = service.match(/private final Runnable crossfadeTicker = new Runnable\(\) \{[\s\S]*?private final IBinder binder/);
    expect(tickerBlock?.[0] ?? "").toContain("nativePlayer.setAudioAttributes(buildMediaAudioAttributes(), true);");
  });

  it("renders compact AutoMix badge without previous-track title concatenation and keeps mobile metadata overflow-hidden", () => {
    const overlay = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toContain('pickText("AutoMix", "میکس روان")');
    expect(overlay).not.toContain("pickText(crossfadeFromTrack.title, crossfadeFromTrack.titleFa)");
    expect(overlay).toContain("min-w-0 flex-1 overflow-hidden text-start");
  });
});

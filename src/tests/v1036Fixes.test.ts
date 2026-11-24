import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { analyzeTrackSegment, findBestFrequencyMatchPair, solveAutoMixPlan } from "@/lib/autoMixEngine";
import { analyzePcmAutoMixPoints, computeAutoMixPlan } from "@/lib/smartAutoMix";
import {
  getPersistedOfflineLyrics,
  savePersistedOfflineLyrics,
} from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "ext-youtube-v1036-1",
    title: "Test Track",
    titleFa: "آهنگ تست",
    artistId: "artist-1",
    artistName: "Test Artist",
    artistNameFa: "خواننده تست",
    artistAvatarColor: "#10b981",
    album: "Single",
    albumFa: "تک‌آهنگ",
    genre: "Pop",
    mood: "Chill",
    durationSec: 200,
    audioUrl: "/api/stream/external?id=ext-youtube-v1036-1",
    coverUrl: "https://example.com/cover.jpg",
    accentColor: "#10b981",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 10,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    source: "youtube",
    ...overrides,
  };
}

describe("Soundify v1.0.36 <=7s Soundify Mix Ceiling & Permanent Offline Covers/Lyrics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("soundify_offline_lyrics_v1");
    }
  });

  it("synchronizes v1.0.36+ / versionCode >= 37 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.3[6-9]\d*$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(37);

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

  it("enforces hard <=7.0s ceiling before EOF across findBestFrequencyMatchPair, solveAutoMixPlan, computeAutoMixPlan, and analyzePcmAutoMixPoints", () => {
    const sr = 22050;
    const pcmA = new Float32Array(sr * 35);
    const pcmB = new Float32Array(sr * 35);

    // Track A drops energy early at 18s (17s remaining) and sings until 31s (4s remaining)
    for (let i = 0; i < pcmA.length; i++) {
      const t = i / sr;
      if (t < 18) {
        pcmA[i] = 0.6 * Math.sin(2 * Math.PI * 180 * t) + 0.35 * Math.sin(2 * Math.PI * 950 * t);
      } else if (t < 31) {
        pcmA[i] = 0.45 * Math.sin(2 * Math.PI * 950 * t);
      } else {
        pcmA[i] = 0.2 * Math.sin(2 * Math.PI * 160 * t);
      }
    }
    for (let i = Math.round(1.0 * sr); i < pcmB.length; i++) {
      const t = i / sr;
      pcmB[i] = t < 6.0
        ? 0.2 * Math.sin(2 * Math.PI * 160 * t)
        : 0.45 * Math.sin(2 * Math.PI * 950 * t);
    }

    const segA = analyzeTrackSegment(pcmA, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(pcmB, sr, "intro", 35 * sr);

    const pair = findBestFrequencyMatchPair(segA, segB);
    expect(segA.effectiveEndSec - pair.cueOutASec).toBeLessThanOrEqual(7.05);
    expect(pair.mixDurationSec).toBeLessThanOrEqual(6.8);
    expect(pair.cueInBSec).toBeLessThanOrEqual(6.0);

    const stagePlan = solveAutoMixPlan("a", "b", segA, segB, sr);
    const outRemSec = segA.effectiveEndSec - stagePlan.startSampleOnTrackA / sr;
    expect(outRemSec).toBeLessThanOrEqual(7.05);
    expect(stagePlan.durationSamples / sr).toBeLessThanOrEqual(6.85);

    // Waveform with an early dip at ~184s on a 200s track must still wait until >=193s
    const earlyDipWave = Array.from({ length: 64 }, (_, i) => (i >= 58 ? 0.12 : 0.78));
    const wfPlan = computeAutoMixPlan(
      makeTrack({ id: "local-1", source: "local", waveform: earlyDipWave, durationSec: 200 }),
      makeTrack({ id: "local-2", source: "local", durationSec: 200 }),
      200,
    );
    expect(200 - wfPlan.mixOutSec).toBeLessThanOrEqual(7.05);
    expect(wfPlan.crossfadeSec).toBeLessThanOrEqual(6.85);

    // PCM analyzer with quiet tail starting at 26s of 40s must clamp mixOutSec within <=7.0s of 40s
    const srPcm = 8000;
    const earlyOutroPcm = new Float32Array(srPcm * 40);
    for (let i = 0; i < 26 * srPcm; i++) {
      earlyOutroPcm[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / srPcm);
    }
    for (let i = 26 * srPcm; i < 40 * srPcm; i++) {
      earlyOutroPcm[i] = 0.04 * Math.sin((2 * Math.PI * 220 * i) / srPcm);
    }
    const pcmRes = analyzePcmAutoMixPoints(earlyOutroPcm, srPcm);
    expect(pcmRes.effectiveEndSec - pcmRes.mixOutSec).toBeLessThanOrEqual(7.05);
    expect(pcmRes.crossfadeSec).toBeLessThanOrEqual(6.85);
  });

  it("enforces 7.0s cap and vocalSafeNow in AutoMixPcmAnalyzer.java and SoundifyMediaService.java", () => {
    const analyzer = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixPcmAnalyzer.java"),
      "utf8",
    );
    expect(analyzer).toContain("segA.effectiveEndSec - 7.0");
    expect(analyzer).toContain("new int[]{3, 2, 1}");

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("durMs - 20000L");
    expect(service).toContain("boolean vocalSafeNow");
    expect(service).toContain("remSec <= 7.0");
    expect(service).toContain("fadeOutSlopeTicks");
  });

  it("persists and restores offline lyrics by both trackId and artist::title fingerprint without IndexedDB", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });

    await savePersistedOfflineLyrics(
      { trackId: "track-a", fingerprint: "test artist::test song" },
      {
        lines: [{ timeMs: 1200, text: "First lyric line" }],
        source: "lrclib",
        lyricsOffsetMs: -250,
      },
    );

    const byId = await getPersistedOfflineLyrics({ trackId: "track-a" });
    expect(byId?.lines).toHaveLength(1);
    expect(byId?.lines[0].text).toBe("First lyric line");
    expect(byId?.lyricsOffsetMs).toBe(-250);

    const byFingerprint = await getPersistedOfflineLyrics({
      trackId: "device-test-artist-test-song",
      fingerprint: "test artist::test song",
    });
    expect(byFingerprint?.lines[0].text).toBe("First lyric line");
    expect(byFingerprint?.source).toBe("lrclib");
  });

  it("wires offline-first cover resolution, trackTitle/artistName props, and downloadIndexVersion across TrackClient & UI components", () => {
    const optImg = fs.readFileSync(
      path.resolve(__dirname, "../components/OptimizedTrackImage.tsx"),
      "utf8",
    );
    expect(optImg).toContain("useDownloadIndexVersion");
    expect(optImg).toContain("updateDownloadedCover");
    expect(optImg).toContain("saveLocalDeviceCover");
    expect(optImg).toContain("getCachedLocalDeviceCoverDataUrl");

    const mosaic = fs.readFileSync(
      path.resolve(__dirname, "../components/PlaylistMosaic.tsx"),
      "utf8",
    );
    expect(mosaic).toContain("useDownloadIndexVersion");
    expect(mosaic).toContain("getLocalDeviceCoverDataUrl");
    expect(mosaic).toContain("resolveDownloadedTrackId");

    for (const rel of [
      "../app/track/[id]/TrackClient.tsx",
      "../components/NowPlayingOverlay.tsx",
      "../components/PlayerDock.tsx",
      "../components/TrackCard.tsx",
      "../components/ExternalTrackCard.tsx",
      "../components/DownloadActionSheet.tsx",
      "../components/DevicePickerPopover.tsx",
      "../app/library/page.tsx",
    ]) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
      expect(src).toContain("<OptimizedTrackImage");
      expect(src).toContain("trackTitle=");
      expect(src).toContain("artistName=");
    }
  });
});

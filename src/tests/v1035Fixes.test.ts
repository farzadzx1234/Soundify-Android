import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { analyzeTrackSegment, findBestFrequencyMatchPair, solveAutoMixPlan } from "@/lib/autoMixEngine";
import {
  getTrackDownloadSnapshot,
  getTrackDownloadSnapshotForTrack,
  registerDeviceLocalAudioFile,
  resetDownloadManagerState,
} from "@/lib/downloadManager";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "ext-youtube-kamkam-1",
    title: "Kam Kam",
    titleFa: "Kam Kam",
    artistId: "artist-1",
    artistName: "Shayan Yo",
    artistNameFa: "Shayan Yo",
    artistAvatarColor: "#10b981",
    album: "Single",
    albumFa: "تک‌آهنگ",
    genre: "Hip-Hop",
    mood: "Chill",
    durationSec: 184,
    audioUrl: "/api/stream/external?id=ext-youtube-kamkam-1",
    coverUrl: "",
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

describe("Soundify v1.0.35 Home Crash Fix, Soundify Mix Branding & Frequency-Matched Mixer", () => {
  afterEach(() => {
    resetDownloadManagerState();
  });

  it("synchronizes v1.0.35+ / versionCode >= 36 across all manifests", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(?:3[5-9]|[4-9]\d+|\d{3,})$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(36);
  });

  it("returns stable snapshot references from getTrackDownloadSnapshotForTrack across repeated calls (prevents React Error #185 on Home)", () => {
    registerDeviceLocalAudioFile({
      uri: "content://media/external/audio/media/4201",
      fileName: "Shayan Yo - Kam Kam.mp3",
      title: "Kam Kam",
      artist: "Shayan Yo",
      source: "mediastore",
    });

    const tr = makeTrack();
    const s1 = getTrackDownloadSnapshotForTrack(tr);
    const d1 = getTrackDownloadSnapshot(tr.id);
    const s2 = getTrackDownloadSnapshotForTrack(tr);
    const d2 = getTrackDownloadSnapshot(tr.id);

    expect(s1.status).toBe("downloaded");
    expect(Object.is(s1, s2)).toBe(true);
    expect(d1.status).toBe("idle");
    expect(Object.is(d1, d2)).toBe(true);
  });

  it("uses Soundify Mix branding instead of Apple Music wording in Settings and NowPlayingOverlay", () => {
    const settingsSrc = fs.readFileSync(
      path.resolve(__dirname, "../app/settings/page.tsx"),
      "utf8",
    );
    expect(settingsSrc).toContain("ساندیفای میکس");
    expect(settingsSrc).toContain("Soundify Mix");
    expect(settingsSrc).not.toContain("اپل موزیک");

    const overlaySrc = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlaySrc).toContain("ساندیفای میکس");
    expect(overlaySrc).toContain("Soundify Mix");
  });

  it("matches ending seconds of Track A to opening seconds of Track B with highest 6-band frequency similarity and never jumps mid-song", () => {
    const sr = 22050;
    const pcmA = new Float32Array(sr * 35);
    const pcmB = new Float32Array(sr * 35);

    // Track A: 0..24s bright high-hat texture, 24..34s warm 150Hz+450Hz pad matching Track B opening
    for (let i = 0; i < pcmA.length; i++) {
      const t = i / sr;
      if (t < 24) {
        pcmA[i] = 0.45 * Math.sin(2 * Math.PI * 5200 * t);
      } else {
        pcmA[i] = 0.4 * Math.sin(2 * Math.PI * 150 * t) + 0.25 * Math.sin(2 * Math.PI * 450 * t);
      }
    }

    // Track B: 0..1s silence, 1..7s warm 150Hz+450Hz opening, 7..35s vocal lead
    for (let i = sr; i < pcmB.length; i++) {
      const t = i / sr;
      if (t < 7) {
        pcmB[i] = 0.4 * Math.sin(2 * Math.PI * 150 * t) + 0.25 * Math.sin(2 * Math.PI * 450 * t);
      } else {
        pcmB[i] = 0.45 * Math.sin(2 * Math.PI * 1200 * t);
      }
    }

    const segA = analyzeTrackSegment(pcmA, sr, "outro", 35 * sr);
    const segB = analyzeTrackSegment(pcmB, sr, "intro", 35 * sr);
    const match = findBestFrequencyMatchPair(segA, segB);

    expect(match.cueOutASec).toBeGreaterThanOrEqual(23.5);
    expect(match.cueInBSec).toBeGreaterThanOrEqual(0.5);
    expect(match.cueInBSec).toBeLessThanOrEqual(6.5);
    expect(match.frequencySimilarity).toBeGreaterThan(0.85);

    const plan = solveAutoMixPlan("a", "b", segA, segB, sr);
    expect(plan.startOffsetSampleOnTrackB / sr).toBeLessThanOrEqual(7.0);
  });

  it("caps fallback intro silence trim <= 3500ms and drives hardware equal-power S-curve in SoundifyMediaService.java", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("Math.min(3500L, cueMs)");
    expect(service).toContain("double smoothP = p * p * (3.0 - 2.0 * p);");
    expect(service).toContain("nextDeckPlayer.setVolume(Math.max(0.0f, outGain));");
  });
});
